'use strict';

/**
 * @file
 * Defines the main Lando recipe builder for Upsun. It configures a lean local
 * development environment (a PHP appserver plus a database service) for
 * Drupal or WordPress projects hosted on Upsun, installs the official `upsun`
 * CLI, and wires up `lando pull` for grabbing the database/files from a real
 * Upsun environment. Unlike the old, unsupported `lando/platformsh` recipe,
 * this does not attempt to mirror an app's full `.upsun/config.yaml` service
 * topology — it makes the same "one appserver, one database" assumption that
 * the Pantheon and Acquia recipes make.
 */

// Modules
const _ = require('lodash');
const {getUpsunPull} = require('./../lib/pull');
const utils = require('./../lib/utils');

/** @type {object} Default local database credentials used by this recipe. */
const DB_CREDS = {user: 'upsun', password: 'upsun', database: 'upsun'};

/**
 * Configuration for the MySQL command-line interface.
 *
 * @param {object} creds The `{user, password, database}` creds of the database service.
 * @return {object} A tooling command definition.
 */
const getMysqlCli = creds => ({
  service: ':host',
  description: 'Drops into a MySQL shell on a database service',
  cmd: `mysql -u${creds.user} -p${creds.password} ${creds.database}`,
  options: {
    host: {
      description: 'The database service to use',
      default: 'database',
      alias: ['h'],
    },
  },
});

/**
 * Configuration for the PostgreSQL (psql) command-line interface.
 *
 * @param {object} creds The `{user, password, database}` creds of the database service.
 * @return {object} A tooling command definition.
 */
const getPostgresCli = creds => ({
  service: ':host',
  description: 'Drops into a psql shell on a database service',
  cmd: `psql -U${creds.user} ${creds.database}`,
  env: {PGPASSWORD: creds.password},
  options: {
    host: {
      description: 'The database service to use',
      default: 'database',
      alias: ['h'],
    },
  },
});

/**
 * Determines the database engine (`mysql` or `postgres`) from the `database`
 * recipe config value, e.g. `mysql:8.0` -> `mysql`.
 *
 * @param {string} database The `database` recipe config value.
 * @return {string} The database engine.
 */
const getDatabaseEngine = database => _.first(_.toString(database).split(':'));

/**
 * Builds the appserver and database service definitions.
 *
 * @param {object} options The recipe options.
 * @return {object} `{appserver, database}` Lando service definitions.
 */
const getServices = options => {
  const cachedToken = _.get(options, '_app.meta.token', null);
  return {
    appserver: {
      type: `php:${options.php}`,
      via: options.via,
      ssl: true,
      webroot: options.webroot,
      xdebug: options.xdebug,
      composer_version: options.composer_version,
      build_as_root_internal: options.build_root,
      build_internal: options.build,
      overrides: cachedToken ? {environment: {UPSUN_CLI_TOKEN: cachedToken}} : {},
    },
    database: {
      type: options.database,
      portforward: true,
      creds: DB_CREDS,
    },
  };
};

/**
 * Builds the tooling entries that are common to every Upsun app: the raw
 * `upsun` CLI passthrough and a database shell matching the configured engine.
 *
 * @param {string} dbType The final database type string, e.g. `mysql:8.0`.
 * @param {object} creds The final `{user, password, database}` creds of the database service.
 * @return {object} A tooling config fragment.
 */
const getBaseTooling = (dbType, creds) => {
  const engine = getDatabaseEngine(dbType);
  const dbTooling = engine === 'postgres' ? {psql: getPostgresCli(creds)} : {mysql: getMysqlCli(creds)};
  return _.merge({}, dbTooling, {
    upsun: {service: 'appserver', description: 'Run the Upsun CLI'},
  });
};

/*
 * Build Upsun
 */
module.exports = {
  name: 'upsun',
  parent: '_recipe',
  config: {
    application: null,
    build: [],
    build_root: [],
    composer_version: '2',
    database: 'mysql:8.0',
    framework: 'drupal',
    id: null,
    php: '8.3',
    proxy: {},
    services: {},
    tooling: {},
    via: 'apache',
    webroot: '.',
    xdebug: false,
  },
  builder: (parent, config) => class LandoUpsun extends parent {
    constructor(id, options = {}) {
      options = _.merge({}, config, options);

      // Install the upsun CLI plus framework-specific tooling (drush or wp-cli)
      options.build_root.push(utils.getCliInstallStep());
      options.build.push(...utils.getFrameworkBuildSteps(options.framework));

      // Add appserver and database services
      options.services = _.merge({}, getServices(options), options.services);

      // The landofile's top-level services: overrides are merged downstream by
      // the app compiler, not passed into this builder, so read any user creds
      // and database type overrides off the raw app config instead
      const creds = _.merge({}, DB_CREDS, _.get(options, '_app.config.services.database.creds', {}));
      const dbType = _.get(options, '_app.config.services.database.type', options.database);

      // Proxy the nginx sidecar when via is nginx (php-fpm itself has no HTTP listener
      // to proxy to in that case); otherwise proxy the appserver directly (apache)
      if (!_.has(options, 'proxyService')) {
        options.proxyService = _.startsWith(options.via, 'nginx') ? 'appserver_nginx' : 'appserver';
      }
      options.proxy = _.set(options.proxy, options.proxyService, [`${options.app}.${options._app._config.domain}`]);

      // Base tooling: the upsun CLI passthrough, a db shell, and framework tooling (drush/wp)
      options.tooling = _.merge({}, getBaseTooling(dbType, creds), utils.getFrameworkTooling(options.framework), options.tooling);

      // Wire up `lando pull`, pre-filling auth from any previously cached Upsun tokens
      const tokens = utils.sortTokens(options._app.upsunTokens);
      options.tooling.pull = getUpsunPull({
        root: options.root,
        framework: options.framework,
        token: _.get(options, '_app.meta.token', false),
      }, tokens);
      options.tooling.pull.env = {
        LANDO_DB_ENGINE: getDatabaseEngine(dbType),
        LANDO_DB_USER: creds.user,
        LANDO_DB_PASSWORD: creds.password,
        LANDO_DB_NAME: creds.database,
        LANDO_DB_HOST: 'database',
      };

      // Resolve the project id/app: explicit config wins, then the host
      // environment at compile time. When neither is set we leave the tooling
      // env keys out entirely so a UPSUN_PROJECT_ID/UPSUN_APPLICATION already
      // present in the container (e.g. from an env_file) still reaches the
      // pull script instead of being clobbered with an empty string.
      const projectId = options.id || process.env.UPSUN_PROJECT_ID || null;
      const application = options.application || process.env.UPSUN_APPLICATION || null;
      if (projectId) options.tooling.pull.env.UPSUN_PROJECT_ID = projectId;
      if (application) options.tooling.pull.env.UPSUN_APPLICATION = application;

      // Send downstream
      super(id, options);
    }
  },
};

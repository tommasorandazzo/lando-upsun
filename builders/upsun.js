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

/** @type {object} Static local database credentials used by this recipe. */
const DB_CREDS = {user: 'upsun', password: 'upsun', database: 'upsun'};

/**
 * Configuration for the MySQL command-line interface.
 * @type {object}
 */
const mysqlCli = {
  service: ':host',
  description: 'Drops into a MySQL shell on a database service',
  cmd: `mysql -u${DB_CREDS.user} -p${DB_CREDS.password} ${DB_CREDS.database}`,
  options: {
    host: {
      description: 'The database service to use',
      default: 'database',
      alias: ['h'],
    },
  },
};

/**
 * Configuration for the PostgreSQL (psql) command-line interface.
 * @type {object}
 */
const postgresCli = {
  service: ':host',
  description: 'Drops into a psql shell on a database service',
  cmd: `psql -U${DB_CREDS.user} ${DB_CREDS.database}`,
  env: {PGPASSWORD: DB_CREDS.password},
  options: {
    host: {
      description: 'The database service to use',
      default: 'database',
      alias: ['h'],
    },
  },
};

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
      via: 'nginx',
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
 * @param {object} options The recipe options.
 * @return {object} A tooling config fragment.
 */
const getBaseTooling = options => {
  const engine = getDatabaseEngine(options.database);
  const dbTooling = engine === 'postgres' ? {psql: postgresCli} : {mysql: mysqlCli};
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
    build: [],
    build_root: [],
    composer_version: '2',
    database: 'mysql:8.0',
    drush: '11',
    framework: 'drupal',
    php: '8.3',
    proxy: {},
    services: {},
    tooling: {},
    webroot: '.',
    xdebug: false,
  },
  builder: (parent, config) => class LandoUpsun extends parent {
    constructor(id, options = {}) {
      options = _.merge({}, config, options);

      // Install the upsun CLI plus framework-specific tooling (drush or wp-cli)
      options.build_root.push(utils.getCliInstallStep());
      options.build.push(...utils.getFrameworkBuildSteps(options.framework, options.drush));

      // Add appserver and database services
      options.services = _.merge({}, getServices(options), options.services);

      // Proxy the appserver
      if (!_.has(options, 'proxyService')) options.proxyService = 'appserver';
      options.proxy = _.set(options.proxy, options.proxyService, [`${options.app}.${options._app._config.domain}`]);

      // Base tooling: the upsun CLI passthrough, a db shell, and framework tooling (drush/wp)
      options.tooling = _.merge({}, getBaseTooling(options), utils.getFrameworkTooling(options.framework), options.tooling);

      // Wire up `lando pull`, pre-filling auth from any previously cached Upsun tokens
      const tokens = utils.sortTokens(options._app.upsunTokens);
      options.tooling.pull = getUpsunPull({
        root: options.root,
        framework: options.framework,
        token: _.get(options, '_app.meta.token', false),
      }, tokens);
      options.tooling.pull.env = {
        LANDO_DB_ENGINE: getDatabaseEngine(options.database),
        LANDO_DB_USER: DB_CREDS.user,
        LANDO_DB_PASSWORD: DB_CREDS.password,
        LANDO_DB_NAME: DB_CREDS.database,
        LANDO_DB_HOST: 'database',
      };

      // Send downstream
      super(id, options);
    }
  },
};

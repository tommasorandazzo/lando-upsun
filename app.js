'use strict';

/**
 * @file
 * Caches Upsun API tokens across `lando pull` invocations, mirroring the
 * token-caching pattern in `@lando/pantheon`'s app.js. Unlike Pantheon (which
 * validates the token against its API before caching it), this trusts the
 * token as given: real validation happens CLI-side, inside the container,
 * via `upsun auth:info` in scripts/upsun-pull.sh.
 */

// Modules
const _ = require('lodash');
const {getFingerprint} = require('./lib/utils');

module.exports = (app, lando) => {
  // Add additional things to cleanse from logs
  app.log.alsoSanitize('upsun-auth');

  // Only do this on upsun recipes
  if (_.get(app, 'config.recipe') === 'upsun') {
    app.events.on('post-pull', async (config, answers) => {
      // get existing cached token
      const {token} = lando.cache.get(app.metaCache) || {};
      // Only run if answers.auth is set and its a new/different token
      // this allows this command to be overridden without causing a failure here
      if (answers.auth && answers.auth !== token) {
        const cache = {token: answers.auth, label: getFingerprint(answers.auth), date: _.toInteger(_.now() / 1000)};
        // Reset this app's metacache
        lando.cache.set(app.metaCache, _.merge({}, app.meta, cache), {persist: true});
        // Reset lando's store of upsun tokens
        lando.cache.set(app.upsunTokenCache, _.slice(_.unionBy([cache], app.upsunTokens, 'token'), 0, 5), {persist: true});
        // Wipe out the apps tooling cache to reset with the new token
        lando.cache.remove(`${app.name}.tooling.cache`);
      }
    });

    app.events.on('pre-init', 1, () => {
      app.upsunTokenCache = 'upsun.tokens';
      app.upsunTokens = lando.cache.get(app.upsunTokenCache) || [];
    });
  }
};

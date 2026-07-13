'use strict';

/**
 * @file
 * Defines the `lando pull` tooling command for Upsun. Unlike the Pantheon and
 * Acquia recipes, this does not fetch a live list of environments/relationships
 * /mounts to build an interactive dropdown — it leans entirely on the official
 * `upsun` CLI running inside the appserver container (see scripts/upsun-pull.sh)
 * for that, and defaults the environment to the current git branch, which is
 * how Upsun itself maps environments to branches.
 */

// Modules
const _ = require('lodash');
const {getAuthOptions} = require('./auth');
const {getCurrentBranch, getFilemount} = require('./utils');

/**
 * Builds the base (non-auth) `lando pull` task configuration.
 *
 * @param {string} root The project root, used to detect the current git branch.
 * @param {string} framework The `framework` recipe config value.
 * @return {object} The base task configuration.
 */
const getTask = (root, framework) => ({
  service: 'appserver',
  description: 'Pull the database and/or files from an Upsun environment',
  cmd: '/helpers/upsun-pull.sh',
  level: 'app',
  stdio: ['inherit', 'pipe', 'pipe'],
  options: {
    environment: {
      description: 'The Upsun environment to pull from',
      passthrough: true,
      alias: ['e'],
      interactive: {
        type: 'input',
        message: 'Pull from which Upsun environment?',
        default: getCurrentBranch(root),
        weight: 200,
      },
    },
    relationship: {
      description: 'A comma-separated list of relationship[:remote-schema] pairs to import, or "none" to skip the database',
      passthrough: true,
      alias: ['r'],
      interactive: {
        type: 'input',
        message: 'Which relationship(s) should be imported as the database? (comma-separated, or "none")',
        default: 'database',
        weight: 300,
      },
    },
    mount: {
      description: 'A comma-separated list of mount[:target] pairs to download, or "none" to skip files',
      passthrough: true,
      alias: ['m'],
      interactive: {
        type: 'input',
        message: 'Which mount(s) should be downloaded? (comma-separated source[:target] pairs, or "none")',
        default: getFilemount(framework),
        weight: 400,
      },
    },
  },
});

/**
 * Builds the complete `lando pull` task configuration for the Upsun recipe.
 *
 * @param {object} options `{root, framework, token}` for the current app.
 * @param {Array<object>} [tokens] Cached Upsun API token entries.
 * @return {object} The complete `lando pull` tooling command configuration.
 */
exports.getUpsunPull = (options, tokens = []) => {
  const {root, framework, token} = options;
  return _.merge({}, getTask(root, framework), {options: {auth: getAuthOptions(token, tokens)}});
};

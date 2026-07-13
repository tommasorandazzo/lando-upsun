'use strict';

/**
 * @file
 * Shared helpers for the Upsun recipe: API token bookkeeping, git branch
 * detection (Upsun environments map 1:1 to git branches), and framework
 * (Drupal/WordPress) specific build steps and tooling.
 */

// Modules
const _ = require('lodash');
const {execSync} = require('child_process');

/** @type {string} Default Drush version to install for Drupal projects. */
const DRUSH_VERSION = '11';
/** @type {string} URL of the wp-cli phar release used for WordPress projects. */
const WP_CLI_URL = 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar';
/** @type {string} Installer script for the official Upsun CLI. */
const CLI_INSTALLER_URL = 'https://raw.githubusercontent.com/platformsh/cli/main/installer.sh';

/**
 * Masks all but the first and last few characters of an API token so it can be
 * safely shown in an interactive prompt without a network round trip.
 *
 * @param {string} token The raw Upsun API token.
 * @return {string} A masked fingerprint, e.g. `abcd1234…wxyz`.
 */
exports.getFingerprint = token => {
  if (!_.isString(token) || token.length < 12) return '****';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
};

/**
 * Merges and deduplicates cached Upsun API tokens, most recently added first.
 *
 * @param {Array<object>} tokens Previously cached token entries.
 * @param {Array<object>} [additional] Any additional entries to fold in.
 * @return {Array<object>} A deduplicated array of `{token, label, date}` entries.
 */
exports.sortTokens = (tokens = [], additional = []) => _(additional)
    .concat(tokens)
    .compact()
    .uniqBy('token')
    .sortBy(token => -_.get(token, 'date', 0))
    .value();

/**
 * Determines the current git branch of a project root, falling back to `main`.
 * Upsun environments are git branches, so this gives sane pull defaults without
 * needing to hit any API.
 *
 * @param {string} root The project root directory.
 * @return {string} The current branch name, or `main` if it cannot be determined.
 */
exports.getCurrentBranch = root => {
  try {
    return execSync('git symbolic-ref --short HEAD', {cwd: root, stdio: ['ignore', 'pipe', 'ignore']})
        .toString()
        .trim() || 'main';
  } catch (error) {
    return 'main';
  }
};

/**
 * Whether a framework value should be treated as WordPress.
 *
 * @param {string} framework The `framework` recipe config value.
 * @return {boolean} True if this is a WordPress-flavored framework.
 */
const isWordPressy = framework => framework === 'wordpress';
exports.isWordPressy = isWordPressy;

/**
 * Gets the conventional public files directory for a framework, used as the
 * default mount download target when the user doesn't specify one.
 *
 * @param {string} framework The `framework` recipe config value.
 * @return {string} A path relative to the webroot.
 */
exports.getFilemount = framework => isWordPressy(framework) ? 'wp-content/uploads' : 'sites/default/files';

/**
 * Gets the appserver build steps needed to install framework tooling
 * (Drush for Drupal, wp-cli for WordPress).
 *
 * @param {string} framework The `framework` recipe config value.
 * @param {string} [drush] The Drush version constraint to install for Drupal.
 * @return {Array<string>} Shell commands to run during the appserver build.
 */
exports.getFrameworkBuildSteps = (framework, drush = DRUSH_VERSION) => {
  if (isWordPressy(framework)) {
    return [
      `curl -fsSL -o /tmp/wp-cli.phar ${WP_CLI_URL}`,
      'chmod +x /tmp/wp-cli.phar',
      'mv /tmp/wp-cli.phar /usr/local/bin/wp',
    ];
  }
  return [`composer global require drush/drush:^${drush} -n`, 'ln -sf ~/.composer/vendor/bin/drush /usr/local/bin/drush'];
};

/**
 * Gets the framework-specific tooling entries (the `drush` or `wp` commands).
 *
 * @param {string} framework The `framework` recipe config value.
 * @return {object} A tooling config fragment.
 */
exports.getFrameworkTooling = framework => {
  if (isWordPressy(framework)) return {wp: {service: 'appserver', description: 'Run wp-cli commands'}};
  return {drush: {service: 'appserver', description: 'Run drush commands'}};
};

/**
 * Gets the appserver build step that installs the official Upsun CLI.
 *
 * @return {string} A shell command to run during the appserver build.
 */
exports.getCliInstallStep = () => `curl -fsSL ${CLI_INSTALLER_URL} | VENDOR=upsun bash`;

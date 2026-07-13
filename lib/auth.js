'use strict';

/**
 * @file
 * Helpers to generate interactive/non-interactive command-line option
 * configurations for Upsun API token authentication. Upsun auth is a single
 * API token (unlike Pantheon's email+token or Acquia's key+secret), so this
 * mirrors `pantheon/lib/auth.js`'s single-token shape but labels cached
 * entries with a locally-computed fingerprint instead of an API-verified
 * email, since we don't call out to any API from the host.
 */

// Modules
const _ = require('lodash');
const {getFingerprint} = require('./utils');

/**
 * Builds the `{name, value}` choices list for previously used tokens.
 *
 * @param {Array<object>} tokens Cached token entries, each `{token, label}`.
 * @return {Array<object>} Inquirer-style choices.
 */
const getTokenChoices = tokens => _(tokens).map(entry => ({
  name: entry.label || getFingerprint(entry.token),
  value: entry.token,
})).value();

/**
 * Interactive auth options: pick a previously used token, or enter a new one.
 *
 * @param {Array<object>} [tokens] Cached token entries.
 * @return {object} Interactive command-line option definitions.
 */
const getInteractiveOptions = (tokens = []) => ({
  'auth': {
    interactive: {
      type: 'list',
      message: 'Choose an Upsun account',
      choices: _.flatten([getTokenChoices(tokens), [{name: 'add or refresh a token', value: 'more'}]]),
      when: () => !_.isEmpty(tokens),
      weight: 100,
    },
  },
  'token-entry': {
    hidden: true,
    interactive: {
      name: 'auth',
      type: 'password',
      message: 'Enter an Upsun API token',
      when: answers => _.isEmpty(tokens) || _.get(answers, 'auth', '') === 'more',
      weight: 101,
    },
  },
});

/**
 * Non-interactive auth options, pre-filled with a token that was passed in
 * directly (e.g. `lando pull --auth <token>` or a cached default).
 *
 * @param {string} token The Upsun API token.
 * @param {string} label A display label for the token (e.g. its fingerprint).
 * @return {object} Non-interactive command-line option definitions.
 */
const getNonInteractiveOptions = (token, label) => ({
  'auth': {
    default: token,
    defaultDescription: label,
  },
});

/**
 * Gets the appropriate auth options depending on whether a token was already
 * supplied.
 *
 * @param {string|false} [token] An Upsun API token, if already known.
 * @param {Array<object>} [tokens] Cached token entries for interactive choices.
 * @return {object} Command-line option definitions for the `auth` option.
 */
exports.getAuthOptions = (token = false, tokens = []) => {
  if (token) return getNonInteractiveOptions(token, getFingerprint(token));
  return getInteractiveOptions(tokens);
};

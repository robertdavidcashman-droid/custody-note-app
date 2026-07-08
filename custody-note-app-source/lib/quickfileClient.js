/*
 * QuickFile API client core — pure, dependency-injected helpers so the network
 * behaviour can be unit-tested with MOCK responses (never hitting the live API).
 *
 * QuickFile auth model (important, do not replace with OAuth): every request is
 * authenticated with Account Number + API Key + a per-request Submission Number,
 * hashed together with MD5. There is no bearer token, refresh token, cookie or
 * redirect URI. A fresh Submission Number + MD5 is built for every call, so
 * there is nothing to "expire" or refresh — this module guarantees that.
 */
'use strict';

const crypto = require('crypto');

/**
 * Build the QuickFile authentication block for one request.
 * @param {object} creds { accountNumber, apiKey, applicationId }
 * @param {object} [opts] { submissionNumber, md5 } injectable for deterministic tests
 * @returns {{accountNumber,submissionNumber,md5Value,applicationId}}
 * @throws {Error} with a clear, user-facing message if any credential is missing.
 */
function buildQuickFileAuth(creds, opts) {
  const c = creds || {};
  const accountNumber = String(c.accountNumber || '').trim();
  const apiKey = String(c.apiKey || '').trim();
  const applicationId = String(c.applicationId || '').trim();

  const missing = [];
  if (!accountNumber) missing.push('Account number');
  if (!apiKey) missing.push('API key');
  if (!applicationId) missing.push('Application ID');
  if (missing.length) {
    throw new Error('QuickFile not configured \u2014 missing in Settings: ' + missing.join(', ') + '.');
  }

  const submissionNumber = (opts && opts.submissionNumber)
    || ('cn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
  const md5fn = (opts && opts.md5) || function (input) {
    return crypto.createHash('md5').update(input, 'utf8').digest('hex').toLowerCase();
  };
  const md5Value = md5fn(accountNumber + apiKey + submissionNumber);

  return { accountNumber, submissionNumber, md5Value, applicationId };
}

/**
 * Parse a raw QuickFile HTTP response into the message Body, or throw a clear Error.
 * Mirrors the live response shapes (Errors array, Header.Status === 'Error', non-2xx,
 * empty/invalid JSON). Pure: feed it mock strings in tests.
 * @param {number} statusCode
 * @param {string} raw response body text
 * @returns {object} the message Body
 * @throws {Error} with a specific, human-readable reason on any failure.
 */
function parseQuickFileResponse(statusCode, raw) {
  const text = String(raw || '');
  if (!text.trim()) {
    throw new Error('QuickFile returned empty response (HTTP ' + statusCode + ')');
  }
  let json;
  try { json = JSON.parse(text); } catch (_) { json = null; }

  if (json && json.Errors) {
    const errs = json.Errors.Error || json.Errors;
    const errArr = Array.isArray(errs) ? errs : [errs];
    const msgs = errArr.map((e) => (typeof e === 'object' && e !== null)
      ? (e.Message || e.Detail || JSON.stringify(e))
      : String(e));
    throw new Error(msgs.join('; '));
  }
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('QuickFile HTTP ' + statusCode + ': ' + text.slice(0, 300));
  }
  if (!json) {
    throw new Error('QuickFile response parse error (HTTP ' + statusCode + ')');
  }
  const rootKey = Object.keys(json).find((k) => typeof json[k] === 'object' && json[k] && json[k].Header);
  const msg = rootKey ? json[rootKey] : ((json.payload && json.payload.Message) || json.Message || json);
  const header = msg && msg.Header;
  if (header && header.Status === 'Error') {
    const errMsg = (header && (header.StatusMessage || header.ErrorMessage))
      || (msg && msg.Body && msg.Body.ErrorMessage)
      || 'Unknown QuickFile error';
    throw new Error(String(errMsg));
  }
  return (msg && msg.Body) || {};
}

module.exports = { buildQuickFileAuth, parseQuickFileResponse };

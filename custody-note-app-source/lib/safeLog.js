'use strict';

/**
 * lib/safeLog.js
 * ----------------------------------------------------------------------------
 * Redacting wrapper around console for the main process. Strips obvious PII
 * before anything reaches stdout / electron-log.
 *
 * NEVER substitute this for "we don't log sensitive data in the first place".
 * The first defence is not putting client information into log messages at
 * all (see LOGGING_STANDARD.md). The second defence — this module — exists
 * to prevent regressions where a developer adds a debug `console.log(record)`
 * and forgets it in a release build.
 *
 * Patterns redacted:
 *   - Email addresses
 *   - UK mobile / landline phone numbers
 *   - National Insurance numbers (UK)
 *   - UK postcodes
 *   - Custody numbers (e.g. "CU/123456" "21/2026", "AB 123/26")
 *   - Bearer tokens / "ghp_…" / "github_pat_…" / AWS access key IDs
 *   - Hex strings ≥ 32 chars (likely API keys / hashes / fingerprints)
 *
 * Each match is replaced with a tag like "<redacted:email>" so the log still
 * communicates that *something* was there.
 */

const REDACTORS = [
  { tag: 'email',     re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { tag: 'gh-token',  re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g },
  { tag: 'aws-akid',  re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { tag: 'bearer',    re: /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}\b/gi },
  { tag: 'jwt',       re: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g },
  { tag: 'long-hex',  re: /\b[a-f0-9]{32,}\b/gi },
  { tag: 'ni',        re: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/gi },
  { tag: 'postcode',  re: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi },
  { tag: 'phone-uk',  re: /(?:\+?44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b/g },
  { tag: 'phone-uk',  re: /\b0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g },
  { tag: 'custody',   re: /\b[A-Z]{1,3}\s?\d{2,8}\/\d{2,4}\b/g },
];

function redact(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    let out = value;
    for (const r of REDACTORS) {
      out = out.replace(r.re, '<redacted:' + r.tag + '>');
    }
    return out;
  }
  if (value instanceof Error) {
    const e = new Error(redact(value.message));
    e.name = value.name;
    if (value.code) e.code = value.code;
    if (value.stack) e.stack = redact(value.stack);
    return e;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    // Drop obviously sensitive keys outright (don't even let "the value
    // exists" leak the field name).
    const SENSITIVE_KEYS = new Set([
      'password', 'pw', 'pin', 'secret', 'token', 'authToken',
      'authorization', 'cookie', 'sessionId', 'apiKey', 'api_key',
      'licence_key', 'licenceKey',
      // Custody-note specific
      'forename', 'surname', 'middleNames', 'address', 'addressLine1',
      'addressLine2', 'dob', 'mobile', 'phone', 'email',
      'custodyNumber', 'dsccRef', 'ufn', 'fileReference',
      'disclosure', 'advice', 'instructions', 'notes', 'interview',
      'data', // raw JSON blob from attendances table
      'body', // request body / email body
      'html', // HTML buffers (custody-note PDFs)
      'dataUrl',
    ]);
    const out = {};
    for (const k of Object.keys(value)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = '<redacted:' + k + '>';
      } else {
        out[k] = redact(value[k]);
      }
    }
    return out;
  }
  return value;
}

function _format(args) {
  return args.map(function (a) {
    if (typeof a === 'string') return redact(a);
    try { return JSON.stringify(redact(a)); }
    catch (_) { return String(a); }
  }).join(' ');
}

function info(...args)  { console.log(_format(args)); }
function warn(...args)  { console.warn(_format(args)); }
function error(...args) { console.error(_format(args)); }
function debug(...args) {
  // debug suppressed unless CUSTODYNOTE_DEBUG is set
  if (process && process.env && process.env.CUSTODYNOTE_DEBUG === '1') {
    console.log(_format(args));
  }
}

module.exports = { redact, info, warn, error, debug };

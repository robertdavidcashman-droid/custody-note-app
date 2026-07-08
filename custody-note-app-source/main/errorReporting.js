'use strict';

/**
 * main/errorReporting.js
 * ----------------------------------------------------------------------------
 * Lightweight, PRIVACY-FIRST crash/error reporting for the main process.
 *
 * Design constraints (this app stores confidential legal-aid data):
 *   - OPT-IN ONLY. With no DSN configured this module is a NO-OP for remote
 *     reporting — it just routes fatal errors through the existing PII-safe
 *     redactor (lib/safeLog) into the local log. Nothing leaves the machine.
 *   - @sentry/electron is NOT a hard dependency. Pulling a large native-ish
 *     SDK into a signed, auto-updating desktop app is a bloat/stability risk,
 *     so we `require` it LAZILY and only when a DSN is actually set. If the
 *     package is absent we degrade silently to local redacted logging. This
 *     lets an operator opt in (set the DSN + `npm i @sentry/electron`) without
 *     forcing the dependency on everyone.
 *   - Every payload that could be sent is passed through lib/safeLog.redact()
 *     in `beforeSend`/`beforeBreadcrumb`, and PII-bearing fields (user, request
 *     body, extra, contexts) are stripped, so confidential client data is
 *     never transmitted even if it slipped into an error message.
 *
 * Enable by setting CUSTODYNOTE_SENTRY_DSN (or SENTRY_DSN) AND installing
 * @sentry/electron.
 */

const safeLog = require('../lib/safeLog');

function getDsn(env) {
  const e = env || process.env || {};
  return String(e.CUSTODYNOTE_SENTRY_DSN || e.SENTRY_DSN || '').trim();
}

/**
 * Redact a Sentry event in-place-ish before it leaves the machine. Returns the
 * sanitised event (or null to drop). Defensive: never throws.
 */
function redactSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;
  try {
    if (typeof event.message === 'string') {
      event.message = safeLog.redact(event.message);
    }
    if (event.exception && Array.isArray(event.exception.values)) {
      event.exception.values = event.exception.values.map((v) => {
        const out = Object.assign({}, v);
        if (typeof out.value === 'string') out.value = safeLog.redact(out.value);
        return out;
      });
    }
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map((b) => {
        const out = Object.assign({}, b);
        if (typeof out.message === 'string') out.message = safeLog.redact(out.message);
        if (out.data) out.data = safeLog.redact(out.data);
        return out;
      });
    }
    // Hard-strip the highest-risk PII carriers entirely.
    if (event.request && 'data' in event.request) event.request.data = '<redacted>';
    if (event.extra) event.extra = safeLog.redact(event.extra);
    if (event.contexts) event.contexts = safeLog.redact(event.contexts);
    if (event.user) {
      const id = event.user.id;
      event.user = id ? { id: String(id) } : undefined; // drop email/ip/username
    }
  } catch (_) { /* never let redaction crash reporting */ }
  return event;
}

let _state = {
  initialised: false,
  sentryEnabled: false,
  dsnPresent: false,
  sentry: null,
};

/**
 * Initialise main-process error reporting. Safe to call once at startup.
 *
 * @param {object} [opts]
 * @param {object} [opts.env]     env source (defaults to process.env)
 * @param {string} [opts.release] app version string for Sentry release tagging
 * @param {object} [opts._sentry] injected Sentry module (tests)
 * @param {object} [opts.logger]  defaults to safeLog
 * @returns {{sentryEnabled:boolean, dsnPresent:boolean}}
 */
function initMainErrorReporting(opts) {
  const options = opts || {};
  const env = options.env || process.env;
  const log = options.logger || safeLog;
  const dsn = getDsn(env);

  _state.dsnPresent = !!dsn;

  if (!dsn) {
    // NO-OP remote reporting; local redacted logging handlers stay in place
    // (installed separately in main.js global handlers).
    _state.initialised = true;
    _state.sentryEnabled = false;
    return { sentryEnabled: false, dsnPresent: false };
  }

  try {
    const Sentry = options._sentry || require('@sentry/electron/main');
    Sentry.init({
      dsn,
      release: options.release,
      environment: env.NODE_ENV || 'production',
      sendDefaultPii: false,
      autoSessionTracking: false,
      beforeSend: (event) => redactSentryEvent(event),
      beforeBreadcrumb: (breadcrumb) => {
        if (breadcrumb && typeof breadcrumb.message === 'string') {
          breadcrumb.message = safeLog.redact(breadcrumb.message);
        }
        return breadcrumb;
      },
    });
    _state.sentry = Sentry;
    _state.sentryEnabled = true;
    log.info('[errorReporting] Remote error reporting enabled (PII-redacted).');
  } catch (e) {
    // DSN set but package missing/failed — degrade to local logging only.
    log.warn('[errorReporting] DSN configured but @sentry/electron unavailable; using local redacted logging only.');
    _state.sentryEnabled = false;
  }

  _state.initialised = true;
  return { sentryEnabled: _state.sentryEnabled, dsnPresent: _state.dsnPresent };
}

/**
 * Forward an exception to the remote sink when enabled (always redacted by the
 * configured beforeSend). NO-OP when reporting is disabled. Never throws.
 */
function captureException(err, context) {
  if (!_state.sentryEnabled || !_state.sentry) return false;
  try {
    _state.sentry.captureException(err, context ? { extra: { context: String(context) } } : undefined);
    return true;
  } catch (_) {
    return false;
  }
}

/** Reset internal state — test helper only. */
function _reset() {
  _state = { initialised: false, sentryEnabled: false, dsnPresent: false, sentry: null };
}

function isEnabled() { return !!_state.sentryEnabled; }

module.exports = {
  getDsn,
  redactSentryEvent,
  initMainErrorReporting,
  captureException,
  isEnabled,
  _reset,
};

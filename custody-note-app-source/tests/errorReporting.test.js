/**
 * tests/errorReporting.test.js
 * ----------------------------------------------------------------------------
 * Verifies the opt-in, PII-safe crash/error reporting layer
 * (main/errorReporting.js):
 *   - NO-OP when no DSN is configured (nothing initialised, capture is inert).
 *   - Enables a remote sink only when a DSN is present AND the SDK is available.
 *   - Redacts client PII / secrets from any event before it could be sent.
 *
 * A fake Sentry module is injected so no real network/SDK is required.
 *
 * Run: npm run test:unit
 *
 * security-audit:allow-secrets — synthetic fixtures (fake email / token) used
 * only to prove the redactor strips them. Not real credentials.
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const errorReporting = require('../main/errorReporting');

function makeFakeSentry() {
  const calls = { init: [], captured: [] };
  return {
    calls,
    init(opts) { calls.init.push(opts); },
    captureException(err, ctx) { calls.captured.push({ err, ctx }); },
  };
}

describe('errorReporting.getDsn', () => {
  it('reads CUSTODYNOTE_SENTRY_DSN then SENTRY_DSN, trimmed', () => {
    assert.strictEqual(errorReporting.getDsn({ CUSTODYNOTE_SENTRY_DSN: '  https://x@y/1  ' }), 'https://x@y/1');
    assert.strictEqual(errorReporting.getDsn({ SENTRY_DSN: 'https://a@b/2' }), 'https://a@b/2');
    assert.strictEqual(errorReporting.getDsn({}), '');
  });
});

describe('errorReporting.initMainErrorReporting', () => {
  beforeEach(() => errorReporting._reset());

  it('is a NO-OP when no DSN is set (capture does nothing)', () => {
    const fake = makeFakeSentry();
    const res = errorReporting.initMainErrorReporting({ env: {}, _sentry: fake, logger: { info() {}, warn() {} } });
    assert.strictEqual(res.dsnPresent, false);
    assert.strictEqual(res.sentryEnabled, false);
    assert.strictEqual(fake.calls.init.length, 0, 'Sentry.init must not be called without a DSN');
    assert.strictEqual(errorReporting.isEnabled(), false);
    assert.strictEqual(errorReporting.captureException(new Error('boom')), false);
    assert.strictEqual(fake.calls.captured.length, 0);
  });

  it('enables remote reporting when a DSN is set and the SDK is available', () => {
    const fake = makeFakeSentry();
    const res = errorReporting.initMainErrorReporting({
      env: { CUSTODYNOTE_SENTRY_DSN: 'https://k@sentry.example/9' },
      _sentry: fake,
      release: 'custody-note@1.9.99',
      logger: { info() {}, warn() {} },
    });
    assert.strictEqual(res.dsnPresent, true);
    assert.strictEqual(res.sentryEnabled, true);
    assert.strictEqual(fake.calls.init.length, 1);
    assert.strictEqual(fake.calls.init[0].dsn, 'https://k@sentry.example/9');
    assert.strictEqual(fake.calls.init[0].sendDefaultPii, false);
    assert.strictEqual(typeof fake.calls.init[0].beforeSend, 'function');

    assert.strictEqual(errorReporting.captureException(new Error('boom'), 'ctx'), true);
    assert.strictEqual(fake.calls.captured.length, 1);
  });

  it('degrades to local logging if DSN is set but the SDK throws/absent', () => {
    let warned = false;
    const res = errorReporting.initMainErrorReporting({
      env: { SENTRY_DSN: 'https://k@sentry.example/9' },
      _sentry: { init() { throw new Error('module not found'); } },
      logger: { info() {}, warn() { warned = true; } },
    });
    assert.strictEqual(res.dsnPresent, true);
    assert.strictEqual(res.sentryEnabled, false);
    assert.ok(warned, 'should warn that it degraded to local logging');
    assert.strictEqual(errorReporting.captureException(new Error('x')), false);
  });
});

describe('errorReporting.redactSentryEvent', () => {
  it('redacts message, exception values, breadcrumbs and strips PII carriers', () => {
    const event = {
      message: 'failed for client john.smith@example.co.uk',
      exception: { values: [{ type: 'Error', value: 'token=ghp_' + 'a'.repeat(40) + ' leaked' }] },
      breadcrumbs: [{ message: 'call to 07700 900123', data: { email: 'a@b.com' } }],
      request: { data: { body: 'secret instructions' } },
      extra: { custodyNumber: 'CU/123456' },
      user: { id: 'machine-42', email: 'leak@example.com', ip_address: '1.2.3.4' },
      contexts: { client: { surname: 'Smith' } },
    };
    const out = errorReporting.redactSentryEvent(event);

    assert.ok(!out.message.includes('john.smith@example.co.uk'), 'email must be redacted from message');
    assert.match(out.message, /<redacted:email>/);
    assert.ok(!out.exception.values[0].value.includes('ghp_'), 'token must be redacted from exception value');
    assert.ok(!JSON.stringify(out.breadcrumbs).includes('a@b.com'), 'breadcrumb email must be redacted');
    assert.strictEqual(out.request.data, '<redacted>', 'request body must be hard-stripped');
    // user reduced to opaque id only
    assert.deepStrictEqual(out.user, { id: 'machine-42' });
    assert.ok(!('email' in out.user));
  });

  it('never throws on malformed events', () => {
    assert.doesNotThrow(() => errorReporting.redactSentryEvent(null));
    assert.doesNotThrow(() => errorReporting.redactSentryEvent({}));
    assert.doesNotThrow(() => errorReporting.redactSentryEvent({ exception: { values: null } }));
  });
});

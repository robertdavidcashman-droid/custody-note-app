/**
 * tests/safeLog.test.js
 * Verifies that lib/safeLog.redact() strips PII / secrets / privileged-looking
 * tokens from log payloads. Anything that lands in production logs MUST go
 * through this redactor first.
 *
 * Run: npm run test:unit
 *
 * security-audit:allow-secrets — this file contains DELIBERATELY synthetic
 * fixtures (fake AWS access key shape, fake JWT) so the redactor can be
 * exercised. They are not real credentials.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { redact } = require('../lib/safeLog');

describe('safeLog.redact', () => {
  it('redacts email addresses', () => {
    assert.strictEqual(
      redact('contact me at john.smith@example.co.uk thanks'),
      'contact me at <redacted:email> thanks'
    );
  });

  it('redacts GitHub PAT (classic and fine-grained)', () => {
    const classic = 'token=ghp_' + 'a'.repeat(40);
    const fine    = 'tok=github_pat_' + 'b'.repeat(80);
    assert.match(redact(classic), /<redacted:gh-token>/);
    assert.match(redact(fine), /<redacted:gh-token>/);
  });

  it('redacts AWS access key IDs', () => {
    assert.match(redact('AKIA1234567890ABCDEF'), /<redacted:aws-akid>/);
    assert.match(redact('ASIAXYZ4567890ABCDEF'), /<redacted:aws-akid>/);
  });

  it('redacts Bearer tokens and JWTs', () => {
    assert.match(redact('Authorization: Bearer abc.def.ghi.jkl_mnopqrstuv'),
      /<redacted:bearer>/);
    assert.match(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'),
      /<redacted:jwt>/);
  });

  it('redacts UK postcodes, NI numbers, mobiles, custody refs', () => {
    assert.match(redact('client lives at SW1A 1AA, NI AB123456C, mob 07712345678'),
      /<redacted:postcode>.*<redacted:ni>.*<redacted:phone-uk>/);
    assert.match(redact('custody no CU 12345/26'), /<redacted:custody>/);
  });

  it('redacts long hex strings (likely keys or hashes)', () => {
    assert.match(redact('hash=' + 'a'.repeat(64)), /<redacted:long-hex>/);
  });

  it('drops sensitive object keys outright', () => {
    const out = redact({
      password: 'hunter2',
      token: 'abc123',
      forename: 'Alice',
      surname: 'Smith',
      advice: 'do not answer questions',
      keepMe: 'visible',
    });
    assert.strictEqual(out.password, '<redacted:password>');
    assert.strictEqual(out.token, '<redacted:token>');
    assert.strictEqual(out.forename, '<redacted:forename>');
    assert.strictEqual(out.surname, '<redacted:surname>');
    assert.strictEqual(out.advice, '<redacted:advice>');
    assert.strictEqual(out.keepMe, 'visible');
  });

  it('redacts Error message and stack', () => {
    const e = new Error('Failed for user alice@example.com');
    const r = redact(e);
    assert.match(r.message, /<redacted:email>/);
    assert.match(r.stack, /<redacted:email>/);
  });

  it('passes through primitives unchanged', () => {
    assert.strictEqual(redact(42), 42);
    assert.strictEqual(redact(true), true);
    assert.strictEqual(redact(null), null);
    assert.strictEqual(redact(undefined), undefined);
  });

  it('handles deeply nested objects/arrays', () => {
    const out = redact({
      cases: [{ forename: 'Bob' }, { advice: 'silent' }],
      meta: { token: 'xyz', okay: 1 },
    });
    assert.strictEqual(out.cases[0].forename, '<redacted:forename>');
    assert.strictEqual(out.cases[1].advice, '<redacted:advice>');
    assert.strictEqual(out.meta.token, '<redacted:token>');
    assert.strictEqual(out.meta.okay, 1);
  });
});

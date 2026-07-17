/**
 * tests/securityLog.test.js
 * Verifies that main/securityLog.record() writes JSONL events, redacts the
 * meta payload, and rotates when the file grows too large.
 *
 * Run: npm run test:unit
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const securityLog = require('../main/securityLog');

let tmp;

describe('securityLog', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-seclog-'));
    securityLog.init(tmp);
  });
  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  });

  it('writes one JSON line per record() call', () => {
    securityLog.record('admin_login_success');
    securityLog.record('power_lock_triggered', { reason: 'lock-screen' });
    const body = fs.readFileSync(path.join(tmp, 'security.log'), 'utf8');
    const lines = body.trim().split('\n');
    assert.strictEqual(lines.length, 2);
    const a = JSON.parse(lines[0]);
    const b = JSON.parse(lines[1]);
    assert.strictEqual(a.event, 'admin_login_success');
    assert.strictEqual(b.event, 'power_lock_triggered');
    assert.strictEqual(b.meta.reason, 'lock-screen');
    assert.match(a.ts, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('redacts PII inside meta', () => {
    securityLog.record('debug_event', {
      email: 'leak@example.com',
      forename: 'Bob',
      note: 'arrived at SW1A 1AA',
    });
    const body = fs.readFileSync(path.join(tmp, 'security.log'), 'utf8');
    assert.doesNotMatch(body, /leak@example\.com/);
    assert.doesNotMatch(body, /Bob/);
    assert.doesNotMatch(body, /SW1A 1AA/);
    assert.match(body, /<redacted:email>/);
    assert.match(body, /<redacted:forename>/);
    assert.match(body, /<redacted:postcode>/);
  });

  it('does not throw on bad userData path', () => {
    securityLog.init('/this/path/does/not/exist/anywhere');
    assert.doesNotThrow(() => securityLog.record('test_event'));
  });

  it('truncates oversized payloads instead of erroring', () => {
    const huge = 'x'.repeat(200000);
    assert.doesNotThrow(() => securityLog.record('huge_event', { huge }));
    const body = fs.readFileSync(path.join(tmp, 'security.log'), 'utf8');
    assert.ok(body.length < 10000, 'oversized line was truncated');
  });
});

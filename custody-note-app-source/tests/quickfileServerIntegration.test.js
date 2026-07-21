'use strict';

/**
 * Integration checks for QuickFile account sync against a deployed API base.
 *
 * Run with:
 *   SMOKE_API_BASE=https://<deployment-host>
 * Optionally:
 *   SMOKE_LICENCE_KEY=<real key with saved credentials>
 *
 * Default behaviour is to skip when SMOKE_API_BASE is not set (so unit tests
 * remain hermetic and don't depend on production deployments).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const sync = require('../lib/quickfileSettingsSync');

const BASE = process.env.SMOKE_API_BASE || '';
const KEY = process.env.SMOKE_LICENCE_KEY || '';
const MACHINE = process.env.SMOKE_MACHINE_ID || 'integration-test-machine';

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

describe('QuickFile server integration (custodynote.com)', () => {
  it('POST /api/settings/quickfile returns JSON auth gate (route deployed)', async (t) => {
    if (!BASE) {
      t.skip('Set SMOKE_API_BASE to run deployed QuickFile integration checks');
      return;
    }
    const res = await httpPost(`${BASE}/api/settings/quickfile`, {
      key: 'smoke-invalid-key',
      machineId: MACHINE,
    });
    assert.ok(res.json, 'expected JSON body, got: ' + String(res.raw || '').slice(0, 80));
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.json.ok, false);
    assert.match(String(res.json.error || ''), /Authentication required/i);
  });

  it('pull + decrypt round-trip when SMOKE_LICENCE_KEY has saved credentials', async (t) => {
    if (!BASE) {
      t.skip('Set SMOKE_API_BASE to run deployed QuickFile integration checks');
      return;
    }
    if (!KEY) {
      t.skip('Set SMOKE_LICENCE_KEY to verify saved credentials pull from server');
      return;
    }
    const pull = await sync.pullQuickFileSettingsFromServer(
      (url, body) => httpPost(url, body).then((r) => {
        if (r.status >= 400) {
          const err = new Error(r.json && r.json.error ? r.json.error : 'HTTP ' + r.status);
          err.statusCode = r.status;
          throw err;
        }
        return r.json;
      }),
      BASE,
      KEY,
      MACHINE
    );
    assert.equal(pull.ok, true, pull.error || 'pull failed');
    assert.ok(pull.blob, 'expected encrypted blob');
    const decrypted = sync.decryptQuickFileSettings(KEY, pull.blob);
    assert.ok(decrypted, 'blob must decrypt with licence key');
    assert.ok(decrypted.quickfileAccountNumber, 'account number');
    assert.ok(decrypted.quickfileApiKey, 'api key');
    assert.ok(decrypted.quickfileAppId, 'application id');
  });
});

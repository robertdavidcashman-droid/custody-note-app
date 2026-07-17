'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sync = require('../lib/quickfileSettingsSync');

describe('quickfileSettingsSync', () => {
  const key = 'CN-TEST-KEY-1234';
  const settings = {
    quickfileAccountNumber: '12345678',
    quickfileApiKey: 'secret-api-key',
    quickfileAppId: 'app-id-99',
  };

  it('encrypts and decrypts settings round-trip', () => {
    const blob = sync.encryptQuickFileSettings(key, settings);
    assert.ok(typeof blob === 'string' && blob.length > 20);
    const out = sync.decryptQuickFileSettings(key, blob);
    assert.deepStrictEqual(out, settings);
  });

  it('returns null for wrong licence key', () => {
    const blob = sync.encryptQuickFileSettings(key, settings);
    const out = sync.decryptQuickFileSettings('CN-OTHER-KEY', blob);
    assert.equal(out, null);
  });

  it('pushQuickFileSettingsToServer posts encrypted blob', async () => {
    let posted = null;
    const httpPost = function (url, body) {
      posted = { url: url, body: body };
      return Promise.resolve({ ok: true, updatedAt: '2026-06-07T12:00:00.000Z' });
    };
    const result = await sync.pushQuickFileSettingsToServer(
      httpPost,
      'https://custodynote.com',
      key,
      'machine-1',
      settings
    );
    assert.equal(result.ok, true);
    assert.ok(posted.url.endsWith('/api/settings/quickfile'));
    assert.equal(posted.body.key, key);
    assert.ok(typeof posted.body.blob === 'string' && posted.body.blob.length > 0);
    assert.deepStrictEqual(sync.decryptQuickFileSettings(key, posted.body.blob), settings);
  });

  it('encrypts incomplete settings (empty api key) for round-trip; main rejects incomplete push', () => {
    const incomplete = {
      quickfileAccountNumber: '12345678',
      quickfileApiKey: '',
      quickfileAppId: 'app-id-99',
    };
    const blob = sync.encryptQuickFileSettings(key, incomplete);
    const out = sync.decryptQuickFileSettings(key, blob);
    assert.deepStrictEqual(out, incomplete);
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(main, /if \(status\.missing\.length\)/);
    assert.match(main, /QuickFile credentials incomplete/);
  });

  it('pullQuickFileSettingsFromServer returns blob payload', async () => {
    const blob = sync.encryptQuickFileSettings(key, settings);
    const httpPost = function () {
      return Promise.resolve({ ok: true, blob: blob, updatedAt: '2026-06-07T12:00:00.000Z' });
    };
    const result = await sync.pullQuickFileSettingsFromServer(
      httpPost,
      'https://custodynote.com',
      key,
      'machine-1'
    );
    assert.equal(result.ok, true);
    assert.equal(result.blob, blob);
  });
});

describe('main.js QuickFile server sync wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  it('defines ensureQuickFileSettingsFromServer and pushQuickFileSettingsToCloud', () => {
    assert.match(main, /async function ensureQuickFileSettingsFromServer/);
    assert.match(main, /async function pushQuickFileSettingsToCloud/);
    assert.match(main, /quickfileSettingsSync/);
  });

  it('pulls settings before connection-state and create-invoice IPC', () => {
    assert.match(main, /quickfile-connection-state', async \(\) => \{[\s\S]*ensureQuickFileSettingsFromServer/);
    assert.match(main, /syncError: \(ensureResult && ensureResult\.error\)/);
    assert.match(main, /quickfile-create-invoice', async \(_, params\) => \{[\s\S]*await ensureQuickFileSettingsFromServer/);
  });

  it('registers quickfile-settings-push and quickfile-settings-ensure IPC', () => {
    assert.match(main, /ipcMain\.handle\('quickfile-settings-push'/);
    assert.match(main, /ipcMain\.handle\('quickfile-settings-ensure'/);
  });

  it('preserves existing QuickFile keys on empty bulk set-settings', () => {
    assert.match(main, /QUICKFILE_CREDENTIAL_KEYS/);
    assert.match(main, /preserved existing QuickFile key/);
  });
});

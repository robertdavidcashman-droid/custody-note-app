'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sync = require('../lib/quickfileSettingsSync');

describe('quickfileSettingsSync (full user settings)', () => {
  const key = 'CN-TEST-KEY-1234';
  const settings = {
    quickfileAccountNumber: '12345678',
    quickfileApiKey: 'secret-api-key',
    quickfileAppId: 'app-id-99',
    openaiApiKey: 'sk-test-openai',
    email: 'me@example.com',
    darkMode: 'true',
    feeEarnerNameDefault: 'Rob',
  };

  it('encrypts and decrypts syncable settings round-trip', () => {
    const blob = sync.encryptQuickFileSettings(key, settings);
    assert.ok(typeof blob === 'string' && blob.length > 20);
    const out = sync.decryptQuickFileSettings(key, blob);
    assert.equal(out.quickfileApiKey, 'secret-api-key');
    assert.equal(out.openaiApiKey, 'sk-test-openai');
    assert.equal(out.email, 'me@example.com');
    assert.equal(out.darkMode, 'true');
    assert.equal(out.backupFolder, undefined);
  });

  it('excludes machine-local keys from pickSyncableSettings', () => {
    const picked = sync.pickSyncableSettings({
      email: 'a@b.c',
      backupFolder: '/tmp/backups',
      nextInvoiceNumber: '99',
    });
    assert.equal(picked.email, 'a@b.c');
    assert.equal(picked.backupFolder, undefined);
    assert.ok(sync.MACHINE_LOCAL_SETTINGS_KEYS.includes('backupFolder'));
  });

  it('returns null for wrong licence key', () => {
    const blob = sync.encryptQuickFileSettings(key, settings);
    const out = sync.decryptQuickFileSettings('CN-OTHER-KEY', blob);
    assert.equal(out, null);
  });

  it('push posts encrypted blob', async () => {
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
    const dec = sync.decryptQuickFileSettings(key, posted.body.blob);
    assert.equal(dec.openaiApiKey, 'sk-test-openai');
    assert.equal(dec.email, 'me@example.com');
  });

  it('hasAnySyncableContent detects empty vs populated', () => {
    assert.equal(sync.hasAnySyncableContent({}), false);
    assert.equal(sync.hasAnySyncableContent({ email: 'x@y.z' }), true);
  });
});

describe('main.js user settings sync wiring', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  it('defines ensure/push/schedule sync helpers', () => {
    assert.match(main, /async function ensureQuickFileSettingsFromServer/);
    assert.match(main, /async function pushQuickFileSettingsToCloud/);
    assert.match(main, /function scheduleUserSettingsCloudPush/);
    assert.match(main, /collectSyncableSettingsFromDb/);
  });

  it('set-settings schedules cloud push for syncable keys', () => {
    assert.match(main, /scheduleUserSettingsCloudPush\('set-settings'\)/);
  });
});

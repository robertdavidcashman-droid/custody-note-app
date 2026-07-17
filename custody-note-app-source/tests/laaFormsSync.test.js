'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const laaSync = require('../lib/laaFormsSync');
const laaManifest = require('../lib/laaFormsManifest');

const bundledDir = path.join(__dirname, '..', 'data', 'laa-official-forms');

describe('laaFormsSync.ensureTemplates', () => {
  it('returns ok with bundled templates when remote is skipped', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-laa-sync-'));
    try {
      const result = await laaSync.ensureTemplates({
        bundledDir,
        userDataDir: userData,
        httpGet: async () => ({ statusCode: 404, ok: false, data: '' }),
        httpGetBinary: async () => ({ statusCode: 404, ok: false, buffer: Buffer.alloc(0) }),
        apiBaseUrl: 'https://custodynote.com',
        skipRemote: true,
      });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.forms.crm1.ok, true);
      assert.strictEqual(result.forms.crm1.version, 'v16');
      assert.strictEqual(result.source, 'bundled');
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  it('resolveTemplatePath finds bundled CRM1 PDF', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-laa-res-'));
    try {
      const p = laaSync.resolveTemplatePath('crm1', bundledDir, userData);
      assert.ok(p, 'CRM1 path must resolve');
      assert.ok(fs.existsSync(p));
      assert.ok(p.includes('crm1-v16-feb-2025.pdf'));
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
});

describe('main.js LAA template IPC wiring', () => {
  it('registers laa-ensure-templates and uses manifest module', () => {
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.ok(mainSrc.includes("ipcMain.handle('laa-ensure-templates'"), 'ensure-templates IPC expected');
    assert.ok(mainSrc.includes("ipcMain.handle('laa-get-template-status'"), 'get-template-status IPC expected');
    assert.ok(mainSrc.includes("require('./lib/laaFormsSync')"), 'sync module required');
    assert.ok(mainSrc.includes('getLaaTemplatePath'), 'template path resolver expected');
    assert.ok(!mainSrc.includes('const LAA_FORM_FILES'), 'hardcoded LAA_FORM_FILES should be removed');
  });
});

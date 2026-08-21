'use strict';

/**
 * New firms must be pushable to QuickFile on save, and billing must not
 * falsely reject a selected instructing firm when firmName is stale.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const mainJs = read('main.js');
const preloadJs = read('preload.js');
const appJs = read('app.js');
const billingScreenJs = read('renderer/views/billing-screen.js');
const billingJs = read('renderer/views/billing.js');

describe('quickfile-ensure-client IPC', () => {
  it('registers quickfile-ensure-client handler in main', () => {
    assert.match(mainJs, /ipcMain\.handle\('quickfile-ensure-client'/);
  });

  it('reuses quickFileFindOrCreateClient and skips when not configured', () => {
    const start = mainJs.indexOf("ipcMain.handle('quickfile-ensure-client'");
    assert.ok(start > 0);
    const body = mainJs.slice(start, start + 1200);
    assert.match(body, /quickFileFindOrCreateClient/);
    assert.match(body, /skipped:\s*'not-configured'/);
    assert.match(body, /ensureQuickFileSettingsFromServer/);
  });

  it('preload exposes quickfileEnsureClient', () => {
    assert.match(preloadJs, /quickfileEnsureClient:\s*\(params\)\s*=>\s*ipcRenderer\.invoke\('quickfile-ensure-client'/);
  });
});

describe('ensureFirmInQuickFile after firm save', () => {
  it('defines ensureFirmInQuickFile helper', () => {
    assert.match(appJs, /function ensureFirmInQuickFile/);
    assert.match(appJs, /quickfileEnsureClient/);
  });

  it('Firms page addFirm calls ensureFirmInQuickFile', () => {
    const start = appJs.indexOf('function addFirm()');
    const body = appJs.slice(start, start + 1800);
    assert.match(body, /ensureFirmInQuickFile/);
  });

  it('inline attendance firm save calls ensureFirmInQuickFile', () => {
    assert.match(appJs, /Firm saved and selected[\s\S]{0,400}ensureFirmInQuickFile/);
  });

  it('Quick Capture firm save calls ensureFirmInQuickFile', () => {
    const start = appJs.indexOf("document.getElementById('qc-add-firm-btn').addEventListener");
    assert.ok(start > 0);
    const body = appJs.slice(start, start + 2200);
    assert.match(body, /ensureFirmInQuickFile/);
  });

  it('exposes firms list on window via setFirmsList', () => {
    assert.match(appJs, /function setFirmsList/);
    assert.match(appJs, /window\.firms\s*=\s*firms/);
  });
});

describe('QuickFile Client_Create payload', () => {
  it('uses buildQuickFileClientCreateBody (CompanyName-only ClientDetails)', () => {
    assert.match(mainJs, /buildQuickFileClientCreateBody/);
    const start = mainJs.indexOf('async function quickFileFindOrCreateClient');
    assert.ok(start > 0);
    const body = mainJs.slice(start, start + 1200);
    assert.match(body, /quickfileClient\.buildQuickFileClientCreateBody/);
    assert.doesNotMatch(body, /ClientType:\s*'Company'/);
    assert.doesNotMatch(body, /ClientDetails:\s*\{[\s\S]*Email:/);
  });
});

describe('billing firmName re-resolve guard', () => {
  it('workflow create invoice re-resolves firm via _wfResolveFirmDisplayName', () => {
    const start = billingScreenJs.indexOf('function _wfHandleCreateInvoice(');
    const body = billingScreenJs.slice(start, start + 1800);
    assert.match(body, /_wfResolveFirmDisplayName/);
    assert.match(body, /getFormData/);
  });

  it('workflow impl re-checks firmName before select-firm toast', () => {
    const start = billingScreenJs.indexOf('async function _wfHandleCreateInvoiceImpl');
    const body = billingScreenJs.slice(start, start + 2200);
    const resolveIdx = body.indexOf('_wfResolveFirmDisplayName');
    const toastIdx = body.indexOf('Select the instructing firm on the record before creating an invoice');
    assert.ok(resolveIdx > 0, 'must re-resolve firm name');
    assert.ok(toastIdx > resolveIdx, 're-resolve must happen before the select-firm toast');
  });

  it('legacy billing panel resolves firmName from firmId / window.firms', () => {
    assert.match(billingJs, /window\.firms/);
    assert.match(billingJs, /_wfResolveFirmDisplayName|firmMatch\.name/);
  });
});

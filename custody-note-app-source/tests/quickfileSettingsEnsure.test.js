'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const licence = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'licence.js'), 'utf8');

describe('QuickFile settings ensure (main process)', () => {
  it('registers quickfile-settings-ensure IPC returning ok/pulled/missing', () => {
    assert.match(main, /ipcMain\.handle\('quickfile-settings-ensure'/);
    assert.match(main, /force: before\.missing\.length > 0/);
    assert.match(main, /pulled: result\.usedLocal === false/);
  });

  it('pulls from server on startup when licence is present', () => {
    assert.match(main, /reason: 'startup'/);
    assert.match(main, /ensureQuickFileSettingsFromServer\(\{[\s\S]*reason: 'startup'/);
    assert.match(main, /\[QuickFile\] startup pull:/);
  });

  it('skips recent-local-cache only when local credentials are complete', () => {
    assert.match(main, /Incomplete local credentials: always pull from server/);
    assert.match(main, /if \(localComplete && !force\)/);
    assert.match(main, /skipped: 'recent-local-cache'/);
  });

  it('falls back to local cache when server pull fails', () => {
    assert.match(main, /settings pull failed/);
    assert.match(main, /ok: localComplete, usedLocal: localComplete/);
  });

  it('applies server blob when server updatedAt is newer', () => {
    assert.match(main, /serverUpdatedAt <= localServerUpdatedAt/);
    assert.match(main, /applyQuickFileSettingsFromCloud/);
  });
});

describe('QuickFile settings ensure (renderer + preload)', () => {
  it('preload exposes quickfileSettingsEnsure', () => {
    assert.ok(preload.includes('quickfileSettingsEnsure'));
    assert.ok(preload.includes("ipcRenderer.invoke('quickfile-settings-ensure')"));
  });

  it('app.js defines syncQuickFileSettingsFromAccount and exposes on window', () => {
    assert.match(app, /function syncQuickFileSettingsFromAccount/);
    assert.match(app, /window\.syncQuickFileSettingsFromAccount = syncQuickFileSettingsFromAccount/);
    assert.match(app, /quickfileSettingsEnsure/);
  });

  it('loadSettings syncs from account before hydrating fields', () => {
    const start = app.indexOf('function loadSettings()');
    const end = app.indexOf('function loadFirmsList()');
    assert.ok(start > -1 && end > start);
    const body = app.slice(start, end);
    assert.match(body, /syncQuickFileSettingsFromAccount/);
  });

  it('openQuickFileSettings syncs before navigating to settings', () => {
    const start = app.indexOf('function openQuickFileSettings()');
    const end = app.indexOf('window.openQuickFileSettings = openQuickFileSettings');
    assert.ok(start > -1 && end > start);
    assert.match(app.slice(start, end), /syncQuickFileSettingsFromAccount/);
  });

  it('licence validate chains account sync after successful validation', () => {
    assert.match(licence, /syncQuickFileSettingsFromAccount/);
  });

  it('saveQuickFileSettings still pushes to server', () => {
    assert.match(app, /quickfileSettingsPush/);
  });
});

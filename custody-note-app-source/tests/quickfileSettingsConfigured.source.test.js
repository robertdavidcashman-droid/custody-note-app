/**
 * Regression: hasQuickFileSettingsConfigured() must see credentials after startup
 * getSettings — not only after opening Settings (loadSettings). See app.js bootstrap
 * hydrateQuickFileSettingsInputs and getQuickFileSettingsPayload cache fallback.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('app.js syncs QuickFile from account on startup and in Settings', () => {
  assert.ok(APP.includes('syncQuickFileSettingsFromAccount'), 'expected syncQuickFileSettingsFromAccount()');
  assert.ok(APP.includes('hydrateQuickFileSettingsInputs'), 'expected shared hydrate helper');
  assert.match(APP, /syncQuickFileSettingsFromAccount\(\{ toastOnPull: true \}\)/);
});

test('app.js saveQuickFileSettings pushes credentials to the licence server', () => {
  assert.match(APP, /quickfileSettingsPush/);
});

test('completion-screen uses DB-backed QuickfileConfigured helper', () => {
  const completion = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'completion-screen.js'), 'utf8');
  assert.match(completion, /QuickfileConfigured\.fetchQuickFileConfigured/);
});

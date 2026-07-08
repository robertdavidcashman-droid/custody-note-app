/**
 * Regression: renderer/views/settings.js must NOT redefine loadSettings, saveSettings,
 * loadFirmsList, renderFirmsPage, or addFirm — those live in app.js and load after app.js
 * would override them, breaking office postcode persistence and firms UI.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'settings.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

describe('Settings module — single source of truth (app.js)', () => {
  it('settings.js does not redefine loadSettings', () => {
    assert.ok(!/\bfunction\s+loadSettings\s*\(/.test(settingsJs), 'settings.js must not define loadSettings');
  });

  it('settings.js does not redefine saveSettings', () => {
    assert.ok(!/\bfunction\s+saveSettings\s*\(/.test(settingsJs), 'settings.js must not define saveSettings');
  });

  it('settings.js does not redefine loadFirmsList or renderFirmsPage or addFirm', () => {
    assert.ok(!/\bfunction\s+loadFirmsList\s*\(/.test(settingsJs), 'settings.js must not define loadFirmsList');
    assert.ok(!/\bfunction\s+renderFirmsPage\s*\(/.test(settingsJs), 'settings.js must not define renderFirmsPage');
    assert.ok(!/\bfunction\s+addFirm\s*\(/.test(settingsJs), 'settings.js must not define addFirm');
  });

  it('app.js loadSettings assigns office postcode from settings store', () => {
    assert.ok(
      appJs.includes('setting-office-postcode') && appJs.includes('s.officePostcode'),
      'loadSettings must populate setting-office-postcode from s.officePostcode'
    );
  });

  it('app.js saveSettings persists officePostcode', () => {
    assert.ok(
      appJs.includes("officePostcode: document.getElementById('setting-office-postcode')?.value?.trim()"),
      'saveSettings must include officePostcode from setting-office-postcode'
    );
  });
});

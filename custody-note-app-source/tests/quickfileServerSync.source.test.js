'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const DOCS = fs.readFileSync(path.join(root, 'docs', 'INTEGRATIONS.md'), 'utf8');
const CONN = fs.readFileSync(path.join(root, 'renderer', 'lib', 'quickfileConnectionState.js'), 'utf8');

describe('QuickFile server-first sync (source regression)', () => {
  it('init calls syncQuickFileSettingsFromAccount after licence gate', () => {
    assert.match(APP, /syncQuickFileSettingsFromAccount\(\{ toastOnPull: true \}\)/);
  });

  it('settings hint says enter once and syncs to account', () => {
    assert.match(HTML, /Enter your QuickFile API credentials once/i);
    assert.match(HTML, /every computer you use/i);
  });

  it('INTEGRATIONS.md documents server-backed QuickFile credentials', () => {
    assert.match(DOCS, /QuickFile invoicing/);
    assert.match(DOCS, /\/api\/settings\/quickfile/);
    assert.match(DOCS, /Enter them once/i);
  });

  it('connection state helper describes account sync not per-machine-only storage', () => {
    assert.match(CONN, /encrypted on the Custody Note server/);
    assert.ok(!CONN.includes('second machine simply has not had'), 'must not blame missing per-machine entry alone');
    assert.match(CONN, /another computer/);
  });

  it('hydrateQuickFileSettingsInputs is shared by sync helper', () => {
    assert.match(APP, /function hydrateQuickFileSettingsInputs/);
    assert.match(APP, /hydrateQuickFileSettingsInputs\(s\)/);
  });
});

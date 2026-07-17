/**
 * Static checks for legal/operational risk controls (no Electron required).
 */
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
// Schema DDL now lives in the versioned migration runner.
const dbMigrationsJs = fs.readFileSync(path.join(root, 'main', 'dbMigrations.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

describe('Confidentiality / data boundary', () => {
  it('preload exposes attendance CRUD only via contextBridge (no raw ipcRenderer)', () => {
    assert.ok(!preloadJs.includes('exposeInMainWorld') || preloadJs.includes('contextBridge.exposeInMainWorld'));
    assert.ok(!preloadJs.match(/exposeInMainWorld\([^,]+,\s*ipcRenderer\b/));
  });

  it('photo paths are scoped under attendance id in main', () => {
    assert.ok(mainJs.includes("path.join(app.getPath('userData'), 'photos', String(attendanceId)"));
  });
});

describe('Legal record integrity (main process)', () => {
  it('finalised records block non-finalise saves', () => {
    assert.ok(
      mainJs.includes("existing.status === 'finalised'") && mainJs.includes("'locked'"),
      'attendance-save must reject draft writes to finalised rows'
    );
  });

  it('sync pull refuses to downgrade finalised to draft', () => {
    assert.ok(
      mainJs.includes("localStatus === 'finalised'") && mainJs.includes('protect_finalised'),
      'sync must not overwrite local finalised with remote draft'
    );
  });

  it('draft case-key merge prevents duplicate drafts for same DSCC', () => {
    assert.ok(mainJs.includes('findExistingDraftIdByCaseKey'));
    assert.ok(mainJs.includes("One copy per case"));
  });

  it('duplicate check only compares finalised attendances (billing/legal risk)', () => {
    assert.ok(
      mainJs.includes("attendance-check-duplicate") ||
        mainJs.includes("ipcMain.handle('attendance-check-duplicate'")
    );
    assert.ok(
      mainJs.includes("status='finalised'") && mainJs.includes('attendance-check-duplicate'),
      'duplicate detection should target finalised records'
    );
  });

  it('audit_log table and attendance-save inserts exist', () => {
    assert.ok((mainJs + dbMigrationsJs).includes('CREATE TABLE IF NOT EXISTS audit_log'));
    assert.ok(mainJs.includes("INSERT INTO audit_log"));
  });

  it('billing invoice duplicate guard references invoice id', () => {
    assert.ok(mainJs.includes('allowDuplicate') && mainJs.includes('quickfile_invoice_id'));
  });
});

describe('Renderer — autosave and validation', () => {
  it('quietSave warns on failure (no silent data loss)', () => {
    const i = appJs.indexOf('function quietSave()');
    assert.ok(i !== -1);
    const block = appJs.slice(i, appJs.indexOf('\n  function ', i + 15));
    assert.ok(block.includes('showToast('), 'quietSave should surface save failures');
  });

  it('validateBeforeFinalise exists for gate before legal lock', () => {
    assert.ok(
      appJs.includes('validateBeforeFinalise') || appJs.includes('function validateBeforeFinalise'),
      'finalise path should validate'
    );
  });
});

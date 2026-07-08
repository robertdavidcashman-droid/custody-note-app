/**
 * Full-app integrity regression checks (static analysis of main process + critical paths).
 */

const { readFileSync } = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const APP_ROOT = path.join(__dirname, '..');

test('main.js: draft dedupe excludes archived records (data integrity)', () => {
  const main = readFileSync(path.join(APP_ROOT, 'main.js'), 'utf8');
  const draftArchivedCount = (main.match(/status='draft' AND deleted_at IS NULL AND archived_at IS NULL/g) || []).length;
  assert.ok(draftArchivedCount >= 4, 'expected draft dedupe/import queries to filter archived_at IS NULL');
});

test('main.js: import merge by file number excludes archived drafts', () => {
  const main = readFileSync(path.join(APP_ROOT, 'main.js'), 'utf8');
  assert.ok(
    main.includes("status='draft' AND deleted_at IS NULL AND archived_at IS NULL AND data LIKE ?"),
    'import path should not merge into archived drafts'
  );
});

test('main.js: open-external uses isSafeExternalUrl allowlist', () => {
  const main = readFileSync(path.join(APP_ROOT, 'main.js'), 'utf8');
  const idx = main.indexOf("ipcMain.handle('open-external'");
  assert.ok(idx !== -1);
  const slice = main.slice(idx, idx + 500);
  assert.ok(slice.includes('isSafeExternalUrl'), 'open-external must validate with isSafeExternalUrl');
  assert.ok(slice.includes('mailto'), 'mailto should be blocked or warned');
});

test('main.js: quickfile-create-invoice duplicate guard references allowDuplicate', () => {
  const main = readFileSync(path.join(APP_ROOT, 'main.js'), 'utf8');
  assert.ok(
    main.includes('allowDuplicate') && main.includes('quickfile_invoice_id'),
    'invoice creation should gate duplicates unless allowDuplicate'
  );
});

test('main.js: finalised records blocked from non-finalise saves', () => {
  const main = readFileSync(path.join(APP_ROOT, 'main.js'), 'utf8');
  assert.ok(
    main.includes("existing.status === 'finalised'") && main.includes("'locked'"),
    'attendance-save should lock finalised records'
  );
});

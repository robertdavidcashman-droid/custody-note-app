/**
 * Records list archive/deleted filter wiring + row actions.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const listJsSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'list.js'), 'utf8');
const mainJsSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function extractFunction(source, funcName) {
  const idx = source.indexOf('function ' + funcName);
  if (idx === -1) return null;
  let depth = 0;
  let started = false;
  let end = idx;
  for (let i = idx; i < source.length; i++) {
    if (source[i] === '{') { depth++; started = true; }
    if (source[i] === '}') { depth--; }
    if (started && depth === 0) { end = i + 1; break; }
  }
  return source.substring(idx, end);
}

describe('list archive filter load path', () => {
  it('loads archived and deleted rows via attendanceSearch', () => {
    const loadBody = extractFunction(appJsSource, '_loadListRows');
    assert.ok(loadBody, '_loadListRows must exist in app.js');
    assert.match(loadBody, /attendanceSearch/);
    assert.match(loadBody, /archived:\s*true/);
    assert.match(loadBody, /deleted:\s*true/);
    assert.match(loadBody, /attendanceListFull/);
  });

  it('refreshList uses _loadListRows and empty-state copy for archived/deleted', () => {
    const refreshBody = extractFunction(appJsSource, 'refreshList');
    assert.ok(refreshBody, 'refreshList must exist in app.js');
    assert.match(refreshBody, /_loadListRows\(\)/);
    assert.match(refreshBody, /No archived records/);
    assert.match(refreshBody, /No deleted records/);
  });
});

describe('list archive row actions', () => {
  it('renders Archive / Unarchive / Restore actions by filter', () => {
    const actionsBody = extractFunction(appJsSource, '_renderListItemActionsHtml');
    assert.ok(actionsBody, '_renderListItemActionsHtml must exist in app.js');
    assert.match(actionsBody, /data-action="archive"/);
    assert.match(actionsBody, /data-action="unarchive"/);
    assert.match(actionsBody, /data-action="restore"/);
    assert.match(actionsBody, /status === 'finalised'/);
    assert.match(actionsBody, /status === 'completed'/);
  });

  it('setupListDelegation handles archive, unarchive, and restore', () => {
    const delBody = extractFunction(appJsSource, 'setupListDelegation');
    assert.ok(delBody, 'setupListDelegation must exist in app.js');
    assert.match(delBody, /case 'archive'/);
    assert.match(delBody, /case 'unarchive'/);
    assert.match(delBody, /case 'restore'/);
    assert.match(delBody, /archiveAttendance/);
    assert.match(delBody, /unarchiveAttendance/);
    assert.match(delBody, /restoreDeletedAttendance/);
  });

  it('list.js defines archive/unarchive/restore helpers', () => {
    assert.match(listJsSource, /function archiveAttendance\(/);
    assert.match(listJsSource, /function unarchiveAttendance\(/);
    assert.match(listJsSource, /function restoreDeletedAttendance\(/);
    assert.match(listJsSource, /attendanceArchive/);
    assert.match(listJsSource, /attendanceUnarchive/);
    assert.match(listJsSource, /attendanceUndelete/);
  });

  it('form shows Archive Record when finalised or completed', () => {
    const visBody = extractFunction(appJsSource, 'updateFormBarVisibility');
    assert.ok(visBody, 'updateFormBarVisibility must exist');
    assert.match(visBody, /form-archive-btn/);
    assert.match(visBody, /finalised/);
    assert.match(visBody, /completed/);
    assert.doesNotMatch(visBody, /if \(archiveBtn\) archiveBtn\.style\.display = 'none';/);
  });
});

describe('main process archive parity', () => {
  it('attendance-unarchive writes an audit_log row', () => {
    assert.match(mainJsSource, /attendance-unarchive/);
    assert.match(mainJsSource, /'unarchived'/);
  });

  it('attendance-search SELECT includes quickfile invoice fields', () => {
    assert.match(
      mainJsSource,
      /archived_at, deleted_at, deletion_reason, quickfile_invoice_id, quickfile_invoice_number, data/
    );
  });
});

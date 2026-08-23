/**
 * List Bill button + billing entry helpers (isListBillEnabled, billAttendanceFromList).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const listJsSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'views', 'list.js'), 'utf8');

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

describe('isListBillEnabled', () => {
  const funcBody = extractFunction(appJsSource, 'isListBillEnabled');
  assert.ok(funcBody, 'isListBillEnabled must exist in app.js');
  const run = new Function(`
    ${funcBody}
    return isListBillEnabled;
  `)();

  it('enables Bill for finalised and completed non-archived records', () => {
    assert.strictEqual(run({ status: 'finalised' }), true);
    assert.strictEqual(run({ status: 'completed' }), true);
  });

  it('disables Bill for draft and archived records', () => {
    assert.strictEqual(run({ status: 'draft' }), false);
    assert.strictEqual(run({ status: 'finalised', archived_at: '2026-01-01' }), false);
  });
});

describe('list Bill button wiring', () => {
  it('list.js exposes shared Bill button HTML helper', () => {
    assert.match(listJsSource, /function _renderListBillButtonHtml\(rec\)/);
    assert.match(listJsSource, /window\._renderListBillButtonHtml/);
    assert.match(listJsSource, /data-action="bill"/);
    assert.match(listJsSource, /bill-btn/);
  });

  it('list.js does not define a duplicate refreshList', () => {
    assert.doesNotMatch(listJsSource, /function refreshList\(\)/);
  });

  it('app.js list actions render Bill button with data-action bill', () => {
    const actionsBody = extractFunction(appJsSource, '_renderListItemActionsHtml');
    assert.ok(actionsBody, '_renderListItemActionsHtml must exist in app.js');
    assert.match(actionsBody, /_renderListBillButtonHtml/);
    assert.match(actionsBody, /data-action="bill"/);
    assert.match(actionsBody, /bill-btn/);
    assert.match(actionsBody, /isListBillEnabled/);
    assert.match(actionsBody, /amend-btn/);
    const refreshBody = extractFunction(appJsSource, 'refreshList');
    assert.ok(refreshBody, 'refreshList must exist in app.js');
    assert.match(refreshBody, /_renderListItemActionsHtml/);
  });

  it('app.js exposes refreshList and billAttendanceFromList globally', () => {
    assert.match(appJsSource, /window\.refreshList\s*=\s*refreshList/);
    assert.match(appJsSource, /window\.billAttendanceFromList\s*=\s*billAttendanceFromList/);
    assert.match(appJsSource, /billableAttendances/);
    assert.match(appJsSource, /getPrimaryRecordActionState/);
    assert.match(appJsSource, /bottom-bar-finish-pill/);
  });
});

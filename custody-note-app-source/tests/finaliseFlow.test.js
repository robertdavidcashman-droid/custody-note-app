const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'app.js');
const appJsSource = fs.readFileSync(appJsPath, 'utf8');
const mainJsSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const toastSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'toast.js'), 'utf8');

/* ══════════════════════════════════════════════════════════════
   HELPER — extract function body from source by brace-matching
   ══════════════════════════════════════════════════════════════ */
function extractFunctionBody(source, funcName) {
  const patterns = ['function ' + funcName + '(', 'function ' + funcName + ' ('];
  let idx = -1;
  for (const p of patterns) { idx = source.indexOf(p); if (idx !== -1) break; }
  if (idx === -1) return null;
  let depth = 0, started = false;
  for (let i = idx; i < source.length; i++) {
    if (source[i] === '{') { depth++; started = true; }
    if (source[i] === '}') { depth--; }
    if (started && depth === 0) return source.substring(idx, i + 1);
  }
  return null;
}

function extractNestedFunction(parentBody, funcName) {
  if (!parentBody) return null;
  return extractFunctionBody(parentBody, funcName);
}

/* ══════════════════════════════════════════════════════════════
   1. VALIDATE BEFORE FINALISE — new confirm-dialog flow
   ══════════════════════════════════════════════════════════════ */
describe('validateBeforeFinalise — confirm dialog flow', () => {

  const vbfBody = extractFunctionBody(appJsSource, 'validateBeforeFinalise');

  it('function exists', () => {
    assert.ok(vbfBody, 'validateBeforeFinalise function must exist');
  });

  it('stops autosave before validation', () => {
    assert.ok(vbfBody.includes('stopAutoSave()'), 'must stop autosave');
    assert.ok(vbfBody.includes('clearTimeout(_quietSaveDebounceTimer)'), 'must clear debounce timer');
    assert.ok(vbfBody.includes('_draftSaveQueued = false'), 'must clear queued draft save');
  });

  it('sets _finalising = true before any async work', () => {
    const finalisingIdx = vbfBody.indexOf('_finalising = true');
    const collectIdx = vbfBody.indexOf('collectCurrentData()');
    assert.ok(finalisingIdx !== -1, '_finalising must be set');
    assert.ok(finalisingIdx < collectIdx, '_finalising must be set before data collection');
  });

  it('uses showConfirm instead of validation modal for missing fields', () => {
    assert.ok(vbfBody.includes('showConfirm('), 'must use showConfirm');
    assert.ok(vbfBody.includes("field(s) incomplete"), 'must mention incomplete fields');
    assert.ok(vbfBody.includes("Finalise anyway?"), 'must ask user to confirm');
  });

  it('does NOT use showValidationModal (replaced with showConfirm)', () => {
    assert.ok(!vbfBody.includes('showValidationModal'),
      'must NOT use showValidationModal — replaced with showConfirm');
  });

  it('does NOT restart autosave while waiting for user decision', () => {
    const confirmIdx = vbfBody.indexOf("showConfirm(");
    const afterConfirm = vbfBody.substring(confirmIdx, confirmIdx + 600);
    const beforeThen = afterConfirm.substring(0, afterConfirm.indexOf('.then('));
    assert.ok(!beforeThen.includes('startAutoSave()'),
      'must not restart autosave between showConfirm call and .then()');
  });

  it('has stuck-flag protection with 10s timeout', () => {
    assert.ok(vbfBody.includes('10000'), 'must have 10s timeout for stuck flag');
    assert.ok(vbfBody.includes('stuckMs'), 'must calculate stuck duration');
  });

  it('wraps entire function in try-catch', () => {
    assert.ok(vbfBody.includes('try {'), 'must have try block');
    assert.ok(vbfBody.includes('UNCAUGHT ERROR'), 'must handle uncaught errors');
  });

  it('resets _finalising on user cancel', () => {
    assert.ok(vbfBody.includes('_finalising = false'),
      'must reset _finalising when user cancels');
  });

  it('checks for duplicates when no missing fields', () => {
    assert.ok(vbfBody.includes('attendanceCheckDuplicate'),
      'must check duplicates');
    assert.ok(vbfBody.includes('checkDuplicatesThenFinalise'),
      'must have dedicated function for duplicate check flow');
  });

  it('proceeds to finalise even if duplicate check fails', () => {
    const body = vbfBody;
    const catchIdx = body.indexOf("'[FINALISE] Duplicate check failed:'");
    assert.ok(catchIdx !== -1, 'must have duplicate check error handler');
    const afterCatch = body.substring(catchIdx, catchIdx + 200);
    assert.ok(afterCatch.includes('waitForDraftThenFinalise'),
      'must proceed to finalise even if duplicate check fails');
  });
});

/* ══════════════════════════════════════════════════════════════
   2. SAVE FORM — finalise path
   ══════════════════════════════════════════════════════════════ */
describe('saveForm — finalise path', () => {

  const saveFormBody = extractFunctionBody(appJsSource, 'saveForm');

  it('stops autosave and sets currentRecordStatus before IPC when finalising', () => {
    assert.ok(saveFormBody, 'saveForm function must exist');
    const finaliseBlock = saveFormBody.substring(
      saveFormBody.indexOf("if (status === 'finalised')"),
      saveFormBody.indexOf('window.api.attendanceSave')
    );
    assert.ok(finaliseBlock.includes('stopAutoSave()'), 'must stop autosave');
    assert.ok(finaliseBlock.includes("currentRecordStatus = 'finalised'"), 'must set status');
    assert.ok(finaliseBlock.includes('clearTimeout(_quietSaveDebounceTimer)'), 'must clear timer');
    assert.ok(finaliseBlock.includes('_draftSaveQueued = false'), 'must clear queue');
  });

  it('resets currentRecordStatus on finalise failure', () => {
    const catchBlock = saveFormBody.substring(saveFormBody.indexOf('.catch('));
    assert.ok(catchBlock.includes("currentRecordStatus = 'draft'"),
      'catch handler must reset status to draft');
  });

  it('retries finalise up to 3 times on failure', () => {
    assert.ok(saveFormBody.includes('attemptNum < 3'), 'must retry up to 3 times');
    assert.ok(saveFormBody.includes('doSaveIPC'), 'must use doSaveIPC for retry');
  });

  it('verifies DB status after finalise IPC succeeds', () => {
    assert.ok(saveFormBody.includes('attendanceGet(verifyId)'), 'must verify DB status');
    assert.ok(saveFormBody.includes('[FINALISE] VERIFIED'), 'must log verification result');
  });

  it('uses attendanceForceStatus as last resort fallback', () => {
    assert.ok(saveFormBody.includes('attendanceForceStatus'), 'must have fallback');
    assert.ok(saveFormBody.includes('FORCE-STATUS succeeded'), 'must log success');
  });

  it('handles already-finalised (locked) records gracefully', () => {
    assert.ok(saveFormBody.includes("result.error === 'locked'"),
      'must check for locked error');
    assert.ok(saveFormBody.includes('treating as success'),
      'must treat locked as success when finalising');
  });

  it('tracks finalise attempt and result for debug panel', () => {
    assert.ok(saveFormBody.includes('_lastFinaliseAttempt'),
      'must set _lastFinaliseAttempt');
    assert.ok(saveFormBody.includes('_lastFinaliseResult'),
      'must set _lastFinaliseResult');
  });

  it('logs hasMeaningfulData failures', () => {
    assert.ok(saveFormBody.includes('hasMeaningfulData returned false'),
      'must log when hasMeaningfulData returns false');
  });
});

/* ══════════════════════════════════════════════════════════════
   3. QUIET SAVE — autosave guards
   ══════════════════════════════════════════════════════════════ */
describe('quietSave — autosave guards', () => {

  const quietSaveBody = extractFunctionBody(appJsSource, 'quietSave');

  it('skips when record is locked for editing (finalised or office-completed)', () => {
    assert.ok(quietSaveBody.includes('isNoteLockedForEditing()'),
      'must check locked status');
  });

  it('skips when _finalising is true', () => {
    assert.ok(quietSaveBody.includes('_finalising'),
      'must check _finalising flag');
  });

  it('does not re-queue when finalising or locked', () => {
    assert.ok(quietSaveBody.includes('!_finalising && !isNoteLockedForEditing()'),
      'finally block must check both flags before re-queuing');
  });

  it('respects locked error from main process', () => {
    assert.ok(quietSaveBody.includes("error === 'locked'"),
      'must handle locked error');
    assert.ok(quietSaveBody.includes("currentRecordStatus = 'finalised'"),
      'must update status on locked response');
  });
});

/* ══════════════════════════════════════════════════════════════
   4. MAIN PROCESS — attendance-save handler
   ══════════════════════════════════════════════════════════════ */
describe('Main process — attendance-save handler', () => {

  const saveHandlerStart = mainJsSource.indexOf("ipcMain.handle('attendance-save'");
  const saveHandler = mainJsSource.substring(saveHandlerStart, saveHandlerStart + 5000);

  it('blocks draft writes to finalised or office-completed records', () => {
    assert.ok(saveHandler.includes("existing.status === 'finalised' || existing.status === 'completed'"),
      'must treat finalised and completed as locked');
    assert.ok(saveHandler.includes("error: 'locked'"),
      'must return locked error');
  });

  it('verifies DB after finalise write', () => {
    assert.ok(saveHandler.includes('[FINALISE] VERIFIED after UPDATE'),
      'must verify status after UPDATE');
    assert.ok(saveHandler.includes("CRITICAL: DB write did NOT persist"),
      'must log critical error if write fails');
  });

  it('increments sync_version on every write', () => {
    assert.ok(saveHandler.includes('nextVer'),
      'must calculate next version');
    assert.ok(saveHandler.includes('sync_version=?'),
      'must update sync_version');
  });

  it('writes audit log for finalise and office completion', () => {
    assert.ok(saveHandler.includes("if (st === 'finalised') action = 'finalised'"),
      'must log finalised action in audit log');
    assert.ok(saveHandler.includes("office_completed"),
      'must log office_completed when transitioning to completed');
  });

  it('flushes DB to disk after finalise or office-complete', () => {
    assert.ok(saveHandler.includes("if (st === 'finalised' || st === 'completed') flushDb()"),
      'must call flushDb after finalise or completed write');
  });
});

/* ══════════════════════════════════════════════════════════════
   5. MAIN PROCESS — attendance-force-status handler
   ══════════════════════════════════════════════════════════════ */
describe('Main process — attendance-force-status handler', () => {

  it('handler exists', () => {
    assert.ok(mainJsSource.includes("ipcMain.handle('attendance-force-status'"),
      'must have force-status handler');
  });

  it('logs force_finalised action in audit', () => {
    const handlerStart = mainJsSource.indexOf("ipcMain.handle('attendance-force-status'");
    const handler = mainJsSource.substring(handlerStart, handlerStart + 1000);
    assert.ok(handler.includes('force_finalised'), 'must log force_finalised');
  });

  it('verifies the write and returns result', () => {
    const handlerStart = mainJsSource.indexOf("ipcMain.handle('attendance-force-status'");
    const handler = mainJsSource.substring(handlerStart, handlerStart + 1200);
    assert.ok(handler.includes('verify'), 'must verify the write');
    assert.ok(handler.includes("ok: true"), 'must return ok: true on success');
  });
});

/* ══════════════════════════════════════════════════════════════
   6. SYNC PULL — finalise guard
   ══════════════════════════════════════════════════════════════ */
describe('Sync pull — finalise guard', () => {

  const pullStart = mainJsSource.indexOf('async function syncPull');
  const pullFn = mainJsSource.substring(pullStart, pullStart + 12000);

  it('refuses to overwrite locally-finalised records with remote draft', () => {
    assert.ok(pullFn.includes("localStatus === 'finalised'"),
      'must check if local record is finalised');
    assert.ok(pullFn.includes("remote.status !== 'finalised'"),
      'must check if remote is not finalised');
    assert.ok(pullFn.includes('continue'),
      'must skip overwrite');
    assert.ok(pullFn.includes('BLOCKED'),
      'must log the block');
  });

  it('does NOT reference undeclared ctx variable', () => {
    const guardIdx = pullFn.indexOf("localStatus === 'finalised'");
    const guardBlock = pullFn.substring(guardIdx, pullFn.indexOf('continue', guardIdx));
    assert.ok(!guardBlock.includes('ctx'),
      'sync pull guard must NOT reference ctx (causes ReferenceError)');
  });

  it('uses dbGet directly for status lookup', () => {
    assert.ok(pullFn.includes("dbGet('SELECT status FROM attendances WHERE id=?', [local.id])"),
      'must use dbGet directly for local status lookup');
  });
});

/* ══════════════════════════════════════════════════════════════
   7. PRELOAD BRIDGE
   ══════════════════════════════════════════════════════════════ */
describe('Preload bridge', () => {

  it('exposes attendanceSave', () => {
    assert.ok(preloadSource.includes('attendanceSave'), 'must expose attendanceSave');
  });

  it('exposes attendanceGet', () => {
    assert.ok(preloadSource.includes('attendanceGet'), 'must expose attendanceGet');
  });

  it('exposes attendanceForceStatus', () => {
    assert.ok(preloadSource.includes('attendanceForceStatus'), 'must expose attendanceForceStatus');
  });

  it('exposes attendanceCheckDuplicate', () => {
    assert.ok(preloadSource.includes('attendanceCheckDuplicate'), 'must expose attendanceCheckDuplicate');
  });

  it('exposes backupStatus and reportEditorActivity', () => {
    assert.ok(preloadSource.includes('backupStatus'), 'must expose backupStatus');
    assert.ok(preloadSource.includes('reportEditorActivity'), 'must expose reportEditorActivity');
  });
});

/* ══════════════════════════════════════════════════════════════
   8. TOAST / CONFIRM — rendering
   ══════════════════════════════════════════════════════════════ */
describe('Toast / Confirm rendering', () => {

  it('showConfirm uses pre-line whitespace for message', () => {
    assert.ok(toastSource.includes("whiteSpace") || toastSource.includes("white-space"),
      'showConfirm must set white-space on message paragraph');
    assert.ok(toastSource.includes("pre-line"),
      'must use pre-line to render newlines');
  });

  it('showConfirm returns a Promise', () => {
    const confirmBody = extractFunctionBody(toastSource, 'showConfirm');
    assert.ok(confirmBody, 'showConfirm must exist');
    assert.ok(confirmBody.includes('new Promise'), 'must return a Promise');
  });

  it('confirm dialog has Cancel and OK buttons', () => {
    const confirmBody = extractFunctionBody(toastSource, 'showConfirm');
    assert.ok(confirmBody.includes("'Cancel'"), 'must have Cancel button');
    assert.ok(confirmBody.includes("'OK'"), 'must have OK button');
  });

  it('confirm resolves true on OK, false on Cancel', () => {
    const confirmBody = extractFunctionBody(toastSource, 'showConfirm');
    assert.ok(confirmBody.includes('done(true)'), 'OK must resolve true');
    assert.ok(confirmBody.includes('done(false)'), 'Cancel must resolve false');
  });
});

/* ══════════════════════════════════════════════════════════════
   9. VALIDATION FUNCTIONS
   ══════════════════════════════════════════════════════════════ */
describe('Validation functions', () => {

  it('validateAttendanceForm always requires outcomeDecision', () => {
    const vafBody = extractFunctionBody(appJsSource, 'validateAttendanceForm');
    assert.ok(vafBody, 'validateAttendanceForm must exist');
    assert.ok(vafBody.includes("key: 'outcomeDecision'"), 'outcomeDecision must be in the required list');
  });

  it('validateTelephoneForm uses telCaseConcluded for concluded-only fields', () => {
    const vtfBody = extractFunctionBody(appJsSource, 'validateTelephoneForm');
    assert.ok(vtfBody, 'validateTelephoneForm must exist');
    assert.ok(vtfBody.includes('telCaseConcluded'), 'must use telCaseConcluded');
    assert.ok(vtfBody.includes("key: 'outcomeDecision'"), 'telephone outcomeDecision must be required');
  });

  it('validateVoluntaryForm requires outcomeDecision only when concluded', () => {
    const vvfBody = extractFunctionBody(appJsSource, 'validateVoluntaryForm');
    assert.ok(vvfBody, 'validateVoluntaryForm must exist');
    assert.ok(vvfBody.includes('volCaseConcluded'), 'must use volCaseConcluded');
  });
});

/* ══════════════════════════════════════════════════════════════
  10. BUTTON HANDLERS
   ══════════════════════════════════════════════════════════════ */
describe('Finalise button handlers', () => {

  it('form-finalise button triggers validateBeforeFinalise', () => {
    const btnBlock = appJsSource.substring(
      appJsSource.indexOf("case 'form-finalise':"),
      appJsSource.indexOf("case 'form-finalise':") + 100
    );
    assert.ok(btnBlock.includes('validateBeforeFinalise()'),
      'form-finalise must call validateBeforeFinalise');
  });

  it('executePrimaryRecordAction centralises header Finalise / Finish / Archive', () => {
    assert.ok(appJsSource.includes('function executePrimaryRecordAction'));
    assert.ok(appJsSource.includes("action === 'archive'"));
    assert.ok(appJsSource.includes('archiveCurrentMatterFromForm'));
  });

  it('form-finalise-bar button triggers validateBeforeFinalise', () => {
    const btnBlock = appJsSource.substring(
      appJsSource.indexOf("case 'form-finalise-bar':"),
      appJsSource.indexOf("case 'form-finalise-bar':") + 100
    );
    assert.ok(btnBlock.includes('validateBeforeFinalise()'),
      'form-finalise-bar must call validateBeforeFinalise');
  });

  it('validation-finalise-anyway handler still exists as fallback', () => {
    assert.ok(appJsSource.includes("'validation-finalise-anyway'"),
      'validation-finalise-anyway handler must still exist as fallback');
  });
});

/* ══════════════════════════════════════════════════════════════
  11. DEBUG PANEL
   ══════════════════════════════════════════════════════════════ */
describe('Debug panel', () => {

  it('Ctrl+Shift+D opens diagnostics panel', () => {
    assert.ok(appJsSource.includes("e.ctrlKey && e.shiftKey && e.key === 'D'"),
      'must have Ctrl+Shift+D shortcut');
  });

  it('debug panel shows finalise tracking data', () => {
    const populateBody = extractFunctionBody(appJsSource, 'populateDiagnosticsPanel');
    assert.ok(populateBody, 'populateDiagnosticsPanel must exist');
    assert.ok(populateBody.includes('_lastFinaliseAttempt'),
      'must show last finalise attempt');
    assert.ok(populateBody.includes('_lastFinaliseResult'),
      'must show last finalise result');
    assert.ok(populateBody.includes('_lastDbWrite'),
      'must show last DB write');
    assert.ok(populateBody.includes('currentRecordStatus'),
      'must show current record status');
    assert.ok(populateBody.includes('_finalising'),
      'must show finalising state');
  });

  it('debug panel exports diagnostics to clipboard', () => {
    assert.ok(appJsSource.includes('sync-diag-export'),
      'must have export button');
    assert.ok(appJsSource.includes('clipboard.writeText'),
      'must copy to clipboard');
  });
});

/* ══════════════════════════════════════════════════════════════
  12. STALE WRITE PROTECTION
   ══════════════════════════════════════════════════════════════ */
describe('Stale write protection', () => {

  it('main.js increments sync_version on every update', () => {
    const handler = mainJsSource.substring(
      mainJsSource.indexOf("ipcMain.handle('attendance-save'"),
      mainJsSource.indexOf("ipcMain.handle('attendance-save'") + 4000
    );
    const versionIncrements = (handler.match(/sync_version \|\| 1\) \+ 1/g) || []).length;
    assert.ok(versionIncrements >= 1, 'must increment sync_version');
  });

  it('markDbDirty notifies backup scheduler', () => {
    const markBody = extractFunctionBody(mainJsSource, 'markDbDirty');
    assert.ok(markBody, 'markDbDirty must exist');
    assert.ok(markBody.includes('_backupScheduler') || markBody.includes('bs.markDirty'),
      'must notify backup scheduler');
  });

  it('flushDb persists immediately without debounce', () => {
    const flushBody = extractFunctionBody(mainJsSource, 'flushDb');
    assert.ok(flushBody, 'flushDb must exist');
    assert.ok(flushBody.includes('clearTimeout(_dbSaveTimer)'),
      'flushDb must clear pending save timer');
    assert.ok(flushBody.includes('saveDb()'),
      'flushDb must call saveDb directly');
  });
});

/* ══════════════════════════════════════════════════════════════
  13. BACKUP SCHEDULER INTEGRATION
   ══════════════════════════════════════════════════════════════ */
describe('Backup scheduler integration', () => {

  it('main.js uses createBackupScheduler', () => {
    assert.ok(mainJsSource.includes('createBackupScheduler'),
      'must use createBackupScheduler');
  });

  it('no 2-minute setInterval for backups', () => {
    assert.ok(!mainJsSource.includes('setInterval(runQuickBackup, 2 * 60 * 1000)'),
      'must NOT have 2-minute setInterval');
  });
});

/* ══════════════════════════════════════════════════════════════
  14. EDGE CASES
   ══════════════════════════════════════════════════════════════ */
describe('Edge cases', () => {

  it('showView list clears _finalising flag', () => {
    const showViewBody = extractFunctionBody(appJsSource, 'showView');
    assert.ok(showViewBody, 'showView must exist');
    assert.ok(showViewBody.includes("_finalising = false"),
      'navigating to list must reset _finalising');
  });

  it('showView home clears _finalising flag', () => {
    const showViewBody = extractFunctionBody(appJsSource, 'showView');
    const homeLine = showViewBody.substring(
      showViewBody.indexOf("name === 'home'"),
      showViewBody.indexOf("name === 'home'") + 100
    );
    assert.ok(homeLine.includes('_finalising = false'),
      'navigating to home must reset _finalising');
  });

  it('scheduleQuietSave reports editor activity', () => {
    const sqsBody = extractFunctionBody(appJsSource, 'scheduleQuietSave');
    assert.ok(sqsBody, 'scheduleQuietSave must exist');
    assert.ok(sqsBody.includes('reportEditorActivity'),
      'must report editor activity');
  });

  it('hasMeaningfulData checks identity fields', () => {
    const hmdBody = extractFunctionBody(appJsSource, 'hasMeaningfulData');
    assert.ok(hmdBody, 'hasMeaningfulData must exist');
    assert.ok(hmdBody.includes('surname'), 'must check surname');
    assert.ok(hmdBody.includes('forename'), 'must check forename');
  });
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { buildSaveNowUserMessage } = require('../lib/saveNowResult');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('Save now — durable disk + backup', () => {
  it('persist-and-backup IPC uses flushDbSync then verified backup', () => {
    const idx = mainJs.indexOf("ipcMain.handle('persist-and-backup'");
    assert.ok(idx > 0, 'persist-and-backup handler must exist');
    const chunk = mainJs.slice(idx, idx + 5500);
    assert.match(chunk, /flushDbSync\(\)/);
    assert.match(chunk, /runManualVerifiedBackup/);
    assert.match(chunk, /noteDurable/);
    assert.match(chunk, /backupOk/);
    assert.match(chunk, /drainPendingSyncUploads|centralConfirmed/);
    assert.doesNotMatch(chunk, /flushDb\(\);\s*\n\s*await new Promise/);
  });

  it('flush-and-backup no longer fire-and-forgets async flush only', () => {
    const idx = mainJs.indexOf("ipcMain.handle('flush-and-backup'");
    const chunk = mainJs.slice(idx, idx + 1800);
    assert.match(chunk, /flushDbSync\(\)/);
    assert.match(chunk, /runManualVerifiedBackup|backupOk/);
  });

  it('Save now fails loudly when backup path invalid (structured result)', () => {
    const warn = buildSaveNowUserMessage({
      noteDurable: true,
      backupOk: false,
      error: 'Backup folder is not writable: /Users/x/Backups',
      effectiveBackupFolder: 'C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups',
    });
    assert.strictEqual(warn.level, 'warning');
    assert.match(warn.message, /Safe locally/i);
    assert.match(warn.message, /backup failed/i);

    const fail = buildSaveNowUserMessage({
      noteDurable: false,
      backupOk: false,
      error: 'Disk flush failed',
    });
    assert.strictEqual(fail.level, 'error');
    assert.match(fail.message, /Could not save note to disk/);

    const ok = buildSaveNowUserMessage({
      noteDurable: true,
      backupOk: true,
      backupPath: 'C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups\\attendance-backup-x.db',
      effectiveBackupFolder: 'C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups',
    });
    assert.strictEqual(ok.level, 'success');
    assert.match(ok.message, /Safe locally/);
    assert.match(ok.message, /Backup written to|Central confirmation/i);
  });

  it('UI exposes Save now control and Ctrl+S routes to it', () => {
    assert.match(indexHtml, /Save now/);
    assert.match(appJs, /handleSaveNowClick/);
    assert.match(appJs, /persistAndBackup/);
    assert.match(preloadJs, /persistAndBackup/);
    const kbIdx = appJs.indexOf("modPressed(e) && e.key === 's'");
    assert.ok(kbIdx > 0);
    assert.match(appJs.slice(kbIdx, kbIdx + 900), /handleSaveNowClick|persistAndBackup/);
  });

  it('dirty indicator clears only after successful disk write', () => {
    assert.match(appJs, /markFormDirtyForDiskIndicator/);
    assert.match(appJs, /Unsaved changes/);
    assert.match(appJs, /Safe locally|Saved to disk/);
    const showIdx = appJs.indexOf('function showAutoSaveIndicator');
    const showBody = appJs.slice(showIdx, showIdx + 2000);
    assert.match(showBody, /dirty/);
    assert.match(showBody, /_lastDbWrite/);
    // scheduleQuietSave marks dirty before debounce completes
    const schedIdx = appJs.indexOf('function scheduleQuietSave');
    assert.match(appJs.slice(schedIdx, schedIdx + 400), /markFormDirtyForDiskIndicator/);
  });

  it('runManualVerifiedBackup verifies and notifies on failure', () => {
    assert.match(mainJs, /async function runManualVerifiedBackup/);
    assert.match(mainJs, /_verifyBackupOrThrow/);
    assert.match(mainJs, /_notifyBackupDegraded/);
  });
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  assessBackupPathUsability,
  planBackupFolderReset,
} = require('../lib/backupPathSanitize');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

describe('backup path cross-platform sanitize', () => {
  it('rejects Mac userData path on Windows', () => {
    const a = assessBackupPathUsability(
      '/Users/robertcashman/Library/Application Support/custody-note/Backups',
      { platform: 'win32' }
    );
    assert.strictEqual(a.usable, false);
    assert.strictEqual(a.reason, 'unix_path_on_windows');
  });

  it('rejects Windows drive path on darwin', () => {
    const a = assessBackupPathUsability('C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups', {
      platform: 'darwin',
    });
    assert.strictEqual(a.usable, false);
    assert.strictEqual(a.reason, 'windows_path_on_unix');
  });

  it('plans reset to local default after foreign-OS restore', () => {
    const plan = planBackupFolderReset({
      storedPath: '/Users/robertcashman/Library/Application Support/custody-note/Backups',
      defaultPath: 'C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups',
      platform: 'win32',
      canCreate: () => true,
    });
    assert.strictEqual(plan.reset, true);
    assert.ok(plan.next.includes('AppData') || plan.next.includes('custody-note'));
  });

  it('keeps usable local path', () => {
    const plan = planBackupFolderReset({
      storedPath: 'C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups',
      defaultPath: 'C:\\Users\\Robert\\AppData\\Roaming\\custody-note\\Backups',
      platform: 'win32',
      canCreate: () => true,
    });
    assert.strictEqual(plan.reset, false);
  });
});

describe('generational quick backups + visible degradation', () => {
  it('quick backup writes attendance-quick generational files', () => {
    assert.match(mainJs, /attendance-quick-/);
    assert.match(mainJs, /pruneOldQuickBackups/);
    assert.match(mainJs, /MAX_QUICK_BACKUPS/);
    assert.match(mainJs, /generationalQuick:\s*true/);
  });

  it('main.js wires ~2 minute quick interval (not 30 min override)', () => {
    const idx = mainJs.indexOf('function getBackupScheduler');
    assert.ok(idx > 0);
    const chunk = mainJs.slice(idx, idx + 900);
    assert.match(chunk, /quickMinIntervalMs:\s*2 \* 60 \* 1000/);
    assert.doesNotMatch(chunk, /quickMinIntervalMs:\s*30 \* 60 \* 1000/);
    const sched = fs.readFileSync(path.join(__dirname, '..', 'main', 'backupScheduler.js'), 'utf8');
    assert.match(sched, /2 \* 60 \* 1000/);
  });

  it('skipped/failed backup notifies renderer (no silent skip)', () => {
    assert.match(mainJs, /_notifyBackupDegraded/);
    assert.match(mainJs, /backup-degraded/);
    assert.match(preloadJs, /onBackupDegraded/);
    assert.match(appJs, /home-backup-degraded/);
    assert.match(indexHtml, /home-backup-degraded/);
  });

  it('Settings exposes effective backup paths and open-folder', () => {
    assert.match(mainJs, /effectiveBackupFolder/);
    assert.match(mainJs, /backup-open-folder/);
    assert.match(preloadJs, /backupOpenFolder/);
    assert.match(indexHtml, /setting-backup-open-folder/);
    assert.match(indexHtml, /settings-backup-effective-meta/);
    assert.match(appJs, /refreshBackupEffectivePaths/);
  });

  it('ensureBackupPathsSane runs on initDb, get-settings, unlock, and restore', () => {
    assert.match(mainJs, /function ensureBackupPathsSane/);
    const initIdx = mainJs.indexOf('async function initDb');
    const chunk = mainJs.slice(initIdx, initIdx + 6000);
    assert.match(chunk, /ensureBackupPathsSane/);
    const getSettingsIdx = mainJs.indexOf("ipcMain.handle('get-settings'");
    assert.match(mainJs.slice(getSettingsIdx, getSettingsIdx + 800), /ensureBackupPathsSane/);
    const unlockIdx = mainJs.indexOf("ipcMain.handle('session-unlock'");
    assert.match(mainJs.slice(unlockIdx, unlockIdx + 700), /ensureBackupPathsSane/);
    const localRestoreIdx = mainJs.indexOf("ipcMain.handle('local-backup-restore'");
    assert.ok(localRestoreIdx > 0);
    assert.match(mainJs.slice(localRestoreIdx, localRestoreIdx + 4500), /ensureBackupPathsSane/);
    const cloudRestoreIdx = mainJs.indexOf("ipcMain.handle('cloud-backup-restore'");
    assert.ok(cloudRestoreIdx > 0);
    assert.match(mainJs.slice(cloudRestoreIdx, cloudRestoreIdx + 4500), /ensureBackupPathsSane/);
  });

  it('path correction notice persists until acknowledged', () => {
    assert.match(mainJs, /backupPathCorrectionNotice/);
    assert.match(mainJs, /_persistBackupPathCorrectionNotice/);
    assert.match(indexHtml, /settings-backup-path-ack/);
    assert.match(appJs, /settings-backup-path-ack/);
    assert.doesNotMatch(
      appJs.slice(appJs.indexOf('onBackupPathCorrected'), appJs.indexOf('onBackupPathCorrected') + 500),
      /backupAcknowledgePathCorrection\(\)\.catch/
    );
  });

  it('Settings always shows last success and last failure', () => {
    assert.match(indexHtml, /settings-backup-last-status/);
    assert.match(appJs, /Last success:/);
    assert.match(appJs, /Last failure:/);
  });
});

describe('backup every N minutes — retention around local-only dirty save', () => {
  it('scheduler keeps firing quick backups for dirty local state that never synced', async () => {
    // Simulate: attendance saved locally (sync_dirty) but cloud never ack'd.
    // Backup scheduler must still take generational snapshots on the N-minute cadence.
    const { createBackupScheduler } = require('../main/backupScheduler');
    const calls = [];
    let nowMs = 0;
    let nextId = 1;
    const timers = new Map();
    const setTimer = (fn, delay) => {
      const id = nextId++;
      timers.set(id, { id, fn, runAt: nowMs + Math.max(0, delay || 0) });
      return id;
    };
    const clearTimer = (id) => { timers.delete(id); };
    const tick = async (ms) => {
      nowMs += ms;
      let progressed = true;
      while (progressed) {
        progressed = false;
        const due = [...timers.values()].filter((t) => t.runAt <= nowMs).sort((a, b) => a.runAt - b.runAt);
        for (const timer of due) {
          timers.delete(timer.id);
          progressed = true;
          await timer.fn();
        }
      }
    };

    const generations = [];
    const MAX_KEEP = 3;
    const scheduler = createBackupScheduler({
      now: () => nowMs,
      setTimer,
      clearTimer,
      quickMinIntervalMs: 2 * 60 * 1000,
      userIdleGraceMs: 0,
      periodicCheckMs: 30 * 1000,
      runBackup: async (kind) => {
        calls.push({ kind, at: nowMs, syncDirty: true, cloudAcked: false });
        // Emulate generational retention: keep last MAX_KEEP quick snapshots.
        if (kind === 'quick') {
          generations.push(`attendance-quick-${nowMs}.db`);
          while (generations.length > MAX_KEEP) generations.shift();
        }
        return {
          bytes: 4096,
          durationMs: 5,
          verified: true,
          verifiedAt: new Date(nowMs).toISOString(),
          generationalPath: generations[generations.length - 1],
        };
      },
    });

    scheduler.markDirty('local-save-never-cloud');
    await tick(0);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].kind, 'quick');
    assert.strictEqual(calls[0].cloudAcked, false);

    // Three more quick cycles at 2-minute cadence.
    for (let i = 0; i < 3; i++) {
      scheduler.markDirty('still-dirty-local-only');
      await tick(2 * 60 * 1000);
    }
    assert.ok(calls.length >= 4, 'expected repeated quick backups while dirty and unsynced');
    assert.ok(calls.every((c) => c.syncDirty && c.cloudAcked === false));
    assert.strictEqual(generations.length, MAX_KEEP, 'retention must prune older quick gens');
    assert.ok(generations.every((n) => n.startsWith('attendance-quick-')));
    scheduler.dispose();
  });
});

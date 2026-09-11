'use strict';

/**
 * Footer sync/backup chip honesty — Framework12 never-event UX.
 * Covers sticky "Backup queued", false "Local only — check sync", and AWS entitlement wording.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  deriveSyncFooterChip,
  deriveBackupFooterChip,
  deriveManagedCloudBackupFooterChip,
} = require('../lib/footerStatusChips');
const {
  isSyncStatusHealthy,
  shouldSuppressSyncedFooter,
  deriveSyncPhase,
} = require('../lib/syncRecoveryHints');
const { createBackupScheduler } = require('../main/backupScheduler');
const { createSyncWorker } = require('../main/syncWorker');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const syncWorkerJs = fs.readFileSync(path.join(root, 'main/syncWorker.js'), 'utf8');

describe('Healthy local + synced outbox — no panic sync chip', () => {
  const healthyPullOnly = {
    totalRecords: 67,
    pendingChanges: 0,
    dirtyPushCount: 0,
    failedCount: 0,
    lastPullReceived: 0,
    pullEverCompleted: true,
    pulledFromEpoch: false,
    lastVerifiedCloudInventory: 67,
    lastVerifiedCloudPushAt: '2026-09-10T12:00:00.000Z',
    lastPushOk: null, // never pushed this session — not a failure
    lastError: null,
    inProgress: false,
    rateLimited: false,
  };

  it('isSyncStatusHealthy for incremental received=0 with known inventory', () => {
    assert.strictEqual(isSyncStatusHealthy(healthyPullOnly), true);
    assert.strictEqual(shouldSuppressSyncedFooter(healthyPullOnly), false);
    assert.strictEqual(deriveSyncPhase(healthyPullOnly), 'synced');
  });

  it('does not treat default lastPush.ok=false with clear outbox as unhealthy', () => {
    const stickyDefaultFail = { ...healthyPullOnly, lastPushOk: false, lastError: 'old session error' };
    assert.strictEqual(isSyncStatusHealthy(stickyDefaultFail), true);
    assert.strictEqual(deriveSyncPhase(stickyDefaultFail), 'synced');
  });

  it('footer shows Synced — not Local only / Sync needs attention — for healthy pull-only', () => {
    const chip = deriveSyncFooterChip({
      enabled: true,
      lastSync: '2026-09-10T12:57:00.000Z',
      pendingChanges: 0,
      dirtyPushCount: 0,
      failedCount: 0,
      blockedCount: 0,
      conflictCount: 0,
      totalRecords: 67,
      lastPull: { received: 0, merged: 0, at: '2026-09-10T12:57:00.000Z', pulledFromEpoch: false },
      suppressSyncedFooter: false,
      syncHealthy: true,
      emptyCloudAlarm: false,
      lastPush: { ok: null },
    });
    assert.match(chip.text, /^Synced /);
    assert.strictEqual(chip.variant, 'synced');
    assert.doesNotMatch(chip.text, /Local only|check sync|needs attention/i);
  });

  it('still surfaces real push failure with pending outbox', () => {
    assert.strictEqual(
      isSyncStatusHealthy({
        ...healthyPullOnly,
        pendingChanges: 3,
        dirtyPushCount: 3,
        lastPushOk: false,
        lastError: 'Too many requests',
      }),
      false
    );
    const chip = deriveSyncFooterChip({
      enabled: true,
      pendingChanges: 3,
      dirtyPushCount: 0,
      failedCount: 0,
      blockedCount: 0,
      conflictCount: 0,
      totalRecords: 67,
      lastPull: { received: 0, merged: 0 },
      lastPush: { ok: false, error: 'Network error' },
      syncHealthy: false,
    });
    assert.match(chip.text, /not confirmed in cloud|pending/);
    assert.strictEqual(chip.variant, 'offline');
  });

  it('still surfaces empty-cloud as Cloud empty — re-upload', () => {
    const chip = deriveSyncFooterChip({
      enabled: true,
      totalRecords: 67,
      pendingChanges: 0,
      dirtyPushCount: 0,
      emptyCloudAlarm: true,
      emptyCloudAlarmMessage: 'Use Re-upload all',
      lastSync: '2026-09-10T12:00:00.000Z',
      lastPull: { received: 0, merged: 0, pulledFromEpoch: true },
      syncHealthy: false,
      suppressSyncedFooter: true,
    });
    assert.strictEqual(chip.text, 'Cloud empty — re-upload');
    assert.strictEqual(chip.variant, 'offline');
  });
});

describe('Backup footer — successful local backup clears queued panic', () => {
  it('hourlyDirty alone after successful quick backup shows Backed up not Backup queued', () => {
    const chip = deriveBackupFooterChip({
      state: 'idle',
      quickDirty: false,
      hourlyDirty: true,
      lastSuccessAt: '2026-09-10T12:57:00.000Z',
      lastBackupKind: 'quick',
      offsiteBackupFolder: 'C:\\Users\\rober\\OneDrive',
    });
    assert.strictEqual(chip.handled, true);
    assert.strictEqual(chip.text, 'Backed up');
    assert.strictEqual(chip.variant, 'backup-ok');
    assert.match(chip.title, /hourly/i);
  });

  it('quickDirty still shows Backup queued', () => {
    const chip = deriveBackupFooterChip({
      state: 'scheduled',
      quickDirty: true,
      hourlyDirty: true,
      lastSuccessAt: '2026-09-10T11:00:00.000Z',
    });
    assert.strictEqual(chip.text, 'Backup queued');
    assert.strictEqual(chip.variant, 'backup-active');
  });

  it('backup degraded / folder missing still surfaces clearly', () => {
    const deg = deriveBackupFooterChip({
      state: 'error',
      lastError: 'disk full',
      lastDegradedReason: 'export-failed',
      quickDirty: true,
      hourlyDirty: true,
    });
    assert.strictEqual(deg.text, 'Backup degraded');
    assert.strictEqual(deg.variant, 'offline');

    const missing = deriveBackupFooterChip({
      state: 'idle',
      quickDirty: true,
      hourlyDirty: true,
      lastSkipReason: 'backup-folder-missing',
    });
    assert.strictEqual(missing.text, 'Backup folder missing');
    assert.strictEqual(missing.variant, 'offline');
  });

  it('scheduler: after quick backup, quickDirty clears and footer would not stay queued', async () => {
    let nowMs = 0;
    let nextId = 1;
    const timers = new Map();
    function setTimer(fn, delay) {
      const id = nextId++;
      timers.set(id, { id, fn, runAt: nowMs + Math.max(0, delay || 0) });
      return id;
    }
    function clearTimer(id) { timers.delete(id); }
    async function tick(ms) {
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
    }
    const scheduler = createBackupScheduler({
      now: () => nowMs,
      setTimer,
      clearTimer,
      quickMinIntervalMs: 10_000,
      hourlyIntervalMs: 60_000,
      userIdleGraceMs: 0,
      periodicCheckMs: 2_000,
      runBackup: async (kind) => ({ bytes: 100, durationMs: 10, verified: true }),
    });
    scheduler.markDirty('edit');
    await tick(0);
    const s = scheduler.getStatus();
    assert.strictEqual(s.quickDirty, false, 'quick dirty cleared');
    assert.strictEqual(s.hourlyDirty, true, 'hourly still due');
    assert.strictEqual(s.lastBackupAt, 0, 'lastBackupAt recorded at t=0 harness clock');
    assert.strictEqual(s.lastBackupKind, 'quick');
    const chip = deriveBackupFooterChip({
      ...s,
      lastSuccessAt: s.lastBackupAt,
      state: s.state,
    });
    assert.strictEqual(chip.text, 'Backed up');
    assert.notStrictEqual(chip.text, 'Backup queued');
  });
});

describe('Managed AWS entitlement chip — not sync panic', () => {
  it('uses Local backups (informational) when entitlement off', () => {
    const chip = deriveManagedCloudBackupFooterChip({ enabled: false });
    assert.strictEqual(chip.text, 'Local backups');
    assert.strictEqual(chip.variant, 'backup-ok');
    assert.doesNotMatch(chip.text, /^Local only$/);
  });

  it('uses AWS backup on when enabled', () => {
    const chip = deriveManagedCloudBackupFooterChip({ enabled: true, lastSuccess: '2026-09-10' });
    assert.strictEqual(chip.text, 'AWS backup on');
    assert.strictEqual(chip.variant, 'backup-ok');
  });
});

describe('Wiring + worker defaults', () => {
  it('index.html loads footerStatusChips and defaults Local backups', () => {
    assert.match(indexHtml, /footerStatusChips\.js/);
    assert.match(indexHtml, /Local backups/);
    assert.doesNotMatch(indexHtml, />Local only</);
  });

  it('app.js uses FooterStatusChips helpers and drops Local only — check sync', () => {
    assert.match(appJs, /FooterStatusChips\.deriveSyncFooterChip/);
    assert.match(appJs, /FooterStatusChips\.deriveBackupFooterChip/);
    assert.match(appJs, /FooterStatusChips\.deriveManagedCloudBackupFooterChip/);
    assert.doesNotMatch(appJs, /Local only — check sync/);
    assert.doesNotMatch(appJs, /'Local only'/);
  });

  it('syncWorker initial lastPush.ok is null not false', () => {
    assert.match(syncWorkerJs, /ok:\s*null/);
    const rows = { sync_queue: [], settings: [], sync_conflicts: [] };
    const worker = createSyncWorker({
      db: {},
      dbGet: (sql) => {
        if (/COUNT/.test(sql) && /sync_queue/.test(sql)) return { c: 0 };
        if (/COUNT/.test(sql) && /sync_conflicts/.test(sql)) return { c: 0 };
        if (/lastSyncPullAt/.test(sql)) return null;
        return null;
      },
      dbAll: () => [],
      dbRun: () => {},
    });
    const diag = worker.getDiagnostics();
    assert.strictEqual(diag.lastPush.ok, null, 'never-attempted push must not look like a failure');
    assert.strictEqual(diag.lastError, null);
  });
});

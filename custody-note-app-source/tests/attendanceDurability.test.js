'use strict';

/**
 * Local-first durability + empty-cloud preserve autotests (1.9.85).
 * Covers Medway-class loss hypotheses without touching user data.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  emptyCloudPullPolicy,
  isDestructivePullOperation,
  assertPullBatchNonDestructive,
  fullResyncMayDestroyLocalOnly,
} = require('../lib/syncLocalPreserve');
const { verifyEncryptedBackupFile } = require('../lib/backupVerify');
const { buildLocalCloudIntegrityReport } = require('../lib/localCloudIntegrity');
const {
  buildAttendanceSaveLog,
  normalizeAttendanceSaveResult,
} = require('../lib/attendanceSaveResult');
const { MAGIC, encryptBuffer } = require('../lib/dbCrypto');
const { createBackupScheduler } = require('../main/backupScheduler');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

describe('Empty cloud must not wipe local-only', () => {
  it('emptyCloudPullPolicy preserves locals when cloud batch is empty', () => {
    const p = emptyCloudPullPolicy({ remoteRecords: [], localActiveCount: 66 });
    assert.strictEqual(p.preserveLocal, true);
    assert.strictEqual(p.mayWipeLocal, false);
    assert.strictEqual(p.reason, 'empty_cloud_keeps_local');
  });

  it('refuses hard_delete / wipe / unmatched delete operations', () => {
    assert.strictEqual(isDestructivePullOperation({ operation: 'hard_delete' }), true);
    assert.strictEqual(isDestructivePullOperation({ operation: 'wipe' }), true);
    assert.strictEqual(isDestructivePullOperation({ operation: 'delete', hasMatchingSyncId: false }), true);
    assert.strictEqual(
      isDestructivePullOperation({ operation: 'upsert', hasMatchingSyncId: true }),
      false
    );
    assert.throws(
      () => assertPullBatchNonDestructive([{ operation: 'wipe' }]),
      /REFUSING_DESTRUCTIVE_PULL/
    );
    assert.strictEqual(
      assertPullBatchNonDestructive([{ operation: 'upsert', hasMatchingSyncId: true }]),
      true
    );
  });

  it('Full re-sync must not destroy local-only', () => {
    assert.strictEqual(fullResyncMayDestroyLocalOnly(), false);
    assert.match(mainJs, /fullResyncMayDestroyLocalOnly\(\)/);
    assert.match(mainJs, /emptyCloudPullPolicy/);
    assert.match(mainJs, /assertPullBatchNonDestructive/);
  });
});

describe('Durable pendingSync / honest Saved to disk vs Synced', () => {
  it('attendance-save finishes with flushDbSync via finishAttendanceSaveResult', () => {
    assert.match(mainJs, /function finishAttendanceSaveResult/);
    const idx = mainJs.indexOf("ipcMain.handle('attendance-save'");
    assert.ok(idx > 0);
    const chunk = mainJs.slice(idx, idx + 12000);
    assert.match(chunk, /finishAttendanceSaveResult/);
    assert.match(chunk, /flushDbSync\(\)/);
    // Draft create/update paths must also return durable result (not bare id).
    assert.match(chunk, /finishAttendanceSaveResult\(newId/);
    assert.match(chunk, /finishAttendanceSaveResult\(existingId/);
  });

  it('save IPC result carries durable + pendingSync metadata', () => {
    const log = buildAttendanceSaveLog({
      id: 42,
      status: 'draft',
      durable: true,
      syncDirty: true,
      pendingSync: true,
    });
    assert.strictEqual(log.tag, 'SAVE');
    assert.strictEqual(log.durable, true);
    assert.strictEqual(log.pendingSync, true);
    assert.ok(!JSON.stringify(log).includes('Costache'));

    const n = normalizeAttendanceSaveResult({
      id: 7,
      durable: true,
      pendingSync: true,
      syncDirty: true,
    });
    assert.strictEqual(n.id, 7);
    assert.strictEqual(n.durable, true);
    assert.strictEqual(n.pendingSync, true);

    const legacy = normalizeAttendanceSaveResult(99);
    assert.strictEqual(legacy.id, 99);
    // Preload unwrap returns bare id; flush already ran in main — treat as durable.
    assert.strictEqual(legacy.durable, true);
  });

  it('preload attendanceSave unwraps to numeric id; detailed keeps durable meta', () => {
    const {
      coerceAttendanceId,
      unwrapAttendanceSaveForApi,
    } = require('../lib/attendanceSaveResult');
    assert.strictEqual(coerceAttendanceId({ id: 12, durable: true }), 12);
    assert.strictEqual(coerceAttendanceId(12), 12);
    assert.strictEqual(unwrapAttendanceSaveForApi({ id: 5, durable: true, pendingSync: true }), 5);
    assert.deepStrictEqual(
      unwrapAttendanceSaveForApi({ error: 'locked', message: 'finalised' }),
      { error: 'locked', message: 'finalised' }
    );
    const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    assert.match(preload, /attendanceSaveDetailed/);
    assert.match(preload, /if \(result\.error\) return result/);
    assert.match(preload, /if \(result\.id != null\) return result\.id/);
    assert.match(mainJs, /function coerceAttendanceIdArg/);
    assert.match(appJs, /function attendanceSaveDetailed/);
    assert.match(appJs, /attendanceSaveDetailed\(\{/);
  });

  it('renderer shows Safe locally with pending central sync, not false Synced', () => {
    assert.match(appJs, /Safe locally/);
    assert.match(appJs, /pending (central )?sync/);
    assert.match(appJs, /normalizeAttendanceSaveResult/);
    assert.match(appJs, /showAutoSaveIndicator\(\{ durable:/);
    assert.match(appJs, /Unsaved changes/);
  });
});

describe('Offline save / cloud fail / upgrade pending sync scenarios', () => {
  it('cloud fail after local save keeps sync_dirty semantics in worker ack', () => {
    // Push ack module still requires written count — dirty must remain if cloud fails.
    const ack = fs.readFileSync(path.join(__dirname, '..', 'lib', 'syncPushAck.js'), 'utf8');
    const worker = fs.readFileSync(path.join(__dirname, '..', 'main', 'syncWorker.js'), 'utf8');
    assert.match(ack, /written/);
    assert.match(worker, /assertPushAccepted/);
  });

  it('UTC/BST timestamps stay ISO (Z) on save path', () => {
    const idx = mainJs.indexOf("ipcMain.handle('attendance-save'");
    const chunk = mainJs.slice(idx, idx + 2000);
    assert.match(chunk, /toISOString\(\)/);
    // 7 Sep 2026 15:44 BST == 14:44 UTC
    const bst = new Date('2026-09-07T14:44:00.000Z');
    assert.strictEqual(bst.toISOString(), '2026-09-07T14:44:00.000Z');
    const londonOffsetHint = bst.toLocaleString('en-GB', { timeZone: 'Europe/London' });
    assert.ok(londonOffsetHint.includes('07') || londonOffsetHint.includes('7'));
  });

  it('integrity report flags local-present cloud-empty without auto-delete', () => {
    const report = buildLocalCloudIntegrityReport({
      localRows: [
        { syncId: 'a', syncDirty: true, status: 'draft' },
        { syncId: 'b', syncDirty: false, status: 'finalised' },
      ],
      cloudInventoryCount: 0,
      pulledFromEpoch: true,
      cloudSyncIds: [],
    });
    assert.strictEqual(report.autoDelete, false);
    assert.strictEqual(report.cloudEmptyProven, true);
    assert.strictEqual(report.localActive, 2);
    assert.ok(report.discrepancies.some((d) => d.code === 'local_present_cloud_empty'));
  });

  it('integrity checker IPC is wired and never auto-deletes', () => {
    assert.match(mainJs, /sync-integrity-check/);
    assert.match(preloadJs, /syncIntegrityCheck/);
    assert.match(appJs, /btn-sync-integrity-check/);
    const idx = mainJs.indexOf("ipcMain.handle('sync-integrity-check'");
    const chunk = mainJs.slice(idx, idx + 1500);
    assert.match(chunk, /autoDelete:\s*false/);
    assert.doesNotMatch(chunk, /DELETE FROM attendances/);
  });
});

describe('Backup multi-generation + verify', () => {
  it('verifyEncryptedBackupFile accepts CNDB magic and rejects garbage', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-bak-'));
    const good = path.join(dir, 'good.db');
    const bad = path.join(dir, 'bad.db');
    const key = Buffer.alloc(32, 7).toString('hex');
    const enc = encryptBuffer(Buffer.from('sqlite-bytes'), key);
    fs.writeFileSync(good, enc);
    fs.writeFileSync(bad, Buffer.from('NOTC'));
    const ok = verifyEncryptedBackupFile(good, { expectedBytes: enc.length });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.magicOk, true);
    const no = verifyEncryptedBackupFile(bad);
    assert.strictEqual(no.ok, false);
    assert.strictEqual(no.reason, 'bad_magic');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('main backup writers call verify and status surfaces success/failure', () => {
    assert.match(mainJs, /_verifyBackupOrThrow/);
    assert.match(mainJs, /verifyEncryptedBackupFile/);
    assert.match(mainJs, /latestFileVerified/);
    assert.match(mainJs, /lastSuccessAt/);
    assert.match(mainJs, /includesDirtyRecords:\s*true/);
    assert.match(mainJs, /multiGeneration:\s*true/);
  });

  it('scheduler records lastVerified from successful backup metrics', async () => {
    const events = [];
    const sched = createBackupScheduler({
      now: () => 1_000_000,
      setTimer: () => 1,
      clearTimer: () => {},
      runBackup: async () => ({
        durationMs: 10,
        bytes: 100,
        verified: true,
        verifiedAt: '2026-09-07T14:44:00.000Z',
      }),
      onStatusChange: (s) => events.push(s),
    });
    sched.markDirty('test');
    await sched.forceRun('test');
    const st = sched.getStatus();
    assert.strictEqual(st.lastVerified, true);
    assert.strictEqual(st.lastVerifiedAt, '2026-09-07T14:44:00.000Z');
    sched.dispose();
  });
});

describe('Soft-delete preference', () => {
  it('attendance-delete soft-deletes and flushes', () => {
    const idx = mainJs.indexOf("ipcMain.handle('attendance-delete'");
    const chunk = mainJs.slice(idx, idx + 900);
    assert.match(chunk, /deleted_at/);
    assert.match(chunk, /soft:\s*true/);
    assert.match(chunk, /flushDbSync\(\)/);
    assert.doesNotMatch(chunk, /DELETE FROM attendances WHERE id/);
  });
});

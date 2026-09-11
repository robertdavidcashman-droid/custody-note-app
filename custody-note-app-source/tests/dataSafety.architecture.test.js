'use strict';

/**
 * Data-safety acceptance suite — Force Save status, outbox idempotency,
 * absence≠delete, empty-cloud preserve, tombstones, monitors, backup gate.
 * Run via: npm run test:data-safety
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  FORCE_SAVE_STATES,
  resolveForceSaveState,
  buildForceSaveResult,
  isAmbiguousSavedLabel,
} = require('../lib/forceSaveStatus');
const { buildSaveNowUserMessage } = require('../lib/saveNowResult');
const {
  buildMutationId,
  mayClearOutboxEntry,
  isAmbiguousPushAck,
} = require('../lib/syncMutationId');
const {
  emptyCloudPullPolicy,
  assertPullBatchNonDestructive,
  fullResyncMayDestroyLocalOnly,
  evaluateTombstoneApply,
  staleDeviceAbsenceMayEraseCentral,
  wholeDatasetLastWriteWinsAllowed,
  remoteAbsenceImpliesLocalDelete,
} = require('../lib/syncLocalPreserve');
const {
  runDataSafetyMonitors,
  detectSuddenLocalCountDrop,
  detectRemoteDisappearWithoutTombstone,
  detectRevisionGoingBackwards,
  detectEmptyCloudWithLocal,
  detectMigrationShrink,
} = require('../lib/dataSafetyMonitors');
const {
  evaluateBackupSeriesIntegrity,
  mayRestoreBackupOverLive,
} = require('../lib/backupIntegrityGate');
const {
  hashRecordPayload,
  appendRecordRevision,
  listRecordRevisions,
} = require('../lib/recordRevisions');
const { assertPushAccepted, createRateLimitGate } = require('../lib/syncPushAck');
const { createSyncWorker } = require('../main/syncWorker');
const { MAGIC, encryptBuffer } = require('../lib/dbCrypto');
const { verifyEncryptedBackupFile } = require('../lib/backupVerify');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

describe('Force Save status model — local vs central', () => {
  it('never uses ambiguous Saved labels', () => {
    assert.strictEqual(isAmbiguousSavedLabel('Saved'), true);
    assert.strictEqual(isAmbiguousSavedLabel('Synced'), true);
    assert.strictEqual(isAmbiguousSavedLabel('Safe locally'), false);
    assert.strictEqual(isAmbiguousSavedLabel('Safe locally + central copy confirmed'), false);
  });

  it('maps durable-only to safe_locally (not central confirmed)', () => {
    assert.strictEqual(
      resolveForceSaveState({ noteDurable: true, backupOk: true, pendingCount: 1 }),
      FORCE_SAVE_STATES.SYNC_PROBLEM_LOCAL_SAFE
    );
    assert.strictEqual(
      resolveForceSaveState({ noteDurable: true, centralConfirmed: true, pendingCount: 0 }),
      FORCE_SAVE_STATES.SAFE_LOCALLY_CENTRAL_CONFIRMED
    );
    assert.strictEqual(
      resolveForceSaveState({ noteDurable: true, offline: true, pendingCount: 2 }),
      FORCE_SAVE_STATES.WAITING_FOR_INTERNET
    );
    assert.strictEqual(
      resolveForceSaveState({ noteDurable: false }),
      FORCE_SAVE_STATES.ATTENTION_REQUIRED
    );
  });

  it('buildForceSaveResult surfaces pending, device, timestamps', () => {
    const r = buildForceSaveResult({
      noteDurable: true,
      backupOk: true,
      centralConfirmed: true,
      pendingCount: 0,
      lastLocalSaveAt: '2026-09-10T10:00:00.000Z',
      lastCentralSyncAt: '2026-09-10T10:00:01.000Z',
      deviceId: 'abcdef1234567890',
    });
    assert.strictEqual(r.forceSaveState, FORCE_SAVE_STATES.SAFE_LOCALLY_CENTRAL_CONFIRMED);
    assert.match(r.userMessage.message, /central copy confirmed/i);
    assert.ok(!isAmbiguousSavedLabel(r.userMessage.message));
    assert.strictEqual(r.deviceId, 'abcdef1234567890');
  });

  it('Save now user message never says bare Saved', () => {
    const msg = buildSaveNowUserMessage({
      noteDurable: true,
      backupOk: true,
      centralConfirmed: false,
      pendingCount: 3,
      syncAttempted: true,
      syncError: 'network timeout',
      lastLocalSaveAt: '2026-09-10T11:00:00.000Z',
      deviceId: 'dev1',
    });
    assert.match(msg.message, /local/i);
    assert.ok(!/^saved$/i.test(msg.message.trim()));
    assert.notStrictEqual(msg.headline, 'Saved');
  });

  it('persist-and-backup attempts central drain and returns forceSaveState', () => {
    const idx = mainJs.indexOf("ipcMain.handle('persist-and-backup'");
    assert.ok(idx > 0);
    const chunk = mainJs.slice(idx, idx + 9000);
    assert.match(chunk, /buildForceSaveResult/);
    assert.match(chunk, /drainPendingSyncUploads/);
    assert.match(chunk, /centralConfirmed/);
    assert.match(chunk, /forceSaveState/);
    assert.match(chunk, /evaluatePostFlushDurability/);
    assert.match(chunk, /verifyEncryptedBackupFile/);
  });

  it('flushDbAsyncBounded restores dirty on timeout via flushDirtyPolicy', () => {
    assert.match(mainJs, /shouldRestoreDirtyAfterFlush/);
    assert.match(mainJs, /flushDbAsyncBounded/);
    const flushPolicy = fs.readFileSync(path.join(__dirname, '..', 'lib', 'flushDirtyPolicy.js'), 'utf8');
    assert.match(flushPolicy, /flush_timed_out/);
    assert.match(flushPolicy, /evaluatePostFlushDurability/);
  });

  it('UI avoids ✓ Saved button label after Force Save', () => {
    assert.doesNotMatch(appJs, /finishBtn\('\\u2713 Saved'/);
    assert.doesNotMatch(appJs, /finishBtn\('✓ Saved'/);
    assert.match(appJs, /Safe locally/);
    assert.match(appJs, /central copy confirmed|Central OK|centralConfirmed/);
  });
});

describe('Outbox survives restart — mutation IDs + ack gating', () => {
  it('mutationId is stable for same sync_id+version+op', () => {
    const a = buildMutationId({ syncId: 'sid-1', syncVersion: 3, operation: 'upsert' });
    const b = buildMutationId({ syncId: 'sid-1', syncVersion: 3, operation: 'upsert' });
    const c = buildMutationId({ syncId: 'sid-1', syncVersion: 4, operation: 'upsert' });
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
    assert.match(a, /^mut-sid-1-v3-upsert$/);
  });

  it('mayClearOutboxEntry requires confirmed written ack', () => {
    assert.strictEqual(mayClearOutboxEntry({ confirmed: true, written: 1, sentCount: 1 }), true);
    assert.strictEqual(mayClearOutboxEntry({ confirmed: true, written: 0, sentCount: 1 }), false);
    assert.strictEqual(mayClearOutboxEntry({ confirmed: true, ambiguous: true, written: 1, sentCount: 1 }), false);
    assert.strictEqual(mayClearOutboxEntry({ confirmed: false, written: 1, sentCount: 1 }), false);
    assert.strictEqual(mayClearOutboxEntry({ confirmed: true, written: null, sentCount: 1 }), false);
  });

  it('ambiguous ack is detected and must retry safely', () => {
    assert.strictEqual(isAmbiguousPushAck({ ok: true }, 2), true);
    assert.strictEqual(isAmbiguousPushAck({ ok: true, written: 2 }, 2), false);
    assert.strictEqual(isAmbiguousPushAck({ ok: false, error: 'fail' }, 2), false);
  });

  it('enqueue stores mutationId and never deletes syncing rows before ack', async () => {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE attendances (
      id INTEGER PRIMARY KEY, sync_id TEXT, sync_version INTEGER, sync_dirty INTEGER,
      data TEXT, status TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
    )`);
    db.run(`CREATE TABLE sync_queue (
      id TEXT PRIMARY KEY, record_id TEXT, operation TEXT, payload TEXT,
      created_at INTEGER, retry_count INTEGER, last_attempt INTEGER, status TEXT, error TEXT,
      mutation_id TEXT
    )`);
    db.run(`INSERT INTO attendances (id, sync_id, sync_version, sync_dirty, data, status)
            VALUES (1, 'abc', 2, 1, '{}', 'draft')`);

    const helpers = {
      db,
      dbRun: (sql, params) => { db.run(sql, params || []); },
      dbGet: (sql, params) => {
        const stmt = db.prepare(sql);
        stmt.bind(params || []);
        let row = null;
        if (stmt.step()) row = stmt.getAsObject();
        stmt.free();
        return row;
      },
      dbAll: (sql, params) => {
        const stmt = db.prepare(sql);
        stmt.bind(params || []);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
      flushDb: () => {},
      getSyncApiUrl: () => null,
      readLicenceData: () => null,
      getMachineId: () => 'test-machine',
    };
    const worker = createSyncWorker(helpers);
    const qid = worker.enqueue(1, 'upsert', {});
    assert.ok(qid);
    const row = helpers.dbGet('SELECT mutation_id, payload, status FROM sync_queue WHERE id=?', [qid]);
    assert.strictEqual(row.mutation_id, 'mut-abc-v2-upsert');
    assert.match(row.payload, /mutationId/);
    assert.strictEqual(row.status, 'pending');

    // Mid-push row must survive re-enqueue
    helpers.dbRun("UPDATE sync_queue SET status='syncing' WHERE id=?", [qid]);
    worker.enqueue(1, 'upsert', {});
    const syncing = helpers.dbGet("SELECT COUNT(*) as c FROM sync_queue WHERE status='syncing'");
    assert.strictEqual(syncing.c, 1);
  });

  it('assertPushAccepted refuses written:0 / omitted written', () => {
    assert.throws(() => assertPushAccepted({ ok: true, written: 0 }, 1), /0 records|incomplete/i);
    assert.throws(() => assertPushAccepted({ ok: true }, 1), /unconfirmed|omitted/i);
    assert.doesNotThrow(() => assertPushAccepted({ ok: true, written: 2 }, 2));
  });
});

describe('Absence ≠ delete · tombstones · no whole-DB LWW', () => {
  it('stale device absence cannot erase central / local', () => {
    assert.strictEqual(staleDeviceAbsenceMayEraseCentral(), false);
    assert.strictEqual(remoteAbsenceImpliesLocalDelete(), false);
    assert.strictEqual(wholeDatasetLastWriteWinsAllowed(), false);
    assert.strictEqual(fullResyncMayDestroyLocalOnly(), false);
  });

  it('empty cloud pull never wipes local', () => {
    const p = emptyCloudPullPolicy({ remoteRecords: [], localActiveCount: 12 });
    assert.strictEqual(p.mayWipeLocal, false);
    assert.strictEqual(p.preserveLocal, true);
    assert.throws(
      () => assertPullBatchNonDestructive([{ operation: 'wipe' }]),
      /REFUSING_DESTRUCTIVE_PULL/
    );
    assert.throws(
      () => assertPullBatchNonDestructive([{ operation: 'delete', hasMatchingSyncId: false }]),
      /REFUSING_DESTRUCTIVE_PULL/
    );
  });

  it('intentional tombstone requires matching sync_id + deletedAt', () => {
    assert.deepStrictEqual(
      evaluateTombstoneApply({ hasMatchingSyncId: false, remoteDeletedAt: '2026-01-01' }),
      { mayDeleteLocal: false, reason: 'absence_is_not_deletion' }
    );
    assert.deepStrictEqual(
      evaluateTombstoneApply({ hasMatchingSyncId: true, remoteDeletedAt: null }),
      { mayDeleteLocal: false, reason: 'no_remote_tombstone' }
    );
    assert.strictEqual(
      evaluateTombstoneApply({ hasMatchingSyncId: true, remoteDeletedAt: '2026-01-01' }).mayDeleteLocal,
      true
    );
  });

  it('main syncPull uses tombstone + revision-backwards gates', () => {
    assert.match(mainJs, /evaluateTombstoneApply/);
    assert.match(mainJs, /detectRevisionGoingBackwards/);
    assert.match(mainJs, /appendRecordRevision/);
  });
});

describe('Fail-safe monitors', () => {
  it('detects sudden local count drop and refuses overwrite', () => {
    const d = detectSuddenLocalCountDrop({ previousActiveCount: 40, currentActiveCount: 5 });
    assert.strictEqual(d.triggered, true);
    assert.strictEqual(d.failSafe, 'retain_local_do_not_overwrite');
  });

  it('detects remote disappear without tombstone', () => {
    const d = detectRemoteDisappearWithoutTombstone({
      previouslyKnownSyncIds: ['a', 'b', 'c'],
      currentRemoteSyncIds: ['a'],
      tombstonedSyncIds: ['b'],
    });
    assert.strictEqual(d.triggered, true);
    assert.deepStrictEqual(d.missingSample, ['c']);
  });

  it('detects revision going backwards on apply', () => {
    const d = detectRevisionGoingBackwards({
      localVersion: 5,
      remoteVersion: 3,
      applyingRemote: true,
    });
    assert.strictEqual(d.triggered, true);
  });

  it('detects empty cloud with local + migration shrink', () => {
    const empty = detectEmptyCloudWithLocal({
      localActiveCount: 10,
      lastVerifiedCloudInventory: 0,
      pulledFromEpoch: true,
      pullEverCompleted: true,
      lastPullReceived: 0,
    });
    assert.strictEqual(empty.triggered, true);
    const shrink = detectMigrationShrink({ beforeCount: 100, afterCount: 50 });
    assert.strictEqual(shrink.triggered, true);
  });

  it('runDataSafetyMonitors aggregates fail-safe', () => {
    const r = runDataSafetyMonitors({
      previousActiveCount: 20,
      currentActiveCount: 0,
      localActiveCount: 20,
      lastVerifiedCloudInventory: 0,
      pulledFromEpoch: true,
      rateLimited: true,
      masterKeyMissing: true,
    });
    assert.strictEqual(r.failSafe, true);
    assert.strictEqual(r.mayOverwriteKnownGood, false);
    assert.strictEqual(r.retainLocal, true);
    assert.ok(r.findings.length >= 2);
  });
});

describe('Independent PITR / backup integrity gate', () => {
  it('refuses empty backup restore over live data', () => {
    const gate = mayRestoreBackupOverLive(
      { readable: true, magicOk: true, activeCount: 0 },
      { activeCount: 12 }
    );
    assert.strictEqual(gate.allowed, false);
    assert.strictEqual(gate.reason, 'refuse_empty_over_live');
  });

  it('evaluates series sudden drop / unreadable', () => {
    const r = evaluateBackupSeriesIntegrity({
      backupFiles: [
        { name: 'attendance-quick-1.db', readable: true, magicOk: true, activeCount: 2 },
      ],
      liveActiveCount: 40,
      lastKnownGoodActiveCount: 40,
    });
    assert.strictEqual(r.independentFromCentralSoT, true);
    assert.strictEqual(r.mayRestoreEmptyOverLive, false);
    assert.ok(r.findings.some((f) => f.code === 'backup_count_sudden_drop' || f.code === 'backup_empty_while_live_has_data'));
  });

  it('verifies real encrypted backup file magic', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-bak-'));
    const key = crypto.randomBytes(32);
    const plain = Buffer.from('SQLite format 3\0fake-db-bytes-for-test-xxxxxxxxxxxx');
    const enc = encryptBuffer(plain, key);
    const file = path.join(dir, 'attendance-quick-test.db');
    fs.writeFileSync(file, enc);
    const v = verifyEncryptedBackupFile(file);
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.magicOk, true);
    assert.ok(enc.slice(0, 4).equals(Buffer.from(MAGIC)));
  });
});

describe('Record revisions (overwrite recovery metadata)', () => {
  it('appends distinct content hashes and lists metadata only', async () => {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE record_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, attendance_id INTEGER, sync_id TEXT,
      sync_version INTEGER, status TEXT, content_hash TEXT, deleted_at TEXT,
      source TEXT, created_at TEXT
    )`);
    const ctx = {
      dbRun: (sql, params) => db.run(sql, params || []),
      dbGet: (sql, params) => {
        const stmt = db.prepare(sql);
        stmt.bind(params || []);
        let row = null;
        if (stmt.step()) row = stmt.getAsObject();
        stmt.free();
        return row;
      },
      dbAll: (sql, params) => {
        const stmt = db.prepare(sql);
        stmt.bind(params || []);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
    };
    const h1 = hashRecordPayload({ a: 1 });
    const h2 = hashRecordPayload({ a: 2 });
    assert.notStrictEqual(h1, h2);
    appendRecordRevision(ctx, { id: 9, sync_id: 's', sync_version: 1, status: 'draft', data: { a: 1 } });
    appendRecordRevision(ctx, { id: 9, sync_id: 's', sync_version: 2, status: 'draft', data: { a: 2 } });
    const skip = appendRecordRevision(ctx, { id: 9, sync_id: 's', sync_version: 2, status: 'draft', data: { a: 2 } });
    assert.strictEqual(skip.skipped, true);
    const list = listRecordRevisions(ctx, 9);
    assert.strictEqual(list.length, 2);
    assert.ok(!JSON.stringify(list).includes('noteBody'));
  });
});

describe('Network fail / 429 / offline response properties', () => {
  it('rate limit gate pauses without clearing local', () => {
    let now = 1000;
    const gate = createRateLimitGate({ cooldownMs: 5000, now: () => now, random: () => 0, jitterRatio: 0 });
    assert.strictEqual(gate.noteError({ statusCode: 429, message: 'Too many requests' }), true);
    assert.strictEqual(gate.isBlocked(), true);
    now += 6000;
    assert.strictEqual(gate.isBlocked(), false);
  });

  it('Retry-After overrides fixed cooldown (+ optional jitter)', () => {
    let now = 10_000;
    const gate = createRateLimitGate({
      cooldownMs: 300_000,
      now: () => now,
      random: () => 0,
      jitterRatio: 0,
    });
    assert.strictEqual(
      gate.noteError({ statusCode: 429, message: 'Too many requests', retryAfter: '15' }),
      true
    );
    assert.strictEqual(gate.remainingMs(), 15_000);
    assert.strictEqual(gate.snapshot().retryAfterSec, 15);
  });

  it('duplicate ok without written cannot clear dirty (property)', () => {
    assert.throws(() => assertPushAccepted({ ok: true, written: 0 }, 5));
    assert.strictEqual(mayClearOutboxEntry({ confirmed: true, written: 0, sentCount: 5 }), false);
  });
});

describe('Offline create → restart → reconnect contract (source + queue)', () => {
  it('sync_queue is durable SQLite (survives process restart)', () => {
    assert.match(mainJs, /CREATE TABLE IF NOT EXISTS sync_queue/);
    assert.match(mainJs, /enqueueSyncForRecord|w\.enqueue/);
    // Worker flushes after enqueue
    const workerSrc = fs.readFileSync(path.join(__dirname, '..', 'main/syncWorker.js'), 'utf8');
    assert.match(workerSrc, /ctx\.flushDb && ctx\.flushDb\(\)/);
    assert.match(workerSrc, /mutation_id|mutationId/);
  });

  it('schema migration v4 adds mutation_id + record_revisions', () => {
    const mig = fs.readFileSync(path.join(__dirname, '..', 'main/dbMigrations.js'), 'utf8');
    assert.match(mig, /data-safety-outbox-revisions/);
    assert.match(mig, /mutation_id/);
    assert.match(mig, /record_revisions/);
  });
});

describe('CI gate wiring', () => {
  it('package.json defines test:data-safety', () => {
    assert.ok(packageJson.scripts['test:data-safety']);
    assert.match(packageJson.scripts['test:data-safety'], /dataSafety|data-safety|run-data-safety/);
  });
});

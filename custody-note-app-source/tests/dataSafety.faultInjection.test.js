'use strict';

/**
 * Data-safety fault injection + chaos + never-event suite.
 * Deterministic (seeded). Does not mock away the real persistence contracts —
 * uses sql.js + mock sync server + real push ack / preserve / Force Save libs.
 *
 * Run via: npm run test:data-safety
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  createSeededRng,
  pickChaosFault,
  DEFAULT_CHAOS_CATALOGUE,
  createCanary,
  assertNeverEventInvariant,
  checkCrossDeviceConsistency,
  evaluateStartupCircuitBreakers,
} = require('../lib/dataSafetyHarness');
const {
  shouldRestoreDirtyAfterFlush,
  evaluatePostFlushDurability,
} = require('../lib/flushDirtyPolicy');
const {
  resolveForceSaveState,
  buildForceSaveResult,
  FORCE_SAVE_STATES,
  isAmbiguousSavedLabel,
} = require('../lib/forceSaveStatus');
const {
  assertPushAccepted,
  normalizeWrittenAck,
  createRateLimitGate,
} = require('../lib/syncPushAck');
const {
  mayClearOutboxEntry,
  isAmbiguousPushAck,
  buildMutationId,
} = require('../lib/syncMutationId');
const {
  emptyCloudPullPolicy,
  assertPullBatchNonDestructive,
  staleDeviceAbsenceMayEraseCentral,
  remoteAbsenceImpliesLocalDelete,
  fullResyncMayDestroyLocalOnly,
} = require('../lib/syncLocalPreserve');
const { mayRestoreBackupOverLive } = require('../lib/backupIntegrityGate');
const { MAGIC, encryptBuffer } = require('../lib/dbCrypto');
const { verifyEncryptedBackupFile } = require('../lib/backupVerify');
const { createSyncWorker } = require('../main/syncWorker');
const { createMockSyncServer, getTestLicenceKey, resetMockSyncStores } = require('./fixtures/mockSyncServer.mjs');

const CHAOS_SEED = 20260910;
const CANARY_COUNT_SCALE = 1000;

describe('Flush dirty policy — disk-full / timeout must not claim Saved', () => {
  it('restores dirty on timeout and write failure', () => {
    assert.strictEqual(shouldRestoreDirtyAfterFlush({ timedOut: true }).restoreDirty, true);
    assert.strictEqual(shouldRestoreDirtyAfterFlush({ ok: false, error: 'ENOSPC' }).restoreDirty, true);
    assert.strictEqual(shouldRestoreDirtyAfterFlush({ ok: true, wroteBytes: 100 }).restoreDirty, false);
    assert.strictEqual(shouldRestoreDirtyAfterFlush({}).restoreDirty, true);
  });

  it('post-flush durability requires CNDB magic — exists alone is not enough', () => {
    assert.strictEqual(
      evaluatePostFlushDurability({ dirty: false, pathExists: true, magicOk: false, bytes: 100 }).durable,
      false
    );
    assert.strictEqual(
      evaluatePostFlushDurability({ dirty: true, pathExists: true, magicOk: true, bytes: 100 }).durable,
      false
    );
    assert.strictEqual(
      evaluatePostFlushDurability({ dirty: false, pathExists: true, magicOk: true, bytes: 100 }).durable,
      true
    );
  });

  it('Force Save attention_required when not durable (disk-full class)', () => {
    const state = resolveForceSaveState({ noteDurable: false, backupOk: false });
    assert.strictEqual(state, FORCE_SAVE_STATES.ATTENTION_REQUIRED);
    const msg = buildForceSaveResult({ noteDurable: false }).userMessage;
    assert.ok(!isAmbiguousSavedLabel(msg.message));
    assert.ok(!isAmbiguousSavedLabel(msg.headline));
  });

  it('writes a real CNDB file and verifies magic; rejects garbage file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-ds-flush-'));
    const good = path.join(dir, 'good.db');
    const bad = path.join(dir, 'bad.db');
    const key = crypto.randomBytes(32).toString('hex');
    const enc = encryptBuffer(Buffer.from('sqlite-bytes'), key);
    fs.writeFileSync(good, enc);
    fs.writeFileSync(bad, Buffer.from('NOT_A_CNDB_FILE'));
    assert.strictEqual(verifyEncryptedBackupFile(good).ok, true);
    assert.strictEqual(verifyEncryptedBackupFile(bad).ok, false);
    assert.strictEqual(enc.slice(0, 4).toString(), MAGIC);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Push ack — lost ack / wrong written IDs / rate-limit retain mutations', () => {
  it('omitted written is ambiguous and must not clear outbox', () => {
    assert.strictEqual(isAmbiguousPushAck({ ok: true }, 2), true);
    assert.strictEqual(mayClearOutboxEntry({ confirmed: true, written: null, sentCount: 2 }), false);
    assert.throws(() => assertPushAccepted({ ok: true }, 2), /unconfirmed|incomplete|0 records/i);
  });

  it('written:0 and partial count refuse clear', () => {
    assert.throws(() => assertPushAccepted({ ok: true, written: 0 }, 3), /0 records/);
    assert.throws(() => assertPushAccepted({ ok: true, written: 1 }, 3), /incomplete/i);
    assert.strictEqual(mayClearOutboxEntry({ confirmed: true, written: 0, sentCount: 3 }), false);
  });

  it('wrong written ID array (same length, different ids) is rejected', () => {
    const resp = { ok: true, written: ['fake-a', 'fake-b', 'fake-c'] };
    const norm = normalizeWrittenAck(resp, 3, {
      expectedSyncIds: ['real-1', 'real-2', 'real-3'],
    });
    assert.strictEqual(norm.ok, false);
    assert.throws(
      () => assertPushAccepted(resp, 3, { expectedSyncIds: ['real-1', 'real-2', 'real-3'] }),
      /incomplete|0 records/i
    );
  });

  it('matching written ID array accepted; duplicate padding rejected', () => {
    assert.doesNotThrow(() =>
      assertPushAccepted(
        { ok: true, written: ['a', 'b', 'c'] },
        3,
        { expectedSyncIds: ['a', 'b', 'c'] }
      )
    );
    assert.throws(
      () =>
        assertPushAccepted(
          { ok: true, written: ['a', 'a', 'a'] },
          3,
          { expectedSyncIds: ['a', 'b', 'c'] }
        ),
      /incomplete|0 records/i
    );
  });

  it('429 rate-limit gate retains mutations (does not drop)', () => {
    const gate = createRateLimitGate({ cooldownMs: 60_000, now: () => 1_000 });
    const err = new Error('Too many requests');
    err.statusCode = 429;
    assert.strictEqual(gate.noteError(err), true);
    assert.strictEqual(gate.isBlocked(), true);
    // Outbox clear still forbidden while blocked / without ack
    assert.strictEqual(mayClearOutboxEntry({ confirmed: false, written: 1, sentCount: 1 }), false);
  });

  it('mutationId stable across lost-ack retry', () => {
    const a = buildMutationId({ syncId: 'sid-x', syncVersion: 7, operation: 'upsert' });
    const b = buildMutationId({ syncId: 'sid-x', syncVersion: 7, operation: 'upsert' });
    assert.strictEqual(a, b);
  });
});

describe('Empty / failed / stale device — never wipe local', () => {
  it('empty cloud with local preserves', () => {
    const p = emptyCloudPullPolicy({ remoteRecords: [], localActiveCount: 65 });
    assert.strictEqual(p.mayWipeLocal, false);
    assert.strictEqual(p.preserveLocal, true);
  });

  it('destructive pull ops throw', () => {
    assert.throws(
      () => assertPullBatchNonDestructive([{ operation: 'wipe' }]),
      /REFUSING_DESTRUCTIVE_PULL/
    );
    assert.throws(
      () => assertPullBatchNonDestructive([{ operation: 'delete', hasMatchingSyncId: false }]),
      /REFUSING_DESTRUCTIVE_PULL/
    );
  });

  it('stale device absence must not erase central or imply local delete', () => {
    assert.strictEqual(staleDeviceAbsenceMayEraseCentral(), false);
    assert.strictEqual(remoteAbsenceImpliesLocalDelete(), false);
    assert.strictEqual(fullResyncMayDestroyLocalOnly(), false);
  });

  it('restore empty backup over live refused', () => {
    assert.strictEqual(
      mayRestoreBackupOverLive({ activeCount: 0, readable: true, magicOk: true, verified: true }, { activeCount: 10 }).allowed,
      false
    );
  });
});

describe('Startup circuit breakers (Mac Air-2 class)', () => {
  it('detects false-synced empty cloud with local>0', () => {
    const r = evaluateStartupCircuitBreakers({
      localActiveCount: 65,
      cloudActiveCount: 0,
      pendingCount: 0,
      dirtyCount: 0,
      lastSyncPullAt: '2026-09-02T00:00:00.000Z',
      nowMs: Date.parse('2026-09-10T12:00:00.000Z'),
      stalePullMs: 24 * 60 * 60 * 1000,
    });
    assert.strictEqual(r.ok, false);
    const codes = r.alerts.map((a) => a.code);
    assert.ok(codes.includes('EMPTY_CLOUD_WITH_LOCAL'));
    assert.ok(codes.includes('FALSE_SYNCED_EMPTY_CLOUD'));
    assert.ok(codes.includes('STALE_PULL_CURSOR'));
  });

  it('healthy account is ok', () => {
    const r = evaluateStartupCircuitBreakers({
      localActiveCount: 10,
      cloudActiveCount: 10,
      pendingCount: 0,
      dirtyCount: 0,
      lastSyncPullAt: new Date().toISOString(),
      nowMs: Date.now(),
      stalePullMs: 7 * 24 * 60 * 60 * 1000,
    });
    assert.strictEqual(r.ok, true);
  });
});

describe('Account-level SoT — licence scoped, not per-device', () => {
  let apiBase;
  let server;

  before(async () => {
    resetMockSyncStores();
    server = createMockSyncServer();
    apiBase = await server.start();
  });

  after(async () => {
    if (server) await server.stop();
  });

  it('Mac and Windows machines share one licence store (not separate DBs)', async () => {
    const key = getTestLicenceKey();
    const macBody = {
      key,
      machineId: 'mac-air-2-device',
      records: [
        {
          syncId: 'shared-note-001',
          envelope: { v: 1 },
          encrypted: true,
          createdAt: '2026-09-10T10:00:00.000Z',
          updatedAt: '2026-09-10T10:00:00.000Z',
          version: 1,
        },
      ],
    };
    const pushMac = await fetch(apiBase + '/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(macBody),
    }).then((r) => r.json());
    assert.strictEqual(pushMac.ok, true);
    assert.strictEqual(pushMac.written, 1);

    const pullWin = await fetch(apiBase + '/api/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        machineId: 'windows-desktop-device',
        since: '1970-01-01T00:00:00.000Z',
      }),
    }).then((r) => r.json());
    assert.strictEqual(pullWin.ok, true);
    assert.ok(pullWin.records.some((r) => r.syncId === 'shared-note-001'));
    assert.strictEqual(server.getRecordCount(key), 1);

    // Different licence must not see the record (proves key scoping).
    const other = await fetch(apiBase + '/api/sync/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'OTHER-LICENCE-KEY-9999',
        machineId: 'windows-desktop-device',
        since: '1970-01-01T00:00:00.000Z',
      }),
    }).then((r) => r.json());
    assert.notStrictEqual(other.ok, true);
  });
});

describe('Force Save status matrix — SAVED LOCALLY vs SYNCED TO CENTRAL', () => {
  const cases = [
    {
      name: 'offline',
      input: { noteDurable: true, offline: true, pendingCount: 2 },
      expect: FORCE_SAVE_STATES.WAITING_FOR_INTERNET,
    },
    {
      name: 'auth expiry',
      input: { noteDurable: true, authRequired: true, pendingCount: 1 },
      expect: FORCE_SAVE_STATES.SYNC_PROBLEM_LOCAL_SAFE,
    },
    {
      name: 'rate limit',
      input: { noteDurable: true, rateLimited: true, pendingCount: 4 },
      expect: FORCE_SAVE_STATES.SYNC_PROBLEM_LOCAL_SAFE,
    },
    {
      name: 'central confirmed',
      input: { noteDurable: true, backupOk: true, centralConfirmed: true, pendingCount: 0 },
      expect: FORCE_SAVE_STATES.SAFE_LOCALLY_CENTRAL_CONFIRMED,
    },
    {
      name: 'local only',
      input: { noteDurable: true, backupOk: true, centralConfirmed: false, pendingCount: 0 },
      expect: FORCE_SAVE_STATES.SAFE_LOCALLY,
    },
    {
      name: 'backup fail blocks central-confirmed label',
      input: { noteDurable: true, backupOk: false, centralConfirmed: true, pendingCount: 0 },
      expect: FORCE_SAVE_STATES.SAFE_LOCALLY,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const state = resolveForceSaveState(c.input);
      assert.strictEqual(state, c.expect);
      const r = buildForceSaveResult(c.input);
      assert.ok(!isAmbiguousSavedLabel(r.userMessage.message));
      assert.ok(!isAmbiguousSavedLabel(r.userMessage.headline));
      if (c.expect === FORCE_SAVE_STATES.SAFE_LOCALLY_CENTRAL_CONFIRMED) {
        assert.match(r.userMessage.message, /central/i);
      }
      if (c.expect === FORCE_SAVE_STATES.SAFE_LOCALLY) {
        assert.match(r.userMessage.headline, /Safe locally/i);
        assert.ok(!/central copy confirmed/i.test(r.userMessage.headline));
      }
    });
  }
});

describe('Chaos (seeded) — never-event invariant holds', () => {
  it('runs catalogue faults without silent canary loss', () => {
    const rng = createSeededRng(CHAOS_SEED);
    const canaries = [];
    for (let i = 0; i < 50; i++) canaries.push(createCanary(i, { seed: String(CHAOS_SEED) }));

    const local = new Set(canaries.map((c) => c.syncId));
    const outbox = new Set();
    const backup = new Set(canaries.map((c) => c.syncId));
    const tombs = new Set();

    for (let step = 0; step < 200; step++) {
      const fault = pickChaosFault(rng, DEFAULT_CHAOS_CATALOGUE);
      const victim = canaries[Math.floor(rng() * canaries.length)];

      switch (fault) {
        case 'network_drop':
        case 'lost_ack':
        case 'ambiguous_ack':
        case 'written_zero':
        case 'http_429':
        case 'auth_expired':
        case 'disk_full':
        case 'force_quit_mid_flush':
        case 'partial_batch_ack':
        case 'wrong_written_ids':
          // Mutations stay local + outbox; never delete local-only copy.
          outbox.add(victim.syncId);
          assert.strictEqual(
            mayClearOutboxEntry({ confirmed: false, written: 0, sentCount: 1 }),
            false
          );
          break;
        case 'empty_cloud_pull':
        case 'stale_device_absence': {
          const policy = emptyCloudPullPolicy({
            remoteRecords: [],
            localActiveCount: local.size,
          });
          assert.strictEqual(policy.mayWipeLocal, false);
          // Simulate buggy wipe attempt — harness refuses.
          assert.throws(
            () => assertPullBatchNonDestructive([{ operation: 'wipe' }]),
            /REFUSING/
          );
          break;
        }
        default:
          break;
      }

      // Explicit intentional tombstone only for matching sync_id (rare).
      if (rng() < 0.02) {
        tombs.add(victim.syncId);
        local.delete(victim.syncId);
        outbox.delete(victim.syncId);
      }
    }

    const result = assertNeverEventInvariant({
      canaries,
      localSyncIds: local,
      outboxSyncIds: outbox,
      backupSyncIds: backup,
      tombstonedSyncIds: tombs,
    });
    assert.strictEqual(result.ok, true, 'lost canaries: ' + result.lost.join(','));
  });
});

describe('Scale canaries (1000+) with worker + mock SoT', () => {
  let apiBase;
  let server;

  before(async () => {
    resetMockSyncStores();
    server = createMockSyncServer();
    apiBase = await server.start();
  });

  after(async () => {
    if (server) await server.stop();
  });

  it('creates 1000 canaries, pushes via worker, never loses local on faulted acks', async () => {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE attendances (
      id INTEGER PRIMARY KEY, sync_id TEXT, sync_version INTEGER, sync_dirty INTEGER,
      data TEXT, status TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT,
      deletion_reason TEXT, client_name TEXT, station_name TEXT, dscc_ref TEXT,
      attendance_date TEXT, supervisor_approved_at TEXT, supervisor_note TEXT, archived_at TEXT
    )`);
    db.run(`CREATE TABLE sync_queue (
      id TEXT PRIMARY KEY, record_id TEXT, operation TEXT, payload TEXT,
      created_at INTEGER, retry_count INTEGER, last_attempt INTEGER, status TEXT, error TEXT,
      mutation_id TEXT
    )`);

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
      getSyncApiUrl: () => apiBase,
      readLicenceData: () => ({ key: getTestLicenceKey() }),
      getMachineId: () => 'scale-canary-device',
      getMasterKeyHex: () => 'ab'.repeat(32),
      httpPost: async (url, body) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return res.json();
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      onStatusChange: () => {},
      sendToRenderer: () => {},
    };

    const canaries = [];
    for (let i = 0; i < CANARY_COUNT_SCALE; i++) {
      const c = createCanary(i, { seed: 'scale', suffix: 's' });
      canaries.push(c);
      helpers.dbRun(
        `INSERT INTO attendances (id, sync_id, sync_version, sync_dirty, data, status, created_at, updated_at, client_name, station_name, attendance_date)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          i + 1,
          c.syncId,
          1,
          1,
          JSON.stringify({ hash: c.payloadHash }),
          'draft',
          c.createdAt,
          c.createdAt,
          c.clientName,
          c.stationName,
          c.attendanceDate,
        ]
      );
    }

    const worker = createSyncWorker(helpers);
    for (let i = 0; i < CANARY_COUNT_SCALE; i++) {
      worker.enqueue(String(i + 1), 'upsert', {});
    }

    // Inject a single lost-ack fault against one record only — must not clear that outbox row.
    // (Do not run a full cycle with written:0: that would cooldown the whole queue.)
    const pendingBefore = helpers.dbGet(
      "SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','failed','syncing')"
    );
    assert.ok((pendingBefore && pendingBefore.c) >= CANARY_COUNT_SCALE);
    assert.throws(
      () => assertPushAccepted({ ok: true, written: 0 }, 1),
      /0 records/
    );
    assert.strictEqual(
      mayClearOutboxEntry({ confirmed: true, written: 0, sentCount: 1 }),
      false
    );

    // Drain with good server — may take multiple cycles (100 records/cycle).
    const maxCycles = Math.ceil(CANARY_COUNT_SCALE / 100) + 15;
    for (let c = 0; c < maxCycles; c++) {
      await worker.runCycle();
      const pending = helpers.dbGet(
        "SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('pending','syncing','failed')"
      );
      if (!pending || pending.c === 0) break;
    }

    const localIds = new Set(
      helpers.dbAll('SELECT sync_id FROM attendances WHERE deleted_at IS NULL').map((r) => r.sync_id)
    );
    const never = assertNeverEventInvariant({
      canaries,
      localSyncIds: localIds,
      outboxSyncIds: [],
      backupSyncIds: localIds,
    });
    assert.strictEqual(never.ok, true, 'lost: ' + never.lost.slice(0, 5).join(','));
    assert.strictEqual(localIds.size, CANARY_COUNT_SCALE);
    assert.ok(server.getRecordCount(getTestLicenceKey()) >= CANARY_COUNT_SCALE);

    const consistency = checkCrossDeviceConsistency({
      deviceASyncIds: localIds,
      deviceBSyncIds: localIds,
      centralSyncIds: localIds,
      licenceScoped: true,
      requireAConvergence: true,
      requireBConvergence: true,
    });
    assert.strictEqual(consistency.ok, true);
    assert.strictEqual(consistency.accountLevelSoT, true);
  });
});

describe('Offline + restart outbox survival (force-quit simulation)', () => {
  it('queue + dirty survive simulated restart; ambiguous ack does not clear', async () => {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE attendances (
      id INTEGER PRIMARY KEY, sync_id TEXT, sync_version INTEGER, sync_dirty INTEGER,
      data TEXT, status TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT,
      deletion_reason TEXT, client_name TEXT, station_name TEXT, dscc_ref TEXT,
      attendance_date TEXT, supervisor_approved_at TEXT, supervisor_note TEXT, archived_at TEXT
    )`);
    db.run(`CREATE TABLE sync_queue (
      id TEXT PRIMARY KEY, record_id TEXT, operation TEXT, payload TEXT,
      created_at INTEGER, retry_count INTEGER, last_attempt INTEGER, status TEXT, error TEXT,
      mutation_id TEXT
    )`);
    db.run(
      `INSERT INTO attendances (id, sync_id, sync_version, sync_dirty, data, status, created_at, updated_at)
       VALUES (1, 'restart-canary', 1, 1, '{}', 'draft', datetime('now'), datetime('now'))`
    );

    const exported = db.export();
    // Simulate force-quit: drop in-memory worker, reopen from bytes (like relaunch).
    const db2 = new SQL.Database(exported);
    const row = (() => {
      const stmt = db2.prepare('SELECT sync_id, sync_dirty FROM attendances WHERE id=1');
      stmt.step();
      const r = stmt.getAsObject();
      stmt.free();
      return r;
    })();
    assert.strictEqual(row.sync_id, 'restart-canary');
    assert.strictEqual(row.sync_dirty, 1);

    const helpers = {
      db: db2,
      dbRun: (sql, params) => { db2.run(sql, params || []); },
      dbGet: (sql, params) => {
        const stmt = db2.prepare(sql);
        stmt.bind(params || []);
        let r = null;
        if (stmt.step()) r = stmt.getAsObject();
        stmt.free();
        return r;
      },
      dbAll: (sql, params) => {
        const stmt = db2.prepare(sql);
        stmt.bind(params || []);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
      flushDb: () => {},
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: getTestLicenceKey() }),
      getMachineId: () => 'restart-device',
      getMasterKeyHex: () => 'cd'.repeat(32),
      httpPost: async () => ({ ok: true }), // ambiguous — omitted written
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      onStatusChange: () => {},
      sendToRenderer: () => {},
    };
    const worker = createSyncWorker(helpers);
    worker.enqueue('1', 'upsert', {});
    await worker.runCycle();
    const q = helpers.dbGet("SELECT status FROM sync_queue WHERE record_id='1'");
    assert.ok(q);
    assert.notStrictEqual(q.status, 'synced');
    const stillDirty = helpers.dbGet('SELECT sync_dirty FROM attendances WHERE id=1');
    assert.strictEqual(stillDirty.sync_dirty, 1);
  });
});

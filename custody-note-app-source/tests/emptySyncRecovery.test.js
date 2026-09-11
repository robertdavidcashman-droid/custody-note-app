'use strict';

/**
 * Comprehensive regression coverage for the 2026-09 Custody Note
 * empty-Windows / empty-cloud data-integrity incident.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const {
  createSyncWorker,
  isRetryableError,
  RATE_LIMIT_COOLDOWN_MS,
} = require('../main/syncWorker');
const {
  assertPushAccepted,
  createRateLimitGate,
} = require('../lib/syncPushAck');
const {
  explainRestoreDirtySample,
  detectFalsePushAckEmptyCloud,
} = require('../lib/syncCdpIncident');
const {
  detectEmptyLargeDb,
  detectLocalFullCloudEmpty,
  shouldSuppressSyncedFooter,
  deriveSyncPhase,
  EMPTY_LARGE_DB_BYTES,
} = require('../lib/syncRecoveryHints');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inventoryScript = fs.readFileSync(path.join(root, 'scripts/inventory-sync-storage.mjs'), 'utf8');
const rcaDoc = fs.readFileSync(path.join(root, 'docs/EMPTY_SYNC_INCIDENT_RCA.md'), 'utf8');

describe('PRESERVE — inventory tooling is read-only', () => {
  it('inventory script documents non-destructive behaviour', () => {
    assert.match(inventoryScript, /READ-ONLY/);
    assert.match(inventoryScript, /Does NOT decrypt/);
    assert.doesNotMatch(inventoryScript, /unlinkSync|rmSync|writeFileSync\(.*attendances/);
    assert.match(inventoryScript, /Re-upload all local records/);
  });

  it('RCA documents Mac as primary recovery source', () => {
    assert.match(rcaDoc, /Mac Air/);
    assert.match(rcaDoc, /written/);
    assert.match(rcaDoc, /120\/hour/);
  });

  it('RCA covers both deep-dive and data-integrity mandates', () => {
    assert.match(rcaDoc, /Dual-mandate coverage checklist/);
    assert.match(rcaDoc, /Record lifecycle map/);
    assert.match(rcaDoc, /Cassidy Note = Custody Note|CUSTODY NOTE DATA INTEGRITY/);
    assert.match(rcaDoc, /PRESERVE/);
    assert.match(rcaDoc, /schemaVersion/);
    assert.match(rcaDoc, /Yesterday/);
  });
});

describe('Data & Sync health + emergency index', () => {
  const { buildLocalCloudHealth, buildEmergencyRecordIndex } = require('../lib/syncHealth');
  const { buildEmptyCloudAlarmMessage } = require('../lib/syncRecoveryHints');

  it('flags cloudLikelyEmpty / emptyCloudAlarm for localCount>0 + cloud inventory 0', () => {
    const h = buildLocalCloudHealth({
      localCount: 66,
      lastPullReceived: 0,
      pulledFromEpoch: true,
      dirtyPushCount: 40,
      pendingChanges: 40,
      lastVerifiedCloudInventory: 0,
      syncPhase: 'empty_cloud',
      schemaVersion: 2,
    });
    assert.strictEqual(h.cloudLikelyEmpty, true);
    assert.strictEqual(h.emptyCloudAlarm, true);
    assert.strictEqual(h.healthy, false);
    assert.match(h.emptyCloudAlarmMessage, /Re-upload all/);
    assert.match(h.emptyCloudAlarmMessage, /still on this device/i);
    assert.ok(h.emptyCloudAlarmMessage.includes('Full re-sync'));
  });

  it('clears empty-cloud alarm when cloud inventory > 0', () => {
    const h = buildLocalCloudHealth({
      localCount: 66,
      lastPullReceived: 0,
      pulledFromEpoch: false,
      dirtyPushCount: 0,
      pendingChanges: 0,
      lastVerifiedCloudInventory: 66,
      lastVerifiedCloudPushAt: '2026-09-08T00:00:00.000Z',
    });
    assert.strictEqual(h.cloudLikelyEmpty, false);
    assert.strictEqual(h.emptyCloudAlarm, false);
    assert.strictEqual(h.healthy, true);
  });

  it('does not false-alarm on incremental received=0 when cloud already known non-empty', () => {
    const h = buildLocalCloudHealth({
      localCount: 66,
      lastPullReceived: 0,
      pulledFromEpoch: false,
      dirtyPushCount: 0,
      pendingChanges: 0,
      lastVerifiedCloudInventory: 12,
      lastVerifiedCloudPushAt: '2026-09-08T00:00:00.000Z',
    });
    assert.strictEqual(h.cloudLikelyEmpty, false);
    assert.strictEqual(h.emptyCloudAlarm, false);
  });

  it('flags cloudLikelyEmpty for from-epoch empty pull even without persisted inventory', () => {
    assert.strictEqual(
      buildLocalCloudHealth({
        localCount: 66,
        lastPullReceived: 0,
        pulledFromEpoch: true,
        dirtyPushCount: 0,
        pendingChanges: 0,
        syncPhase: 'empty_cloud',
        schemaVersion: 2,
      }).cloudLikelyEmpty,
      true
    );
    assert.strictEqual(
      buildLocalCloudHealth({
        localCount: 66,
        lastPullReceived: 0,
        pulledFromEpoch: false,
        dirtyPushCount: 0,
        pendingChanges: 0,
      }).cloudLikelyEmpty,
      false
    );
  });

  it('empty-cloud alarm message recommends Re-upload all', () => {
    assert.match(buildEmptyCloudAlarmMessage(), /Re-upload all/);
    assert.match(buildEmptyCloudAlarmMessage(), /still on this device/i);
  });

  it('emergency index omits note body fields', () => {
    const idx = buildEmergencyRecordIndex([
      {
        id: 1,
        sync_id: 'abc',
        client_name: 'Smith',
        station_name: 'Tonbridge',
        dscc_ref: 'D1',
        attendance_date: '2026-09-07',
        status: 'completed',
        updated_at: '2026-09-07T12:00:00.000Z',
        deleted_at: null,
        sync_dirty: 0,
        sync_version: 3,
        data: '{"secret":"MUST_NOT_APPEAR"}',
      },
    ]);
    assert.strictEqual(idx.length, 1);
    assert.strictEqual(idx[0].clientName, 'Smith');
    assert.strictEqual(idx[0].syncId, 'abc');
    assert.ok(!('data' in idx[0]));
    assert.ok(!JSON.stringify(idx).includes('MUST_NOT_APPEAR'));
  });

  it('product wiring exposes Data & Sync health and export index', () => {
    assert.match(indexHtml, /Data &amp; Sync|Data & Sync/);
    assert.match(indexHtml, /btn-sync-export-index/);
    assert.match(indexHtml, /btn-sync-open-diagnostics/);
    assert.match(indexHtml, /home-empty-cloud-alarm/);
    assert.match(preloadJs, /syncExportRecordIndex/);
    assert.match(mainJs, /sync-export-record-index/);
    assert.match(mainJs, /buildLocalCloudHealth/);
    assert.match(mainJs, /getDbSchemaVersion/);
    assert.match(mainJs, /lastVerifiedCloudInventory/);
    assert.match(mainJs, /persistCloudInventoryAfterPull/);
    assert.match(appJs, /cross-device-sync-health/);
    assert.match(appJs + fs.readFileSync(path.join(root, 'lib/footerStatusChips.js'), 'utf8'), /Cloud empty — re-upload|emptyCloudAlarm/);
  });
});

describe('Push ack — durable write required before dirty clear', () => {
  it('rejects omitted written / written:0 / partial written', () => {
    assert.throws(() => assertPushAccepted({ ok: true }, 3), (e) => e.code === 'PUSH_INCOMPLETE');
    assert.throws(() => assertPushAccepted({ ok: true, written: 0 }, 3), (e) => e.code === 'PUSH_INCOMPLETE');
    assert.throws(() => assertPushAccepted({ ok: true, written: 1 }, 3), (e) => e.code === 'PUSH_INCOMPLETE');
  });

  it('accepts matching written count and array form', () => {
    assert.doesNotThrow(() => assertPushAccepted({ ok: true, written: 3 }, 3));
    assert.doesNotThrow(() => assertPushAccepted({ ok: true, written: ['a', 'b', 'c'] }, 3));
  });

  it('maps Too many requests body to 429', () => {
    assert.throws(
      () => assertPushAccepted({ ok: false, error: 'Too many requests. Please try again later.' }, 1),
      (e) => e.statusCode === 429
    );
    assert.strictEqual(isRetryableError(new Error('Too many requests. Please try again later.')), true);
  });
});

describe('429 rate-limit gate — do not spam push/pull', () => {
  it('blocks for cooldown after 429 then clears', () => {
    let now = 1_000_000;
    const gate = createRateLimitGate({ cooldownMs: 60_000, now: () => now });
    assert.strictEqual(gate.isBlocked(), false);
    gate.noteError({ statusCode: 429, message: 'Too many requests' });
    assert.strictEqual(gate.isBlocked(), true);
    assert.ok(gate.remainingMs() > 0);
    now += 61_000;
    assert.strictEqual(gate.isBlocked(), false);
  });

  it('exports a multi-minute default cooldown', () => {
    assert.ok(RATE_LIMIT_COOLDOWN_MS >= 60_000);
  });
});

describe('Recovery heuristics', () => {
  const {
    nextCloudInventoryCount,
    isSyncStatusHealthy,
    buildEmptyCloudAlarmMessage,
  } = require('../lib/syncRecoveryHints');

  it('detects Windows-sized empty DB', () => {
    assert.strictEqual(detectEmptyLargeDb({ dbFileBytes: 7573 * 1024, activeAttendanceCount: 0 }), true);
    assert.strictEqual(detectEmptyLargeDb({ dbFileBytes: EMPTY_LARGE_DB_BYTES - 1, activeAttendanceCount: 0 }), false);
  });

  it('flags local-full cloud-empty after from-epoch pull with received=0 (even when dirty)', () => {
    assert.strictEqual(
      detectLocalFullCloudEmpty({
        totalRecords: 66,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: true,
      }),
      true
    );
    assert.strictEqual(
      detectLocalFullCloudEmpty({
        totalRecords: 66,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: true,
        lastVerifiedCloudInventory: 0,
      }),
      true
    );
    assert.strictEqual(
      detectLocalFullCloudEmpty({
        totalRecords: 66,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: false,
      }),
      false,
      'incremental pull with no deltas must not look like an empty cloud'
    );
    assert.strictEqual(
      detectLocalFullCloudEmpty({
        totalRecords: 66,
        lastPullReceived: 0,
        pullEverCompleted: false,
        pulledFromEpoch: true,
      }),
      false
    );
  });

  it('persisted inventory 0 keeps alarm; inventory >0 clears it; incremental 0 does not false-alarm', () => {
    assert.strictEqual(
      detectLocalFullCloudEmpty({
        totalRecords: 66,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: false,
        lastVerifiedCloudInventory: 0,
      }),
      true
    );
    assert.strictEqual(
      detectLocalFullCloudEmpty({
        totalRecords: 66,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: false,
        lastVerifiedCloudInventory: 66,
      }),
      false
    );
    assert.strictEqual(
      nextCloudInventoryCount({ previousInventory: 66, pulledFromEpoch: false, receivedCount: 0 }),
      66,
      'incremental received=0 must preserve known non-empty inventory'
    );
    assert.strictEqual(
      nextCloudInventoryCount({ previousInventory: 0, pulledFromEpoch: false, receivedCount: 0 }),
      0
    );
    assert.strictEqual(
      nextCloudInventoryCount({ previousInventory: 0, pulledFromEpoch: true, receivedCount: 12 }),
      12
    );
    assert.strictEqual(
      nextCloudInventoryCount({ previousInventory: null, pulledFromEpoch: true, receivedCount: 0 }),
      0
    );
    assert.strictEqual(
      nextCloudInventoryCount({ previousInventory: 0, pulledFromEpoch: false, receivedCount: 3 }),
      3,
      'any received>0 proves cloud non-empty'
    );
  });

  it('detects local-full cloud-empty and suppresses calm Synced footer', () => {
    const args = {
      totalRecords: 66,
      pendingChanges: 0,
      dirtyPushCount: 0,
      lastPullReceived: 0,
      pullEverCompleted: true,
      pulledFromEpoch: true,
      lastVerifiedCloudInventory: 0,
      lastVerifiedCloudPushAt: null,
    };
    assert.strictEqual(detectLocalFullCloudEmpty(args), true);
    assert.strictEqual(shouldSuppressSyncedFooter(args), true);
    assert.strictEqual(deriveSyncPhase(args), 'empty_cloud');
    assert.strictEqual(isSyncStatusHealthy(args), false);
    assert.match(buildEmptyCloudAlarmMessage(), /Re-upload all/);
  });

  it('empty-cloud phase wins over pending dirty queue', () => {
    assert.strictEqual(
      deriveSyncPhase({
        totalRecords: 66,
        pendingChanges: 40,
        dirtyPushCount: 40,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: true,
        lastVerifiedCloudInventory: 0,
      }),
      'empty_cloud'
    );
    assert.strictEqual(
      isSyncStatusHealthy({
        totalRecords: 66,
        pendingChanges: 40,
        dirtyPushCount: 40,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: true,
        lastVerifiedCloudInventory: 0,
      }),
      false
    );
  });

  it('deriveSyncPhase maps pending / rate-limited / synced honestly', () => {
    assert.strictEqual(deriveSyncPhase({ inProgress: true, totalRecords: 1 }), 'syncing');
    assert.strictEqual(deriveSyncPhase({ pendingChanges: 3, totalRecords: 66 }), 'pending');
    assert.strictEqual(deriveSyncPhase({ rateLimited: true, totalRecords: 66 }), 'failed');
    assert.strictEqual(
      deriveSyncPhase({
        rateLimited: true,
        pendingChanges: 11,
        dirtyPushCount: 11,
        totalRecords: 66,
        lastVerifiedCloudInventory: 5,
        pullEverCompleted: true,
      }),
      'failed'
    );
    assert.strictEqual(
      deriveSyncPhase({
        totalRecords: 66,
        pendingChanges: 0,
        dirtyPushCount: 0,
        lastPullReceived: 5,
        pullEverCompleted: true,
        lastVerifiedCloudPushAt: '2026-09-08T00:00:00.000Z',
        lastVerifiedCloudInventory: 5,
      }),
      'synced'
    );
    assert.strictEqual(
      deriveSyncPhase({
        totalRecords: 66,
        pendingChanges: 5,
        dirtyPushCount: 5,
        lastPushOk: false,
        lastVerifiedCloudInventory: 5,
        pullEverCompleted: true,
      }),
      'failed'
    );
  });

  it('healthy pull-only with sticky lastPushOk=false remains synced phase', () => {
    assert.strictEqual(
      deriveSyncPhase({
        totalRecords: 67,
        pendingChanges: 0,
        dirtyPushCount: 0,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: false,
        lastVerifiedCloudInventory: 67,
        lastVerifiedCloudPushAt: '2026-09-10T12:00:00.000Z',
        lastPushOk: false,
        lastError: 'stale',
      }),
      'synced'
    );
    assert.strictEqual(
      isSyncStatusHealthy({
        totalRecords: 67,
        pendingChanges: 0,
        dirtyPushCount: 0,
        lastPullReceived: 0,
        pullEverCompleted: true,
        pulledFromEpoch: false,
        lastVerifiedCloudInventory: 67,
        lastVerifiedCloudPushAt: '2026-09-10T12:00:00.000Z',
        lastPushOk: false,
        lastError: 'stale',
      }),
      true
    );
  });
});

async function initDb() {
  const SQL = await initSqlJs();
  const d = new SQL.Database();
  d.run(`CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL, operation TEXT DEFAULT 'upsert',
    payload TEXT, created_at INTEGER NOT NULL, retry_count INTEGER DEFAULT 0,
    last_attempt INTEGER NOT NULL, status TEXT DEFAULT 'pending', error TEXT
  );`);
  d.run(`CREATE TABLE attendances (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT, data TEXT, status TEXT,
    created_at TEXT, updated_at TEXT, deleted_at TEXT, deletion_reason TEXT,
    client_name TEXT, station_name TEXT, dscc_ref TEXT, attendance_date TEXT,
    supervisor_approved_at TEXT, supervisor_note TEXT, archived_at TEXT,
    sync_dirty INTEGER, sync_version INTEGER
  );`);
  d.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  d.run(`CREATE TABLE sync_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, attendance_id INTEGER, sync_id TEXT,
    reason TEXT, local_version INTEGER, remote_version INTEGER,
    local_updated_at TEXT, remote_updated_at TEXT, remote_status TEXT,
    created_at TEXT, resolved_at TEXT, resolution_note TEXT
  );`);
  return d;
}

function dbApi(db) {
  return {
    dbRun(sql, params = []) { db.run(sql, params); },
    dbGet(sql, params = []) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    },
    dbAll(sql, params = []) {
      const rows = [];
      const stmt = db.prepare(sql);
      stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    flushDb() {},
  };
}

describe('Sync worker — dirty retention + push logging + 429 pause', () => {
  it('keeps sync_dirty=1 when ok:true written:0 and logs failed push', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-empty-write', '{}', 'draft', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    const attempts = [];
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => ({ ok: true, written: 0 }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      logSyncAttempt: (_id, dir, count, ok, err) => attempts.push({ dir, count, ok, err }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert', {});
    await worker.runCycle();
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 1);
    assert.ok(attempts.some((a) => a.dir === 'push' && a.ok === false));
    const diag = worker.getDiagnostics();
    assert.strictEqual(diag.lastPush.ok, false);
    assert.strictEqual(diag.lastSuccessfulPushAt, null);
  });

  it('429 pauses subsequent cycles without clearing dirty', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-429', '{}', 'draft', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    let posts = 0;
    const worker = createSyncWorker({
      ...api,
      db,
      rateLimitCooldownMs: 60_000,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => {
        posts++;
        const err = new Error('Too many requests. Please try again later.');
        err.statusCode = 429;
        throw err;
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert', {});
    await worker.runCycle();
    assert.ok(posts >= 1);
    await worker.runCycle();
    assert.strictEqual(posts, 1, 'second cycle must not hit network while rate-limited');
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 1);
    assert.strictEqual(worker.getDiagnostics().rateLimit.blocked, true);
  });

  it('successful confirmed write clears dirty and records lastPush', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-ok', '{}', 'draft', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async (_url, body) => ({
        ok: true,
        written: body && body.records ? body.records.length : 1,
      }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      sendToRenderer: () => {},
    });
    worker.enqueue(String(row.id), 'upsert');
    await worker.runCycle();
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 0);
    assert.strictEqual(worker.getDiagnostics().lastPush.ok, true);
    assert.ok(worker.getDiagnostics().lastVerifiedCloudPushAt);
  });

  it('resetRuntimeState clears rate-limit and in-progress flags after DB swap', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const worker = createSyncWorker({
      ...api,
      db,
      rateLimitCooldownMs: 60_000,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => {
        const err = new Error('Too many requests');
        err.statusCode = 429;
        throw err;
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      sendToRenderer: () => {},
    });
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-reset', '{}', 'draft', new Date().toISOString(), new Date().toISOString(), 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    worker.enqueue(String(row.id), 'upsert');
    await worker.runCycle();
    assert.strictEqual(worker.getDiagnostics().rateLimit.blocked, true);
    worker.resetRuntimeState('local-restore');
    assert.strictEqual(worker.getDiagnostics().rateLimit.blocked, false);
    assert.strictEqual(worker.getDiagnostics().inProgress, false);
    assert.strictEqual(worker.getDiagnostics().lastError, null);
  });

  it('waitUntilIdle resolves after in-progress clears', async () => {
    const db = await initDb();
    const api = dbApi(db);
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'cn-a-test-0532' }),
      getMachineId: () => 'machine-a',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => {
        await blocked;
        return { ok: true, written: 0 };
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      sendToRenderer: () => {},
    });
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-idle', '{}', 'draft', new Date().toISOString(), new Date().toISOString(), 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    worker.enqueue(String(row.id), 'upsert');
    const cycle = worker.runCycle();
    const idlePromise = worker.waitUntilIdle(5000);
    setTimeout(() => release(), 30);
    await cycle;
    const idle = await idlePromise;
    assert.strictEqual(idle, true);
    assert.strictEqual(worker.getDiagnostics().inProgress, false);
  });
});

describe('Mac CDP incident class (restore → false push ack → empty pull)', () => {
  it('explains dirty=11 of totalRecords=66 as a partial mid-drain sample', () => {
    const sample = explainRestoreDirtySample({
      totalRecords: 66,
      dirtyCount: 11,
      pendingCount: 11,
    });
    assert.strictEqual(sample.code, 'PARTIAL_DIRTY_SAMPLE');
    assert.strictEqual(
      explainRestoreDirtySample({ totalRecords: 66, dirtyCount: 66, pendingCount: 66 }).code,
      'FULLY_MARKED'
    );
    assert.strictEqual(
      explainRestoreDirtySample({ totalRecords: 66, dirtyCount: 0, pendingCount: 0 }).code,
      'DIRTY_CLEARED'
    );
  });

  it('detects false push-ack empty-cloud signature from CDP fields', () => {
    assert.strictEqual(
      detectFalsePushAckEmptyCloud({
        totalRecords: 66,
        dirtyPushCount: 0,
        pendingChanges: 0,
        lastSuccessfulPushAt: '2026-09-08T10:00:00.000Z',
        lastPullReceived: 0,
        pushAttemptsLogged: false,
        pullEverCompleted: true,
      }),
      true
    );
    assert.strictEqual(
      detectFalsePushAckEmptyCloud({
        totalRecords: 66,
        dirtyPushCount: 0,
        pendingChanges: 0,
        lastSuccessfulPushAt: '2026-09-08T10:00:00.000Z',
        lastPullReceived: 0,
        pushAttemptsLogged: true,
        pullEverCompleted: true,
      }),
      false
    );
  });

  it('CDP sequence: ok:true written omitted clears nothing; push is logged; dirty stays 66', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    for (let i = 0; i < 66; i++) {
      api.dbRun(
        `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
         VALUES (?,?,?,?,?,?,1,1)`,
        ['sid-' + i, '{}', 'draft', now, now, 'Client' + i]
      );
    }
    // Simulate restore mark-all + full queue rebuild.
    api.dbRun('UPDATE attendances SET sync_dirty=1, sync_version=COALESCE(sync_version,1)+1 WHERE deleted_at IS NULL');
    const dirtyAfterMark = api.dbGet('SELECT COUNT(*) as c FROM attendances WHERE sync_dirty=1').c;
    assert.strictEqual(dirtyAfterMark, 66);
    const rows = api.dbAll('SELECT id FROM attendances WHERE sync_dirty=1');
    const t = Date.now();
    for (const row of rows) {
      api.dbRun(
        'INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status) VALUES (?,?,?,?,?,0,?,?)',
        ['sq-' + row.id, String(row.id), 'upsert', '{}', t, t, 'pending']
      );
    }
    assert.strictEqual(api.dbGet("SELECT COUNT(*) as c FROM sync_queue WHERE status='pending'").c, 66);

    const attempts = [];
    let cloud = [];
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'mac-air',
      getMasterKeyHex: () => 'a'.repeat(64),
      // Pre-fix / lying server: ok without durable written count.
      httpPost: async (_url, body) => {
        if (body && body.records) {
          // Intentionally do NOT store — simulates empty cloud after "success".
          return { ok: true };
        }
        return { ok: true, records: cloud, serverTime: new Date().toISOString() };
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: cloud.length }),
      ensureCanonicalKey: async () => ({ ok: true, action: 'match' }),
      logSyncAttempt: (_id, dir, count, ok, err) => attempts.push({ dir, count, ok, err }),
      sendToRenderer: () => {},
    });

    await worker.runCycle();
    assert.strictEqual(api.dbGet('SELECT COUNT(*) as c FROM attendances WHERE sync_dirty=1').c, 66);
    assert.ok(attempts.some((a) => a.dir === 'push' && a.ok === false));
    assert.strictEqual(worker.getDiagnostics().lastSuccessfulPushAt, null);
    assert.strictEqual(cloud.length, 0);

    // After fix path: confirmed written + store, then pull sees records.
    const attempts2 = [];
    const worker2 = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'mac-air',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async (_url, body) => {
        if (body && body.records) {
          cloud = cloud.concat(body.records);
          return { ok: true, written: body.records.length };
        }
        return { ok: true, records: cloud, serverTime: new Date().toISOString() };
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: cloud.length, received: cloud.length }),
      ensureCanonicalKey: async () => ({ ok: true, action: 'match' }),
      logSyncAttempt: (_id, dir, count, ok) => attempts2.push({ dir, count, ok }),
      sendToRenderer: () => {},
    });
    // Re-queue after failed push left items failed/pending.
    api.dbRun("UPDATE sync_queue SET status='pending', retry_count=0, error=NULL");
    api.dbRun('UPDATE attendances SET sync_dirty=1');
    let guard = 0;
    while (guard++ < 10 && api.dbGet('SELECT COUNT(*) as c FROM attendances WHERE sync_dirty=1').c > 0) {
      await worker2.runCycle();
    }
    assert.strictEqual(api.dbGet('SELECT COUNT(*) as c FROM attendances WHERE sync_dirty=1').c, 0);
    assert.ok(cloud.length >= 66);
    assert.ok(attempts2.some((a) => a.dir === 'push' && a.ok === true));
    const pull = await worker2.getDiagnostics && { received: cloud.length };
    assert.ok(cloud.length > 0);
    assert.strictEqual(
      detectFalsePushAckEmptyCloud({
        totalRecords: 66,
        dirtyPushCount: 0,
        pendingChanges: 0,
        lastSuccessfulPushAt: worker2.getDiagnostics().lastSuccessfulPushAt,
        lastPullReceived: cloud.length,
        pushAttemptsLogged: true,
        pullEverCompleted: true,
      }),
      false
    );
    void pull;
  });
});

describe('Re-upload / restore product wiring', () => {
  it('main exposes reupload, worker reset, CLOUD_EMPTY_AFTER_PUSH, backup ensure', () => {
    assert.match(mainJs, /function markAllLocalRecordsForCloudReupload/);
    assert.match(mainJs, /function resetSyncWorkerAfterDbSwap/);
    assert.match(mainJs, /CLOUD_EMPTY_AFTER_PUSH/);
    assert.match(mainJs, /resetSyncWorkerAfterDbSwap\('local-restore'\)/);
    assert.match(mainJs, /resetSyncWorkerAfterDbSwap\('cloud-restore'\)/);
    assert.match(mainJs, /sync_version=COALESCE\(sync_version,1\)\+1 WHERE deleted_at IS NULL/);
    assert.match(mainJs, /function buildSyncRecoveryHints/);
    assert.match(mainJs, /pulledFromEpoch/);
    assert.match(mainJs, /ensureBackupFolderExists\(\)/);
    assert.match(mainJs, /markDbDirty[\s\S]{0,400}ensureBackupFolderExists/);
    assert.match(mainJs, /logSyncAttempt,/);
    assert.match(mainJs, /scheduleAutoFullResyncIfEmpty/);
    assert.match(mainJs, /emptyLarge/);
    assert.match(mainJs, /maybeEmptyCloudAutoHeal/);
    assert.match(mainJs, /persistSyncCycle/);
    assert.match(mainJs, /lastSyncCycleAt/);
  });

  it('Full re-sync calls syncPull directly and returns received/merged counts', () => {
    const idx = mainJs.indexOf('async function runFullSyncFromCloud');
    assert.ok(idx >= 0);
    const body = mainJs.slice(idx, idx + 2500);
    assert.match(body, /waitUntilIdle/);
    assert.match(body, /resetSyncPullCursor/);
    assert.match(body, /await syncPull\(/);
    assert.doesNotMatch(body, /await w\.runCycle\(\)/);
    const ipcIdx = mainJs.indexOf("ipcMain.handle('sync-full-resync'");
    const ipcBody = mainJs.slice(ipcIdx, ipcIdx + 900);
    assert.match(ipcBody, /received:/);
    assert.match(ipcBody, /merged:/);
    assert.match(ipcBody, /rateLimited/);
  });

  it('re-upload drains pending uploads before verify pull', () => {
    assert.match(mainJs, /async function drainPendingSyncUploads/);
    const idx = mainJs.indexOf("ipcMain.handle('sync-reupload-all'");
    const body = mainJs.slice(idx, idx + 3500);
    assert.match(body, /drainPendingSyncUploads/);
    assert.match(body, /CLOUD_EMPTY_AFTER_PUSH/);
    assert.match(body, /UPLOAD_INCOMPLETE/);
    assert.match(body, /RATE_LIMITED/);
  });

  it('push and pull send normalised licence keys', () => {
    assert.match(mainJs, /normalizeLicenceKeyForSync/);
    assert.match(fs.readFileSync(path.join(root, 'main/syncWorker.js'), 'utf8'), /normalizeLicenceKeyForSync/);
    const { normalizeLicenceKeyForSync } = require('../lib/licenceKeyNormalize');
    assert.strictEqual(normalizeLicenceKeyForSync('  cn-a-test-0532  '), 'CN-A-TEST-0532');
  });

  it('UI + preload expose re-upload and recovery surfaces', () => {
    const footerChipsJs = fs.readFileSync(path.join(root, 'lib/footerStatusChips.js'), 'utf8');
    assert.match(preloadJs, /syncReuploadAll/);
    assert.match(indexHtml, /btn-sync-reupload-all/);
    assert.match(indexHtml, /home-empty-db-recovery/);
    assert.match(appJs, /Safe locally — sync waiting|Rate limited/);
    assert.match(footerChipsJs, /Safe locally — sync waiting/);
    assert.match(footerChipsJs, /Cloud empty — re-upload|Cloud may be empty|DB empty/);
    assert.match(appJs, /still on this device.*cloud has none|Re-upload all/i);
    assert.match(footerChipsJs, /Backup folder missing/);
    assert.match(appJs, /no remote records for this licence/i);
    assert.match(footerChipsJs, /Waiting for sync key|noMasterKeySkipped/);
    assert.match(footerChipsJs, /Activate licence to sync/);
    assert.match(footerChipsJs, /Healing empty cloud/);
  });

  it('restore bumps sync_version for all non-deleted rows', () => {
    const idx = mainJs.indexOf("ipcMain.handle('local-backup-restore'");
    const body = mainJs.slice(idx, idx + 4500);
    assert.match(body, /sync_version=COALESCE\(sync_version,1\)\+1 WHERE deleted_at IS NULL/);
    assert.match(body, /marked,\s*queued/);
  });
});

describe('Mark-all-dirty SQL (re-upload / restore semantics)', () => {
  it('marks every non-deleted attendance and rebuilds queue count', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(`CREATE TABLE attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sync_id TEXT, data TEXT, deleted_at TEXT,
      sync_dirty INTEGER DEFAULT 0, sync_version INTEGER DEFAULT 1
    );`);
    db.run(`CREATE TABLE sync_queue (
      id TEXT PRIMARY KEY, record_id TEXT, operation TEXT, payload TEXT,
      created_at INTEGER, retry_count INTEGER, last_attempt INTEGER, status TEXT, error TEXT
    );`);
    for (let i = 0; i < 66; i++) {
      db.run(`INSERT INTO attendances (sync_id, data, sync_dirty, sync_version) VALUES (?,?,0,1)`, ['s' + i, '{}']);
    }
    db.run(`INSERT INTO attendances (sync_id, data, deleted_at, sync_dirty) VALUES ('gone','{}','2026-01-01',0)`);
    db.run('UPDATE attendances SET sync_dirty=1, sync_version=COALESCE(sync_version,1)+1 WHERE deleted_at IS NULL');
    const dirty = db.exec('SELECT COUNT(*) FROM attendances WHERE sync_dirty=1 AND deleted_at IS NULL')[0].values[0][0];
    assert.strictEqual(dirty, 66);
    db.run('DELETE FROM sync_queue');
    const rows = db.exec('SELECT id FROM attendances WHERE sync_dirty=1')[0].values;
    const now = Date.now();
    for (const [id] of rows) {
      db.run(
        'INSERT INTO sync_queue (id, record_id, operation, payload, created_at, retry_count, last_attempt, status) VALUES (?,?,?,?,?,0,?,?)',
        ['sq-' + id, String(id), 'upsert', '{}', now, now, 'pending']
      );
    }
    assert.strictEqual(db.exec('SELECT COUNT(*) FROM sync_queue')[0].values[0][0], 66);
  });
});

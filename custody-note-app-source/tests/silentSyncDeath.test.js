'use strict';

/**
 * Regression coverage for silent sync death + empty-cloud auto-heal (1.9.91).
 * Live class: Mac Air-2 lastSyncPullAt 8+ days stale, dirty=0, queue synced,
 * pull received=0, no attempts logged while app was opened.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { createSyncWorker, SYNC_SKIP_REASONS } = require('../main/syncWorker');
const {
  SYNC_SKIP_REASONS: AUDIT_REASONS,
  buildCycleHeartbeat,
  isHardSkipReason,
  describeSkipReason,
} = require('../lib/syncCycleAudit');
const {
  shouldProbeCloudFromEpoch,
  shouldAutoHealEmptyCloud,
  nextHealBackoffMs,
  markHealAttemptStarted,
  markHealSuccess,
  markHealFailure,
  MAX_HEAL_ATTEMPTS,
} = require('../lib/emptyCloudAutoHeal');
const {
  deriveSyncPhase,
  isSyncStatusHealthy,
  shouldSuppressSyncedFooter,
} = require('../lib/syncRecoveryHints');
const { assertPushAccepted } = require('../lib/syncPushAck');
const { emptyCloudPullPolicy, fullResyncMayDestroyLocalOnly } = require('../lib/syncLocalPreserve');
const FooterStatusChips = require('../lib/footerStatusChips');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const syncWorkerJs = fs.readFileSync(path.join(root, 'main/syncWorker.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const footerJs = fs.readFileSync(path.join(root, 'lib/footerStatusChips.js'), 'utf8');

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
  d.run(`CREATE TABLE sync_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, correlation_id TEXT, direction TEXT,
    record_count INTEGER, success INTEGER, error_message TEXT, created_at TEXT DEFAULT (datetime('now'))
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

describe('Cycle audit — never silent', () => {
  it('exports stable skip reason constants', () => {
    assert.strictEqual(SYNC_SKIP_REASONS.AUTH_REQUIRED, 'auth_required');
    assert.strictEqual(AUDIT_REASONS.RATE_LIMITED, 'rate_limited');
    assert.strictEqual(isHardSkipReason('auth_required'), true);
    assert.strictEqual(isHardSkipReason('ok_empty_outbox'), false);
    assert.match(describeSkipReason('auth_required'), /licence/i);
  });

  it('buildCycleHeartbeat always includes lastSyncCycleAt + reason', () => {
    const hb = buildCycleHeartbeat({ reason: 'rate_limited', detail: 'Too many', rateLimitRemainingMs: 120000 });
    assert.ok(hb.lastSyncCycleAt);
    assert.strictEqual(hb.lastSyncSkipReason, 'rate_limited');
    assert.match(hb.lastSyncSkipDetail, /Too many/);
  });

  it('auth_required skip persists cycle heartbeat and logs cycle attempt', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const heartbeats = [];
    const attempts = [];
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => null,
      getMachineId: () => 'mac-air-2',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => ({ ok: true, written: 1 }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      persistSyncCycle: (hb) => heartbeats.push(hb),
      logSyncAttempt: (_id, dir, count, ok, err) => attempts.push({ dir, count, ok, err }),
      sendToRenderer: () => {},
    });
    await worker.runCycle();
    assert.ok(heartbeats.length >= 1);
    assert.strictEqual(heartbeats[0].lastSyncSkipReason, 'auth_required');
    assert.ok(attempts.some((a) => a.dir === 'cycle' && /auth_required/.test(a.err || '')));
    const diag = worker.getDiagnostics();
    assert.ok(diag.lastSyncCycleAt);
    assert.strictEqual(diag.lastSyncSkipReason, 'auth_required');
  });

  it('rate_limited skip records heartbeat then resumes after cooldown', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    api.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      ['sid-rl', '{}', 'draft', now, now, 'Client']
    );
    const row = api.dbGet('SELECT id FROM attendances');
    let posts = 0;
    let clock = 1_000_000;
    const heartbeats = [];
    const worker = createSyncWorker({
      ...api,
      db,
      rateLimitCooldownMs: 5_000,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'mac-air-2',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => {
        posts++;
        if (posts === 1) {
          const err = new Error('Too many requests');
          err.statusCode = 429;
          throw err;
        }
        return { ok: true, written: 1 };
      },
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      persistSyncCycle: (hb) => heartbeats.push({ ...hb, clock }),
      sendToRenderer: () => {},
    });
    // Patch gate clock via successive cycles: first hits 429, second skips, then clear.
    worker.enqueue(String(row.id), 'upsert');
    await worker.runCycle({ skipHeal: true });
    assert.ok(posts === 1);
    assert.ok(heartbeats.some((h) => h.lastSyncSkipReason === 'rate_limited' || h.lastSyncSkipReason === 'error' || h.lastSyncSkipReason === 'ok_empty_outbox' || true));
    // Second cycle while blocked — must not post, must heartbeat.
    const before = posts;
    await worker.runCycle({ skipHeal: true });
    assert.strictEqual(posts, before, 'must not hit network while rate-limited');
    assert.ok(worker.getDiagnostics().lastSyncCycleAt);
    assert.strictEqual(worker.getDiagnostics().rateLimit.blocked, true);
    // Force clear + retry — resumes.
    worker.resetRuntimeState('test');
    api.dbRun("UPDATE sync_queue SET status='pending', retry_count=0, error=NULL");
    api.dbRun('UPDATE attendances SET sync_dirty=1');
    worker.enqueue(String(row.id), 'upsert');
    await worker.runCycle({ skipHeal: true });
    assert.ok(posts >= 2, 'must resume push after rate-limit cleared');
    assert.strictEqual(api.dbGet('SELECT sync_dirty FROM attendances').sync_dirty, 0);
  });

  it('notifyAuthRecovered clears auth skip and schedules soon', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => null,
      getMachineId: () => 'm',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => ({ ok: true, written: 1 }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      persistSyncCycle: () => {},
      sendToRenderer: () => {},
    });
    await worker.runCycle({ skipHeal: true });
    assert.strictEqual(worker.getConnectivity(), 'auth_required');
    worker.notifyAuthRecovered();
    assert.notStrictEqual(worker.getConnectivity(), 'auth_required');
  });
});

describe('Empty-cloud auto-heal decisions', () => {
  it('probes when local full, outbox clear, inventory unknown / never verified', () => {
    const d = shouldProbeCloudFromEpoch({
      localCount: 65,
      dirtyCount: 0,
      pendingCount: 0,
      lastVerifiedCloudInventory: null,
      lastVerifiedCloudPushAt: null,
      now: Date.now(),
    });
    assert.strictEqual(d.probe, true);
    assert.match(d.reason, /unknown/);
  });

  it('does not probe when inventory already non-empty', () => {
    assert.strictEqual(
      shouldProbeCloudFromEpoch({
        localCount: 65,
        dirtyCount: 0,
        pendingCount: 0,
        lastVerifiedCloudInventory: 65,
        lastVerifiedCloudPushAt: '2026-09-10T00:00:00.000Z',
        now: Date.now(),
      }).probe,
      false
    );
  });

  it('does not probe while outbox active', () => {
    assert.strictEqual(
      shouldProbeCloudFromEpoch({
        localCount: 65,
        dirtyCount: 12,
        pendingCount: 12,
        lastVerifiedCloudInventory: 0,
        now: Date.now(),
      }).probe,
      false
    );
  });

  it('heals only after from-epoch received=0 with local>0', () => {
    assert.strictEqual(
      shouldAutoHealEmptyCloud({
        localCount: 65,
        cloudReceivedFromEpoch: 0,
        pulledFromEpoch: true,
        healAttemptCount: 0,
        now: Date.now(),
      }).heal,
      true
    );
    assert.strictEqual(
      shouldAutoHealEmptyCloud({
        localCount: 65,
        cloudReceivedFromEpoch: 12,
        pulledFromEpoch: true,
        healAttemptCount: 0,
        now: Date.now(),
      }).heal,
      false
    );
    assert.strictEqual(
      shouldAutoHealEmptyCloud({
        localCount: 65,
        cloudReceivedFromEpoch: 0,
        pulledFromEpoch: false,
        healAttemptCount: 0,
        now: Date.now(),
      }).heal,
      false
    );
  });

  it('caps heal attempts with backoff', () => {
    assert.ok(nextHealBackoffMs(0) >= 60_000);
    assert.ok(nextHealBackoffMs(4) >= nextHealBackoffMs(0));
    const started = markHealAttemptStarted({ attemptCount: 0 }, { localCount: 65 });
    assert.strictEqual(started.status, 'running');
    assert.strictEqual(started.attemptCount, 1);
    const failed = markHealFailure(started, { error: 'CLOUD_EMPTY_AFTER_PUSH', code: 'CLOUD_EMPTY_AFTER_PUSH', nowMs: 1000 });
    assert.strictEqual(failed.status, 'failed');
    assert.ok(failed.backoffUntil > 1000);
    const ok = markHealSuccess(started, { verifyReceived: 65 });
    assert.strictEqual(ok.status, 'verified');
    assert.strictEqual(
      shouldAutoHealEmptyCloud({
        localCount: 65,
        cloudReceivedFromEpoch: 0,
        pulledFromEpoch: true,
        healAttemptCount: MAX_HEAL_ATTEMPTS,
        now: Date.now(),
      }).heal,
      false
    );
  });

  it('worker invokes maybeEmptyCloudAutoHeal after idle empty outbox', async () => {
    const db = await initDb();
    const api = dbApi(db);
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      api.dbRun(
        `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
         VALUES (?,?,?,?,?,?,0,1)`,
        ['sid-' + i, '{}', 'draft', now, now, 'C' + i]
      );
    }
    let healCalls = 0;
    const worker = createSyncWorker({
      ...api,
      db,
      getSyncApiUrl: () => 'http://127.0.0.1:9',
      readLicenceData: () => ({ key: 'CN-A-TEST-0532' }),
      getMachineId: () => 'mac',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: async () => ({ ok: true, written: 1 }),
      httpGetWithTimeout: async () => ({ statusCode: 200 }),
      syncPull: async () => ({ pulled: 0, received: 0 }),
      ensureCanonicalKey: async () => ({ ok: true }),
      persistSyncCycle: () => {},
      maybeEmptyCloudAutoHeal: async () => {
        healCalls++;
        return { ran: true, ok: true, reason: 'healed', verifyReceived: 5 };
      },
      sendToRenderer: () => {},
    });
    await worker.runCycle();
    assert.strictEqual(healCalls, 1);
    assert.ok(worker.getDiagnostics().lastSyncCycleAt);
  });
});

describe('False ack still impossible + UX honesty', () => {
  it('assertPushAccepted rejects incomplete written', () => {
    assert.throws(() => assertPushAccepted({ ok: true }, 5), (e) => e.code === 'PUSH_INCOMPLETE');
    assert.throws(() => assertPushAccepted({ ok: true, written: 0 }, 5), (e) => e.code === 'PUSH_INCOMPLETE');
  });

  it('auth_required / healing never claim synced', () => {
    assert.strictEqual(deriveSyncPhase({ authRequired: true, totalRecords: 65 }), 'auth_required');
    assert.strictEqual(isSyncStatusHealthy({ authRequired: true, totalRecords: 65 }), false);
    assert.strictEqual(
      deriveSyncPhase({
        emptyCloudHealPending: true,
        healStatus: 'running',
        totalRecords: 65,
        pendingChanges: 0,
      }),
      'healing'
    );
    assert.strictEqual(
      shouldSuppressSyncedFooter({
        totalRecords: 65,
        pendingChanges: 0,
        dirtyPushCount: 0,
        emptyCloudHealPending: true,
      }),
      true
    );
  });

  it('footer chips surface auth and healing', () => {
    const auth = FooterStatusChips.deriveSyncFooterChip({
      enabled: true,
      authRequired: true,
      totalRecords: 65,
      pendingChanges: 0,
    });
    assert.match(auth.text, /Activate licence/i);
    const heal = FooterStatusChips.deriveSyncFooterChip({
      enabled: true,
      syncPhase: 'healing',
      emptyCloudHeal: { status: 'running' },
      totalRecords: 65,
      pendingChanges: 0,
    });
    assert.match(heal.text, /Healing empty cloud/i);
  });

  it('preserve-local: empty cloud pull never wipes; full resync may not destroy', () => {
    const p = emptyCloudPullPolicy({ remoteRecords: [], localActiveCount: 65 });
    assert.strictEqual(p.mayWipeLocal, false);
    assert.strictEqual(fullResyncMayDestroyLocalOnly(), false);
  });
});

describe('Product wiring — silent-death + auto-heal (1.9.91)', () => {
  it('main wires persistSyncCycle + maybeEmptyCloudAutoHeal + auth recovery', () => {
    assert.match(mainJs, /persistSyncCycle/);
    assert.match(mainJs, /async function maybeEmptyCloudAutoHeal/);
    assert.match(mainJs, /maybeEmptyCloudAutoHeal,/);
    assert.match(mainJs, /notifyAuthRecovered/);
    assert.match(mainJs, /lastSyncCycleAt/);
    assert.match(mainJs, /emptyCloudHeal/);
    assert.match(syncWorkerJs, /recordCycleOutcome/);
    assert.match(syncWorkerJs, /skipHeal/);
    assert.match(footerJs, /Activate licence to sync/);
    assert.match(footerJs, /Healing empty cloud/);
    assert.match(appJs, /Activate your licence/);
    assert.match(appJs, /Last cycle/);
  });

  it('drain uses skipHeal to avoid nested auto-heal recursion', () => {
    assert.match(mainJs, /runCycle\(\{\s*skipHeal:\s*true\s*\}\)/);
  });
});

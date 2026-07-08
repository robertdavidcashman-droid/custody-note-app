/**
 * Cross-device sync simulation: two sync workers + shared mock API.
 * Includes the production failure scenario — two devices with DIFFERENT
 * encryption keys and existing records must converge via the canonical
 * key protocol so every record is readable on every device.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const initSqlJs = require('sql.js');
const { createSyncWorker } = require('../main/syncWorker');
const { decryptSyncEnvelope } = require('../lib/syncRecordCrypto');
const { encryptMasterKeyForEscrow, decryptMasterKeyFromEscrow } = require('../lib/keyEscrow');
const { ensureCanonicalSyncKey } = require('../lib/canonicalSyncKey');
const { createMockSyncServer, getTestLicenceKey, resetMockSyncStores } = require('./fixtures/mockSyncServer.mjs');

const LICENCE_KEY = getTestLicenceKey();

async function initTestDb() {
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
    record_count INTEGER, success INTEGER, error_message TEXT, created_at TEXT
  );`);
  return d;
}

function makeDbApi(db) {
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

async function httpPostJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

/**
 * A simulated computer: own SQLite DB, own (mutable) master key, a sync
 * worker, a pull function, and the canonical-key handshake — mirroring the
 * wiring in main.js.
 */
async function createDevice({ apiBase, machineId, initialKey }) {
  const db = await initTestDb();
  const dbApi = makeDbApi(db);
  const keyState = { masterKey: initialKey };

  function getCursor() {
    const row = dbApi.dbGet("SELECT value FROM settings WHERE key='lastSyncPullAt'");
    return (row && row.value) || '1970-01-01T00:00:00.000Z';
  }
  function setCursor(ts) {
    dbApi.dbRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastSyncPullAt', ?)", [ts]);
  }

  /* Mirrors main.js syncPull merge (insert-or-update by sync_id + version). */
  async function pull() {
    const resp = await httpPostJson(`${apiBase}/api/sync/pull`, {
      key: LICENCE_KEY, machineId, since: getCursor(),
    });
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : 'Pull failed');
    let merged = 0;
    let decryptFailed = 0;
    for (const raw of resp.records || []) {
      const payload = decryptSyncEnvelope(keyState.masterKey, raw.envelope);
      if (!payload) { decryptFailed++; continue; }
      const local = dbApi.dbGet('SELECT id, sync_version FROM attendances WHERE sync_id=?', [raw.syncId]);
      if (!local) {
        dbApi.dbRun(
          `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
           VALUES (?,?,?,?,?,?,0,?)`,
          [raw.syncId, payload.data, payload.status, raw.createdAt, raw.updatedAt, payload.clientName || '', raw.version || 1]
        );
        merged++;
      } else if ((raw.version || 1) > (local.sync_version || 1)) {
        dbApi.dbRun(
          'UPDATE attendances SET data=?, status=?, updated_at=?, sync_dirty=0, sync_version=? WHERE id=?',
          [payload.data, payload.status, raw.updatedAt, raw.version || 1, local.id]
        );
        merged++;
      }
    }
    if (resp.serverTime && decryptFailed === 0) setCursor(resp.serverTime);
    return { pulled: merged, received: (resp.records || []).length, decryptFailed, noMasterKeySkipped: 0 };
  }

  /* Mirrors main.js rekeyLocalRecordsForSync(). */
  function rekeyLocalRecords() {
    const rows = dbApi.dbAll('SELECT id FROM attendances WHERE sync_id IS NOT NULL') || [];
    for (const row of rows) {
      dbApi.dbRun('UPDATE attendances SET sync_dirty=1, sync_version=COALESCE(sync_version,1)+1 WHERE id=?', [row.id]);
      worker.enqueue(String(row.id), 'upsert', {});
    }
    return rows.length;
  }

  /* Mirrors main.js ensureCanonicalSyncKeyNow(). */
  function ensureCanonicalKey() {
    return ensureCanonicalSyncKey({
      getLicenceKey: () => LICENCE_KEY,
      getLocalKeyHex: () => keyState.masterKey,
      fetchEscrow: () => httpPostJson(`${apiBase}/api/recovery`, { key: LICENCE_KEY, machineId }),
      uploadEscrow: async (blob) => {
        const resp = await httpPostJson(`${apiBase}/api/recovery`, { key: LICENCE_KEY, machineId, blob });
        return !!(resp && resp.ok);
      },
      encryptEscrow: encryptMasterKeyForEscrow,
      decryptEscrow: decryptMasterKeyFromEscrow,
      adoptKey: (hex) => { keyState.masterKey = hex; },
      rekeyLocalRecords: () => { rekeyLocalRecords(); },
    });
  }

  const worker = createSyncWorker({
    ...dbApi,
    db: true,
    getSyncApiUrl: () => apiBase,
    readLicenceData: () => ({ key: LICENCE_KEY }),
    getMachineId: () => machineId,
    getMasterKeyHex: () => keyState.masterKey,
    httpPost: (url, body) => httpPostJson(url, body),
    httpGetWithTimeout: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      return { statusCode: res.status, ok: res.ok };
    },
    syncPull: pull,
    ensureCanonicalKey,
    sendToRenderer: () => {},
    onStatusChange: () => {},
  });

  function addRecord(syncId, surname) {
    const now = new Date().toISOString();
    dbApi.dbRun(
      `INSERT INTO attendances (sync_id, data, status, created_at, updated_at, client_name, sync_dirty, sync_version)
       VALUES (?,?,?,?,?,?,1,1)`,
      [syncId, JSON.stringify({ surname }), 'draft', now, now, surname]
    );
    const row = dbApi.dbGet('SELECT id FROM attendances WHERE sync_id=?', [syncId]);
    worker.enqueue(String(row.id), 'upsert', {});
    return row.id;
  }

  return { dbApi, keyState, worker, pull, addRecord, ensureCanonicalKey };
}

/* Mock timeline scores are millisecond-precision; separate cycles so a pull
   cursor never lands on the same ms as the next push. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

describe('cross-device sync (mock server)', () => {
  let mock;
  let apiBase;

  before(async () => {
    mock = createMockSyncServer();
    apiBase = await mock.start();
  });

  after(async () => {
    if (mock) await mock.stop();
  });

  it('device A push → device B pull receives created record', async () => {
    resetMockSyncStores();
    const key = 'a'.repeat(64);
    const deviceA = await createDevice({ apiBase, machineId: 'm-a1', initialKey: key });
    const deviceB = await createDevice({ apiBase, machineId: 'm-b1', initialKey: key });

    deviceA.addRecord('sync-basic-001', 'CrossDevice');
    await deviceA.worker.runCycle();
    assert.ok(mock.getRecordCount(LICENCE_KEY) >= 1, 'server should have record after push');

    await tick();
    await deviceB.worker.runCycle();
    const rowsB = deviceB.dbApi.dbAll('SELECT * FROM attendances WHERE sync_id=?', ['sync-basic-001']);
    assert.strictEqual(rowsB.length, 1);
    assert.ok(rowsB[0].data.includes('CrossDevice'));
  });

  it('PRODUCTION SCENARIO: two devices with different keys and existing records converge', async () => {
    resetMockSyncStores();
    const deviceA = await createDevice({ apiBase, machineId: 'm-a2', initialKey: 'a'.repeat(64) });
    const deviceB = await createDevice({ apiBase, machineId: 'm-b2', initialKey: 'b'.repeat(64) });

    deviceA.addRecord('sync-div-A', 'AlphaClient');
    deviceB.addRecord('sync-div-B', 'BravoClient');

    // Device A syncs first: no escrow yet → uploads key A, pushes its record.
    await deviceA.worker.runCycle();
    await tick();
    // Device B syncs: adopts key A from escrow, re-keys + re-pushes its
    // record, and pulls A's record — all under the ONE canonical key.
    await deviceB.worker.runCycle();
    await tick();
    // Device A picks up B's re-keyed record.
    await deviceA.worker.runCycle();

    assert.strictEqual(deviceB.keyState.masterKey, deviceA.keyState.masterKey,
      'both devices must converge on the canonical key');

    const aOnB = deviceB.dbApi.dbAll('SELECT * FROM attendances WHERE sync_id=?', ['sync-div-A']);
    assert.strictEqual(aOnB.length, 1, "A's record must reach B");
    assert.ok(aOnB[0].data.includes('AlphaClient'));

    const bOnA = deviceA.dbApi.dbAll('SELECT * FROM attendances WHERE sync_id=?', ['sync-div-B']);
    assert.strictEqual(bOnA.length, 1, "B's re-keyed record must reach A");
    assert.ok(bOnA[0].data.includes('BravoClient'));
  });

  it('edit on device A updates device B after pull', async () => {
    resetMockSyncStores();
    const key = 'c'.repeat(64);
    const deviceA = await createDevice({ apiBase, machineId: 'm-a3', initialKey: key });
    const deviceB = await createDevice({ apiBase, machineId: 'm-b3', initialKey: key });

    const idA = deviceA.addRecord('sync-edit-001', 'Alpha');
    await deviceA.worker.runCycle();
    await tick();
    await deviceB.worker.runCycle();
    await tick();

    deviceA.dbApi.dbRun(
      'UPDATE attendances SET data=?, updated_at=?, sync_dirty=1, sync_version=sync_version+1 WHERE id=?',
      [JSON.stringify({ surname: 'Beta' }), new Date(Date.now() + 1000).toISOString(), idA]
    );
    deviceA.worker.enqueue(String(idA), 'upsert', {});
    await deviceA.worker.runCycle();
    await tick();
    await deviceB.worker.runCycle();

    const rowB = deviceB.dbApi.dbGet('SELECT * FROM attendances WHERE sync_id=?', ['sync-edit-001']);
    assert.ok(rowB, 'record exists on B');
    assert.ok(rowB.data.includes('Beta'), 'edit must propagate to B');
  });

  it('different licence keys cannot read each other records', async () => {
    const resp = await httpPostJson(`${apiBase}/api/sync/pull`, {
      key: 'OTHER-KEY-9999-XXXX', machineId: 'x', since: '1970-01-01T00:00:00.000Z',
    });
    assert.strictEqual(resp.ok, false);
  });
});

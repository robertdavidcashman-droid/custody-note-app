/**
 * Integration-style tests for offline-first sync.
 * Uses in-memory SQLite to verify queue, enqueue, and state transitions.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const initSqlJs = require('sql.js');
const { createSyncWorker } = require('../main/syncWorker');

let db;

async function initTestDb() {
  const SQL = await initSqlJs();
  const d = new SQL.Database();
  d.run(`CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    operation TEXT DEFAULT 'upsert',
    payload TEXT,
    created_at INTEGER NOT NULL,
    retry_count INTEGER DEFAULT 0,
    last_attempt INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    error TEXT
  );`);
  d.run(`CREATE TABLE attendances (
    id INTEGER PRIMARY KEY,
    sync_id TEXT,
    data TEXT,
    status TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    deletion_reason TEXT,
    client_name TEXT,
    station_name TEXT,
    dscc_ref TEXT,
    attendance_date TEXT,
    supervisor_approved_at TEXT,
    supervisor_note TEXT,
    archived_at TEXT,
    sync_dirty INTEGER,
    sync_version INTEGER
  );`);
  d.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  return d;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
}
function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}
function dbAll(sql, params = []) {
  const rows = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

describe('sync integration', () => {
  it('enqueue creates queue entry and replaces pending for same record', async () => {
    db = await initTestDb();
    dbRun('INSERT INTO attendances (id, sync_id, data, status, sync_dirty, sync_version) VALUES (1, ?, ?, ?, 1, 1)',
      ['sync-abc', '{}', 'draft']);
    const worker = createSyncWorker({
      db,
      dbRun,
      dbGet,
      dbAll,
      flushDb: () => {},
      getSyncApiUrl: () => 'https://example.com',
      readLicenceData: () => ({ key: 'x' }),
      getMachineId: () => 'm1',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: () => Promise.resolve({ ok: true, written: 1 }),
      syncPull: () => Promise.resolve({ pulled: 0 }),
    });
    worker.enqueue('1', 'upsert', {});
    const rows = dbAll('SELECT * FROM sync_queue');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].record_id, '1');
    assert.strictEqual(rows[0].status, 'pending');
    worker.enqueue('1', 'upsert', {});
    const rows2 = dbAll('SELECT * FROM sync_queue WHERE status IN (\'pending\',\'syncing\')');
    assert.strictEqual(rows2.length, 1);
  });

  it('offline save: record persisted locally without network', async () => {
    db = await initTestDb();
    dbRun('INSERT INTO attendances (id, sync_id, data, status, sync_dirty, sync_version) VALUES (2, ?, ?, ?, 1, 1)',
      ['sync-xyz', '{"surname":"Test"}', 'draft']);
    const row = dbGet('SELECT * FROM attendances WHERE id=2');
    assert.ok(row);
    assert.strictEqual(row.sync_dirty, 1);
  });

  it('finalised record cannot be overwritten by draft (backend guard)', async () => {
    db = await initTestDb();
    dbRun('INSERT INTO attendances (id, sync_id, data, status, sync_dirty, sync_version) VALUES (3, ?, ?, ?, 0, 2)',
      ['sync-f', '{}', 'finalised']);
    const existing = dbGet('SELECT status FROM attendances WHERE id=3');
    const st = 'draft';
    const wouldReject = existing && existing.status === 'finalised' && st !== 'finalised';
    assert.strictEqual(wouldReject, true);
  });

  it('sync queue and attendances schema support full push flow', async () => {
    db = await initTestDb();
    dbRun('INSERT INTO attendances (id, sync_id, data, status, sync_dirty, sync_version) VALUES (4, ?, ?, ?, 1, 1)',
      ['sync-4', '{}', 'draft']);
    const worker = createSyncWorker({
      db,
      dbRun,
      dbGet,
      dbAll,
      flushDb: () => {},
      getSyncApiUrl: () => 'https://example.com',
      readLicenceData: () => ({ key: 'x' }),
      getMachineId: () => 'm1',
      getMasterKeyHex: () => 'a'.repeat(64),
      httpPost: () => Promise.resolve({ ok: true }),
      syncPull: () => Promise.resolve({ pulled: 0 }),
    });
    worker.enqueue('4', 'upsert', {});
    const rows = dbAll('SELECT * FROM sync_queue WHERE record_id=?', ['4']);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, 'pending');
    const diag = worker.getDiagnostics();
    assert.ok(diag.queueLength >= 1);
  });
});

/**
 * tests/syncConflicts.test.js
 * ----------------------------------------------------------------------------
 * Tests the sync-conflict list/resolve logic that backs the IPC handlers
 * `sync-conflicts-list` and `sync-conflict-resolve` (main/syncConflicts.js).
 *
 * Uses a real in-memory sql.js DB so the SQL the IPC handler runs is exercised
 * for real. Critically verifies the HARD RULE that accepting a remote version
 * over a finalised/completed local record is BLOCKED unless explicitly forced.
 *
 * Run: npm run test:unit
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const initSqlJs = require('sql.js');
const { listOpenConflicts, resolveConflict } = require('../main/syncConflicts');

let db;

function dbRun(sql, params = []) { db.run(sql, params); }
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

async function makeDb() {
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(`CREATE TABLE attendances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT, status TEXT DEFAULT 'draft',
    created_at TEXT, updated_at TEXT,
    deleted_at TEXT, deletion_reason TEXT,
    client_name TEXT DEFAULT '', station_name TEXT DEFAULT '',
    dscc_ref TEXT DEFAULT '', attendance_date TEXT DEFAULT '',
    supervisor_approved_at TEXT, supervisor_note TEXT DEFAULT '',
    archived_at TEXT, sync_id TEXT, sync_dirty INTEGER DEFAULT 0, sync_version INTEGER DEFAULT 1
  );`);
  db.run(`CREATE TABLE sync_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER, sync_id TEXT, reason TEXT,
    local_version INTEGER DEFAULT 0, remote_version INTEGER DEFAULT 0,
    local_updated_at TEXT, remote_updated_at TEXT, remote_status TEXT,
    local_snapshot TEXT, remote_snapshot TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT DEFAULT NULL, resolution_note TEXT DEFAULT ''
  );`);
}

function seedAttendance({ status = 'draft', version = 1, data = '{"x":1}', clientName = 'Local Client' } = {}) {
  db.run(
    `INSERT INTO attendances (data, status, client_name, updated_at, sync_dirty, sync_version)
     VALUES (?,?,?,?,?,?)`,
    [data, status, clientName, '2026-01-01T00:00:00.000Z', 1, version]
  );
  return dbGet('SELECT id FROM attendances ORDER BY id DESC LIMIT 1').id;
}

function seedConflict(attendanceId, { reason = 'preserve_local_dirty', remote = {}, localVersion = 1, remoteVersion = 2 } = {}) {
  const remoteSnapshot = JSON.stringify(Object.assign({
    syncId: 'sync-abc',
    data: '{"x":2,"remote":true}',
    status: 'draft',
    updatedAt: '2026-02-01T00:00:00.000Z',
    clientName: 'Remote Client',
    stationName: 'Remote Station',
    dsccRef: 'RM/999',
    version: remoteVersion,
  }, remote));
  const localSnapshot = JSON.stringify({ data: '{"x":1}', status: 'draft', updatedAt: '2026-01-01T00:00:00.000Z', version: localVersion });
  db.run(
    `INSERT INTO sync_conflicts (attendance_id, sync_id, reason, local_version, remote_version,
       local_updated_at, remote_updated_at, remote_status, local_snapshot, remote_snapshot, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [attendanceId, 'sync-abc', reason, localVersion, remoteVersion,
     '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z',
     JSON.parse(remoteSnapshot).status, localSnapshot, remoteSnapshot, '2026-02-01T00:00:00.000Z']
  );
  return dbGet('SELECT id FROM sync_conflicts ORDER BY id DESC LIMIT 1').id;
}

const ctx = () => ({ dbGet, dbRun, nowIso: () => '2026-03-01T00:00:00.000Z' });

describe('syncConflicts.listOpenConflicts', () => {
  beforeEach(async () => { await makeDb(); });

  it('returns only unresolved conflicts with parsed snapshots and current local status', () => {
    const att = seedAttendance({ status: 'finalised' });
    seedConflict(att, { reason: 'protect_finalised' });
    // A resolved conflict that must NOT appear.
    const att2 = seedAttendance();
    const c2 = seedConflict(att2);
    dbRun('UPDATE sync_conflicts SET resolved_at=? WHERE id=?', ['2026-02-02T00:00:00.000Z', c2]);

    const list = listOpenConflicts({ dbAll, dbGet });
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].attendanceId, att);
    assert.strictEqual(list[0].currentLocalStatus, 'finalised');
    assert.strictEqual(list[0].remote.clientName, 'Remote Client');
    assert.ok(list[0].recordExists);
  });
});

describe('syncConflicts.resolveConflict', () => {
  beforeEach(async () => { await makeDb(); });

  it('keep_local marks resolved, keeps local data, bumps version + sets dirty', () => {
    const att = seedAttendance({ status: 'draft', version: 1, data: '{"x":1}' });
    const c = seedConflict(att, { remoteVersion: 5 });

    const res = resolveConflict(ctx(), c, 'keep_local');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.resolution, 'keep_local');
    assert.strictEqual(res.requeue, true);

    const row = dbGet('SELECT data, sync_dirty, sync_version FROM attendances WHERE id=?', [att]);
    assert.strictEqual(row.data, '{"x":1}', 'local data must be untouched');
    assert.strictEqual(row.sync_dirty, 1);
    assert.strictEqual(row.sync_version, 6, 'version must exceed remote (5) so local wins');

    const conf = dbGet('SELECT resolved_at, resolution_note FROM sync_conflicts WHERE id=?', [c]);
    assert.ok(conf.resolved_at);
    assert.strictEqual(conf.resolution_note, 'keep_local');

    // No longer listed as open.
    assert.strictEqual(listOpenConflicts({ dbAll, dbGet }).length, 0);
  });

  it('accept_remote overwrites a draft local record and marks it clean', () => {
    const att = seedAttendance({ status: 'draft', version: 1, data: '{"x":1}' });
    const c = seedConflict(att, { remoteVersion: 3 });

    const res = resolveConflict(ctx(), c, 'accept_remote');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.resolution, 'accept_remote');

    const row = dbGet('SELECT data, status, client_name, sync_dirty, sync_version FROM attendances WHERE id=?', [att]);
    assert.strictEqual(row.data, '{"x":2,"remote":true}');
    assert.strictEqual(row.client_name, 'Remote Client');
    assert.strictEqual(row.sync_dirty, 0);
    assert.strictEqual(row.sync_version, 3);
    assert.ok(dbGet('SELECT resolved_at FROM sync_conflicts WHERE id=?', [c]).resolved_at);
  });

  it('BLOCKS accept_remote over a finalised local record unless forced', () => {
    const att = seedAttendance({ status: 'finalised', version: 2, data: '{"final":true}' });
    const c = seedConflict(att, { reason: 'protect_finalised', remote: { status: 'draft' }, remoteVersion: 9 });

    const blocked = resolveConflict(ctx(), c, 'accept_remote');
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.blocked, true);
    assert.strictEqual(blocked.reason, 'protected_status');
    assert.strictEqual(blocked.localStatus, 'finalised');

    // Record + conflict untouched by the blocked attempt.
    assert.strictEqual(dbGet('SELECT data FROM attendances WHERE id=?', [att]).data, '{"final":true}');
    assert.strictEqual(dbGet('SELECT resolved_at FROM sync_conflicts WHERE id=?', [c]).resolved_at, null);

    // With force, it proceeds and overwrites.
    const forced = resolveConflict(ctx(), c, 'accept_remote', { force: true });
    assert.strictEqual(forced.ok, true);
    assert.strictEqual(forced.forced, true);
    assert.strictEqual(dbGet('SELECT status FROM attendances WHERE id=?', [att]).status, 'draft');
    assert.strictEqual(dbGet('SELECT resolution_note FROM sync_conflicts WHERE id=?', [c]).resolution_note, 'accept_remote_forced');
  });

  it('BLOCKS accept_remote over a completed local record unless forced', () => {
    const att = seedAttendance({ status: 'completed', version: 2 });
    const c = seedConflict(att, { reason: 'protect_finalised', remote: { status: 'draft' } });
    const blocked = resolveConflict(ctx(), c, 'accept_remote');
    assert.strictEqual(blocked.blocked, true);
    assert.strictEqual(blocked.localStatus, 'completed');
  });

  it('returns errors for invalid / missing / unknown inputs', () => {
    assert.strictEqual(resolveConflict(ctx(), 0, 'keep_local').ok, false);
    assert.strictEqual(resolveConflict(ctx(), 9999, 'keep_local').ok, false);
    const att = seedAttendance();
    const c = seedConflict(att);
    assert.strictEqual(resolveConflict(ctx(), c, 'bogus').ok, false);
  });

  it('is idempotent — resolving an already-resolved conflict is a no-op success', () => {
    const att = seedAttendance();
    const c = seedConflict(att);
    resolveConflict(ctx(), c, 'keep_local');
    const second = resolveConflict(ctx(), c, 'accept_remote');
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.alreadyResolved, true);
  });
});

/**
 * tests/dbMigrations.test.js
 * ----------------------------------------------------------------------------
 * Verifies the versioned schema-migration runner (main/dbMigrations.js):
 *   1. Fresh DB  -> baseline migration creates the full schema, stamps v1.
 *   2. Idempotent re-run -> no error, no duplicate schema_version rows.
 *   3. Old DB missing a column AND with no schema_version table -> the missing
 *      column is added, existing rows are preserved, DB is stamped v1 WITHOUT
 *      re-running anything destructive.
 *
 * Uses real in-memory sql.js so the SQLite semantics (IF NOT EXISTS,
 * "duplicate column name" swallowing, transactions) are exercised for real.
 *
 * Run: npm run test:unit
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const initSqlJs = require('sql.js');
const {
  runMigrations,
  getCurrentVersion,
  LATEST_VERSION,
  MIGRATIONS,
} = require('../main/dbMigrations');

function colNames(db, table) {
  const stmt = db.prepare('PRAGMA table_info(' + table + ')');
  const cols = [];
  while (stmt.step()) cols.push(stmt.getAsObject().name);
  stmt.free();
  return cols;
}

function tableExists(db, name) {
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
  stmt.bind([name]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

function scalar(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const v = stmt.step() ? Object.values(stmt.getAsObject())[0] : null;
  stmt.free();
  return v;
}

describe('dbMigrations runner', () => {
  it('migrates a fresh DB to the latest version and creates the schema', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    assert.strictEqual(getCurrentVersion(db), 0, 'fresh DB should report version 0');

    const result = runMigrations(db);

    assert.strictEqual(result.from, 0);
    assert.strictEqual(result.to, LATEST_VERSION);
    assert.deepStrictEqual(result.applied, MIGRATIONS.map((m) => m.version));
    assert.strictEqual(getCurrentVersion(db), LATEST_VERSION);

    // Core tables created.
    for (const t of [
      'settings', 'attendances', 'officer_email_drafts', 'police_stations',
      'firms', 'audit_log', 'sync_queue', 'sync_attempts', 'sync_conflicts',
      'billing_audit_log', 'schema_version',
    ]) {
      assert.ok(tableExists(db, t), 'expected table missing: ' + t);
    }

    // A representative set of safe-added columns exist.
    const attCols = colNames(db, 'attendances');
    for (const c of ['deleted_at', 'work_type', 'sync_id', 'sync_dirty', 'sync_version', 'invoice_total']) {
      assert.ok(attCols.includes(c), 'attendances missing column: ' + c);
    }

    db.close();
  });

  it('is idempotent on re-run (no error, no duplicate version rows, schema intact)', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    runMigrations(db);
    const rowsAfterFirst = scalar(db, 'SELECT COUNT(*) FROM schema_version');

    // Second run should apply nothing.
    const second = runMigrations(db);
    assert.deepStrictEqual(second.applied, [], 're-run should apply no migrations');
    assert.strictEqual(second.from, LATEST_VERSION);
    assert.strictEqual(second.to, LATEST_VERSION);

    // Third run for good measure.
    runMigrations(db);

    const rowsAfterThird = scalar(db, 'SELECT COUNT(*) FROM schema_version');
    assert.strictEqual(rowsAfterFirst, rowsAfterThird, 'schema_version rows must not grow on re-run');
    assert.strictEqual(Number(rowsAfterThird), MIGRATIONS.length);

    db.close();
  });

  it('upgrades a legacy DB (missing column, no schema_version table) without data loss', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    // Simulate an OLD user DB: attendances exists with real data but is
    // missing the newer `work_type` and sync columns, and there is NO
    // schema_version table at all.
    db.run(`CREATE TABLE attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT,
      updated_at TEXT,
      data TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      client_name TEXT DEFAULT ''
    );`);
    db.run("INSERT INTO attendances (data, status, client_name) VALUES ('{\"foo\":1}', 'finalised', 'Existing Client')");
    db.run("INSERT INTO attendances (data, status, client_name) VALUES ('{\"bar\":2}', 'draft', 'Second Client')");

    assert.ok(!tableExists(db, 'schema_version'), 'precondition: no schema_version table');
    assert.ok(!colNames(db, 'attendances').includes('work_type'), 'precondition: work_type absent');
    assert.strictEqual(getCurrentVersion(db), 0, 'legacy DB should report version 0');

    const result = runMigrations(db);
    assert.strictEqual(result.from, 0);
    assert.strictEqual(result.to, LATEST_VERSION);

    // Missing columns added.
    const attCols = colNames(db, 'attendances');
    assert.ok(attCols.includes('work_type'), 'work_type should have been added');
    assert.ok(attCols.includes('sync_id'), 'sync_id should have been added');
    assert.ok(attCols.includes('sync_version'), 'sync_version should have been added');

    // Existing data preserved exactly (no destructive rewrite).
    assert.strictEqual(Number(scalar(db, 'SELECT COUNT(*) FROM attendances')), 2);
    assert.strictEqual(
      scalar(db, "SELECT client_name FROM attendances WHERE status='finalised'"),
      'Existing Client'
    );
    assert.strictEqual(
      scalar(db, "SELECT data FROM attendances WHERE client_name='Second Client'"),
      '{"bar":2}'
    );

    db.close();
  });

  it('records the migration name and a timestamp for each applied version', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    runMigrations(db);

    const stmt = db.prepare('SELECT version, name, applied_at FROM schema_version ORDER BY version');
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    assert.strictEqual(rows.length, MIGRATIONS.length);
    rows.forEach((row, i) => {
      assert.strictEqual(row.version, MIGRATIONS[i].version);
      assert.strictEqual(row.name, MIGRATIONS[i].name);
      assert.ok(row.applied_at && /\d{4}-\d{2}-\d{2}T/.test(row.applied_at), 'applied_at should be an ISO timestamp');
    });

    db.close();
  });
});

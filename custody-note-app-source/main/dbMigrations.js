'use strict';

/**
 * main/dbMigrations.js
 * ----------------------------------------------------------------------------
 * Versioned, ordered schema migrations for the Custody Note attendance DB.
 *
 * WHY
 * ---
 * The historic pattern in main.js `initDb` was a long, flat list of
 * `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` and ad-hoc
 * `_safeAddColumn(...)` ALTERs that ran unconditionally on every startup.
 * That works, but it has no record of *what schema state a DB is at*, so we
 * could never reason about ordered upgrades, never skip already-applied work,
 * and had no place to hang a future destructive/data migration safely.
 *
 * This module introduces a `schema_version` table plus an ordered list of
 * NAMED migrations. The runner applies only migrations newer than the DB's
 * current recorded version, each inside a transaction, then records the
 * version it reached.
 *
 * BACKWARD COMPATIBILITY (critical — this app holds confidential legal data)
 * -------------------------------------------------------------------------
 * Existing user databases already contain every column/table/index below, but
 * they have NO `schema_version` table (recorded version = 0). On first launch
 * with this code:
 *   - version 0 is detected,
 *   - migration v1 ("baseline-schema") runs. Every statement in it is
 *     idempotent: tables/indexes use `IF NOT EXISTS`, and column adds go
 *     through `safeAddColumn`, which swallows the SQLite "duplicate column
 *     name" error. On an existing DB this is therefore a NO-OP — no data is
 *     touched, nothing is dropped or rewritten,
 *   - the DB is stamped as version 1.
 * A fresh DB runs the same baseline and ends up identically at version 1.
 * Re-running is a no-op because v1 <= current version.
 *
 * RULES FOR FUTURE MIGRATIONS
 * ---------------------------
 *   - NEVER renumber, reorder, or edit the body of an already-shipped
 *     migration. Append a new entry with the next integer version instead.
 *   - Prefer idempotent statements (defence in depth) even though the runner
 *     guarantees once-only execution.
 *   - Anything destructive (DROP/UPDATE that loses data) must be written to be
 *     provably safe and reversible-by-backup before shipping.
 */

/**
 * Duplicate-column-safe ALTER TABLE ADD COLUMN.
 * Mirrors the semantics of main.js `_safeAddColumn`: only the expected
 * "duplicate column name" error is swallowed; everything else is surfaced.
 */
function safeAddColumn(db, table, columnDef, logger) {
  try {
    db.run('ALTER TABLE ' + table + ' ADD COLUMN ' + columnDef);
  } catch (err) {
    const msg = (err && err.message) ? String(err.message) : '';
    if (/duplicate column name/i.test(msg)) return;
    if (logger && typeof logger.error === 'function') {
      logger.error('[schema] ALTER TABLE ' + table + ' ADD COLUMN ' + columnDef + ' failed:', msg);
    }
    throw err;
  }
}

/**
 * Ordered, named migrations. DO NOT reorder or edit shipped entries.
 * Each `up(ctx)` receives:
 *   ctx.run(sql)            -> db.run(sql)
 *   ctx.add(table, def)     -> safeAddColumn(db, table, def, logger)
 *   ctx.db                  -> the raw sql.js Database (escape hatch)
 */
const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline-schema',
    up(ctx) {
      const { run, add } = ctx;

      run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);

      run(`
        CREATE TABLE IF NOT EXISTS attendances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          data TEXT NOT NULL,
          status TEXT DEFAULT 'draft'
        );
      `);

      run(`
        CREATE TABLE IF NOT EXISTS officer_email_drafts (
          id TEXT PRIMARY KEY,
          custody_note_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          template_type TEXT NOT NULL,
          to_email TEXT DEFAULT '',
          recipient_name TEXT DEFAULT '',
          client_name TEXT DEFAULT '',
          police_station TEXT DEFAULT '',
          offence TEXT DEFAULT '',
          attendance_date TEXT DEFAULT '',
          attendance_time TEXT DEFAULT '',
          extra_note TEXT DEFAULT '',
          bail_return_date TEXT DEFAULT '',
          bail_conditions TEXT DEFAULT '',
          user_email_address TEXT DEFAULT '',
          subject TEXT DEFAULT '',
          body TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          opened_in_outlook_at TEXT,
          sent_manually_confirmed_at TEXT,
          cancelled_at TEXT,
          deleted_at TEXT
        );
      `);
      run(`CREATE INDEX IF NOT EXISTS idx_officer_email_drafts_custody_note_id ON officer_email_drafts (custody_note_id);`);
      run(`CREATE INDEX IF NOT EXISTS idx_officer_email_drafts_status ON officer_email_drafts (status);`);
      run(`CREATE INDEX IF NOT EXISTS idx_officer_email_drafts_updated_at ON officer_email_drafts (updated_at);`);
      add('officer_email_drafts', "attendance_time TEXT DEFAULT ''");

      run(`
        CREATE TABLE IF NOT EXISTS police_stations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          code TEXT NOT NULL,
          scheme TEXT DEFAULT '',
          region TEXT DEFAULT '',
          UNIQUE(name, code)
        );
      `);
      add('police_stations', "scheme TEXT DEFAULT ''");
      add('police_stations', "region TEXT DEFAULT ''");
      add('police_stations', "scheme_code TEXT DEFAULT ''");
      add('police_stations', "kind TEXT DEFAULT 'station'");

      run(`
        CREATE TABLE IF NOT EXISTS firms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          laa_account TEXT DEFAULT '',
          contact_name TEXT DEFAULT '',
          contact_email TEXT DEFAULT '',
          contact_phone TEXT DEFAULT '',
          address TEXT DEFAULT '',
          source_of_referral TEXT DEFAULT '',
          is_default INTEGER DEFAULT 0,
          UNIQUE(name)
        );
      `);
      add('firms', "contact_name TEXT DEFAULT ''");
      add('firms', "source_of_referral TEXT DEFAULT ''");

      run(`CREATE INDEX IF NOT EXISTS idx_attendances_updated ON attendances(updated_at);`);

      /* Audit log */
      run(`CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attendance_id INTEGER,
        action TEXT,
        previous_snapshot TEXT,
        changed_fields TEXT,
        timestamp TEXT DEFAULT (datetime('now')),
        user_note TEXT
      );`);
      run(`CREATE INDEX IF NOT EXISTS idx_audit_attendance ON audit_log(attendance_id);`);

      /* Sync queue (offline-first, per-record, one bad never blocks) */
      run(`CREATE TABLE IF NOT EXISTS sync_queue (
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
      run(`CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);`);
      run(`CREATE INDEX IF NOT EXISTS idx_sync_queue_record ON sync_queue(record_id);`);

      /* Sync attempt audit (for reliability and traceability) */
      run(`CREATE TABLE IF NOT EXISTS sync_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        correlation_id TEXT,
        direction TEXT NOT NULL,
        record_count INTEGER DEFAULT 0,
        success INTEGER NOT NULL,
        error_message TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );`);
      run(`CREATE INDEX IF NOT EXISTS idx_sync_attempts_created ON sync_attempts(created_at);`);

      run(`CREATE TABLE IF NOT EXISTS sync_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attendance_id INTEGER,
        sync_id TEXT,
        reason TEXT,
        local_version INTEGER DEFAULT 0,
        remote_version INTEGER DEFAULT 0,
        local_updated_at TEXT,
        remote_updated_at TEXT,
        remote_status TEXT,
        local_snapshot TEXT,
        remote_snapshot TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        resolved_at TEXT DEFAULT NULL,
        resolution_note TEXT DEFAULT ''
      );`);
      run(`CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open ON sync_conflicts(resolved_at, attendance_id);`);

      /* Soft-delete & indexed search columns (idempotent) */
      add('attendances', "deleted_at TEXT DEFAULT NULL");
      add('attendances', "deletion_reason TEXT DEFAULT NULL");
      add('attendances', "client_name TEXT DEFAULT ''");
      add('attendances', "station_name TEXT DEFAULT ''");
      add('attendances', "dscc_ref TEXT DEFAULT ''");
      add('attendances', "attendance_date TEXT DEFAULT ''");
      add('attendances', "supervisor_approved_at TEXT DEFAULT NULL");
      add('attendances', "supervisor_note TEXT DEFAULT ''");
      add('attendances', "archived_at TEXT DEFAULT NULL");
      add('attendances', "work_type TEXT DEFAULT ''");

      /* Billing / QuickFile invoice columns */
      add('attendances', "quickfile_invoice_id TEXT DEFAULT NULL");
      add('attendances', "quickfile_invoice_number TEXT DEFAULT NULL");
      add('attendances', "quickfile_invoice_url TEXT DEFAULT NULL");
      add('attendances', "invoice_created_at TEXT DEFAULT NULL");
      add('attendances', "invoice_created_by TEXT DEFAULT NULL");
      add('attendances', "invoice_subtotal REAL DEFAULT NULL");
      add('attendances', "invoice_vat REAL DEFAULT NULL");
      add('attendances', "invoice_total REAL DEFAULT NULL");
      add('attendances', "invoice_narrative TEXT DEFAULT NULL");
      add('attendances', "invoice_mileage_miles REAL DEFAULT NULL");
      add('attendances', "invoice_mileage_rate REAL DEFAULT NULL");
      add('attendances', "invoice_parking_amount REAL DEFAULT NULL");
      add('attendances', "invoice_attendance_fee REAL DEFAULT NULL");
      add('attendances', "invoice_vat_rate REAL DEFAULT NULL");

      /* Station mileage column */
      add('police_stations', "mileage_from_base REAL DEFAULT NULL");
      add('police_stations', "postcode TEXT DEFAULT ''");

      /* Billing audit log */
      run(`CREATE TABLE IF NOT EXISTS billing_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attendance_id INTEGER,
        action TEXT NOT NULL,
        details TEXT DEFAULT '',
        user_name TEXT DEFAULT '',
        timestamp TEXT DEFAULT (datetime('now'))
      );`);
      run(`CREATE INDEX IF NOT EXISTS idx_billing_audit_att ON billing_audit_log(attendance_id);`);

      /* Cross-device sync columns */
      add('attendances', "sync_id TEXT DEFAULT NULL");
      add('attendances', "sync_dirty INTEGER DEFAULT 1");
      add('attendances', "sync_version INTEGER DEFAULT 1");
      run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_att_sync_id ON attendances(sync_id);`);
      run(`CREATE INDEX IF NOT EXISTS idx_att_sync_dirty ON attendances(sync_dirty);`);

      run(`CREATE INDEX IF NOT EXISTS idx_att_client ON attendances(client_name);`);
      run(`CREATE INDEX IF NOT EXISTS idx_att_date ON attendances(attendance_date);`);
      run(`CREATE INDEX IF NOT EXISTS idx_att_dscc ON attendances(dscc_ref);`);
      run(`CREATE INDEX IF NOT EXISTS idx_att_status ON attendances(status);`);
      run(`CREATE INDEX IF NOT EXISTS idx_att_list ON attendances(deleted_at, archived_at, updated_at);`);
    },
  },
];

const LATEST_VERSION = MIGRATIONS.length
  ? MIGRATIONS[MIGRATIONS.length - 1].version
  : 0;

function ensureSchemaVersionTable(db) {
  db.run(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT,
    applied_at TEXT
  );`);
}

/**
 * Returns the highest recorded schema version (0 if none recorded / table
 * absent). Creates the schema_version table as a side-effect so callers can
 * read it safely on a brand-new DB.
 */
function getCurrentVersion(db) {
  ensureSchemaVersionTable(db);
  let version = 0;
  const stmt = db.prepare('SELECT MAX(version) AS v FROM schema_version');
  try {
    if (stmt.step()) {
      const row = stmt.getAsObject();
      version = row && row.v != null ? Number(row.v) : 0;
    }
  } finally {
    stmt.free();
  }
  return Number.isFinite(version) ? version : 0;
}

/**
 * Apply all migrations newer than the DB's recorded version.
 *
 * @param {object} db      A sql.js Database instance.
 * @param {object} [opts]
 * @param {object} [opts.logger]  { error(...) } sink; defaults to console.
 * @returns {{from:number,to:number,applied:number[],latest:number}}
 */
function runMigrations(db, opts) {
  if (!db) throw new Error('runMigrations: db is required');
  const options = opts || {};
  const logger = options.logger || console;

  ensureSchemaVersionTable(db);
  const from = getCurrentVersion(db);
  const applied = [];

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;

    const ctx = {
      db,
      run: (sql, params) => db.run(sql, params),
      add: (table, def) => safeAddColumn(db, table, def, logger),
    };

    let inTx = false;
    try {
      db.run('BEGIN');
      inTx = true;
      migration.up(ctx);
      db.run(
        'INSERT INTO schema_version (version, name, applied_at) VALUES (?,?,?)',
        [migration.version, migration.name, new Date().toISOString()]
      );
      db.run('COMMIT');
      inTx = false;
      applied.push(migration.version);
    } catch (err) {
      if (inTx) {
        try { db.run('ROLLBACK'); } catch (rollbackErr) {
          if (logger && typeof logger.error === 'function') {
            logger.error('[schema] ROLLBACK failed after migration v' + migration.version + ':', rollbackErr && rollbackErr.message);
          }
        }
      }
      const wrapped = new Error(
        'Schema migration v' + migration.version + ' (' + migration.name + ') failed: ' +
        (err && err.message ? err.message : String(err))
      );
      wrapped.cause = err;
      wrapped.migrationVersion = migration.version;
      throw wrapped;
    }
  }

  return { from, to: getCurrentVersion(db), applied, latest: LATEST_VERSION };
}

module.exports = {
  runMigrations,
  getCurrentVersion,
  safeAddColumn,
  MIGRATIONS,
  LATEST_VERSION,
};

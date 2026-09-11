'use strict';

/**
 * Pragmatic local record revision history (metadata + content hash only).
 * Enough to recover overwrite/conflict context without storing plaintext note bodies
 * in diagnostics. Full encrypted snapshots remain in generational CNDB backups.
 */

const crypto = require('crypto');

const DEFAULT_RETAIN_PER_RECORD = 20;

function hashRecordPayload(data) {
  const raw = typeof data === 'string' ? data : JSON.stringify(data == null ? '' : data);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * SQL DDL for record_revisions (idempotent via IF NOT EXISTS).
 */
function recordRevisionsTableSql() {
  return `CREATE TABLE IF NOT EXISTS record_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL,
    sync_id TEXT,
    sync_version INTEGER,
    status TEXT,
    content_hash TEXT NOT NULL,
    deleted_at TEXT,
    source TEXT DEFAULT 'local_save',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_record_revisions_att ON record_revisions(attendance_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_record_revisions_sync ON record_revisions(sync_id, sync_version);`;
}

/**
 * Insert a revision row if content hash changed (or force).
 * @param {object} ctx { dbRun, dbGet, dbAll }
 */
function appendRecordRevision(ctx, row, opts = {}) {
  if (!ctx || !ctx.dbRun || !row) return null;
  const attendanceId = row.attendance_id != null ? row.attendance_id : row.id;
  if (attendanceId == null) return null;
  const contentHash = row.content_hash || hashRecordPayload(row.data);
  const force = !!opts.force;
  if (!force && ctx.dbGet) {
    const last = ctx.dbGet(
      'SELECT content_hash FROM record_revisions WHERE attendance_id=? ORDER BY id DESC LIMIT 1',
      [attendanceId]
    );
    if (last && last.content_hash === contentHash) return { skipped: true, reason: 'unchanged' };
  }
  const createdAt = opts.nowIso || new Date().toISOString();
  ctx.dbRun(
    `INSERT INTO record_revisions
      (attendance_id, sync_id, sync_version, status, content_hash, deleted_at, source, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      attendanceId,
      row.sync_id || row.syncId || null,
      row.sync_version != null ? row.sync_version : (row.syncVersion != null ? row.syncVersion : null),
      row.status || null,
      contentHash,
      row.deleted_at || row.deletedAt || null,
      opts.source || 'local_save',
      createdAt,
    ]
  );
  pruneRecordRevisions(ctx, attendanceId, opts.retainPerRecord);
  return { ok: true, contentHash, createdAt };
}

function pruneRecordRevisions(ctx, attendanceId, retain) {
  const keep = retain != null ? Number(retain) : DEFAULT_RETAIN_PER_RECORD;
  if (!ctx || !ctx.dbAll || !ctx.dbRun || !Number.isFinite(keep) || keep < 1) return;
  try {
    const rows = ctx.dbAll(
      'SELECT id FROM record_revisions WHERE attendance_id=? ORDER BY id DESC',
      [attendanceId]
    ) || [];
    if (rows.length <= keep) return;
    const drop = rows.slice(keep);
    for (let i = 0; i < drop.length; i++) {
      ctx.dbRun('DELETE FROM record_revisions WHERE id=?', [drop[i].id]);
    }
  } catch (_) {}
}

/**
 * List recent revisions for a record (metadata only).
 */
function listRecordRevisions(ctx, attendanceId, limit = 20) {
  if (!ctx || !ctx.dbAll) return [];
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  return ctx.dbAll(
    `SELECT id, attendance_id, sync_id, sync_version, status, content_hash, deleted_at, source, created_at
     FROM record_revisions WHERE attendance_id=? ORDER BY id DESC LIMIT ?`,
    [attendanceId, lim]
  ) || [];
}

module.exports = {
  DEFAULT_RETAIN_PER_RECORD,
  hashRecordPayload,
  recordRevisionsTableSql,
  appendRecordRevision,
  pruneRecordRevisions,
  listRecordRevisions,
};

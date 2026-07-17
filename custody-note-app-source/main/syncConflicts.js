'use strict';

/**
 * main/syncConflicts.js
 * ----------------------------------------------------------------------------
 * Read + resolve logic for the `sync_conflicts` table, extracted so it can be
 * unit-tested against an in-memory sql.js DB without booting Electron.
 *
 * A conflict row is created by main.js `recordSyncConflict()` whenever a sync
 * pull found a newer remote record but could NOT safely apply it locally
 * (local record was finalised/completed, or had unsynced local edits). The
 * local record is left untouched; the remote snapshot is parked here for the
 * user to resolve.
 *
 * Resolution actions:
 *   - 'keep_local'    : discard the parked remote change, keep the local
 *                       record, bump its version + mark it dirty so the local
 *                       version re-propagates to other devices.
 *   - 'accept_remote' : overwrite the local record with the parked remote
 *                       snapshot.
 *
 * HARD RULE (mirrors syncPull): never SILENTLY overwrite a finalised/completed
 * local record. 'accept_remote' on such a record is blocked unless the caller
 * passes { force: true } (i.e. the user explicitly confirmed in the UI).
 */

const PROTECTED_STATUSES = new Set(['finalised', 'completed']);

function parseSnapshot(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

/**
 * List all open (unresolved) conflicts, each enriched with parsed local/remote
 * snapshots and the CURRENT local record status (which may differ from the
 * snapshot taken when the conflict was recorded).
 *
 * @param {object} ctx  { dbAll(sql, params), dbGet(sql, params) }
 */
function listOpenConflicts(ctx) {
  const { dbAll, dbGet } = ctx;
  const rows = dbAll(
    `SELECT id, attendance_id, sync_id, reason, local_version, remote_version,
            local_updated_at, remote_updated_at, remote_status,
            local_snapshot, remote_snapshot, created_at
       FROM sync_conflicts
      WHERE resolved_at IS NULL
      ORDER BY datetime(created_at) DESC, id DESC`
  ) || [];

  return rows.map((r) => {
    const localRow = r.attendance_id != null
      ? dbGet('SELECT id, status, updated_at FROM attendances WHERE id=?', [r.attendance_id])
      : null;
    return {
      id: r.id,
      attendanceId: r.attendance_id,
      syncId: r.sync_id || null,
      reason: r.reason || null,
      localVersion: r.local_version || 0,
      remoteVersion: r.remote_version || 0,
      localUpdatedAt: r.local_updated_at || null,
      remoteUpdatedAt: r.remote_updated_at || null,
      remoteStatus: r.remote_status || null,
      currentLocalStatus: localRow ? localRow.status : null,
      recordExists: !!localRow,
      local: parseSnapshot(r.local_snapshot),
      remote: parseSnapshot(r.remote_snapshot),
      createdAt: r.created_at || null,
    };
  });
}

/**
 * Resolve a single conflict.
 *
 * @param {object} ctx       { dbGet, dbRun, nowIso?, appendAuditLog? }
 * @param {number} conflictId
 * @param {string} resolution 'keep_local' | 'accept_remote'
 * @param {object} [opts]    { force?: boolean }
 * @returns {{ok:boolean, ...}} result describing what happened.
 */
function resolveConflict(ctx, conflictId, resolution, opts) {
  const options = opts || {};
  const { dbGet, dbRun } = ctx;
  const nowIso = ctx.nowIso || (() => new Date().toISOString());
  const appendAuditLog = ctx.appendAuditLog || (() => {});

  const id = Number(conflictId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, error: 'Invalid conflict id' };
  }

  const conflict = dbGet('SELECT * FROM sync_conflicts WHERE id=?', [id]);
  if (!conflict) return { ok: false, error: 'Conflict not found' };
  if (conflict.resolved_at) return { ok: true, alreadyResolved: true, attendanceId: conflict.attendance_id };

  const attendanceId = conflict.attendance_id;
  const local = attendanceId != null
    ? dbGet('SELECT id, status, sync_version, updated_at FROM attendances WHERE id=?', [attendanceId])
    : null;
  const now = nowIso();

  if (resolution === 'keep_local') {
    if (local) {
      // Win the next push: version must exceed whatever the remote had.
      const newVersion = Math.max(local.sync_version || 1, conflict.remote_version || 1) + 1;
      dbRun(
        'UPDATE attendances SET sync_dirty=1, sync_version=?, updated_at=? WHERE id=?',
        [newVersion, now, attendanceId]
      );
    }
    dbRun(
      'UPDATE sync_conflicts SET resolved_at=?, resolution_note=? WHERE id=?',
      [now, 'keep_local', id]
    );
    appendAuditLog(attendanceId, 'sync_conflict_resolved', {
      timestamp: now,
      userNote: 'User kept the local version; it will re-sync to other devices.',
    });
    return { ok: true, resolution: 'keep_local', attendanceId, requeue: !!local };
  }

  if (resolution === 'accept_remote') {
    const remote = parseSnapshot(conflict.remote_snapshot);
    if (!remote) {
      return { ok: false, error: 'Remote snapshot unavailable; cannot accept remote.' };
    }
    const localStatus = local ? local.status : null;
    const remoteStatus = remote.status || conflict.remote_status || 'draft';

    // Never silently overwrite a protected (finalised/completed) local record.
    if (local && PROTECTED_STATUSES.has(localStatus) && remoteStatus !== localStatus && !options.force) {
      return {
        ok: false,
        blocked: true,
        reason: 'protected_status',
        attendanceId,
        localStatus,
        remoteStatus,
        message: 'This record is "' + localStatus + '" on this device. Accepting the remote "' +
          remoteStatus + '" version would overwrite a protected record. Confirm explicitly to proceed.',
      };
    }

    if (local) {
      const remoteVersion = remote.version || conflict.remote_version || 1;
      dbRun(
        `UPDATE attendances SET data=?, status=?, updated_at=?, deleted_at=?, deletion_reason=?,
            client_name=?, station_name=?, dscc_ref=?, attendance_date=?,
            supervisor_approved_at=?, supervisor_note=?, archived_at=?, sync_dirty=0, sync_version=?
          WHERE id=?`,
        [
          remote.data, remoteStatus, remote.updatedAt || now,
          remote.deletedAt || null, remote.deletionReason || null,
          remote.clientName || '', remote.stationName || '', remote.dsccRef || '', remote.attendanceDate || '',
          remote.supervisorApprovedAt || null, remote.supervisorNote || '', remote.archivedAt || null,
          remoteVersion, attendanceId,
        ]
      );
    }
    dbRun(
      'UPDATE sync_conflicts SET resolved_at=?, resolution_note=? WHERE id=?',
      [now, options.force ? 'accept_remote_forced' : 'accept_remote', id]
    );
    appendAuditLog(attendanceId, 'sync_conflict_resolved', {
      timestamp: now,
      userNote: 'User accepted the remote version' +
        (options.force ? ' (explicitly forced over a protected local record).' : '.'),
    });
    return { ok: true, resolution: 'accept_remote', forced: !!options.force, attendanceId };
  }

  return { ok: false, error: 'Unknown resolution: ' + String(resolution) };
}

module.exports = {
  PROTECTED_STATUSES,
  parseSnapshot,
  listOpenConflicts,
  resolveConflict,
};

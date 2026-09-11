'use strict';

/**
 * Metadata-only save observability (no case content / note bodies).
 */

function buildAttendanceSaveLog({
  id,
  status,
  durable,
  syncDirty,
  pendingSync,
  op,
} = {}) {
  return {
    tag: 'SAVE',
    id: id != null ? id : null,
    status: status || null,
    durable: !!durable,
    syncDirty: syncDirty !== false,
    pendingSync: pendingSync !== false,
    op: op || 'attendance-save',
    at: new Date().toISOString(),
  };
}

/**
 * Coerce a value that might be a prior save-result object into a numeric id.
 * Prevents sql.js "unknown type ([object Object])" when callers pass the
 * structured save result back as `id`.
 */
function coerceAttendanceId(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'object' && value.id != null) {
    return coerceAttendanceId(value.id);
  }
  return null;
}

/**
 * Preload-facing unwrap: keep e2e/legacy callers on a numeric id, while still
 * returning error objects ({ error, message }) unchanged.
 * Use attendanceSaveDetailed / normalizeAttendanceSaveResult for durable meta.
 */
function unwrapAttendanceSaveForApi(result) {
  if (result == null) return result;
  if (typeof result === 'number' || typeof result === 'string') return result;
  if (typeof result === 'object') {
    if (result.error) return result;
    if (result.id != null) return result.id;
  }
  return result;
}

/**
 * Normalize attendance-save IPC result for renderer callers.
 * Supports legacy numeric id and object { id, durable, ... }.
 */
function normalizeAttendanceSaveResult(result) {
  if (result == null) {
    return { id: null, durable: false, pendingSync: false, syncDirty: false, error: null, raw: result };
  }
  if (typeof result === 'number' || typeof result === 'string') {
    return {
      id: result,
      // Bare id (preload unwrap) still means main finished finishAttendanceSaveResult,
      // which always attempts flushDbSync — treat as durable unless detailed says otherwise.
      durable: true,
      pendingSync: true,
      syncDirty: true,
      error: null,
      raw: result,
    };
  }
  if (typeof result === 'object') {
    return {
      id: result.id != null ? result.id : null,
      durable: result.durable === true,
      pendingSync: result.pendingSync !== false && !result.error,
      syncDirty: result.syncDirty !== false && !result.error,
      error: result.error || null,
      message: result.message || null,
      raw: result,
    };
  }
  return { id: null, durable: false, pendingSync: false, syncDirty: false, error: 'invalid_result', raw: result };
}

module.exports = {
  buildAttendanceSaveLog,
  coerceAttendanceId,
  unwrapAttendanceSaveForApi,
  normalizeAttendanceSaveResult,
};

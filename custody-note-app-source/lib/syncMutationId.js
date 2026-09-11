'use strict';

/**
 * Idempotent sync mutation IDs for the persistent outbox.
 *
 * Rules:
 * - Every enqueue gets a stable mutationId derived from sync_id + sync_version
 *   (plus operation). Retries of the SAME local version reuse the same id.
 * - Never dequeue / mark synced before server ack with written count.
 * - Ambiguous ack → safe retry (same mutationId).
 */

const crypto = require('crypto');

/**
 * @param {{ syncId?: string|null, syncVersion?: number|null, operation?: string|null, recordId?: string|number|null }} opts
 */
function buildMutationId(opts = {}) {
  const syncId = opts.syncId != null && String(opts.syncId).trim() !== ''
    ? String(opts.syncId).trim()
    : null;
  const version = Number(opts.syncVersion);
  const op = String(opts.operation || 'upsert').toLowerCase();
  const recordId = opts.recordId != null ? String(opts.recordId) : '';

  if (syncId && Number.isFinite(version) && version > 0) {
    return 'mut-' + syncId + '-v' + version + '-' + op;
  }

  // Fallback when sync_id not yet assigned: deterministic from record + version + op.
  const seed = [recordId || 'unknown', Number.isFinite(version) ? version : 0, op].join('|');
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
  return 'mut-local-' + hash + '-v' + (Number.isFinite(version) ? version : 0) + '-' + op;
}

/**
 * Should this queue row be removed / marked synced?
 * Only after confirmed ack.
 */
function mayClearOutboxEntry(ack = {}) {
  if (!ack || ack.confirmed !== true) return false;
  if (ack.ambiguous === true) return false;
  if (ack.written == null) return false;
  const written = Array.isArray(ack.written) ? ack.written.length : Number(ack.written);
  const sent = Number(ack.sentCount);
  if (!Number.isFinite(written) || written <= 0) return false;
  if (Number.isFinite(sent) && sent > 0 && written < sent) return false;
  return true;
}

/**
 * Ambiguous server responses must be retried safely (same mutationId).
 */
function isAmbiguousPushAck(resp, sentCount) {
  if (!resp) return true;
  if (resp.ok !== true) return false; // hard failure, not ambiguous
  if (sentCount > 0 && resp.written == null) return true;
  if (sentCount > 0) {
    const written = Array.isArray(resp.written) ? resp.written.length : Number(resp.written);
    if (!Number.isFinite(written)) return true;
  }
  return false;
}

/**
 * Parse mutationId from queue payload JSON if present.
 */
function readMutationIdFromPayload(payload) {
  if (!payload) return null;
  let obj = payload;
  if (typeof payload === 'string') {
    try { obj = JSON.parse(payload); } catch (_) { return null; }
  }
  if (obj && obj.mutationId) return String(obj.mutationId);
  return null;
}

module.exports = {
  buildMutationId,
  mayClearOutboxEntry,
  isAmbiguousPushAck,
  readMutationIdFromPayload,
};

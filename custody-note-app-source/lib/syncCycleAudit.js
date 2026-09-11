'use strict';

/**
 * Durable sync-cycle audit helpers.
 *
 * Production failure class (Mac Air-2, 2026-09-10): worker exited early on
 * auth_required / rate_limited / offline without updating lastSyncPullAt or
 * logging attempts — Settings still looked calm while sync had been dead for days.
 *
 * Every runCycle (including skips) must leave an auditable reason.
 */

const SYNC_SKIP_REASONS = Object.freeze({
  IN_PROGRESS: 'in_progress',
  RATE_LIMITED: 'rate_limited',
  AUTH_REQUIRED: 'auth_required',
  OFFLINE: 'offline',
  API_UNREACHABLE: 'api_unreachable',
  OK: 'ok',
  OK_EMPTY_OUTBOX: 'ok_empty_outbox',
  OK_PUSHED: 'ok_pushed',
  OK_PULLED: 'ok_pulled',
  ERROR: 'error',
  HEAL_PENDING: 'heal_pending',
  HEAL_RUNNING: 'heal_running',
  HEAL_BACKOFF: 'heal_backoff',
});

function normalizeSkipReason(reason) {
  if (reason == null || reason === '') return null;
  const s = String(reason).trim();
  return s || null;
}

/**
 * Build the persisted cycle snapshot written to settings / diagnostics.
 */
function buildCycleHeartbeat({
  at,
  reason,
  detail,
  rateLimitRemainingMs,
  connectivity,
} = {}) {
  const iso = at || new Date().toISOString();
  const skipReason = normalizeSkipReason(reason) || SYNC_SKIP_REASONS.OK;
  return {
    lastSyncCycleAt: iso,
    lastSyncSkipReason: skipReason,
    lastSyncSkipDetail: detail != null ? String(detail).slice(0, 500) : null,
    rateLimitRemainingMs: rateLimitRemainingMs != null ? Number(rateLimitRemainingMs) || 0 : 0,
    connectivity: connectivity || null,
  };
}

/**
 * True when the cycle outcome is a hard skip (no push/pull attempted).
 */
function isHardSkipReason(reason) {
  const r = normalizeSkipReason(reason);
  return (
    r === SYNC_SKIP_REASONS.RATE_LIMITED ||
    r === SYNC_SKIP_REASONS.AUTH_REQUIRED ||
    r === SYNC_SKIP_REASONS.OFFLINE ||
    r === SYNC_SKIP_REASONS.IN_PROGRESS ||
    r === SYNC_SKIP_REASONS.HEAL_BACKOFF
  );
}

/**
 * Human label for Settings / footer.
 */
function describeSkipReason(reason, opts = {}) {
  const r = normalizeSkipReason(reason);
  if (!r || r === SYNC_SKIP_REASONS.OK || r === SYNC_SKIP_REASONS.OK_EMPTY_OUTBOX) {
    return 'Last cycle completed';
  }
  if (r === SYNC_SKIP_REASONS.OK_PUSHED) return 'Last cycle pushed changes';
  if (r === SYNC_SKIP_REASONS.OK_PULLED) return 'Last cycle pulled changes';
  if (r === SYNC_SKIP_REASONS.RATE_LIMITED) {
    const rem = opts.rateLimitRemainingMs || 0;
    if (rem > 0 && rem < 90_000) {
      return 'Safe locally — sync waiting (~' + Math.max(1, Math.ceil(rem / 1000)) + 's)';
    }
    const mins = Math.max(1, Math.ceil((rem || 60000) / 60000));
    return 'Safe locally — sync waiting (~' + mins + 'm)';
  }
  if (r === SYNC_SKIP_REASONS.AUTH_REQUIRED) {
    return 'Activate licence / sign in to sync';
  }
  if (r === SYNC_SKIP_REASONS.OFFLINE) return 'Offline — sync paused';
  if (r === SYNC_SKIP_REASONS.API_UNREACHABLE) return 'API unreachable — will retry';
  if (r === SYNC_SKIP_REASONS.HEAL_PENDING || r === SYNC_SKIP_REASONS.HEAL_RUNNING) {
    return 'Healing empty cloud — re-uploading local records';
  }
  if (r === SYNC_SKIP_REASONS.HEAL_BACKOFF) return 'Empty-cloud heal waiting for backoff';
  if (r === SYNC_SKIP_REASONS.ERROR) return opts.detail || 'Last cycle error';
  if (r === SYNC_SKIP_REASONS.IN_PROGRESS) return 'Sync cycle already in progress';
  return String(r);
}

module.exports = {
  SYNC_SKIP_REASONS,
  normalizeSkipReason,
  buildCycleHeartbeat,
  isHardSkipReason,
  describeSkipReason,
};

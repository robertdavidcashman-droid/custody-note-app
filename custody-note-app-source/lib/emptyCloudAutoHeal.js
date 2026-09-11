'use strict';

/**
 * Empty-cloud auto-heal decision logic (pure — unit tested).
 *
 * Failure class: local notes exist, sync_dirty=0 / queue drained (often after a
 * pre-1.9.82 false push ack), cloud inventory unknown or proven 0, and the
 * worker keeps doing no-op incremental pulls forever. Robert must not hunt for
 * a hidden "Re-upload all" button.
 *
 * Rules:
 * - Never wipe local data.
 * - Probe from epoch before heal when inventory is unknown.
 * - Require written durability on push (caller uses assertPushAccepted).
 * - Cap retries with exponential backoff.
 */

const HEAL_BACKOFF_MS = Object.freeze([
  2 * 60 * 1000, // 2m
  15 * 60 * 1000, // 15m
  60 * 60 * 1000, // 1h
  6 * 60 * 60 * 1000, // 6h
  24 * 60 * 60 * 1000, // 24h
]);

const MAX_HEAL_ATTEMPTS = 8;
const STALE_CYCLE_PROBE_MS = 6 * 60 * 60 * 1000; // 6h without verified inventory

function nextHealBackoffMs(attemptCount) {
  const idx = Math.min(Math.max(0, Number(attemptCount) || 0), HEAL_BACKOFF_MS.length - 1);
  return HEAL_BACKOFF_MS[idx];
}

/**
 * Should we run a from-epoch cloud probe?
 * Prefer probing when local looks "fully synced" but cloud inventory is
 * unknown/empty, or when never verified a durable push on a full local DB.
 */
function shouldProbeCloudFromEpoch({
  localCount,
  dirtyCount,
  pendingCount,
  lastVerifiedCloudInventory,
  lastVerifiedCloudPushAt,
  lastProbeAt,
  healInProgress,
  healBackoffUntil,
  now,
  force,
} = {}) {
  const local = Number(localCount) || 0;
  if (local <= 0) return { probe: false, reason: 'no_local' };
  if (healInProgress) return { probe: false, reason: 'heal_in_progress' };

  const t = now != null ? Number(now) : Date.now();
  if (healBackoffUntil != null && t < Number(healBackoffUntil)) {
    return { probe: false, reason: 'heal_backoff' };
  }

  const dirty = Number(dirtyCount) || 0;
  const pending = Number(pendingCount) || 0;
  // Active uploads — let the normal push path run; only probe when idle-looking.
  if (dirty > 0 || pending > 0) {
    return { probe: false, reason: 'outbox_active' };
  }

  const inventory =
    lastVerifiedCloudInventory == null ? null : Number(lastVerifiedCloudInventory);

  if (force) return { probe: true, reason: 'forced' };

  if (inventory === 0) {
    return { probe: true, reason: 'inventory_empty' };
  }

  if (inventory != null && Number.isFinite(inventory) && inventory > 0) {
    return { probe: false, reason: 'inventory_nonempty' };
  }

  // inventory unknown (null): false-ack residue or never verified.
  // Probe when we have never confirmed a durable push this session/persist,
  // or when the last probe is stale.
  if (!lastVerifiedCloudPushAt) {
    if (lastProbeAt) {
      const last = Date.parse(String(lastProbeAt));
      if (Number.isFinite(last) && t - last < STALE_CYCLE_PROBE_MS) {
        return { probe: false, reason: 'probe_cooldown' };
      }
    }
    return { probe: true, reason: 'inventory_unknown_never_verified' };
  }

  if (lastProbeAt) {
    const last = Date.parse(String(lastProbeAt));
    if (Number.isFinite(last) && t - last < STALE_CYCLE_PROBE_MS) {
      return { probe: false, reason: 'probe_cooldown' };
    }
  }
  return { probe: true, reason: 'inventory_unknown_stale' };
}

/**
 * After a from-epoch pull: should we auto re-upload?
 */
function shouldAutoHealEmptyCloud({
  localCount,
  cloudReceivedFromEpoch,
  pulledFromEpoch,
  healAttemptCount,
  healInProgress,
  healBackoffUntil,
  now,
} = {}) {
  const local = Number(localCount) || 0;
  if (local <= 0) return { heal: false, reason: 'no_local' };
  if (!pulledFromEpoch) return { heal: false, reason: 'not_from_epoch' };
  if ((Number(cloudReceivedFromEpoch) || 0) > 0) {
    return { heal: false, reason: 'cloud_nonempty' };
  }
  if (healInProgress) return { heal: false, reason: 'heal_in_progress' };

  const attempts = Number(healAttemptCount) || 0;
  if (attempts >= MAX_HEAL_ATTEMPTS) {
    return { heal: false, reason: 'max_attempts' };
  }

  const t = now != null ? Number(now) : Date.now();
  if (healBackoffUntil != null && t < Number(healBackoffUntil)) {
    return { heal: false, reason: 'heal_backoff' };
  }

  return { heal: true, reason: 'empty_cloud_local_full' };
}

/**
 * Persistable heal state machine helpers.
 */
function buildHealState(prev = {}, patch = {}) {
  return {
    status: patch.status != null ? patch.status : (prev.status || 'idle'),
    attemptCount: patch.attemptCount != null ? patch.attemptCount : (prev.attemptCount || 0),
    lastProbeAt: patch.lastProbeAt !== undefined ? patch.lastProbeAt : (prev.lastProbeAt || null),
    lastHealAt: patch.lastHealAt !== undefined ? patch.lastHealAt : (prev.lastHealAt || null),
    lastResult: patch.lastResult !== undefined ? patch.lastResult : (prev.lastResult || null),
    lastError: patch.lastError !== undefined ? patch.lastError : (prev.lastError || null),
    backoffUntil: patch.backoffUntil !== undefined ? patch.backoffUntil : (prev.backoffUntil || null),
    localCountAtHeal: patch.localCountAtHeal !== undefined ? patch.localCountAtHeal : (prev.localCountAtHeal || null),
    verifyReceived: patch.verifyReceived !== undefined ? patch.verifyReceived : (prev.verifyReceived || null),
  };
}

function markHealAttemptStarted(prev, { nowIso, localCount } = {}) {
  const attempts = (Number(prev && prev.attemptCount) || 0) + 1;
  return buildHealState(prev, {
    status: 'running',
    attemptCount: attempts,
    lastHealAt: nowIso || new Date().toISOString(),
    lastError: null,
    localCountAtHeal: localCount != null ? localCount : null,
    backoffUntil: null,
  });
}

function markHealSuccess(prev, { nowIso, verifyReceived } = {}) {
  return buildHealState(prev, {
    status: 'verified',
    lastResult: 'ok',
    lastError: null,
    lastHealAt: nowIso || new Date().toISOString(),
    verifyReceived: verifyReceived != null ? verifyReceived : null,
    backoffUntil: null,
  });
}

function markHealFailure(prev, { nowIso, error, code, nowMs } = {}) {
  const attempts = Number(prev && prev.attemptCount) || 1;
  const backoffMs = nextHealBackoffMs(attempts - 1);
  const t = nowMs != null ? Number(nowMs) : Date.now();
  return buildHealState(prev, {
    status: 'failed',
    lastResult: code || 'failed',
    lastError: error ? String(error).slice(0, 500) : null,
    lastHealAt: nowIso || new Date().toISOString(),
    backoffUntil: t + backoffMs,
  });
}

module.exports = {
  HEAL_BACKOFF_MS,
  MAX_HEAL_ATTEMPTS,
  STALE_CYCLE_PROBE_MS,
  nextHealBackoffMs,
  shouldProbeCloudFromEpoch,
  shouldAutoHealEmptyCloud,
  buildHealState,
  markHealAttemptStarted,
  markHealSuccess,
  markHealFailure,
};

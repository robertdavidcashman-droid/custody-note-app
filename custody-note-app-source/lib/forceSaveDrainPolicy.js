'use strict';

/**
 * Force Save / Save Now central-drain policy.
 *
 * Rules:
 * - Never claim centralConfirmed unless drain stoppedReason === 'drained'
 *   with pending=0 and dirty=0.
 * - max_cycles must NOT surface as Synced — keep syncing / sync_problem /
 *   waiting and continue across worker poll sessions.
 * - Cap is sized from outbox depth so a user Force Save can finish a large
 *   push when the network is healthy (not an arbitrary 3-cycle stub).
 */

const { MAX_RECORDS_PER_CYCLE } = require('../main/syncWorker');

/** Absolute ceiling so a single IPC call cannot run forever under CI. */
const FORCE_SAVE_DRAIN_ABSOLUTE_MAX_CYCLES = 200;

/** Minimum cycles even for tiny outboxes (retry / heal headroom). */
const FORCE_SAVE_DRAIN_MIN_CYCLES = 10;

/**
 * @param {{ pendingCount?: number, dirtyCount?: number, recordsPerCycle?: number, absoluteMax?: number, minCycles?: number }} input
 * @returns {number}
 */
function computeForceSaveMaxCycles(input = {}) {
  const pending = Math.max(0, Number(input.pendingCount) || 0);
  const dirty = Math.max(0, Number(input.dirtyCount) || 0);
  const total = pending + dirty;
  const perCycle = Math.max(
    1,
    Number(input.recordsPerCycle) || MAX_RECORDS_PER_CYCLE || 100
  );
  const absoluteMax =
    input.absoluteMax != null
      ? Number(input.absoluteMax)
      : FORCE_SAVE_DRAIN_ABSOLUTE_MAX_CYCLES;
  const minCycles =
    input.minCycles != null ? Number(input.minCycles) : FORCE_SAVE_DRAIN_MIN_CYCLES;

  if (total === 0) return 0;
  // Enough cycles to drain + small retry buffer; never the old unsafe fixed-3.
  const needed = Math.ceil(total / perCycle) + 5;
  return Math.min(absoluteMax, Math.max(minCycles, needed));
}

/**
 * Map drain result → Force Save central fields. Never false-Synced.
 *
 * @param {{
 *   stoppedReason?: string|null,
 *   pending?: number,
 *   dirty?: number,
 *   lastError?: string|null,
 *   cycles?: number,
 * }} drain
 * @param {{ offline?: boolean, authRequired?: boolean }} hints
 */
function interpretForceSaveDrain(drain = {}, hints = {}) {
  const pending = Number(drain.pending) || 0;
  const dirty = Number(drain.dirty) || 0;
  const remaining = pending + dirty;
  const reason = String(drain.stoppedReason || '');

  if (hints.offline) {
    return {
      centralConfirmed: false,
      continueInBackground: remaining > 0,
      offline: true,
      rateLimited: false,
      authRequired: false,
      syncing: false,
      syncError: remaining > 0 ? 'Waiting for internet — local copy safe' : null,
      pendingCount: remaining,
      stoppedReason: reason || 'offline',
    };
  }
  if (hints.authRequired) {
    return {
      centralConfirmed: false,
      continueInBackground: remaining > 0,
      offline: false,
      rateLimited: false,
      authRequired: true,
      syncing: false,
      syncError: remaining > 0 ? 'Activate licence to sync — local copy safe' : null,
      pendingCount: remaining,
      stoppedReason: reason || 'auth_required',
    };
  }

  if (reason === 'drained' && remaining === 0) {
    return {
      centralConfirmed: true,
      continueInBackground: false,
      offline: false,
      rateLimited: false,
      authRequired: false,
      syncing: false,
      syncError: null,
      pendingCount: 0,
      stoppedReason: 'drained',
    };
  }

  if (reason === 'rate_limited') {
    return {
      centralConfirmed: false,
      continueInBackground: true,
      offline: false,
      rateLimited: true,
      authRequired: false,
      syncing: false,
      syncError: drain.lastError || 'Safe locally — sync waiting (rate limited briefly)',
      pendingCount: remaining,
      stoppedReason: 'rate_limited',
    };
  }

  if (reason === 'max_cycles' || remaining > 0) {
    return {
      centralConfirmed: false,
      continueInBackground: true,
      offline: false,
      rateLimited: false,
      authRequired: false,
      // Still in flight — honest Syncing, never Synced.
      syncing: true,
      syncError: drain.lastError || 'Central sync still pending — continuing in background',
      pendingCount: remaining,
      stoppedReason: reason || 'still_pending',
    };
  }

  return {
    centralConfirmed: false,
    continueInBackground: false,
    offline: false,
    rateLimited: false,
    authRequired: false,
    syncing: false,
    syncError: drain.lastError || null,
    pendingCount: remaining,
    stoppedReason: reason || 'unknown',
  };
}

/**
 * Persistable flag: Force Save asked background worker to keep draining.
 */
function shouldPersistDrainContinuation(interpretation) {
  return !!(interpretation && interpretation.continueInBackground === true);
}

module.exports = {
  FORCE_SAVE_DRAIN_ABSOLUTE_MAX_CYCLES,
  FORCE_SAVE_DRAIN_MIN_CYCLES,
  computeForceSaveMaxCycles,
  interpretForceSaveDrain,
  shouldPersistDrainContinuation,
};

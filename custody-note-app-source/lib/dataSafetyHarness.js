'use strict';

/**
 * Deterministic data-safety harness helpers.
 * Used by fault-injection / canary / chaos suites — no Electron required.
 *
 * Never-event invariant: once a canary is locally committed, no injected fault
 * may erase the last recoverable copy (local DB row, outbox, or verified backup).
 */

const crypto = require('crypto');

/** Mulberry32 — small seeded PRNG for reproducible chaos. */
function createSeededRng(seed) {
  let t = (Number(seed) >>> 0) || 1;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickChaosFault(rng, catalogue) {
  const list = Array.isArray(catalogue) && catalogue.length
    ? catalogue
    : DEFAULT_CHAOS_CATALOGUE;
  const idx = Math.floor(rng() * list.length) % list.length;
  return list[idx];
}

const DEFAULT_CHAOS_CATALOGUE = Object.freeze([
  'network_drop',
  'lost_ack',
  'ambiguous_ack',
  'written_zero',
  'http_429',
  'auth_expired',
  'empty_cloud_pull',
  'stale_device_absence',
  'disk_full',
  'force_quit_mid_flush',
  'partial_batch_ack',
  'wrong_written_ids',
]);

/**
 * Canary record factory — unique sync_id payloads for scale tests.
 */
function createCanary(index, opts = {}) {
  const i = Number(index) || 0;
  const syncId = opts.syncId || ('canary-' + String(i).padStart(6, '0') + '-' + (opts.suffix || 'x'));
  return {
    index: i,
    syncId,
    clientName: 'CANARY-' + i,
    stationName: opts.stationName || 'Fault Injection Station',
    attendanceDate: opts.attendanceDate || '2026-09-10',
    payloadHash: crypto
      .createHash('sha256')
      .update(syncId + '|' + i + '|' + (opts.seed || ''))
      .digest('hex')
      .slice(0, 24),
    createdAt: opts.createdAt || new Date().toISOString(),
  };
}

/**
 * Never-event check: every canary sync_id must still exist in at least one
 * recoverable location (local active row, pending/syncing outbox, or backup set).
 *
 * @param {{
 *   canaries: Array<{ syncId: string }>,
 *   localSyncIds: Set<string>|string[],
 *   outboxSyncIds?: Set<string>|string[],
 *   backupSyncIds?: Set<string>|string[],
 *   tombstonedSyncIds?: Set<string>|string[],
 * }} snapshot
 * @returns {{ ok: boolean, lost: string[], recoverable: number, total: number }}
 */
function assertNeverEventInvariant(snapshot = {}) {
  const canaries = Array.isArray(snapshot.canaries) ? snapshot.canaries : [];
  const local = toSet(snapshot.localSyncIds);
  const outbox = toSet(snapshot.outboxSyncIds);
  const backup = toSet(snapshot.backupSyncIds);
  const tombs = toSet(snapshot.tombstonedSyncIds);
  const lost = [];
  for (const c of canaries) {
    const id = c && c.syncId ? String(c.syncId) : null;
    if (!id) continue;
    // Explicit tombstone for matching sync_id is an intentional delete — not a never-event.
    if (tombs.has(id)) continue;
    if (local.has(id) || outbox.has(id) || backup.has(id)) continue;
    lost.push(id);
  }
  return {
    ok: lost.length === 0,
    lost,
    recoverable: canaries.length - lost.length,
    total: canaries.length,
  };
}

function toSet(value) {
  if (!value) return new Set();
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.map(String));
  return new Set([String(value)]);
}

/**
 * Consistency checker across two devices sharing one account SoT.
 * Local∪central must not lose ids that existed on either side without tombstone.
 */
function checkCrossDeviceConsistency(opts = {}) {
  const deviceA = toSet(opts.deviceASyncIds);
  const deviceB = toSet(opts.deviceBSyncIds);
  const central = toSet(opts.centralSyncIds);
  const tombs = toSet(opts.tombstonedSyncIds);
  const expected = new Set([...deviceA, ...deviceB, ...central]);
  const missingOnCentral = [];
  const missingOnA = [];
  const missingOnB = [];
  for (const id of expected) {
    if (tombs.has(id)) continue;
    if (!central.has(id) && (deviceA.has(id) || deviceB.has(id))) {
      // Pending outbox is allowed — caller passes pending separately if needed.
      if (!toSet(opts.pendingSyncIds).has(id)) missingOnCentral.push(id);
    }
    if (central.has(id) && !deviceA.has(id) && !toSet(opts.pendingPullA).has(id)) {
      // After pull, A should have it unless pull pending.
      if (opts.requireAConvergence) missingOnA.push(id);
    }
    if (central.has(id) && !deviceB.has(id) && !toSet(opts.pendingPullB).has(id)) {
      if (opts.requireBConvergence) missingOnB.push(id);
    }
  }
  return {
    ok: missingOnCentral.length === 0 && missingOnA.length === 0 && missingOnB.length === 0,
    missingOnCentral,
    missingOnA,
    missingOnB,
    accountLevelSoT: opts.licenceScoped !== false,
  };
}

/**
 * Startup circuit-breaker signals the app must honour.
 */
function evaluateStartupCircuitBreakers(input = {}) {
  const alerts = [];
  const localCount = Number(input.localActiveCount) || 0;
  const cloudCount = input.cloudActiveCount;
  const lastPullAt = input.lastSyncPullAt || null;
  const pending = Number(input.pendingCount) || 0;
  const dirty = Number(input.dirtyCount) || 0;

  if (localCount > 0 && cloudCount === 0) {
    alerts.push({
      level: 'critical',
      code: 'EMPTY_CLOUD_WITH_LOCAL',
      action: 'preserve_local_auto_heal',
    });
  }
  if (localCount > 0 && dirty === 0 && pending === 0 && cloudCount === 0) {
    alerts.push({
      level: 'critical',
      code: 'FALSE_SYNCED_EMPTY_CLOUD',
      action: 'mark_dirty_reupload_verify',
    });
  }
  if (lastPullAt && input.nowMs && input.stalePullMs) {
    const age = Number(input.nowMs) - new Date(lastPullAt).getTime();
    if (Number.isFinite(age) && age > Number(input.stalePullMs) && localCount > 0) {
      alerts.push({
        level: 'warning',
        code: 'STALE_PULL_CURSOR',
        action: 'force_pull_or_heal',
      });
    }
  }
  if (input.migrationShrink === true) {
    alerts.push({
      level: 'critical',
      code: 'MIGRATION_SHRINK',
      action: 'abort_migration_retain_prior',
    });
  }
  return {
    ok: !alerts.some((a) => a.level === 'critical'),
    alerts,
  };
}

module.exports = {
  createSeededRng,
  pickChaosFault,
  DEFAULT_CHAOS_CATALOGUE,
  createCanary,
  assertNeverEventInvariant,
  checkCrossDeviceConsistency,
  evaluateStartupCircuitBreakers,
};

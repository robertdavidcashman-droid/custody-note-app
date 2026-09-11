'use strict';

/**
 * Pure helpers for sync / empty-DB recovery UX and honest footer status.
 * Kept free of Electron so unit tests can pin the incident heuristics.
 */

/** Live DB larger than this with zero attendances is almost never a fresh install. */
const EMPTY_LARGE_DB_BYTES = 512 * 1024;

const EMPTY_CLOUD_ALARM_MESSAGE =
  'Records are still on this device, but the cloud has none for this licence. ' +
  'Custody Note will auto re-upload; you can also use Re-upload all. Do not use Full re-sync while the cloud is empty.';

/**
 * Windows incident class: encrypted attendances.db is multi-MB but Home shows
 * "No records yet". Surface a recover path instead of looking like a blank install.
 */
function detectEmptyLargeDb({ dbFileBytes, activeAttendanceCount } = {}) {
  const bytes = Number(dbFileBytes) || 0;
  const count = Number(activeAttendanceCount) || 0;
  return bytes >= EMPTY_LARGE_DB_BYTES && count === 0;
}

/**
 * Compute the next persisted cloud inventory after a pull.
 *
 * - From-epoch pulls are authoritative (including 0 = proven empty).
 * - Incremental received>0 proves the cloud is non-empty (at least that many).
 * - Incremental received=0 must NOT overwrite a known non-empty inventory
 *   (healthy steady state — no deltas) and must NOT invent an empty-cloud alarm.
 */
function nextCloudInventoryCount({
  previousInventory,
  pulledFromEpoch,
  receivedCount,
} = {}) {
  const received = Number(receivedCount) || 0;
  if (pulledFromEpoch) return received;
  if (received > 0) {
    const prev = previousInventory == null ? null : Number(previousInventory);
    if (prev == null || !Number.isFinite(prev) || prev <= 0) return received;
    return Math.max(prev, received);
  }
  if (previousInventory == null) return null;
  const prev = Number(previousInventory);
  return Number.isFinite(prev) ? prev : null;
}

/**
 * Local machine has records, and a from-epoch (or persisted inventory) pull
 * proved the cloud has 0 records for this licence.
 *
 * Dirty/pending must NOT suppress this alarm — after push-ack honesty (1.9.82)
 * failed/unconfirmed pushes leave dirty set, which previously hid the empty
 * cloud and looked like a calm "N pending" upload.
 *
 * Incremental pulls with received=0 are healthy steady state unless inventory
 * was already proven empty (or this pull itself was from-epoch).
 */
function detectLocalFullCloudEmpty({
  totalRecords,
  lastPullReceived,
  pullEverCompleted,
  pulledFromEpoch,
  lastVerifiedCloudInventory,
} = {}) {
  const total = Number(totalRecords) || 0;
  if (total <= 0) return false;
  if (!pullEverCompleted && lastVerifiedCloudInventory == null) return false;

  if (lastVerifiedCloudInventory != null) {
    const inv = Number(lastVerifiedCloudInventory);
    if (Number.isFinite(inv)) return inv === 0;
  }

  if (!pulledFromEpoch) return false;
  if (!pullEverCompleted) return false;
  return (Number(lastPullReceived) || 0) === 0;
}

/**
 * Never show a calm "Synced" / "Upload queue: clear" as the only story when
 * local has data, cloud pull is empty, last push lacked confirmed write, or
 * rate-limited with dirty pending.
 */
function shouldSuppressSyncedFooter({
  totalRecords,
  pendingChanges,
  dirtyPushCount,
  lastPullReceived,
  pullEverCompleted,
  lastVerifiedCloudPushAt,
  pulledFromEpoch,
  lastVerifiedCloudInventory,
  rateLimited,
  lastPushOk,
  authRequired,
  emptyCloudHealPending,
} = {}) {
  if (authRequired) return true;
  if (emptyCloudHealPending) return true;
  if (
    detectLocalFullCloudEmpty({
      totalRecords,
      lastPullReceived,
      pullEverCompleted,
      pulledFromEpoch,
      lastVerifiedCloudInventory,
    })
  ) {
    return true;
  }
  const pending = (Number(pendingChanges) || 0) + (Number(dirtyPushCount) || 0);
  if (rateLimited && pending > 0) return true;
  if (lastPushOk === false && pending > 0) return true;

  const total = Number(totalRecords) || 0;
  // Only treat "no verified push + received=0" as suspicious after a from-epoch pull
  // (or persisted empty inventory). Incremental empty pulls are healthy steady state.
  if (
    total > 0 &&
    !lastVerifiedCloudPushAt &&
    pullEverCompleted &&
    (pulledFromEpoch || lastVerifiedCloudInventory === 0) &&
    (Number(lastPullReceived) || 0) === 0
  ) {
    return true;
  }
  return false;
}

/**
 * Human-readable sync phase for Settings / diagnostics.
 * local_saved → pending → syncing → synced | failed | empty_cloud | auth_required | healing
 * (never claim synced without evidence).
 */
function deriveSyncPhase({
  inProgress,
  pendingChanges,
  dirtyPushCount,
  failedCount,
  rateLimited,
  lastError,
  totalRecords,
  lastPullReceived,
  pullEverCompleted,
  lastVerifiedCloudPushAt,
  pulledFromEpoch,
  lastVerifiedCloudInventory,
  lastPushOk,
  authRequired,
  emptyCloudHealPending,
  healStatus,
} = {}) {
  if (authRequired) return 'auth_required';
  const emptyCloud = detectLocalFullCloudEmpty({
    totalRecords,
    lastPullReceived,
    pullEverCompleted,
    pulledFromEpoch,
    lastVerifiedCloudInventory,
  });
  const pending =
    (Number(pendingChanges) || 0) + (Number(dirtyPushCount) || 0);
  if (healStatus === 'running' || (emptyCloudHealPending && healStatus === 'running')) {
    return 'healing';
  }
  // Empty-cloud alarm outranks "pending" so UI never looks merely queued.
  if (emptyCloud) return 'empty_cloud';
  if (emptyCloudHealPending && healStatus === 'failed') return 'empty_cloud';
  if (rateLimited) return 'failed';
  if (inProgress) return 'syncing';
  if ((Number(failedCount) || 0) > 0) return 'failed';
  // Sticky lastError alone is not a failure once the outbox is clear.
  if (lastError && pending > 0) return 'failed';
  if (lastPushOk === false && pending > 0) {
    return 'failed';
  }
  if (pending > 0) return 'pending';
  if (
    shouldSuppressSyncedFooter({
      totalRecords,
      pendingChanges,
      dirtyPushCount,
      lastPullReceived,
      pullEverCompleted,
      lastVerifiedCloudPushAt,
      pulledFromEpoch,
      lastVerifiedCloudInventory,
      rateLimited,
      lastPushOk,
      authRequired,
      emptyCloudHealPending,
    })
  ) {
    return 'local_saved';
  }
  if ((Number(totalRecords) || 0) > 0) return 'synced';
  return 'local_saved';
}

/**
 * True only when it is honest to show green / Synced / all-clear.
 */
function isSyncStatusHealthy({
  totalRecords,
  pendingChanges,
  dirtyPushCount,
  lastPullReceived,
  pullEverCompleted,
  lastVerifiedCloudPushAt,
  pulledFromEpoch,
  lastVerifiedCloudInventory,
  rateLimited,
  lastPushOk,
  failedCount,
  lastError,
  inProgress,
  authRequired,
  emptyCloudHealPending,
} = {}) {
  const pending =
    (Number(pendingChanges) || 0) + (Number(dirtyPushCount) || 0);
  if (authRequired) return false;
  if (emptyCloudHealPending) return false;
  if (inProgress) return false;
  if (rateLimited) return false;
  if ((Number(failedCount) || 0) > 0) return false;
  // Sticky in-memory lastError / default lastPush.ok=false must NOT keep the
  // footer in panic when the outbox is fully clear (healthy pull-only steady state).
  if (lastError && pending > 0) return false;
  if (pending > 0) return false;
  if (lastPushOk === false && pending > 0) return false;
  if (
    detectLocalFullCloudEmpty({
      totalRecords,
      lastPullReceived,
      pullEverCompleted,
      pulledFromEpoch,
      lastVerifiedCloudInventory,
    })
  ) {
    return false;
  }
  if (
    shouldSuppressSyncedFooter({
      totalRecords,
      pendingChanges,
      dirtyPushCount,
      lastPullReceived,
      pullEverCompleted,
      lastVerifiedCloudPushAt,
      pulledFromEpoch,
      lastVerifiedCloudInventory,
      rateLimited,
      lastPushOk,
      authRequired,
      emptyCloudHealPending,
    })
  ) {
    return false;
  }
  return (Number(totalRecords) || 0) >= 0;
}

function buildEmptyCloudAlarmMessage() {
  return EMPTY_CLOUD_ALARM_MESSAGE;
}

module.exports = {
  EMPTY_LARGE_DB_BYTES,
  EMPTY_CLOUD_ALARM_MESSAGE,
  detectEmptyLargeDb,
  nextCloudInventoryCount,
  detectLocalFullCloudEmpty,
  shouldSuppressSyncedFooter,
  deriveSyncPhase,
  isSyncStatusHealthy,
  buildEmptyCloudAlarmMessage,
};

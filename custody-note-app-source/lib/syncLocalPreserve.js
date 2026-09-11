'use strict';

/**
 * Local-first preserve rules for cloud pull / Full re-sync.
 * Empty cloud must NEVER wipe or hard-delete local-only attendances.
 * Soft-delete applies only when a remote tombstone for the same sync_id wins merge.
 */

const {
  evaluateTombstoneApply,
  staleDeviceAbsenceMayEraseCentral,
  wholeDatasetLastWriteWinsAllowed,
  remoteAbsenceImpliesLocalDelete,
} = require('./tombstoneRules');

/**
 * @param {{ remoteRecords?: Array, localActiveCount?: number }} opts
 * @returns {{ preserveLocal: true, mayWipeLocal: false, reason: string }}
 */
function emptyCloudPullPolicy(opts = {}) {
  const remotes = Array.isArray(opts.remoteRecords) ? opts.remoteRecords : [];
  const localActive = Number(opts.localActiveCount) || 0;
  if (remotes.length === 0 && localActive > 0) {
    return {
      preserveLocal: true,
      mayWipeLocal: false,
      reason: 'empty_cloud_keeps_local',
    };
  }
  return {
    preserveLocal: true,
    mayWipeLocal: false,
    reason: remotes.length === 0 ? 'empty_cloud_or_idle' : 'merge_only',
  };
}

/**
 * Hard DELETE of local rows during pull is forbidden.
 * Soft-delete via deleted_at for a matching sync_id is allowed when remote wins.
 * @param {{ operation?: string, hasMatchingSyncId?: boolean, remoteDeletedAt?: string|null }} op
 */
function isDestructivePullOperation(op = {}) {
  const operation = String(op.operation || '').toLowerCase();
  if (operation === 'hard_delete' || operation === 'wipe' || operation === 'replace_all') {
    return true;
  }
  if (operation === 'delete' && !op.hasMatchingSyncId) {
    return true;
  }
  if (operation === 'soft_delete' || operation === 'tombstone') {
    const gate = evaluateTombstoneApply({
      hasMatchingSyncId: !!op.hasMatchingSyncId,
      remoteDeletedAt: op.remoteDeletedAt || null,
    });
    return !gate.mayDeleteLocal;
  }
  return false;
}

/**
 * Guard used before applying a pull mutation batch.
 * Throws if any operation would wipe local-only data.
 */
function assertPullBatchNonDestructive(operations) {
  const ops = Array.isArray(operations) ? operations : [];
  for (let i = 0; i < ops.length; i++) {
    if (isDestructivePullOperation(ops[i])) {
      const err = new Error('REFUSING_DESTRUCTIVE_PULL: empty or unmatched delete would destroy local-only records');
      err.code = 'REFUSING_DESTRUCTIVE_PULL';
      throw err;
    }
  }
  return true;
}

/**
 * Full re-sync must only reset the pull cursor and merge — never clear attendances.
 */
function fullResyncMayDestroyLocalOnly() {
  return false;
}

module.exports = {
  emptyCloudPullPolicy,
  isDestructivePullOperation,
  assertPullBatchNonDestructive,
  fullResyncMayDestroyLocalOnly,
  evaluateTombstoneApply,
  staleDeviceAbsenceMayEraseCentral,
  wholeDatasetLastWriteWinsAllowed,
  remoteAbsenceImpliesLocalDelete,
};

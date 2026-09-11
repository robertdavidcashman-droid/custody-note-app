'use strict';

/**
 * Tombstone + absence rules for sync merge.
 * Absence on device B is NEVER deletion. Deletion requires an explicit tombstone
 * for the matching sync_id (deleted_at set on the remote record).
 */

/**
 * @param {{
 *   remoteDeletedAt?: string|null,
 *   hasMatchingSyncId?: boolean,
 *   localExists?: boolean,
 *   remotePresent?: boolean,
 * }} input
 * @returns {{ mayDeleteLocal: boolean, reason: string }}
 */
function evaluateTombstoneApply(input = {}) {
  const hasMatch = input.hasMatchingSyncId === true;
  const remoteTombstone = !!(input.remoteDeletedAt);
  if (!hasMatch) {
    return { mayDeleteLocal: false, reason: 'absence_is_not_deletion' };
  }
  if (!remoteTombstone) {
    return { mayDeleteLocal: false, reason: 'no_remote_tombstone' };
  }
  return { mayDeleteLocal: true, reason: 'explicit_tombstone_same_sync_id' };
}

/**
 * Stale device sending an incomplete inventory must not erase newer central records.
 * Client pull is merge-only; this guard documents the invariant for tests / callers.
 */
function staleDeviceAbsenceMayEraseCentral() {
  return false;
}

/**
 * Whole-dataset last-write-wins is prohibited.
 */
function wholeDatasetLastWriteWinsAllowed() {
  return false;
}

/**
 * Build a tombstone payload for intentional user delete (soft-delete).
 */
function buildTombstoneFields(nowIso, reason) {
  return {
    deletedAt: nowIso || new Date().toISOString(),
    deletionReason: reason || 'user_delete',
  };
}

/**
 * Remote record present without deleted_at cannot imply local hard delete.
 */
function remoteAbsenceImpliesLocalDelete() {
  return false;
}

module.exports = {
  evaluateTombstoneApply,
  staleDeviceAbsenceMayEraseCentral,
  wholeDatasetLastWriteWinsAllowed,
  buildTombstoneFields,
  remoteAbsenceImpliesLocalDelete,
};

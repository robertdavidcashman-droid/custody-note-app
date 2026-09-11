'use strict';

/**
 * Local vs cloud integrity report — metadata only, never auto-deletes.
 */

/**
 * @param {{
 *   localRows?: Array<{ syncId?: string|null, syncDirty?: boolean|null, status?: string, deletedAt?: string|null }>,
 *   cloudInventoryCount?: number|null,
 *   cloudSyncIds?: string[]|null,
 *   pulledFromEpoch?: boolean,
 * }} input
 */
function buildLocalCloudIntegrityReport(input = {}) {
  const localRows = Array.isArray(input.localRows) ? input.localRows : [];
  const cloudIds = Array.isArray(input.cloudSyncIds)
    ? input.cloudSyncIds.filter((id) => id != null && String(id).trim() !== '')
    : null;
  const cloudIdSet = cloudIds ? new Set(cloudIds.map(String)) : null;

  let localActive = 0;
  let localDirty = 0;
  let localSoftDeleted = 0;
  let localOnly = 0;
  let localOnlyDirty = 0;
  const localOnlySample = [];

  for (let i = 0; i < localRows.length; i++) {
    const row = localRows[i] || {};
    const deleted = !!(row.deletedAt || row.deleted_at);
    if (deleted) {
      localSoftDeleted++;
      continue;
    }
    localActive++;
    const dirty = row.syncDirty === true || row.sync_dirty === 1 || row.sync_dirty === true;
    if (dirty) localDirty++;
    const syncId = row.syncId != null ? String(row.syncId) : (row.sync_id != null ? String(row.sync_id) : '');
    if (cloudIdSet && syncId && !cloudIdSet.has(syncId)) {
      localOnly++;
      if (dirty) localOnlyDirty++;
      if (localOnlySample.length < 20) {
        localOnlySample.push({
          syncId,
          status: row.status || null,
          syncDirty: !!dirty,
        });
      }
    } else if (cloudIdSet && !syncId) {
      localOnly++;
      if (dirty) localOnlyDirty++;
      if (localOnlySample.length < 20) {
        localOnlySample.push({ syncId: null, status: row.status || null, syncDirty: !!dirty });
      }
    }
  }

  const inventory =
    input.cloudInventoryCount == null ? null : Number(input.cloudInventoryCount);
  const inventoryKnown = inventory != null && Number.isFinite(inventory);
  // Persisted inventory 0 survives incremental received=0 pulls; do not require
  // the latest pull to have been from-epoch (matches detectLocalFullCloudEmpty).
  const cloudEmptyProven =
    inventoryKnown && inventory === 0 && localActive > 0;

  const discrepancies = [];
  if (cloudEmptyProven) {
    discrepancies.push({
      code: 'local_present_cloud_empty',
      severity: 'error',
      localActive,
      cloudInventory: inventory,
      message: 'Local notes exist but verified cloud inventory is 0 — do not wipe local; use Re-upload all',
    });
  }
  if (cloudIdSet && localOnly > 0) {
    discrepancies.push({
      code: 'local_only_sync_ids',
      severity: cloudEmptyProven ? 'error' : 'warning',
      localOnly,
      localOnlyDirty,
      message: 'Some local sync_ids are absent from the cloud id set — preserve local; push or investigate',
    });
  }
  if (inventoryKnown && cloudIdSet && cloudIdSet.size !== inventory) {
    discrepancies.push({
      code: 'inventory_id_set_mismatch',
      severity: 'warning',
      cloudInventory: inventory,
      cloudIdCount: cloudIdSet.size,
      message: 'Cloud inventory count does not match provided sync id set size',
    });
  }

  return {
    at: new Date().toISOString(),
    localActive,
    localDirty,
    localSoftDeleted,
    localOnly,
    localOnlyDirty,
    localOnlySample,
    cloudInventoryCount: inventoryKnown ? inventory : null,
    cloudIdCount: cloudIdSet ? cloudIdSet.size : null,
    pulledFromEpoch: !!input.pulledFromEpoch,
    cloudEmptyProven,
    discrepancies,
    autoDelete: false,
    action: 'report_only',
  };
}

module.exports = {
  buildLocalCloudIntegrityReport,
};

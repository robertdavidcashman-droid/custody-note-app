'use strict';

/**
 * Whether to advance lastSyncPullAt after a pull cycle.
 * Do not advance if encrypted records were skipped (missing key or decrypt failure) —
 * otherwise those records are never requested again (pull uses since=cursor).
 */
function shouldAdvanceSyncPullCursor(stats) {
  const decryptFailed = stats.decryptFailed || 0;
  const noMasterKeySkipped = stats.noMasterKeySkipped || 0;
  if (decryptFailed > 0 || noMasterKeySkipped > 0) return false;
  return true;
}

module.exports = { shouldAdvanceSyncPullCursor };

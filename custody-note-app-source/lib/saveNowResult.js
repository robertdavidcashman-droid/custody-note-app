'use strict';

/**
 * User-facing copy for Save now / persist-and-backup results.
 * Delegates to Force Save status model so we never show ambiguous "Saved".
 */

const {
  buildForceSaveResult,
  FORCE_SAVE_STATES,
} = require('./forceSaveStatus');

function buildSaveNowUserMessage(result = {}) {
  // Prefer structured Force Save fields when present.
  if (result.forceSaveState || result.centralConfirmed != null || result.pendingCount != null) {
    const built = buildForceSaveResult({
      noteDurable: result.noteDurable,
      backupOk: result.backupOk,
      backupPath: result.backupPath || result.effectiveBackupFolder || null,
      centralConfirmed: result.centralConfirmed,
      pendingCount: result.pendingCount,
      syncAttempted: result.syncAttempted,
      offline: result.offline,
      waitingForInternet: result.waitingForInternet || result.offline,
      rateLimited: result.rateLimited,
      authRequired: result.authRequired,
      syncError: result.syncError || result.error,
      syncing: result.syncing,
      lastLocalSaveAt: result.lastLocalSaveAt,
      lastCentralSyncAt: result.lastCentralSyncAt,
      deviceId: result.deviceId,
    });
    return built.userMessage;
  }

  const folder = result.effectiveBackupFolder || result.backupFolder || null;
  const backupPath = result.backupPath || null;
  const offsite = result.offsiteBackupFolder || null;

  if (result.noteDurable && result.backupOk) {
    let msg = 'Safe locally';
    if (backupPath || folder) {
      msg += '. Backup written to ' + (backupPath || folder);
    }
    if (offsite) msg += ' (off-site also: ' + offsite + ')';
    msg += '. Central confirmation pending';
    return { level: 'success', message: msg, headline: 'Safe locally', state: FORCE_SAVE_STATES.SAFE_LOCALLY };
  }

  if (result.noteDurable && !result.backupOk) {
    return {
      level: 'warning',
      message:
        'Safe locally, but backup failed' +
        (result.error ? ': ' + result.error : '') +
        (folder ? '. Intended folder: ' + folder : '') +
        '. Open Settings → Backup. Central sync not confirmed.',
      headline: 'Safe locally',
      state: FORCE_SAVE_STATES.SAFE_LOCALLY,
    };
  }

  return {
    level: 'error',
    message:
      'Could not save note to disk' +
      (result.error ? ': ' + result.error : '') +
      '. Keep this record open and try Save now again.',
    headline: 'Attention required',
    state: FORCE_SAVE_STATES.ATTENTION_REQUIRED,
  };
}

module.exports = {
  buildSaveNowUserMessage,
};

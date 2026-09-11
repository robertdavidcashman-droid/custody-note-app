'use strict';

/**
 * Force Save / Save Now status model.
 *
 * Never show ambiguous "Saved" when meaning is only local or only hoped-cloud.
 * States distinguish durable local disk from central account SoT acknowledgement.
 */

const FORCE_SAVE_STATES = Object.freeze({
  ATTENTION_REQUIRED: 'attention_required',
  SAFE_LOCALLY: 'safe_locally',
  WAITING_FOR_INTERNET: 'waiting_for_internet',
  SYNCING: 'syncing',
  SYNC_PROBLEM_LOCAL_SAFE: 'sync_problem_local_safe',
  SAFE_LOCALLY_CENTRAL_CONFIRMED: 'safe_locally_central_confirmed',
});

/**
 * @param {{
 *   noteDurable?: boolean,
 *   backupOk?: boolean,
 *   centralConfirmed?: boolean,
 *   pendingCount?: number,
 *   syncAttempted?: boolean,
 *   offline?: boolean,
 *   rateLimited?: boolean,
 *   syncError?: string|null,
 *   authRequired?: boolean,
 * }} input
 */
function resolveForceSaveState(input = {}) {
  if (!input.noteDurable) {
    return FORCE_SAVE_STATES.ATTENTION_REQUIRED;
  }

  const pending = Number(input.pendingCount) || 0;
  // Backup failure must never be masked by a central-confirmed success state.
  if (input.centralConfirmed === true && pending === 0 && input.backupOk !== false) {
    return FORCE_SAVE_STATES.SAFE_LOCALLY_CENTRAL_CONFIRMED;
  }

  if (input.authRequired) {
    return FORCE_SAVE_STATES.SYNC_PROBLEM_LOCAL_SAFE;
  }
  if (input.rateLimited) {
    return FORCE_SAVE_STATES.SYNC_PROBLEM_LOCAL_SAFE;
  }
  if (input.offline || input.waitingForInternet) {
    return FORCE_SAVE_STATES.WAITING_FOR_INTERNET;
  }
  if (input.syncing || (input.syncAttempted && pending > 0 && !input.syncError)) {
    return FORCE_SAVE_STATES.SYNCING;
  }
  if (input.syncError || pending > 0) {
    return FORCE_SAVE_STATES.SYNC_PROBLEM_LOCAL_SAFE;
  }

  // Durable locally; central not yet confirmed this cycle.
  return FORCE_SAVE_STATES.SAFE_LOCALLY;
}

/**
 * User-facing copy — never "Saved" alone.
 * @param {string} state
 * @param {{
 *   lastLocalSaveAt?: string|null,
 *   lastCentralSyncAt?: string|null,
 *   pendingCount?: number,
 *   deviceId?: string|null,
 *   backupOk?: boolean,
 *   backupPath?: string|null,
 *   syncError?: string|null,
 * }} meta
 */
function buildForceSaveStatusMessage(state, meta = {}) {
  const pending = Number(meta.pendingCount) || 0;
  const device = meta.deviceId ? String(meta.deviceId).slice(0, 12) : null;
  const localAt = meta.lastLocalSaveAt || null;
  const centralAt = meta.lastCentralSyncAt || null;
  const bits = [];

  switch (state) {
    case FORCE_SAVE_STATES.ATTENTION_REQUIRED:
      return {
        level: 'error',
        state,
        headline: 'Attention required',
        message:
          'Could not confirm a durable local save. Keep this record open and press Save now again.',
        pendingCount: pending,
        lastLocalSaveAt: localAt,
        lastCentralSyncAt: centralAt,
        deviceId: device,
      };

    case FORCE_SAVE_STATES.SAFE_LOCALLY_CENTRAL_CONFIRMED:
      bits.push('Safe locally + central copy confirmed');
      if (meta.backupOk && meta.backupPath) bits.push('Backup: ' + meta.backupPath);
      if (localAt) bits.push('Local: ' + localAt);
      if (centralAt) bits.push('Central: ' + centralAt);
      if (device) bits.push('Device: ' + device);
      return {
        level: 'success',
        state,
        headline: 'Safe locally + central copy confirmed',
        message: bits.join(' · '),
        pendingCount: 0,
        lastLocalSaveAt: localAt,
        lastCentralSyncAt: centralAt,
        deviceId: device,
      };

    case FORCE_SAVE_STATES.WAITING_FOR_INTERNET:
      bits.push('Safe locally');
      bits.push('Waiting for internet');
      if (pending > 0) bits.push('Pending sync: ' + pending);
      if (localAt) bits.push('Local: ' + localAt);
      if (device) bits.push('Device: ' + device);
      return {
        level: 'info',
        state,
        headline: 'Safe locally · Waiting for internet',
        message: bits.join(' · '),
        pendingCount: pending,
        lastLocalSaveAt: localAt,
        lastCentralSyncAt: centralAt,
        deviceId: device,
      };

    case FORCE_SAVE_STATES.SYNCING:
      bits.push('Safe locally');
      bits.push('Syncing to central account store');
      if (pending > 0) bits.push('Pending: ' + pending);
      if (localAt) bits.push('Local: ' + localAt);
      if (device) bits.push('Device: ' + device);
      return {
        level: 'info',
        state,
        headline: 'Safe locally · Syncing',
        message: bits.join(' · '),
        pendingCount: pending,
        lastLocalSaveAt: localAt,
        lastCentralSyncAt: centralAt,
        deviceId: device,
      };

    case FORCE_SAVE_STATES.SYNC_PROBLEM_LOCAL_SAFE:
      bits.push('Sync problem — local copy safe');
      if (meta.syncError) bits.push(String(meta.syncError).slice(0, 160));
      if (pending > 0) bits.push('Pending: ' + pending);
      if (localAt) bits.push('Local: ' + localAt);
      if (device) bits.push('Device: ' + device);
      return {
        level: 'warning',
        state,
        headline: 'Sync problem — local copy safe',
        message: bits.join(' · '),
        pendingCount: pending,
        lastLocalSaveAt: localAt,
        lastCentralSyncAt: centralAt,
        deviceId: device,
      };

    case FORCE_SAVE_STATES.SAFE_LOCALLY:
    default:
      bits.push('Safe locally');
      if (meta.backupOk === false) bits.push('Backup not confirmed');
      else if (meta.backupOk && meta.backupPath) bits.push('Backup written');
      if (pending > 0) bits.push('Pending central sync: ' + pending);
      else if (meta.centralConfirmed !== true) bits.push('Central confirmation pending');
      if (localAt) bits.push('Local: ' + localAt);
      if (device) bits.push('Device: ' + device);
      return {
        level: meta.backupOk === false ? 'warning' : 'success',
        state: FORCE_SAVE_STATES.SAFE_LOCALLY,
        headline: 'Safe locally',
        message: bits.join(' · '),
        pendingCount: pending,
        lastLocalSaveAt: localAt,
        lastCentralSyncAt: centralAt,
        deviceId: device,
      };
  }
}

/**
 * Build full Force Save result surface for IPC / UI.
 */
function buildForceSaveResult(input = {}) {
  const state = resolveForceSaveState(input);
  const status = buildForceSaveStatusMessage(state, input);
  return {
    ok: !!input.noteDurable,
    noteDurable: !!input.noteDurable,
    backupOk: !!input.backupOk,
    centralConfirmed: !!input.centralConfirmed,
    forceSaveState: state,
    pendingCount: Number(input.pendingCount) || 0,
    lastLocalSaveAt: input.lastLocalSaveAt || null,
    lastCentralSyncAt: input.lastCentralSyncAt || null,
    deviceId: input.deviceId || null,
    syncAttempted: !!input.syncAttempted,
    syncError: input.syncError || null,
    offline: !!input.offline,
    rateLimited: !!input.rateLimited,
    authRequired: !!input.authRequired,
    userMessage: {
      level: status.level,
      message: status.message,
      headline: status.headline,
      state,
    },
    status,
  };
}

/** Forbidden ambiguous labels for Save Now UX. */
function isAmbiguousSavedLabel(text) {
  const t = String(text || '').trim().toLowerCase();
  if (t === 'saved' || t === '✓ saved' || t === 'saved.') return true;
  if (t === 'synced' || t === 'all saved') return true;
  return false;
}

module.exports = {
  FORCE_SAVE_STATES,
  resolveForceSaveState,
  buildForceSaveStatusMessage,
  buildForceSaveResult,
  isAmbiguousSavedLabel,
};

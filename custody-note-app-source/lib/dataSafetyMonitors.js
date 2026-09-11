'use strict';

/**
 * Fail-safe data-safety monitors (metadata only — no note bodies).
 * FAIL SAFE: do not overwrite known-good; warn; retain local.
 */

const { detectLocalFullCloudEmpty } = require('./syncRecoveryHints');

const SEVERITY = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
});

/**
 * Sudden local active-count drop vs last known good baseline.
 * @param {{ previousActiveCount?: number|null, currentActiveCount?: number|null, dropRatioThreshold?: number }} input
 */
function detectSuddenLocalCountDrop(input = {}) {
  const prev = Number(input.previousActiveCount);
  const curr = Number(input.currentActiveCount);
  const threshold = input.dropRatioThreshold != null ? Number(input.dropRatioThreshold) : 0.25;
  if (!Number.isFinite(prev) || prev < 5) {
    return { triggered: false, code: 'local_count_drop', severity: SEVERITY.INFO };
  }
  if (!Number.isFinite(curr)) {
    return { triggered: false, code: 'local_count_drop', severity: SEVERITY.INFO };
  }
  const drop = prev - curr;
  if (drop <= 0) {
    return { triggered: false, code: 'local_count_drop', severity: SEVERITY.INFO, previous: prev, current: curr };
  }
  const ratio = drop / prev;
  if (ratio >= threshold || (prev >= 10 && curr === 0)) {
    return {
      triggered: true,
      code: 'local_count_drop',
      severity: SEVERITY.CRITICAL,
      previous: prev,
      current: curr,
      drop,
      ratio,
      failSafe: 'retain_local_do_not_overwrite',
      message: 'Sudden local attendance count drop — retain known-good; do not accept empty replace',
    };
  }
  return { triggered: false, code: 'local_count_drop', severity: SEVERITY.INFO, previous: prev, current: curr, drop, ratio };
}

/**
 * Remote sync_id disappeared without an explicit tombstone.
 */
function detectRemoteDisappearWithoutTombstone(input = {}) {
  const previouslyKnown = Array.isArray(input.previouslyKnownSyncIds) ? input.previouslyKnownSyncIds : [];
  const currentRemote = Array.isArray(input.currentRemoteSyncIds) ? input.currentRemoteSyncIds : [];
  const tombstoned = new Set(
    (Array.isArray(input.tombstonedSyncIds) ? input.tombstonedSyncIds : []).map(String)
  );
  const currentSet = new Set(currentRemote.map(String));
  const missing = [];
  for (let i = 0; i < previouslyKnown.length; i++) {
    const id = String(previouslyKnown[i]);
    if (!id) continue;
    if (!currentSet.has(id) && !tombstoned.has(id)) {
      missing.push(id);
      if (missing.length >= 50) break;
    }
  }
  if (missing.length === 0) {
    return { triggered: false, code: 'remote_disappear_no_tombstone', severity: SEVERITY.INFO };
  }
  return {
    triggered: true,
    code: 'remote_disappear_no_tombstone',
    severity: SEVERITY.ERROR,
    missingCount: missing.length,
    missingSample: missing.slice(0, 20),
    failSafe: 'retain_local_do_not_delete',
    message: 'Remote ids absent without tombstone — absence is not deletion; retain local',
  };
}

/**
 * Revision / sync_version going backwards for same sync_id.
 */
function detectRevisionGoingBackwards(input = {}) {
  const localVersion = Number(input.localVersion);
  const remoteVersion = Number(input.remoteVersion);
  const localDirty = !!input.localDirty;
  if (!Number.isFinite(localVersion) || !Number.isFinite(remoteVersion)) {
    return { triggered: false, code: 'revision_backwards', severity: SEVERITY.INFO };
  }
  // Remote older than local while local is clean is a no-op (handled elsewhere).
  // Alarm when something tries to APPLY a lower remote version over higher local.
  if (input.applyingRemote === true && remoteVersion < localVersion) {
    return {
      triggered: true,
      code: 'revision_backwards',
      severity: SEVERITY.ERROR,
      localVersion,
      remoteVersion,
      localDirty,
      failSafe: 'skip_remote_keep_local',
      message: 'Refusing to apply lower remote sync_version over higher local',
    };
  }
  return { triggered: false, code: 'revision_backwards', severity: SEVERITY.INFO, localVersion, remoteVersion };
}

/**
 * Empty cloud with local data (proven inventory).
 */
function detectEmptyCloudWithLocal(input = {}) {
  const empty = detectLocalFullCloudEmpty({
    totalRecords: input.localActiveCount,
    lastPullReceived: input.lastPullReceived,
    pullEverCompleted: input.pullEverCompleted != null ? !!input.pullEverCompleted : true,
    pulledFromEpoch: !!input.pulledFromEpoch,
    lastVerifiedCloudInventory: input.lastVerifiedCloudInventory,
  });
  if (!empty) {
    return { triggered: false, code: 'empty_cloud_with_local', severity: SEVERITY.INFO };
  }
  return {
    triggered: true,
    code: 'empty_cloud_with_local',
    severity: SEVERITY.ERROR,
    failSafe: 'preserve_local_reupload',
    message: 'Local notes exist but cloud inventory is empty — do not wipe local',
  };
}

/**
 * Migration that would shrink active attendance count unreasonably.
 */
function detectMigrationShrink(input = {}) {
  const before = Number(input.beforeCount);
  const after = Number(input.afterCount);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before < 1) {
    return { triggered: false, code: 'migration_shrink', severity: SEVERITY.INFO };
  }
  if (after < before && (before - after) / before >= 0.1) {
    return {
      triggered: true,
      code: 'migration_shrink',
      severity: SEVERITY.CRITICAL,
      before,
      after,
      failSafe: 'abort_migration_restore_backup',
      message: 'Migration would shrink attendance count — abort and retain prior DB',
    };
  }
  return { triggered: false, code: 'migration_shrink', severity: SEVERITY.INFO, before, after };
}

/**
 * Auth / rate-limit / missing key signals.
 */
function detectAuthOrKeyProblems(input = {}) {
  const findings = [];
  if (input.rateLimited) {
    findings.push({
      triggered: true,
      code: 'rate_limited_429',
      severity: SEVERITY.WARNING,
      failSafe: 'pause_sync_keep_local',
      message: 'Sync rate-limited — local copy retained; backoff before retry',
    });
  }
  if (input.authRequired || input.authFailed) {
    findings.push({
      triggered: true,
      code: 'auth_required',
      severity: SEVERITY.ERROR,
      failSafe: 'block_cloud_keep_local',
      message: 'Licence/auth problem — do not treat cloud as empty; keep local',
    });
  }
  if (input.masterKeyMissing) {
    findings.push({
      triggered: true,
      code: 'master_key_missing',
      severity: SEVERITY.CRITICAL,
      failSafe: 'stop_sync_prompt_recovery',
      message: 'Encryption key missing — stop destructive sync; prompt recovery password',
    });
  }
  if (input.decryptFailure) {
    findings.push({
      triggered: true,
      code: 'decrypt_failure',
      severity: SEVERITY.ERROR,
      failSafe: 'skip_envelope_keep_local',
      message: 'Decrypt failure — skip remote envelope; never replace local with empty',
    });
  }
  return findings;
}

/**
 * Aggregate monitor pass for a sync/pull/save checkpoint.
 * @returns {{ ok: boolean, failSafe: boolean, findings: Array }}
 */
function runDataSafetyMonitors(input = {}) {
  const findings = [];
  const drop = detectSuddenLocalCountDrop(input);
  if (drop.triggered) findings.push(drop);

  const disappear = detectRemoteDisappearWithoutTombstone(input);
  if (disappear.triggered) findings.push(disappear);

  const rev = detectRevisionGoingBackwards(input);
  if (rev.triggered) findings.push(rev);

  const empty = detectEmptyCloudWithLocal(input);
  if (empty.triggered) findings.push(empty);

  const shrink = detectMigrationShrink(input);
  if (shrink.triggered) findings.push(shrink);

  findings.push(...detectAuthOrKeyProblems(input));

  const failSafe = findings.some(
    (f) => f.severity === SEVERITY.ERROR || f.severity === SEVERITY.CRITICAL
  );
  return {
    ok: findings.filter((f) => f.triggered).length === 0,
    failSafe,
    retainLocal: true,
    mayOverwriteKnownGood: false,
    findings: findings.filter((f) => f.triggered),
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  SEVERITY,
  detectSuddenLocalCountDrop,
  detectRemoteDisappearWithoutTombstone,
  detectRevisionGoingBackwards,
  detectEmptyCloudWithLocal,
  detectMigrationShrink,
  detectAuthOrKeyProblems,
  runDataSafetyMonitors,
};

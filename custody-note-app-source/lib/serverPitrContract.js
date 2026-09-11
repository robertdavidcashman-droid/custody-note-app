'use strict';

/**
 * Client contracts mirroring website server SoT PITR invariants.
 *
 * The website repo (custody-note-website) owns live `sot-pitr/{userId}/`
 * implementation. This module encodes the fail-safe contracts the desktop
 * app relies on so CI can prove them without production S3 access.
 *
 * Companion website commands (run in website checkout when available):
 *   npm test
 *   npm run test:data-safety   # if present
 *   node --test tests/ with pitr / sot / data-safety name filters
 * See docs/data-safety/WEBSITE-PITR-CONTRACT.md
 */

/**
 * Treat incomplete / failed server reads the same as the website contract:
 * 503 INCOMPLETE_SOT_READ and classifySyncInventoryResponse failure ≠ empty.
 */
function emptyOrFailedResponsePolicy(resp = {}) {
  const status = Number(resp.statusCode) || 0;
  const ok = resp.ok === true;
  const records = Array.isArray(resp.records) ? resp.records : null;
  const error = resp.error != null ? String(resp.error) : null;
  const code = resp.code != null ? String(resp.code) : null;

  if (status === 503 || code === 'INCOMPLETE_SOT_READ' || /INCOMPLETE_SOT_READ/i.test(error || '')) {
    return {
      treatAsAuthoritativeEmpty: false,
      mayWipeLocal: false,
      mayZeroInventory: false,
      reason: 'incomplete_sot_read',
    };
  }
  if (status >= 400 || error) {
    return {
      treatAsAuthoritativeEmpty: false,
      mayWipeLocal: false,
      mayZeroInventory: false,
      reason: 'failed_response',
    };
  }
  if (!ok) {
    return {
      treatAsAuthoritativeEmpty: false,
      mayWipeLocal: false,
      mayZeroInventory: false,
      reason: 'not_ok',
    };
  }
  if (records === null) {
    return {
      treatAsAuthoritativeEmpty: false,
      mayWipeLocal: false,
      mayZeroInventory: false,
      reason: 'missing_records_field',
    };
  }
  // Explicit empty array from a successful from-epoch pull may update inventory,
  // but still must not wipe local (handled by emptyCloudPullPolicy).
  return {
    treatAsAuthoritativeEmpty: records.length === 0,
    mayWipeLocal: false,
    mayZeroInventory: records.length === 0 && !!resp.pulledFromEpoch,
    reason: records.length === 0 ? 'explicit_empty_ok' : 'non_empty',
    recordCount: records.length,
  };
}

/**
 * Server SoT PITR lane must be independent of live KV mutation path.
 */
function serverPitrIndependenceContract(opts = {}) {
  const liveKeyPrefix = String(opts.liveSoTPrefix || 'sync/');
  const pitrKeyPrefix = String(opts.pitrPrefix || 'sot-pitr/');
  const sameBucketOk = opts.sameBucketAllowed !== false;
  return {
    ok:
      liveKeyPrefix !== pitrKeyPrefix &&
      !pitrKeyPrefix.startsWith(liveKeyPrefix) &&
      !liveKeyPrefix.startsWith(pitrKeyPrefix),
    liveSoTPrefix: liveKeyPrefix,
    pitrPrefix: pitrKeyPrefix,
    sameBucketAllowed: sameBucketOk,
    mayMirrorLiveDamageInstantly: false,
    restoreRequiresExplicitAction: true,
  };
}

/**
 * Fail-safe restore scoring for PITR snapshots.
 * Empty / corrupt / sudden-drop snapshots must not auto-apply over healthy live.
 */
function scorePitrRestoreCandidate(candidate = {}, live = {}) {
  const liveCount = Number(live.activeCount);
  const candCount =
    candidate.activeCount == null ? null : Number(candidate.activeCount);
  const reasons = [];
  let score = 100;

  if (candidate.readable === false || candidate.verified === false) {
    reasons.push('unreadable_or_unverified');
    score = 0;
  }
  if (candidate.magicOk === false) {
    reasons.push('bad_magic');
    score = 0;
  }
  if (
    Number.isFinite(liveCount) &&
    liveCount > 0 &&
    candCount === 0
  ) {
    reasons.push('empty_over_live');
    score = 0;
  }
  if (
    Number.isFinite(liveCount) &&
    liveCount >= 10 &&
    Number.isFinite(candCount) &&
    candCount < liveCount * 0.5
  ) {
    reasons.push('sudden_drop_vs_live');
    score = Math.min(score, 20);
  }
  if (candidate.emptyCloudMirror === true) {
    reasons.push('mirrors_live_central_damage');
    score = 0;
  }

  return {
    allowed: score >= 50,
    score,
    reasons,
    failSafe: score < 50 ? 'retain_live_refuse_auto_restore' : 'ok_explicit_restore',
  };
}

module.exports = {
  emptyOrFailedResponsePolicy,
  serverPitrIndependenceContract,
  scorePitrRestoreCandidate,
};

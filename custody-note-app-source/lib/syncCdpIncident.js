'use strict';

/**
 * Helpers for Mac CDP empty-cloud / restore-drain scenarios.
 * Kept pure so unit tests can pin the 2026-09 incident without Electron.
 */

/**
 * After a local restore that marks every non-deleted row dirty, dirty and
 * pending should equal totalRecords. A lower sample (e.g. dirty=11 of 66)
 * means either (a) CDP sampled mid-cycle while a false push-ack was clearing
 * dirty in batches, or (b) the restore mark/queue step did not finish.
 */
function explainRestoreDirtySample({ totalRecords, dirtyCount, pendingCount } = {}) {
  const total = Number(totalRecords) || 0;
  const dirty = Number(dirtyCount) || 0;
  const pending = Number(pendingCount) || 0;
  if (total <= 0) {
    return { ok: false, code: 'NO_RECORDS', message: 'No local records after restore' };
  }
  if (dirty === total && (pending === total || pending === dirty)) {
    return { ok: true, code: 'FULLY_MARKED', message: 'All local records marked dirty and queued' };
  }
  if (dirty < total && dirty > 0) {
    return {
      ok: false,
      code: 'PARTIAL_DIRTY_SAMPLE',
      message:
        'Dirty/pending (' +
        dirty +
        '/' +
        pending +
        ') is below totalRecords (' +
        total +
        '). Likely mid-cycle sample during push drain, or restore mark did not complete.',
    };
  }
  if (dirty === 0 && total > 0) {
    return {
      ok: false,
      code: 'DIRTY_CLEARED',
      message: 'Local records present but dirty=0 — push ack may have cleared dirty without a durable cloud write',
    };
  }
  return { ok: false, code: 'UNEXPECTED', message: 'Unexpected dirty/pending vs total' };
}

/**
 * Mac CDP failure class: lastSuccessfulPushAt set, lastAttempts pull-only,
 * pull received=0, dirty already 0.
 */
function detectFalsePushAckEmptyCloud({
  totalRecords,
  dirtyPushCount,
  pendingChanges,
  lastSuccessfulPushAt,
  lastPullReceived,
  pushAttemptsLogged,
  pullEverCompleted,
} = {}) {
  const total = Number(totalRecords) || 0;
  if (total <= 0) return false;
  if ((Number(dirtyPushCount) || 0) > 0) return false;
  if ((Number(pendingChanges) || 0) > 0) return false;
  if (!lastSuccessfulPushAt) return false;
  if (!pullEverCompleted) return false;
  if ((Number(lastPullReceived) || 0) !== 0) return false;
  // CDP showed lastAttempts pull-only — treat missing push logs as part of the class.
  if (pushAttemptsLogged === true) return false;
  return true;
}

module.exports = {
  explainRestoreDirtySample,
  detectFalsePushAckEmptyCloud,
};

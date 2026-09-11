'use strict';

/**
 * Dirty-flag policy for durable DB flush paths.
 *
 * Rule: clearing `_dbDirty` before a write completes is only safe if the
 * write succeeds. Timeout / failure / skip-without-write must restore dirty
 * so quit / Force Save never claim durable when bytes may not be on disk.
 */

/**
 * @param {{ timedOut?: boolean, ok?: boolean, skipped?: boolean, error?: string|null, wroteBytes?: number|null }} result
 * @returns {{ restoreDirty: boolean, reason: string }}
 */
function shouldRestoreDirtyAfterFlush(result = {}) {
  const r = result && typeof result === 'object' ? result : {};
  if (r.timedOut === true) {
    return { restoreDirty: true, reason: 'flush_timed_out' };
  }
  if (r.ok === false) {
    return { restoreDirty: true, reason: r.error ? 'flush_error' : 'flush_failed' };
  }
  if (r.skipped === true && !(Number(r.wroteBytes) > 0)) {
    // Skip with no bytes written: only safe if caller knew there was nothing to flush.
    // Force Save still verifies on-disk magic separately.
    return { restoreDirty: false, reason: 'flush_skipped_empty' };
  }
  if (r.ok === true) {
    return { restoreDirty: false, reason: 'flush_ok' };
  }
  // Unknown / incomplete result — fail closed.
  return { restoreDirty: true, reason: 'flush_unknown' };
}

/**
 * After a successful sync flush, Force Save must prove the on-disk file is a
 * real encrypted CNDB — existence alone is not durability.
 *
 * @param {{ dirty?: boolean, pathExists?: boolean, magicOk?: boolean, bytes?: number|null, minBytes?: number }} input
 * @returns {{ durable: boolean, reason: string }}
 */
function evaluatePostFlushDurability(input = {}) {
  if (input.dirty === true) {
    return { durable: false, reason: 'still_dirty' };
  }
  if (input.pathExists !== true) {
    return { durable: false, reason: 'missing_file' };
  }
  if (input.magicOk !== true) {
    return { durable: false, reason: 'bad_or_missing_magic' };
  }
  const minBytes = input.minBytes != null ? Number(input.minBytes) : 4;
  const bytes = Number(input.bytes);
  if (!Number.isFinite(bytes) || bytes < minBytes) {
    return { durable: false, reason: 'too_small' };
  }
  return { durable: true, reason: 'verified_cndb' };
}

module.exports = {
  shouldRestoreDirtyAfterFlush,
  evaluatePostFlushDurability,
};

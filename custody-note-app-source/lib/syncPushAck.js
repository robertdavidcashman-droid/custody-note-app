'use strict';

/**
 * Push acknowledgement rules for /api/sync/push.
 *
 * Production API (custodynote.com) validates the licence key, then
 * syncPushRecords(licence.hash, records) → S3 PutObject per syncId, and
 * returns { ok, written }. Rate limit: checkRateLimit("sync-push", ip, 120/hour)
 * → HTTP/body "Too many requests…".
 *
 * Clearing sync_dirty without a confirmed written count is the empty-cloud
 * failure class (Mac looks synced, Mac/Windows pull received=0).
 */

/**
 * Normalize server `written` to a count + optional syncId set.
 * When `written` is an array of syncIds, callers must only clear matching rows.
 *
 * @param {object} resp
 * @param {number} sentCount
 * @param {{ expectedSyncIds?: string[] }} [opts]
 */
function normalizeWrittenAck(resp, sentCount, opts = {}) {
  const sent = Number(sentCount) || 0;
  if (!resp || resp.ok !== true) {
    return { ok: false, writtenCount: 0, writtenIds: null, reason: 'not_ok' };
  }
  if (sent === 0) {
    return { ok: true, writtenCount: 0, writtenIds: null, reason: 'empty_send' };
  }
  if (resp.written == null) {
    return { ok: false, writtenCount: 0, writtenIds: null, reason: 'omitted' };
  }
  if (Array.isArray(resp.written)) {
    const ids = resp.written.map((v) => String(v)).filter(Boolean);
    const unique = new Set(ids);
    const expected = Array.isArray(opts.expectedSyncIds)
      ? opts.expectedSyncIds.map(String)
      : null;
    if (expected && expected.length > 0) {
      const matched = expected.filter((id) => unique.has(id));
      // Reject padding / wrong-id arrays that only match on length.
      if (matched.length < sent || unique.size < sent) {
        return {
          ok: false,
          writtenCount: matched.length,
          writtenIds: unique,
          reason: matched.length === 0 ? 'written_zero_or_mismatch' : 'partial_or_mismatch',
        };
      }
      return { ok: true, writtenCount: matched.length, writtenIds: unique, reason: 'id_match' };
    }
    if (ids.length < sent || unique.size < sent) {
      return {
        ok: false,
        writtenCount: unique.size,
        writtenIds: unique,
        reason: unique.size === 0 ? 'written_zero' : 'partial_ids',
      };
    }
    return { ok: true, writtenCount: unique.size, writtenIds: unique, reason: 'id_count' };
  }
  const written = Number(resp.written);
  if (!Number.isFinite(written) || written < sent) {
    return {
      ok: false,
      writtenCount: Number.isFinite(written) ? written : 0,
      writtenIds: null,
      reason: written === 0 ? 'written_zero' : 'partial_count',
    };
  }
  return { ok: true, writtenCount: written, writtenIds: null, reason: 'count_ok' };
}

function assertPushAccepted(resp, sentCount, opts = {}) {
  const sent = Number(sentCount) || 0;
  if (!resp || resp.ok !== true) {
    const err = new Error(resp && resp.error ? String(resp.error) : 'Push failed');
    if (resp && /too many requests|rate limit/i.test(String(resp.error || ''))) {
      err.statusCode = 429;
    }
    throw err;
  }
  if (sent === 0) return resp;
  const norm = normalizeWrittenAck(resp, sent, opts);
  if (!norm.ok) {
    let message;
    if (norm.reason === 'omitted') {
      message = 'Push unconfirmed: server omitted written count';
    } else if (norm.writtenCount === 0) {
      message = 'Push accepted 0 records (cloud write empty)';
    } else {
      message =
        `Push incomplete: wrote ${norm.writtenCount} of ${sent}` +
        (norm.reason ? ` (${norm.reason})` : '');
    }
    const err = new Error(message);
    err.code = 'PUSH_INCOMPLETE';
    err.statusCode = 503;
    err.writtenIds = norm.writtenIds;
    throw err;
  }
  return resp;
}

/** Default pause after a 429 when Retry-After is absent (legacy servers). */
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const RATE_LIMIT_JITTER_RATIO = 0.1;
const DEFAULT_RATE_LIMIT_RETRY_AFTER_SEC = 60;

function isRateLimitError(err) {
  if (!err) return false;
  const code = err.statusCode || err.status || err.code;
  if (code === 429 || code === '429') return true;
  const msg = err && (err.message || String(err)) ? String(err.message || err) : '';
  return /too many requests|rate limit/i.test(msg);
}

/**
 * Parse Retry-After (delta-seconds or HTTP-date) into whole seconds.
 * Falls back to defaultRetryAfterSec when missing/invalid.
 */
function parseRetryAfterSeconds(errOrHeader, nowMs, defaultRetryAfterSec) {
  const fallback =
    defaultRetryAfterSec != null ? defaultRetryAfterSec : DEFAULT_RATE_LIMIT_RETRY_AFTER_SEC;
  const raw =
    errOrHeader && typeof errOrHeader === 'object'
      ? errOrHeader.retryAfter != null
        ? errOrHeader.retryAfter
        : errOrHeader.retryAfterSeconds
      : errOrHeader;
  if (raw == null || raw === '') return fallback;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum >= 0) return Math.max(1, Math.ceil(asNum));
  const asDate = Date.parse(String(raw));
  if (!Number.isNaN(asDate)) {
    const now = nowMs != null ? nowMs : Date.now();
    return Math.max(1, Math.ceil((asDate - now) / 1000));
  }
  return fallback;
}

/**
 * Gate that skips sync cycles while rate-limited.
 * Prefer server Retry-After (+ small jitter); fall back to cooldownMs.
 */
function createRateLimitGate(options = {}) {
  const cooldownMs = options.cooldownMs != null ? options.cooldownMs : RATE_LIMIT_COOLDOWN_MS;
  const jitterRatio = options.jitterRatio != null ? options.jitterRatio : RATE_LIMIT_JITTER_RATIO;
  const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
  const randomFn = typeof options.random === 'function' ? options.random : Math.random;
  let blockedUntil = 0;
  let lastReason = null;
  let lastRetryAfterSec = null;

  function remainingMs() {
    return Math.max(0, blockedUntil - nowFn());
  }

  function isBlocked() {
    return remainingMs() > 0;
  }

  function blockFor(retryAfterSec) {
    const sec = Math.max(1, Math.ceil(Number(retryAfterSec) || cooldownMs / 1000));
    const baseMs = sec * 1000;
    const jitterMs = Math.floor(baseMs * jitterRatio * randomFn());
    blockedUntil = nowFn() + baseMs + jitterMs;
    lastRetryAfterSec = sec;
    return { blockedUntilMs: blockedUntil, waitMs: remainingMs(), retryAfterSec: sec, jitterMs };
  }

  return {
    noteError(err) {
      if (!isRateLimitError(err)) return false;
      const msg = err && (err.message || String(err)) ? String(err.message || err) : '';
      lastReason = msg || 'Too many requests';
      // Honour Retry-After when present; otherwise use legacy fixed cooldown.
      if (err && err.retryAfter != null && err.retryAfter !== '') {
        blockFor(parseRetryAfterSeconds(err, nowFn(), Math.ceil(cooldownMs / 1000)));
      } else {
        blockedUntil = nowFn() + cooldownMs;
        lastRetryAfterSec = Math.ceil(cooldownMs / 1000);
      }
      return true;
    },
    blockFor,
    isBlocked,
    remainingMs,
    reason() {
      return isBlocked() ? lastReason : null;
    },
    clear() {
      blockedUntil = 0;
      lastReason = null;
      lastRetryAfterSec = null;
    },
    snapshot() {
      return {
        blocked: isBlocked(),
        remainingMs: remainingMs(),
        reason: isBlocked() ? lastReason : null,
        cooldownMs,
        retryAfterSec: isBlocked() ? lastRetryAfterSec : null,
        blockedUntilMs: isBlocked() ? blockedUntil : null,
      };
    },
  };
}

module.exports = {
  assertPushAccepted,
  normalizeWrittenAck,
  createRateLimitGate,
  isRateLimitError,
  parseRetryAfterSeconds,
  RATE_LIMIT_COOLDOWN_MS,
  RATE_LIMIT_JITTER_RATIO,
  DEFAULT_RATE_LIMIT_RETRY_AFTER_SEC,
};

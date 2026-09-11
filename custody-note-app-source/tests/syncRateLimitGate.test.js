/**
 * Retry-After rate-limit gate / coalesce behaviour (v1.9.93).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  createRateLimitGate,
  isRateLimitError,
  parseRetryAfterSeconds,
  RATE_LIMIT_COOLDOWN_MS,
  RATE_LIMIT_JITTER_RATIO,
  DEFAULT_RATE_LIMIT_RETRY_AFTER_SEC,
} = require('../lib/syncPushAck');
const { describeSkipReason, SYNC_SKIP_REASONS } = require('../lib/syncCycleAudit');
const { deriveSyncFooterChip } = require('../lib/footerStatusChips');

describe('parseRetryAfterSeconds', () => {
  it('parses numeric seconds and HTTP-date', () => {
    assert.strictEqual(parseRetryAfterSeconds('45'), 45);
    assert.strictEqual(parseRetryAfterSeconds({ retryAfter: '12' }), 12);
    const now = Date.parse('2026-09-11T12:00:00.000Z');
    const header = new Date(now + 90_000).toUTCString();
    assert.strictEqual(parseRetryAfterSeconds(header, now), 90);
  });

  it('falls back when missing', () => {
    assert.strictEqual(parseRetryAfterSeconds(null), DEFAULT_RATE_LIMIT_RETRY_AFTER_SEC);
  });
});

describe('createRateLimitGate Retry-After + jitter', () => {
  it('backs off exactly Retry-After plus small jitter', () => {
    let now = 1_000_000;
    const gate = createRateLimitGate({
      now: () => now,
      random: () => 0.5,
      jitterRatio: 0.1,
      cooldownMs: RATE_LIMIT_COOLDOWN_MS,
    });
    const err = new Error('Too many requests');
    err.statusCode = 429;
    err.retryAfter = '40';
    assert.strictEqual(gate.noteError(err), true);
    const snap = gate.snapshot();
    assert.strictEqual(snap.blocked, true);
    assert.strictEqual(snap.retryAfterSec, 40);
    assert.strictEqual(snap.remainingMs, 40_000 + Math.floor(40_000 * 0.1 * 0.5));
    now += snap.remainingMs - 1;
    assert.strictEqual(gate.isBlocked(), true);
    now += 1;
    assert.strictEqual(gate.isBlocked(), false);
  });

  it('falls back to legacy cooldown when Retry-After absent', () => {
    let now = 2_000_000;
    const gate = createRateLimitGate({
      now: () => now,
      random: () => 0,
      jitterRatio: 0,
      cooldownMs: 120_000,
    });
    assert.strictEqual(gate.noteError({ statusCode: 429, message: 'Too many requests' }), true);
    assert.strictEqual(gate.remainingMs(), 120_000);
  });

  it('isRateLimitError detects 429 and message forms', () => {
    assert.strictEqual(isRateLimitError({ statusCode: 429 }), true);
    assert.strictEqual(isRateLimitError(new Error('Too many requests')), true);
    assert.strictEqual(isRateLimitError(new Error('Server error 500')), false);
  });

  it('exports a small production jitter ratio', () => {
    assert.ok(RATE_LIMIT_JITTER_RATIO > 0 && RATE_LIMIT_JITTER_RATIO <= 0.25);
  });
});

describe('rate-limit user messaging', () => {
  it('describeSkipReason says Safe locally — sync waiting', () => {
    const label = describeSkipReason(SYNC_SKIP_REASONS.RATE_LIMITED, { rateLimitRemainingMs: 25_000 });
    assert.match(label, /Safe locally — sync waiting/);
    assert.doesNotMatch(label, /data loss|not synced|lost/i);
  });

  it('footer chip is calm backup-ok, not offline alarm', () => {
    const chip = deriveSyncFooterChip({
      enabled: true,
      rateLimited: true,
      rateLimitRemainingMs: 20_000,
      pendingChanges: 2,
      dirtyPushCount: 0,
      failedCount: 0,
      blockedCount: 0,
      conflictCount: 0,
      totalRecords: 5,
      lastSync: '2026-09-11T12:00:00.000Z',
      lastPull: {},
      lastPush: { ok: null },
    });
    assert.strictEqual(chip.text, 'Safe locally — sync waiting');
    assert.strictEqual(chip.variant, 'backup-ok');
    assert.match(chip.title, /nothing was dropped/i);
  });
});

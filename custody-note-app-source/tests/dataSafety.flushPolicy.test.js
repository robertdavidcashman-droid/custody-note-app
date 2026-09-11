'use strict';

/**
 * Unit tests for flush dirty / post-flush durability policy (disk-full / timeout).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  shouldRestoreDirtyAfterFlush,
  evaluatePostFlushDurability,
} = require('../lib/flushDirtyPolicy');

describe('flushDirtyPolicy', () => {
  it('timeout and ENOSPC restore dirty', () => {
    assert.deepStrictEqual(shouldRestoreDirtyAfterFlush({ timedOut: true }), {
      restoreDirty: true,
      reason: 'flush_timed_out',
    });
    assert.strictEqual(shouldRestoreDirtyAfterFlush({ ok: false, error: 'ENOSPC' }).restoreDirty, true);
  });

  it('successful write does not restore dirty', () => {
    assert.strictEqual(shouldRestoreDirtyAfterFlush({ ok: true, wroteBytes: 2048 }).restoreDirty, false);
  });

  it('unknown result fails closed', () => {
    assert.strictEqual(shouldRestoreDirtyAfterFlush(null).restoreDirty, true);
    assert.strictEqual(shouldRestoreDirtyAfterFlush({ ok: true }).restoreDirty, false);
  });

  it('durability requires magic + not dirty', () => {
    assert.strictEqual(
      evaluatePostFlushDurability({ dirty: false, pathExists: true, magicOk: true, bytes: 50 }).durable,
      true
    );
    assert.strictEqual(
      evaluatePostFlushDurability({ dirty: false, pathExists: true, magicOk: false, bytes: 50 }).durable,
      false
    );
  });
});

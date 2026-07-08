'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { shouldAdvanceSyncPullCursor } = require('../lib/syncPullCursor');

describe('shouldAdvanceSyncPullCursor', () => {
  it('advances on empty pull', () => {
    assert.strictEqual(shouldAdvanceSyncPullCursor({ receivedCount: 0 }), true);
  });

  it('advances when all records merged or already current', () => {
    assert.strictEqual(shouldAdvanceSyncPullCursor({ receivedCount: 5, decryptFailed: 0 }), true);
  });

  it('does not advance when decrypt failed', () => {
    assert.strictEqual(shouldAdvanceSyncPullCursor({ receivedCount: 3, decryptFailed: 1 }), false);
  });

  it('does not advance when master key was missing', () => {
    assert.strictEqual(shouldAdvanceSyncPullCursor({ receivedCount: 2, noMasterKeySkipped: 2 }), false);
  });
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { normaliseReleaseTag } = require('../scripts/github-release-api.mjs');

describe('github-release-api', () => {
  it('normaliseReleaseTag adds v prefix', () => {
    assert.strictEqual(normaliseReleaseTag('1.9.34'), 'v1.9.34');
    assert.strictEqual(normaliseReleaseTag('v1.9.34'), 'v1.9.34');
  });
});

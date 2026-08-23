'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { normaliseReleaseTag, resolvePublishRepo } = require('../scripts/github-release-api.mjs');

describe('github-release-api', () => {
  it('normaliseReleaseTag adds v prefix', () => {
    assert.strictEqual(normaliseReleaseTag('1.9.34'), 'v1.9.34');
    assert.strictEqual(normaliseReleaseTag('v1.9.34'), 'v1.9.34');
  });

  it('resolvePublishRepo prefers PUBLISH_GITHUB_REPOSITORY', () => {
    const prevPublish = process.env.PUBLISH_GITHUB_REPOSITORY;
    const prevGithub = process.env.GITHUB_REPOSITORY;
    process.env.PUBLISH_GITHUB_REPOSITORY = 'robertdavidcashman-droid/custody-note-app';
    delete process.env.GITHUB_REPOSITORY;
    try {
      const { owner, repo } = resolvePublishRepo();
      assert.strictEqual(owner, 'robertdavidcashman-droid');
      assert.strictEqual(repo, 'custody-note-app');
    } finally {
      if (prevPublish === undefined) delete process.env.PUBLISH_GITHUB_REPOSITORY;
      else process.env.PUBLISH_GITHUB_REPOSITORY = prevPublish;
      if (prevGithub === undefined) delete process.env.GITHUB_REPOSITORY;
      else process.env.GITHUB_REPOSITORY = prevGithub;
    }
  });
});

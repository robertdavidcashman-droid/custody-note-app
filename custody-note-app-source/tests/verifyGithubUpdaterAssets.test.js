'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/release-publish.yml'), 'utf8');

describe('verify-github-updater-assets helpers', async () => {
  const mod = await import('../scripts/verify-github-updater-assets.mjs');

  it('parseYamlFeed reads electron-builder files array', () => {
    const yaml = [
      'version: 1.9.47',
      'files:',
      '  - url: Custody-Note-1.9.47-arm64.zip',
      '    sha512: abc123',
      '    size: 100',
      '  - url: Custody-Note-1.9.47-x64.zip',
      '    sha512: def456',
      '    size: 200',
    ].join('\n');
    const files = mod.parseYamlFeed(yaml);
    assert.strictEqual(files.length, 2);
    assert.strictEqual(files[0].url, 'Custody-Note-1.9.47-arm64.zip');
    assert.strictEqual(files[0].sha512, 'abc123');
    assert.strictEqual(files[1].size, '200');
  });

  it('sha512Base64 hashes deterministically', () => {
    const hash = mod.sha512Base64(Buffer.from('custody-note'));
    assert.match(hash, /^[A-Za-z0-9+/]+=*$/);
    assert.strictEqual(hash, mod.sha512Base64(Buffer.from('custody-note')));
  });
});

describe('release workflow hardening', () => {
  it('preflights Apple credentials before the Mac build (fail-closed — no skip-notary)', () => {
    assert.match(workflow, /preflight-apple-notary\.mjs/);
    assert.doesNotMatch(workflow, /^\s*CN_SKIP_NOTARIZE\s*:/m);
    assert.doesNotMatch(workflow, /CN_SKIP_NOTARIZE:\s*\$\{\{/);
    const preflightIdx = workflow.indexOf('id: notary-preflight');
    assert.ok(preflightIdx !== -1);
    const preflightBlock = workflow.slice(preflightIdx, preflightIdx + 500);
    assert.doesNotMatch(preflightBlock, /continue-on-error:\s*true/);
    const scriptIdx = workflow.indexOf('preflight-apple-notary.mjs');
    const buildIdx = workflow.indexOf('npm run build:mac:signed');
    assert.ok(scriptIdx !== -1 && buildIdx !== -1);
    assert.ok(scriptIdx < buildIdx);
  });

  it('regenerates latest-mac.yml after Mac upload', () => {
    assert.match(workflow, /repair-github-mac-updater-feed\.mjs/);
    const repairIdx = workflow.indexOf('repair-github-mac-updater-feed.mjs');
    const publishIdx = workflow.indexOf('publish-release:');
    assert.ok(repairIdx !== -1 && publishIdx !== -1);
    assert.ok(repairIdx < publishIdx);
  });
});

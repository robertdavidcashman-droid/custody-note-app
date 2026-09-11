'use strict';

/**
 * Locks fail-closed notarization for GitHub Release / CI, while keeping
 * CN_SKIP_NOTARIZE as a local/dev-only escape (never for publish).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'scripts', 'build-mac-signed.mjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release-publish.yml'), 'utf8');

describe('build-mac-signed.mjs — CN_SKIP_NOTARIZE local escape only', () => {
  it('reads CN_SKIP_NOTARIZE from the environment', () => {
    assert.match(src, /CN_SKIP_NOTARIZE/);
    assert.match(src, /SKIP_NOTARIZE/);
  });

  it('disables electron-builder notarize when skipping', () => {
    assert.match(src, /notarize:\s*!SKIP_NOTARIZE/);
  });

  it('uses codesign --verify instead of hard-failing spctl when skipping', () => {
    assert.match(src, /codesign/);
    assert.match(src, /--verify/);
    assert.match(src, /notarization skipped/i);
  });

  it('still requires APPLE_TEAM_ID for Developer ID identity selection', () => {
    assert.match(src, /APPLE_TEAM_ID/);
    assert.match(src, /Developer ID Application/);
  });

  it('does not require APPLE_APP_SPECIFIC_PASSWORD when skipping notarization', () => {
    // Password validation must sit inside the non-skip branch.
    const skipBlockStart = src.indexOf('if (SKIP_NOTARIZE)');
    const elseStart = src.indexOf('} else {', skipBlockStart);
    const passwordFormatCheck = src.indexOf('xxxx-xxxx-xxxx-xxxx', elseStart);
    assert.ok(skipBlockStart !== -1 && elseStart !== -1 && passwordFormatCheck !== -1);
    assert.ok(passwordFormatCheck > elseStart);
  });

  it('refuses CN_SKIP_NOTARIZE in CI or when CN_PUBLISH is set', () => {
    assert.match(src, /SKIP_NOTARIZE && \(IS_CI \|\| PUBLISH_MODE\)/);
    assert.match(src, /not allowed for CI or GitHub Release publish/);
    assert.match(src, /Unnotarized Developer ID|signed-but-unnotarized/i);
  });
});

describe('build-mac-signed.mjs — Gatekeeper before upload', () => {
  it('runs spctl on built .app and .dmg contents when notarizing', () => {
    assert.match(src, /spctlAssessApp/);
    assert.match(src, /spctlAssessDmgContents/);
    assert.match(src, /hdiutil/);
    assert.match(src, /Unnotarized Developer ID/i);
  });

  it('does not pass publish to electron-builder during the build phase', () => {
    // buildOpts must not set publish — upload happens after spctl.
    assert.match(src, /Never pass publish here|build phase does not publish/i);
    assert.match(src, /upload-mac-release-assets\.mjs/);
    const buildCall = src.indexOf('artefacts = await build(buildOpts)');
    assert.ok(buildCall !== -1);
    const slice = src.slice(Math.max(0, buildCall - 400), buildCall);
    assert.doesNotMatch(slice, /buildOpts\.publish\s*=/);
  });

  it('uploads only after Gatekeeper assessment passes', () => {
    const assessIdx = src.indexOf('running spctl --assess on each built .app');
    const uploadIdx = src.indexOf('upload-mac-release-assets.mjs');
    assert.ok(assessIdx !== -1 && uploadIdx !== -1);
    assert.ok(assessIdx < uploadIdx, 'spctl must run before upload script');
  });
});

describe('release-publish.yml — fail-closed notarization', () => {
  it('does not soft-fail notarization preflight or set CN_SKIP_NOTARIZE', () => {
    assert.match(workflow, /preflight-apple-notary\.mjs/);
    assert.match(workflow, /id:\s*notary-preflight/);
    // Must not assign the skip flag in CI (header may still name the local escape).
    assert.doesNotMatch(workflow, /^\s*CN_SKIP_NOTARIZE\s*:/m);
    assert.doesNotMatch(workflow, /CN_SKIP_NOTARIZE:\s*\$\{\{/);
    // continue-on-error must not sit on the notary preflight step.
    const preflightIdx = workflow.indexOf('id: notary-preflight');
    assert.ok(preflightIdx !== -1);
    const preflightBlock = workflow.slice(preflightIdx, preflightIdx + 500);
    assert.doesNotMatch(preflightBlock, /continue-on-error:\s*true/);
    assert.match(workflow, /Fail-closed|fail-closed|FAIL/i);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const wfPath = path.resolve(__dirname, '..', '.github', 'workflows', 'release-publish.yml');
const wf = fs.readFileSync(wfPath, 'utf8');

describe('release-publish.yml — cross-platform build pipeline', () => {
  it('has a dedicated Windows job', () => {
    assert.match(wf, /^\s*release-windows:/m);
    assert.match(wf, /runs-on:\s*windows-latest/);
    assert.match(wf, /electron-builder --win --publish always/);
  });

  it('has a dedicated macOS job that runs on macos-latest', () => {
    assert.match(wf, /^\s*release-mac:/m);
    assert.match(wf, /runs-on:\s*macos-latest/);
    assert.match(wf, /npm run build:mac:signed/);
  });

  it('imports the Developer ID certificate into a temporary keychain', () => {
    // Must NOT install into the login keychain; must use a temp keychain.
    assert.match(wf, /security create-keychain/);
    assert.match(wf, /security set-key-partition-list/);
    assert.match(wf, /apple-tool:,apple:,codesign:/);
    assert.doesNotMatch(wf, /login\.keychain/);
  });

  it('passes all required Apple credentials to the build', () => {
    for (const k of [
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
      'MAC_CERTIFICATE_P12_BASE64',
      'MAC_CERTIFICATE_P12_PASSWORD',
      'MAC_KEYCHAIN_PASSWORD',
    ]) {
      assert.match(wf, new RegExp(`secrets\\.${k}`), `expected workflow to reference secrets.${k}`);
    }
  });

  it('publishes the release only after BOTH platform asset sets are present', () => {
    assert.match(wf, /^\s*publish-release:/m);
    assert.match(wf, /needs:\s*\[release-windows,\s*release-mac\]/);
    assert.match(wf, /latest\.yml/);
    assert.match(wf, /latest-mac\.yml/);
    assert.match(wf, /Custody-Note-\$\{VERSION\}-arm64\.dmg/);
    assert.match(wf, /Custody-Note-\$\{VERSION\}-x64\.dmg/);
    assert.match(wf, /Custody-Note-Setup-\$\{VERSION\}\.exe/);
    assert.match(wf, /--draft=false --latest/);
  });

  it('deploys the website only after the release is fully published', () => {
    assert.match(wf, /^\s*deploy-website:/m);
    assert.match(wf, /needs:\s*publish-release/);
  });

  it('does not have the legacy single-platform "release" job', () => {
    // The old job was named `release:` (Windows only). The new layout splits
    // platforms. If someone reintroduces a `release:` job, the publish gating
    // breaks because it would no longer wait for Mac assets.
    assert.doesNotMatch(wf, /^\s*release:\s*$/m);
  });
});

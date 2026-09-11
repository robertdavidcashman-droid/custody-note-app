'use strict';

/**
 * bump-website-download-version.mjs — releases.json already current → exit 0.
 *
 * Reproduces the deploy-website failure mode where historical versions inside
 * data/releases.json were mistaken for live download pins after hardcoded UI
 * pins were removed.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawnSync } = require('child_process');

const root = join(__dirname, '..');
const script = join(root, 'scripts', 'bump-website-download-version.mjs');

function runBump(websiteRoot, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      WEBSITE_ROOT: websiteRoot,
      SOFTEN_NOTARY_COPY: '0',
      ...env,
    },
  });
}

function makeWebsiteFixture({ version, releases }) {
  const websiteRoot = mkdtempSync(join(tmpdir(), 'cn-bump-website-'));
  mkdirSync(join(websiteRoot, 'data'), { recursive: true });
  mkdirSync(join(websiteRoot, 'app', 'download'), { recursive: true });

  writeFileSync(
    join(websiteRoot, 'data', 'releases.json'),
    JSON.stringify({ version, releases }, null, 2) + '\n',
    'utf8',
  );

  // Download UI no longer hardcodes a version pin (reads getLatestVersion()).
  writeFileSync(
    join(websiteRoot, 'app', 'download', 'page.tsx'),
    `export default function DownloadPage() {\n  return <p>Download Custody Note</p>;\n}\n`,
    'utf8',
  );

  return websiteRoot;
}

describe('bump-website-download-version.mjs', () => {
  it('exits 0 as no-op when releases.json already matches TO_VERSION', () => {
    const websiteRoot = makeWebsiteFixture({
      version: '1.9.89',
      releases: [
        { version: '1.9.89', latest: true, notes: ['current'] },
        { version: '1.9.88', notes: ['previous'] },
        { version: '1.9.87', notes: ['older'] },
      ],
    });

    try {
      const result = runBump(websiteRoot, { TO_VERSION: '1.9.89' });
      assert.equal(
        result.status,
        0,
        `expected exit 0, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
      assert.match(result.stdout, /releases\.json already at 1\.9\.89/);
      assert.doesNotMatch(result.stderr, /No version strings were replaced/);

      const reportPath = join(websiteRoot, '.bump-website-download-report.json');
      assert.ok(existsSync(reportPath));
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      assert.equal(report.to, '1.9.89');
      assert.equal(report.from, '1.9.89');
      assert.equal(report.versionReplacements, 0);
    } finally {
      rmSync(websiteRoot, { recursive: true, force: true });
    }
  });

  it('still fails when releases.json is behind and no pins can be updated', () => {
    const websiteRoot = makeWebsiteFixture({
      version: '1.9.88',
      releases: [
        { version: '1.9.88', latest: true, notes: ['stale'] },
        { version: '1.9.87', notes: ['older'] },
      ],
    });

    try {
      const result = runBump(websiteRoot, { TO_VERSION: '1.9.89' });
      assert.equal(
        result.status,
        1,
        `expected exit 1 when site is behind, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
      assert.match(result.stderr, /No version strings were replaced/);
      assert.match(result.stderr, /releases\.json is at 1\.9\.88, expected 1\.9\.89/);
    } finally {
      rmSync(websiteRoot, { recursive: true, force: true });
    }
  });

  it('script documents releases.json no-op success path', () => {
    const src = readFileSync(script, 'utf8');
    assert.match(src, /readReleasesJsonVersion/);
    assert.match(src, /releases\.json already at/);
    assert.match(src, /success \(no-op\)/);
    assert.match(src, /getLatestVersion/);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const releaseSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'scripts', 'release.mjs'),
  'utf8',
);

describe('release.mjs — Mac assets guard', () => {
  it('demotes a release to prerelease when latest-mac.yml is missing', () => {
    assert.match(releaseSrc, /latest-mac\.yml/);
    assert.match(releaseSrc, /Demoting v.* to prerelease/);
    assert.match(releaseSrc, /prerelease:\s*true/);
  });

  it('exposes an escape hatch flag for intentional Mac-less releases', () => {
    assert.match(releaseSrc, /--allow-missing-mac-assets/);
  });

  it('verifies GitHub latest before applying the guard', () => {
    assert.match(releaseSrc, /releases\/latest/);
    assert.match(releaseSrc, /latestAssetNames/);
  });
});

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const updaterSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'updater.js'),
  'utf8',
);
const stateSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'updateState.js'),
  'utf8',
);

describe('updater.js — download failure circuit breaker', () => {
  it('defines MAX_DOWNLOAD_FAILURES separate from install failures', () => {
    assert.match(updaterSrc, /MAX_DOWNLOAD_FAILURES\s*=\s*3/);
    assert.match(updaterSrc, /MAX_FAILED_INSTALLS\s*=\s*2/);
  });

  it('tracks consecutiveDownloadFailures in persisted state', () => {
    assert.match(stateSrc, /consecutiveDownloadFailures/);
    assert.match(stateSrc, /downloadFailureVersion/);
    assert.match(updaterSrc, /handleDownloadFailure/);
  });

  it('does not reset download failure count on update-available', () => {
    const block = updaterSrc.match(/autoUpdater\.on\('update-available'[\s\S]*?\n\s*\}\);/);
    assert.ok(block, 'update-available handler missing');
    assert.doesNotMatch(block[0], /resetDownloadFailureState/);
    assert.doesNotMatch(block[0], /consecutiveDownloadFailures:\s*0/);
  });

  it('resets download failure count only on update-downloaded', () => {
    const block = updaterSrc.match(/autoUpdater\.on\('update-downloaded'[\s\S]*?\n\s*\}\);/);
    assert.ok(block, 'update-downloaded handler missing');
    assert.match(block[0], /resetDownloadFailureState\(\)/);
  });

  it('enters recovery mode after repeated download failures', () => {
    assert.match(updaterSrc, /count >= MAX_DOWNLOAD_FAILURES/);
    assert.match(updaterSrc, /downloadFailure:\s*true/);
  });

  it('clears updater cache on checksum errors before retry', () => {
    assert.match(updaterSrc, /clearUpdaterPendingCache/);
    assert.match(updaterSrc, /isChecksumError/);
  });
});

'use strict';

/**
 * Updater feed cache-busting — forced checks must not reuse a sticky GitHub
 * latest.yml / provider client (Windows false "up to date").
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const updaterSrc = fs.readFileSync(path.join(__dirname, '..', 'updater.js'), 'utf8');

describe('updater.js — feed cache busting', () => {
  it('sets Cache-Control / Pragma no-cache on autoUpdater.requestHeaders', () => {
    assert.match(updaterSrc, /autoUpdater\.requestHeaders/);
    assert.match(updaterSrc, /Cache-Control['"]?\s*:\s*['"]no-cache/);
    assert.match(updaterSrc, /Pragma:\s*['"]?no-cache|Pragma:\s*no-cache/);
  });

  it('defines bustUpdaterFeedCache that clears cache and nulls clientPromise', () => {
    assert.match(updaterSrc, /function bustUpdaterFeedCache/);
    const start = updaterSrc.indexOf('function bustUpdaterFeedCache');
    const body = updaterSrc.slice(start, start + 800);
    assert.match(body, /clearUpdaterPendingCache\(\)/);
    assert.match(body, /clientPromise\s*=\s*null/);
    assert.match(body, /X-CustodyNote-Update-Check/);
  });

  it('forced checkForUpdates calls bustUpdaterFeedCache before check', () => {
    const start = updaterSrc.indexOf('async function checkForUpdates');
    assert.ok(start > 0);
    const body = updaterSrc.slice(start, start + 2800);
    const bustIdx = body.indexOf('bustUpdaterFeedCache(source)');
    const checkIdx = body.indexOf('autoUpdater.checkForUpdates()');
    assert.ok(bustIdx > 0, 'must call bustUpdaterFeedCache');
    assert.ok(checkIdx > bustIdx, 'bust must run before checkForUpdates');
    assert.match(body, /if \(force\) \{\s*bustUpdaterFeedCache/);
  });

  it('clears LOCALAPPDATA updater cache roots on Windows', () => {
    assert.match(updaterSrc, /LOCALAPPDATA/);
    assert.match(updaterSrc, /custody-note-updater/);
    assert.match(updaterSrc, /Custody Note-updater/);
  });
});

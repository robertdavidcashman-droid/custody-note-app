/**
 * tests/macSigningDefault.test.js
 * ----------------------------------------------------------------------------
 * Locks in the macOS signing posture so a future edit can't silently revert
 * the default build to unsigned:
 *   - The DEFAULT build (package.json build.mac) is HARDENED and does NOT pin
 *     identity:null (so electron-builder signs whenever a Developer ID cert is
 *     available, and skips gracefully otherwise — identity is left to env/CI).
 *   - An explicit unsigned local-dev script (build:mac:dev) still exists.
 *   - The full signed + notarised distribution script (build:mac:signed) and
 *     the entitlements file are present.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mac = (pkg.build && pkg.build.mac) || {};

describe('macOS signing — default build posture', () => {
  it('default build.mac enables hardenedRuntime', () => {
    assert.strictEqual(mac.hardenedRuntime, true, 'build.mac.hardenedRuntime must default to true');
  });

  it('default build.mac does NOT pin identity:null (signing left to env/CI)', () => {
    assert.notStrictEqual(mac.identity, null, 'build.mac.identity must not be hard-set to null');
  });

  it('default build.mac references hardened-runtime entitlements', () => {
    assert.strictEqual(mac.entitlements, 'build/entitlements.mac.plist');
    assert.ok(fs.existsSync(path.join(root, 'build', 'entitlements.mac.plist')), 'entitlements file must exist');
  });

  it('provides an explicit unsigned local-dev build script', () => {
    assert.ok(pkg.scripts['build:mac:dev'], 'build:mac:dev script must exist for local unsigned dev builds');
    assert.match(pkg.scripts['build:mac:dev'], /identity=null/);
    assert.match(pkg.scripts['build:mac:dev'], /hardenedRuntime=false/);
  });

  it('retains the full signed + notarised distribution pipeline', () => {
    assert.ok(pkg.scripts['build:mac:signed'], 'build:mac:signed script must exist');
    assert.match(pkg.scripts['build:mac:signed'], /build-mac-signed\.mjs/);
    assert.ok(fs.existsSync(path.join(root, 'scripts', 'build-mac-signed.mjs')));
  });
});

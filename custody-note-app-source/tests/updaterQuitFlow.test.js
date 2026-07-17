const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const updaterSrc = fs.readFileSync(
  path.resolve(__dirname, '..', 'updater.js'),
  'utf8',
);

/**
 * Regression guard for the v1.9.13 Mac auto-update silent-fail bug.
 *
 * Pre-fix, updater.js called `app.exit(0)` on nextTick AFTER every
 * quitAndInstall regardless of platform. On Windows that was fine (NSIS
 * spawns the installer synchronously and is fully detached before
 * quitAndInstall returns). On macOS it bypassed the before-quit → will-quit
 * → quit lifecycle that Squirrel.Mac needs to spawn its ShipIt helper, so
 * every Mac update silently failed and the app came back as the old version.
 *
 * These assertions lock the platform-conditional shape so the pattern
 * cannot regress without a deliberate code change + failing test.
 */
describe('updater.js — platform-conditional post-quitAndInstall exit', () => {
  it('only hard-exits the process on Windows', () => {
    // The Windows arm must be gated by a process.platform check, not run
    // unconditionally.
    const winGate = /if\s*\(\s*process\.platform\s*===\s*['"]win32['"]\s*\)\s*\{[\s\S]{0,800}app\.exit\(0\)/;
    assert.match(updaterSrc, winGate, 'app.exit(0) must be inside a process.platform === "win32" branch');
  });

  it('does not hard-exit on macOS / non-Windows platforms', () => {
    // The else branch must NOT call app.exit(…) — it must let the native
    // Squirrel.Mac quit flow complete. Matches the actual call, not log text.
    const elseBlock = updaterSrc.match(/}\s*else\s*\{([\s\S]{0,500}?)}/);
    assert.ok(elseBlock, 'expected a non-Windows else branch following the Windows app.exit guard');
    assert.doesNotMatch(
      elseBlock[1],
      /app\.exit\s*\(/,
      'non-Windows branch MUST NOT call app.exit() — it kills Squirrel.Mac before ShipIt is spawned',
    );
  });

  it('documents why the pattern matters (so future maintainers do not "fix" it)', () => {
    assert.match(updaterSrc, /Squirrel\.Mac/);
    assert.match(updaterSrc, /ShipIt/);
    assert.match(updaterSrc, /Failed version transition/);
  });

  it('calls autoUpdater.quitAndInstall before any platform-specific exit handling', () => {
    const quitIdx = updaterSrc.indexOf('autoUpdater.quitAndInstall(isSilent');
    // Find the win32 check that GUARDS the app.exit, not the unrelated one
    // earlier in the file that strips legacy Electron autoUpdater listeners.
    const exitIdx = updaterSrc.indexOf('app.exit(0)');
    assert.ok(quitIdx > 0, 'expected autoUpdater.quitAndInstall(isSilent, true) call');
    assert.ok(exitIdx > quitIdx, 'app.exit must come AFTER quitAndInstall, not before');
  });
});

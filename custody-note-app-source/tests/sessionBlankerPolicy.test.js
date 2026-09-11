'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  mayDismissCredentialFreeBlanker,
  resolveCredentialFreeBlankerPresentation,
  blankerHasEscapeControls,
  isDeadEndBlankerCopy,
} = require('../lib/sessionBlankerPolicy');

describe('sessionBlankerPolicy — credential-free dismiss rules', () => {
  it('allows dismiss on empty/safe screens', () => {
    assert.equal(mayDismissCredentialFreeBlanker({}), true);
    assert.equal(mayDismissCredentialFreeBlanker({
      formViewActive: false,
      listViewActive: false,
      homeViewActive: true,
      homeHasActiveMatters: false,
    }), true);
  });

  it('blocks dismiss when a form with open attendance is active', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      formViewActive: true,
      hasOpenAttendance: true,
    }), false);
  });

  it('blocks dismiss when meaningful client/case form data is present', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      formViewActive: true,
      hasMeaningfulFormData: true,
    }), false);
  });

  it('blocks dismiss when form context bar shows case content', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      formViewActive: true,
      formContextBarHasText: true,
    }), false);
  });

  it('blocks dismiss when records list has rows', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      listViewActive: true,
      listHasRows: true,
    }), false);
  });

  it('allows dismiss on empty list view', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      listViewActive: true,
      listHasRows: false,
    }), true);
  });

  it('blocks dismiss when home shows active matters', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      homeViewActive: true,
      homeHasActiveMatters: true,
    }), false);
  });

  it('blocks dismiss when home shows recent cases with client names', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      homeViewActive: true,
      homeHasRecentCases: true,
    }), false);
  });

  it('blocks dismiss when home focus meta shows client text', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      homeViewActive: true,
      homeFocusHasClientText: true,
    }), false);
  });

  it('blocks dismiss when quick capture has client/case fields', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      quickCaptureViewActive: true,
      quickCaptureHasClientData: true,
    }), false);
  });

  it('allows dismiss on empty quick capture view', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      quickCaptureViewActive: true,
      quickCaptureHasClientData: false,
    }), true);
  });

  it('blocks dismiss when floating scratchpad is open with text', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      scratchpadOpenWithText: true,
      homeViewActive: true,
    }), false);
  });

  it('allows dismiss when scratchpad is closed or empty', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      scratchpadOpenWithText: false,
      homeViewActive: true,
    }), true);
  });

  it('blocks dismiss when officer emails view has client/case fields', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      officerEmailsViewActive: true,
      officerEmailsHasClientData: true,
    }), false);
  });

  it('allows dismiss on empty officer emails view', () => {
    assert.equal(mayDismissCredentialFreeBlanker({
      officerEmailsViewActive: true,
      officerEmailsHasClientData: false,
    }), true);
  });
});

describe('sessionBlankerPolicy — presentation never dead-ends', () => {
  it('(a) no password + case open => Quit + Unlock-this-session, no dead-end copy', () => {
    const p = resolveCredentialFreeBlankerPresentation({
      formViewActive: true,
      hasOpenAttendance: true,
    }, { reason: 'lock-screen' });
    assert.equal(p.mode, 'sensitive-escape');
    assert.equal(p.allowDismiss, false);
    assert.equal(p.offerQuit, true);
    assert.equal(p.offerUnlockThisSession, true);
    assert.ok(p.bodyHtml.includes('Quit Custody Note'));
    assert.ok(p.bodyHtml.includes('unlock this session'));
    assert.ok(!isDeadEndBlankerCopy(p.bodyHtml), 'must not use dead-end Settings catch-22 copy');
    assert.ok(
      !/this lock cannot be dismissed/i.test(p.bodyHtml),
      'must not claim the lock cannot be dismissed'
    );
    assert.ok(
      !/To unlock, set a recovery password or admin password in Settings/i.test(p.bodyHtml),
      'must not tell user to open Settings while overlay is up as the only path'
    );
  });

  it('(b) no password + empty screen => Dismiss still present', () => {
    const p = resolveCredentialFreeBlankerPresentation({
      homeViewActive: true,
      homeHasActiveMatters: false,
      homeHasRecentCases: false,
      homeFocusHasClientText: false,
    }, { reason: 'suspend' });
    assert.equal(p.mode, 'safe-dismiss');
    assert.equal(p.allowDismiss, true);
    assert.equal(p.offerQuit, false);
    assert.equal(p.offerUnlockThisSession, false);
    assert.match(p.bodyHtml, /dismiss/i);
  });

  it('(c) fail-closed gather error still offers Quit + unlock-this-session, never a trap', () => {
    const p = resolveCredentialFreeBlankerPresentation({}, { reason: 'lock-screen', gatherFailed: true });
    assert.equal(p.mode, 'sensitive-escape');
    assert.equal(p.allowDismiss, false);
    assert.equal(p.offerQuit, true);
    assert.equal(p.offerUnlockThisSession, true);
    assert.ok(p.bodyHtml.includes('Quit Custody Note') || /quit/i.test(p.bodyHtml));
    assert.ok(/unlock this session/i.test(p.bodyHtml));
    assert.ok(!isDeadEndBlankerCopy(p.bodyHtml));
  });

  it('unlock confirm and after-unlock toast point to Settings only after dismiss', () => {
    const p = resolveCredentialFreeBlankerPresentation({
      formViewActive: true,
      hasMeaningfulFormData: true,
    }, {});
    assert.match(p.unlockConfirmMessage, /visible on screen/i);
    assert.match(p.afterUnlockToast, /Settings > Security/);
  });

  it('blankerHasEscapeControls detects usable controls and rejects empty overlays', () => {
    assert.equal(blankerHasEscapeControls(null), false);
    assert.equal(blankerHasEscapeControls({
      querySelector: (sel) => (sel === '#cn-credentialfree-quit' ? {} : null),
    }), true);
    assert.equal(blankerHasEscapeControls({
      querySelector: () => null,
    }), false);
  });

  it('isDeadEndBlankerCopy flags legacy trap wording', () => {
    assert.equal(
      isDeadEndBlankerCopy('Client or case data may be on screen, so this lock cannot be dismissed.'),
      true
    );
    assert.equal(
      isDeadEndBlankerCopy('Quit Custody Note and reopen when ready, or unlock this session.'),
      false
    );
  });
});

describe('app.js wires blanker escape (not dead-end)', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  it('loads sessionBlankerPolicy in the renderer', () => {
    assert.match(indexHtml, /sessionBlankerPolicy\.js/);
  });

  it('detects list rows via li[data-id] (not missing .list-item class)', () => {
    assert.match(appJs, /#attendance-list li\[data-id\]/);
    assert.ok(
      !/#attendance-list \.list-item,\s*\.list-item/.test(appJs),
      'must not use the broken .list-item selector for blanker row detection'
    );
  });

  it('gathers quick capture and home recent/focus surfaces for blanker state', () => {
    assert.match(appJs, /view-quickcapture/);
    assert.match(appJs, /qc-forename/);
    assert.match(appJs, /home-recent-list/);
    assert.match(appJs, /home-focus-meta/);
    assert.match(appJs, /homeHasRecentCases/);
    assert.match(appJs, /homeFocusHasClientText/);
    assert.match(appJs, /quickCaptureHasClientData/);
  });

  it('gathers scratchpad and officer emails surfaces for blanker state', () => {
    assert.match(appJs, /scratchpadOpenWithText/);
    assert.match(appJs, /scratchpad-text/);
    assert.match(appJs, /view-officer-emails/);
    assert.match(appJs, /oes-client/);
    assert.match(appJs, /officerEmailsHasClientData/);
  });

  it('treats form context bar placeholders as non-blocking', () => {
    assert.match(appJs, /_formContextBarHasClientText/);
    assert.match(appJs, /Client:\\u2014Station:\\u2014/);
  });

  it('(a/c) sensitive path renders Quit + Unlock this session, not dead-end copy', () => {
    assert.match(appJs, /resolveCredentialFreeBlankerPresentation/);
    assert.match(appJs, /cn-credentialfree-quit/);
    assert.match(appJs, /cn-credentialfree-unlock-session/);
    assert.match(appJs, /Quit Custody Note/);
    assert.match(appJs, /Unlock this session/);
    assert.ok(
      !appJs.includes('this lock cannot be dismissed'),
      'must not ship dead-end "cannot be dismissed" copy'
    );
    assert.ok(
      !appJs.includes('To unlock, set a recovery password or admin password in Settings'),
      'must not tell users to open Settings while blanker is up as the unlock path'
    );
  });

  it('(b) dismiss control still wired for safe screens', () => {
    assert.match(appJs, /cn-credentialfree-dismiss/);
    assert.match(appJs, /allowDismiss/);
  });

  it('(d) password configured still uses real lock, not credential-free blanker', () => {
    const forceLockIdx = appJs.indexOf('onSessionForceLock');
    assert.ok(forceLockIdx > 0);
    const chunk = appJs.slice(forceLockIdx, forceLockIdx + 1200);
    assert.match(chunk, /status\.canLock/);
    assert.match(chunk, /_lock\(\)/);
    assert.match(chunk, /_showCredentialFreeBlanker/);
    assert.ok(
      chunk.indexOf('_lock()') < chunk.indexOf('_showCredentialFreeBlanker'),
      'canLock path must call _lock before blanker branch'
    );
    assert.match(chunk, /if \(status && status\.canLock\)[\s\S]*_lock\(\)/);
  });

  it('Quit uses real app quit IPC (quitApp), not overlay-only dismiss', () => {
    assert.match(appJs, /_quitFromCredentialFreeBlanker/);
    assert.match(appJs, /window\.api\.quitApp/);
    assert.match(preloadJs, /quitApp:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('app-quit'\)/);
    assert.match(mainJs, /ipcMain\.handle\('app-quit'/);
    const quitIdx = mainJs.indexOf("ipcMain.handle('app-quit'");
    const quitBody = mainJs.slice(quitIdx, quitIdx + 700);
    assert.match(quitBody, /_forceClose\s*=\s*true/);
    assert.match(quitBody, /app\.quit\(\)/);
    assert.match(quitBody, /app\.exit\(0\)/);
  });

  it('blanker Quit is always rendered (safe-dismiss and sensitive); never captures Cmd+Q', () => {
    assert.match(appJs, /cn-credentialfree-quit/);
    assert.match(appJs, /do NOT capture Cmd\+Q/);
    assert.ok(
      !/cn-credentialfree-blanker[\s\S]{0,800}preventDefault/.test(appJs),
      'blanker must not preventDefault keyboard quit shortcuts'
    );
  });

  it('close guard never prompts behind the blanker — quits via IPC instead', () => {
    const guardFn = appJs.substring(appJs.indexOf('function _initCloseGuard'), appJs.indexOf('function safeInit'));
    assert.match(guardFn, /cn-credentialfree-blanker/);
    assert.match(guardFn, /quitApp/);
  });

  it('before-quit and force-lock use bounded flush so quit cannot wedge', () => {
    assert.match(mainJs, /function flushDbAsyncBounded/);
    const beforeQuitIdx = mainJs.indexOf("app.on('before-quit'");
    const beforeQuitBody = mainJs.slice(beforeQuitIdx, beforeQuitIdx + 900);
    assert.match(beforeQuitBody, /flushDbAsyncBounded/);
    assert.match(beforeQuitBody, /app\.exit\(0\)/);
    assert.match(mainJs, /ipcMain\.on\('close-confirmed'/);
    assert.doesNotMatch(mainJs, /ipcMain\.once\('close-confirmed'/);
  });

  it('replaces legacy dead-end overlay instead of stacking a second copy', () => {
    assert.match(appJs, /blankerHasEscapeControls/);
    assert.match(appJs, /Replace legacy dead-end overlay/);
  });
});

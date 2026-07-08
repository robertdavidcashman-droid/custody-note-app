'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

describe('main process — officer email Outlook safety', () => {
  it('registers officer-email-drafts-compose-url before open-outlook', () => {
    const c = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-compose-url'");
    const o = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-open-outlook'");
    assert.ok(c >= 0 && o > c, 'compose-url handler should exist before open-outlook');
  });

  it('rejects deleted, cancelled and invalid-status drafts before opening the URL externally', () => {
    const start = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-open-outlook'");
    assert.ok(start >= 0, 'open-outlook handler should exist');
    const end = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-copy'", start);
    assert.ok(end > start, 'copy handler should follow open-outlook handler');
    const block = mainSrc.slice(start, end);
    /* Either shell.openExternal directly or via the new openExternalUrl helper
       that wraps it with a Windows AppX-hijack workaround for outlook.office.com. */
    const openIdx = block.search(/openExternalUrlModule\.openExternalUrl\s*\(|shell\.openExternal\s*\(/);
    assert.ok(openIdx > 0, 'handler should hand off the URL via openExternalUrl or shell.openExternal');
    const preOpen = block.slice(0, openIdx);
    assert.ok(preOpen.includes("row.status === 'deleted'"), 'deleted drafts must be blocked before opening Outlook');
    assert.ok(preOpen.includes("row.status === 'cancelled'"), 'cancelled drafts must be blocked before opening Outlook');
    assert.ok(preOpen.includes("canTransitionStatus(row.status, 'opened_in_outlook')"), 'invalid transitions must be blocked before opening Outlook');
  });

  it('builds Outlook URL in main process and does not accept a renderer-supplied URL', () => {
    const start = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-open-outlook'");
    const end = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-copy'", start);
    const block = mainSrc.slice(start, end);
    assert.ok(block.includes("async (_, draftId)"), 'handler should accept only a draft id from the renderer');
    assert.ok(block.includes('truncateOutlookComposeForShellOpen'), 'main process should build/truncate the URL from draft fields');
  });
});

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

  it('rejects deleted, cancelled and invalid-status drafts before opening externally', () => {
    const start = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-open-outlook'");
    assert.ok(start >= 0, 'open-outlook handler should exist');
    const end = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-copy'", start);
    assert.ok(end > start, 'copy handler should follow open-outlook handler');
    const block = mainSrc.slice(start, end);
    const openIdx = block.search(/_openOfficerEmailInOutlook\s*\(/);
    assert.ok(openIdx > 0, 'handler should launch via _openOfficerEmailInOutlook');
    const preOpen = block.slice(0, openIdx);
    assert.ok(preOpen.includes("row.status === 'deleted'"), 'deleted drafts must be blocked before opening Outlook');
    assert.ok(preOpen.includes("row.status === 'cancelled'"), 'cancelled drafts must be blocked before opening Outlook');
    assert.ok(preOpen.includes("canTransitionStatus(row.status, 'opened_in_outlook')"), 'invalid transitions must be blocked before opening Outlook');
  });

  it('builds Outlook payload in main process and does not accept a renderer-supplied URL', () => {
    const start = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-open-outlook'");
    const end = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-copy'", start);
    const block = mainSrc.slice(start, end);
    assert.ok(
      block.includes('async (_, draftId, liveFields)') || block.includes('async (_, draftId)'),
      'handler should accept draft id (and optional live fields) from the renderer'
    );
    assert.ok(!block.includes('payload.url') && !block.includes('fields.url'), 'must not open a renderer-supplied URL');
    assert.ok(
      mainSrc.includes('prepareOutlookComposeForOpen') || block.includes('_openOfficerEmailInOutlook'),
      'main process should prepare compose from draft fields'
    );
  });

  it('places body into Outlook (OWA body param or .eml) — not clipboard-as-primary', () => {
    const helperStart = mainSrc.indexOf('async function _openOfficerEmailInOutlook');
    assert.ok(helperStart >= 0, '_openOfficerEmailInOutlook helper required');
    const helperEnd = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-open-outlook'", helperStart);
    const helper = mainSrc.slice(helperStart, helperEnd);
    assert.ok(helper.includes("method === 'outlook-desktop-eml'") || helper.includes("composed.method === 'outlook-desktop-eml'"));
    assert.ok(helper.includes('shell.openPath') || helper.includes('openPath('));
    assert.ok(helper.includes('prepareOutlookComposeForOpen'));
    assert.ok(
      !helper.includes('clipboard.writeText'),
      'must not use clipboard.writeText as the primary body transfer'
    );
  });

  it('one-off open uses the same _openOfficerEmailInOutlook path', () => {
    const start = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-open-one-off-outlook'");
    const end = mainSrc.indexOf("ipcMain.handle('officer-email-drafts-copy'", start);
    const block = mainSrc.slice(start, end);
    assert.ok(block.includes('_openOfficerEmailInOutlook('));
    assert.ok(!block.includes('clipboard.writeText('), 'one-off must not clipboard-paste as primary');
  });
});

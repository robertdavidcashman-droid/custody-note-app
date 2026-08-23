'use strict';

/**
 * Regression: Open Outlook must use the LIVE email-box text (edited or typed),
 * not a stale generated template string. Open uses .eml so the body is not
 * dropped by Outlook Web ignoring body=.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { prepareOutlookComposeForOpen } = require('../lib/outlookWebCompose');
const { extractEmlPlainBody } = require('../lib/outlookComposeEml');

const PANEL = fs.readFileSync(path.join(__dirname, '..', 'renderer/views/officerEmailsPanel.js'), 'utf8');
const STANDALONE = fs.readFileSync(path.join(__dirname, '..', 'renderer/views/officerEmailsStandalone.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

describe('officer email Open Outlook — live field source of truth', () => {
  it('panel collectFields reads els.body.value (live textarea)', () => {
    assert.ok(PANEL.includes('body: els.body.value'), 'collectFields must read live body textarea');
    assert.ok(PANEL.includes('var bod = els.body.value.trim()'), 'openOutlook validates live body');
  });

  it('panel saveDraft before open uses collectFields (persists live edits)', () => {
    assert.ok(PANEL.includes('Object.assign({ custodyNoteId: String(aid) }, collectFields())'));
    assert.ok(PANEL.includes('saveDraft({ silent: true })'));
  });

  it('panel openOutlookDraft passes collectFields() as liveFields (not draft-id alone)', () => {
    assert.ok(
      PANEL.includes('openOutlookDraft(selectedDraftId, collectFields())'),
      'Open must pass live box fields so main does not rely on a stale DB body'
    );
    assert.ok(PRELOAD.includes("officer-email-drafts-open-outlook', id, liveFields"));
    assert.ok(MAIN.includes('liveFields'));
    assert.ok(MAIN.includes('Prefer LIVE email-box fields'));
  });

  it('standalone openOneOffOutlook passes collectFields() (live values)', () => {
    assert.ok(STANDALONE.includes('var f = collectFields()'));
    assert.ok(STANDALONE.includes('window.api.officerEmails.openOneOffOutlook(f)'));
  });

  it('toasts must not instruct clipboard paste as the primary UX', () => {
    assert.ok(!PANEL.includes('Message body copied to clipboard — paste'));
    assert.ok(!STANDALONE.includes('Message body copied to clipboard — paste'));
  });

  it('edited generated text reaches .eml compose payload', () => {
    const generated = 'Dear Officer,\n\nPlease send disclosure.\n\nKind regards';
    const edited = generated.replace('Please send disclosure.', 'Please send disclosure AND bodycam.');
    const r = prepareOutlookComposeForOpen(
      { to: 'o@police.uk', subject: 'Disclosure', body: edited }
    );
    assert.strictEqual(r.method, 'outlook-desktop-eml');
    assert.strictEqual(r.bodyPlacedInCompose, true);
    assert.strictEqual(extractEmlPlainBody(r.emlContent), edited);
  });

  it('completely typed replacement body is used in .eml', () => {
    const typed = 'Completely new message typed by hand.\n\nLine two.';
    const r = prepareOutlookComposeForOpen(
      { to: 'o@police.uk', subject: 'Custom', body: typed }
    );
    assert.strictEqual(extractEmlPlainBody(r.emlContent), typed);
  });

  it('long live body is placed in .eml content intact', () => {
    const live = 'LIVE_EDIT_MARKER\n\n' + 'para\n\n'.repeat(400);
    const r = prepareOutlookComposeForOpen(
      { to: 'o@police.uk', subject: 'Long', body: live },
      { maxUrlLength: 1800 }
    );
    assert.strictEqual(r.method, 'outlook-desktop-eml');
    assert.strictEqual(extractEmlPlainBody(r.emlContent), live);
    assert.ok(extractEmlPlainBody(r.emlContent).startsWith('LIVE_EDIT_MARKER'));
  });
});

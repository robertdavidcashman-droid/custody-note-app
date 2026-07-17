'use strict';

/**
 * Regression tests for the silent failure paths of the officer-email
 * "Open in Outlook (web)" buttons.
 *
 * These two views (officerEmailsPanel.js and officerEmailsStandalone.js) both
 * invoke window.api.officerEmails.openOutlookDraft / openOneOffOutlook via
 * ipcRenderer.invoke. Earlier versions used `.then(...)` only, with no
 * `.catch`, no fallback when showToast/showChoice/showConfirm were absent,
 * and no toast on the post-saveDraft empty-id branch — so a click could
 * silently do nothing on a work/school account, with no error visible to the
 * user (matching the symptom that triggered this fix).
 *
 * We assert two things:
 *   1) Source-pattern: every previously-silent branch now logs and surfaces a
 *      message (toast / alert / confirm fallback). Anyone removing the
 *      `.catch` or the diagnostics will fail this test.
 *   2) Behavioural (jsdom): when the IPC promise rejects or resolves
 *      `{ ok: false, errors: [...] }`, the standalone view actually calls
 *      showToast with an error message.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PANEL_SRC = fs.readFileSync(path.join(ROOT, 'renderer/views/officerEmailsPanel.js'), 'utf8');
const STANDALONE_SRC = fs.readFileSync(path.join(ROOT, 'renderer/views/officerEmailsStandalone.js'), 'utf8');

describe('officerEmailsPanel — silent failure path instrumentation (source)', () => {
  it('wraps openOutlookDraft promise with a .catch so IPC rejections surface', () => {
    assert.ok(
      /openOutlookDraft\(selectedDraftId\)[\s\S]{0,2000}\.catch\(/.test(PANEL_SRC),
      'openOutlookDraft must be followed by a .catch handler'
    );
  });

  it('logs and surfaces an error when openOutlookDraft rejects', () => {
    assert.ok(
      PANEL_SRC.includes("[officerEmailsPanel] openOutlookDraft rejected"),
      'rejection branch must log a tagged console.error'
    );
  });

  it('does not silently return after saveDraft when selectedDraftId is empty', () => {
    assert.ok(
      PANEL_SRC.includes("[officerEmailsPanel] openOutlook aborted: saveDraft state"),
      'saveDraft empty-id branch must log a tagged warning'
    );
    assert.ok(
      /no draft id was returned/.test(PANEL_SRC),
      'saveDraft empty-id branch must surface a user-visible toast or alert'
    );
  });

  it('falls back to window.confirm when both showChoice and showConfirm are missing', () => {
    assert.ok(
      PANEL_SRC.includes('window.confirm') && /showChoice and showConfirm both undefined/.test(PANEL_SRC),
      'panel must fall back to window.confirm so the click is never silently dropped'
    );
  });

  it('catches showChoice / showConfirm rejections and surfaces them', () => {
    assert.ok(/showChoice rejected/.test(PANEL_SRC), 'showChoice rejection must be logged');
    assert.ok(/showConfirm rejected/.test(PANEL_SRC), 'showConfirm rejection must be logged');
  });

  it('catches saveDraft rejection itself before opening Outlook', () => {
    assert.ok(/saveDraft rejected before Outlook open/.test(PANEL_SRC));
  });
});

describe('officerEmailsStandalone — silent failure path instrumentation (source)', () => {
  it('wraps openOneOffOutlook promise with a .catch', () => {
    assert.ok(
      /openOneOffOutlook\(f\)[\s\S]{0,2000}\.catch\(/.test(STANDALONE_SRC),
      'openOneOffOutlook must be followed by a .catch handler'
    );
  });

  it('logs and surfaces an error when openOneOffOutlook rejects', () => {
    assert.ok(STANDALONE_SRC.includes('[officerEmailsStandalone] openOneOffOutlook rejected'));
  });

  it('falls back to window.confirm when both dialog helpers are missing', () => {
    assert.ok(
      STANDALONE_SRC.includes('window.confirm')
        && /showChoice and showConfirm both undefined/.test(STANDALONE_SRC),
      'standalone must fall back to window.confirm so the click is never silently dropped'
    );
  });

  it('catches showChoice / showConfirm rejections', () => {
    assert.ok(/showChoice rejected/.test(STANDALONE_SRC));
    assert.ok(/showConfirm rejected/.test(STANDALONE_SRC));
  });
});

describe('main.js — officer Outlook handlers log the URL hand-off', () => {
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

  it('panel handler logs invoking openExternalUrl and the resolved method', () => {
    assert.ok(main.includes("[officer-email-drafts-open-outlook] invoking openExternalUrl"));
    assert.ok(main.includes("[officer-email-drafts-open-outlook] openExternalUrl resolved"));
  });

  it('one-off handler logs invoking openExternalUrl and the resolved method', () => {
    assert.ok(main.includes("[officer-email-drafts-open-one-off-outlook] invoking openExternalUrl"));
    assert.ok(main.includes("[officer-email-drafts-open-one-off-outlook] openExternalUrl resolved"));
  });

  it('panel handler returns openMethod in the IPC response so renderer can toast', () => {
    assert.ok(/return\s*\{[\s\S]{0,400}openMethod[\s\S]{0,400}\}\s*;\s*\}\s*\)\s*;/.test(main),
      'panel handler should include openMethod in its return payload');
  });

  it('main.js requires the new lib/openExternalUrl helper', () => {
    assert.ok(main.includes("require('./lib/openExternalUrl')"),
      'main.js should require the new helper module');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Behavioural tests (jsdom): assert the renderer actually surfaces errors.
 * We spin up a JSDOM window, define mocks, eval the standalone source so its
 * IIFE attaches to window.OfficerEmailsStandalone, run init(), fill the form
 * with valid data, click "Open in Outlook Web", and assert the toast was
 * shown for both the rejection and the {ok:false} cases.
 * ──────────────────────────────────────────────────────────────────────── */

function flushMicrotasks(times) {
  let p = Promise.resolve();
  for (let i = 0; i < (times || 8); i++) p = p.then(() => undefined);
  return p;
}

function bootStandaloneDom(openOneOffOutlookImpl, opts) {
  const options = opts || {};
  const html = '<!DOCTYPE html><html><body>'
    + '<div id="officer-emails-standalone-host"></div>'
    + '</body></html>';
  /* runScripts:'outside-only' is required so window.eval() executes in the
     window's global scope (and the IIFE's `(function(global){...})(window)`
     attaches OfficerEmailsStandalone to `dom.window`). */
  const dom = new JSDOM(html, {
    url: 'http://localhost',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window;

  /* Calls received by the test mocks. */
  const calls = { showToast: [], openOneOffOutlook: [] };
  const buildPreviewImpl = options.buildPreview || (() => Promise.resolve({ ok: true, subject: 'Test subject', body: 'Test body line 1\nTest body line 2' }));

  win.api = {
    officerEmails: {
      buildPreview: buildPreviewImpl,
      openOneOffOutlook: (fields) => {
        calls.openOneOffOutlook.push(fields);
        return openOneOffOutlookImpl(fields);
      },
      copyText: () => Promise.resolve({ ok: true }),
      getComposeUrl: () => Promise.resolve({ ok: true, url: 'https://outlook.office.com/mail/0/deeplink/compose' }),
    },
    clipboard: { writeText: () => Promise.resolve({ ok: true }) },
  };
  win.showToast = (msg, kind, ms) => { calls.showToast.push({ msg: String(msg), kind: String(kind || ''), ms: ms || 0 }); };
  win.showChoice = () => Promise.resolve('open');

  /* Install the IIFE into this window's global scope. */
  win.eval(STANDALONE_SRC);

  /* Trigger init manually (the standalone view normally calls init when its
     route is shown). */
  win.OfficerEmailsStandalone.init();

  /* Fill in the form with values that pass openOutlookClicked validation
     (recipient, subject, body all non-empty). The professional-domain check
     just adds a warning; the click still proceeds. */
  win.document.getElementById('oes-to').value = 'officer@example.police.uk';
  win.document.getElementById('oes-subject').value = options.subject != null ? options.subject : 'Test subject';
  win.document.getElementById('oes-body').value = options.body != null ? options.body : 'Test body line 1\nTest body line 2';

  return { dom, win, calls };
}

describe('officerEmailsStandalone — behavioural error surfacing (jsdom)', () => {
  /* Tidy globals between tests. */
  let originalWindow;
  beforeEach(() => { originalWindow = global.window; });
  afterEach(() => {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  });

  it('surfaces a toast when openOneOffOutlook REJECTS (regression: missing .catch)', async () => {
    const rejection = new Error('IPC bridge unavailable');
    const { win, calls } = bootStandaloneDom(() => Promise.reject(rejection));
    win.document.getElementById('oes-open').click();
    await flushMicrotasks(20);
    assert.strictEqual(calls.openOneOffOutlook.length, 1, 'IPC mock should have been invoked once');
    const errToasts = calls.showToast.filter((t) => t.kind === 'error');
    assert.ok(errToasts.length >= 1, 'at least one error toast should fire on rejection; got: ' + JSON.stringify(calls.showToast));
    assert.ok(
      errToasts.some((t) => /Outlook Web could not be opened/i.test(t.msg)),
      'error toast must mention Outlook Web could not be opened; got: ' + JSON.stringify(errToasts)
    );
  });

  it('surfaces a toast when openOneOffOutlook resolves { ok: false, errors: [...] }', async () => {
    const { win, calls } = bootStandaloneDom(() => Promise.resolve({ ok: false, errors: ['Specific main-side error'] }));
    win.document.getElementById('oes-open').click();
    await flushMicrotasks(20);
    assert.strictEqual(calls.openOneOffOutlook.length, 1);
    const errToasts = calls.showToast.filter((t) => t.kind === 'error');
    assert.ok(errToasts.length >= 1, 'at least one error toast should fire on {ok:false}; got: ' + JSON.stringify(calls.showToast));
    assert.ok(
      errToasts.some((t) => t.msg === 'Specific main-side error'),
      'error toast must include the message returned by main; got: ' + JSON.stringify(errToasts)
    );
  });

  it('surfaces a success toast when openOneOffOutlook resolves { ok: true }', async () => {
    const { win, calls } = bootStandaloneDom(() => Promise.resolve({ ok: true, truncated: false, urlLength: 200 }));
    win.document.getElementById('oes-open').click();
    await flushMicrotasks(20);
    const successToasts = calls.showToast.filter((t) => t.kind === 'success');
    assert.ok(successToasts.length >= 1, 'success toast must fire on ok:true; got: ' + JSON.stringify(calls.showToast));
  });

  it('regenerates stale placeholder preview from current fields before opening Outlook', async () => {
    const { win, calls } = bootStandaloneDom(
      () => Promise.resolve({ ok: true, truncated: false, urlLength: 200 }),
      {
        subject: '[Client Name] - [Police Station] - [Offence] - Confirm attendance — disclosure',
        body: 'Dear Officer,\n\nI have been instructed to represent [Client Name] at [Police Station] on [Date] in relation to an allegation of [Offence].',
        buildPreview: (fields) => Promise.resolve({
          ok: true,
          subject: fields.clientName + ' - ' + fields.policeStation + ' - ' + fields.offence + ' - Confirm attendance — disclosure',
          body: 'Dear Officer,\n\nI have been instructed to represent ' + fields.clientName + ' at ' + fields.policeStation + ' on ' + fields.attendanceDate + ' in relation to an allegation of ' + fields.offence + '.',
        }),
      }
    );
    win.document.getElementById('oes-client').value = 'Joe Bloggs';
    win.document.getElementById('oes-station').value = 'Tonbridge';
    win.document.getElementById('oes-date').value = '15.05.26';
    win.document.getElementById('oes-offence').value = 'Theft';

    win.document.getElementById('oes-open').click();
    await flushMicrotasks(30);

    assert.strictEqual(calls.openOneOffOutlook.length, 1);
    const fields = calls.openOneOffOutlook[0];
    assert.strictEqual(fields.subject, 'Joe Bloggs - Tonbridge - Theft - Confirm attendance — disclosure');
    assert.ok(fields.body.includes('Joe Bloggs'), fields.body);
    assert.ok(fields.body.includes('Tonbridge'), fields.body);
    assert.ok(fields.body.includes('15.05.26'), fields.body);
    assert.ok(fields.body.includes('Theft'), fields.body);
    assert.ok(!fields.subject.includes('[Client Name]'), fields.subject);
    assert.ok(!fields.body.includes('[Client Name]'), fields.body);
  });
});

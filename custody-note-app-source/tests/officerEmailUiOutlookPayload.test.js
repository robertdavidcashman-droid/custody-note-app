'use strict';

/**
 * Behavioural UI tests: Open Outlook must pass the CURRENT email-box text
 * (generated / edited / rewritten) into the IPC launch payload.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { prepareOutlookComposeForOpen } = require('../lib/outlookWebCompose');
const { extractEmlPlainBody } = require('../lib/outlookComposeEml');

const STANDALONE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'renderer/views/officerEmailsStandalone.js'),
  'utf8'
);

const SPECIAL_BODY = [
  'Dear Officer,',
  '',
  'Re: Smith & Jones — CR/12345/26',
  '',
  "The client's position is that he didn't attend the address.",
  '',
  'Please confirm whether CCTV, BWV and/or telephone evidence has been obtained.',
  '',
  'Kind regards,',
  'Robert Cashman',
].join('\n');

function flushMicrotasks(times) {
  let p = Promise.resolve();
  for (let i = 0; i < (times || 8); i++) p = p.then(() => undefined);
  return p;
}

function waitFor(predicate, maxMs) {
  const start = Date.now();
  function tick() {
    if (predicate()) return Promise.resolve();
    if (Date.now() - start > (maxMs || 2000)) {
      return Promise.reject(new Error('waitFor timed out'));
    }
    return new Promise((r) => setTimeout(r, 20)).then(tick);
  }
  return tick();
}

function bootStandalone(opts) {
  const options = opts || {};
  const html = '<!DOCTYPE html><html><body><div id="officer-emails-standalone-host"></div></body></html>';
  const dom = new JSDOM(html, {
    url: 'http://localhost',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window;
  const calls = { openOneOffOutlook: [], showToast: [] };

  win.api = {
    officerEmails: {
      buildPreview: options.buildPreview || (() => Promise.resolve({
        ok: true,
        subject: options.generatedSubject || 'Generated subject',
        body: options.generatedBody || 'Generated body line 1\n\nGenerated body line 2',
      })),
      openOneOffOutlook: (fields) => {
        calls.openOneOffOutlook.push(JSON.parse(JSON.stringify(fields)));
        return Promise.resolve({
          ok: true,
          method: 'outlook-web',
          bodyPlacedInCompose: true,
          truncated: false,
        });
      },
      copyText: () => Promise.resolve({ ok: true }),
      getComposeUrl: () => Promise.resolve({ ok: true, url: 'https://outlook.office.com/mail/0/deeplink/compose' }),
    },
  };
  win.showToast = (msg, kind) => { calls.showToast.push({ msg: String(msg), kind: String(kind || '') }); };
  win.showChoice = () => Promise.resolve('open');
  win.eval(STANDALONE_SRC);
  win.OfficerEmailsStandalone.init();

  win.document.getElementById('oes-to').value = 'officer@example.police.uk';
  if (options.subject != null) win.document.getElementById('oes-subject').value = options.subject;
  if (options.body != null) {
    win.document.getElementById('oes-body').value = options.body;
    /* Mark dirty so Open does not regenerate over live edits. */
    win.document.getElementById('oes-body').dispatchEvent(new win.Event('input', { bubbles: true }));
  }

  return { win, calls };
}

function assertPayloadBody(fields, expectedBody) {
  assert.ok(fields, 'IPC fields required');
  assert.strictEqual(String(fields.body), expectedBody, 'IPC body must match live email box');
  const prepared = prepareOutlookComposeForOpen({
    to: fields.toEmail,
    subject: fields.subject,
    body: fields.body,
  });
  assert.strictEqual(prepared.method, 'outlook-desktop-eml', 'Open must use .eml so body is not dropped');
  assert.strictEqual(prepared.bodyPlacedInCompose, true);
  assert.strictEqual(extractEmlPlainBody(prepared.emlContent), expectedBody);
}

describe('officer-email UI → Outlook launch payload (live body)', () => {
  let originalWindow;
  beforeEach(() => { originalWindow = global.window; });
  afterEach(() => {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  });

  it('A) generated, unedited body reaches the compose IPC payload', async () => {
    const generatedBody = 'Dear Officer,\n\nPlease send disclosure.\n\nKind regards';
    const { win, calls } = bootStandalone({
      generatedSubject: 'Bloggs - disclosure',
      generatedBody,
      buildPreview: () => Promise.resolve({ ok: true, subject: 'Bloggs - disclosure', body: generatedBody }),
    });
    /* Wait for init()'s initial generate to settle, then set placeholders with dirty=false. */
    await waitFor(() => win.document.getElementById('oes-body').value.includes('Dear Officer') || win.document.getElementById('oes-body').value.length > 0, 1500).catch(() => {});
    win.document.getElementById('oes-subject').value = '[placeholder]';
    win.document.getElementById('oes-body').value = '[placeholder]';

    win.document.getElementById('oes-open').click();
    await waitFor(() => calls.openOneOffOutlook.length >= 1, 2000);

    assert.strictEqual(calls.openOneOffOutlook.length, 1);
    assertPayloadBody(calls.openOneOffOutlook[0], generatedBody);
    assert.ok(!calls.openOneOffOutlook[0].body.includes('[placeholder]'));
  });

  it('B) after manual edit, the AMENDED text is used', async () => {
    const generated = 'Dear Officer,\n\nPlease send disclosure.\n\nKind regards';
    const amended = generated.replace('Please send disclosure.', 'Please send disclosure AND bodycam.');
    const { win, calls } = bootStandalone({
      subject: 'S',
      body: amended,
    });

    win.document.getElementById('oes-open').click();
    await flushMicrotasks(20);

    assert.strictEqual(calls.openOneOffOutlook.length, 1);
    assertPayloadBody(calls.openOneOffOutlook[0], amended);
    assert.ok(calls.openOneOffOutlook[0].body.includes('AND bodycam'));
    assert.ok(!calls.openOneOffOutlook[0].body.includes('Please send disclosure.\n\nKind regards') ||
      calls.openOneOffOutlook[0].body.includes('AND bodycam'));
  });

  it('C) completely typed replacement is used', async () => {
    const typed = 'Completely new message typed by hand.\n\nSecond paragraph.';
    const { win, calls } = bootStandalone({ subject: 'Custom', body: typed });
    win.document.getElementById('oes-open').click();
    await flushMicrotasks(20);
    assertPayloadBody(calls.openOneOffOutlook[0], typed);
  });

  it('D) multiline + blank lines preserved in the payload', async () => {
    const multi = 'Line one.\n\nLine three after blank.\n\nLine five.';
    const { win, calls } = bootStandalone({ subject: 'Multi', body: multi });
    win.document.getElementById('oes-open').click();
    await flushMicrotasks(20);
    assertPayloadBody(calls.openOneOffOutlook[0], multi);
    assert.ok(calls.openOneOffOutlook[0].body.includes('\n\n'));
  });

  it('E) special characters survive encoding into Outlook compose', async () => {
    const { win, calls } = bootStandalone({
      subject: 'Re: Smith & Jones — CR/12345/26',
      body: SPECIAL_BODY,
    });
    win.document.getElementById('oes-open').click();
    await flushMicrotasks(20);
    assertPayloadBody(calls.openOneOffOutlook[0], SPECIAL_BODY);
    const prepared = prepareOutlookComposeForOpen({
      to: calls.openOneOffOutlook[0].toEmail,
      subject: calls.openOneOffOutlook[0].subject,
      body: calls.openOneOffOutlook[0].body,
    });
    const decoded = extractEmlPlainBody(prepared.emlContent);
    assert.ok(decoded.includes("didn't"));
    assert.ok(decoded.includes('Smith & Jones'));
    assert.ok(!decoded.includes('<br>'));
  });

  it('F) second Outlook click uses the newest text, not the previous one', async () => {
    const { win, calls } = bootStandalone({ subject: 'S', body: 'first version' });
    win.document.getElementById('oes-open').click();
    await flushMicrotasks(20);
    assert.strictEqual(calls.openOneOffOutlook[0].body, 'first version');

    win.document.getElementById('oes-body').value = 'second version — newest';
    win.document.getElementById('oes-body').dispatchEvent(new win.Event('input', { bubbles: true }));
    win.document.getElementById('oes-open').click();
    await flushMicrotasks(20);

    assert.strictEqual(calls.openOneOffOutlook.length, 2);
    assertPayloadBody(calls.openOneOffOutlook[1], 'second version — newest');
    assert.notStrictEqual(calls.openOneOffOutlook[1].body, calls.openOneOffOutlook[0].body);
  });
});

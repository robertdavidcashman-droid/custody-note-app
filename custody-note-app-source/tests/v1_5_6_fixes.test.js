/**
 * Regression tests for v1.5.6 fixes:
 *
 * 1. "Billing invoice no." is no longer surfaced anywhere — neither on the
 *    generated PDFs (custody, voluntary, cover letter, summaries) nor in
 *    the in-app billing panel. The synthetic CN-prefixed reference confused
 *    users vs. the real QuickFile invoice number.
 *
 * 2. QuickFile invoice attachments must NOT be doubled. When the workflow
 *    billing screen passes user-selected `extraAttachments[]`, the legacy
 *    auto-rendered attendance-note PDF (`attachAttendanceHtml`) must be
 *    skipped. The standalone billing panel (which only sends
 *    `attachAttendanceHtml`) must keep its single auto attachment.
 *
 * 3. Voluntary attendance §3 (Client Details & Welfare) must NOT duplicate
 *    the forename / middle / surname entry already captured in §1. It now
 *    shows a read-only sectionNote that references §1 and dynamically
 *    displays the actual name.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP_JS_PATH = path.join(__dirname, '..', 'app.js');
const MAIN_JS_PATH = path.join(__dirname, '..', 'main.js');
const BILLING_JS_PATH = path.join(__dirname, '..', 'renderer', 'views', 'billing.js');
const APP_JS = fs.readFileSync(APP_JS_PATH, 'utf8');
const MAIN_JS = fs.readFileSync(MAIN_JS_PATH, 'utf8');
const BILLING_JS = fs.readFileSync(BILLING_JS_PATH, 'utf8');

describe('v1.5.6 — Billing invoice no. removed everywhere', () => {
  it('app.js no longer renders any "Billing invoice no." row in PDFs', () => {
    assert.ok(
      !APP_JS.includes('Billing invoice no.'),
      'app.js still contains a "Billing invoice no." literal — all PDF rows must be removed'
    );
  });

  it('app.js no longer defines or calls pdfBillingInvoiceLine helper', () => {
    assert.ok(
      !APP_JS.includes('pdfBillingInvoiceLine'),
      'pdfBillingInvoiceLine is dead code — its definition and 6 callsites must be removed'
    );
  });

  it('billing panel UI no longer shows the auto invoice ref display', () => {
    assert.ok(
      !BILLING_JS.includes('billing-invoice-ref-display'),
      'billing-invoice-ref-display element must not appear in the billing panel'
    );
    assert.ok(
      !BILLING_JS.includes('Billing invoice no.'),
      '"Billing invoice no." label must not appear in the billing panel'
    );
    assert.ok(
      !BILLING_JS.includes('assigned when invoice is created'),
      'placeholder text for the auto invoice ref must be gone too'
    );
  });

  it('the QuickFile real invoice number reference is still kept (unaffected)', () => {
    /* Note: the real QuickFile number lives in `quickfileInvoiceNumber` /
       `invoiceNumberRef` and is shown on the form once issued. The change
       only removes the synthetic CN-prefixed display ref, not the genuine QF id. */
    assert.ok(
      APP_JS.includes('quickfileInvoiceNumber'),
      'real QuickFile invoice number tracking must remain'
    );
    assert.ok(
      APP_JS.includes("'invoiceNumberRef'") || APP_JS.includes('"invoiceNumberRef"') || APP_JS.includes('invoiceNumberRef'),
      'invoice number reference field for QF must remain'
    );
  });
});

describe('v1.5.6 — QuickFile attachment de-duplication', () => {
  it('main.js declares hasUserSelectedExtras gate', () => {
    assert.ok(
      MAIN_JS.includes('hasUserSelectedExtras'),
      'main.js must expose hasUserSelectedExtras flag to gate the legacy auto-attach'
    );
    assert.ok(
      /const\s+hasUserSelectedExtras\s*=\s*Array\.isArray\(extraAttachments\)/.test(MAIN_JS),
      'hasUserSelectedExtras must be derived from Array.isArray(extraAttachments)'
    );
  });

  it('legacy auto attendance-note attach is gated by !hasUserSelectedExtras', () => {
    /* Find the if-statement guarding the legacy single HTML attachment block.
       It must include `&& !hasUserSelectedExtras` so workflow callers with a
       selected document list don't also get the auto attendance note. */
    const guardRegex = /if\s*\(\s*invoiceId\s*&&\s*attachAttendanceHtml\s*&&\s*String\(attachAttendanceHtml\)\.trim\(\)\s*&&\s*!hasUserSelectedExtras\s*\)/;
    assert.ok(
      guardRegex.test(MAIN_JS),
      'legacy auto-attach must be gated by `!hasUserSelectedExtras` to prevent double attachment'
    );
  });

  it('extraAttachments loop still runs (independent of legacy gate)', () => {
    assert.ok(
      MAIN_JS.includes('for (const att of extraAttachments)'),
      'extraAttachments loop must still iterate user-selected docs'
    );
    assert.ok(
      MAIN_JS.includes('quickFileUploadSalesAttachment(invoiceId, att.filename, pdfBuf'),
      'each user-selected attachment must still be uploaded to QuickFile'
    );
  });

  it('fix is documented inline so future maintainers understand the gate', () => {
    assert.ok(
      MAIN_JS.includes('v1.5.6:') && MAIN_JS.includes('double-attachment'),
      'main.js must carry a v1.5.6 comment explaining why the legacy attach is gated'
    );
  });
});

describe('v1.5.6 — Voluntary §3 client-name redundancy fixed', () => {
  /* Locate the voluntaryFormSections array and slice out the §3 (custody) block. */
  const volStart = APP_JS.indexOf('const voluntaryFormSections');
  assert.ok(volStart !== -1, 'voluntaryFormSections must still be defined');
  const volSlice = APP_JS.slice(volStart, volStart + 30000);

  /* §3 is identified by `id: 'custody'` inside voluntaryFormSections. */
  const custodyIdx = volSlice.indexOf("id: 'custody'");
  assert.ok(custodyIdx !== -1, 'voluntary §3 (id: custody) must still exist');
  /* Take a chunk around it (up to next section opening). */
  const sectionChunk = volSlice.slice(custodyIdx, custodyIdx + 8000);

  it('§3 no longer contains a forename / middleName / surname nameRow', () => {
    /* The §3 chunk must not contain a `nameRow` block with forename/surname keys. */
    const hasNameRow = /type:\s*'nameRow'[\s\S]{0,400}forename[\s\S]{0,400}surname/.test(sectionChunk);
    assert.ok(!hasNameRow, 'voluntary §3 must not contain a duplicate forename/middle/surname nameRow');
  });

  it('§3 has a sectionNote that references §1 with dynamicNameRefSection1', () => {
    assert.ok(
      sectionChunk.includes('dynamicNameRefSection1: true'),
      'voluntary §3 must use a sectionNote with dynamicNameRefSection1: true'
    );
    /* Source code stores the literal escape `\u00a71`, not a real § character. */
    assert.ok(
      /Name:\s*from\s*\\u00a71/.test(sectionChunk) || /Name:\s*from\s*\u00a71/.test(sectionChunk),
      'sectionNote label must reference §1 explicitly'
    );
  });

  it('§3 keyFields no longer demands forename / surname (now §1 owns them)', () => {
    /* Match the `keyFields:` line within the custody section. */
    const kfMatch = sectionChunk.match(/keyFields:\s*\[[^\]]*\]/);
    assert.ok(kfMatch, 'voluntary §3 must declare keyFields');
    assert.ok(
      !kfMatch[0].includes('forename') && !kfMatch[0].includes('surname'),
      'voluntary §3 keyFields must not list forename/surname (those belong to §1)'
    );
  });

  it('renderer\'s sectionNote handler honours dynamicNameRefSection1', () => {
    assert.ok(
      APP_JS.includes('f.dynamicNameRefSection1'),
      'renderer must read f.dynamicNameRefSection1 to append the live name'
    );
    /* The renderer should compose the displayed name from forename/middleName/surname. */
    assert.ok(
      /\[data\.forename,\s*data\.middleName,\s*data\.surname\]/.test(APP_JS),
      'renderer must compose the displayed name from data.forename / data.middleName / data.surname'
    );
  });

  it('§1 still owns the editable name inputs (unchanged)', () => {
    /* Take the slice up to the §3 marker so we only inspect §1+§2. */
    const firstTwoSections = volSlice.slice(0, custodyIdx);
    const hasS1NameRow = /type:\s*'nameRow'[\s\S]{0,400}forename[\s\S]{0,400}surname/.test(firstTwoSections);
    assert.ok(hasS1NameRow, 'voluntary §1 must still expose the forename/middle/surname nameRow');
  });
});

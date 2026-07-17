/**
 * Tests for Phase A audit fixes (v1.4.130).
 *
 * C2  — Voluntary PDF signature key mismatch
 * H1  — Silent autosave failures
 * H2  — CSV Net Travel / Net Waiting hardcoded to zero
 * H3  — Billing confirm() → showConfirm()
 * M1  — Duplicate Sufficient Benefit Test in custody PDF
 * M2  — Telephone PDF title reference fallback
 * M3  — Voluntary PDF section numbering collision
 * M6  — CRM3 "Has action started?" hardcoded Yes
 * M10 — Session lock dark mode CSS class
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const csvExporter = fs.readFileSync(path.join(root, 'renderer', 'csv-exporter.js'), 'utf8');
const billingJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');
const laaForms = fs.readFileSync(path.join(root, 'renderer', 'laa-forms.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

describe('C2 — Voluntary PDF uses correct signature keys', () => {
  const volPdfStart = appJs.indexOf('function buildVoluntaryPdfHtml');
  const volPdfEnd = appJs.indexOf('function getActivePdfBuilder', volPdfStart);
  const volPdfBlock = appJs.substring(volPdfStart, volPdfEnd);

  it('voluntary PDF checks repInstructionsSig (sigKey), not repInstructionsSignature (field key)', () => {
    assert.ok(
      volPdfBlock.includes("d.repInstructionsSig"),
      'voluntary PDF must reference d.repInstructionsSig for the signature image'
    );
    assert.ok(
      !volPdfBlock.includes("d.repInstructionsSignature"),
      'voluntary PDF must NOT reference d.repInstructionsSignature (that is the field key, not the sigKey)'
    );
  });

  it('voluntary PDF checks clientInstructionsSig (sigKey), not clientInstructionsSignature', () => {
    assert.ok(
      volPdfBlock.includes("d.clientInstructionsSig"),
      'voluntary PDF must reference d.clientInstructionsSig for the signature image'
    );
    assert.ok(
      !volPdfBlock.includes("d.clientInstructionsSignature"),
      'voluntary PDF must NOT reference d.clientInstructionsSignature'
    );
  });

  it('custody PDF and voluntary PDF use the same signature keys for instructions', () => {
    const custPdfStart = appJs.indexOf('function buildPdfHtml');
    const custPdfEnd = appJs.indexOf('function buildTelephonePdfHtml', custPdfStart);
    const custPdfBlock = appJs.substring(custPdfStart, custPdfEnd);

    assert.ok(custPdfBlock.includes("sig('repInstructionsSig')"), 'custody PDF must use repInstructionsSig');
    assert.ok(volPdfBlock.includes("sig('repInstructionsSig')"), 'voluntary PDF must use repInstructionsSig');
    assert.ok(custPdfBlock.includes("sig('clientInstructionsSig')"), 'custody PDF must use clientInstructionsSig');
    assert.ok(volPdfBlock.includes("sig('clientInstructionsSig')"), 'voluntary PDF must use clientInstructionsSig');
  });
});

describe('Custody PDF includes extended section fields', () => {
  it('buildPdfHtml outputs strip search, property, device, special warning, PACE 4/5, and DSCC instruction fields', () => {
    const custPdfStart = appJs.indexOf('function buildPdfHtml');
    const custPdfEnd = appJs.indexOf('function buildTelephonePdfHtml', custPdfStart);
    const custPdfBlock = appJs.substring(custPdfStart, custPdfEnd);
    assert.ok(custPdfBlock.includes("d.instructionSource") && custPdfBlock.includes("d.dsccNotificationStatus"), '§1: instruction/DSCC metadata');
    assert.ok(custPdfBlock.includes('d.fourthReviewTime') && custPdfBlock.includes('d.additionalReviewNotes'), '§3: extended PACE reviews');
    assert.ok(custPdfBlock.includes('d.interpreterMode') && custPdfBlock.includes('d.interpreterArrivalTime'), '§3: interpreter detail');
    assert.ok(custPdfBlock.includes('d.stripSearchConducted') && custPdfBlock.includes('d.propertyTaken'), '§3: strip search and property');
    assert.ok(custPdfBlock.includes('d.deviceSeized') && custPdfBlock.includes('d.specialWarningGiven'), '§5: device seizure and special warnings');
    assert.ok(custPdfBlock.includes('d.clothingShoesSeizedWhat'), '§5: clothing/shoes detail');
    assert.ok(custPdfBlock.includes('d.caseAssessmentWhy') && custPdfBlock.includes('d.capitalClient'), '§6: assessment reasoning and capital');
    assert.ok(custPdfBlock.includes("row('Client middle name(s)'") && custPdfBlock.includes('d.middleName'), '§1: middle name on PDF');
    assert.ok(
      custPdfBlock.includes('d.instructionsSignRequired') && custPdfBlock.includes('Instructions signature date'),
      '§6: instruction confirmation signature metadata'
    );
    assert.ok(
      custPdfBlock.includes('Visit notes') && custPdfBlock.includes('v0.notes'),
      '§2: single-visit station card notes on PDF'
    );
  });
});

describe('Client instructions (full) on PDF', () => {
  it('custody and voluntary PDFs include clientInstructionsDetail, not only clientInstructions summary', () => {
    const custPdfStart = appJs.indexOf('function buildPdfHtml');
    const custPdfEnd = appJs.indexOf('function buildTelephonePdfHtml', custPdfStart);
    const custPdfBlock = appJs.substring(custPdfStart, custPdfEnd);
    const volPdfStart = appJs.indexOf('function buildVoluntaryPdfHtml');
    const volPdfEnd = appJs.indexOf('function getActivePdfBuilder', volPdfStart);
    const volPdfBlock = appJs.substring(volPdfStart, volPdfEnd);
    assert.ok(
      custPdfBlock.includes('d.clientInstructionsDetail') && custPdfBlock.includes('>Client instructions</p>'),
      'custody PDF must render the full client instructions field (clientInstructionsDetail)'
    );
    assert.ok(
      volPdfBlock.includes('d.clientInstructionsDetail') && volPdfBlock.includes('>Client instructions</p>'),
      'voluntary PDF must render the full client instructions field (clientInstructionsDetail)'
    );
  });

  it('voluntary PDF includes means/capital fields, instruction signature metadata, and multi-visit journey notes', () => {
    const volPdfStart = appJs.indexOf('function buildVoluntaryPdfHtml');
    const volPdfEnd = appJs.indexOf('function getActivePdfBuilder', volPdfStart);
    const volPdfBlock = appJs.substring(volPdfStart, volPdfEnd);
    assert.ok(volPdfBlock.includes("row('Dependants'") && volPdfBlock.includes('d.capitalTotal'), 'vol §6: dependants and capital');
    assert.ok(volPdfBlock.includes('d.instructionsSignRequired') && volPdfBlock.includes('Visit notes'), 'vol: instructions meta and visit notes');
  });
});

describe('H1 — Autosave failure shows warning toast', () => {
  it('quietSave catch block calls showToast, not just console.error', () => {
    const quietSaveStart = appJs.indexOf('function quietSave()');
    const quietSaveEnd = appJs.indexOf('function ', quietSaveStart + 20);
    const quietSaveBlock = appJs.substring(quietSaveStart, quietSaveEnd);

    assert.ok(
      quietSaveBlock.includes("showToast("),
      'quietSave must call showToast on catch to warn user of save failure'
    );
  });

  it('autosave failure toast is a warning type', () => {
    const catchIdx = appJs.indexOf("console.error('[quietSave]'");
    const catchLine = appJs.substring(catchIdx, appJs.indexOf('\n', catchIdx));

    assert.ok(
      catchLine.includes("'warning'"),
      'autosave failure toast should be warning severity'
    );
  });
});

describe('H2 — CSV Net Travel / Net Waiting use calculated values', () => {
  it('does not hardcode Net Travel to zero', () => {
    assert.ok(
      !csvExporter.includes("calc.totalWithMiles.toFixed(2), '0', '0'"),
      'CSV must not hardcode Net Travel and Net Waiting to zero'
    );
  });

  it('uses calc.travelCost for Net Travel column', () => {
    assert.ok(
      csvExporter.includes('calc.travelCost'),
      'CSV must use calc.travelCost for Net Travel column'
    );
  });

  it('uses calc.waitingCost for Net Waiting column', () => {
    assert.ok(
      csvExporter.includes('calc.waitingCost'),
      'CSV must use calc.waitingCost for Net Waiting column'
    );
  });
});

describe('H3 — Billing uses showConfirm() not native confirm()', () => {
  it('billing.js does not call native confirm()', () => {
    const confirmCalls = billingJs.match(/[^w]\bconfirm\s*\(/g);
    assert.ok(
      !confirmCalls,
      'billing.js must not use native confirm() — use showConfirm() instead'
    );
  });

  it('billing.js uses showConfirm for duplicate invoice warning', () => {
    assert.ok(
      billingJs.includes('showConfirm('),
      'billing.js must use showConfirm for the duplicate invoice dialog'
    );
  });

  it('_handleCreateInvoice is async to support await showConfirm', () => {
    assert.ok(
      billingJs.includes('async function _handleCreateInvoice'),
      '_handleCreateInvoice must be async to await showConfirm'
    );
  });
});

describe('M1 — No duplicate Sufficient Benefit Test in custody PDF', () => {
  it('Sufficient Benefit Test appears only in consultation section, not in case reference section', () => {
    const custPdfStart = appJs.indexOf('function buildPdfHtml');
    const custPdfEnd = appJs.indexOf('function buildTelephonePdfHtml', custPdfStart);
    const custPdfBlock = appJs.substring(custPdfStart, custPdfEnd);

    const sbtMatches = custPdfBlock.match(/Sufficient Benefit Test/g) || [];
    // Should appear in the consultation section (Section 6) with label "Sufficient Benefit Test (LAA)"
    // and possibly in notes reference, but NOT duplicated in Section 1
    const section1End = custPdfBlock.indexOf('<h2>2. Journey');
    const section1Block = custPdfBlock.substring(0, section1End);

    assert.ok(
      !section1Block.includes("row('Sufficient Benefit Test',"),
      'Section 1 (Case Reference & Arrival) must not contain Sufficient Benefit Test row'
    );
  });

  it('Sufficient Benefit Test is still present in Section 6 (consultation)', () => {
    const section6Start = appJs.indexOf("'<h2>6. Consultation");
    const section6End = appJs.indexOf("'<h2>7.", section6Start);
    const section6Block = appJs.substring(section6Start, section6End);

    assert.ok(
      section6Block.includes('Sufficient Benefit Test'),
      'Section 6 must still contain Sufficient Benefit Test'
    );
  });
});

describe('M2 — Telephone PDF title uses client and date (not file ref)', () => {
  it('telephone PDF myRefForTitle is built from name and date', () => {
    const telPdfStart = appJs.indexOf('function buildTelephonePdfHtml');
    const telPdfEnd = appJs.indexOf('function ', telPdfStart + 30);
    const telPdfBlock = appJs.substring(telPdfStart, telPdfEnd);

    assert.ok(
      telPdfBlock.includes('dateForTitle') && telPdfBlock.includes('var myRefForTitle'),
      'telephone PDF must derive myRefForTitle from client and date'
    );
    assert.ok(
      !telPdfBlock.match(/d\.ourFileNumber\s*\|\|\s*d\.fileReference/),
      'telephone PDF title must not use file / matter ref'
    );
  });
});

describe('M3 — Voluntary PDF section numbering has no collision', () => {
  it('LAA Declaration in voluntary PDF is numbered 11, not 10', () => {
    const volPdfStart = appJs.indexOf('function buildVoluntaryPdfHtml');
    const volPdfEnd = appJs.indexOf('function getActivePdfBuilder', volPdfStart);
    const volPdfBlock = appJs.substring(volPdfStart, volPdfEnd);

    assert.ok(
      volPdfBlock.includes('11. LAA Declaration'),
      'voluntary PDF LAA Declaration must be section 11'
    );
    assert.ok(
      !volPdfBlock.includes("'>10. LAA Declaration"),
      'voluntary PDF LAA Declaration must NOT be section 10 (collides with Solicitor Email)'
    );
  });
});

describe('M6 — CRM3 action started reads from data', () => {
  it('CRM3 does not hardcode "Has action started" to always Yes', () => {
    const actionLine = laaForms.match(/Has any action started.*?\n/);
    assert.ok(actionLine, 'CRM3 must have "Has any action started" row');

    assert.ok(
      !laaForms.includes("cb(true, 'Yes') + ' ' + cb(false, 'No') + '</td></tr>' +\n"),
      'CRM3 must not hardcode cb(true, Yes) cb(false, No)'
    );
  });

  it('CRM3 action started is driven by record date', () => {
    const crm3Start = laaForms.indexOf('Has any action started');
    const crm3Line = laaForms.substring(crm3Start, crm3Start + 200);

    assert.ok(
      crm3Line.includes('d.date'),
      'CRM3 "Has action started" should be driven by d.date'
    );
  });
});

describe('M10 — Session lock uses html.dark not .dark-mode', () => {
  it('session lock dark styles use html.dark selector', () => {
    assert.ok(
      stylesCss.includes('html.dark #session-lock-box'),
      'session lock dark mode must use html.dark selector'
    );
  });

  it('session lock dark styles do NOT use .dark-mode selector', () => {
    assert.ok(
      !stylesCss.includes('.dark-mode #session-lock-box'),
      'session lock must NOT use .dark-mode selector (inconsistent with app theming)'
    );
    assert.ok(
      !stylesCss.includes('.dark-mode .session-lock-error'),
      'session lock error must NOT use .dark-mode selector'
    );
  });
});

describe('L1 — previewPdf is not a duplicate function', () => {
  it('previewPdf is an alias, not a separate function body', () => {
    assert.ok(
      appJs.includes('var previewPdf = printAttendanceNote'),
      'previewPdf should be aliased to printAttendanceNote, not a separate function'
    );
  });

  it('there is only one function body for print/preview (printAttendanceNote)', () => {
    const printFnCount = (appJs.match(/function printAttendanceNote\b\(/g) || []).length;
    assert.strictEqual(printFnCount, 1, 'printAttendanceNote() should be defined exactly once');

    const previewFnCount = (appJs.match(/function previewPdf\b\(/g) || []).length;
    assert.strictEqual(previewFnCount, 0, 'previewPdf() should NOT be a separate function definition');
  });
});

describe('C1 — PDF exports do not embed hidden base64 record data', () => {
  it('no CUSTODY_NOTE_IMPORT payload in any PDF builder', () => {
    const matches = (appJs.match(/CUSTODY_NOTE_IMPORT/g) || []).length;
    assert.strictEqual(matches, 0, 'CUSTODY_NOTE_IMPORT must not appear in app.js (data leak removed)');
  });

  it('no hidden base64 div in custody PDF builder', () => {
    const custStart = appJs.indexOf('function buildPdfHtml');
    const custEnd = appJs.indexOf('function buildTelephonePdfHtml');
    const block = appJs.substring(custStart, custEnd);
    assert.ok(!block.includes('btoa(unescape'), 'custody PDF must not embed base64 payload');
  });

  it('no hidden base64 div in voluntary PDF builder', () => {
    const volStart = appJs.indexOf('function buildVoluntaryPdfHtml');
    const volEnd = appJs.indexOf('function getActivePdfBuilder');
    const block = appJs.substring(volStart, volEnd);
    assert.ok(!block.includes('btoa(unescape'), 'voluntary PDF must not embed base64 payload');
  });

  it('no hidden base64 div in telephone PDF builder', () => {
    const telStart = appJs.indexOf('function buildTelephonePdfHtml');
    const telEnd = appJs.indexOf('function buildVoluntaryPdfHtml');
    const block = appJs.substring(telStart, telEnd);
    assert.ok(!block.includes('btoa(unescape'), 'telephone PDF must not embed base64 payload');
  });
});

describe('H4 — Close warning for unsaved changes', () => {
  it('main.js listens for close event on mainWindow', () => {
    assert.ok(
      mainJs.includes("mainWindow.on('close'"),
      'main.js must handle the close event to intercept window close'
    );
  });

  it('main.js sends check-unsaved-changes to renderer', () => {
    assert.ok(
      mainJs.includes('check-unsaved-changes'),
      'main.js must send check-unsaved-changes IPC to renderer'
    );
  });

  it('main.js listens for close-confirmed from renderer', () => {
    assert.ok(
      mainJs.includes('close-confirmed'),
      'main.js must listen for close-confirmed IPC from renderer'
    );
  });

  it('preload exposes confirmClose and onCheckUnsavedChanges', () => {
    assert.ok(preloadJs.includes('confirmClose'), 'preload must expose confirmClose');
    assert.ok(preloadJs.includes('onCheckUnsavedChanges'), 'preload must expose onCheckUnsavedChanges');
  });

  it('app.js has close guard initialisation', () => {
    assert.ok(appJs.includes('_initCloseGuard'), 'app.js must define _initCloseGuard');
    assert.ok(appJs.includes('onCheckUnsavedChanges'), 'app.js must listen for check-unsaved-changes');
  });

  it('close guard checks debounce timer for pending unsaved edits', () => {
    assert.ok(
      appJs.includes('_quietSaveDebounceTimer'),
      'close guard isDirty check must include _quietSaveDebounceTimer to catch edits in the debounce window'
    );
    const guardFn = appJs.substring(appJs.indexOf('function _initCloseGuard'), appJs.indexOf('function safeInit'));
    assert.ok(
      guardFn.includes('_quietSaveDebounceTimer'),
      '_initCloseGuard must check _quietSaveDebounceTimer, not just _draftSaveInFlight/_draftSaveQueued'
    );
  });
});

describe('M4 — Voluntary PDF includes Consents & Retainer', () => {
  it('voluntary PDF has Consents & Retainer section', () => {
    const volStart = appJs.indexOf('function buildVoluntaryPdfHtml');
    const volEnd = appJs.indexOf('function getActivePdfBuilder');
    const block = appJs.substring(volStart, volEnd);

    assert.ok(
      block.includes('Consents'),
      'voluntary PDF must include Consents & Retainer section'
    );
  });

  it('voluntary PDF Consents section includes authority and retainer fields', () => {
    const volStart = appJs.indexOf('function buildVoluntaryPdfHtml');
    const volEnd = appJs.indexOf('function getActivePdfBuilder');
    const block = appJs.substring(volStart, volEnd);

    assert.ok(block.includes('clientAuthorityConfirmed'), 'must include authority confirmation');
    assert.ok(block.includes('retainerType'), 'must include retainer type');
    assert.ok(block.includes('retainerSigned'), 'must include retainer signed');
  });
});

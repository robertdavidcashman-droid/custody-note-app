/**
 * Manual Bill Workflow – QuickFile Configured
 *
 * End-to-end wiring test for the 3-step "Finish this matter" workflow
 * when QuickFile IS configured:
 *   Step 1: Documents & attachments
 *   Step 2: QuickFile invoice (billing review + invoice creation)
 *   Step 3: Review & complete (billing handover, office complete, archive)
 *
 * Covers: script load order, cross-file dependencies, step navigation,
 * QF-gated UI branches, calculation correctness, filename formatting,
 * guard rails, and data flow between steps.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const indexHtml       = read('index.html');
const mainJs          = read('main.js');
const preloadJs       = read('preload.js');
const appJs           = read('app.js');
const stepperJs       = read('renderer/views/workflow-stepper.js');
const documentsJs     = read('renderer/views/documents-screen.js');
const billingScreenJs = read('renderer/views/billing-screen.js');
const completionJs    = read('renderer/views/completion-screen.js');
const billingUtilsJs  = read('renderer/billingUtils.js');
const filenameUtilsJs = read('renderer/filenameUtils.js');
const billingJs       = read('renderer/views/billing.js');
const stylesCss       = read('styles.css');

// ═══════════════════════════════════════════════════════
//  1. SCRIPT LOAD ORDER & DEPENDENCY CHAIN
// ═══════════════════════════════════════════════════════

describe('Script load order in index.html', () => {
  const scriptOrder = [
    'renderer/filenameUtils.js',
    'renderer/billingUtils.js',
    'renderer/views/workflow-stepper.js',
    'renderer/views/documents-screen.js',
    'renderer/views/billing-screen.js',
    'renderer/views/completion-screen.js',
  ];

  it('loads all 6 workflow scripts in correct dependency order', () => {
    let lastIdx = -1;
    scriptOrder.forEach((script, i) => {
      const idx = indexHtml.indexOf(script);
      assert.ok(idx > 0, `Missing script: ${script}`);
      assert.ok(idx > lastIdx, `${script} must load after ${scriptOrder[i - 1] || 'start'} (idx ${idx} <= ${lastIdx})`);
      lastIdx = idx;
    });
  });

  it('filenameUtils loads before billingUtils (billingUtils depends on formatInvoiceTitle)', () => {
    assert.ok(indexHtml.indexOf('filenameUtils.js') < indexHtml.indexOf('billingUtils.js'));
  });

  it('workflow-stepper loads before step screens (stepper defines _wfGoNext, _wfMatterMeta etc.)', () => {
    assert.ok(indexHtml.indexOf('workflow-stepper.js') < indexHtml.indexOf('documents-screen.js'));
    assert.ok(indexHtml.indexOf('workflow-stepper.js') < indexHtml.indexOf('billing-screen.js'));
    assert.ok(indexHtml.indexOf('workflow-stepper.js') < indexHtml.indexOf('completion-screen.js'));
  });

  it('documents-screen loads before billing-screen (billing reads _wfGeneratedDocs)', () => {
    assert.ok(indexHtml.indexOf('documents-screen.js') < indexHtml.indexOf('billing-screen.js'));
  });
});

// ═══════════════════════════════════════════════════════
//  2. WORKFLOW STEPPER — NAVIGATION & STEP MANAGEMENT
// ═══════════════════════════════════════════════════════

describe('Workflow stepper — step definitions', () => {
  it('defines exactly 3 steps: documents, invoice, complete', () => {
    assert.ok(stepperJs.includes("id: 'documents'"));
    assert.ok(stepperJs.includes("id: 'invoice'"));
    assert.ok(stepperJs.includes("id: 'complete'"));
    const stepMatches = stepperJs.match(/id:\s*'/g);
    assert.strictEqual(stepMatches.length, 3);
  });

  it('step labels match expected UI text', () => {
    assert.ok(stepperJs.includes('Documents &amp; attachments'));
    assert.ok(stepperJs.includes('Billing review'));
    assert.ok(stepperJs.includes('Review &amp; complete'));
  });
});

describe('Workflow stepper — navigation functions', () => {
  it('_wfGoNext increments step and persists', () => {
    assert.ok(stepperJs.includes('function _wfGoNext'));
    assert.ok(stepperJs.includes('_workflowStep++'));
  });

  it('_wfGoBack decrements step', () => {
    assert.ok(stepperJs.includes('function _wfGoBack'));
    assert.ok(stepperJs.includes('_workflowStep--'));
  });

  it('_wfGoToStep allows jumping to any step', () => {
    assert.ok(stepperJs.includes('function _wfGoToStep'));
  });

  it('step navigation updates stepper UI, persists, and renders', () => {
    ['_wfGoNext', '_wfGoBack', '_wfGoToStep'].forEach(fn => {
      const fnBody = stepperJs.slice(stepperJs.indexOf('function ' + fn));
      assert.ok(fnBody.includes('_wfUpdateStepper'), fn + ' must call _wfUpdateStepper');
      assert.ok(fnBody.includes('_wfPersistStep'), fn + ' must call _wfPersistStep');
      assert.ok(fnBody.includes('_wfRenderCurrentStep'), fn + ' must call _wfRenderCurrentStep');
    });
  });

  it('step persistence uses sessionStorage keyed by attendance ID', () => {
    assert.ok(stepperJs.includes('cn_wf_step_'));
    assert.ok(stepperJs.includes('sessionStorage.setItem'));
    assert.ok(stepperJs.includes('sessionStorage.getItem'));
  });
});

describe('Workflow stepper — step routing', () => {
  it('_wfRenderCurrentStep dispatches to the correct render function per step', () => {
    assert.ok(stepperJs.includes("case 'documents': _wfRenderDocumentsStep"));
    assert.ok(stepperJs.includes("case 'invoice':   _wfRenderBillingStep"));
    assert.ok(stepperJs.includes("case 'complete':  _wfRenderCompletionStep"));
  });
});

describe('Workflow stepper — openWorkflow / closeWorkflow', () => {
  it('openWorkflow syncs form via getFormData before rendering (firm/station hidden fields)', () => {
    assert.ok(stepperJs.includes("if (typeof getFormData === 'function') getFormData()"));
  });

  it('resolves instructing firm display name from saved data, firms list, or DOM', () => {
    assert.ok(stepperJs.includes('_wfResolveFirmDisplayName'));
  });

  it('openWorkflow creates overlay and renders shell', () => {
    assert.ok(stepperJs.includes('function openWorkflow'));
    assert.ok(stepperJs.includes('_renderWorkflowShell'));
  });

  it('closeWorkflow removes overlay and fires callback', () => {
    assert.ok(stepperJs.includes('function closeWorkflow'));
    assert.ok(stepperJs.includes("overlay.remove()"));
    assert.ok(stepperJs.includes('_workflowOnClose'));
  });

  it('Escape key closes workflow', () => {
    assert.ok(stepperJs.includes("e.key === 'Escape'"));
  });

  it('overlay click-outside closes workflow', () => {
    assert.ok(stepperJs.includes('e.target === overlay'));
  });

  it('summary strip shows Client, Station, Date, Firm', () => {
    assert.ok(stepperJs.includes('Client'));
    assert.ok(stepperJs.includes('Station'));
    assert.ok(stepperJs.includes('Date'));
    assert.ok(stepperJs.includes('Firm'));
  });
});

// ═══════════════════════════════════════════════════════
//  3. STEP 1 — DOCUMENTS & ATTACHMENTS
// ═══════════════════════════════════════════════════════

describe('Step 1: Documents screen — form generation', () => {
  it('defines 8 generatable forms', () => {
    const formMatches = documentsJs.match(/\{\s*id:\s*'/g);
    assert.strictEqual(formMatches.length, 8, 'Expected 8 generatable forms');
  });

  const expectedForms = [
    'attendance_note', 'crm1', 'crm2', 'crm3',
    'declaration', 'conflict_cert', 'client_instructions', 'prepared_statement',
  ];
  expectedForms.forEach(id => {
    it(`includes form: ${id}`, () => {
      assert.ok(documentsJs.includes("id: '" + id + "'"));
    });
  });

  it('supports LAA-type and HTML-type forms', () => {
    assert.ok(documentsJs.includes("type: 'laa'"));
    assert.ok(documentsJs.includes("type: 'html'"));
  });

  it('generate button shows "Regenerate" for already-generated forms', () => {
    assert.ok(documentsJs.includes("'Regenerate'"));
  });

  it('generated forms get preview, save-to-desktop, and email buttons', () => {
    assert.ok(documentsJs.includes('wf-gen-preview-btn'));
    assert.ok(documentsJs.includes('wf-gen-save-btn'));
    assert.ok(documentsJs.includes('wf-gen-email-btn'));
  });

  it('stores generated docs with base64, size, label, and filename', () => {
    assert.ok(documentsJs.includes('base64: result.base64'));
    assert.ok(documentsJs.includes('size: result.size'));
    assert.ok(documentsJs.includes('label: form.label'));
    assert.ok(documentsJs.includes('filename: _wfFormFilename'));
  });
});

describe('Step 1: Documents screen — file uploads', () => {
  it('supports Add Files button via window.api.pickFile', () => {
    assert.ok(documentsJs.includes('wf-add-files-btn'));
    assert.ok(documentsJs.includes('api.pickFile'));
  });

  it('enforces max 20 attachments per record', () => {
    assert.ok(documentsJs.includes('Maximum 20 attachments'));
    assert.ok(documentsJs.includes('>= 20'));
  });

  it('has drag-and-drop zone (with pending implementation notice)', () => {
    assert.ok(documentsJs.includes('wf-upload-dropzone'));
    assert.ok(documentsJs.includes('dragover'));
    assert.ok(documentsJs.includes('dragleave'));
    assert.ok(documentsJs.includes("'drop'"));
  });
});

describe('Step 1: Documents screen — attachment table', () => {
  it('shows original name, document type selector, and renamed preview', () => {
    assert.ok(documentsJs.includes('Original file'));
    assert.ok(documentsJs.includes('Document type'));
    assert.ok(documentsJs.includes('Renamed preview'));
  });

  it('document type selector uses DOCUMENT_TYPE_OPTIONS from filenameUtils', () => {
    assert.ok(documentsJs.includes('DOCUMENT_TYPE_OPTIONS'));
  });

  it('supports "other" type with custom label input', () => {
    assert.ok(documentsJs.includes('wf-att-custom-type'));
    assert.ok(documentsJs.includes("documentType === 'other'"));
  });

  it('attachment removal splices from photos.attachments and re-renders', () => {
    assert.ok(documentsJs.includes('.splice(idx, 1)'));
    assert.ok(documentsJs.includes('_wfRenderCurrentStep'));
  });

  it('auto-saves after type change via quietSave', () => {
    assert.ok(documentsJs.includes('quietSave'));
  });
});

describe('Step 1: Documents screen — validation panel', () => {
  it('warns when no documents prepared', () => {
    assert.ok(documentsJs.includes('No documents prepared'));
  });

  it('warns when attachments have no document type', () => {
    assert.ok(documentsJs.includes('has no document type selected'));
  });

  it('warns on "other" type without custom label', () => {
    assert.ok(documentsJs.includes('is type "other" but has no custom label'));
  });

  it('warns on duplicate document types', () => {
    assert.ok(documentsJs.includes('Duplicate document type'));
  });
});

describe('Step 1: Documents screen — action guide', () => {
  it('shows "What to do on this step" guide', () => {
    assert.ok(documentsJs.includes('wf-action-guide'));
    assert.ok(documentsJs.includes('What to do on this step'));
  });

  it('guides user to generate Attendance Note PDF', () => {
    assert.ok(documentsJs.includes('Attendance Note PDF'));
  });

  it('guides user to click Next when ready', () => {
    assert.ok(documentsJs.includes('Next: QuickFile invoice'));
  });

  it('marks completed guide steps with done class', () => {
    assert.ok(documentsJs.includes('wf-action-guide-item--done'));
  });
});

describe('Step 1: Documents screen — footer', () => {
  it('Next button goes to QuickFile invoice step', () => {
    assert.ok(documentsJs.includes('Next: QuickFile invoice'));
    assert.ok(documentsJs.includes('_wfGoNext'));
  });

  it('Next button is visually prominent (wf-btn-next-action)', () => {
    assert.ok(documentsJs.includes('wf-btn-next-action'));
  });

  it('shows generated form count badge', () => {
    assert.ok(documentsJs.includes('wf-gen-count-badge'));
    assert.ok(documentsJs.includes("form' + (genCount > 1 ? 's' : '') + ' ready"));
  });
});

// ═══════════════════════════════════════════════════════
//  4. STEP 2 — QUICKFILE INVOICE (BILLING SCREEN)
// ═══════════════════════════════════════════════════════

describe('Step 2: Billing screen — QuickFile-configured path', () => {
  it('screen title includes step number and "QuickFile invoice" when QF configured', () => {
    assert.ok(billingScreenJs.includes("Step 2"));
    assert.ok(billingScreenJs.includes("QuickFile invoice"));
  });

  it('shows "Send Bill to QuickFile" button only when QF is configured', () => {
    assert.ok(billingScreenJs.includes("qfConfigured"));
    assert.ok(billingScreenJs.includes("Send Bill to QuickFile"));
  });

  it('"Send Bill to QuickFile" button is disabled until all 3 review checkboxes are checked', () => {
    assert.ok(billingScreenJs.includes('createBtn.disabled = !allChecked'));
    assert.ok(billingScreenJs.includes('wf-check-attendance'));
    assert.ok(billingScreenJs.includes('wf-check-docs'));
    assert.ok(billingScreenJs.includes('wf-check-billing'));
  });

  it('disabled Send Bill to QuickFile button explains WHY it is locked', () => {
    assert.ok(billingScreenJs.includes('tick all 3 checkboxes first'));
  });

  it('Send Bill to QuickFile button text changes when unlocked', () => {
    assert.ok(billingScreenJs.includes("'&#10003; Send Bill to QuickFile'"));
  });

  /* The 3 forward variations on Step 2 (Send / Skip / Next) were merged
   * into ONE contextual primary button (#wf-bill-create with data-mode)
   * so the user always sees a single forward action. The label flips by
   * QuickFile state. */
  it('shows "Continue to Review & complete" forward action when invoice already exists', () => {
    assert.ok(billingScreenJs.includes('Continue to Review &amp; complete'));
    assert.ok(billingScreenJs.includes('data-mode="next"'));
  });

  it('shows "Continue without invoice" forward action when QF not configured', () => {
    assert.ok(billingScreenJs.includes('Continue without invoice'));
    assert.ok(billingScreenJs.includes('data-mode="skip"'));
  });

  it('detects existing invoice via quickfile_invoice_id in invoice status', () => {
    assert.ok(billingScreenJs.includes('invoiceStatus.quickfile_invoice_id'));
  });
});

describe('Step 2: Billing screen — skip invoice path', () => {
  /* Skip-invoice was a separate secondary button (#wf-bill-skip-invoice).
   * The old secondary skip button stays removed. When QuickFile is not
   * configured, the single forward action is the explicit Review & complete
   * button required by the workflow E2E tests. */
  it('separate #wf-bill-skip-invoice button has been removed', () => {
    assert.ok(!billingScreenJs.includes('wf-bill-skip-invoice'),
      'wf-bill-skip-invoice should stay removed; #wf-bill-next-complete is the single forward action');
  });

  it('next-complete button uses data-mode="skip" when QF is not configured', () => {
    const fnIdx = billingScreenJs.indexOf('function _wfBuildBillingFooter');
    assert.ok(fnIdx !== -1);
    const fnBlock = billingScreenJs.substring(fnIdx, fnIdx + 2000);
    assert.ok(fnBlock.includes('id="wf-bill-next-complete"'), 'manual billing path should expose #wf-bill-next-complete');
    assert.ok(fnBlock.includes('data-mode="skip"'), 'skip mode should be set when !qfConfigured');
    assert.ok(fnBlock.includes('Next: Review &amp; complete'), 'skip label should be Next: Review & complete');
  });

  it('clicking next-complete in skip mode advances directly', () => {
    const idx = billingScreenJs.indexOf("createBtn.dataset.mode || 'send'");
    assert.ok(idx !== -1, 'merged primary-button click handler not found');
    const block = billingScreenJs.substring(idx, idx + 600);
    assert.ok(block.includes("'skip'"), 'handler must branch on the skip mode');
    assert.ok(block.includes('_wfGoNext'), 'should advance to next step');
  });
});

describe('Step 2: Billing screen — action guide', () => {
  it('shows "What to do on this step" guide when QF configured', () => {
    assert.ok(billingScreenJs.includes('wf-action-guide'));
    assert.ok(billingScreenJs.includes('What to do on this step'));
  });

  it('tells user to check charges, tick boxes, then send the bill to QuickFile', () => {
    assert.ok(billingScreenJs.includes('charges and amounts are correct'));
    assert.ok(billingScreenJs.includes('Review Confirmation'));
    assert.ok(billingScreenJs.includes('Send Bill to QuickFile'));
  });

  it('guide differs when invoice already exists', () => {
    assert.ok(billingScreenJs.includes('Invoice already created'));
    assert.ok(billingScreenJs.includes('Continue to Review &amp; complete'));
  });

  it('guide mentions the merged skip-invoice path when no existing invoice', () => {
    assert.ok(billingScreenJs.includes('Continue without invoice'));
    assert.ok(billingScreenJs.includes('invoicing was handled separately'));
  });
});

describe('Steps 1-2: Per-step Archive removed (linear workflow)', () => {
  /* The linear finish-matter flow (Documents \u2192 Invoice \u2192 Review/Archive)
   * means Archive only lives on Step 3. The per-step Archive buttons that
   * used to be on Steps 1 and 2 were removed because they let users skip
   * over invoice review. Users who need to file a matter without invoicing
   * use the form header's "Archive matter" action instead. */
  it('exposes archive handler on window from completion screen', () => {
    assert.ok(completionJs.includes('window._wfRunArchiveFromWorkflow = _wfRunArchiveFromWorkflow'));
  });

  it('Step 2 (billing) no longer renders a per-step Archive button', () => {
    assert.ok(!billingScreenJs.includes('wf-bill-archive'),
      'wf-bill-archive removed: per-step Archive on Step 2 was confusing because it bypassed invoice review');
  });

  it('Step 1 (documents) no longer renders a per-step Archive button', () => {
    assert.ok(!documentsJs.includes('wf-doc-archive'),
      'wf-doc-archive removed: per-step Archive on Step 1 was confusing because it bypassed invoice review');
  });

  it('Step 3 (completion) is the only step with Archive', () => {
    assert.ok(completionJs.includes('id="wf-complete-archive"'),
      'Step 3 must keep its Archive button \u2014 it is the sole archive entry point inside the workflow');
  });

  it('refreshes matter meta after async billing loads so firm name is not stale', () => {
    assert.ok(billingScreenJs.includes('meta = _wfMatterMeta()'));
  });
});

describe('Step 2: Billing screen — review confirmation UX', () => {
  it('review confirmation card has prominent border styling', () => {
    assert.ok(billingScreenJs.includes('wf-review-confirmation-card'));
  });

  it('explains that all 3 boxes must be ticked to unlock QuickFile send action', () => {
    assert.ok(billingScreenJs.includes('tick all 3 to unlock QuickFile'));
    assert.ok(billingScreenJs.includes('wf-review-confirm-hint'));
  });

  it('shows live lock/unlock status indicator', () => {
    assert.ok(billingScreenJs.includes('wf-review-confirm-status'));
    assert.ok(billingScreenJs.includes('wf-review-status'));
  });

  it('status changes to unlocked state when all boxes checked', () => {
    assert.ok(billingScreenJs.includes('wf-review-confirm-status--unlocked'));
    assert.ok(billingScreenJs.includes('now unlocked'));
  });

  it('shows checkbox progress count (e.g. 1/3 done)', () => {
    assert.ok(billingScreenJs.includes('/3 done'));
  });
});

describe('Step 2: Billing screen — data loading', () => {
  it('loads station mileage, invoice status, audit log, and QuickFile state in parallel', () => {
    assert.ok(billingScreenJs.includes('Promise.allSettled'));
    assert.ok(billingScreenJs.includes('stationMileageGet'));
    assert.ok(billingScreenJs.includes('attendanceInvoiceStatus'));
    assert.ok(billingScreenJs.includes('billingAuditLogGet'));
    assert.ok(billingScreenJs.includes('quickfileConnectionState'));
  });

  it('uses allSettled so partial failures still render billing with DB-backed QuickFile state', () => {
    assert.ok(billingScreenJs.includes('Promise.allSettled'));
    assert.ok(billingScreenJs.includes('_wfIsQuickFileConfigured'));
    assert.ok(!billingScreenJs.includes('}).catch(function ()'), 'must not downgrade QF on load failure');
  });

  it('resolves quickfileConnectionState in loadJobs before Send Bill to QuickFile UI', () => {
    const qfIdx = billingScreenJs.indexOf('quickfileConnectionState');
    const sendIdx = billingScreenJs.indexOf('wf-bill-create');
    assert.ok(qfIdx > -1 && sendIdx > qfIdx, 'connection state must load before send button markup');
    assert.ok(billingScreenJs.includes('var qfConnection = val(4, null)'));
    assert.ok(billingScreenJs.includes('var qfConfigured = _wfIsQuickFileConfigured'));
  });

  it('auto-populates mileage from station database when form has no miles', () => {
    assert.ok(billingScreenJs.includes('stationMileage.mileage_from_base'));
  });

  it('prefers existing invoice values over defaults when invoice exists', () => {
    assert.ok(billingScreenJs.includes('hasExisting && invoiceStatus.invoice_attendance_fee'));
    assert.ok(billingScreenJs.includes('hasExisting && invoiceStatus.invoice_mileage_miles'));
    assert.ok(billingScreenJs.includes('hasExisting && invoiceStatus.invoice_mileage_rate'));
    assert.ok(billingScreenJs.includes('hasExisting && invoiceStatus.invoice_parking_amount'));
    assert.ok(billingScreenJs.includes('hasExisting && invoiceStatus.invoice_vat_rate'));
  });
});

describe('Step 2: Billing screen — charges form & live preview', () => {
  it('has editable inputs for Fee, Miles, Rate, Parking, VAT', () => {
    assert.ok(billingScreenJs.includes('id="wf-fee"'));
    assert.ok(billingScreenJs.includes('id="wf-miles"'));
    assert.ok(billingScreenJs.includes('id="wf-rate"'));
    assert.ok(billingScreenJs.includes('id="wf-parking"'));
    assert.ok(billingScreenJs.includes('id="wf-vat"'));
  });

  it('live-recalculates preview on input change', () => {
    assert.ok(billingScreenJs.includes('_wfRecalcPreview'));
    assert.ok(billingScreenJs.includes("'input'"));
    assert.ok(billingScreenJs.includes('wf-calc'));
  });

  it('recalculation updates subtotal, VAT, and total elements', () => {
    assert.ok(billingScreenJs.includes('wf-prev-sub'));
    assert.ok(billingScreenJs.includes('wf-prev-vat'));
    assert.ok(billingScreenJs.includes('wf-prev-total'));
  });

  it('preview table shows line items: fee, mileage (conditional), parking (conditional)', () => {
    assert.ok(billingScreenJs.includes('totals.mileageAmount > 0'));
    assert.ok(billingScreenJs.includes('totals.parkingAmount > 0'));
    assert.ok(billingScreenJs.includes('Parking/disbursements'));
  });

  it('VAT input is expressed as percentage (multiplied by 100, normalised against >1 values)', () => {
    // v1.5.4: the value is now wrapped in a normaliser IIFE that divides by 100
    // first if opts.vatRate accidentally arrives as the percentage form (>1).
    // This protects against the "shows 2000 instead of 20" bug.
    assert.ok(
      billingScreenJs.includes('var vr = (opts.vatRate || 0.20); if (vr > 1) vr = vr / 100; return (vr * 100).toFixed(0);'),
      'wf-vat input must use the normaliser IIFE so 20 → "20" (not "2000") and 0.20 → "20"'
    );
  });

  it('recalc divides VAT percentage by 100 before passing to calculateInvoiceTotals', () => {
    assert.ok(billingScreenJs.includes('vatRate: vatPct / 100'));
  });
});

describe('Step 2: Billing screen — document selection panel', () => {
  it('shows generated forms with checkboxes for invoice attachment', () => {
    assert.ok(billingScreenJs.includes('wf-doc-sel-cb'));
    assert.ok(billingScreenJs.includes('Documents to Attach to Invoice'));
  });

  it('has Select All / Deselect All buttons', () => {
    assert.ok(billingScreenJs.includes('wf-doc-sel-all'));
    assert.ok(billingScreenJs.includes('wf-doc-sel-none'));
    assert.ok(billingScreenJs.includes('Select All'));
    assert.ok(billingScreenJs.includes('Deselect All'));
  });

  it('shows selected document count summary', () => {
    assert.ok(billingScreenJs.includes('wf-doc-sel-summary'));
    assert.ok(billingScreenJs.includes('selected for attachment'));
  });

  it('notes that uploaded files must be attached to QuickFile manually', () => {
    assert.ok(billingScreenJs.includes('must be attached to QuickFile manually'));
  });

  it('empty state shows message to go back to Documents step', () => {
    assert.ok(billingScreenJs.includes('Go back to the Documents step'));
  });

  it('generated docs default to selected (checked)', () => {
    assert.ok(billingScreenJs.includes("_wfSelectedDocs['gen_' + key] === undefined"));
    assert.ok(billingScreenJs.includes("_wfSelectedDocs['gen_' + key] = true"));
  });
});

describe('Step 2: Billing screen — invoice narrative', () => {
  it('builds narrative from client, station, date, offence', () => {
    assert.ok(billingScreenJs.includes('_buildInvoiceNarrative'));
    assert.ok(billingScreenJs.includes('meta.clientName'));
    assert.ok(billingScreenJs.includes('meta.stationName'));
    assert.ok(billingScreenJs.includes('meta.attendanceDate'));
    assert.ok(billingScreenJs.includes('meta.offenceSummary'));
  });

  it('narrative is editable via textarea', () => {
    assert.ok(billingScreenJs.includes('id="wf-narrative"'));
    assert.ok(billingScreenJs.includes('textarea'));
  });

  it('preserves existing narrative from invoice status', () => {
    assert.ok(billingScreenJs.includes('invoiceStatus.invoice_narrative'));
  });
});

describe('Step 2: Billing screen — invoice creation', () => {
  it('_wfHandleCreateInvoice reads current form values (not just initial opts)', () => {
    const fn = billingScreenJs.slice(billingScreenJs.indexOf('function _wfHandleCreateInvoice('));
    assert.ok(fn.includes("getElementById('wf-fee').value"));
    assert.ok(fn.includes("getElementById('wf-miles').value"));
    assert.ok(fn.includes("getElementById('wf-rate').value"));
    assert.ok(fn.includes("getElementById('wf-parking').value"));
    assert.ok(fn.includes("getElementById('wf-vat').value"));
    assert.ok(fn.includes("getElementById('wf-narrative')"));
  });

  it('collects selected document attachments for invoice', () => {
    assert.ok(billingScreenJs.includes('_wfGetSelectedDocAttachments'));
    assert.ok(billingScreenJs.includes('extraAttachments'));
  });

  it('validates record is saved before creating invoice', () => {
    assert.ok(billingScreenJs.includes('Save the record first'));
  });

  it('validates API availability', () => {
    assert.ok(billingScreenJs.includes('Invoice API is not available'));
  });

  it('confirms duplicate invoice creation with existing invoice number', () => {
    assert.ok(billingScreenJs.includes('already has an invoice'));
    assert.ok(billingScreenJs.includes('showConfirm'));
    assert.ok(billingScreenJs.includes('allowDuplicate'));
  });

  it('validates firm is selected', () => {
    assert.ok(billingScreenJs.includes('Select the instructing firm'));
  });

  it('firm-missing callout offers navigation to firm section', () => {
    assert.ok(billingScreenJs.includes('wf-firm-missing-callout'));
    assert.ok(billingScreenJs.includes('wf-goto-firm-section'));
    assert.ok(billingScreenJs.includes('goToInstructingFirmSection'));
  });

  it('disables button and shows "Sending to QuickFile..." during API call', () => {
    assert.ok(billingScreenJs.includes("createBtn.textContent = 'Sending to QuickFile...'"));
  });

  it('re-enables button on success or failure (finally block)', () => {
    assert.ok(billingScreenJs.includes('finally'));
    assert.ok(billingScreenJs.includes('createBtn.disabled = false'));
  });

  it('on success: saves formData, quietSave, refreshes display, shows toast', () => {
    assert.ok(billingScreenJs.includes('formData.quickfile_invoice_id'));
    assert.ok(billingScreenJs.includes('formData.quickfileInvoiceNumber'));
    assert.ok(billingScreenJs.includes('quietSave'));
    assert.ok(billingScreenJs.includes('refreshQuickFileInvoiceRefDisplay'));
    assert.ok(billingScreenJs.includes('sent successfully'));
  });

  it('on success: auto-advances to completion step', () => {
    assert.ok(billingScreenJs.includes('_wfAfterInvoiceCreatedGoToCompletion'));
  });

  it('attachment results summary shows ok/fail counts', () => {
    assert.ok(billingScreenJs.includes('attachResults'));
    assert.ok(billingScreenJs.includes("' attachment'"));
    assert.ok(billingScreenJs.includes("' failed'"));
  });

  it('on failure: shows a clear error with a recovery action (single handler)', () => {
    assert.ok(billingScreenJs.includes('Send to QuickFile failed:'));
    assert.ok(billingScreenJs.includes('function _wfShowInvoiceFailure'));
    // Both the result-not-ok branch and the catch branch route through the
    // single recovery handler so the message + retry guidance is consistent.
    const calls = (billingScreenJs.match(/_wfShowInvoiceFailure\(/g) || []).length;
    assert.ok(calls >= 3, 'expected definition + two call sites, found ' + calls);
  });
});

describe('Step 2: Billing screen — audit log', () => {
  it('displays billing history details when audit log present', () => {
    assert.ok(billingScreenJs.includes('wf-audit-details'));
    assert.ok(billingScreenJs.includes('Billing History'));
    assert.ok(billingScreenJs.includes('entry.timestamp'));
    assert.ok(billingScreenJs.includes('entry.action'));
    assert.ok(billingScreenJs.includes('entry.details'));
  });
});

// ═══════════════════════════════════════════════════════
//  5. STEP 3 — REVIEW & COMPLETE
// ═══════════════════════════════════════════════════════

describe('Step 3: Completion screen — progress checklist', () => {
  it('checks attendance note finalised', () => {
    assert.ok(completionJs.includes('Attendance note finalised'));
    assert.ok(completionJs.includes('_wfCompletionNoteFinalised'));
  });

  it('checks billing data complete (uses getBillingHardWarnings)', () => {
    assert.ok(completionJs.includes('Billing data complete'));
    assert.ok(completionJs.includes('getBillingHardWarnings'));
  });

  it('checks QuickFile invoice linked — only when QF is on', () => {
    assert.ok(completionJs.includes('QuickFile invoice linked'));
    assert.ok(completionJs.includes("if (qfOn)"));
  });

  it('checks attachments named', () => {
    assert.ok(completionJs.includes('Attachments named on file'));
  });

  it('all rows show ok/pending icons', () => {
    assert.ok(completionJs.includes('wf-completion-row--ok'));
    assert.ok(completionJs.includes('wf-completion-row--pending'));
  });
});

describe('Step 3: Completion screen — billing summary (actual bill / Step 2 figures)', () => {
  it('builds summary from resolveWorkflowBillingTotals (same as billing review, not LAA time rates)', () => {
    assert.ok(completionJs.includes('_wfBuildBillingSummaryCard'));
    assert.ok(completionJs.includes('resolveWorkflowBillingTotals'));
    assert.ok(completionJs.includes('Billing summary (this matter)'));
  });

  it('does not show LAA notional time breakdown (Section 9 six-minute style)', () => {
    assert.ok(!completionJs.includes('travelSocial'));
    assert.ok(!completionJs.includes('adviceUnsocial'));
  });

  it('includes fixed line, optional mileage and parking, subtotal, VAT, total', () => {
    assert.ok(completionJs.includes('Mileage'));
    assert.ok(completionJs.includes('Subtotal (ex VAT)'));
    assert.ok(completionJs.includes('Total (inc. VAT)'));
  });
});

describe('Step 3: Completion screen — action guide', () => {
  it('shows "What to do on this step" guide', () => {
    assert.ok(completionJs.includes('wf-action-guide'));
    assert.ok(completionJs.includes('What to do on this step'));
  });

  it('guides user to Archive or Close', () => {
    assert.ok(completionJs.includes('<strong>Archive</strong>'));
    assert.ok(completionJs.includes('<strong>Close</strong>'));
    assert.ok(completionJs.includes('billing and office completion are recorded automatically'));
  });
});

describe('Step 3: Completion screen — actions', () => {
  it('Archive requires note finalised', () => {
    assert.ok(completionJs.includes('Finalise the attendance note before archiving'));
  });

  it('Archive stamps billingProcessCompletedAt and officeWorkCompletedAt when missing', () => {
    assert.ok(completionJs.includes('billingProcessCompletedAt'));
    assert.ok(completionJs.includes('officeWorkCompletedAt'));
    assert.ok(completionJs.includes('new Date().toISOString()'));
  });

  it('Archive saves completed status then calls attendanceArchive', () => {
    assert.ok(completionJs.includes("status: 'completed'"));
    assert.ok(completionJs.includes('attendanceArchive'));
  });

  it('Archive closes workflow and shows archived list filter', () => {
    assert.ok(completionJs.includes('closeWorkflow'));
    assert.ok(completionJs.includes("setListFilterAndShowList('archived')"));
  });

  it('Export billing summary PDF button exists', () => {
    assert.ok(completionJs.includes('wf-export-billing-pdf'));
    assert.ok(completionJs.includes('exportBillingSummaryPdf'));
  });

  it('footer has Archive (Close removed for linear flow)', () => {
    assert.ok(completionJs.includes('id="wf-complete-archive"'));
    assert.ok(!completionJs.includes('id="wf-complete-close"'),
      'wf-complete-close was removed \u2014 Step 3 is final, users go Back if they need to bail');
    assert.ok(completionJs.includes('Archive &amp; close</button>'),
      'Primary action label updated to "Archive & close"');
  });

  it('primary action buttons use wf-btn-next-action class', () => {
    assert.ok(completionJs.includes('wf-btn-next-action'));
  });
});

describe('Step 3: Completion screen — after-invoice auto-advance', () => {
  it('_wfAfterInvoiceCreatedGoToCompletion navigates to step index 2', () => {
    assert.ok(completionJs.includes('function _wfAfterInvoiceCreatedGoToCompletion'));
    assert.ok(completionJs.includes('_wfGoToStep(2)'));
  });
});

// ═══════════════════════════════════════════════════════
//  6. BILLING CALCULATION CORRECTNESS
// ═══════════════════════════════════════════════════════

describe('calculateInvoiceTotals — correctness', () => {
  // Inline the function for direct testing
  function calculateInvoiceTotals(opts) {
    var fixedFee = parseFloat(opts.fixedFee);
    if (!Number.isFinite(fixedFee) || fixedFee < 0) fixedFee = 0;
    var mileageMiles = parseFloat(opts.mileageMiles);
    if (!Number.isFinite(mileageMiles) || mileageMiles < 0) mileageMiles = 0;
    var mileageRate = parseFloat(opts.mileageRate);
    if (!Number.isFinite(mileageRate)) mileageRate = 0.45;
    var vatRate = parseFloat(opts.vatRate);
    if (!Number.isFinite(vatRate)) vatRate = 0.20;
    var mileageAmount = mileageMiles * mileageRate;
    var subTotal = fixedFee + mileageAmount;
    var parkingAmount = parseFloat(opts.parkingAmount) || 0;
    subTotal += parkingAmount;
    var vatTotal = subTotal * vatRate;
    var roundedSub = Number(subTotal.toFixed(2));
    var roundedVat = Number(vatTotal.toFixed(2));
    return {
      fixedFee: Number(fixedFee.toFixed(2)),
      mileageMiles: mileageMiles,
      mileageRate: Number(mileageRate.toFixed(2)),
      mileageAmount: Number(mileageAmount.toFixed(2)),
      parkingAmount: Number(parkingAmount.toFixed(2)),
      subTotal: roundedSub,
      vatRate: vatRate,
      vatTotal: roundedVat,
      grandTotal: Number((roundedSub + roundedVat).toFixed(2)),
    };
  }

  it('standard invoice: £160 fee + 20 miles @ £0.45 + £5 parking + 20% VAT', () => {
    const t = calculateInvoiceTotals({ fixedFee: 160, mileageMiles: 20, mileageRate: 0.45, parkingAmount: 5, vatRate: 0.20 });
    assert.strictEqual(t.fixedFee, 160.00);
    assert.strictEqual(t.mileageAmount, 9.00);
    assert.strictEqual(t.parkingAmount, 5.00);
    assert.strictEqual(t.subTotal, 174.00);
    assert.strictEqual(t.vatTotal, 34.80);
    assert.strictEqual(t.grandTotal, 208.80);
  });

  it('fee only (no mileage, no parking)', () => {
    const t = calculateInvoiceTotals({ fixedFee: 160, mileageMiles: 0, mileageRate: 0.45, parkingAmount: 0, vatRate: 0.20 });
    assert.strictEqual(t.subTotal, 160.00);
    assert.strictEqual(t.grandTotal, 192.00);
  });

  it('handles NaN/undefined inputs gracefully', () => {
    const t = calculateInvoiceTotals({ fixedFee: NaN, mileageMiles: undefined, mileageRate: null, parkingAmount: 'abc', vatRate: undefined });
    assert.strictEqual(t.fixedFee, 0);
    assert.strictEqual(t.mileageMiles, 0);
    assert.strictEqual(t.mileageRate, 0.45);
    assert.strictEqual(t.vatRate, 0.20);
    assert.strictEqual(t.grandTotal, 0);
  });

  it('negative fee treated as zero', () => {
    const t = calculateInvoiceTotals({ fixedFee: -50, mileageMiles: 0, mileageRate: 0.45, parkingAmount: 0, vatRate: 0.20 });
    assert.strictEqual(t.fixedFee, 0);
  });

  it('rounding: avoids floating-point drift (e.g. 0.1 + 0.2 issue)', () => {
    const t = calculateInvoiceTotals({ fixedFee: 10.10, mileageMiles: 0, mileageRate: 0.45, parkingAmount: 0.20, vatRate: 0.20 });
    assert.strictEqual(t.subTotal, 10.30);
    assert.strictEqual(t.vatTotal, 2.06);
    assert.strictEqual(t.grandTotal, 12.36);
  });
});

// ═══════════════════════════════════════════════════════
//  7. FILENAME & INVOICE TITLE UTILITIES
// ═══════════════════════════════════════════════════════

describe('filenameUtils — formatInvoiceTitle', () => {
  it('source function exists', () => {
    assert.ok(filenameUtilsJs.includes('function formatInvoiceTitle'));
  });

  it('combines client and station with " - "', () => {
    assert.ok(filenameUtilsJs.includes("join(' - ')"));
  });

  it('uses formatStationShort which abbreviates "police station" to "ps"', () => {
    assert.ok(filenameUtilsJs.includes('function formatStationShort'));
    assert.ok(filenameUtilsJs.includes("'ps'"));
  });
});

describe('filenameUtils — buildLine1Description', () => {
  // Inline for direct testing
  function _collapseSpaces(str) { return String(str || '').replace(/\s+/g, ' ').trim(); }
  function formatDateForFilename(dateStr) {
    if (!dateStr) return '';
    var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return m[3] + '.' + m[2] + '.' + m[1].slice(2);
  }
  function buildLine1Description(record) {
    var client = _collapseSpaces(record.clientName || '');
    var station = _collapseSpaces(record.policeStation || record.stationName || '');
    var dateFmt = formatDateForFilename(record.attendanceDate || record.date || '');
    return ['Police Station Attendance Fixed Fee', client, station, dateFmt]
      .filter(Boolean).join(' - ');
  }

  it('produces "Police Station Attendance Fixed Fee - John Smith - Brixton - 15.04.26"', () => {
    const result = buildLine1Description({ clientName: 'John Smith', policeStation: 'Brixton', attendanceDate: '2026-04-15' });
    assert.strictEqual(result, 'Police Station Attendance Fixed Fee - John Smith - Brixton - 15.04.26');
  });

  it('omits missing parts gracefully', () => {
    const result = buildLine1Description({ clientName: 'Jane Doe' });
    assert.strictEqual(result, 'Police Station Attendance Fixed Fee - Jane Doe');
  });

  it('returns just prefix when all parts empty', () => {
    const result = buildLine1Description({});
    assert.strictEqual(result, 'Police Station Attendance Fixed Fee');
  });
});

describe('filenameUtils — DOCUMENT_TYPE_OPTIONS', () => {
  it('source defines 8 document type options', () => {
    const matches = filenameUtilsJs.match(/value:\s*'/g);
    assert.strictEqual(matches.length, 8);
  });

  const expectedTypes = [
    'police_station_attendance_note', 'declaration', 'custody_record',
    'disclosure', 'interview_notes', 'legal_aid_form', 'invoice_support', 'other',
  ];
  expectedTypes.forEach(type => {
    it(`includes document type: ${type}`, () => {
      assert.ok(filenameUtilsJs.includes("value: '" + type + "'"));
    });
  });
});

describe('filenameUtils — formatAttachmentFilename', () => {
  it('source function exists and strips forbidden chars', () => {
    assert.ok(filenameUtilsJs.includes('function formatAttachmentFilename'));
    assert.ok(filenameUtilsJs.includes('_stripForbiddenChars'));
  });

  it('truncates filename to 240 chars', () => {
    assert.ok(filenameUtilsJs.includes('.slice(0, 240)'));
  });

  it('joins parts with _-_ separator', () => {
    assert.ok(filenameUtilsJs.includes("join('_-_')"));
  });
});

// ═══════════════════════════════════════════════════════
//  8. CROSS-STEP DATA FLOW
// ═══════════════════════════════════════════════════════

describe('Cross-step data flow — docs to billing', () => {
  it('_wfGeneratedDocs is shared between documents-screen and billing-screen', () => {
    assert.ok(documentsJs.includes('_wfGeneratedDocs'));
    assert.ok(billingScreenJs.includes('_wfGeneratedDocs'));
  });

  it('_wfSelectedDocs is used for document selection on billing screen', () => {
    assert.ok(billingScreenJs.includes('_wfSelectedDocs'));
  });

  it('openWorkflow resets _wfGeneratedDocs and _wfSelectedDocs', () => {
    assert.ok(stepperJs.includes('_wfGeneratedDocs = {}'));
    assert.ok(stepperJs.includes('_wfSelectedDocs = {}'));
  });
});

describe('Cross-step data flow — billing to completion', () => {
  it('completion checks quickfile_invoice_id from formData', () => {
    assert.ok(completionJs.includes('quickfile_invoice_id'));
  });

  it('completion checks quickfileInvoiceNumber from formData', () => {
    assert.ok(completionJs.includes('quickfileInvoiceNumber'));
  });

  it('auto-advance from invoice creation to completion step works', () => {
    assert.ok(billingScreenJs.includes('_wfAfterInvoiceCreatedGoToCompletion'));
    assert.ok(completionJs.includes('function _wfAfterInvoiceCreatedGoToCompletion'));
  });
});

// ═══════════════════════════════════════════════════════
//  9. GUARD RAILS & EDGE CASES
// ═══════════════════════════════════════════════════════

describe('Guard rails — workflow', () => {
  it('openWorkflow prevents double-open', () => {
    assert.ok(stepperJs.includes('if (_workflowOpen) return'));
  });

  it('step index is clamped to valid range on restore', () => {
    assert.ok(stepperJs.includes('_workflowSteps.length - 1'));
    assert.ok(stepperJs.includes('n < 0'));
  });

  it('step index is clamped on _wfGoToStep', () => {
    assert.ok(stepperJs.includes('Math.max(0, Math.min'));
  });

  it('billing screen handles missing firm gracefully with callout', () => {
    assert.ok(billingScreenJs.includes('firmMissing'));
    assert.ok(billingScreenJs.includes('wf-callout-warn'));
  });

  it('completion screen handles no attachments (count === 0)', () => {
    assert.ok(completionJs.includes('am.count === 0'));
    assert.ok(completionJs.includes('No attachments on this record'));
  });
});

// ═══════════════════════════════════════════════════════
// 10. STYLES — WORKFLOW UI
// ═══════════════════════════════════════════════════════

describe('Workflow styles', () => {
  it('has workflow overlay styles', () => {
    assert.ok(stylesCss.includes('.wf-overlay'));
  });

  it('has workflow panel styles', () => {
    assert.ok(stylesCss.includes('.wf-panel'));
  });

  it('has workflow stepper styles', () => {
    assert.ok(stylesCss.includes('.wf-stepper'));
    assert.ok(stylesCss.includes('.wf-step'));
  });

  it('has step active and done states', () => {
    assert.ok(stylesCss.includes('.wf-step--active'));
    assert.ok(stylesCss.includes('.wf-step--done'));
  });

  it('has completion row styles', () => {
    assert.ok(stylesCss.includes('.wf-completion-row'));
  });

  it('has document selection styles', () => {
    assert.ok(stylesCss.includes('.wf-doc-sel'));
  });

  it('has action guide styles', () => {
    assert.ok(stylesCss.includes('.wf-action-guide'));
    assert.ok(stylesCss.includes('.wf-action-guide-title'));
    assert.ok(stylesCss.includes('.wf-action-guide-list'));
    assert.ok(stylesCss.includes('.wf-action-guide-item'));
    assert.ok(stylesCss.includes('.wf-action-guide-item--done'));
  });

  it('has review confirmation card styles', () => {
    assert.ok(stylesCss.includes('.wf-review-confirm-hint'));
    assert.ok(stylesCss.includes('.wf-review-confirm-status'));
    assert.ok(stylesCss.includes('.wf-review-confirm-status--unlocked'));
    assert.ok(stylesCss.includes('.wf-review-confirmation-card'));
  });

  it('has primary action button prominence styles', () => {
    assert.ok(stylesCss.includes('.wf-btn-next-action'));
  });

  it('has footer spacer for button alignment', () => {
    assert.ok(stylesCss.includes('.wf-footer-spacer'));
  });

  it('has dark mode for action guide', () => {
    assert.ok(stylesCss.includes('html.dark .wf-action-guide'));
    assert.ok(stylesCss.includes('html.dark .wf-review-confirm-status'));
  });
});

// ═══════════════════════════════════════════════════════
// 11. BILLING UTILS — QUICKFILE PAYLOAD BUILDER
// ═══════════════════════════════════════════════════════

describe('billingUtils — calculateInvoiceTotals source', () => {
  it('clamps negative fixedFee to 0', () => {
    assert.ok(billingUtilsJs.includes('fixedFee < 0'));
  });

  it('clamps negative mileageMiles to 0', () => {
    assert.ok(billingUtilsJs.includes('mileageMiles < 0'));
  });

  it('defaults mileageRate to 0.45', () => {
    assert.ok(billingUtilsJs.includes('BILLING_DEFAULTS.mileageRate'));
  });

  it('defaults vatRate to 0.20', () => {
    assert.ok(billingUtilsJs.includes('BILLING_DEFAULTS.vatRate'));
  });

  it('rounds all monetary values to 2 decimal places', () => {
    const matches = billingUtilsJs.match(/\.toFixed\(2\)/g);
    assert.ok(matches.length >= 6, 'Expected at least 6 .toFixed(2) calls');
  });
});

describe('billingUtils — resolveWorkflowBillingTotals', () => {
  it('uses snapshot, live wf-* fields, or defaults (not LAA section-9 time rates)', () => {
    assert.ok(billingUtilsJs.includes('function resolveWorkflowBillingTotals'));
    assert.ok(billingUtilsJs.includes('window._wfBillingSnapshot'));
    assert.ok(billingUtilsJs.includes('LAA notional time rates'));
  });
});

describe('billingUtils — buildQuickFilePayload', () => {
  it('builds line items array with fee, mileage, parking', () => {
    assert.ok(billingUtilsJs.includes('function buildQuickFileLineItems'));
    assert.ok(billingUtilsJs.includes("description: 'Mileage'"));
    assert.ok(billingUtilsJs.includes("description: 'Parking'"));
  });

  it('only adds mileage line when amount > 0', () => {
    assert.ok(billingUtilsJs.includes('totals.mileageAmount > 0'));
  });

  it('only adds parking line when amount > 0', () => {
    assert.ok(billingUtilsJs.includes('totals.parkingAmount > 0'));
  });

  it('payload includes invoiceTitle, issueDate, firmName, totals', () => {
    assert.ok(billingUtilsJs.includes('invoiceTitle:'));
    assert.ok(billingUtilsJs.includes('issueDate:'));
    assert.ok(billingUtilsJs.includes('firmName:'));
    assert.ok(billingUtilsJs.includes('totals:'));
  });
});

describe('billingUtils — status helpers', () => {
  it('defines INVOICE_STATUSES enum', () => {
    assert.ok(billingUtilsJs.includes("DRAFT: 'draft'"));
    assert.ok(billingUtilsJs.includes("INVOICED: 'invoiced'"));
    assert.ok(billingUtilsJs.includes("SENT: 'sent'"));
    assert.ok(billingUtilsJs.includes("ARCHIVED: 'archived'"));
  });

  it('getInvoiceStatusLabel returns human-readable labels', () => {
    assert.ok(billingUtilsJs.includes('function getInvoiceStatusLabel'));
  });

  it('getInvoiceStatusClass returns CSS class names', () => {
    assert.ok(billingUtilsJs.includes('function getInvoiceStatusClass'));
  });
});

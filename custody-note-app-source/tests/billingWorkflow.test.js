/**
 * Billing workflow integration tests.
 *
 * Verifies all wiring between main.js IPC handlers, preload.js API surface,
 * index.html elements, app.js view registration, and renderer JS functions.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
// Schema DDL was extracted from main.js initDb into a versioned migration
// runner (main/dbMigrations.js). Schema-presence assertions scan both so the
// contract is "the column/table is defined somewhere in the schema source".
const dbMigrationsJs = fs.readFileSync(path.join(root, 'main', 'dbMigrations.js'), 'utf8');
const schemaSource = mainJs + '\n' + dbMigrationsJs;
// QuickFile auth + response parsing now lives in this shared, unit-tested module.
const quickfileClientJs = fs.readFileSync(path.join(root, 'lib', 'quickfileClient.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const billingJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');
const mileageJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'station-mileage-admin.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

describe('Database schema — billing columns', () => {
  const expectedColumns = [
    'quickfile_invoice_id', 'quickfile_invoice_number', 'quickfile_invoice_url',
    'invoice_created_at', 'invoice_created_by',
    'invoice_subtotal', 'invoice_vat', 'invoice_total',
    'invoice_narrative', 'invoice_mileage_miles', 'invoice_mileage_rate',
    'invoice_parking_amount', 'invoice_attendance_fee', 'invoice_vat_rate',
  ];
  // After H18 (audit) the schema migration was refactored to go through a
  // single `_safeAddColumn(table, "col ...")` helper so that the only error
  // we swallow is "duplicate column name" (everything else rethrows and logs).
  // The test contract is now "the column is present in a schema migration",
  // regardless of whether it's a literal ALTER TABLE or a _safeAddColumn call.
  function hasColumnMigration(table, col) {
    if (schemaSource.includes(`ALTER TABLE ${table} ADD COLUMN ${col}`)) return true;
    // Column adds go through a helper — either `_safeAddColumn('table', "col ...")`
    // (repair paths in main.js) or the migration runner's `add('table', "col ...")`
    // (main/dbMigrations.js). Column name is always followed by a space + type.
    const re = new RegExp(
      `(?:_safeAddColumn|add)\\(\\s*['"\`]${table}['"\`]\\s*,\\s*['"\`]${col}\\b`,
      'i'
    );
    return re.test(schemaSource);
  }

  expectedColumns.forEach(col => {
    it(`attendances table has schema migration for ${col}`, () => {
      assert.ok(hasColumnMigration('attendances', col),
        `Missing schema migration for ${col} on attendances`);
    });
  });

  it('police_stations has mileage_from_base column', () => {
    assert.ok(hasColumnMigration('police_stations', 'mileage_from_base'));
  });

  it('police_stations has postcode column', () => {
    assert.ok(hasColumnMigration('police_stations', 'postcode'));
  });

  it('billing_audit_log table is created', () => {
    assert.ok(schemaSource.includes('CREATE TABLE IF NOT EXISTS billing_audit_log'));
  });

  it('billing_audit_log has attendance_id index', () => {
    assert.ok(schemaSource.includes('idx_billing_audit_att'));
  });
});

describe('IPC handlers — main.js', () => {
  const expectedHandlers = [
    'preview-pdf-from-html',
    'quickfile-create-invoice',
    'station-mileage-get',
    'stations-mileage-list',
    'station-mileage-save',
    'station-mileage-bulk-save',
    'billing-audit-log-add',
    'billing-audit-log-get',
    'billable-attendances',
    'attendance-invoice-status',
  ];
  expectedHandlers.forEach(handler => {
    it(`ipcMain.handle('${handler}') exists`, () => {
      assert.ok(mainJs.includes(`'${handler}'`),
        `Missing IPC handler: ${handler}`);
    });
  });
});

describe("billable-attendances handler — SQL contract (duplicate-billing guard)", () => {
  /* Regression for the stress-journey FAIL where archived matters re-appeared as
     billable. The handler MUST exclude archived records, otherwise a fee earner
     could raise a duplicate QuickFile invoice for a matter that was already
     billed outside QuickFile (e.g. paper LAA claim) and then archived. */
  function extractBillableHandlerBody() {
    const start = mainJs.indexOf("ipcMain.handle('billable-attendances'");
    assert.ok(start >= 0, "billable-attendances handler not found in main.js");
    const end = mainJs.indexOf('});', start);
    assert.ok(end > start, "could not locate end of billable-attendances handler");
    return mainJs.slice(start, end + 3);
  }

  it('excludes archived records (archived_at IS NULL)', () => {
    const body = extractBillableHandlerBody();
    assert.ok(/archived_at\s+IS\s+NULL/i.test(body),
      "billable-attendances SQL must include 'archived_at IS NULL' to prevent duplicate billing");
  });

  it('excludes deleted records (deleted_at IS NULL)', () => {
    const body = extractBillableHandlerBody();
    assert.ok(/deleted_at\s+IS\s+NULL/i.test(body),
      "billable-attendances SQL must include 'deleted_at IS NULL'");
  });

  it('excludes records that already have a QuickFile invoice', () => {
    const body = extractBillableHandlerBody();
    assert.ok(/quickfile_invoice_id\s+IS\s+NULL/i.test(body),
      "billable-attendances SQL must exclude records with a quickfile_invoice_id");
  });

  it('only surfaces finalised or completed records', () => {
    const body = extractBillableHandlerBody();
    assert.ok(/status\s*=\s*'finalised'/i.test(body), "must include status='finalised'");
    assert.ok(/status\s*=\s*'completed'/i.test(body), "must include status='completed'");
  });
});

describe('QuickFile invoice creation handler', () => {
  it('finds or creates client via quickFileFindOrCreateClient', () => {
    assert.ok(mainJs.includes('quickFileFindOrCreateClient'));
  });

  it('creates invoice with line items for fee, mileage, and parking', () => {
    assert.ok(mainJs.includes('PS Attendance Fixed Fee'));
    assert.ok(mainJs.includes("'Mileage'"));
    assert.ok(mainJs.includes("'Parking'"));
    assert.ok(mainJs.includes('function buildQuickFileItemLine'));
  });

  it('stores invoice result on attendance record', () => {
    assert.ok(mainJs.includes('quickfile_invoice_id = ?'));
    assert.ok(mainJs.includes('quickfile_invoice_number = ?'));
    assert.ok(mainJs.includes('quickfile_invoice_url = ?'));
  });

  it('logs invoice creation in billing_audit_log', () => {
    assert.ok(mainJs.includes("'invoice_created'"));
  });

  it('logs invoice failure in billing_audit_log', () => {
    assert.ok(mainJs.includes("'invoice_failed'"));
  });

  it('returns invoiceId, invoiceNumber, invoiceUrl on success', () => {
    const returnMatch = mainJs.includes('invoiceId: String(invoiceId)');
    assert.ok(returnMatch);
  });
});

describe('Billable attendances query', () => {
  it('filters for finalised records without invoices', () => {
    assert.ok(mainJs.includes("status = 'finalised'"));
    assert.ok(mainJs.includes('quickfile_invoice_id IS NULL'));
  });

  it('excludes deleted records', () => {
    assert.ok(mainJs.includes('deleted_at IS NULL'));
  });
});

describe('Preload API surface', () => {
  const expectedMethods = [
    'previewPdfFromHtml',
    'quickfileCreateInvoice',
    'stationMileageGet',
    'stationsMileageList',
    'stationMileageSave',
    'stationMileageBulkSave',
    'billingAuditLogAdd',
    'billingAuditLogGet',
    'billableAttendances',
    'attendanceInvoiceStatus',
  ];
  expectedMethods.forEach(method => {
    it(`window.api.${method} is exposed`, () => {
      assert.ok(preloadJs.includes(method),
        `Missing preload method: ${method}`);
    });
  });
});

describe('index.html — billing UI elements', () => {
  it('has billing panel button in visible app header (not hidden form-page-header)', () => {
    assert.ok(indexHtml.includes('id="billing-panel-btn"'));
    const headerIdx = indexHtml.indexOf('id="header-form-actions"');
    const btnIdx = indexHtml.indexOf('id="billing-panel-btn"');
    const formHeaderIdx = indexHtml.indexOf('class="form-page-header"');
    assert.ok(headerIdx >= 0 && btnIdx > headerIdx && btnIdx < formHeaderIdx,
      '#billing-panel-btn must sit in app header before the hidden form-page-header');
    const formHeaderEnd = indexHtml.indexOf('id="standalone-back-bar"', formHeaderIdx);
    const formHeaderSlice = indexHtml.slice(formHeaderIdx, formHeaderEnd);
    assert.ok(!formHeaderSlice.includes('id="billing-panel-btn"'),
      '#billing-panel-btn must not remain inside .form-page-header');
  });

  it('has station mileage menu item', () => {
    assert.ok(indexHtml.includes('data-action="station-mileage"'));
  });

  /* v1.4.217: Billable Attendances sub-report was removed.
     v1.5.23: The standalone "Open matters" view (#view-billing /
     billing-view.js) was also removed — per-matter billing now lives on
     #view-matter-billing reached via the bottom-nav "Billing" button. */
  it('does NOT render the deleted Billable Attendances sub-report', () => {
    assert.ok(!/<div\s+id="billable-attendances-section"/.test(indexHtml),
      'deleted #billable-attendances-section reappeared in index.html');
    assert.ok(!/id="billable-search"/.test(indexHtml),
      'deleted #billable-search reappeared');
    assert.ok(!/id="billable-attendances-table-wrap"/.test(indexHtml),
      'deleted #billable-attendances-table-wrap reappeared');
  });

  it('does NOT render the deleted Open matters view (#view-billing)', () => {
    assert.ok(!/id="view-billing"/.test(indexHtml),
      'deleted #view-billing reappeared in index.html');
    assert.ok(!/id="billing-view-summary"/.test(indexHtml),
      'deleted #billing-view-summary reappeared');
    assert.ok(!/id="billing-view-table-wrap"/.test(indexHtml),
      'deleted #billing-view-table-wrap reappeared');
    assert.ok(!/data-nav="billing"/.test(indexHtml),
      'deleted bottom-nav "All open" button (data-nav="billing") reappeared');
  });

  it('has station mileage view', () => {
    assert.ok(indexHtml.includes('id="view-station-mileage"'));
  });

  it('has station mileage back button', () => {
    assert.ok(indexHtml.includes('id="station-mileage-back-btn"'));
  });

  it('has mileage search input', () => {
    assert.ok(indexHtml.includes('id="mileage-search"'));
  });

  it('has mileage save button', () => {
    assert.ok(indexHtml.includes('id="mileage-save-all"'));
  });

  it('has station mileage table wrapper', () => {
    assert.ok(indexHtml.includes('id="station-mileage-table-wrap"'));
  });

  it('includes billing.js script', () => {
    assert.ok(indexHtml.includes('renderer/views/billing.js'));
  });

  it('loads laa-forms.js before billing.js for CRM14 previews', () => {
    const iLaa = indexHtml.indexOf('renderer/laa-forms.js');
    const iBill = indexHtml.indexOf('renderer/views/billing.js');
    assert.ok(iLaa > 0 && iBill > iLaa, 'laa-forms must load before billing.js');
  });

  it('does NOT load the deleted billable-attendances.js script', () => {
    assert.ok(!indexHtml.includes('renderer/views/billable-attendances.js'),
      'billable-attendances.js was deleted in v1.4.217 but is still <script>-loaded');
  });

  it('does NOT load the deleted billing-view.js script', () => {
    assert.ok(!indexHtml.includes('renderer/views/billing-view.js'),
      'billing-view.js was deleted in v1.5.23 but is still <script>-loaded');
  });

  it('includes station-mileage-admin.js script', () => {
    assert.ok(indexHtml.includes('renderer/views/station-mileage-admin.js'));
  });
});

describe('app.js — view wiring', () => {
  it('views map includes station-mileage', () => {
    assert.ok(appJs.includes("'station-mileage': 'view-station-mileage'"));
  });

  it('showView no longer calls deleted loadBillableAttendances', () => {
    assert.ok(!appJs.includes('loadBillableAttendances'),
      'loadBillableAttendances was deleted in v1.4.217; showView must not reference it');
  });

  it('showView no longer calls deleted loadBillingView (Open matters removed in v1.5.23)', () => {
    assert.ok(!appJs.includes('loadBillingView'),
      'loadBillingView was deleted in v1.5.23 along with #view-billing; showView must not reference it');
  });

  it('showView calls loadStationMileage for station-mileage view', () => {
    assert.ok(appJs.includes('loadStationMileage'));
  });

  it('billing panel button opens finish-matter workflow', () => {
    assert.ok(appJs.includes('billing-panel-btn'));
    assert.ok(appJs.includes('executePrimaryRecordAction'));
  });

  it('streamlined billing UX hides §9 duplicate action buttons', () => {
    const fnIdx = appJs.indexOf('function updateFormBarVisibility');
    assert.ok(fnIdx !== -1);
    const block = appJs.substring(fnIdx, fnIdx + 1200);
    assert.ok(block.includes("finaliseBar.style.display = 'none'"), '§9 finalise bar must stay hidden');
    assert.ok(block.includes("endBillingBtn.style.display = 'none'"), '§9 finish button must stay hidden');
    assert.ok(block.includes("postFinaliseBar.style.display = 'none'"), '§9 post-finalise bar must stay hidden');
    assert.ok(block.includes("archiveBtn.style.display = 'none'"), '§9 archive must stay hidden');
  });

  it('header billing button routes archive through executePrimaryRecordAction', () => {
    assert.ok(appJs.includes("executePrimaryRecordAction(action)"));
    assert.ok(appJs.includes("action === 'archive'"));
    assert.ok(appJs.includes('archiveCurrentMatterFromForm'));
  });

  it('readiness panel no longer renders billing-readiness-open button', () => {
    assert.ok(!appJs.includes('id="billing-readiness-open"'));
  });

  it('gear menu handles station-mileage action', () => {
    assert.ok(appJs.includes("case 'station-mileage': showView('station-mileage')"));
  });

  it('back button handles station-mileage-back-btn', () => {
    assert.ok(appJs.includes('station-mileage-back-btn'));
  });
});

describe('billing.js — core functions', () => {
  it('exports openBillingPanel function', () => {
    assert.ok(billingJs.includes('function openBillingPanel'));
  });

  it('exports closeBillingPanel function', () => {
    assert.ok(billingJs.includes('function closeBillingPanel'));
  });

  it('builds invoice narrative with client - station format', () => {
    assert.ok(billingJs.includes("filter(Boolean).join(' - ')"));
  });

  it('has document preview and attendance HTML for invoice attach', () => {
    assert.ok(billingJs.includes('function _previewDocument'));
    assert.ok(billingJs.includes('attachAttendanceHtml'));
  });

  it('has review confirmation checklist (3 checkboxes)', () => {
    assert.ok(billingJs.includes('billing-check-attendance'));
    assert.ok(billingJs.includes('billing-check-docs'));
    assert.ok(billingJs.includes('billing-check-billing'));
  });

  it('invoice button is disabled until all checkboxes are checked', () => {
    assert.ok(billingJs.includes('createBtn.disabled = !allChecked'));
  });

  it('has duplicate invoice protection', () => {
    assert.ok(billingJs.includes('already has an invoice'));
  });

  it('has live billing recalculation', () => {
    assert.ok(billingJs.includes('function _recalcBillingTotals'));
  });

  it('creates QuickFile invoice with correct parameters (incl. attendance HTML for PDF attach)', () => {
    assert.ok(billingJs.includes('quickfileCreateInvoice'));
    assert.ok(billingJs.includes('billingInvoiceNumber'));
    assert.ok(billingJs.includes('attachAttendanceHtml'));
  });

  it('shows billing summary (firm, client, station, date, offence) without internal billing invoice ref', () => {
    assert.ok(billingJs.includes('Billing &amp; documents') || billingJs.includes('Billing & documents'));
    assert.ok(billingJs.includes('firmName'));
    assert.ok(billingJs.includes('clientName'));
    assert.ok(billingJs.includes('stationName'));
    assert.ok(billingJs.includes('attendanceDate'));
    // v1.5.6: the internal "Billing invoice no. (auto)" line was removed from the panel
    assert.ok(!billingJs.includes('billing-invoice-ref-display'),
      'v1.5.6: billing-invoice-ref-display element must not appear in the billing panel');
    assert.ok(!billingJs.includes('Billing invoice no.'),
      'v1.5.6: "Billing invoice no." label must not appear in the billing panel');
  });

  it('has QuickFile status display', () => {
    assert.ok(billingJs.includes('QuickFile Status'));
    assert.ok(billingJs.includes('billing-status-invoiced'));
    assert.ok(billingJs.includes('billing-status-not-invoiced'));
  });

  it('logs billing actions to audit log', () => {
    assert.ok(billingJs.includes('billingAuditLogAdd'));
  });

  it('displays audit log history', () => {
    assert.ok(billingJs.includes('Billing History'));
  });

  it('auto-populates mileage from station database', () => {
    assert.ok(billingJs.includes('stationMileageGet'));
  });

  it('shows generated documents list', () => {
    assert.ok(billingJs.includes('function _getGeneratedDocuments'));
    assert.ok(billingJs.includes('Attendance Note PDF'));
    assert.ok(billingJs.includes('Applicant Declaration'));
  });

  it('shows LAA attach checklist for official forms', () => {
    assert.ok(billingJs.includes('function _getLaaAttachFormsList'));
    assert.ok(billingJs.includes('LAA forms on file'));
    assert.ok(billingJs.includes('CRM15'));
  });
});

describe('Deleted Open-matters view (#view-billing / billing-view.js) — v1.5.23 regression', () => {
  /* v1.4.217: billable-attendances.js was deleted because its data and filters
     fully duplicated billing-view.js.
     v1.5.23: billing-view.js itself was deleted, alongside the standalone
     #view-billing "Open matters" practice-wide list. Per-matter billing now
     lives on the bottom-nav "Billing" button which routes to
     #view-matter-billing for the current record. The billableAttendances
     IPC handler remains as a fallback and is still SQL-contract tested. */

  it('billable-attendances.js stays gone from renderer/views', () => {
    const deletedPath = path.join(root, 'renderer', 'views', 'billable-attendances.js');
    assert.ok(!fs.existsSync(deletedPath),
      'renderer/views/billable-attendances.js was deleted in v1.4.217 but still exists');
  });

  it('billing-view.js is gone from renderer/views', () => {
    const deletedPath = path.join(root, 'renderer', 'views', 'billing-view.js');
    assert.ok(!fs.existsSync(deletedPath),
      'renderer/views/billing-view.js was deleted in v1.5.23 but still exists');
  });

  it('billableAttendances IPC handler is retained (used as fallback + by SQL contract tests)', () => {
    assert.ok(mainJs.includes("'billable-attendances'"),
      'billable-attendances IPC handler must remain even though the report UI was removed');
    assert.ok(preloadJs.includes('billableAttendances'),
      'preload billableAttendances API must remain');
  });
});

describe('station-mileage-admin.js — admin functions', () => {
  it('exports loadStationMileage function', () => {
    assert.ok(mileageJs.includes('function loadStationMileage'));
  });

  it('has search filtering', () => {
    assert.ok(mileageJs.includes('mileage-search'));
  });

  it('has save all changes functionality', () => {
    assert.ok(mileageJs.includes('function _saveAllMileage'));
  });

  it('tracks dirty (modified) rows', () => {
    assert.ok(mileageJs.includes('_mileageDirty'));
  });

  it('uses bulk save API', () => {
    assert.ok(mileageJs.includes('stationMileageBulkSave'));
  });

  it('renders editable mileage and postcode inputs', () => {
    assert.ok(mileageJs.includes('data-field="mileage"'));
    assert.ok(mileageJs.includes('data-field="postcode"'));
  });
});

describe('styles.css — billing styles', () => {
  it('has billing overlay styles', () => {
    assert.ok(stylesCss.includes('.billing-overlay'));
  });

  it('has billing panel styles', () => {
    assert.ok(stylesCss.includes('.billing-panel'));
  });

  it('has billing totals styles', () => {
    assert.ok(stylesCss.includes('.billing-totals'));
  });

  it('has billing status badge styles', () => {
    assert.ok(stylesCss.includes('.billing-status-invoiced'));
    assert.ok(stylesCss.includes('.billing-status-not-invoiced'));
  });

  it('has billing checklist styles', () => {
    assert.ok(stylesCss.includes('.billing-checklist'));
  });

  it('has billable table styles', () => {
    assert.ok(stylesCss.includes('.billable-table'));
  });

  it('has responsive breakpoints for billing', () => {
    assert.ok(stylesCss.includes('.billing-detail-grid'));
  });

  it('has billing audit log styles', () => {
    assert.ok(stylesCss.includes('.billing-audit-entry'));
  });

  it('has billing flow panel styles', () => {
    assert.ok(stylesCss.includes('.billing-panel--flow'));
  });
});

describe('Security — API keys server-side only', () => {
  it('QuickFile auth is computed in main.js only', () => {
    assert.ok(mainJs.includes('getQuickFileAuth'));
    assert.ok(!preloadJs.includes('getQuickFileAuth'));
    assert.ok(!billingJs.includes('getQuickFileAuth'));
    assert.ok(!appJs.includes('getQuickFileAuth'));
  });

  it('API key is not exposed in preload', () => {
    assert.ok(!preloadJs.includes('quickfileApiKey'));
    assert.ok(!preloadJs.includes('quickfileAppId'));
  });

  it('MD5 hashing only happens server-side', () => {
    assert.ok(mainJs.includes('md5Value'));
    assert.ok(!billingJs.includes('md5'));
  });
});

describe('Billing narrative generation', () => {
  it('uses correct format: Client - Station – Date – Offence', () => {
    assert.ok(billingJs.includes("_buildInvoiceNarrative"));
    assert.ok(billingJs.includes("filter(Boolean).join(' - ')"));
  });

  it('narrative is editable via textarea', () => {
    assert.ok(billingJs.includes('billing-narrative'));
    assert.ok(billingJs.includes('textarea'));
  });

  it('date is formatted as DD.MM.YY', () => {
    assert.ok(billingJs.includes("parts[2] + '.' + parts[1] + '.' + parts[0].slice(2)"));
  });
});

describe('Billing panel (no firm email pack)', () => {
  it('does not embed inline billing PDF iframe / print preview toolbar', () => {
    assert.ok(!billingJs.includes('billing-print-preview-open'));
    assert.ok(!billingJs.includes('billing-preview-iframe'));
  });

  it('does not include Prepare Email to Firm flow', () => {
    assert.ok(!billingJs.includes('_openEmailPackModal'));
    assert.ok(!billingJs.includes('billing-email-pack'));
    assert.ok(!billingJs.includes('email_prepared'));
  });
});

describe('QuickFile client search — required fields', () => {
  it('all quickFileRequest client/search calls include OrderResultsBy and OrderDirection', () => {
    const re = /quickFileRequest\s*\(\s*'\/1_2\/client\/search'\s*,\s*\{[\s\S]*?\}\s*\)/g;
    const matches = mainJs.match(re) || [];
    assert.ok(matches.length >= 2, 'Expected at least 2 client/search calls, found ' + matches.length);
    for (let i = 0; i < matches.length; i++) {
      assert.ok(matches[i].includes('OrderResultsBy'), 'client/search call ' + i + ' missing OrderResultsBy');
      assert.ok(matches[i].includes('OrderDirection'), 'client/search call ' + i + ' missing OrderDirection');
    }
  });
});

describe('Invoice success confirmation modal', () => {
  it('has _showInvoiceSuccessModal function', () => {
    assert.ok(billingJs.includes('function _showInvoiceSuccessModal'));
  });

  it('success modal has View Invoice, Create Another, and Close buttons', () => {
    assert.ok(billingJs.includes('billing-success-view'));
    assert.ok(billingJs.includes('billing-success-another'));
    assert.ok(billingJs.includes('billing-success-close'));
  });

  it('success modal supports Escape to dismiss', () => {
    assert.ok(billingJs.includes("e.key === 'Escape'") || billingJs.includes('e.key === "Escape"'));
  });

  it('removes existing success overlay before showing new one', () => {
    assert.ok(billingJs.includes("getElementById('billing-success-overlay')"));
  });

  it('has double-submit guard on invoice creation', () => {
    assert.ok(billingJs.includes('_invoiceInFlight'));
  });

  it('displays structured attachment error with detail styling', () => {
    assert.ok(billingJs.includes('billing-attach-error'), 'Must have error label class');
    assert.ok(billingJs.includes('billing-attach-error-detail'), 'Must have error detail class');
  });

  it('truncates long attachment errors to 120 chars in modal', () => {
    assert.ok(billingJs.includes('.slice(0, 120)'), 'Must truncate long error messages');
  });

  it('shows full error in title attribute for hover', () => {
    assert.ok(billingJs.includes('title="'), 'Must use title attribute for full error on hover');
  });
});

describe('QuickFile input validation', () => {
  it('validates params object before processing', () => {
    assert.ok(mainJs.includes("'Invalid invoice parameters'"));
  });

  it('validates firmName is required', () => {
    assert.ok(mainJs.includes("'Firm name is required"));
  });

  it('uses Number.isFinite for VAT rate normalization', () => {
    assert.ok(mainJs.includes('Number.isFinite(Number(vatRate))'));
  });

  it('guards empty PDF buffer in attachment upload', () => {
    assert.ok(mainJs.includes('PDF buffer is empty'));
  });

  it('guards oversized PDF in attachment upload', () => {
    assert.ok(mainJs.includes('Attachment too large'));
  });

  it('wraps SalesAttachment inside Type element for Document_Upload', () => {
    const fnMatch = mainJs.match(/function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    assert.ok(fnMatch, 'quickFileUploadSalesAttachment function should exist');
    const fnBody = fnMatch[0];
    assert.ok(fnBody.includes('Type: {'), 'DocumentDetails must contain a Type wrapper');
    assert.ok(fnBody.includes('SalesAttachment: {'), 'Type must contain SalesAttachment');
    const typeIdx = fnBody.indexOf('Type: {');
    const salesIdx = fnBody.indexOf('SalesAttachment: {');
    assert.ok(salesIdx > typeIdx, 'SalesAttachment must be nested inside Type');
  });

  it('checks HTTP status in QuickFile response handler', () => {
    assert.ok(quickfileClientJs.includes('QuickFile HTTP'));
  });

  it('handles empty QuickFile response', () => {
    assert.ok(quickfileClientJs.includes('QuickFile returned empty response'));
  });
});

describe('QuickFile invoice payload schema compliance', () => {
  it('nests SingleInvoiceData inside InvoiceData.Scheduling (not as Body sibling)', () => {
    assert.ok(mainJs.includes('Scheduling: {'));
    assert.ok(mainJs.includes('SingleInvoiceData: singleInvoiceData'));
    const bodyMatch = mainJs.match(/quickFileRequest\s*\(\s*'\/1_2\/invoice\/create'\s*,\s*(\w+)\)/);
    assert.ok(bodyMatch, 'invoice/create call should use a named payload variable');
  });

  it('includes Language field inside InvoiceData', () => {
    const createIdx = mainJs.indexOf("'/1_2/invoice/create'");
    const block = mainJs.slice(Math.max(0, createIdx - 600), createIdx + 100);
    assert.ok(block.includes("Language: 'en'"), 'InvoiceData should include Language');
  });

  it('calls validateQuickFileInvoicePayload before invoice/create request', () => {
    const createIdx = mainJs.indexOf("quickFileRequest('/1_2/invoice/create'");
    const validateIdx = mainJs.indexOf('validateQuickFileInvoicePayload(invoicePayload)');
    assert.ok(validateIdx > 0, 'validateQuickFileInvoicePayload call should exist');
    assert.ok(validateIdx < createIdx, 'validateQuickFileInvoicePayload must be called before quickFileRequest');
  });

  it('passes trimmed firmName to quickFileFindOrCreateClient', () => {
    assert.ok(mainJs.includes('quickFileFindOrCreateClient(firmName.trim()'));
  });
});

describe('buildQuickFileItemLine field types', () => {
  it('returns Qty as a number, not a string', () => {
    const fnMatch = mainJs.match(/function buildQuickFileItemLine[\s\S]*?^}/m);
    assert.ok(fnMatch, 'buildQuickFileItemLine function should exist');
    const fnBody = fnMatch[0];
    assert.ok(!fnBody.includes('Qty: String('), 'Qty should not be wrapped in String()');
    assert.ok(fnBody.includes('Qty: q'), 'Qty should be the raw numeric value');
  });

  it('uses ItemID: 0 for one-off items', () => {
    assert.ok(mainJs.includes('ItemID: 0'));
  });

  it('uses ItemNominalCode 4000 as default', () => {
    assert.ok(mainJs.includes("ItemNominalCode: '4000'"));
  });

  it('enforces max 25 chars on ItemName', () => {
    assert.ok(mainJs.includes(".slice(0, 25)"));
  });

  it('enforces max 5000 chars on ItemDescription', () => {
    assert.ok(mainJs.includes(".slice(0, 5000)"));
  });

  it('includes Tax1 with TaxName, TaxPercentage, and TaxAmount', () => {
    const fnMatch = mainJs.match(/function buildQuickFileItemLine[\s\S]*?^}/m);
    const fnBody = fnMatch[0];
    assert.ok(fnBody.includes("TaxName: 'VAT'"));
    assert.ok(fnBody.includes('TaxPercentage:'));
    assert.ok(fnBody.includes('TaxAmount:'));
  });
});

describe('validateQuickFileInvoicePayload — preflight checks', () => {
  it('function exists in main.js', () => {
    assert.ok(mainJs.includes('function validateQuickFileInvoicePayload'));
  });

  it('validates InvoiceData presence', () => {
    assert.ok(mainJs.includes("Preflight: missing InvoiceData"));
  });

  it('validates InvoiceType enum', () => {
    assert.ok(mainJs.includes("Preflight: InvoiceType must be"));
  });

  it('validates ClientID is a positive integer', () => {
    assert.ok(mainJs.includes("Preflight: ClientID must be a positive integer"));
  });

  it('validates Currency is 3-char ISO', () => {
    assert.ok(mainJs.includes("Preflight: Currency must be a 3-char ISO code"));
  });

  it('validates at least one ItemLine', () => {
    assert.ok(mainJs.includes("Preflight: at least one ItemLine required"));
  });

  it('validates ItemNominalCode length 2-5', () => {
    assert.ok(mainJs.includes("ItemNominalCode must be 2-5 chars"));
  });

  it('validates UnitCost > 0', () => {
    assert.ok(mainJs.includes("UnitCost must be > 0"));
  });

  it('validates Qty > 0', () => {
    assert.ok(mainJs.includes("Qty must be > 0"));
  });

  it('validates Scheduling presence', () => {
    assert.ok(mainJs.includes("Preflight: missing Scheduling inside InvoiceData"));
  });

  it('validates IssueDate format YYYY-MM-DD', () => {
    assert.ok(mainJs.includes("Preflight: IssueDate must be YYYY-MM-DD"));
  });

  it('validates ClientAddress.CountryISO when ClientAddress present', () => {
    assert.ok(mainJs.includes("Preflight: ClientAddress requires a 2-char CountryISO"));
  });

  it('validates InvoiceDescription length 2-35 when present', () => {
    assert.ok(mainJs.includes("Preflight: InvoiceDescription must be 2-35 chars"));
  });

  it('validates ItemName max 25 chars', () => {
    assert.ok(mainJs.includes("ItemName max 25 chars"));
  });
});

describe('QuickFile auth generation', () => {
  it('generates unique SubmissionNumber per call', () => {
    assert.ok(quickfileClientJs.includes("'cn-' + Date.now()"));
    assert.ok(quickfileClientJs.includes("Math.random().toString(36)"));
  });

  it('constructs MD5 from accountNumber + apiKey + submissionNumber', () => {
    assert.ok(quickfileClientJs.includes('accountNumber + apiKey + submissionNumber'));
    assert.ok(quickfileClientJs.includes("createHash('md5')"));
  });

  it('includes ApplicationID in auth header', () => {
    assert.ok(mainJs.includes("ApplicationID: auth.applicationId"));
  });
});

describe('QuickFile error parsing — structured errors before HTTP status', () => {
  it('parses JSON before checking HTTP status code', () => {
    const jsonParseIdx = quickfileClientJs.indexOf('JSON.parse');
    const httpCheckIdx = quickfileClientJs.indexOf('statusCode < 200');
    assert.ok(jsonParseIdx > 0, 'JSON.parse should exist in the quickfile client');
    assert.ok(httpCheckIdx > 0, 'HTTP status check should exist in the quickfile client');
    assert.ok(jsonParseIdx < httpCheckIdx, 'JSON parsing must happen before HTTP status rejection');
  });

  it('extracts Errors.Error array from QuickFile responses', () => {
    assert.ok(quickfileClientJs.includes('json.Errors.Error || json.Errors'));
  });

  it('handles Header.Status === Error responses', () => {
    assert.ok(quickfileClientJs.includes("header.Status === 'Error'"));
  });
});

describe('Document_Upload payload structure — runtime validation', () => {
  function buildUploadPayload(invoiceId, fileName, pdfBuffer, notes) {
    const invId = parseInt(String(invoiceId), 10);
    if (!Number.isFinite(invId)) throw new Error('Invalid InvoiceId');
    if (!pdfBuffer || !pdfBuffer.length) throw new Error('PDF buffer is empty');
    const MAX = 10 * 1024 * 1024;
    if (pdfBuffer.length > MAX) throw new Error('Too large');
    const safeName = String(fileName || 'attendance-note.pdf').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
    const fn = safeName.length >= 5 ? safeName.slice(0, 150) : 'note.pdf';
    const b64 = Buffer.from(pdfBuffer).toString('base64');
    return {
      DocumentDetails: {
        FileName: fn,
        EmbeddedFileBinaryObject: b64,
        Type: {
          SalesAttachment: {
            InvoiceId: invId,
            Notes: String(notes || 'Attendance note PDF').slice(0, 600),
          },
        },
      },
    };
  }

  it('nests SalesAttachment inside Type at object level (not as DocumentDetails sibling)', () => {
    const payload = buildUploadPayload(12345, 'test.pdf', Buffer.from('test'), 'note');
    assert.ok(payload.DocumentDetails, 'DocumentDetails must exist');
    assert.ok(payload.DocumentDetails.Type, 'Type wrapper must exist inside DocumentDetails');
    assert.ok(payload.DocumentDetails.Type.SalesAttachment, 'SalesAttachment must exist inside Type');
    assert.strictEqual(payload.DocumentDetails.SalesAttachment, undefined, 'SalesAttachment must NOT be a direct child of DocumentDetails');
  });

  it('schema contract: all required fields present with correct types', () => {
    const buf = Buffer.from('dummy pdf content');
    const payload = buildUploadPayload(99999, 'attendance.pdf', buf, 'My notes');
    const doc = payload.DocumentDetails;
    assert.strictEqual(typeof doc.FileName, 'string');
    assert.ok(doc.FileName.length > 0, 'FileName must be non-empty');
    assert.strictEqual(typeof doc.EmbeddedFileBinaryObject, 'string');
    assert.ok(doc.EmbeddedFileBinaryObject.length > 0, 'Base64 content must be non-empty');
    const sa = doc.Type.SalesAttachment;
    assert.strictEqual(typeof sa.InvoiceId, 'number');
    assert.ok(sa.InvoiceId > 0, 'InvoiceId must be positive');
    assert.strictEqual(typeof sa.Notes, 'string');
  });

  it('EmbeddedFileBinaryObject is valid base64 that round-trips', () => {
    const original = Buffer.from('some binary pdf data \x00\xff\xfe');
    const payload = buildUploadPayload(1, 'file.pdf', original, '');
    const b64 = payload.DocumentDetails.EmbeddedFileBinaryObject;
    assert.ok(/^[A-Za-z0-9+/]+=*$/.test(b64), 'Must be valid base64 characters');
    const decoded = Buffer.from(b64, 'base64');
    assert.ok(decoded.equals(original), 'Round-trip base64 must match original buffer');
  });

  it('payload construction in source matches expected structure', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    assert.ok(fnMatch, 'Function must exist in source');
    const body = fnMatch[0];
    assert.ok(body.includes('DocumentDetails: {'), 'Source has DocumentDetails');
    assert.ok(body.includes('FileName: fn'), 'Source assigns FileName');
    assert.ok(body.includes('EmbeddedFileBinaryObject: b64'), 'Source assigns base64');
    assert.ok(body.includes('Type: {'), 'Source has Type wrapper');
    assert.ok(body.includes('SalesAttachment: {'), 'Source has SalesAttachment');
    assert.ok(body.includes('InvoiceId: invId'), 'Source assigns InvoiceId');
  });

  it('rejects non-finite invoiceId', () => {
    assert.throws(() => buildUploadPayload('abc', 'f.pdf', Buffer.from('x'), ''), /Invalid InvoiceId/);
    assert.throws(() => buildUploadPayload(NaN, 'f.pdf', Buffer.from('x'), ''), /Invalid InvoiceId/);
  });

  it('rejects empty PDF buffer', () => {
    assert.throws(() => buildUploadPayload(1, 'f.pdf', Buffer.alloc(0), ''), /PDF buffer is empty/);
    assert.throws(() => buildUploadPayload(1, 'f.pdf', null, ''), /PDF buffer is empty/);
  });

  it('rejects oversized PDF buffer', () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    assert.throws(() => buildUploadPayload(1, 'f.pdf', big, ''), /Too large/);
  });

  it('Notes field is truncated to 600 characters', () => {
    const longNotes = 'x'.repeat(800);
    const payload = buildUploadPayload(1, 'f.pdf', Buffer.from('data'), longNotes);
    assert.strictEqual(payload.DocumentDetails.Type.SalesAttachment.Notes.length, 600);
  });
});

describe('Attachment flow — trigger conditions and partial success', () => {
  it('attachment block requires both invoiceId AND attachAttendanceHtml', () => {
    const handlerMatch = mainJs.match(/ipcMain\.handle\('quickfile-create-invoice'[\s\S]*?^\}\);/m);
    assert.ok(handlerMatch, 'create-invoice handler must exist');
    const handler = handlerMatch[0];
    assert.ok(handler.includes('invoiceId && attachAttendanceHtml'), 'Must gate on both invoiceId and attachAttendanceHtml');
  });

  it('returns ok: true with attachmentOk and attachmentError fields on success path', () => {
    const handlerMatch = mainJs.match(/ipcMain\.handle\('quickfile-create-invoice'[\s\S]*?^\}\);/m);
    const handler = handlerMatch[0];
    const returnMatch = handler.match(/return\s*\{[\s\S]*?ok:\s*true[\s\S]*?\};/);
    assert.ok(returnMatch, 'Success return block must exist');
    assert.ok(returnMatch[0].includes('attachmentOk'), 'Success return includes attachmentOk');
    assert.ok(returnMatch[0].includes('attachmentError'), 'Success return includes attachmentError');
  });

  it('attachment failure is caught independently and does not prevent invoice success', () => {
    const handlerMatch = mainJs.match(/ipcMain\.handle\('quickfile-create-invoice'[\s\S]*?^\}\);/m);
    const handler = handlerMatch[0];
    const attachIdx = handler.indexOf('invoiceId && attachAttendanceHtml');
    const attachBlock = handler.slice(attachIdx);
    assert.ok(attachBlock.includes('try {'), 'Attachment block has its own try');
    assert.ok(attachBlock.includes('catch (attErr)'), 'Attachment block has dedicated catch');
  });

  it('logs invoice_attachment_failed to billing_audit_log on attachment error', () => {
    const handlerMatch = mainJs.match(/ipcMain\.handle\('quickfile-create-invoice'[\s\S]*?^\}\);/m);
    const handler = handlerMatch[0];
    assert.ok(handler.includes("'invoice_attachment_failed'"), 'Must log attachment failure');
  });

  it('logs invoice_attachment_uploaded on attachment success', () => {
    const handlerMatch = mainJs.match(/ipcMain\.handle\('quickfile-create-invoice'[\s\S]*?^\}\);/m);
    const handler = handlerMatch[0];
    assert.ok(handler.includes("'invoice_attachment_uploaded'"), 'Must log attachment success');
  });
});

describe('Filename sanitization in quickFileUploadSalesAttachment', () => {
  function sanitize(fileName) {
    const safeName = String(fileName || 'attendance-note.pdf').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
    return safeName.length >= 5 ? safeName.slice(0, 150) : 'note.pdf';
  }

  it('strips dangerous characters: < > : " / \\ | ? *', () => {
    assert.strictEqual(sanitize('test<>:file.pdf'), 'test___file.pdf');
    assert.strictEqual(sanitize('a"b/c\\d|e.pdf'), 'a_b_c_d_e.pdf');
    assert.strictEqual(sanitize('f?i*le.pdf'), 'f_i_le.pdf');
  });

  it('strips control characters (0x00-0x1f)', () => {
    assert.strictEqual(sanitize('file\x00\x01name.pdf'), 'file__name.pdf');
  });

  it('defaults to attendance-note.pdf when no filename given', () => {
    assert.strictEqual(sanitize(null), 'attendance-note.pdf');
    assert.strictEqual(sanitize(''), 'attendance-note.pdf');
    assert.strictEqual(sanitize(undefined), 'attendance-note.pdf');
  });

  it('falls back to note.pdf when sanitized name is shorter than 5 chars', () => {
    assert.strictEqual(sanitize('a'), 'note.pdf');
    assert.strictEqual(sanitize('ab'), 'note.pdf');
    assert.strictEqual(sanitize('???'), 'note.pdf');
    assert.strictEqual(sanitize('????'), 'note.pdf');
  });

  it('truncates filenames longer than 150 chars', () => {
    const longName = 'a'.repeat(200) + '.pdf';
    const result = sanitize(longName);
    assert.ok(result.length <= 150, 'Filename must be max 150 chars, got ' + result.length);
  });

  it('sanitization logic in source matches test implementation', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    const body = fnMatch[0];
    assert.ok(body.includes('.slice(0, 150)'), 'Source truncates at 150 chars');
    assert.ok(body.includes("'note.pdf'"), 'Source has note.pdf fallback');
    assert.ok(body.includes("'attendance-note.pdf'"), 'Source has default filename');
  });
});

describe('validateDocumentUploadPayload — preflight checks', () => {
  it('function exists in main.js', () => {
    assert.ok(mainJs.includes('function validateDocumentUploadPayload'));
  });

  it('validates DocumentDetails presence', () => {
    assert.ok(mainJs.includes('Preflight: missing DocumentDetails'));
  });

  it('validates FileName is required', () => {
    assert.ok(mainJs.includes('Preflight: FileName is required'));
  });

  it('validates EmbeddedFileBinaryObject is required', () => {
    assert.ok(mainJs.includes('Preflight: EmbeddedFileBinaryObject is required'));
  });

  it('validates Type wrapper is required', () => {
    assert.ok(mainJs.includes('Preflight: DocumentDetails.Type wrapper is required'));
  });

  it('validates SalesAttachment is required inside Type', () => {
    assert.ok(mainJs.includes('Preflight: Type.SalesAttachment is required'));
  });

  it('validates InvoiceId is a positive integer', () => {
    assert.ok(mainJs.includes('Preflight: SalesAttachment.InvoiceId must be a positive integer'));
  });

  it('is called before quickFileRequest in quickFileUploadSalesAttachment', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    assert.ok(fnMatch, 'Function must exist');
    const body = fnMatch[0];
    const validateIdx = body.indexOf('validateDocumentUploadPayload(');
    const requestIdx = body.indexOf("quickFileRequest('/1_2/document/upload'");
    assert.ok(validateIdx > 0, 'validateDocumentUploadPayload call must exist');
    assert.ok(requestIdx > 0, 'quickFileRequest call must exist');
    assert.ok(validateIdx < requestIdx, 'Validation must happen before the API request');
  });
});

describe('Scheduling nesting regression', () => {
  it('invoice/create payload wraps SingleInvoiceData inside Scheduling', () => {
    const idx = mainJs.indexOf("quickFileRequest('/1_2/invoice/create'");
    assert.ok(idx > 0);
    const before = mainJs.slice(Math.max(0, idx - 400), idx);
    assert.ok(before.includes('Scheduling: {'), 'Scheduling wrapper must exist before invoice/create call');
    assert.ok(before.includes('SingleInvoiceData:'), 'SingleInvoiceData must be inside Scheduling');
    assert.ok(!before.match(/\}\s*,\s*SingleInvoiceData:/), 'SingleInvoiceData must not be a sibling of InvoiceData');
  });
});

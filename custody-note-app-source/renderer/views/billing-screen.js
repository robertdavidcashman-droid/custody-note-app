/* ═══════════════════════════════════════════════════════
   BILLING SCREEN (Workflow Step 2)
   Invoice details, charges, QuickFile preview, document
   selection for attachment, and invoice generation.
   Rendered inside #wf-body by workflow-stepper.js.
   Depends on: filenameUtils.js, billingUtils.js, workflow-stepper.js,
               billing.js (_handleCreateInvoice, _previewDocument),
               documents-screen.js (_wfGeneratedDocs),
               app.js globals
   ═══════════════════════════════════════════════════════ */

var _wfBillingOpts = null;
var _wfSelectedDocs = {};

function _wfRenderBillingStep(body, footer) {
  var meta = _wfMatterMeta();
  var data = meta.data;
  var recordId = meta.recordId;
  var stationId = data.policeStationId || '';

  var billingSettings = (window._billingDefaults || {});
  var fee = billingSettings.attendanceFee || BILLING_DEFAULTS.fixedFee;
  var mileageRate = billingSettings.mileageRate || BILLING_DEFAULTS.mileageRate;
  var vatRate = billingSettings.vatRate || BILLING_DEFAULTS.vatRate;
  if (typeof vatRate === 'number' && vatRate > 1) vatRate = vatRate / 100;
  var parking = parseFloat(data.parkingCost) || 0;
  var miles = parseFloat(data.milesClaimable) || 0;

  body.innerHTML = '<div class="wf-loading">Loading billing data&hellip;</div>';
  footer.innerHTML = '';

  var loadJobs = [
    stationId && window.api && window.api.stationMileageGet ? window.api.stationMileageGet(stationId) : Promise.resolve(null),
    recordId && window.api && window.api.attendanceInvoiceStatus ? window.api.attendanceInvoiceStatus(recordId) : Promise.resolve({}),
    recordId && window.api && window.api.billingAuditLogGet ? window.api.billingAuditLogGet(recordId) : Promise.resolve([]),
    window.api && window.api.getSettings ? window.api.getSettings() : Promise.resolve({}),
    window.api && window.api.quickfileConnectionState ? window.api.quickfileConnectionState() : Promise.resolve(null),
  ];

  Promise.allSettled(loadJobs).then(function (settled) {
    function val(i, fallback) {
      var r = settled[i];
      return (r && r.status === 'fulfilled') ? r.value : fallback;
    }
    meta = _wfMatterMeta();
    data = meta.data;
    var stationMileage = val(0, null);
    var invoiceStatus = val(1, {}) || {};
    var auditLog = val(2, []) || [];
    var dbSettings = val(3, {}) || {};
    var qfConnection = val(4, null);
    _wfHydrateQuickFileSettingsCache(dbSettings);
    var qfConfigured = _wfIsQuickFileConfigured(dbSettings, qfConnection);
    var hasExisting = !!(invoiceStatus.quickfile_invoice_id);

    if (stationMileage && stationMileage.mileage_from_base != null && !miles) {
      miles = stationMileage.mileage_from_base;
    }
    if (hasExisting && invoiceStatus.invoice_attendance_fee != null) fee = invoiceStatus.invoice_attendance_fee;
    if (hasExisting && invoiceStatus.invoice_mileage_miles != null) miles = invoiceStatus.invoice_mileage_miles;
    if (hasExisting && invoiceStatus.invoice_mileage_rate != null) mileageRate = invoiceStatus.invoice_mileage_rate;
    if (hasExisting && invoiceStatus.invoice_parking_amount != null) parking = invoiceStatus.invoice_parking_amount;
    if (hasExisting && invoiceStatus.invoice_vat_rate != null) {
      vatRate = invoiceStatus.invoice_vat_rate;
      if (typeof vatRate === 'number' && vatRate > 1) vatRate = vatRate / 100;
    }

    var invoiceTitle = formatInvoiceTitle(meta.clientName, meta.stationName);
    var narrative = (hasExisting && invoiceStatus.invoice_narrative)
      ? invoiceStatus.invoice_narrative
      : _buildInvoiceNarrative(meta.clientName, meta.stationName, meta.attendanceDate, meta.offenceSummary);

    _wfBillingOpts = {
      clientName: meta.clientName,
      firmName: meta.firmName,
      stationName: meta.stationName,
      attendanceDate: meta.attendanceDate,
      offenceSummary: meta.offenceSummary,
      attendanceFee: fee,
      mileageMiles: miles,
      mileageRate: mileageRate,
      parkingAmount: parking,
      vatRate: vatRate,
      narrative: narrative,
      invoiceTitle: invoiceTitle,
      invoiceStatus: invoiceStatus,
      hasExistingInvoice: hasExisting,
      auditLog: auditLog,
      qfConfigured: qfConfigured,
      qfConnection: qfConnection,
    };

    _wfRenderBillingBody(body, footer, meta, _wfBillingOpts);
  });
}

/** Keep renderer cache + hidden Settings inputs in sync with the SQLite DB. */
function _wfHydrateQuickFileSettingsCache(settings) {
  if (!settings || typeof settings !== 'object') return;
  window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, settings);
  var pairs = [
    ['setting-quickfile-account', 'quickfileAccountNumber'],
    ['setting-quickfile-apikey', 'quickfileApiKey'],
    ['setting-quickfile-appid', 'quickfileAppId'],
  ];
  pairs.forEach(function (pair) {
    var el = document.getElementById(pair[0]);
    if (el && !String(el.value || '').trim()) el.value = settings[pair[1]] || '';
  });
}

/** Authoritative QuickFile configured check: DB-backed IPC first, then cache fallback. */
function _wfIsQuickFileConfigured(dbSettings, qfConnection) {
  if (qfConnection && Array.isArray(qfConnection.missing)) {
    return qfConnection.missing.length === 0;
  }
  var s = dbSettings || window._appSettingsCache || {};
  return !!(String(s.quickfileAccountNumber || '').trim()
    && String(s.quickfileApiKey || '').trim()
    && String(s.quickfileAppId || '').trim());
}

function _wfRenderBillingBody(body, footer, meta, opts) {
  var totals = calculateInvoiceTotals({
    fixedFee: opts.attendanceFee, mileageMiles: opts.mileageMiles,
    mileageRate: opts.mileageRate, parkingAmount: opts.parkingAmount,
    vatRate: opts.vatRate,
  });

  var line1Desc = buildLine1Description({
    clientName: meta.clientName, policeStation: meta.stationName,
    attendanceDate: meta.attendanceDate,
  });

  var statusBadge = '';
  if (opts.hasExistingInvoice) {
    statusBadge = '<span class="wf-status-badge wf-status--invoiced">Invoiced</span>';
    if (opts.invoiceStatus.quickfile_invoice_number) {
      statusBadge += ' <span class="wf-invoice-num">#' + _wfEsc(opts.invoiceStatus.quickfile_invoice_number) + '</span>';
    }
  } else {
    statusBadge = '<span class="wf-status-badge wf-status--draft">Draft</span>';
  }

  var firmMissing = !((opts.firmName || '').trim());
  var firmCallout = '';
  if (firmMissing) {
    firmCallout =
      '<div class="wf-callout wf-callout-warn" id="wf-firm-missing-callout">' +
        '<p><strong>Instructing firm required.</strong> Select the firm on this record before creating an invoice.</p>' +
        '<button type="button" class="btn btn-primary" id="wf-goto-firm-section">Go to firm section</button>' +
      '</div>';
  }

  var docSelectionHtml = _wfBuildDocumentSelectionPanel(meta);

  var auditHtml = '';
  if (opts.auditLog && opts.auditLog.length) {
    auditHtml = '<details class="wf-audit-details"><summary>Billing History (' + opts.auditLog.length + ')</summary><div class="wf-audit-list">';
    opts.auditLog.forEach(function (entry) {
      auditHtml += '<div class="wf-audit-entry">' +
        '<span class="wf-audit-time">' + _wfEsc(entry.timestamp) + '</span> ' +
        '<span class="wf-audit-action">' + _wfEsc(entry.action) + '</span> ' +
        '<span class="wf-audit-user">' + _wfEsc(entry.user_name || '') + '</span>' +
        (entry.details ? '<div class="wf-audit-detail">' + _wfEsc(entry.details) + '</div>' : '') +
      '</div>';
    });
    auditHtml += '</div></details>';
  }

  var qfConfigured = opts.qfConfigured === true;
  var qfConn = opts.qfConnection || null;
  var screenTitle = qfConfigured ? 'Step 2 &mdash; Your invoice' : 'Step 2 &mdash; Billing review';
  var screenSub = qfConfigured
    ? 'Set the fixed fee, mileage and parking you will bill the instructing firm, then send to QuickFile. Section 9 time on the attendance note is for your LAA claim only &mdash; it does not set these amounts.'
    : 'Review the invoice amounts for this matter before marking it complete. Section 9 time on the attendance note is for your LAA claim only.';
  var laaGuideHtml = _wfBuildLaaClaimGuideCard(meta.data);

  var billingGuideHtml = '';
  if (qfConfigured) {
    var gSteps = [];
    if (opts.hasExistingInvoice) {
      gSteps.push({ text: 'Invoice already created. Review below, then click <strong>Continue to Review &amp; complete</strong>.', done: true });
      gSteps.push({ text: 'Click <strong>Continue to Review &amp; complete</strong> to move on.', done: false });
    } else {
      gSteps.push({ text: 'Check the charges and amounts are correct (edit if needed).', done: false });
      gSteps.push({ text: 'Tick all 3 checkboxes under <strong>Review Confirmation</strong> below to unlock the QuickFile button.', done: false });
      gSteps.push({ text: 'Click <strong>Send Bill to QuickFile</strong> to upload this invoice to your QuickFile account, or use <strong>Continue without invoice</strong> if invoicing was handled separately.', done: false });
    }
    billingGuideHtml = '<div class="wf-action-guide"><h4 class="wf-action-guide-title">What to do on this step</h4><ol class="wf-action-guide-list">';
    gSteps.forEach(function (s) {
      billingGuideHtml += '<li class="wf-action-guide-item' + (s.done ? ' wf-action-guide-item--done' : '') + '">' + (s.done ? '&#10003; ' : '') + s.text + '</li>';
    });
    billingGuideHtml += '</ol></div>';
  }

  body.innerHTML =
    '<div class="wf-screen wf-billing">' +
      '<div class="wf-screen-header">' +
        '<h3>' + screenTitle + '</h3>' +
        '<p class="wf-screen-sub">' + screenSub + '</p>' +
        statusBadge +
      '</div>' +
      billingGuideHtml +
      laaGuideHtml +
      firmCallout +

      '<div class="wf-billing-grid">' +
        '<div class="wf-card">' +
          '<h4 class="wf-card-title">Invoice Details</h4>' +
          '<div class="wf-detail-row"><span class="wf-label">Invoice Title</span><span class="wf-value" id="wf-invoice-title">' + _wfEsc(opts.invoiceTitle) + '</span></div>' +
          '<div class="wf-detail-row"><span class="wf-label">Issue Date</span><span class="wf-value">' + _wfEsc(_wfFmtDate(opts.attendanceDate)) + '</span></div>' +
          '<div class="wf-detail-row"><span class="wf-label">Firm</span><span class="wf-value">' + _wfEsc(opts.firmName) + '</span></div>' +
        '</div>' +

        '<div class="wf-card">' +
          '<h4 class="wf-card-title">Your invoice &mdash; fixed fee, mileage &amp; parking</h4>' +
          '<p class="settings-hint" style="margin:0 0 0.75rem;">Default attendance fee is &pound;160 (what most firms are invoiced). The LAA fixed fee on the claim form is &pound;320 &mdash; that is separate and does not change this invoice.</p>' +
          '<div class="wf-charges-form">' +
            '<div class="wf-charge-row"><label for="wf-fee">Attendance fee for invoice (&pound;)</label><input type="number" id="wf-fee" class="form-input wf-calc" value="' + (opts.attendanceFee || BILLING_DEFAULTS.fixedFee).toFixed(2) + '" step="0.01"></div>' +
            '<div class="wf-charge-row"><label for="wf-miles">Mileage Miles</label><input type="number" id="wf-miles" class="form-input wf-calc" value="' + (opts.mileageMiles || 0) + '" step="0.1"></div>' +
            '<div class="wf-charge-row"><label for="wf-rate">Mileage Rate (&pound;/mile)</label><input type="number" id="wf-rate" class="form-input wf-calc" value="' + (opts.mileageRate || 0.45).toFixed(2) + '" step="0.01"></div>' +
            '<div class="wf-charge-row"><label for="wf-parking">Parking (&pound;)</label><input type="number" id="wf-parking" class="form-input wf-calc" value="' + (opts.parkingAmount || 0).toFixed(2) + '" step="0.01"></div>' +
            '<div class="wf-charge-row"><label for="wf-vat">VAT %</label><input type="number" id="wf-vat" class="form-input wf-calc" value="' + (function(){ var vr = (opts.vatRate || 0.20); if (vr > 1) vr = vr / 100; return (vr * 100).toFixed(0); })() + '" step="1"></div>' +
          '</div>' +
          '<div class="wf-line-preview">' +
            '<p class="wf-line-label">Line 1:</p>' +
            '<p class="wf-line-text" id="wf-line1-preview">' + _wfEsc(line1Desc) + '</p>' +
            '<p class="wf-line-label">Line 2:</p>' +
            '<p class="wf-line-text">Mileage</p>' +
          '</div>' +
        '</div>' +

        '<div class="wf-card wf-preview-card">' +
          '<h4 class="wf-card-title">Invoice total (QuickFile preview)</h4>' +
          '<p class="settings-hint" style="margin:0 0 0.5rem;">Totals below come from the charges form &mdash; always routed through the same calculation used when sending to QuickFile.</p>' +
          '<div class="wf-preview-title" id="wf-preview-title">' + _wfEsc(opts.invoiceTitle) + '</div>' +
          '<table class="wf-preview-table">' +
            '<thead><tr><th>Description</th><th class="wf-col-amount">Amount</th></tr></thead>' +
            '<tbody id="wf-preview-lines">' +
              '<tr><td>' + _wfEsc(line1Desc) + '</td><td class="wf-col-amount">' + _wfFmtCurrency(totals.fixedFee) + '</td></tr>' +
              (totals.mileageAmount > 0 ? '<tr><td>Mileage</td><td class="wf-col-amount">' + _wfFmtCurrency(totals.mileageAmount) + '</td></tr>' : '') +
              (totals.parkingAmount > 0 ? '<tr><td>Parking/disbursements</td><td class="wf-col-amount">' + _wfFmtCurrency(totals.parkingAmount) + '</td></tr>' : '') +
            '</tbody>' +
            '<tfoot>' +
              '<tr><td>Subtotal</td><td class="wf-col-amount" id="wf-prev-sub">' + _wfFmtCurrency(totals.subTotal) + '</td></tr>' +
              '<tr><td>VAT</td><td class="wf-col-amount" id="wf-prev-vat">' + _wfFmtCurrency(totals.vatTotal) + '</td></tr>' +
              '<tr class="wf-preview-total"><td>Total</td><td class="wf-col-amount" id="wf-prev-total">' + _wfFmtCurrency(totals.grandTotal) + '</td></tr>' +
            '</tfoot>' +
          '</table>' +
        '</div>' +
      '</div>' +

      docSelectionHtml +

      '<div class="wf-card">' +
        '<h4 class="wf-card-title">Invoice Narrative</h4>' +
        '<textarea id="wf-narrative" class="form-input wf-narrative-input" rows="3">' + _wfEsc(opts.narrative) + '</textarea>' +
      '</div>' +

      (qfConfigured && !opts.hasExistingInvoice
        ? (
          '<div class="wf-card wf-review-confirmation-card">' +
            '<h4 class="wf-card-title">&#9888; Review Confirmation &mdash; tick all 3 to unlock QuickFile</h4>' +
            '<p class="wf-review-confirm-hint">You must tick every box before the <strong>Send Bill to QuickFile</strong> button becomes active.</p>' +
            '<div class="wf-checklist">' +
              '<label class="wf-check-item"><input type="checkbox" id="wf-check-attendance"> Attendance note reviewed</label>' +
              '<label class="wf-check-item"><input type="checkbox" id="wf-check-docs"> Documents reviewed &amp; named</label>' +
              '<label class="wf-check-item"><input type="checkbox" id="wf-check-billing"> Billing details confirmed</label>' +
            '</div>' +
            '<p class="wf-review-confirm-status" id="wf-review-status">&#128274; Send Bill to QuickFile is locked &mdash; tick all 3 boxes above.</p>' +
          '</div>'
        )
        : ''
      ) +

      (!qfConfigured
        ? (
          '<div class="wf-card wf-qf-not-configured-card">' +
            '<h4 class="wf-card-title">&#9881; QuickFile not set up on this computer</h4>' +
            '<p class="wf-qf-not-configured-text">' +
              (qfConn && qfConn.missing && qfConn.missing.length
                ? ('Missing: <strong>' + _wfEsc(qfConn.missing.join(', ')) + '</strong>. ')
                : '') +
              'QuickFile credentials are saved to your Custody Note account and load automatically when you bill. ' +
              'Open Settings, enter your Account Number, ' +
              'API Key and Application ID, then click <strong>Save and test QuickFile</strong>. ' +
              'You can still review billing above and continue to <strong>Review &amp; complete</strong> without invoicing here.' +
            '</p>' +
            '<div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.5rem;">' +
              '<button type="button" id="wf-bill-open-qf-settings" class="btn btn-secondary btn-small">Open QuickFile settings</button>' +
              '<button type="button" id="wf-bill-test-qf-connection" class="btn btn-secondary btn-small">Test QuickFile connection</button>' +
            '</div>' +
          '</div>'
        )
        : ''
      ) +

      auditHtml +
    '</div>';

  _wfBuildBillingFooter(footer, meta, opts);
  _wfBindBillingEvents(meta, opts);
}

/** Read-only reminder: Section 9 LAA claim figures are separate from the QuickFile invoice. */
function _wfBuildLaaClaimGuideCard(data) {
  var d = data || {};
  if (d._formType === 'telephone') return '';
  var mins = parseInt(String(d.totalMinutes || ''), 10);
  var minsLabel = (!isNaN(mins) && mins > 0) ? (mins + ' minutes recorded on the attendance note') : 'No time recorded yet on the attendance note';
  var escapeHint = '';
  if (d.isEscapeFee === 'Yes' || (d.totalNet && parseFloat(d.totalNet) > 650)) {
    escapeHint = ' <strong>Escape case:</strong> total costs may exceed the &pound;650 threshold &mdash; claim at hourly rates (CRM18).';
  }
  return '<div class="wf-card wf-laa-claim-guide">' +
    '<h4 class="wf-card-title">LAA claim guide (Section 9) &mdash; does not set the bill</h4>' +
    '<p class="settings-hint" style="margin:0;">' + minsLabel +
    '. The LAA fixed fee on your claim is &pound;320 with a &pound;650 escape threshold. ' +
    'Those figures are for the Legal Aid portal &mdash; they do not change the attendance fee, mileage or parking you enter for QuickFile above.' +
    escapeHint + '</p>' +
  '</div>';
}

function _wfBuildDocumentSelectionPanel(meta) {
  var generatedDocs = _wfGeneratedDocs || {};
  var attachments = _wfGetAttachments(meta.data);
  var hasAnyDocs = Object.keys(generatedDocs).length > 0 || attachments.length > 0;

  if (!hasAnyDocs) {
    return '<div class="wf-card wf-doc-selection">' +
      '<h4 class="wf-card-title">&#128206; Documents to Attach to Invoice</h4>' +
      '<p class="wf-empty-state">No documents available. Go back to the Documents step to generate forms or upload files.</p>' +
    '</div>';
  }

  var html = '<div class="wf-card wf-doc-selection">' +
    '<h4 class="wf-card-title">&#128206; Documents to Attach to Invoice</h4>' +
    '<p class="wf-doc-sel-sub">Select which documents to upload to QuickFile with this invoice.</p>' +
    '<div class="wf-doc-sel-actions">' +
      '<button type="button" class="btn btn-small wf-doc-sel-all">Select All</button>' +
      '<button type="button" class="btn btn-small btn-secondary wf-doc-sel-none">Deselect All</button>' +
    '</div>' +
    '<div class="wf-doc-sel-list">';

  var genKeys = Object.keys(generatedDocs);
  if (genKeys.length) {
    html += '<div class="wf-doc-sel-group"><span class="wf-doc-sel-group-label">Generated Forms</span></div>';
    genKeys.forEach(function (key) {
      var doc = generatedDocs[key];
      var checked = _wfSelectedDocs['gen_' + key] !== false ? ' checked' : '';
      if (_wfSelectedDocs['gen_' + key] === undefined) _wfSelectedDocs['gen_' + key] = true;
      html += '<label class="wf-doc-sel-item">' +
        '<input type="checkbox" class="wf-doc-sel-cb" data-doc-key="gen_' + key + '"' + checked + '>' +
        '<span class="wf-doc-sel-icon">&#128196;</span>' +
        '<span class="wf-doc-sel-name">' + _wfEsc(doc.label) + '</span>' +
        '<span class="wf-doc-sel-size">' + _wfFmtFileSize(doc.size) + '</span>' +
      '</label>';
    });
  }

  if (attachments.length) {
    html += '<div class="wf-doc-sel-group"><span class="wf-doc-sel-group-label">Uploaded Files</span>' +
      '<span class="wf-doc-sel-hint">(uploaded files must be attached to QuickFile manually)</span></div>';
    attachments.forEach(function (att) {
      var renamed = att.documentType ? formatAttachmentFilename({
        clientName: meta.clientName, policeStation: meta.stationName,
        attendanceDate: meta.attendanceDate, documentType: att.documentType,
        customDocumentType: att.customDocumentType, firmName: meta.firmName,
        extension: _wfExtFromName(att.originalName),
      }) : att.originalName;
      html += '<label class="wf-doc-sel-item wf-doc-sel-item--disabled">' +
        '<span class="wf-doc-sel-icon">&#128206;</span>' +
        '<span class="wf-doc-sel-name">' + _wfEsc(renamed) + '</span>' +
      '</label>';
    });
  }

  html += '</div>';

  var selectedCount = Object.keys(_wfSelectedDocs).filter(function (k) { return _wfSelectedDocs[k]; }).length;
  html += '<div class="wf-doc-sel-summary" id="wf-doc-sel-summary">' + selectedCount + ' document' + (selectedCount !== 1 ? 's' : '') + ' selected for attachment</div>';
  html += '</div>';
  return html;
}

function _wfFmtCurrency(val) {
  return '\u00A3' + (parseFloat(val) || 0).toFixed(2);
}

function _wfBillingNoteFinalised() {
  var st = typeof currentRecordStatus !== 'undefined' ? currentRecordStatus : null;
  return st === 'finalised' || st === 'completed';
}

function _wfBuildBillingFooter(footer, meta, opts) {
  /* Step 2 has ONE forward button (label depends on QuickFile state),
   * plus Back and Close. Per-step Archive removed so the workflow stays
   * strictly linear. Skip-invoice and next-complete were redundant
   * variations of the same forward action and have been merged. */
  var qfConfigured = opts.qfConfigured === true;
  var primaryBtnHtml = '';
  if (!qfConfigured) {
    primaryBtnHtml =
      '<button type="button" id="wf-bill-next-complete" class="btn btn-primary wf-btn-next-action" data-mode="skip">' +
        'Next: Review &amp; complete &#9654;' +
      '</button>';
  } else if (opts.hasExistingInvoice) {
    primaryBtnHtml =
      '<button type="button" id="wf-bill-create" class="btn btn-primary wf-btn-next-action" data-mode="next">' +
        'Continue to Review &amp; complete &#9654;' +
      '</button>';
  } else {
    primaryBtnHtml =
      '<button type="button" id="wf-bill-create" class="btn btn-primary btn-billing-create wf-btn-next-action" data-mode="send" disabled>' +
        '&#128274; Send Bill to QuickFile &mdash; tick all 3 checkboxes first' +
      '</button>';
  }

  footer.innerHTML =
    '<button type="button" id="wf-bill-back" class="btn btn-secondary btn-small">&#9664; Back</button>' +
    '<span class="wf-footer-spacer"></span>' +
    primaryBtnHtml +
    '<button type="button" id="wf-bill-close" class="btn btn-secondary btn-small">Close</button>';

  document.getElementById('wf-bill-back').addEventListener('click', _wfGoBack);
  document.getElementById('wf-bill-close').addEventListener('click', closeWorkflow);

  var createBtn = document.getElementById('wf-bill-create') || document.getElementById('wf-bill-next-complete');
  if (createBtn) {
    createBtn.addEventListener('click', function () {
      var mode = createBtn.dataset.mode || 'send';
      if (mode === 'send') {
        _wfHandleCreateInvoice(meta, opts);
      } else if (mode === 'skip') {
        if (typeof _wfGoNext === 'function') _wfGoNext();
      } else {
        if (typeof _wfGoNext === 'function') _wfGoNext();
      }
    });
  }
}

function _wfBindBillingEvents(meta, opts) {
  var overlay = document.getElementById('workflow-overlay');
  if (!overlay) return;

  var gotoFirm = document.getElementById('wf-goto-firm-section');
  if (gotoFirm) {
    gotoFirm.addEventListener('click', function () {
      if (typeof window.goToInstructingFirmSection === 'function') {
        window.goToInstructingFirmSection();
      } else {
        showToast('Open the record, go to Case Reference & Arrival, then select the instructing firm.', 'info', 6000);
      }
    });
  }

  overlay.querySelectorAll('.wf-calc').forEach(function (inp) {
    inp.addEventListener('input', function () { _wfRecalcPreview(meta); });
  });

  var checkboxes = overlay.querySelectorAll('.wf-checklist input[type="checkbox"]');
  var createBtn = document.getElementById('wf-bill-create');
  var reviewStatusEl = document.getElementById('wf-review-status');
  if (checkboxes && checkboxes.length) {
    function updateBtn() {
      if (!createBtn || createBtn.dataset.mode !== 'send') return;
      var allChecked = true;
      var checkedCount = 0;
      checkboxes.forEach(function (cb) { if (cb.checked) checkedCount++; else allChecked = false; });
      if (createBtn) {
        createBtn.disabled = !allChecked;
        if (allChecked) {
          createBtn.innerHTML = '&#10003; Send Bill to QuickFile';
        } else {
          createBtn.innerHTML = '&#128274; Send Bill to QuickFile &mdash; tick all 3 checkboxes first';
        }
      }
      if (reviewStatusEl) {
        if (allChecked) {
          reviewStatusEl.innerHTML = '&#128275; <strong>Send Bill to QuickFile is now unlocked</strong> &mdash; click it in the footer below.';
          reviewStatusEl.className = 'wf-review-confirm-status wf-review-confirm-status--unlocked';
        } else {
          reviewStatusEl.innerHTML = '&#128274; Send Bill to QuickFile is locked &mdash; tick all 3 boxes above (' + checkedCount + '/3 done).';
          reviewStatusEl.className = 'wf-review-confirm-status';
        }
      }
    }
    checkboxes.forEach(function (cb) { cb.addEventListener('change', updateBtn); });
  }

  var openQfSettingsBtn = document.getElementById('wf-bill-open-qf-settings');
  if (openQfSettingsBtn) {
    openQfSettingsBtn.addEventListener('click', function () {
      if (typeof window.openQuickFileSettings === 'function') {
        if (typeof closeWorkflow === 'function') closeWorkflow();
        window.openQuickFileSettings();
      } else {
        showToast('Open Settings to add your QuickFile Account Number, API Key and Application ID.', 'info', 6000);
      }
    });
  }

  var testQfBtn = document.getElementById('wf-bill-test-qf-connection');
  if (testQfBtn) {
    testQfBtn.addEventListener('click', function () {
      var refresh = function () {
        if (typeof _wfRenderCurrentStep === 'function') _wfRenderCurrentStep();
      };
      if (typeof hasQuickFileSettingsConfigured === 'function' && hasQuickFileSettingsConfigured()
          && typeof window.testQuickFileConnection === 'function') {
        var p = window.testQuickFileConnection();
        if (p && typeof p.then === 'function') {
          p.finally(refresh);
          return;
        }
      }
      refresh();
    });
  }

  overlay.querySelectorAll('.wf-doc-sel-cb').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var key = cb.getAttribute('data-doc-key');
      _wfSelectedDocs[key] = cb.checked;
      _wfUpdateDocSelSummary();
    });
  });

  var selAllBtn = overlay.querySelector('.wf-doc-sel-all');
  if (selAllBtn) {
    selAllBtn.addEventListener('click', function () {
      overlay.querySelectorAll('.wf-doc-sel-cb').forEach(function (cb) {
        cb.checked = true;
        _wfSelectedDocs[cb.getAttribute('data-doc-key')] = true;
      });
      _wfUpdateDocSelSummary();
    });
  }

  var selNoneBtn = overlay.querySelector('.wf-doc-sel-none');
  if (selNoneBtn) {
    selNoneBtn.addEventListener('click', function () {
      overlay.querySelectorAll('.wf-doc-sel-cb').forEach(function (cb) {
        cb.checked = false;
        _wfSelectedDocs[cb.getAttribute('data-doc-key')] = false;
      });
      _wfUpdateDocSelSummary();
    });
  }
}

function _wfUpdateDocSelSummary() {
  var count = Object.keys(_wfSelectedDocs).filter(function (k) { return _wfSelectedDocs[k]; }).length;
  var el = document.getElementById('wf-doc-sel-summary');
  if (el) el.textContent = count + ' document' + (count !== 1 ? 's' : '') + ' selected for attachment';
}

function _wfRecalcPreview(meta) {
  var feeEl = document.getElementById('wf-fee');
  if (!feeEl) return;
  var fee = parseFloat(feeEl.value) || 0;
  var miles = parseFloat((document.getElementById('wf-miles') || {}).value) || 0;
  var rate = parseFloat((document.getElementById('wf-rate') || {}).value) || 0;
  var parking = parseFloat((document.getElementById('wf-parking') || {}).value) || 0;
  var vatPct = parseFloat((document.getElementById('wf-vat') || {}).value) || 0;
  var totals = calculateInvoiceTotals({
    fixedFee: fee, mileageMiles: miles, mileageRate: rate,
    parkingAmount: parking, vatRate: vatPct / 100,
  });
  var sub = document.getElementById('wf-prev-sub');
  var vat = document.getElementById('wf-prev-vat');
  var tot = document.getElementById('wf-prev-total');
  if (sub) sub.textContent = _wfFmtCurrency(totals.subTotal);
  if (vat) vat.textContent = _wfFmtCurrency(totals.vatTotal);
  if (tot) tot.textContent = _wfFmtCurrency(totals.grandTotal);

  var line1 = buildLine1Description({
    clientName: meta.clientName, policeStation: meta.stationName,
    attendanceDate: meta.attendanceDate,
  });
  var l1el = document.getElementById('wf-line1-preview');
  if (l1el) l1el.textContent = line1;
}

function _wfGetSelectedDocAttachments() {
  var attachments = [];
  var generatedDocs = _wfGeneratedDocs || {};

  Object.keys(_wfSelectedDocs).forEach(function (key) {
    if (!_wfSelectedDocs[key]) return;

    if (key.startsWith('gen_')) {
      var formId = key.slice(4);
      var doc = generatedDocs[formId];
      if (doc && doc.base64) {
        attachments.push({
          base64: doc.base64,
          filename: doc.filename || formId + '.pdf',
          description: doc.label || formId,
        });
      }
    }
  });

  return attachments;
}

function _wfHandleCreateInvoice(meta, opts) {
  var recordId = meta.recordId;
  var fee = parseFloat(document.getElementById('wf-fee').value) || 0;
  var miles = parseFloat(document.getElementById('wf-miles').value) || 0;
  var rate = parseFloat(document.getElementById('wf-rate').value) || 0;
  var parking = parseFloat(document.getElementById('wf-parking').value) || 0;
  var vatPct = parseFloat(document.getElementById('wf-vat').value) || 0;
  var narrative = (document.getElementById('wf-narrative') || {}).value || '';

  var extraAttachments = _wfGetSelectedDocAttachments();

  var mergedOpts = {
    clientName: meta.clientName,
    firmName: meta.firmName,
    stationName: meta.stationName,
    attendanceDate: meta.attendanceDate,
    attendanceFee: fee,
    mileageMiles: miles,
    mileageRate: rate,
    parkingAmount: parking,
    vatRate: vatPct / 100,
    narrative: narrative,
    hasExistingInvoice: opts.hasExistingInvoice,
    invoiceStatus: opts.invoiceStatus,
    extraAttachments: extraAttachments,
  };

  _wfHandleCreateInvoiceImpl(recordId, mergedOpts);
}

async function _wfHandleCreateInvoiceImpl(recordId, opts) {
  console.log('[billing] Invoice creation started for record', recordId);
  if (!recordId) {
    showToast('Save the record first before creating an invoice', 'error');
    return;
  }
  if (!window.api || !window.api.quickfileCreateInvoice || !window.api.getSettings) {
    showToast('Invoice API is not available in this environment', 'error');
    return;
  }

  var allowDuplicate = false;
  if (window.api.attendanceInvoiceStatus) {
    try {
      var freshStatus = await window.api.attendanceInvoiceStatus(recordId);
      if (freshStatus && freshStatus.quickfile_invoice_id) {
        opts.hasExistingInvoice = true;
        opts.invoiceStatus = freshStatus;
      }
    } catch (_) { /* keep opts */ }
  }
  if (opts.hasExistingInvoice) {
    var confirmed = await showConfirm('This record already has an invoice (' + ((opts.invoiceStatus || {}).quickfile_invoice_number || 'unknown') + ').\n\nAre you sure you want to create another invoice?');
    if (!confirmed) return;
    allowDuplicate = true;
  }

  if (!opts.firmName) {
    showToast('Select the instructing firm on the record before creating an invoice.', 'error', 6500);
    return;
  }

  var createBtn = document.getElementById('wf-bill-create');
  if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'Sending to QuickFile...'; }

  var settings = window._appSettingsCache || {};
  var userName = settings.feeEarnerNameDefault || settings.feeEarnerName || '';
  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
  var firmEmail = '';
  if (data.firmId && window.firms) {
    var firm = window.firms.find(function (f) { return String(f.id) === String(data.firmId); });
    if (firm) firmEmail = firm.contact_email || '';
  }

  var billingInv = '';
  if (typeof ensureBillingDisplayInvoiceNumber === 'function') {
    billingInv = ensureBillingDisplayInvoiceNumber({ skipSave: false });
  }

  var attachTitle = (typeof buildAttachmentTitle === 'function')
    ? buildAttachmentTitle({ clientName: opts.clientName, stationName: opts.stationName, attendanceDate: opts.attendanceDate, firmName: opts.firmName })
    : '';
  var attachName = (attachTitle || ([data.surname, data.forename].filter(Boolean).join('_') || 'attendance') + '-note') + '.pdf';
  attachName = attachName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 240);

  try {
    var fetchedSettings = await window.api.getSettings();
    var builder = (typeof getActivePdfBuilder === 'function') ? getActivePdfBuilder() : (typeof buildPdfHtml === 'function' ? buildPdfHtml : null);
    var attachHtml = builder ? builder(data, fetchedSettings || {}) : '';

    var result = await window.api.quickfileCreateInvoice({
      attendanceId: recordId,
      firmName: opts.firmName,
      contactEmail: firmEmail,
      clientName: opts.clientName || '',
      stationName: opts.stationName || '',
      attendanceFee: opts.attendanceFee,
      mileageMiles: opts.mileageMiles,
      mileageRate: opts.mileageRate,
      parkingAmount: opts.parkingAmount,
      vatRate: opts.vatRate,
      narrative: opts.narrative,
      invoiceDate: opts.attendanceDate || new Date().toISOString().slice(0, 10),
      userName: userName,
      billingInvoiceNumber: billingInv,
      attachAttendanceHtml: attachHtml || undefined,
      attachPdfFileName: attachName,
      allowDuplicate: allowDuplicate,
      extraAttachments: opts.extraAttachments || [],
    });

    if (result.ok) {
      if (typeof formData === 'object' && formData) {
        formData.quickfile_invoice_id = result.invoiceId || '';
        formData.quickfileInvoiceNumber = result.invoiceNumber || '';
      }
      if (typeof quietSave === 'function') quietSave();
      if (typeof refreshQuickFileInvoiceRefDisplay === 'function') refreshQuickFileInvoiceRefDisplay();

      var attachSummary = '';
      if (result.attachResults && result.attachResults.length) {
        var okCount = result.attachResults.filter(function (r) { return r.ok; }).length;
        var failCount = result.attachResults.filter(function (r) { return !r.ok; }).length;
        attachSummary = ' | ' + okCount + ' attachment' + (okCount !== 1 ? 's' : '') + ' uploaded';
        if (failCount > 0) attachSummary += ', ' + failCount + ' failed';
      }

      console.log('[billing] Invoice created: #' + (result.invoiceNumber || result.invoiceId));
      showToast('QuickFile invoice #' + (result.invoiceNumber || result.invoiceId) + ' sent successfully' + attachSummary, 'success', 6000);
      showToast('Next: review and mark office work complete (step 3).', 'info', 5000);

      if (typeof _wfAfterInvoiceCreatedGoToCompletion === 'function') {
        _wfAfterInvoiceCreatedGoToCompletion();
      } else {
        _wfRenderCurrentStep();
      }
    } else {
      _wfShowInvoiceFailure(result.error || 'Unknown error', result.code);
    }
  } catch (err) {
    console.error('[billing] Invoice creation failed:', err);
    _wfShowInvoiceFailure(err && err.message ? err.message : String(err), err && err.code);
  } finally {
    if (createBtn) { createBtn.disabled = false; createBtn.textContent = opts.hasExistingInvoice ? '\u26A0 Send Another Invoice to QuickFile' : 'Send Bill to QuickFile'; }
  }
}

/**
 * Show a clear, actionable recovery message when sending to QuickFile fails.
 */
function _wfShowInvoiceFailure(reason, code) {
  var toast = (typeof formatBillingCreateFailureToast === 'function')
    ? formatBillingCreateFailureToast(reason, code)
    : ('Send to QuickFile failed: ' + String(reason || 'Unknown error'));
  showToast(toast, 'error', 9000);
}

/**
 * Call when leaving Step 2 so the completion / PDF summary can use the same
 * figures as the billing form (getElementById('wf-fee') is not on the DOM on step 3).
 */
function _wfCaptureBillingSnapshotIfPresent() {
  var feeEl = document.getElementById('wf-fee');
  if (!feeEl) return;
  var vatRaw = parseFloat((document.getElementById('wf-vat') || {}).value);
  if (!Number.isFinite(vatRaw) || vatRaw < 0) vatRaw = 20;
  if (typeof window !== 'undefined') {
    window._wfBillingSnapshot = {
      fixedFee: parseFloat(feeEl.value) || 0,
      mileageMiles: parseFloat((document.getElementById('wf-miles') || {}).value) || 0,
      mileageRate: parseFloat((document.getElementById('wf-rate') || {}).value) || (BILLING_DEFAULTS.mileageRate != null ? BILLING_DEFAULTS.mileageRate : 0.45),
      parkingAmount: parseFloat((document.getElementById('wf-parking') || {}).value) || 0,
      vatRate: vatRaw / 100,
    };
  }
}
if (typeof window !== 'undefined') window._wfCaptureBillingSnapshotIfPresent = _wfCaptureBillingSnapshotIfPresent;

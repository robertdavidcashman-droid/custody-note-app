/* ═══════════════════════════════════════════════════════
   BILLING & GENERATED DOCUMENTS PANEL
   Full billing workflow: review docs → confirm → create invoice (+ attach PDF in QuickFile)
   Depends on: showToast, esc, safeJson, getFormData, currentAttendanceId,
               formData, stations (app.js globals), window.api
   ═══════════════════════════════════════════════════════ */

var _billingPanelOpen = false;

function _billingFmtDate(val) {
  if (!val) return '';
  var m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : val;
}

function openBillingPanel() {
  /* Single billing path: the canonical UI is the full-page billing workflow
   * (Documents -> Billing review -> Review & archive). This legacy modal is kept
   * only as a defensive fallback for environments where the workflow screen
   * isn't mounted. Redirect to the workflow whenever it is available so users
   * never see two competing billing UIs. */
  if (typeof showView === 'function' && document.getElementById('view-matter-billing')) {
    showView('matter-billing');
    return;
  }
  if (typeof window !== 'undefined' && typeof window.openWorkflow === 'function') {
    window.openWorkflow();
    return;
  }

  if (_billingPanelOpen) return;
  _billingPanelOpen = true;

  var existing = document.getElementById('billing-panel-overlay');
  if (existing) existing.remove();

  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
  var recordId = window.currentAttendanceId || null;

  var clientName = [data.forename, data.surname].filter(Boolean).join(' ') || '';
  var firmName = data.firmName || '';
  var stationName = data.policeStationName || '';
  var attendanceDate = data.date || data.instructionDateTime || '';
  if (attendanceDate && attendanceDate.length > 10) attendanceDate = attendanceDate.slice(0, 10);
  var offenceSummary = data.offenceSummary || data.offence1Details || '';

  var billingSettings = (window._billingDefaults || {});
  var defaultAttendanceFee = billingSettings.attendanceFee || 160.00;
  var defaultMileageRate = billingSettings.mileageRate || 0.45;
  var defaultVatRate = billingSettings.vatRate || 0.20;
  var parkingFromRecord = parseFloat(data.parkingCost) || 0;
  var milesFromRecord = parseFloat(data.milesClaimable) || 0;

  var stationId = data.policeStationId || '';

  Promise.all([
    stationId && window.api && window.api.stationMileageGet ? window.api.stationMileageGet(stationId) : Promise.resolve(null),
    recordId && window.api && window.api.attendanceInvoiceStatus ? window.api.attendanceInvoiceStatus(recordId) : Promise.resolve({}),
    recordId && window.api && window.api.billingAuditLogGet ? window.api.billingAuditLogGet(recordId) : Promise.resolve([]),
  ]).then(function (results) {
    var stationMileage = results[0];
    var invoiceStatus = results[1] || {};
    var auditLog = results[2] || [];

    var hasExistingInvoice = !!(invoiceStatus.quickfile_invoice_id);

    if (stationMileage && stationMileage.mileage_from_base != null && !milesFromRecord) {
      milesFromRecord = stationMileage.mileage_from_base;
    }

    if (hasExistingInvoice && invoiceStatus.invoice_attendance_fee != null) {
      defaultAttendanceFee = invoiceStatus.invoice_attendance_fee;
    }
    if (hasExistingInvoice && invoiceStatus.invoice_mileage_miles != null) {
      milesFromRecord = invoiceStatus.invoice_mileage_miles;
    }
    if (hasExistingInvoice && invoiceStatus.invoice_mileage_rate != null) {
      defaultMileageRate = invoiceStatus.invoice_mileage_rate;
    }
    if (hasExistingInvoice && invoiceStatus.invoice_parking_amount != null) {
      parkingFromRecord = invoiceStatus.invoice_parking_amount;
    }
    if (hasExistingInvoice && invoiceStatus.invoice_vat_rate != null) {
      defaultVatRate = invoiceStatus.invoice_vat_rate;
    }

    var narrative = _buildInvoiceNarrative(clientName, stationName, attendanceDate, offenceSummary);
    if (hasExistingInvoice && invoiceStatus.invoice_narrative) {
      narrative = invoiceStatus.invoice_narrative;
    }

    _renderBillingPanel(data, recordId, {
      clientName: clientName,
      firmName: firmName,
      stationName: stationName,
      attendanceDate: attendanceDate,
      offenceSummary: offenceSummary,
      attendanceFee: defaultAttendanceFee,
      mileageMiles: milesFromRecord,
      mileageRate: defaultMileageRate,
      parkingAmount: parkingFromRecord,
      vatRate: defaultVatRate,
      narrative: narrative,
      invoiceStatus: invoiceStatus,
      hasExistingInvoice: hasExistingInvoice,
      auditLog: auditLog,
    });
  }).catch(function () {
    _renderBillingPanel(data, recordId, {
      clientName: clientName,
      firmName: firmName,
      stationName: stationName,
      attendanceDate: attendanceDate,
      offenceSummary: offenceSummary,
      attendanceFee: defaultAttendanceFee,
      mileageMiles: milesFromRecord,
      mileageRate: defaultMileageRate,
      parkingAmount: parkingFromRecord,
      vatRate: defaultVatRate,
      narrative: _buildInvoiceNarrative(clientName, stationName, attendanceDate, offenceSummary),
      invoiceStatus: {},
      hasExistingInvoice: false,
      auditLog: [],
    });
  });
}

function _buildInvoiceNarrative(client, station, date, offence) {
  var dateFmt = '';
  if (date) {
    var parts = date.split('-');
    if (parts.length === 3) dateFmt = parts[2] + '.' + parts[1] + '.' + parts[0].slice(2);
  }
  var label = [client, station].filter(Boolean).join(' - ');
  return ['Police station attendance', label, dateFmt, offence]
    .map(function (s) { return (s || '').trim(); })
    .filter(Boolean)
    .join(' \u2013 ');
}

function _escAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _fmtCurrency(val) {
  return '\u00A3' + (parseFloat(val) || 0).toFixed(2);
}

function _getGeneratedDocuments(data) {
  var docs = [];
  docs.push({ name: 'Attendance Note PDF', type: 'attendance', available: true });
  docs.push({ name: 'Applicant Declaration (pre-filled PDF)', type: 'declaration', available: true });
  if (data.disclosure || data.disclosureSummary) docs.push({ name: 'Disclosure Summary', type: 'disclosure', available: true });
  return docs;
}

/** Official LAA / portal documents the firm must hold on file — user confirms they have attached. */
function _getLaaAttachFormsList() {
  return [
    { name: 'CRM1 — Client Details (signed official PDF on file)', type: 'crm1' },
    { name: 'CRM2 — Advice & Assistance (signed official PDF on file)', type: 'crm2' },
    { name: 'CRM3 — Advocacy Assistance (signed official PDF on file)', type: 'crm3' },
    { name: 'Applicant Declaration (signed official PDF on file)', type: 'declaration_attach' },
    { name: 'Signed Apply application / CRM14 from portal (or paper pack)', type: 'crm14' },
    { name: 'CRM15 — Financial statement (attach if required)', type: 'crm15' },
  ];
}

function _renderBillingPanel(data, recordId, opts) {
  var stale = document.getElementById('billing-panel-overlay');
  if (stale) stale.remove();

  var docs = _getGeneratedDocuments(data);
  var attachForms = _getLaaAttachFormsList();

  var docsHtml = '';
  if (docs.length) {
    docsHtml = '<table class="billing-docs-table"><thead><tr>' +
      '<th>Document</th><th>Preview</th><th>Include in pack</th>' +
      '</tr></thead><tbody>';
    docs.forEach(function (doc, idx) {
      docsHtml += '<tr>' +
        '<td>' + _escHtml(doc.name) + '</td>' +
        '<td><button type="button" class="btn btn-small billing-doc-preview" data-doc-type="' + doc.type + '">Preview</button></td>' +
        '<td><input type="checkbox" class="billing-doc-include" data-doc-idx="' + idx + '" checked></td>' +
        '</tr>';
    });
    docsHtml += '</tbody></table>';
  } else {
    docsHtml = '<p class="settings-hint">No generated documents for this record.</p>';
  }

  var attachHtml = '<p class="settings-hint" style="margin-bottom:0.5rem;">Tick each row when the <strong>signed official</strong> PDF is on this file (use Attachments below on the form, or your practice case system). Preview opens a draft or summary from this record; save to Desktop uses the naming: client — station — date — form — firm.</p>' +
    '<table class="billing-docs-table"><thead><tr>' +
    '<th>LAA / portal item</th><th>Preview</th><th>Attached</th>' +
    '</tr></thead><tbody>';
  attachForms.forEach(function (row, aidx) {
    attachHtml += '<tr>' +
      '<td>' + _escHtml(row.name) + '</td>' +
      '<td><button type="button" class="btn btn-small billing-attach-preview" data-attach-type="' + row.type + '">Preview</button></td>' +
      '<td><input type="checkbox" class="billing-attach-check" data-attach-idx="' + aidx + '"></td>' +
      '</tr>';
  });
  attachHtml += '</tbody></table>';

  var invoiceStatusHtml = '';
  if (opts.hasExistingInvoice) {
    invoiceStatusHtml =
      '<div class="billing-status-badge billing-status-invoiced">Invoiced</div>' +
      '<div class="billing-status-detail">' +
        '<span>Invoice #: <strong>' + _escHtml(opts.invoiceStatus.quickfile_invoice_number) + '</strong></span>' +
        (opts.invoiceStatus.quickfile_invoice_url
          ? ' <a href="#" class="billing-invoice-link" data-url="' + _escAttr(opts.invoiceStatus.quickfile_invoice_url) + '">View in QuickFile</a>'
          : '') +
        '<br><span class="settings-hint">Created: ' + _escHtml(opts.invoiceStatus.invoice_created_at || '') +
        (opts.invoiceStatus.invoice_created_by ? ' by ' + _escHtml(opts.invoiceStatus.invoice_created_by) : '') +
        '</span>' +
      '</div>';
  } else {
    invoiceStatusHtml = '<div class="billing-status-badge billing-status-not-invoiced">Not Invoiced</div>';
  }

  var _vatRateForCalc = (opts.vatRate || 0.20);
  if (typeof _vatRateForCalc === 'number' && _vatRateForCalc > 1) _vatRateForCalc = _vatRateForCalc / 100;
  var _legacyTotals = (typeof calculateInvoiceTotals === 'function')
    ? calculateInvoiceTotals({
        fixedFee: opts.attendanceFee || 0,
        mileageMiles: opts.mileageMiles || 0,
        mileageRate: opts.mileageRate || 0.45,
        parkingAmount: opts.parkingAmount || 0,
        vatRate: _vatRateForCalc,
      })
    : null;
  var subtotal = _legacyTotals ? _legacyTotals.subTotal : 0;
  var vatAmt = _legacyTotals ? _legacyTotals.vatTotal : 0;
  var total = _legacyTotals ? _legacyTotals.grandTotal : 0;

  var auditHtml = '';
  if (opts.auditLog && opts.auditLog.length) {
    auditHtml = '<details class="billing-audit-details"><summary>Billing History (' + opts.auditLog.length + ' entries)</summary><div class="billing-audit-list">';
    opts.auditLog.forEach(function (entry) {
      auditHtml += '<div class="billing-audit-entry">' +
        '<span class="billing-audit-time">' + _escHtml(entry.timestamp) + '</span> ' +
        '<span class="billing-audit-action">' + _escHtml(entry.action) + '</span> ' +
        '<span class="billing-audit-user">' + _escHtml(entry.user_name || '') + '</span>' +
        (entry.details ? '<div class="billing-audit-detail">' + _escHtml(entry.details) + '</div>' : '') +
        '</div>';
    });
    auditHtml += '</div></details>';
  }

  var html =
    '<div id="billing-panel-overlay" class="billing-overlay" role="dialog" aria-modal="true" aria-label="Billing &amp; Documents">' +
      '<div class="billing-panel billing-panel--flow">' +
        '<div class="billing-panel-header">' +
          '<h2 class="billing-panel-title">&#163; Billing &amp; documents</h2>' +
          '<button type="button" class="billing-panel-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="billing-panel-body">' +
          '<div class="billing-section">' +
            '<h3>Summary</h3>' +
            '<p class="settings-hint" style="margin-top:0;">Review the matter and create the QuickFile invoice. The attendance PDF is generated in the main process when the invoice is created.</p>' +
            '<div class="billing-detail-grid">' +
              '<div><span class="billing-label">Firm</span><span class="billing-value">' + _escHtml(opts.firmName) + '</span></div>' +
              '<div><span class="billing-label">Client</span><span class="billing-value">' + _escHtml(opts.clientName) + '</span></div>' +
              '<div><span class="billing-label">Police Station</span><span class="billing-value">' + _escHtml(opts.stationName) + '</span></div>' +
              '<div><span class="billing-label">Attendance Date</span><span class="billing-value">' + _escHtml(_billingFmtDate(opts.attendanceDate)) + '</span></div>' +
              '<div style="grid-column:1/-1;"><span class="billing-label">Offence Summary</span><span class="billing-value">' + _escHtml(opts.offenceSummary) + '</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="billing-section">' +
            '<h3>LAA forms on file</h3>' +
            attachHtml +
          '</div>' +

          '<div class="billing-section">' +
            '<h3>Other documents</h3>' +
            docsHtml +
          '</div>' +

          '<div class="billing-section">' +
            '<h3>Fees &amp; narrative</h3>' +
            '<div class="billing-edit-grid">' +
              '<div class="billing-edit-row">' +
                '<label for="billing-attendance-fee">Attendance Fee (&pound;)</label>' +
                '<input type="number" id="billing-attendance-fee" class="form-input billing-calc-input" value="' + (opts.attendanceFee || 160).toFixed(2) + '" step="0.01">' +
              '</div>' +
              '<div class="billing-edit-row">' +
                '<label for="billing-mileage-miles">Mileage (miles)</label>' +
                '<input type="number" id="billing-mileage-miles" class="form-input billing-calc-input" value="' + (opts.mileageMiles || 0) + '" step="0.1">' +
              '</div>' +
              '<div class="billing-edit-row">' +
                '<label for="billing-mileage-rate">Mileage Rate (&pound;/mile)</label>' +
                '<input type="number" id="billing-mileage-rate" class="form-input billing-calc-input" value="' + (opts.mileageRate || 0.45).toFixed(2) + '" step="0.01">' +
              '</div>' +
              '<div class="billing-edit-row">' +
                '<label for="billing-parking">Parking / Disbursements (&pound;)</label>' +
                '<input type="number" id="billing-parking" class="form-input billing-calc-input" value="' + (opts.parkingAmount || 0).toFixed(2) + '" step="0.01">' +
              '</div>' +
              '<div class="billing-edit-row">' +
                '<label for="billing-vat-rate">VAT Rate (%)</label>' +
                '<input type="number" id="billing-vat-rate" class="form-input billing-calc-input" value="' + (function(){ var vr = (opts.vatRate || 0.20); if (vr > 1) vr = vr / 100; return (vr * 100).toFixed(0); })() + '" step="1">' +
              '</div>' +
            '</div>' +
            '<div class="billing-totals">' +
              '<div class="billing-total-row"><span>Subtotal</span><span id="billing-subtotal">' + _fmtCurrency(subtotal) + '</span></div>' +
              '<div class="billing-total-row"><span>VAT</span><span id="billing-vat">' + _fmtCurrency(vatAmt) + '</span></div>' +
              '<div class="billing-total-row billing-total-final"><span>Total</span><span id="billing-total">' + _fmtCurrency(total) + '</span></div>' +
            '</div>' +
            '<h3 style="margin-top:1rem;">Invoice Narrative</h3>' +
            '<textarea id="billing-narrative" class="form-input billing-narrative-input" rows="3">' + _escHtml(opts.narrative) + '</textarea>' +
            '<h3 style="margin-top:1rem;">QuickFile Status</h3>' +
            invoiceStatusHtml +
            '<h3 style="margin-top:1rem;">Review Confirmation</h3>' +
            '<div class="billing-checklist">' +
              '<label class="billing-check-item"><input type="checkbox" id="billing-check-attendance"> Attendance note reviewed</label>' +
              '<label class="billing-check-item"><input type="checkbox" id="billing-check-docs"> Generated documents reviewed</label>' +
              '<label class="billing-check-item"><input type="checkbox" id="billing-check-billing"> Billing details confirmed</label>' +
            '</div>' +
            auditHtml +
          '</div>' +

        '</div>' +

        '<div class="billing-panel-footer billing-panel-footer--flow">' +
          '<button type="button" id="billing-create-invoice" class="btn btn-primary btn-billing-create" disabled>' +
            (opts.hasExistingInvoice ? '&#9888; Send Another Invoice to QuickFile' : 'Send Bill to QuickFile') +
          '</button>' +
          '<button type="button" id="billing-cancel" class="btn btn-secondary">Close</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', html);
  _bindBillingEvents(recordId, opts);
}

function _bindBillingEvents(recordId, opts) {
  var overlay = document.getElementById('billing-panel-overlay');
  if (!overlay) return;

  overlay.querySelector('.billing-panel-close').addEventListener('click', closeBillingPanel);
  document.getElementById('billing-cancel').addEventListener('click', closeBillingPanel);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeBillingPanel(); });

  function onKeyDown(e) {
    if (e.key === 'Escape') closeBillingPanel();
  }
  document.addEventListener('keydown', onKeyDown);
  overlay._billingEscHandler = onKeyDown;

  overlay.querySelectorAll('.billing-calc-input').forEach(function (inp) {
    inp.addEventListener('input', _recalcBillingTotals);
  });

  var checkboxes = overlay.querySelectorAll('.billing-checklist input[type="checkbox"]');
  var createBtn = document.getElementById('billing-create-invoice');
  function updateCreateBtn() {
    var allChecked = true;
    checkboxes.forEach(function (cb) { if (!cb.checked) allChecked = false; });
    createBtn.disabled = !allChecked;
  }
  checkboxes.forEach(function (cb) { cb.addEventListener('change', updateCreateBtn); });

  createBtn.addEventListener('click', function () {
    _handleCreateInvoice(recordId, opts);
  });

  overlay.querySelectorAll('.billing-doc-preview').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var docType = btn.getAttribute('data-doc-type');
      _previewDocument(docType);
    });
  });

  overlay.querySelectorAll('.billing-attach-preview').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var docType = btn.getAttribute('data-attach-type');
      _previewDocument(docType);
    });
  });

  overlay.querySelectorAll('.billing-invoice-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var url = link.getAttribute('data-url');
      if (url && window.api && window.api.openExternal) window.api.openExternal(url);
    });
  });

}

function _recalcBillingTotals() {
  var fee = parseFloat(document.getElementById('billing-attendance-fee').value) || 0;
  var miles = parseFloat(document.getElementById('billing-mileage-miles').value) || 0;
  var rate = parseFloat(document.getElementById('billing-mileage-rate').value) || 0;
  var parking = parseFloat(document.getElementById('billing-parking').value) || 0;
  var vatPct = parseFloat(document.getElementById('billing-vat-rate').value) || 0;
  var totals = (typeof calculateInvoiceTotals === 'function')
    ? calculateInvoiceTotals({
        fixedFee: fee, mileageMiles: miles, mileageRate: rate,
        parkingAmount: parking, vatRate: vatPct / 100,
      })
    : { subTotal: 0, vatTotal: 0, grandTotal: 0 };

  var subEl = document.getElementById('billing-subtotal');
  var vatEl = document.getElementById('billing-vat');
  var totEl = document.getElementById('billing-total');
  if (subEl) subEl.textContent = _fmtCurrency(totals.subTotal);
  if (vatEl) vatEl.textContent = _fmtCurrency(totals.vatTotal);
  if (totEl) totEl.textContent = _fmtCurrency(totals.grandTotal);
}

var _invoiceInFlight = false;
async function _handleCreateInvoice(recordId, opts) {
  if (_invoiceInFlight) return;
  if (!recordId) {
    showToast('Save the record first before creating an invoice', 'error');
    return;
  }
  if (!window.api || !window.api.quickfileCreateInvoice || !window.api.getSettings) {
    showToast('Invoice API is not available in this environment', 'error');
    return;
  }

  var fee = parseFloat(document.getElementById('billing-attendance-fee').value) || 0;
  var miles = parseFloat(document.getElementById('billing-mileage-miles').value) || 0;
  var rate = parseFloat(document.getElementById('billing-mileage-rate').value) || 0;
  var parking = parseFloat(document.getElementById('billing-parking').value) || 0;
  var vatPct = parseFloat(document.getElementById('billing-vat-rate').value) || 0;
  var vatRate = vatPct / 100;
  var narrative = document.getElementById('billing-narrative').value.trim();

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
    var confirmed = await showConfirm('This record already has an invoice (' + (opts.invoiceStatus.quickfile_invoice_number || 'unknown') + ').\n\nAre you sure you want to create another invoice?');
    if (!confirmed) return;
    allowDuplicate = true;
  }

  if (!opts.firmName) {
    showToast('Select the instructing firm on the record (Case Reference & Arrival) before creating an invoice.', 'error', 6500);
    return;
  }

  _invoiceInFlight = true;
  var createBtn = document.getElementById('billing-create-invoice');
  if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'Creating invoice...'; }

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

  var dataForAttach = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
  var attachTitle = (typeof buildAttachmentTitle === 'function')
    ? buildAttachmentTitle({ clientName: opts.clientName, stationName: opts.stationName, attendanceDate: opts.attendanceDate, firmName: opts.firmName })
    : '';
  var attachName = (attachTitle || ([dataForAttach.surname, dataForAttach.forename].filter(Boolean).join('_') || 'attendance') + '-note') + '.pdf';
  attachName = attachName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 240);

  window.api.getSettings().then(function (settings) {
    var builder = (typeof getActivePdfBuilder === 'function') ? getActivePdfBuilder() : (typeof buildPdfHtml === 'function' ? buildPdfHtml : null);
    var attachHtml = builder ? builder(dataForAttach, settings || {}) : '';
    return window.api.quickfileCreateInvoice({
      attendanceId: recordId,
      firmName: opts.firmName,
      contactEmail: firmEmail,
      clientName: opts.clientName || '',
      stationName: opts.stationName || '',
      attendanceFee: fee,
      mileageMiles: miles,
      mileageRate: rate,
      parkingAmount: parking,
      vatRate: vatRate,
      narrative: narrative,
      invoiceDate: opts.attendanceDate || new Date().toISOString().slice(0, 10),
      userName: userName,
      billingInvoiceNumber: billingInv,
      attachAttendanceHtml: attachHtml || undefined,
      attachPdfFileName: attachName,
      allowDuplicate: allowDuplicate,
    });
  }).then(function (result) {
    _invoiceInFlight = false;
    if (result.ok) {
      if (typeof formData === 'object' && formData) {
        formData.quickfile_invoice_id = result.invoiceId || '';
        formData.quickfileInvoiceNumber = result.invoiceNumber || '';
        formData.quickfileInvoiceUrl = result.invoiceUrl || '';
      }
      if (typeof updateBillingReadinessPanel === 'function') updateBillingReadinessPanel();
      if (typeof updateContextBar === 'function') updateContextBar();
      if (typeof refreshQuickFileInvoiceRefDisplay === 'function') refreshQuickFileInvoiceRefDisplay();
      closeBillingPanel();
      _showInvoiceSuccessModal(result, opts);
    } else {
      var failMsg = (typeof formatLegacyBillingCreateFailureToast === 'function')
        ? formatLegacyBillingCreateFailureToast(result.error, result.code)
        : ('Invoice creation failed: ' + (result.error || 'Unknown error'));
      showToast(failMsg, 'error');
      if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Send Bill to QuickFile'; }
    }
  }).catch(function (err) {
    _invoiceInFlight = false;
    showToast('Invoice creation failed: ' + (err.message || String(err)), 'error');
    if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Send Bill to QuickFile'; }
  });
}

function _previewDocument(docType) {
  if (typeof ensureAllSectionsRendered === 'function') ensureAllSectionsRendered();
  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});

  if (window.api && window.api.billingAuditLogAdd && window.currentAttendanceId) {
    window.api.billingAuditLogAdd({
      attendanceId: window.currentAttendanceId,
      action: 'document_previewed',
      details: docType,
      userName: (window._appSettingsCache || {}).feeEarnerNameDefault || '',
    });
  }

  if (docType === 'crm1' || docType === 'crm2' || docType === 'crm3' ||
      docType === 'declaration' || docType === 'declaration_attach') {
    if (typeof closeBillingPanel === 'function') closeBillingPanel();
    var ft = docType === 'declaration_attach' ? 'declaration' : docType;
    if (typeof window.openLaaForm === 'function') {
      window.openLaaForm(ft, data);
    } else {
      if (typeof showToast === 'function') showToast('LAA form preview is not available', 'error');
    }
    return;
  }

  if (docType === 'crm14') {
    window.api.getSettings().then(function (settings) {
      var lf = window.laaForms;
      if (lf && typeof lf.buildCRM14Summary === 'function') {
        var html = lf.buildCRM14Summary(data, settings || {});
        if (typeof window.openHtmlPreviewWindow === 'function') window.openHtmlPreviewWindow(html);
        else if (html && typeof printGeneratedDoc === 'function') printGeneratedDoc(html);
      } else if (typeof showToast === 'function') {
        showToast('CRM14 preview is not available', 'error');
      }
    });
    return;
  }

  if (docType === 'crm15') {
    var crm15Html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>CRM15</title>' +
      '<style>body{font-family:Segoe UI,Arial,sans-serif;padding:1.5rem;max-width:40rem;line-height:1.45;color:#0f172a}' +
      'h1{font-size:1.1rem;border-bottom:2px solid #1d70b8;padding-bottom:0.35rem}' +
      '</style></head><body>' +
      '<h1>CRM15 — Means / financial statement</h1>' +
      '<p>If means assessment requires it, attach the official <strong>CRM15</strong> or the financial section produced by the <strong>Apply for criminal legal aid</strong> service.</p>' +
      '<p>This app does not generate CRM15. Obtain the client-signed form from the portal or use the LAA paper pack, then attach it to this record.</p>' +
      '</body></html>';
    if (typeof window.openHtmlPreviewWindow === 'function') window.openHtmlPreviewWindow(crm15Html);
    return;
  }

  window.api.getSettings().then(function (settings) {
    var html = '';
    if (docType === 'attendance') {
      var builder = (typeof getActivePdfBuilder === 'function') ? getActivePdfBuilder() : (typeof buildPdfHtml === 'function' ? buildPdfHtml : null);
      if (builder) html = builder(data, settings);
    } else if (docType === 'email' || docType === 'disclosure') {
      var builderFallback = (typeof getActivePdfBuilder === 'function') ? getActivePdfBuilder() : null;
      if (builderFallback) html = builderFallback(data, settings);
    }
    if (html && typeof window.openHtmlPreviewWindow === 'function') {
      window.openHtmlPreviewWindow(html);
    } else if (html && typeof printGeneratedDoc === 'function') {
      printGeneratedDoc(html);
    }
  });
}

function _showInvoiceSuccessModal(result, opts) {
  var existing = document.getElementById('billing-success-overlay');
  if (existing) existing.remove();

  var hasAttachWarning = !result.attachmentOk && result.attachmentError;
  var icon = hasAttachWarning ? '&#9888;' : '&#10003;';
  var title = hasAttachWarning ? 'Invoice created, but attachment failed' : 'Invoice successfully created';
  var iconClass = hasAttachWarning ? 'billing-success-icon--warn' : 'billing-success-icon--ok';
  var totalDisplay = (result.total != null && result.total !== '') ? _fmtCurrency(result.total) : '\u2014';

  var bodyRows =
    '<div class="billing-success-detail"><span class="billing-label">Invoice</span><span class="billing-value">' + _escHtml(result.invoiceNumber || result.invoiceId || '') + '</span></div>' +
    '<div class="billing-success-detail"><span class="billing-label">Firm</span><span class="billing-value">' + _escHtml(opts.firmName || '') + '</span></div>' +
    '<div class="billing-success-detail"><span class="billing-label">Total</span><span class="billing-value">' + totalDisplay + '</span></div>' +
    '<div class="billing-success-detail"><span class="billing-label">Attachment</span><span class="billing-value">' +
      (result.attachmentOk ? '&#10003; PDF uploaded' :
        (result.attachmentError ?
          '<span class="billing-attach-error">&#10007; Failed</span>' +
          '<span class="billing-attach-error-detail" title="' + _escHtml(result.attachmentError) + '">' +
            _escHtml(String(result.attachmentError).length > 120 ? String(result.attachmentError).slice(0, 120) + '...' : result.attachmentError) +
          '</span>' :
          'No attachment sent')) +
    '</span></div>';

  var html =
    '<div id="billing-success-overlay" class="billing-overlay" role="dialog" aria-modal="true" aria-label="Invoice result">' +
      '<div class="billing-success-panel">' +
        '<div class="billing-success-icon ' + iconClass + '">' + icon + '</div>' +
        '<h2 class="billing-success-title">' + title + '</h2>' +
        '<div class="billing-success-details">' + bodyRows + '</div>' +
        '<div class="billing-success-actions">' +
          (result.invoiceUrl ? '<button type="button" id="billing-success-view" class="btn btn-primary">View Invoice</button>' : '') +
          '<button type="button" id="billing-success-another" class="btn btn-secondary">Create Another</button>' +
          '<button type="button" id="billing-success-close" class="btn btn-secondary">Close</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', html);

  var overlay = document.getElementById('billing-success-overlay');
  var viewBtn = document.getElementById('billing-success-view');
  var anotherBtn = document.getElementById('billing-success-another');
  var closeBtn = document.getElementById('billing-success-close');

  function dismiss() {
    document.removeEventListener('keydown', onEsc);
    if (overlay) overlay.remove();
  }
  function onEsc(e) { if (e.key === 'Escape') dismiss(); }
  document.addEventListener('keydown', onEsc);

  if (viewBtn && result.invoiceUrl) {
    viewBtn.addEventListener('click', function () {
      if (window.api && window.api.openExternal) window.api.openExternal(result.invoiceUrl);
    });
  }
  if (anotherBtn) {
    anotherBtn.addEventListener('click', function () {
      dismiss();
      setTimeout(function () { openBillingPanel(); }, 100);
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', dismiss);
  if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });
}

function closeBillingPanel() {
  _billingPanelOpen = false;
  var successOverlay = document.getElementById('billing-success-overlay');
  if (successOverlay) successOverlay.remove();
  var overlay = document.getElementById('billing-panel-overlay');
  if (overlay) {
    if (overlay._billingEscHandler) document.removeEventListener('keydown', overlay._billingEscHandler);
    overlay.remove();
  }
}

/* ═══════════════════════════════════════════════════════
   COMPLETION SCREEN (Workflow Step 3)
   Review summary, then Archive or Close (billing/office completion saved on archive if needed).
   Depends: workflow-stepper.js, documents-screen.js (_wfGetAttachments),
            app.js globals (formData, currentRecordStatus, currentAttendanceId,
            getFormData, showConfirm, showToast, quietSave, hasQuickFileSettingsConfigured,
            currentRecordArchived)
   ═══════════════════════════════════════════════════════ */

function _wfCompletionNoteFinalised() {
  var st = typeof currentRecordStatus !== 'undefined' ? currentRecordStatus : null;
  return st === 'finalised' || st === 'completed';
}

function _wfCompletionHasInvoice(data) {
  var d = data || {};
  return !!(
    (d.quickfile_invoice_id && String(d.quickfile_invoice_id).trim()) ||
    (d.quickfileInvoiceNumber && String(d.quickfileInvoiceNumber).trim()) ||
    (d.quickfileInvoiceUrl && String(d.quickfileInvoiceUrl).trim())
  );
}

function _wfCompletionAttachmentsMeta(data) {
  var att = (typeof _wfGetAttachments === 'function') ? _wfGetAttachments(data || {}) : [];
  var allNamed = !att.length || att.every(function (a) {
    if (!a.documentType) return false;
    if (a.documentType === 'other' && !(String(a.customDocumentType || '').trim())) return false;
    return true;
  });
  return { count: att.length, allNamed: allNamed, list: att };
}

function _wfRenderCompletionStep(body, footer) {
  body.innerHTML = '<div class="wf-loading">Loading completion checklist&hellip;</div>';
  footer.innerHTML = '';

  var qfPromise = (typeof QuickfileConfigured !== 'undefined' && QuickfileConfigured.fetchQuickFileConfigured)
    ? QuickfileConfigured.fetchQuickFileConfigured()
    : Promise.resolve((typeof hasQuickFileSettingsConfigured === 'function') && hasQuickFileSettingsConfigured());

  qfPromise.then(function (qfOn) {
    _wfRenderCompletionStepBody(body, footer, !!qfOn);
  }).catch(function () {
    _wfRenderCompletionStepBody(body, footer, false);
  });
}

function _wfRenderCompletionStepBody(body, footer, qfOn) {
  var meta = _wfMatterMeta();
  var d = meta.data || {};
  var noteOk = _wfCompletionNoteFinalised();
  var invOk = _wfCompletionHasInvoice(d);
  var am = _wfCompletionAttachmentsMeta(d);
  var archived = typeof currentRecordArchived !== 'undefined' && currentRecordArchived;

  var hardWarnings = (typeof getBillingHardWarnings === 'function') ? getBillingHardWarnings() : [];
  var billingDataOk = hardWarnings.length === 0;

  var rows = [
    { key: 'note', label: 'Attendance note finalised', ok: noteOk, hint: !noteOk ? 'Finalise the note on the form first.' : '' },
    { key: 'data', label: 'Billing data complete', ok: billingDataOk, hint: !billingDataOk ? 'Missing: ' + hardWarnings.join(', ') + '.' : 'All required billing fields are present.' },
  ];
  if (qfOn) {
    rows.push({ key: 'inv', label: 'QuickFile invoice linked', ok: invOk, hint: !invOk ? 'Create the invoice in the Billing review step (or use complete without invoice there).' : '' });
  }
  rows.push(
    { key: 'att', label: 'Attachments named on file', ok: am.count === 0 || am.allNamed, hint: am.count && !am.allNamed ? 'Name every attachment (document type) on step 1 or the form.' : (am.count === 0 ? 'No attachments on this record \u2014 confirm if that is correct for this matter.' : '') }
  );

  var strip = '<div class="wf-completion-strip">';
  rows.forEach(function (r) {
    strip += '<div class="wf-completion-row ' + (r.ok ? 'wf-completion-row--ok' : 'wf-completion-row--pending') + '">' +
      '<span class="wf-completion-icon">' + (r.ok ? '&#10003;' : '&#9711;') + '</span>' +
      '<span class="wf-completion-label">' + _wfEsc(r.label) + '</span>' +
      (r.hint ? '<span class="wf-completion-hint">' + _wfEsc(r.hint) + '</span>' : '') +
      '</div>';
  });
  strip += '</div>';

  var billingSummaryHtml = _wfBuildBillingSummaryCard(d);

  var completionGuideHtml =
    '<div class="wf-action-guide"><h4 class="wf-action-guide-title">What to do on this step</h4><ol class="wf-action-guide-list">' +
    '<li class="wf-action-guide-item">Review the checklist and billing summary below.</li>' +
    '<li class="wf-action-guide-item">Click <strong>Archive</strong> to file this matter away (billing and office completion are recorded automatically if not already saved). Click <strong>Close</strong> to leave without archiving.</li>' +
    '</ol></div>';

  body.innerHTML =
    '<div class="wf-screen wf-completion">' +
      '<div class="wf-screen-header">' +
        '<h3>Step 3 &mdash; Review &amp; archive</h3>' +
        '<p class="wf-screen-sub">Check billing details and attachments, then archive the file or close to return later.</p>' +
      '</div>' +
      completionGuideHtml +
      '<div class="wf-card">' +
        '<h4 class="wf-card-title">Progress</h4>' +
        strip +
      '</div>' +
      billingSummaryHtml +
      '<div class="wf-card wf-completion-save-note">' +
        '<p class="settings-hint" style="margin:0;">You can close this window anytime \u2014 your place is remembered. Draft changes still autosave until the note is finalised.</p>' +
      '</div>' +
    '</div>';

  _wfBuildCompletionFooter(footer, {
    noteOk: noteOk,
    canArchive: noteOk && !archived,
  });
}

function _wfBuildCompletionFooter(footer, ctx) {
  /* Final step: ONE primary forward action (Archive & close), Export PDF
   * as a secondary side-action, Back to revisit step 2. The duplicate
   * "Close" button was removed \u2014 if Archive isn't ready (note not yet
   * finalised) Back is the way out. */
  var canArchive = ctx.canArchive;

  var html =
    '<button type="button" id="wf-complete-back" class="btn btn-secondary btn-small">&#9664; Back</button>' +
    '<button type="button" id="wf-export-billing-pdf" class="btn btn-secondary btn-small">Export PDF</button>' +
    '<span class="wf-footer-spacer"></span>';

  if (canArchive) {
    html += '<button type="button" id="wf-complete-archive" class="btn btn-primary wf-btn-next-action">Archive &amp; close</button>';
  } else {
    html += '<button type="button" class="btn btn-secondary btn-small" disabled title="Finalise the note before archiving">Archive &amp; close (locked)</button>';
  }

  footer.innerHTML = html;

  document.getElementById('wf-complete-back').addEventListener('click', _wfGoBack);
  var exportBillingBtn = document.getElementById('wf-export-billing-pdf');
  if (exportBillingBtn) {
    exportBillingBtn.addEventListener('click', function () {
      if (typeof window.exportBillingSummaryPdf === 'function') window.exportBillingSummaryPdf();
      else showToast('Billing summary export not available', 'error');
    });
  }

  var archBtn = document.getElementById('wf-complete-archive');
  if (archBtn) {
    archBtn.addEventListener('click', function () {
      _wfRunArchiveFromWorkflow();
    });
  }
}

function _wfRunArchiveFromWorkflow() {
  if (!currentAttendanceId) return;
  if (!_wfCompletionNoteFinalised()) {
    showToast('Finalise the attendance note before archiving.', 'error');
    return;
  }
  if (!window.api || !window.api.attendanceSave || !window.api.attendanceArchive) {
    showToast('Save or archive is not available.', 'error');
    return;
  }

  /* QuickFile guard: if QuickFile is configured but no invoice has been sent
     yet, the user almost certainly forgot. Offer a clear 3-way choice so the
     bill is never silently archived without ever reaching QuickFile.        */
  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
  var alreadyArchived = typeof currentRecordArchived !== 'undefined' && currentRecordArchived;
  var qfCheck = (typeof QuickfileConfigured !== 'undefined' && QuickfileConfigured.fetchQuickFileConfigured)
    ? QuickfileConfigured.fetchQuickFileConfigured()
    : Promise.resolve((typeof hasQuickFileSettingsConfigured === 'function') && hasQuickFileSettingsConfigured());

  qfCheck.then(function (qfConfigured) {
    _wfRunArchiveFromWorkflowImpl(data, !!qfConfigured, alreadyArchived);
  });
}

function _wfRunArchiveFromWorkflowImpl(data, qfConfigured, alreadyArchived) {
  var hasInvoice = _wfCompletionHasInvoice(data);

  if (qfConfigured && !hasInvoice && !alreadyArchived && typeof showChoice === 'function') {
    showChoice(
      'This bill has NOT been sent to QuickFile yet.\n\nDo you want to send it to QuickFile before archiving, or archive without sending?',
      'Send bill to QuickFile?',
      [
        { id: 'send',    label: 'Send Bill to QuickFile first (recommended)', variant: 'primary' },
        { id: 'archive', label: 'Archive without sending to QuickFile',       variant: 'secondary' },
        { id: 'cancel',  label: 'Cancel',                                     variant: 'secondary' },
      ]
    ).then(function (choice) {
      if (choice === 'send') {
        if (typeof _wfGoToStep === 'function') {
          _wfGoToStep(1); /* Step 2 (zero-indexed = 1): Billing review */
          showToast('Tick the 3 review boxes, then click Send Bill to QuickFile.', 'info', 6000);
        } else {
          showToast('Open the Billing review step to send to QuickFile.', 'info', 6000);
        }
        return;
      }
      if (choice === 'archive') {
        _wfArchiveConfirmedAndProceed();
      }
      /* cancel or null: do nothing */
    });
    return;
  }

  showConfirm(
    'Archive this matter? Billing and office completion will be recorded if not already saved, then the file moves to Archived.',
    'Archive record'
  ).then(function (ok) {
    if (!ok) return;
    _wfArchiveConfirmedAndProceed();
  });
}

function _wfArchiveConfirmedAndProceed() {
  if (!currentAttendanceId) return;
  if (!window.api || !window.api.attendanceSave || !window.api.attendanceArchive) {
    showToast('Save or archive is not available.', 'error');
    return;
  }
  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
  var iso = new Date().toISOString();
  if (!data.billingProcessCompletedAt) {
    data.billingProcessCompletedAt = iso;
    if (typeof formData === 'object' && formData) formData.billingProcessCompletedAt = iso;
  }
  if (!data.officeWorkCompletedAt) {
    data.officeWorkCompletedAt = iso;
    if (typeof formData === 'object' && formData) formData.officeWorkCompletedAt = iso;
  }
  window.api.attendanceSave({ id: currentAttendanceId, data: data, status: 'completed' }).then(function (result) {
    if (result && typeof result === 'object' && result.error) {
      showToast(result.message || result.error || 'Save failed', 'error', 7000);
      return Promise.reject(new Error('save'));
    }
    if (typeof currentRecordStatus !== 'undefined') currentRecordStatus = 'completed';
    return window.api.attendanceArchive(currentAttendanceId);
  }).then(function () {
    if (typeof closeWorkflow === 'function') closeWorkflow();
    showToast('Record archived', 'info');
    if (typeof setListFilterAndShowList === 'function') setListFilterAndShowList('archived');
    if (typeof updateFormBarVisibility === 'function') updateFormBarVisibility();
    if (typeof updateBillingReadinessPanel === 'function') updateBillingReadinessPanel();
    if (typeof updateFormContextPanel === 'function') updateFormContextPanel();
  }).catch(function (err) {
    if (err && err.message === 'save') return;
    showToast('Failed to archive record', 'error');
  });
}
window._wfRunArchiveFromWorkflow = _wfRunArchiveFromWorkflow;
window._wfArchiveConfirmedAndProceed = _wfArchiveConfirmedAndProceed;

function _wfAfterInvoiceCreatedGoToCompletion() {
  if (typeof _wfGoToStep !== 'function') return;
  /* Invoice success skips _wfGoNext, so capture billing fields before leaving step 2 */
  if (typeof window._wfCaptureBillingSnapshotIfPresent === 'function') {
    window._wfCaptureBillingSnapshotIfPresent();
  }
  _wfGoToStep(2);
}

function _wfBuildBillingSummaryCard(d) {
  if (!d) return '';
  var totals = (typeof resolveWorkflowBillingTotals === 'function') ? resolveWorkflowBillingTotals() : null;
  if (!totals && typeof calculateInvoiceTotals === 'function') {
    totals = calculateInvoiceTotals({ fixedFee: 0, mileageMiles: 0, mileageRate: 0.45, parkingAmount: 0, vatRate: 0.2 });
  }
  if (!totals) return '';

  function fmtCurr(v) { return '\u00A3' + (v || 0).toFixed(2); }
  var vatPct = (totals.vatRate != null) ? (Math.round(totals.vatRate * 1000) / 10) : 20;
  if (Math.abs(vatPct - Math.round(vatPct)) < 0.01) vatPct = Math.round(vatPct);

  var line1 = (typeof buildLine1Description === 'function')
    ? buildLine1Description({
        clientName: [d.forename, d.surname].filter(Boolean).join(' '),
        policeStation: d.policeStationName,
        attendanceDate: d.date,
      })
    : 'Police station attendance';

  var rowHtml = [];
  if (totals.fixedFee > 0) {
    rowHtml.push('<tr><td>' + _wfEsc(line1) + '</td><td style="text-align:right;">' + fmtCurr(totals.fixedFee) + '</td></tr>');
  }
  if (totals.mileageAmount > 0) {
    var mlab = 'Mileage';
    if (totals.mileageMiles > 0) {
      mlab += ' (' + totals.mileageMiles + ' mi \u00D7 ' + fmtCurr(totals.mileageRate) + ' /mi)';
    }
    rowHtml.push('<tr><td>' + mlab + '</td><td style="text-align:right;">' + fmtCurr(totals.mileageAmount) + '</td></tr>');
  }
  if (totals.parkingAmount > 0) {
    rowHtml.push('<tr><td>Parking / disbursements</td><td style="text-align:right;">' + fmtCurr(totals.parkingAmount) + '</td></tr>');
  }
  if (rowHtml.length === 0) {
    rowHtml.push('<tr><td colspan="2" style="color:var(--on-surface-muted,#64748b);">No charge lines \u2014 set fees in Step 2 (Billing review).</td></tr>');
  }

  return '<div class="wf-card">' +
    '<h4 class="wf-card-title">Billing summary (this matter)</h4>' +
    '<p style="margin:0 0 0.5rem;font-size:0.88rem;color:var(--on-surface-muted,#64748b);">Same line items and totals as the billing review / QuickFile preview in Step 2, not LAA notional time rates from Section 9.</p>' +
    '<table class="wf-billing-summary-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
    '<thead><tr style="border-bottom:2px solid var(--border-color,#e2e8f0);"><th style="text-align:left;">Item</th><th style="text-align:right;">Amount</th></tr></thead><tbody>' +
    rowHtml.join('') +
    '<tr style="border-top:1px solid var(--border-color,#e2e8f0);font-weight:600;"><td>Subtotal (ex VAT)</td><td style="text-align:right;">' + fmtCurr(totals.subTotal) + '</td></tr>' +
    '<tr><td>VAT (' + vatPct + '%)</td><td style="text-align:right;">' + fmtCurr(totals.vatTotal) + '</td></tr>' +
    '<tr style="font-weight:700;border-top:2px solid var(--border-color,#e2e8f0);font-size:1rem;"><td>Total (inc. VAT)</td><td style="text-align:right;">' + fmtCurr(totals.grandTotal) + '</td></tr>' +
    '</tbody></table></div>';
}

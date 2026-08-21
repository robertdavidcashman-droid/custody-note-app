/* ═══════════════════════════════════════════════════════
   BILLING CALCULATION UTILITIES
   Invoice total calculations, QuickFile payload builder,
   and billing status helpers.
   ═══════════════════════════════════════════════════════ */

var BILLING_DEFAULTS = {
  fixedFee: 160.00,
  mileageRate: 0.45,
  vatRate: 0.20,
};

var INVOICE_STATUSES = {
  DRAFT: 'draft',
  INVOICE_READY: 'invoice_ready',
  INVOICED: 'invoiced',
  SENT: 'sent',
  FAILED: 'failed',
  PAID: 'paid',
  ARCHIVED: 'archived',
};

var INVOICE_STATUS_LABELS = {
  draft: 'Draft',
  invoice_ready: 'Ready to bill',
  invoiced: 'Invoiced',
  sent: 'Sent to QuickFile',
  failed: 'Send failed',
  paid: 'Paid',
  archived: 'Archived',
};

function calculateInvoiceTotals(opts) {
  var fixedFee = parseFloat(opts.fixedFee);
  if (!Number.isFinite(fixedFee) || fixedFee < 0) fixedFee = 0;
  var mileageMiles = parseFloat(opts.mileageMiles);
  if (!Number.isFinite(mileageMiles) || mileageMiles < 0) mileageMiles = 0;
  var mileageRate = parseFloat(opts.mileageRate);
  if (!Number.isFinite(mileageRate)) mileageRate = BILLING_DEFAULTS.mileageRate;
  var vatRate = parseFloat(opts.vatRate);
  if (!Number.isFinite(vatRate)) vatRate = BILLING_DEFAULTS.vatRate;

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

function buildQuickFileLineItems(record, totals) {
  var lines = [];
  var line1Desc = (typeof buildLine1Description === 'function')
    ? buildLine1Description(record)
    : 'Police Station Attendance Fixed Fee';

  if (totals.fixedFee > 0) {
    lines.push({
      description: line1Desc,
      unitCost: totals.fixedFee,
      qty: 1,
      vatRate: totals.vatRate,
    });
  }
  if (totals.mileageAmount > 0) {
    lines.push({
      description: 'Mileage',
      unitCost: totals.mileageAmount,
      qty: 1,
      vatRate: totals.vatRate,
    });
  }
  if (totals.parkingAmount > 0) {
    lines.push({
      description: 'Parking',
      unitCost: totals.parkingAmount,
      qty: 1,
      vatRate: totals.vatRate,
    });
  }
  return lines;
}

function buildQuickFilePayload(record) {
  var invoiceTitle = (typeof formatInvoiceTitle === 'function')
    ? formatInvoiceTitle(record.clientName, record.policeStation || record.stationName)
    : (record.clientName || '') + ' - ' + (record.policeStation || record.stationName || '');

  var totals = calculateInvoiceTotals({
    fixedFee: record.fixedFee != null ? record.fixedFee : (record.attendanceFee != null ? record.attendanceFee : BILLING_DEFAULTS.fixedFee),
    mileageMiles: record.mileageMiles,
    mileageRate: record.mileageRate != null ? record.mileageRate : BILLING_DEFAULTS.mileageRate,
    parkingAmount: record.parkingAmount,
    vatRate: record.vatRate != null ? record.vatRate : BILLING_DEFAULTS.vatRate,
  });

  var lineItems = buildQuickFileLineItems(record, totals);

  var linkedAttachments = [];
  if (record.attachments && Array.isArray(record.attachments)) {
    linkedAttachments = record.attachments.map(function (att) {
      return {
        originalName: att.originalName || att.name || '',
        formattedName: att.formattedName || att.storedName || '',
        documentType: att.documentType || '',
      };
    });
  }

  return {
    invoiceTitle: invoiceTitle,
    clientName: record.clientName || '',
    policeStation: record.policeStation || record.stationName || '',
    attendanceDate: record.attendanceDate || record.date || '',
    issueDate: record.invoiceDate || new Date().toISOString().slice(0, 10),
    firmName: record.firmName || '',
    lineItems: lineItems,
    linkedAttachments: linkedAttachments,
    totals: totals,
  };
}

function getInvoiceStatusLabel(status) {
  return INVOICE_STATUS_LABELS[status] || 'Draft';
}

function getInvoiceStatusClass(status) {
  switch (status) {
    case 'invoiced': return 'wf-status--invoiced';
    case 'sent': return 'wf-status--sent';
    case 'paid': return 'wf-status--paid';
    case 'failed': return 'wf-status--failed';
    case 'archived': return 'wf-status--archived';
    case 'invoice_ready': return 'wf-status--ready';
    default: return 'wf-status--draft';
  }
}

function isAlreadyInvoicedError(reason, code) {
  if (code === 'ALREADY_INVOICED') return true;
  return /already has invoice/i.test(String(reason || ''));
}

function formatBillingCreateFailureToast(reason, code) {
  if (isAlreadyInvoicedError(reason, code)) {
    return 'This record already has an invoice. Click Continue to Review & complete to move on.';
  }
  var msg = String(reason || 'Unknown error');
  var looksLikeConnection = /not configured|auth|credential|401|403|HTTP 5\d\d|timeout|ENOTFOUND|ECONN|network|parse error|empty response/i.test(msg);
  if (looksLikeConnection) {
    return 'Send to QuickFile failed: ' + msg + '. Check Settings \u2192 QuickFile and click "Test QuickFile connection", then press Send again.';
  }
  return 'Send to QuickFile failed: ' + msg + '. Nothing was sent \u2014 fix the issue above and press "Send Bill to QuickFile" again.';
}

function formatLegacyBillingCreateFailureToast(reason, code) {
  if (isAlreadyInvoicedError(reason, code)) {
    return 'This record already has an invoice. Use Continue to Review & complete in the Finish matter workflow to proceed.';
  }
  return 'Invoice creation failed: ' + String(reason || 'Unknown error');
}

if (typeof window !== 'undefined') {
  window.isAlreadyInvoicedError = isAlreadyInvoicedError;
  window.formatBillingCreateFailureToast = formatBillingCreateFailureToast;
  window.formatLegacyBillingCreateFailureToast = formatLegacyBillingCreateFailureToast;
}

/**
 * Same totals as Step 2 (QuickFile preview): priority (1) snapshot from when
 * the user left the billing step, (2) live wf-* inputs if still on that step,
 * (3) _billingDefaults + form miles/parking. Does not use LAA notional time rates.
 */
function resolveWorkflowBillingTotals() {
  var d = (typeof getFormData === 'function') ? getFormData() : ((typeof window !== 'undefined' && window.formData) || {});
  var B = (typeof BILLING_DEFAULTS !== 'undefined') ? BILLING_DEFAULTS : { fixedFee: 160, mileageRate: 0.45, vatRate: 0.2 };
  if (typeof window !== 'undefined' && window._wfBillingSnapshot && window._wfBillingSnapshot.fixedFee != null) {
    var s = window._wfBillingSnapshot;
    return calculateInvoiceTotals({
      fixedFee: s.fixedFee,
      mileageMiles: s.mileageMiles,
      mileageRate: s.mileageRate,
      parkingAmount: s.parkingAmount,
      vatRate: s.vatRate,
    });
  }
  if (typeof document !== 'undefined') {
    var feeEl = document.getElementById('wf-fee');
    if (feeEl) {
      var vatRaw = parseFloat((document.getElementById('wf-vat') || {}).value);
      if (!Number.isFinite(vatRaw) || vatRaw < 0) vatRaw = 20;
      return calculateInvoiceTotals({
        fixedFee: parseFloat(feeEl.value) || 0,
        mileageMiles: parseFloat((document.getElementById('wf-miles') || {}).value) || 0,
        mileageRate: parseFloat((document.getElementById('wf-rate') || {}).value) || B.mileageRate,
        parkingAmount: parseFloat((document.getElementById('wf-parking') || {}).value) || 0,
        vatRate: vatRaw / 100,
      });
    }
  }
  var billingSettings = (typeof window !== 'undefined' && window._billingDefaults) ? window._billingDefaults : {};
  var fee = billingSettings.attendanceFee != null ? billingSettings.attendanceFee : B.fixedFee;
  var mileageRate = billingSettings.mileageRate != null ? billingSettings.mileageRate : B.mileageRate;
  var vatRate = billingSettings.vatRate != null ? billingSettings.vatRate : B.vatRate;
  if (typeof vatRate === 'number' && vatRate > 1) vatRate = vatRate / 100;
  return calculateInvoiceTotals({
    fixedFee: fee,
    mileageMiles: parseFloat(d.milesClaimable) || 0,
    mileageRate: mileageRate,
    parkingAmount: parseFloat(d.parkingCost) || 0,
    vatRate: vatRate,
  });
}
if (typeof window !== 'undefined') window.resolveWorkflowBillingTotals = resolveWorkflowBillingTotals;

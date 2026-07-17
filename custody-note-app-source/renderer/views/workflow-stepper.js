/* ═══════════════════════════════════════════════════════
   END-OF-MATTER WORKFLOW
   3-step flow: Documents & attachments → QuickFile invoice → Review & complete
   Depends: filenameUtils.js, billingUtils.js, billing.js globals,
            documents-screen.js, billing-screen.js, completion-screen.js,
            app.js globals (getFormData, currentAttendanceId, formData, stations, firms)
   ═══════════════════════════════════════════════════════ */

var _workflowOpen = false;
var _workflowStep = 0;
var _workflowOnClose = null;
/* mode = 'overlay' (legacy modal launched by openWorkflow / e2e tests)
 *      | 'inline'  (mounted inside the new full-page Billing screen)
 * Inline mode skips the modal chrome (no backdrop, no Esc handler, no
 * top-right close button) because the host screen owns the page header. */
var _workflowMode = 'overlay';
var _workflowInlineContainer = null;

var _workflowSteps = [
  { id: 'documents', label: 'Documents &amp; attachments', icon: '&#128196;' },
  { id: 'invoice',   label: 'Billing review', icon: '&#163;' },
  { id: 'complete',  label: 'Review &amp; complete', icon: '&#10003;' },
];

function _wfWFStepKey() {
  var rid = window.currentAttendanceId;
  return rid != null && rid !== '' ? 'cn_wf_step_' + String(rid) : null;
}

function _wfReadStoredStep() {
  var k = _wfWFStepKey();
  if (!k) return 0;
  try {
    var v = sessionStorage.getItem(k);
    var n = v != null ? parseInt(v, 10) : 0;
    if (!Number.isFinite(n) || n < 0) return 0;
    if (n > _workflowSteps.length - 1) return _workflowSteps.length - 1;
    return n;
  } catch (e) {
    return 0;
  }
}

function _wfPersistStep() {
  var k = _wfWFStepKey();
  if (!k) return;
  try {
    sessionStorage.setItem(k, String(_workflowStep));
  } catch (e) {}
}

function _wfResolveFirmDisplayName(data) {
  var d = data || {};
  var firmName = (d.firmName || '').trim();
  var fid = d.firmId != null && d.firmId !== '' ? String(d.firmId) : '';
  var firmList = typeof firms !== 'undefined' && firms && firms.length ? firms : (typeof window !== 'undefined' && window.firms ? window.firms : []);
  if (!firmName && fid && firmList && firmList.length) {
    var match = firmList.find(function (f) { return String(f.id) === fid; });
    if (match && match.name) firmName = String(match.name).trim();
  }
  if (!firmName && fid && typeof document !== 'undefined') {
    var form = document.getElementById('attendance-form');
    var hid = form && form.querySelector('[data-field="firmId"]');
    if (hid && String(hid.value || '') === fid && firmList && firmList.length) {
      var m2 = firmList.find(function (f) { return String(f.id) === fid; });
      if (m2 && m2.name) firmName = String(m2.name).trim();
    }
  }
  if (!firmName && typeof document !== 'undefined') {
    var strong = document.querySelector('.form-firm-selected strong');
    if (strong && strong.textContent) firmName = String(strong.textContent).trim();
  }
  return firmName;
}

function _wfMatterMeta() {
  var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
  var clientName = [data.forename, data.surname].filter(Boolean).join(' ') || '';
  var firmName = _wfResolveFirmDisplayName(data);
  var stationName = data.policeStationName || '';
  var attendanceDate = data.date || data.instructionDateTime || '';
  if (attendanceDate && attendanceDate.length > 10) attendanceDate = attendanceDate.slice(0, 10);
  var recordId = window.currentAttendanceId || null;
  return {
    clientName: clientName,
    firmName: firmName,
    stationName: stationName,
    attendanceDate: attendanceDate,
    offenceSummary: data.offenceSummary || data.offence1Details || '',
    recordId: recordId,
    data: data,
  };
}

function _wfEsc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _wfFmtDate(val) {
  if (!val) return '';
  var m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : val;
}

function _wfBuildStepper() {
  var html = '<nav class="wf-stepper" aria-label="Workflow steps">';
  for (var i = 0; i < _workflowSteps.length; i++) {
    var step = _workflowSteps[i];
    var cls = 'wf-step';
    if (i < _workflowStep) cls += ' wf-step--done';
    if (i === _workflowStep) cls += ' wf-step--active';
    html += '<button type="button" class="' + cls + '" data-wf-idx="' + i + '">' +
      '<span class="wf-step-num">' + (i < _workflowStep ? '&#10003;' : (i + 1)) + '</span>' +
      '<span class="wf-step-label">' + step.label + '</span>' +
    '</button>';
    if (i < _workflowSteps.length - 1) html += '<span class="wf-step-arrow">&#8594;</span>';
  }
  html += '</nav>';
  return html;
}

function _wfBuildSummaryStrip(meta, statusHtml) {
  return '<div class="wf-summary-strip">' +
    '<div class="wf-summary-item"><span class="wf-summary-label">Client</span><span class="wf-summary-value">' + _wfEsc(meta.clientName) + '</span></div>' +
    '<div class="wf-summary-item"><span class="wf-summary-label">Station</span><span class="wf-summary-value">' + _wfEsc(meta.stationName) + '</span></div>' +
    '<div class="wf-summary-item"><span class="wf-summary-label">Date</span><span class="wf-summary-value">' + _wfEsc(_wfFmtDate(meta.attendanceDate)) + '</span></div>' +
    '<div class="wf-summary-item"><span class="wf-summary-label">Firm</span><span class="wf-summary-value">' + _wfEsc(meta.firmName) + '</span></div>' +
    (statusHtml ? '<div class="wf-summary-item">' + statusHtml + '</div>' : '') +
  '</div>';
}

/** @param {number|undefined} startStep Omit or pass NaN to resume last step for this record (sessionStorage). */
function openWorkflow(startStep, onClose) {
  if (_workflowOpen) return;
  if (typeof getFormData === 'function') getFormData();
  _workflowOpen = true;
  _workflowMode = 'overlay';
  _workflowInlineContainer = null;
  if (typeof startStep === 'number' && Number.isFinite(startStep)) {
    _workflowStep = Math.max(0, Math.min(_workflowSteps.length - 1, startStep));
  } else {
    _workflowStep = _wfReadStoredStep();
  }
  _workflowOnClose = onClose || null;

  _wfGeneratedDocs = {};
  _wfSelectedDocs = {};
  if (typeof window !== 'undefined') window._wfBillingSnapshot = null;

  var existing = document.getElementById('workflow-overlay');
  if (existing) existing.remove();

  _renderWorkflowShell();
}

/* Inline mount used by the dedicated #view-matter-billing screen so the
 * 3-step finish-matter flow lives on a real page instead of a modal.
 * Container ownership is the caller's: closeWorkflow() will clear it. */
function mountWorkflowInline(container, startStep, onClose) {
  if (!container) return;
  if (typeof getFormData === 'function') getFormData();
  _workflowOpen = true;
  _workflowMode = 'inline';
  _workflowInlineContainer = container;
  if (typeof startStep === 'number' && Number.isFinite(startStep)) {
    _workflowStep = Math.max(0, Math.min(_workflowSteps.length - 1, startStep));
  } else {
    _workflowStep = _wfReadStoredStep();
  }
  _workflowOnClose = onClose || null;

  _wfGeneratedDocs = {};
  _wfSelectedDocs = {};
  if (typeof window !== 'undefined') window._wfBillingSnapshot = null;

  var existing = document.getElementById('workflow-overlay');
  if (existing) existing.remove();

  _renderWorkflowShell();
}
/* Expose for app.js / test harnesses; guarded so that source files can be
 * evaluated under Node (e.g. tests using `new Function(src)` to extract
 * helpers like _wfEsc) where `window` is not defined. */
if (typeof window !== 'undefined') { window.mountWorkflowInline = mountWorkflowInline; }

function _renderWorkflowShell() {
  var existing = document.getElementById('workflow-overlay');
  if (existing) existing.remove();

  var meta = _wfMatterMeta();
  var inline = _workflowMode === 'inline' && _workflowInlineContainer;
  var headerHtml = inline
    ? ''
    : '<div class="wf-panel-header">' +
        '<h2 class="wf-panel-title">Finish this matter</h2>' +
        '<button type="button" class="wf-panel-close" aria-label="Close">&times;</button>' +
      '</div>';
  var wrapperOpen = inline
    ? '<div id="workflow-overlay" class="wf-inline" aria-label="Billing workflow">'
    : '<div id="workflow-overlay" class="wf-overlay" role="dialog" aria-modal="true" aria-label="Finish this matter">';
  var html =
    wrapperOpen +
      '<div class="wf-panel">' +
        headerHtml +
        _wfBuildStepper() +
        _wfBuildSummaryStrip(meta, '') +
        '<div id="wf-body" class="wf-body"></div>' +
        '<div id="wf-footer" class="wf-footer"></div>' +
      '</div>' +
    '</div>';

  if (inline) {
    _workflowInlineContainer.innerHTML = html;
  } else {
    document.body.insertAdjacentHTML('beforeend', html);
  }
  _wfBindShellEvents();
  _wfPersistStep();
  _wfRenderCurrentStep();
}

function _wfBindShellEvents() {
  var overlay = document.getElementById('workflow-overlay');
  if (!overlay) return;
  /* Inline mode: no close button, no Esc handler, no backdrop click —
   * the host #view-matter-billing screen owns navigation. */
  if (_workflowMode !== 'inline') {
    var closeBtn = overlay.querySelector('.wf-panel-close');
    if (closeBtn) closeBtn.addEventListener('click', closeWorkflow);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeWorkflow(); });
    function onEsc(e) { if (e.key === 'Escape') closeWorkflow(); }
    document.addEventListener('keydown', onEsc);
    overlay._wfEscHandler = onEsc;
  }

  overlay.querySelectorAll('.wf-step').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var idx = parseInt(btn.getAttribute('data-wf-idx'), 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < _workflowSteps.length) {
        _workflowStep = idx;
        _wfUpdateStepper();
        _wfPersistStep();
        _wfRenderCurrentStep();
      }
    });
  });
}

function _wfUpdateStepper() {
  var overlay = document.getElementById('workflow-overlay');
  if (!overlay) return;
  overlay.querySelectorAll('.wf-step').forEach(function (btn, i) {
    btn.classList.toggle('wf-step--done', i < _workflowStep);
    btn.classList.toggle('wf-step--active', i === _workflowStep);
    var numEl = btn.querySelector('.wf-step-num');
    if (numEl) numEl.innerHTML = i < _workflowStep ? '&#10003;' : String(i + 1);
  });
}

function _wfRenderCurrentStep() {
  var body = document.getElementById('wf-body');
  var footer = document.getElementById('wf-footer');
  if (!body || !footer) return;

  switch (_workflowSteps[_workflowStep].id) {
    case 'documents': _wfRenderDocumentsStep(body, footer); break;
    case 'invoice':   _wfRenderBillingStep(body, footer); break;
    case 'complete':  _wfRenderCompletionStep(body, footer); break;
  }
}

function _wfGoNext() {
  if (_workflowStep < _workflowSteps.length - 1) {
    if (_workflowSteps[_workflowStep].id === 'invoice' && typeof window._wfCaptureBillingSnapshotIfPresent === 'function') {
      window._wfCaptureBillingSnapshotIfPresent();
    }
    _workflowStep++;
    _wfUpdateStepper();
    _wfPersistStep();
    _wfRenderCurrentStep();
  }
}

function _wfGoBack() {
  if (_workflowStep > 0) {
    _workflowStep--;
    _wfUpdateStepper();
    _wfPersistStep();
    _wfRenderCurrentStep();
  }
}

function _wfGoToStep(idx) {
  if (!Number.isFinite(idx)) return;
  _workflowStep = Math.max(0, Math.min(_workflowSteps.length - 1, idx));
  _wfUpdateStepper();
  _wfPersistStep();
  _wfRenderCurrentStep();
}

function closeWorkflow() {
  _wfPersistStep();
  _workflowOpen = false;
  var wasInline = _workflowMode === 'inline';
  var inlineContainer = _workflowInlineContainer;
  _workflowMode = 'overlay';
  _workflowInlineContainer = null;
  var overlay = document.getElementById('workflow-overlay');
  if (overlay) {
    if (overlay._wfEscHandler) document.removeEventListener('keydown', overlay._wfEscHandler);
    overlay.remove();
  }
  /* Inline host owns the page chrome; clear the stage so a re-mount
   * starts from the placeholder rather than a stale workflow. */
  if (wasInline && inlineContainer) {
    inlineContainer.innerHTML = '';
  }
  if (typeof _workflowOnClose === 'function') {
    var cb = _workflowOnClose;
    _workflowOnClose = null;
    cb();
  }
}

/* ═══════════════════════════════════════════════════════
   DOCUMENTS SCREEN (Workflow Step 1)
   Upload, manage, auto-rename attachments, and generate
   in-app forms (CRM1-3, Conflict Cert, etc.).
   Rendered inside #wf-body by workflow-stepper.js.
   Depends on: filenameUtils.js, workflow-stepper.js globals,
               app.js globals (formData, quietSave, renderPhotoThumbs,
                               generateConflictCert, docStyles, esc)
   ═══════════════════════════════════════════════════════ */

var _wfGeneratedDocs = {};

var _wfGeneratableForms = [
  { id: 'attendance_note', label: 'Police Station Attendance Note', icon: '&#128221;', type: 'html', description: 'Full attendance note PDF' },
  { id: 'crm1',            label: 'CRM1 — Client Details',         icon: '&#128196;', type: 'laa',  description: 'Legal Aid Agency form' },
  { id: 'crm2',            label: 'CRM2 — Advice & Assistance',    icon: '&#128196;', type: 'laa',  description: 'Legal Aid Agency form' },
  { id: 'crm3',            label: 'CRM3 — Advocacy Assistance',    icon: '&#128196;', type: 'laa',  description: 'Legal Aid Agency form' },
  { id: 'declaration',     label: 'Applicant Declaration',         icon: '&#128196;', type: 'laa',  description: 'Legal Aid Agency form' },
  { id: 'conflict_cert',   label: 'Conflict Check Certificate',    icon: '&#128203;', type: 'html', description: 'Conflict of interest check' },
  { id: 'client_instructions', label: 'Client Instructions',       icon: '&#128203;', type: 'html', description: 'Confirmation of instructions' },
  { id: 'prepared_statement',  label: 'Prepared Statement',        icon: '&#128203;', type: 'html', description: 'Statement template' },
];

function _wfRenderDocumentsStep(body, footer) {
  var meta = _wfMatterMeta();
  var data = meta.data;
  var attachments = _wfGetAttachments(data);

  var hasGenDocs = Object.keys(_wfGeneratedDocs).length > 0;
  var hasAttachments = attachments.length > 0;
  var allNamed = !attachments.length || attachments.every(function (a) { return !!a.documentType; });

  var guideSteps = [];
  if (!hasGenDocs) {
    guideSteps.push({ num: 1, text: 'Generate at least the <strong>Attendance Note PDF</strong> below (click Generate).', done: false });
  } else {
    guideSteps.push({ num: 1, text: 'Attendance note and forms generated.', done: true });
  }
  if (hasAttachments && !allNamed) {
    guideSteps.push({ num: 2, text: 'Select a <strong>document type</strong> for every uploaded attachment.', done: false });
  } else if (hasAttachments) {
    guideSteps.push({ num: 2, text: 'All attachments named.', done: true });
  }
  guideSteps.push({ num: guideSteps.length + 1, text: 'Click <strong>Next: QuickFile invoice</strong> at the bottom when ready.', done: false });

  var guideHtml = '<div class="wf-action-guide"><h4 class="wf-action-guide-title">What to do on this step</h4><ol class="wf-action-guide-list">';
  guideSteps.forEach(function (s) {
    guideHtml += '<li class="wf-action-guide-item' + (s.done ? ' wf-action-guide-item--done' : '') + '">' + (s.done ? '&#10003; ' : '') + s.text + '</li>';
  });
  guideHtml += '</ol></div>';

  var html =
    '<div class="wf-screen wf-documents">' +
      '<div class="wf-screen-header">' +
        '<h3>Step 1 &mdash; Documents &amp; forms</h3>' +
        '<p class="wf-screen-sub">Generate LAA forms, upload files, and name attachments. When ready, continue to Step 2 to set the invoice amounts.</p>' +
      '</div>' +
      guideHtml +

      '<div class="wf-card wf-gen-forms-card">' +
        '<h4 class="wf-card-title">Generate Forms</h4>' +
        '<p class="wf-gen-forms-sub">Click to generate pre-populated PDFs from this attendance record. Generated documents will be available to attach to the invoice.</p>' +
        '<div class="wf-gen-grid">' +
        _wfBuildGeneratableGrid(meta) +
        '</div>' +
      '</div>' +

      '<div class="wf-card wf-upload-card">' +
        '<h4 class="wf-card-title">Upload Additional Files</h4>' +
        '<div class="wf-upload-area" id="wf-upload-dropzone">' +
          '<div class="wf-upload-icon">&#128196;</div>' +
          '<p class="wf-upload-text">Drag files here or click Add Files</p>' +
          '<button type="button" id="wf-add-files-btn" class="btn btn-primary">Add Files</button>' +
        '</div>' +
      '</div>' +

      '<div class="wf-card">' +
        '<h4 class="wf-card-title">Uploaded Attachments (' + attachments.length + ')</h4>' +
        _wfBuildAttachmentTable(attachments, meta) +
      '</div>' +

      _wfBuildValidationPanel(attachments, meta) +
    '</div>';

  body.innerHTML = html;
  _wfBuildDocFooter(footer);
  _wfBindDocEvents(meta);
}

function _wfBuildGeneratableGrid(meta) {
  var html = '';
  _wfGeneratableForms.forEach(function (form) {
    var generated = _wfGeneratedDocs[form.id];
    var statusCls = generated ? 'wf-gen-status--ready' : 'wf-gen-status--none';
    var statusText = generated ? 'Ready (' + _wfFmtFileSize(generated.size) + ')' : 'Not generated';
    var btnLabel = generated ? 'Regenerate' : 'Generate';

    html +=
      '<div class="wf-gen-item" data-form-id="' + form.id + '">' +
        '<div class="wf-gen-item-header">' +
          '<span class="wf-gen-icon">' + form.icon + '</span>' +
          '<div class="wf-gen-info">' +
            '<span class="wf-gen-label">' + _wfEsc(form.label) + '</span>' +
            '<span class="wf-gen-desc">' + _wfEsc(form.description) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="wf-gen-item-actions">' +
          '<span class="wf-gen-status ' + statusCls + '">' + statusText + '</span>' +
          '<button type="button" class="btn btn-small wf-gen-btn" data-form-id="' + form.id + '">' + btnLabel + '</button>' +
          (generated ? '<button type="button" class="btn btn-small btn-secondary wf-gen-preview-btn" data-form-id="' + form.id + '" title="Preview">&#128065;</button>' : '') +
          (generated ? '<button type="button" class="btn btn-small btn-secondary wf-gen-save-btn" data-form-id="' + form.id + '" title="Save to Desktop">&#128190;</button>' : '') +
          (generated ? '<button type="button" class="btn btn-small btn-secondary wf-gen-email-btn" data-form-id="' + form.id + '" title="Email">&#9993;</button>' : '') +
        '</div>' +
      '</div>';
  });
  return html;
}

function _wfFmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' KB';
}

function _wfGetAttachments(data) {
  var attachments = [];
  if (data && data.photos && data.photos.attachments) {
    data.photos.attachments.forEach(function (att, i) {
      attachments.push({
        index: i,
        originalName: att.name || att.originalName || 'file_' + i,
        documentType: att.documentType || '',
        customDocumentType: att.customDocumentType || '',
        notes: att.notes || '',
        addedAt: att.addedAt || '',
        hasData: !!(att.dataUrl),
      });
    });
  }
  return attachments;
}

function _wfBuildAttachmentTable(attachments, meta) {
  if (!attachments.length) {
    return '<p class="wf-empty-state">No files uploaded yet. Use the upload area above or generate forms.</p>';
  }
  var html =
    '<div class="wf-table-wrap">' +
    '<table class="wf-table">' +
      '<thead><tr>' +
        '<th>Original file</th>' +
        '<th>Document type</th>' +
        '<th>Renamed preview</th>' +
        '<th>Actions</th>' +
      '</tr></thead><tbody>';

  attachments.forEach(function (att) {
    var typeOptions = '';
    DOCUMENT_TYPE_OPTIONS.forEach(function (opt) {
      var sel = opt.value === att.documentType ? ' selected' : '';
      typeOptions += '<option value="' + opt.value + '"' + sel + '>' + _wfEsc(opt.label) + '</option>';
    });
    if (!att.documentType) {
      typeOptions = '<option value="" selected>— Select —</option>' + typeOptions;
    }

    var renamed = '';
    if (att.documentType) {
      renamed = formatAttachmentFilename({
        clientName: meta.clientName,
        policeStation: meta.stationName,
        attendanceDate: meta.attendanceDate,
        documentType: att.documentType,
        customDocumentType: att.customDocumentType,
        firmName: meta.firmName,
        extension: _wfExtFromName(att.originalName),
      });
    }

    html += '<tr data-att-idx="' + att.index + '">' +
      '<td class="wf-att-original">' + _wfEsc(att.originalName) + '</td>' +
      '<td><select class="form-input wf-att-type" data-att-idx="' + att.index + '">' + typeOptions + '</select>' +
        (att.documentType === 'other' ? '<input type="text" class="form-input wf-att-custom-type" data-att-idx="' + att.index + '" placeholder="Custom type" value="' + _wfEsc(att.customDocumentType) + '">' : '') +
      '</td>' +
      '<td class="wf-att-renamed" data-att-idx="' + att.index + '">' +
        (renamed ? '<span class="wf-renamed-preview">' + _wfEsc(renamed) + '</span>' : '<span class="wf-no-rename">Select a type</span>') +
      '</td>' +
      '<td>' +
        '<button type="button" class="btn btn-small wf-att-remove" data-att-idx="' + att.index + '" title="Remove">&#10005;</button>' +
      '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function _wfExtFromName(name) {
  if (!name) return '.pdf';
  var dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '.pdf';
}

function _wfBuildValidationPanel(attachments, meta) {
  var warnings = [];
  if (!attachments.length && !Object.keys(_wfGeneratedDocs).length) {
    warnings.push({ type: 'info', msg: 'No documents prepared — generate forms or upload files before proceeding.' });
  }
  attachments.forEach(function (att) {
    if (!att.documentType) {
      warnings.push({ type: 'warn', msg: 'Attachment "' + att.originalName + '" has no document type selected.' });
    }
    if (att.documentType === 'other' && !att.customDocumentType) {
      warnings.push({ type: 'warn', msg: 'Attachment "' + att.originalName + '" is type "other" but has no custom label.' });
    }
  });

  var dupes = {};
  attachments.forEach(function (att) {
    if (att.documentType) {
      var key = att.documentType + (att.customDocumentType || '');
      dupes[key] = (dupes[key] || 0) + 1;
    }
  });
  Object.keys(dupes).forEach(function (key) {
    if (dupes[key] > 1) {
      warnings.push({ type: 'warn', msg: 'Duplicate document type: "' + key + '" appears ' + dupes[key] + ' times.' });
    }
  });

  if (!warnings.length) return '';

  var html = '<div class="wf-card wf-validation-panel">' +
    '<h4 class="wf-card-title">Validation</h4><ul class="wf-validation-list">';
  warnings.forEach(function (w) {
    var icon = w.type === 'warn' ? '&#9888;' : '&#8505;';
    html += '<li class="wf-validation-item wf-validation--' + w.type + '">' + icon + ' ' + _wfEsc(w.msg) + '</li>';
  });
  html += '</ul></div>';
  return html;
}

function _wfDocNoteFinalised() {
  var st = typeof currentRecordStatus !== 'undefined' ? currentRecordStatus : null;
  return st === 'finalised' || st === 'completed';
}

function _wfBuildDocFooter(footer) {
  var genCount = Object.keys(_wfGeneratedDocs).length;
  var countBadge = genCount > 0 ? ' <span class="wf-gen-count-badge">' + genCount + ' form' + (genCount > 1 ? 's' : '') + ' ready</span>' : '';
  /* Step 1 has ONE forward action: continue to step 2. Per-step Archive was
   * removed so the workflow is strictly linear (Documents \u2192 Invoice \u2192
   * Review/Archive). Users who want to archive without finishing can still
   * Close out and use the form header's "Archive matter" action. */
  footer.innerHTML =
    '<button type="button" id="wf-doc-back" class="btn btn-secondary btn-small">Close</button>' +
    '<span class="wf-footer-info">' + countBadge + '</span>' +
    '<span class="wf-footer-spacer"></span>' +
    '<button type="button" id="wf-doc-next" class="btn btn-primary wf-btn-next-action">Next: Invoice &#9654;</button>';

  document.getElementById('wf-doc-back').addEventListener('click', closeWorkflow);
  document.getElementById('wf-doc-next').addEventListener('click', _wfGoNext);
}

function _wfBindDocEvents(meta) {
  var addBtn = document.getElementById('wf-add-files-btn');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      var picker = (window.api && window.api.pickFile) ? window.api.pickFile : null;
      if (!picker) { showToast('File picker not available', 'error'); return; }
      picker().then(function (result) {
        if (!result || result.error) { if (result && result.error) showToast(result.error, 'error'); return; }
        var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
        if (!data.photos) data.photos = {};
        if (!data.photos.attachments) data.photos.attachments = [];
        if (data.photos.attachments.length >= 20) {
          showToast('Maximum 20 attachments per record', 'error');
          return;
        }
        data.photos.attachments.push({
          dataUrl: result.dataUrl,
          name: result.name,
          mime: result.mime,
          documentType: '',
          customDocumentType: '',
          notes: '',
          addedAt: new Date().toISOString(),
        });
        if (typeof quietSave === 'function') quietSave();
        _wfRenderCurrentStep();
      });
    });
  }

  var dropzone = document.getElementById('wf-upload-dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', function (e) { e.preventDefault(); dropzone.classList.add('wf-upload-drag'); });
    dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('wf-upload-drag'); });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('wf-upload-drag');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        showToast('Drop upload is not yet available — use the Add Files button.', 'info');
      }
    });
  }

  document.querySelectorAll('.wf-att-type').forEach(function (sel) {
    sel.addEventListener('change', function () {
      var idx = parseInt(sel.getAttribute('data-att-idx'), 10);
      var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
      if (data.photos && data.photos.attachments && data.photos.attachments[idx]) {
        data.photos.attachments[idx].documentType = sel.value;
        if (sel.value !== 'other') data.photos.attachments[idx].customDocumentType = '';
        if (typeof quietSave === 'function') quietSave();
        _wfRenderCurrentStep();
      }
    });
  });

  document.querySelectorAll('.wf-att-custom-type').forEach(function (inp) {
    inp.addEventListener('input', function () {
      var idx = parseInt(inp.getAttribute('data-att-idx'), 10);
      var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
      if (data.photos && data.photos.attachments && data.photos.attachments[idx]) {
        data.photos.attachments[idx].customDocumentType = inp.value;
        if (typeof quietSave === 'function') quietSave();
        var renamedEl = document.querySelector('.wf-att-renamed[data-att-idx="' + idx + '"]');
        if (renamedEl) {
          var renamed = formatAttachmentFilename({
            clientName: meta.clientName, policeStation: meta.stationName,
            attendanceDate: meta.attendanceDate, documentType: 'other',
            customDocumentType: inp.value, firmName: meta.firmName,
            extension: _wfExtFromName(data.photos.attachments[idx].name || ''),
          });
          renamedEl.innerHTML = '<span class="wf-renamed-preview">' + _wfEsc(renamed) + '</span>';
        }
      }
    });
  });

  document.querySelectorAll('.wf-att-remove').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var idx = parseInt(btn.getAttribute('data-att-idx'), 10);
      var data = (typeof getFormData === 'function') ? getFormData() : (window.formData || {});
      if (data.photos && data.photos.attachments) {
        data.photos.attachments.splice(idx, 1);
        if (typeof quietSave === 'function') quietSave();
        _wfRenderCurrentStep();
      }
    });
  });

  document.querySelectorAll('.wf-gen-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var formId = btn.getAttribute('data-form-id');
      _wfGenerateForm(formId, meta, btn);
    });
  });

  document.querySelectorAll('.wf-gen-preview-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var formId = btn.getAttribute('data-form-id');
      _wfPreviewGeneratedForm(formId);
    });
  });

  document.querySelectorAll('.wf-gen-save-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var formId = btn.getAttribute('data-form-id');
      _wfSaveFormToDesktop(formId);
    });
  });

  document.querySelectorAll('.wf-gen-email-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var formId = btn.getAttribute('data-form-id');
      _wfEmailForm(formId, meta);
    });
  });
}

function _wfGenerateForm(formId, meta, btn) {
  var form = _wfGeneratableForms.find(function (f) { return f.id === formId; });
  if (!form) return;

  var origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generating...';

  var runGenerate = function () {
    if (form.type === 'laa') {
      _wfGenerateLaaForm(formId, meta).then(function (result) {
        btn.disabled = false;
        btn.textContent = origText;
        if (result.error) {
          showToast('Failed to generate ' + form.label + ': ' + result.error, 'error');
        } else {
          if (result.fieldMisses && result.fieldMisses > 0) {
            var fieldList = (result.missedFields || []).slice(0, 5).join(', ');
            showToast(
              result.fieldMisses + ' field(s) on ' + form.label + ' could not be filled' +
              (fieldList ? ' (' + fieldList + ')' : '') + '. Check the PDF carefully.',
              'warning', 8000
            );
          }
          _wfGeneratedDocs[formId] = { base64: result.base64, size: result.size, label: form.label, filename: _wfFormFilename(formId, meta) };
          showToast(form.label + ' generated successfully', 'success');
          _wfRenderCurrentStep();
        }
      });
    } else if (form.type === 'html') {
      _wfGenerateHtmlForm(formId, meta).then(function (result) {
        btn.disabled = false;
        btn.textContent = origText;
        if (result.error) {
          showToast('Failed to generate ' + form.label + ': ' + result.error, 'error');
        } else {
          _wfGeneratedDocs[formId] = { base64: result.base64, size: result.size, label: form.label, filename: _wfFormFilename(formId, meta) };
          showToast(form.label + ' generated successfully', 'success');
          _wfRenderCurrentStep();
        }
      });
    }
  };

  if (formId === 'crm1' && typeof window.promptCrm1ValidationBeforeGenerate === 'function') {
    window.promptCrm1ValidationBeforeGenerate(meta.data || {}).then(function (ok) {
      if (ok) runGenerate();
      else { btn.disabled = false; btn.textContent = origText; }
    });
    return;
  }

  runGenerate();
}

function _wfGenerateLaaForm(formId, meta) {
  var data = meta.data || {};
  if (!window.api || !window.api.laaGeneratePdfBuffer) {
    return Promise.resolve({ error: 'PDF generation not available' });
  }
  var generate = function() {
    return window.api.laaGeneratePdfBuffer({ formType: formId, data: data });
  };
  if (window.api.laaEnsureTemplates) {
    return window.api.laaEnsureTemplates({}).then(function(res) {
      if (res && !res.ok) return { error: res.error || 'LAA templates unavailable' };
      return generate();
    });
  }
  return generate();
}

function _wfGenerateHtmlForm(formId, meta) {
  var data = meta.data || {};
  if (!window.api || !window.api.htmlToPdfBuffer) {
    return Promise.resolve({ error: 'PDF generation not available' });
  }

  var html = '';
  try {
    html = _wfBuildFormHtml(formId, data, meta);
  } catch (err) {
    return Promise.resolve({ error: err.message || 'Failed to build HTML' });
  }

  if (!html) return Promise.resolve({ error: 'No content generated for ' + formId });

  return window.api.htmlToPdfBuffer({ html: html });
}

function _wfBuildFormHtml(formId, data, meta) {
  var _esc = typeof esc === 'function' ? esc : _wfEsc;
  var _docStyles = typeof docStyles === 'function' ? docStyles : function () { return '<style>body{font-family:Arial,sans-serif;font-size:11pt;color:#111;margin:2cm}</style>'; };
  var _formatDateGB = typeof formatDateGB === 'function' ? formatDateGB : function (d) { return d || ''; };

  var client = [data.forename, data.middleName, data.surname].filter(Boolean).join(' ') || 'Client not yet named';
  var fee = data.feeEarnerName || data.laaFeeEarnerFullName || '';
  var offence = data.offenceSummary || data.offence1Details || '';
  var station = data.policeStationName || '';

  switch (formId) {
    case 'attendance_note': {
      var settings = window._appSettingsCache || {};
      var builder = null;
      if (typeof window !== 'undefined' && typeof window.getPdfBuilderForData === 'function') {
        builder = window.getPdfBuilderForData(data);
      } else if (typeof buildPdfHtml === 'function') {
        builder = buildPdfHtml;
      }
      if (!builder) return '';
      return builder(data, settings);
    }

    case 'conflict_cert': {
      var attendanceDateGb = _formatDateGB(data.date || '');
      var conflictCheckDateGb = _formatDateGB(data.conflictCheckDate || data.date || new Date().toISOString().slice(0, 10));
      var result = data.conflictCheckResult || '(not yet recorded)';
      var notes = data.conflictCheckNotes || 'None';
      var sigDateLine = attendanceDateGb || conflictCheckDateGb || '';
      var repSig = (typeof window.getEffectiveFeeEarnerSig === 'function') ? window.getEffectiveFeeEarnerSig(data) : (data.feeEarnerSig || '');
      var repSigHtml = repSig
        ? '<img class="sig-img-cert" src="' + repSig + '" alt="Fee earner signature" style="max-height:56px;max-width:320px;border:1px solid #333;padding:4px;display:block">'
        : '<div class="sig-box"></div>';
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Conflict Check Certificate</title>' + _docStyles() + '</head><body>' +
        '<h1>Conflict of Interest Check \u2013 Certificate</h1>' +
        '<table><tr><th>Field</th><th>Detail</th></tr>' +
        '<tr><td>Police station attendance date</td><td>' + _esc(attendanceDateGb || '(not recorded)') + '</td></tr>' +
        '<tr><td>Date of conflict check</td><td>' + _esc(conflictCheckDateGb) + '</td></tr>' +
        '<tr><td>Fee earner</td><td>' + _esc(fee) + '</td></tr>' +
        '<tr><td>Client</td><td>' + _esc(client) + '</td></tr>' +
        '<tr><td>Offence</td><td>' + _esc(offence) + '</td></tr>' +
        '<tr><td>Police station</td><td>' + _esc(station) + '</td></tr>' +
        '<tr><td>Result</td><td><strong>' + _esc(result) + '</strong></td></tr>' +
        '<tr><td>Notes</td><td>' + _esc(notes) + '</td></tr>' +
        '</table>' +
        '<p>I confirm that a conflict of interest check was carried out prior to advising the above-named client and that no conflict exists.</p>' +
        '<h2>Representative signature</h2>' + repSigHtml +
        '<p>Name: ' + _esc(fee) + '&nbsp;&nbsp;&nbsp;&nbsp; Date: ' + _esc(sigDateLine || '____________') + '</p>' +
        '<div class="footer">Generated: ' + new Date().toLocaleString('en-GB') + '</div>' +
        '</body></html>';
    }

    case 'client_instructions': {
      var ciDate = _formatDateGB(data.instructionsSignatureDate || data.date || new Date().toISOString().slice(0, 10));
      var ciTime = data.instructionsSignatureTime || '';
      var instructions = (String(data.clientInstructionsDetail || '').trim() || String(data.clientInstructions || '').trim() || '(no instructions recorded)');
      var adviceRe = data.adviceReInterview || '';
      var decision = data.clientDecision || '';
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Client Instructions</title>' + _docStyles() + '</head><body>' +
        '<h1>Confirmation of Client Instructions</h1>' +
        '<table><tr><th>Field</th><th>Detail</th></tr>' +
        '<tr><td>Date</td><td>' + _esc(ciDate) + '</td></tr>' +
        (ciTime ? '<tr><td>Time</td><td>' + _esc(ciTime) + '</td></tr>' : '') +
        '<tr><td>Client</td><td>' + _esc(client) + '</td></tr>' +
        '<tr><td>Offence</td><td>' + _esc(offence) + '</td></tr>' +
        '<tr><td>Police station</td><td>' + _esc(station) + '</td></tr>' +
        '</table>' +
        '<h2>Client\'s Instructions</h2>' +
        '<p style="white-space:pre-wrap;border:1px solid #ccc;padding:8px;min-height:80px">' + _esc(instructions) + '</p>' +
        (adviceRe ? '<h2>Advice Re Interview</h2><p>' + _esc(adviceRe) + '</p>' : '') +
        (decision ? '<p><strong>Client\'s decision:</strong> ' + _esc(decision) + '</p>' : '') +
        '<h2>Rep Signature</h2><div class="sig-box"></div>' +
        '<p>Name: ' + _esc(fee) + '</p>' +
        '<h2>Client Signature</h2><div class="sig-box"></div>' +
        '<p>Name (BLOCK CAPITALS): ______________________________</p>' +
        '<div class="footer">Generated: ' + new Date().toLocaleString('en-GB') + '</div>' +
        '</body></html>';
    }

    case 'prepared_statement': {
      var psDate = _formatDateGB(data.date || new Date().toISOString().slice(0, 10));
      var custodyNo = data.custodyNumber || '';
      var oicName = data.oicName || '';
      var _isVolAttendance = data.attendanceMode === 'voluntary' || data.voluntaryInterview === 'Yes';
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prepared Statement</title>' + _docStyles() + '</head><body>' +
        '<h1>Prepared Statement</h1>' +
        '<table><tr><th>Field</th><th>Detail</th></tr>' +
        '<tr><td>Name</td><td>' + _esc(client) + '</td></tr>' +
        '<tr><td>Date</td><td>' + _esc(psDate) + '</td></tr>' +
        (_isVolAttendance ? '<tr><td>Attendance type</td><td>Voluntary attendance</td></tr>' : '<tr><td>Custody No.</td><td>' + _esc(custodyNo) + '</td></tr>') +
        '<tr><td>Police station</td><td>' + _esc(station) + '</td></tr>' +
        (oicName ? '<tr><td>OIC</td><td>' + _esc(oicName) + '</td></tr>' : '') +
        '<tr><td>Alleged offence(s)</td><td>' + _esc(offence) + '</td></tr>' +
        '</table>' +
        '<h2>Statement</h2>' +
        '<p>I, <strong>' + _esc(client) + '</strong>, wish to make the following statement in advance of my police interview:</p>' +
        '<p style="border:1px solid #ccc;padding:8px;min-height:200px">&nbsp;</p>' +
        '<p>I reserve the right to give a fuller account at a later stage.</p>' +
        '<h2>Signature</h2><div class="sig-box"></div>' +
        '<p>Name: ' + _esc(client.toUpperCase()) + '</p>' +
        '<div class="footer">Generated: ' + new Date().toLocaleString('en-GB') + '</div>' +
        '</body></html>';
    }

    default:
      return '';
  }
}

function _wfFormFilename(formId, meta) {
  var clientSlug = [meta.clientName].filter(Boolean).join('_').replace(/\s+/g, '_') || 'client';
  var dateSlug = (meta.attendanceDate || '').replace(/-/g, '') || 'nodate';
  var names = {
    attendance_note: clientSlug + '_attendance_note_' + dateSlug + '.pdf',
    crm1: clientSlug + '_CRM1_' + dateSlug + '.pdf',
    crm2: clientSlug + '_CRM2_' + dateSlug + '.pdf',
    crm3: clientSlug + '_CRM3_' + dateSlug + '.pdf',
    declaration: clientSlug + '_applicant_declaration_' + dateSlug + '.pdf',
    conflict_cert: clientSlug + '_conflict_certificate_' + dateSlug + '.pdf',
    client_instructions: clientSlug + '_client_instructions_' + dateSlug + '.pdf',
    prepared_statement: clientSlug + '_prepared_statement_' + dateSlug + '.pdf',
  };
  return (names[formId] || formId + '.pdf').replace(/[<>:"/\\|?*]/g, '_');
}

function _wfPreviewGeneratedForm(formId) {
  var doc = _wfGeneratedDocs[formId];
  if (!doc || !doc.base64) { showToast('Generate the form first', 'info'); return; }

  if (window.api && window.api.previewPdfBase64) {
    window.api.previewPdfBase64({ base64: doc.base64, filename: doc.filename || formId + '.pdf' }).then(function (result) {
      if (result && result.error) showToast('Preview failed: ' + result.error, 'error');
    }).catch(function (err) {
      showToast('Preview error: ' + (err.message || err), 'error');
    });
  } else {
    showToast('PDF preview not available — update the app', 'info');
  }
}

function _wfSaveFormToDesktop(formId) {
  var doc = _wfGeneratedDocs[formId];
  if (!doc || !doc.base64) { showToast('Generate the form first', 'info'); return; }

  if (window.api && window.api.getDesktopPath) {
    window.api.getDesktopPath().then(function (desktop) {
      var filename = doc.filename || formId + '.pdf';
      if (window.api.previewPdfBase64) {
        window.api.previewPdfBase64({ base64: doc.base64, filename: filename }).then(function () {
          showToast(doc.label + ' saved and opened', 'success');
        });
      }
    });
  } else {
    showToast('Save not available', 'error');
  }
}

function _wfEmailForm(formId, meta) {
  var doc = _wfGeneratedDocs[formId];
  if (!doc || !doc.base64) { showToast('Generate the form first', 'info'); return; }

  var subject = (doc.label || formId) + ' — ' + (meta.clientName || 'Client');
  var body = 'Please find attached: ' + (doc.label || formId) + '\n\nClient: ' + (meta.clientName || '') + '\nStation: ' + (meta.stationName || '') + '\nDate: ' + (meta.attendanceDate || '');

  if (window.api && window.api.previewPdfBase64) {
    window.api.previewPdfBase64({ base64: doc.base64, filename: doc.filename || formId + '.pdf' }).then(function (result) {
      if (result && result.path) {
        var clip =
          'Subject: ' + subject + '\n\n' +
          body + '\n\n' +
          'Attach this file: ' + result.path;
        function copyOk() {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(clip);
          }
          try {
            var ta = document.createElement('textarea');
            ta.value = clip;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return Promise.resolve();
          } catch (_) {
            return Promise.reject(new Error('copy'));
          }
        }
        copyOk().then(function () {
          showToast(doc.label + ': subject, body and attachment path copied. Paste into Outlook and attach the file.', 'success', 7000);
        }).catch(function () {
          showToast(doc.label + ' saved to: ' + result.path + ' — attach manually in your mail client.', 'info', 8000);
        });
      }
    });
  } else {
    showToast('Save the form first using the save button, then attach to email manually.', 'info');
  }
}

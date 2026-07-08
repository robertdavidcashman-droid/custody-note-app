/* Officer Emails — right-hand context panel (v1.9). Depends on window.api.officerEmails, formData, currentAttendanceId, showToast, showConfirm, showChoice. */
(function (global) {
  'use strict';

  var TEMPLATE_OPTIONS = (typeof OFFICER_EMAIL_TEMPLATE_OPTIONS !== 'undefined')
    ? OFFICER_EMAIL_TEMPLATE_OPTIONS
    : [];

  var STATUS_LABELS = {
    draft: 'Draft',
    ready_for_outlook: 'Ready for Outlook',
    opened_in_outlook: 'Opened in Outlook',
    sent_manually: 'Sent manually',
    cancelled: 'Cancelled',
    deleted: 'Deleted',
  };

  var host = null;
  var selectedDraftId = null;
  var lastAttachedCustodyNoteId = null;
  var lastGenSig = '';
  var dirtySubjectBody = false;
  var autoGenerateTimer = null;
  var els = {};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getFormDataSafe() {
    try {
      return typeof formData !== 'undefined' && formData ? formData : {};
    } catch (_) {
      return {};
    }
  }

  function getCurrentAttendanceIdSafe() {
    try {
      return typeof currentAttendanceId !== 'undefined' ? currentAttendanceId : null;
    } catch (_) {
      return null;
    }
  }

  function buildShell() {
    if (!host) return;
    host.innerHTML =
      '<div class="form-panel-card-label">Officer Emails</div>' +
      '<p id="oep-locked" class="officer-email-panel-hint hidden">Save the custody note before creating email drafts.</p>' +
      '<div id="oep-main" class="officer-email-panel-inner">' +
      '<div class="officer-email-form">' +
      '<label class="officer-email-field"><span>Email type</span><select id="oep-template"></select></label>' +
      '<label class="officer-email-field"><span>Recipient email</span><input type="email" id="oep-to" autocomplete="off" spellcheck="false" /></label>' +
      '<label class="officer-email-field"><span>Recipient name</span><input type="text" id="oep-recipient" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Client name</span><input type="text" id="oep-client" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Police station</span><input type="text" id="oep-station" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Date</span><input type="text" id="oep-date" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Attendance time</span><input type="text" id="oep-time" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Offence / allegation</span><input type="text" id="oep-offence" autocomplete="off" /></label>' +
      '<div id="oep-bail-fields" class="officer-email-bail-fields hidden">' +
      '<label class="officer-email-field"><span>Bail return date</span><input type="text" id="oep-bail-date" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Bail conditions</span><textarea id="oep-bail-cond" rows="3"></textarea></label>' +
      '</div>' +
      '<label class="officer-email-field"><span>Extra note (optional)</span><textarea id="oep-extra" rows="2"></textarea></label>' +
      '<label class="officer-email-field"><span>My email address (optional)</span><input type="email" id="oep-user-email" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Subject</span><input type="text" id="oep-subject" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Email body</span><textarea id="oep-body" rows="10"></textarea></label>' +
      '</div>' +
      '<div class="officer-email-actions">' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-new">New draft</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-clear">Clear fields</button>' +
      '<button type="button" class="btn btn-primary btn-small" id="oep-gen">Generate / Refresh</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-save">Save draft</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-dup">Duplicate</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-cancel">Cancel draft</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-del">Delete</button>' +
      '</div>' +
      '<div class="officer-email-actions officer-email-actions-outlook">' +
      '<button type="button" class="btn btn-primary btn-small" id="oep-open">Open in Outlook Web</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-copy-link">Copy Outlook link</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-copy-to">Copy Recipient</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-copy-sub">Copy Subject</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-copy-body">Copy Body</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oep-sent">Mark as Sent Manually</button>' +
      '</div>' +
      '<p class="officer-email-panel-hint">If Outlook login or Authenticator causes the message not to appear, use the copy buttons.</p>' +
      '<div class="officer-email-drafts-head">Saved drafts for this custody note</div>' +
      '<div id="oep-drafts" class="officer-email-draft-list"></div>' +
      '</div>';

    var sel = host.querySelector('#oep-template');
    TEMPLATE_OPTIONS.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.dataset.oepLast = sel.value;

    els = {
      locked: host.querySelector('#oep-locked'),
      main: host.querySelector('#oep-main'),
      template: host.querySelector('#oep-template'),
      to: host.querySelector('#oep-to'),
      recipient: host.querySelector('#oep-recipient'),
      client: host.querySelector('#oep-client'),
      station: host.querySelector('#oep-station'),
      date: host.querySelector('#oep-date'),
      time: host.querySelector('#oep-time'),
      offence: host.querySelector('#oep-offence'),
      bailWrap: host.querySelector('#oep-bail-fields'),
      bailDate: host.querySelector('#oep-bail-date'),
      bailCond: host.querySelector('#oep-bail-cond'),
      extra: host.querySelector('#oep-extra'),
      userEmail: host.querySelector('#oep-user-email'),
      subject: host.querySelector('#oep-subject'),
      body: host.querySelector('#oep-body'),
      drafts: host.querySelector('#oep-drafts'),
    };

    els.template.addEventListener('change', onTemplateChange);
    ['subject', 'body'].forEach(function (id) {
      var el = els[id === 'subject' ? 'subject' : 'body'];
      if (!el) return;
      el.addEventListener('input', function () {
        dirtySubjectBody = true;
      });
    });
    ['recipient', 'client', 'station', 'date', 'time', 'offence', 'extra', 'userEmail', 'bailDate', 'bailCond'].forEach(function (key) {
      if (!els[key]) return;
      els[key].addEventListener('input', scheduleAutoGenerate);
    });

    host.querySelector('#oep-new').addEventListener('click', newDraft);
    host.querySelector('#oep-clear').addEventListener('click', clearForm);
    host.querySelector('#oep-gen').addEventListener('click', function () { generateFromTemplate(false); });
    host.querySelector('#oep-save').addEventListener('click', saveDraft);
    host.querySelector('#oep-dup').addEventListener('click', duplicateDraft);
    host.querySelector('#oep-cancel').addEventListener('click', cancelDraft);
    host.querySelector('#oep-del').addEventListener('click', deleteDraft);
    host.querySelector('#oep-open').addEventListener('click', openOutlookClicked);
    host.querySelector('#oep-copy-link').addEventListener('click', copyOutlookLinkClicked);
    host.querySelector('#oep-copy-to').addEventListener('click', function () { copyField(els.to.value, 'Copied.'); });
    host.querySelector('#oep-copy-sub').addEventListener('click', function () { copyField(els.subject.value, 'Copied.'); });
    host.querySelector('#oep-copy-body').addEventListener('click', function () { copyField(els.body.value, 'Copied.'); });
    host.querySelector('#oep-sent').addEventListener('click', markSentClicked);
  }

  function syncBailVisibility() {
    var tt = els.template && els.template.value;
    var show = tt === 'bail_details_request' || tt === 'chase_bail_details_follow_up';
    if (els.bailWrap) els.bailWrap.classList.toggle('hidden', !show);
  }

  function onTemplateChange() {
    var sel = els.template;
    var prev = sel && sel.dataset && sel.dataset.oepLast != null ? sel.dataset.oepLast : '';
    var next = sel ? sel.value : '';
    syncBailVisibility();
    if (!dirtySubjectBody) {
      generateFromTemplate(false);
      if (sel) sel.dataset.oepLast = next;
      return;
    }
    if (typeof window.showChoice !== 'function') {
      if (typeof showConfirm !== 'function') {
        generateFromTemplate(false);
        if (sel) sel.dataset.oepLast = next;
        return;
      }
      showConfirm(
        'Changing template may overwrite your edited subject and body. Continue?',
        'Change template'
      ).then(function (ok) {
        if (!ok) {
          if (sel) sel.value = prev || 'disclosure_confirm_attendance';
          syncBailVisibility();
          return;
        }
        generateFromTemplate(true);
        if (sel) sel.dataset.oepLast = sel.value;
      });
      return;
    }
    window.showChoice(
      'Changing template may overwrite your edited subject and body.',
      'Change template',
      [
        { id: 'keep', label: 'Keep current draft', variant: 'primary' },
        { id: 'apply', label: 'Apply new template', variant: 'secondary' },
      ]
    ).then(function (choice) {
      if (choice !== 'apply') {
        if (sel) sel.value = prev || 'disclosure_confirm_attendance';
        syncBailVisibility();
        return;
      }
      generateFromTemplate(true);
      if (sel) sel.dataset.oepLast = sel.value;
    });
  }

  function getSignOffNameSafe() {
    try {
      var s = (typeof window !== 'undefined' && window._appSettingsCache) ? window._appSettingsCache : {};
      return (s.feeEarnerNameDefault || s.feeEarnerName || '').trim();
    } catch (_) {
      return '';
    }
  }

  function collectFields() {
    return {
      templateType: els.template.value,
      toEmail: els.to.value,
      recipientName: els.recipient.value,
      clientName: els.client.value,
      policeStation: els.station.value,
      attendanceDate: els.date.value,
      attendanceTime: els.time ? els.time.value : '',
      offence: els.offence.value,
      extraNote: els.extra.value,
      bailReturnDate: els.bailDate ? els.bailDate.value : '',
      bailConditions: els.bailCond ? els.bailCond.value : '',
      userEmailAddress: els.userEmail.value,
      signOffName: getSignOffNameSafe(),
      subject: els.subject.value,
      body: els.body.value,
    };
  }

  function scheduleAutoGenerate() {
    if (dirtySubjectBody) return;
    if (autoGenerateTimer) clearTimeout(autoGenerateTimer);
    autoGenerateTimer = setTimeout(function () {
      autoGenerateTimer = null;
      generateFromTemplate(false);
    }, 120);
  }

  function applyPrefillFromMatter() {
    var fd = getFormDataSafe();
    var name = [fd.forename, fd.surname].filter(Boolean).join(' ').trim();
    if (!els.client.value.trim() && name) els.client.value = name;
    if (!els.station.value.trim() && fd.policeStationName) els.station.value = fd.policeStationName;
    if (!els.date.value.trim() && fd.date) els.date.value = fd.date;
    if (els.time && !els.time.value.trim()) {
      var arrivalTime = fd.timeArrival || fd.timeArrivalStation || '';
      if (arrivalTime) els.time.value = String(arrivalTime).trim();
    }
    if (!els.offence.value.trim() && fd.offenceSummary) els.offence.value = fd.offenceSummary;
    if (!els.recipient.value.trim() && fd.oicName) els.recipient.value = String(fd.oicName).trim();
    if (!els.to.value.trim()) {
      var oicEmail = (fd.oicEmail || '').trim();
      var disclosureEmail = (fd.disclosureOfficerEmail || '').trim();
      if (oicEmail) {
        els.to.value = oicEmail;
      } else if (fd.disclosureOfficerIsOIC === 'No' && disclosureEmail) {
        els.to.value = disclosureEmail;
      }
    }
  }

  function clearForm() {
    Object.keys(els).forEach(function (key) {
      if (!els[key] || !('value' in els[key])) return;
      if (key === 'template') return;
      els[key].value = '';
    });
    if (els.template) {
      els.template.value = 'disclosure_confirm_attendance';
      els.template.dataset.oepLast = els.template.value;
    }
    selectedDraftId = null;
    dirtySubjectBody = false;
    syncBailVisibility();
    applyPrefillFromMatter();
    generateFromTemplate(true);
    if (els.to) els.to.focus();
  }

  function generateFromTemplate(forceApply) {
    if (!window.api || !window.api.officerEmails || !window.api.officerEmails.buildPreview) {
      return Promise.resolve({ ok: false, error: 'Officer email preview is not available.' });
    }
    var f = collectFields();
    f.extraNote = f.extraNote;
    return window.api.officerEmails.buildPreview(f).then(function (res) {
      if (!res || !res.ok) {
        if (typeof showToast === 'function') showToast((res && res.error) || 'Could not build preview', 'error');
        return res || { ok: false, error: 'Could not build preview' };
      }
      if (forceApply || !dirtySubjectBody) {
        els.subject.value = res.subject || '';
        els.body.value = res.body || '';
        dirtySubjectBody = false;
        lastGenSig = (res.subject || '') + '\n' + (res.body || '');
      }
      return res;
    }).catch(function (err) {
      if (typeof showToast === 'function') showToast('Could not build preview. Please try Generate / Refresh.', 'error', 7000);
      try { console.error('[officerEmailsPanel] buildPreview failed', err); } catch (_) {}
      return { ok: false, error: (err && err.message) || String(err) };
    });
  }

  function newDraft() {
    selectedDraftId = null;
    els.to.value = '';
    els.recipient.value = '';
    els.extra.value = '';
    els.userEmail.value = '';
    els.bailDate.value = '';
    els.bailCond.value = '';
    dirtySubjectBody = false;
    applyPrefillFromMatter();
    generateFromTemplate(true);
  }

  function saveDraft(opts) {
    var options = opts || {};
    var aid = getCurrentAttendanceIdSafe();
    if (!aid) {
      if (typeof showToast === 'function') showToast('Please save the custody note before creating email drafts.', 'error');
      return Promise.resolve({ ok: false, errors: ['Save the custody note before creating email drafts.'] });
    }
    var payload = Object.assign({ custodyNoteId: String(aid) }, collectFields());
    var p = selectedDraftId
      ? window.api.officerEmails.updateDraft(selectedDraftId, payload)
      : window.api.officerEmails.createDraft(payload);
    return p.then(function (res) {
      if (!res || !res.ok) {
        if (typeof showToast === 'function') showToast((res && res.errors && res.errors[0]) || 'Draft could not be saved', 'error');
        return res || { ok: false, errors: ['Draft could not be saved'] };
      }
      selectedDraftId = res.draft && res.draft.id;
      if (!options.silent && typeof showToast === 'function') showToast('Draft saved', 'success');
      loadDrafts();
      return res;
    }).catch(function () {
      if (typeof showToast === 'function') showToast('Draft could not be saved. Please try again.', 'error');
      return { ok: false, errors: ['The draft could not be saved. Please try again.'] };
    });
  }

  function duplicateDraft() {
    if (!selectedDraftId) { saveDraft(); return; }
    window.api.officerEmails.duplicateDraft(selectedDraftId).then(function (res) {
      if (!res || !res.ok) {
        if (typeof showToast === 'function') showToast('Could not duplicate', 'error');
        return;
      }
      selectedDraftId = res.draft && res.draft.id;
      loadDraftIntoForm(res.draft);
      if (typeof showToast === 'function') showToast('Duplicate created', 'success');
      loadDrafts();
    });
  }

  function runCancelDraft(id) {
    window.api.officerEmails.cancelDraft(id).then(function (res) {
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast('Draft cancelled', 'info');
        if (selectedDraftId === id) newDraft();
        loadDrafts();
      }
    });
  }

  function cancelDraft() {
    if (!selectedDraftId) return;
    if (typeof window.showChoice === 'function') {
      window.showChoice('Cancel this draft?', 'Cancel draft', [
        { id: 'keep', label: 'Keep Draft', variant: 'primary' },
        { id: 'cancel', label: 'Cancel Draft', variant: 'danger' },
      ]).then(function (choice) {
        if (choice !== 'cancel') return;
        runCancelDraft(selectedDraftId);
      });
      return;
    }
    if (typeof showConfirm !== 'function') return;
    showConfirm('Cancel this draft?', 'Cancel draft').then(function (ok) {
      if (!ok) return;
      runCancelDraft(selectedDraftId);
    });
  }

  function runDeleteDraft(id) {
    window.api.officerEmails.deleteDraft(id).then(function (res) {
      if (res && res.ok) {
        if (typeof showToast === 'function') showToast('Draft deleted', 'info');
        if (selectedDraftId === id) newDraft();
        loadDrafts();
      }
    });
  }

  function deleteDraft() {
    if (!selectedDraftId) return;
    if (typeof window.showChoice === 'function') {
      window.showChoice('Are you sure you want to delete this draft?', 'Delete draft', [
        { id: 'abort', label: 'Cancel', variant: 'secondary' },
        { id: 'del', label: 'Delete Draft', variant: 'danger' },
      ]).then(function (choice) {
        if (choice !== 'del') return;
        runDeleteDraft(selectedDraftId);
      });
      return;
    }
    if (typeof showConfirm !== 'function') return;
    showConfirm('Are you sure you want to delete this draft?', 'Delete draft').then(function (ok) {
      if (!ok) return;
      runDeleteDraft(selectedDraftId);
    });
  }

  function markSentClicked() {
    if (!selectedDraftId) { if (typeof showToast === 'function') showToast('Save the draft first.', 'error'); return; }
    function doMark() {
      window.api.officerEmails.markSentManually(selectedDraftId).then(function (res) {
        if (res && res.ok) {
          if (typeof showToast === 'function') showToast('Marked as sent manually', 'success');
          loadDrafts();
        } else if (typeof showToast === 'function') {
          showToast((res && res.errors && res.errors[0]) || 'Invalid status', 'error');
        }
      });
    }
    if (typeof window.showChoice === 'function') {
      window.showChoice(
        'Only mark this as sent if you have sent it manually in Outlook Web.',
        'Mark as sent',
        [
          { id: 'keep', label: 'Keep as-is', variant: 'secondary' },
          { id: 'sent', label: 'Mark as sent manually', variant: 'primary' },
        ]
      ).then(function (choice) {
        if (choice !== 'sent') return;
        doMark();
      });
      return;
    }
    if (typeof showConfirm !== 'function') return;
    showConfirm(
      'Only mark this as sent if you have sent it manually in Outlook Web.',
      'Mark as sent'
    ).then(function (ok) {
      if (!ok) return;
      doMark();
    });
  }

  function openOutlookClicked() {
    if (!dirtySubjectBody) {
      generateFromTemplate(true).then(function (res) {
        if (res && res.ok) openOutlookClickedAfterPreview();
      });
      return;
    }
    openOutlookClickedAfterPreview();
  }

  function openOutlookClickedAfterPreview() {
    var to = els.to.value.trim();
    var sub = els.subject.value.trim();
    var bod = els.body.value.trim();
    if (!to) {
      if (typeof showToast === 'function') showToast('Please enter a recipient email address.', 'error', 5000);
      return;
    }
    if (!sub) {
      if (typeof showToast === 'function') showToast('Please enter a subject before opening Outlook.', 'error', 5000);
      return;
    }
    if (!bod) {
      if (typeof showToast === 'function') showToast('Please enter an email body before opening Outlook.', 'error', 5000);
      return;
    }
    var warnings = [];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) warnings.push('The recipient email address does not look valid. Please check it carefully.');
    else if (!isProfessionalDomain(to)) {
      warnings.push('Warning: this recipient does not appear to be a recognised police, court, CPS, government, NHS, solicitor or professional email address. Please check carefully before proceeding.');
    }
    var msg =
      'You are about to open this email in Outlook Web.\n\nTo:\n' + to + '\n\nSubject:\n' + sub + '\n\n' +
      (warnings.length ? warnings.join('\n\n') + '\n\n' : '') +
      'This app will not send the email. You must review and send it manually in Outlook Web.';
    function reportFatal(label, detail) {
      var fallback = 'Outlook Web could not be opened. The email content is still in the draft — try Copy Outlook link.';
      if (detail) fallback = fallback + ' (' + detail + ')';
      if (typeof showToast === 'function') showToast(fallback, 'error', 9000);
      else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(fallback);
      try { console.warn('[officerEmailsPanel] ' + label + ': showToast undefined, fell back to alert/no-op'); } catch (_) {}
    }
    function doOpen() {
      var promise;
      try {
        promise = window.api.officerEmails.openOutlookDraft(selectedDraftId);
      } catch (syncErr) {
        try { console.error('[officerEmailsPanel] openOutlookDraft threw synchronously', syncErr); } catch (_) {}
        reportFatal('openOutlookDraft sync throw', (syncErr && syncErr.message) || String(syncErr));
        return;
      }
      if (!promise || typeof promise.then !== 'function') {
        try { console.error('[officerEmailsPanel] openOutlookDraft returned non-promise', promise); } catch (_) {}
        reportFatal('openOutlookDraft returned non-promise', 'IPC bridge unavailable');
        return;
      }
      promise.then(function (res) {
        try { console.info('[officerEmailsPanel] openOutlookDraft resolved', res); } catch (_) {}
        if (!res || !res.ok) {
          var errMsg = (res && res.errors && res.errors[0]) || 'Outlook Web could not be opened. You can still copy the recipient, subject and body manually.';
          if (typeof showToast === 'function') showToast(errMsg, 'error', 7000);
          else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(errMsg);
          else try { console.warn('[officerEmailsPanel] openOutlookDraft not-ok with no toast/alert', res); } catch (_) {}
          return;
        }
        if (typeof showToast === 'function') {
          var openedMsg = 'Opened in browser — complete send in Outlook';
          if (res.truncated) {
            openedMsg =
              'Opened in browser. The message was long, so the full email was copied to your clipboard before opening Outlook — paste into the body if needed.';
          }
          showToast(openedMsg, 'success', res.truncated ? 9000 : 5000);
        } else {
          try { console.warn('[officerEmailsPanel] openOutlookDraft ok but showToast undefined'); } catch (_) {}
        }
        loadDrafts();
      }).catch(function (err) {
        try { console.error('[officerEmailsPanel] openOutlookDraft rejected', err); } catch (_) {}
        reportFatal('openOutlookDraft rejected', (err && err.message) || String(err));
      });
    }
    function afterConfirm() {
      doOpen();
    }
    saveDraft({ silent: true }).then(function (saved) {
      if (!saved || !saved.ok || !selectedDraftId) {
        try { console.warn('[officerEmailsPanel] openOutlook aborted: saveDraft state', { saved: saved, selectedDraftId: selectedDraftId }); } catch (_) {}
        if (saved && saved.ok && !selectedDraftId) {
          if (typeof showToast === 'function') showToast('Draft saved but no draft id was returned, so Outlook Web cannot open. Please reopen the panel and try again.', 'error', 9000);
          else reportFatal('saveDraft ok but selectedDraftId empty', 'no draft id returned');
        }
        return;
      }
      if (typeof window.showChoice === 'function') {
        window.showChoice(msg, 'Open Outlook Web', [
          { id: 'abort', label: 'Cancel', variant: 'secondary' },
          { id: 'open', label: 'Open Outlook Web', variant: 'primary' },
        ]).then(function (choice) {
          if (choice !== 'open') return;
          afterConfirm();
        }).catch(function (err) {
          try { console.error('[officerEmailsPanel] showChoice rejected', err); } catch (_) {}
          reportFatal('showChoice rejected', (err && err.message) || String(err));
        });
        return;
      }
      if (typeof showConfirm !== 'function') {
        try { console.warn('[officerEmailsPanel] showChoice and showConfirm both undefined; using window.confirm fallback'); } catch (_) {}
        var ok = false;
        try {
          ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
            ? window.confirm(msg)
            : true;
        } catch (_) { ok = true; }
        if (ok) afterConfirm();
        return;
      }
      showConfirm(msg, 'Open Outlook Web').then(function (ok) {
        if (!ok) return;
        afterConfirm();
      }).catch(function (err) {
        try { console.error('[officerEmailsPanel] showConfirm rejected', err); } catch (_) {}
        reportFatal('showConfirm rejected', (err && err.message) || String(err));
      });
    }).catch(function (err) {
      try { console.error('[officerEmailsPanel] saveDraft rejected before Outlook open', err); } catch (_) {}
      reportFatal('saveDraft rejected', (err && err.message) || String(err));
    });
  }

  function copyOutlookLinkClicked() {
    if (!dirtySubjectBody) {
      generateFromTemplate(true).then(function (res) {
        if (res && res.ok) copyOutlookLinkClickedAfterPreview();
      });
      return;
    }
    copyOutlookLinkClickedAfterPreview();
  }

  function copyOutlookLinkClickedAfterPreview() {
    var to = els.to.value.trim();
    var sub = els.subject.value.trim();
    var bod = els.body.value.trim();
    if (!to) {
      if (typeof showToast === 'function') showToast('Please enter a recipient email address.', 'error', 5000);
      return;
    }
    if (!sub) {
      if (typeof showToast === 'function') showToast('Please enter a subject before copying the link.', 'error', 5000);
      return;
    }
    if (!bod) {
      if (typeof showToast === 'function') showToast('Please enter an email body before copying the link.', 'error', 5000);
      return;
    }
    if (!selectedDraftId) {
      if (typeof showToast === 'function') showToast('Save the draft first.', 'error', 5000);
      return;
    }
    if (!window.api || !window.api.officerEmails || !window.api.officerEmails.getComposeUrl) {
      if (typeof showToast === 'function') showToast('Copy Outlook link is not available.', 'error');
      return;
    }
    function onCopied(truncated) {
      var msg = 'Outlook compose link copied to clipboard.';
      if (truncated) {
        msg +=
          ' The link is shortened for Windows URL limits; use Open in Outlook Web to copy the full message to the clipboard automatically.';
      }
      if (typeof showToast === 'function') showToast(msg, 'success', truncated ? 9000 : 4000);
    }
    saveDraft({ silent: true }).then(function (saved) {
      if (!saved || !saved.ok || !selectedDraftId) return;
      window.api.officerEmails.getComposeUrl({ draftId: selectedDraftId }).then(function (res) {
        if (!res || !res.ok) {
          if (typeof showToast === 'function') {
            showToast((res && res.errors && res.errors[0]) || 'Could not build Outlook link.', 'error', 7000);
          }
          return;
        }
        var url = res.url != null ? String(res.url) : '';
        var truncated = !!res.truncated;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            onCopied(truncated);
          }).catch(function () {
            if (window.api.officerEmails.copyText) {
              window.api.officerEmails.copyText(url).then(function (r) {
                if (r && r.ok) onCopied(truncated);
                else if (typeof showToast === 'function') showToast('Could not copy link.', 'error');
              });
            }
          });
        } else if (window.api.officerEmails.copyText) {
          window.api.officerEmails.copyText(url).then(function (r) {
            if (r && r.ok) onCopied(truncated);
            else if (typeof showToast === 'function') showToast('Could not copy link.', 'error');
          });
        }
      });
    });
  }

  function feeEarnerEmailDomain() {
    try {
      var em = (window._appSettingsCache && window._appSettingsCache.email) || '';
      em = String(em).trim();
      var at = em.lastIndexOf('@');
      if (at < 1) return '';
      return em.slice(at + 1).toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function isProfessionalDomain(email) {
    var d = (email.split('@')[1] || '').toLowerCase();
    if (!d) return false;
    var firmDom = feeEarnerEmailDomain();
    if (firmDom && (d === firmDom || d.endsWith('.' + firmDom))) return true;
    var roots = ['police.uk', 'met.police.uk', 'kent.police.uk', 'cps.gov.uk', 'justice.gov.uk', 'gov.uk', 'judiciary.uk', 'mod.gov.uk', 'nhs.net', 'nhs.uk'];
    for (var i = 0; i < roots.length; i++) {
      if (d === roots[i] || d.endsWith('.' + roots[i])) return true;
    }
    if (d.endsWith('.police.uk') || d.endsWith('police.uk')) return true;
    if (d.endsWith('.gov.uk') || d === 'gov.uk') return true;
    return false;
  }

  function copyField(text, okMsg) {
    var t = text != null ? String(text) : '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () {
        if (typeof showToast === 'function') showToast(okMsg || 'Copied', 'success', 2000);
      }).catch(function () {
        fallbackCopy(t, okMsg);
      });
    } else {
      fallbackCopy(t, okMsg);
    }
  }

  function fallbackCopy(t, okMsg) {
    if (window.api && window.api.officerEmails && window.api.officerEmails.copyText) {
      window.api.officerEmails.copyText(t).then(function (r) {
        if (r && r.ok && typeof showToast === 'function') showToast(okMsg || 'Copied', 'success', 2000);
      });
    }
  }

  function loadDraftIntoForm(d) {
    if (!d) return;
    selectedDraftId = d.id;
    els.template.value = d.templateType || 'disclosure_confirm_attendance';
    els.to.value = d.toEmail || '';
    els.recipient.value = d.recipientName || '';
    els.client.value = d.clientName || '';
    els.station.value = d.policeStation || '';
    els.date.value = d.attendanceDate || '';
    if (els.time) els.time.value = d.attendanceTime || '';
    els.offence.value = d.offence || '';
    els.extra.value = d.extraNote || '';
    els.bailDate.value = d.bailReturnDate || '';
    els.bailCond.value = d.bailConditions || '';
    els.userEmail.value = d.userEmailAddress || '';
    els.subject.value = d.subject || '';
    els.body.value = d.body || '';
    dirtySubjectBody = false;
    syncBailVisibility();
    if (els.template) els.template.dataset.oepLast = els.template.value;
  }

  function loadDrafts() {
    var aid = getCurrentAttendanceIdSafe();
    if (!aid || !els.drafts || !window.api) return;
    window.api.officerEmails.listDrafts(String(aid)).then(function (rows) {
      els.drafts.innerHTML = '';
      if (!rows || !rows.length) {
        els.drafts.innerHTML = '<p class="muted" style="font-size:0.85rem;">No drafts yet.</p>';
        return;
      }
      rows.forEach(function (d) {
        if (d.status === 'deleted') return;
        var card = document.createElement('div');
        card.className = 'officer-email-draft-card' + (d.status === 'cancelled' ? ' officer-email-draft-card--muted' : '');
        var st = STATUS_LABELS[d.status] || d.status;
        var updated = d.updatedAt ? String(d.updatedAt).slice(0, 16).replace('T', ' ') : '';
        var tplLabel = d.templateType;
        for (var ti = 0; ti < TEMPLATE_OPTIONS.length; ti++) {
          if (TEMPLATE_OPTIONS[ti].value === d.templateType) {
            tplLabel = TEMPLATE_OPTIONS[ti].label;
            break;
          }
        }
        card.innerHTML =
          '<div class="officer-email-draft-card-title">' + esc(tplLabel) + '</div>' +
          '<div class="officer-email-draft-to">' + esc(d.toEmail || '—') + '</div>' +
          '<div class="officer-email-draft-meta">' + esc(st) + ' · ' + esc(updated) + '</div>' +
          '<div class="officer-email-draft-sub">' + esc(d.subject || '—') + '</div>' +
          '<div class="officer-email-draft-actions">' +
          '<button type="button" class="btn-small" data-act="load">Load</button>' +
          '<button type="button" class="btn-small" data-act="dup" data-id="' + esc(d.id) + '">Duplicate</button>' +
          (d.status === 'draft' || d.status === 'ready_for_outlook' || d.status === 'opened_in_outlook'
            ? '<button type="button" class="btn-small" data-act="cancel" data-id="' + esc(d.id) + '">Cancel</button>'
            : '') +
          (d.status !== 'sent_manually'
            ? '<button type="button" class="btn-small" data-act="del" data-id="' + esc(d.id) + '">Delete</button>'
            : '') +
          '</div>';
        card.querySelector('[data-act="load"]').addEventListener('click', function () {
          loadDraftIntoForm(d);
        });
        card.querySelector('[data-act="dup"]').addEventListener('click', function () {
          window.api.officerEmails.duplicateDraft(d.id).then(function (res) {
            if (res && res.ok) {
              selectedDraftId = res.draft && res.draft.id;
              loadDraftIntoForm(res.draft);
              loadDrafts();
            }
          });
        });
        var cancelBtn = card.querySelector('[data-act="cancel"]');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', function () {
            var did = d.id;
            if (typeof window.showChoice === 'function') {
              window.showChoice('Cancel this draft?', 'Cancel draft', [
                { id: 'keep', label: 'Keep Draft', variant: 'primary' },
                { id: 'cancel', label: 'Cancel Draft', variant: 'danger' },
              ]).then(function (choice) {
                if (choice === 'cancel') runCancelDraft(did);
              });
            } else if (typeof showConfirm === 'function') {
              showConfirm('Cancel this draft?', 'Cancel draft').then(function (ok) {
                if (ok) runCancelDraft(did);
              });
            }
          });
        }
        var delBtn = card.querySelector('[data-act="del"]');
        if (!delBtn) {
          els.drafts.appendChild(card);
          return;
        }
        delBtn.addEventListener('click', function () {
          var did = d.id;
          function go() {
            runDeleteDraft(did);
          }
          if (typeof window.showChoice === 'function') {
            window.showChoice('Are you sure you want to delete this draft?', 'Delete draft', [
              { id: 'abort', label: 'Cancel', variant: 'secondary' },
              { id: 'del', label: 'Delete Draft', variant: 'danger' },
            ]).then(function (choice) {
              if (choice === 'del') go();
            });
          } else if (typeof showConfirm === 'function') {
            showConfirm('Are you sure you want to delete this draft?', 'Delete draft').then(function (ok) {
              if (ok) go();
            });
          } else {
            go();
          }
        });
        els.drafts.appendChild(card);
      });
    });
  }

  function attachToCustodyNote(id) {
    if (!host) return;
    var locked = !id;
    els.locked.classList.toggle('hidden', !locked);
    els.main.classList.toggle('officer-email-panel-disabled', locked);
    if (locked) {
      selectedDraftId = null;
      lastAttachedCustodyNoteId = null;
      return;
    }
    var sid = String(id);
    var switched =
      lastAttachedCustodyNoteId !== null && String(lastAttachedCustodyNoteId) !== sid;
    lastAttachedCustodyNoteId = sid;
    if (switched) {
      newDraft();
    } else {
      applyPrefillFromMatter();
      if (!selectedDraftId) generateFromTemplate(true);
    }
    loadDrafts();
  }

  function refresh() {
    applyPrefillFromMatter();
  }

  function init() {
    host = document.getElementById('officer-emails-panel-host');
    if (!host || host.dataset.oepBuilt) return;
    host.dataset.oepBuilt = '1';
    host.classList.add('form-panel-card', 'officer-email-panel');
    buildShell();
    newDraft();
  }

  global.OfficerEmailsPanel = {
    init: init,
    attachToCustodyNote: attachToCustodyNote,
    refresh: refresh,
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* Officer Emails — standalone one-off compose view. */
(function (global) {
  'use strict';

  var TEMPLATE_OPTIONS = (typeof OFFICER_EMAIL_TEMPLATE_OPTIONS !== 'undefined')
    ? OFFICER_EMAIL_TEMPLATE_OPTIONS
    : [];

  var host = null;
  var els = {};
  var dirtySubjectBody = false;
  var autoGenerateTimer = null;

  function buildShell() {
    if (!host) return;
    host.innerHTML =
      '<div class="officer-email-standalone-grid">' +
      '<section class="form-panel-card officer-email-standalone-card">' +
      '<div class="form-panel-card-label">One-off officer email</div>' +
      '<p class="officer-email-panel-hint">Use this when the email is not tied to a saved custody note. Nothing is sent until you review and send it in Outlook Web.</p>' +
      '<div class="officer-email-form officer-email-standalone-form">' +
      '<label class="officer-email-field"><span>Email type</span><select id="oes-template"></select></label>' +
      '<label class="officer-email-field"><span>Recipient email</span><input type="email" id="oes-to" autocomplete="off" spellcheck="false" /></label>' +
      '<label class="officer-email-field"><span>Recipient name</span><input type="text" id="oes-recipient" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Client name</span><input type="text" id="oes-client" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Police station</span><input type="text" id="oes-station" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Date</span><input type="text" id="oes-date" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Attendance time</span><input type="text" id="oes-time" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Offence / allegation</span><input type="text" id="oes-offence" autocomplete="off" /></label>' +
      '<div id="oes-bail-fields" class="officer-email-bail-fields hidden">' +
      '<label class="officer-email-field"><span>Bail return date</span><input type="text" id="oes-bail-date" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Bail conditions</span><textarea id="oes-bail-cond" rows="3"></textarea></label>' +
      '</div>' +
      '<label class="officer-email-field officer-email-standalone-wide"><span>Extra note (optional)</span><textarea id="oes-extra" rows="2"></textarea></label>' +
      '<label class="officer-email-field"><span>My email address (optional)</span><input type="email" id="oes-user-email" autocomplete="off" /></label>' +
      '</div>' +
      '<div class="officer-email-actions">' +
      '<button type="button" class="btn btn-secondary btn-small" id="oes-clear">Clear</button>' +
      '<button type="button" class="btn btn-primary btn-small" id="oes-gen">Generate / Refresh</button>' +
      '</div>' +
      '</section>' +
      '<section class="form-panel-card officer-email-standalone-card officer-email-standalone-preview">' +
      '<div class="form-panel-card-label">Preview and send manually</div>' +
      '<label class="officer-email-field"><span>Subject</span><input type="text" id="oes-subject" autocomplete="off" /></label>' +
      '<label class="officer-email-field"><span>Email body</span><textarea id="oes-body" rows="18"></textarea></label>' +
      '<div class="officer-email-actions officer-email-actions-outlook">' +
      '<button type="button" class="btn btn-primary btn-small" id="oes-open">Open in Outlook Web</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oes-copy-owa">Copy Outlook link</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oes-copy-to">Copy Recipient</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oes-copy-sub">Copy Subject</button>' +
      '<button type="button" class="btn btn-secondary btn-small" id="oes-copy-body">Copy Body</button>' +
      '</div>' +
      '<p class="officer-email-panel-hint">If Outlook login or Authenticator interrupts the compose window, use the copy buttons.</p>' +
      '</section>' +
      '</div>';

    var sel = host.querySelector('#oes-template');
    TEMPLATE_OPTIONS.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.dataset.oesLast = sel.value;

    els = {
      template: sel,
      to: host.querySelector('#oes-to'),
      recipient: host.querySelector('#oes-recipient'),
      client: host.querySelector('#oes-client'),
      station: host.querySelector('#oes-station'),
      date: host.querySelector('#oes-date'),
      time: host.querySelector('#oes-time'),
      offence: host.querySelector('#oes-offence'),
      bailWrap: host.querySelector('#oes-bail-fields'),
      bailDate: host.querySelector('#oes-bail-date'),
      bailCond: host.querySelector('#oes-bail-cond'),
      extra: host.querySelector('#oes-extra'),
      userEmail: host.querySelector('#oes-user-email'),
      subject: host.querySelector('#oes-subject'),
      body: host.querySelector('#oes-body'),
    };

    els.template.addEventListener('change', onTemplateChange);
    els.subject.addEventListener('input', function () { dirtySubjectBody = true; });
    els.body.addEventListener('input', function () { dirtySubjectBody = true; });
    ['recipient', 'client', 'station', 'date', 'time', 'offence', 'extra', 'userEmail', 'bailDate', 'bailCond'].forEach(function (key) {
      if (!els[key]) return;
      els[key].addEventListener('input', scheduleAutoGenerate);
    });
    host.querySelector('#oes-clear').addEventListener('click', clearForm);
    host.querySelector('#oes-gen').addEventListener('click', function () { generateFromTemplate(true); });
    host.querySelector('#oes-open').addEventListener('click', openOutlookClicked);
    host.querySelector('#oes-copy-owa').addEventListener('click', copyOutlookLinkClicked);
    host.querySelector('#oes-copy-to').addEventListener('click', function () { copyField(els.to.value, 'Recipient copied.'); });
    host.querySelector('#oes-copy-sub').addEventListener('click', function () { copyField(els.subject.value, 'Subject copied.'); });
    host.querySelector('#oes-copy-body').addEventListener('click', function () { copyField(els.body.value, 'Body copied.'); });
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

  function syncBailVisibility() {
    var tt = els.template && els.template.value;
    var show = tt === 'bail_details_request' || tt === 'chase_bail_details_follow_up';
    if (els.bailWrap) els.bailWrap.classList.toggle('hidden', !show);
  }

  function onTemplateChange() {
    syncBailVisibility();
    if (!dirtySubjectBody) {
      generateFromTemplate(true);
      if (els.template) els.template.dataset.oesLast = els.template.value;
      return;
    }
    if (typeof window.showChoice !== 'function') {
      generateFromTemplate(true);
      return;
    }
    window.showChoice(
      'Changing template may overwrite your edited subject and body.',
      'Change template',
      [
        { id: 'keep', label: 'Keep current email', variant: 'primary' },
        { id: 'apply', label: 'Apply new template', variant: 'secondary' },
      ]
    ).then(function (choice) {
      if (choice !== 'apply') {
        if (els.template) els.template.value = els.template.dataset.oesLast || 'disclosure_confirm_attendance';
        syncBailVisibility();
        return;
      }
      generateFromTemplate(true);
      if (els.template) els.template.dataset.oesLast = els.template.value;
    });
  }

  function scheduleAutoGenerate() {
    if (dirtySubjectBody) return;
    if (autoGenerateTimer) clearTimeout(autoGenerateTimer);
    autoGenerateTimer = setTimeout(function () {
      autoGenerateTimer = null;
      generateFromTemplate(false);
    }, 120);
  }

  function generateFromTemplate(forceApply) {
    if (!window.api || !window.api.officerEmails || !window.api.officerEmails.buildPreview) {
      return Promise.resolve({ ok: false, error: 'Officer email preview is not available.' });
    }
    return window.api.officerEmails.buildPreview(collectFields()).then(function (res) {
      if (!res || !res.ok) {
        if (typeof showToast === 'function') showToast((res && res.error) || 'Could not build preview', 'error');
        return res || { ok: false, error: 'Could not build preview' };
      }
      if (forceApply || !dirtySubjectBody) {
        els.subject.value = res.subject || '';
        els.body.value = res.body || '';
        dirtySubjectBody = false;
      }
      return res;
    }).catch(function (err) {
      if (typeof showToast === 'function') showToast('Could not build preview. Please try Generate / Refresh.', 'error', 7000);
      try { console.error('[officerEmailsStandalone] buildPreview failed', err); } catch (_) {}
      return { ok: false, error: (err && err.message) || String(err) };
    });
  }

  function clearForm() {
    Object.keys(els).forEach(function (key) {
      if (!els[key] || !('value' in els[key])) return;
      if (key === 'template') return;
      els[key].value = '';
    });
    els.template.value = 'disclosure_confirm_attendance';
    els.template.dataset.oesLast = els.template.value;
    dirtySubjectBody = false;
    syncBailVisibility();
    generateFromTemplate(true);
    if (els.to) els.to.focus();
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

  function isProfessionalDomain(email) {
    var d = (String(email || '').split('@')[1] || '').toLowerCase();
    if (!d) return false;
    var roots = ['police.uk', 'met.police.uk', 'kent.police.uk', 'cps.gov.uk', 'justice.gov.uk', 'gov.uk', 'judiciary.uk', 'mod.gov.uk', 'nhs.net', 'nhs.uk'];
    for (var i = 0; i < roots.length; i++) {
      if (d === roots[i] || d.endsWith('.' + roots[i])) return true;
    }
    if (d.endsWith('.police.uk') || d.endsWith('police.uk')) return true;
    if (d.endsWith('.gov.uk') || d === 'gov.uk') return true;
    return false;
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
    var f = collectFields();
    var to = String(f.toEmail || '').trim();
    var sub = String(f.subject || '').trim();
    var bod = String(f.body || '').trim();
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
    else if (!isProfessionalDomain(to)) warnings.push('Warning: this recipient does not appear to be a recognised police, court, CPS, government, NHS, solicitor or professional email address. Please check carefully before proceeding.');
    var msg =
      'You are about to open this one-off email in Outlook Web.\n\nTo:\n' + to + '\n\nSubject:\n' + sub + '\n\n' +
      (warnings.length ? warnings.join('\n\n') + '\n\n' : '') +
      'Custody Note will not send the email. You must review and send it manually in Outlook Web.';

    function reportFatal(label, detail) {
      var fallback = 'Outlook Web could not be opened. The email content is still in the form — try Copy Outlook link.';
      if (detail) fallback = fallback + ' (' + detail + ')';
      if (typeof showToast === 'function') showToast(fallback, 'error', 9000);
      else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(fallback);
      try { console.warn('[officerEmailsStandalone] ' + label + ': showToast undefined, fell back to alert/no-op'); } catch (_) {}
    }
    function go() {
      var promise;
      try {
        promise = window.api.officerEmails.openOneOffOutlook(f);
      } catch (syncErr) {
        try { console.error('[officerEmailsStandalone] openOneOffOutlook threw synchronously', syncErr); } catch (_) {}
        reportFatal('openOneOffOutlook sync throw', (syncErr && syncErr.message) || String(syncErr));
        return;
      }
      if (!promise || typeof promise.then !== 'function') {
        try { console.error('[officerEmailsStandalone] openOneOffOutlook returned non-promise', promise); } catch (_) {}
        reportFatal('openOneOffOutlook returned non-promise', 'IPC bridge unavailable');
        return;
      }
      promise.then(function (res) {
        try { console.info('[officerEmailsStandalone] openOneOffOutlook resolved', res); } catch (_) {}
        if (!res || !res.ok) {
          var errMsg = (res && res.errors && res.errors[0]) || 'Outlook Web could not be opened. You can still copy the recipient, subject and body manually.';
          if (typeof showToast === 'function') showToast(errMsg, 'error', 7000);
          else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(errMsg);
          else try { console.warn('[officerEmailsStandalone] openOneOffOutlook not-ok with no toast/alert', res); } catch (_) {}
          return;
        }
        if (typeof showToast === 'function') {
          var openedMsg = 'Opened in browser - complete send in Outlook';
          if (res.truncated) {
            openedMsg =
              'Opened in browser. The message was long, so the full email was copied to your clipboard before opening Outlook — paste into the body if needed.';
          }
          showToast(openedMsg, 'success', res.truncated ? 9000 : 5000);
        } else {
          try { console.warn('[officerEmailsStandalone] openOneOffOutlook ok but showToast undefined'); } catch (_) {}
        }
      }).catch(function (err) {
        try { console.error('[officerEmailsStandalone] openOneOffOutlook rejected', err); } catch (_) {}
        reportFatal('openOneOffOutlook rejected', (err && err.message) || String(err));
      });
    }

    if (typeof window.showChoice === 'function') {
      window.showChoice(msg, 'Open Outlook Web', [
        { id: 'abort', label: 'Cancel', variant: 'secondary' },
        { id: 'open', label: 'Open Outlook Web', variant: 'primary' },
      ]).then(function (choice) {
        if (choice === 'open') go();
      }).catch(function (err) {
        try { console.error('[officerEmailsStandalone] showChoice rejected', err); } catch (_) {}
        reportFatal('showChoice rejected', (err && err.message) || String(err));
      });
      return;
    }
    if (typeof showConfirm !== 'function') {
      try { console.warn('[officerEmailsStandalone] showChoice and showConfirm both undefined; using window.confirm fallback'); } catch (_) {}
      var ok = false;
      try {
        ok = (typeof window !== 'undefined' && typeof window.confirm === 'function')
          ? window.confirm(msg)
          : true;
      } catch (_) { ok = true; }
      if (ok) go();
      return;
    }
    showConfirm(msg, 'Open Outlook Web').then(function (ok) {
      if (ok) go();
    }).catch(function (err) {
      try { console.error('[officerEmailsStandalone] showConfirm rejected', err); } catch (_) {}
      reportFatal('showConfirm rejected', (err && err.message) || String(err));
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
    var f = collectFields();
    var to = String(f.toEmail || '').trim();
    var sub = String(f.subject || '').trim();
    var bod = String(f.body || '').trim();
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
    window.api.officerEmails.getComposeUrl({ fields: f }).then(function (res) {
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
  }

  function focusFirstField() {
    if (els.to && typeof els.to.focus === 'function') els.to.focus();
  }

  function init() {
    host = document.getElementById('officer-emails-standalone-host');
    if (!host || host.dataset.oesBuilt) return;
    host.dataset.oesBuilt = '1';
    buildShell();
    syncBailVisibility();
    generateFromTemplate(true);
  }

  global.OfficerEmailsStandalone = {
    init: init,
    focusFirstField: focusFirstField,
  };
})(typeof window !== 'undefined' ? window : globalThis);

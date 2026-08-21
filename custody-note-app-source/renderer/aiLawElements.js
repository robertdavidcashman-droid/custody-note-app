/**
 * Opt-in AI: Law / Elements fill + free-form Ask AI session.
 * Accuracy: web-sourced answers only; Sources mandatory; Insert/Append gated.
 */
(function () {
  'use strict';

  var _fillRunning = false;
  var _askRunning = false;
  var _askSessionConfirmed = false;
  var _askThread = []; /* { role, content, sources? } */
  var _lastLawSources = [];

  function toast(msg, type, ms) {
    if (typeof showToast === 'function') showToast(msg, type || 'info', ms);
  }

  function confirmAsync(message, title) {
    if (typeof showConfirm === 'function') {
      return showConfirm(message, title || 'Confirm');
    }
    return Promise.resolve(window.confirm(String(message || '')));
  }

  function getOpenFormData() {
    try {
      if (typeof window.getFormData === 'function') return window.getFormData() || {};
      if (typeof getFormData === 'function') return getFormData() || {};
    } catch (_) {}
    return (typeof formData === 'object' && formData) || {};
  }

  function setField(key, value) {
    try {
      if (typeof formData === 'object' && formData) formData[key] = value;
    } catch (_) {}
    if (typeof window.setFieldValue === 'function') {
      window.setFieldValue(key, value);
      return;
    }
    if (typeof setFieldValue === 'function') {
      setFieldValue(key, value);
      return;
    }
    var el = document.querySelector('[data-field="' + key + '"]');
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function getField(key) {
    try {
      if (typeof window.getFieldValue === 'function') return String(window.getFieldValue(key) || '');
      if (typeof getFieldValue === 'function') return String(getFieldValue(key) || '');
    } catch (_) {}
    try {
      if (typeof formData === 'object' && formData && formData[key] != null) return String(formData[key]);
    } catch (_) {}
    var el = document.querySelector('[data-field="' + key + '"]');
    return el ? String(el.value || '') : '';
  }

  function copyText(v) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(v).then(function () {
        toast('Copied', 'success');
      });
    }
    toast(v, 'info', 10000);
    return Promise.resolve();
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sourcesPass(sources, refusal) {
    if (refusal) return true;
    return Array.isArray(sources) && sources.length >= 2;
  }

  function formatSourcesHtml(sources) {
    if (!Array.isArray(sources) || !sources.length) {
      return '<p class="settings-hint" style="margin:0;">No sources — Insert/Append blocked for legal answers.</p>';
    }
    var items = sources
      .map(function (s, i) {
        var url = String((s && s.url) || '').trim();
        var title = String((s && s.title) || url).trim() || url;
        if (!url) return '';
        return (
          '<li style="margin:0.2rem 0;">' +
          (i + 1) +
          '. <a href="' +
          escapeHtml(url) +
          '" data-external-url="' +
          escapeHtml(url) +
          '">' +
          escapeHtml(title) +
          '</a></li>'
        );
      })
      .filter(Boolean)
      .join('');
    return '<ol style="margin:0.25rem 0 0 1.1rem;padding:0;font-size:0.85rem;">' + items + '</ol>';
  }

  function formatSourcesPlain(sources) {
    if (!Array.isArray(sources) || !sources.length) return '';
    return sources
      .map(function (s, i) {
        return i + 1 + '. ' + (s.title || s.url) + ' — ' + s.url;
      })
      .join('\n');
  }

  function openExternalUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (window.api && typeof window.api.openExternal === 'function') {
      window.api.openExternal(url);
      return;
    }
    if (window.api && typeof window.api.openExternalUrl === 'function') {
      window.api.openExternalUrl(url);
      return;
    }
    try {
      window.open(url, '_blank', 'noopener');
    } catch (_) {}
  }

  function wireSourcesClicks(root) {
    if (!root) return;
    root.querySelectorAll('a[data-external-url]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        openExternalUrl(a.getAttribute('data-external-url') || a.href);
      });
    });
  }

  function setInsertEnabled(enabled) {
    var insertBtn = document.getElementById('ai-law-draft-insert');
    if (!insertBtn) return;
    insertBtn.disabled = !enabled;
    insertBtn.title = enabled
      ? 'Insert into Law / Elements'
      : 'Insert disabled — sources required (at least two URLs)';
  }

  function setAskAppendEnabled(enabled) {
    var btn = document.getElementById('ai-ask-append-law');
    if (!btn) return;
    btn.disabled = !enabled;
    btn.title = enabled
      ? 'Append last answer to Law / Elements'
      : 'Append disabled — sources required (at least two URLs)';
  }

  /* ── Law / Elements fill ── */

  function showReviewModal(draft, meta, sources, refusal) {
    var modal = document.getElementById('ai-law-draft-modal');
    var text = document.getElementById('ai-law-draft-text');
    var metaEl = document.getElementById('ai-law-draft-meta');
    var sourcesEl = document.getElementById('ai-law-draft-sources');
    if (!modal || !text) return;
    text.value = draft || '';
    if (metaEl) metaEl.textContent = meta || '';
    _lastLawSources = Array.isArray(sources) ? sources.slice() : [];
    if (sourcesEl) {
      sourcesEl.innerHTML =
        '<strong style="font-size:0.85rem;">Sources</strong>' + formatSourcesHtml(_lastLawSources);
      wireSourcesClicks(sourcesEl);
    }
    setInsertEnabled(sourcesPass(_lastLawSources, !!refusal) && !refusal);
    if (refusal) {
      setInsertEnabled(false);
      toast('AI could not verify from reliable sources — nothing to insert', 'warning', 6000);
    }
    modal.style.display = '';
  }

  function hideReviewModal() {
    var modal = document.getElementById('ai-law-draft-modal');
    if (modal) modal.style.display = 'none';
    _lastLawSources = [];
    setInsertEnabled(false);
  }

  function uncheckFillBoxes() {
    document.querySelectorAll('[data-field="aiFillLawElements"]').forEach(function (cb) {
      if (cb && cb.type === 'checkbox') cb.checked = false;
    });
    try {
      if (typeof formData === 'object' && formData) formData.aiFillLawElements = '';
    } catch (_) {}
  }

  function markFilledViaAi() {
    var ts = new Date().toISOString();
    try {
      if (typeof formData === 'object' && formData) formData.lawElementsFilledViaAi = ts;
    } catch (_) {}
    document.querySelectorAll('[data-ai-law-status]').forEach(function (el) {
      el.textContent =
        'Last inserted via AI — review sources and primary materials before relying on it.';
      el.style.display = '';
    });
  }

  function applyLawElementsDraft(draft) {
    setField('lawElements', draft);
    markFilledViaAi();
    toast('Inserted into Law / Elements of offence — verify sources before relying on it', 'success', 5000);
    hideReviewModal();
    uncheckFillBoxes();
  }

  /* Only write path into lawElements for AI fill — do not call from runFill. */
  function insertIntoLawElements() {
    if (!sourcesPass(_lastLawSources, false)) {
      toast('Insert disabled — sources required (at least two URLs)', 'warning');
      return;
    }
    var text = document.getElementById('ai-law-draft-text');
    var draft = text ? String(text.value || '').trim() : '';
    if (!draft) {
      toast('Nothing to insert', 'warning');
      return;
    }
    if (!/\bSources\b/i.test(draft) && _lastLawSources.length) {
      draft = draft + '\n\nSources\n' + formatSourcesPlain(_lastLawSources);
    }
    var existing = getField('lawElements').trim();
    if (existing) {
      confirmAsync(
        'Replace the current Law / Elements of offence text with this AI draft (including Sources)?',
        'Insert AI draft',
      ).then(function (ok) {
        if (ok) applyLawElementsDraft(draft);
      });
      return;
    }
    applyLawElementsDraft(draft);
  }

  function runFill() {
    if (_fillRunning) {
      toast('AI request already in progress', 'warning');
      return;
    }
    if (!window.api || typeof window.api.aiFillLawElements !== 'function') {
      toast('AI fill is not available in this build', 'error');
      uncheckFillBoxes();
      return;
    }
    var data = getOpenFormData();
    _fillRunning = true;
    toast('Requesting web-sourced AI draft\u2026', 'info', 4000);
    window.api
      .aiFillLawElements({
        confirmed: true,
        formData: data,
        attendanceId: typeof currentAttendanceId !== 'undefined' ? currentAttendanceId : null,
      })
      .then(function (res) {
        _fillRunning = false;
        if (!res || !res.ok) {
          toast((res && res.error) || 'AI fill failed', 'error', 7000);
          uncheckFillBoxes();
          return;
        }
        /* Review modal only — never write lawElements here. */
        showReviewModal(
          res.draft,
          res.message || 'Web-sourced draft — verify before inserting',
          res.sources || [],
          !!res.refusal,
        );
      })
      .catch(function (e) {
        _fillRunning = false;
        toast('AI fill failed: ' + (e && e.message ? e.message : e), 'error');
        uncheckFillBoxes();
      });
  }

  function onFillCheckboxChange(cb) {
    if (!cb.checked) return;
    var existing = getField('lawElements').trim();
    var msg =
      'Send offence name(s) and statute(s) only to OpenAI (with web search) to draft actus reus, mens rea, defences and sentencing?\n\n' +
      'Answers must include Sources. Unsourced case law is blocked. ' +
      'This is a draft for you to verify against primary materials — not legal advice.\n\n' +
      'Client details are not sent. Nothing is inserted until you press Insert.';
    if (existing) {
      msg +=
        '\n\nThis field already has saved text. Generating a draft will not change it until you choose Insert.';
    }
    confirmAsync(msg, 'AI fill — Law / Elements').then(function (ok) {
      if (ok) runFill();
      else uncheckFillBoxes();
    });
  }

  /* ── Ask AI (multi-turn) ── */

  function uncheckAskBoxes() {
    document.querySelectorAll('[data-field="aiAskQuestion"]').forEach(function (cb) {
      if (cb && cb.type === 'checkbox') cb.checked = false;
    });
    try {
      if (typeof formData === 'object' && formData) formData.aiAskQuestion = '';
    } catch (_) {}
  }

  function lastAssistantTurn() {
    for (var i = _askThread.length - 1; i >= 0; i--) {
      if (_askThread[i].role === 'assistant') return _askThread[i];
    }
    return null;
  }

  function updateAskAppendGate() {
    var last = lastAssistantTurn();
    if (!last) {
      setAskAppendEnabled(false);
      return;
    }
    setAskAppendEnabled(sourcesPass(last.sources, !!last.refusal) && !last.refusal);
  }

  function renderAskThread() {
    var el = document.getElementById('ai-ask-thread');
    if (!el) return;
    if (!_askThread.length) {
      el.innerHTML =
        '<p class="settings-hint" style="margin:0;">Ask any question. Follow-ups stay in this session. Sources are required; unsourced case law is blocked.</p>';
      updateAskAppendGate();
      return;
    }
    var html = '';
    for (var i = 0; i < _askThread.length; i++) {
      var t = _askThread[i];
      var label = t.role === 'assistant' ? 'AI' : 'You';
      var body = escapeHtml(t.content || '').replace(/\n/g, '<br>');
      html +=
        '<div style="margin:0 0 0.75rem;padding:0.5rem 0.65rem;border-radius:6px;background:' +
        (t.role === 'assistant' ? 'rgba(15,23,42,0.04)' : 'rgba(37,99,235,0.06)') +
        ';">' +
        '<div style="font-size:0.75rem;font-weight:600;margin-bottom:0.25rem;">' +
        label +
        '</div>' +
        '<div style="font-size:0.88rem;line-height:1.4;">' +
        body +
        '</div>';
      if (t.role === 'assistant') {
        html +=
          '<div style="margin-top:0.5rem;padding-top:0.4rem;border-top:1px solid rgba(15,23,42,0.08);">' +
          '<strong style="font-size:0.8rem;">Sources</strong>' +
          formatSourcesHtml(t.sources || []) +
          '</div>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
    wireSourcesClicks(el);
    el.scrollTop = el.scrollHeight;
    updateAskAppendGate();
  }

  function clearAskSession() {
    _askThread = [];
    _askSessionConfirmed = false;
    var q = document.getElementById('ai-ask-input');
    if (q) q.value = '';
    var include = document.getElementById('ai-ask-include-offences');
    if (include) include.checked = false;
    renderAskThread();
  }

  function showAskModal() {
    var modal = document.getElementById('ai-ask-modal');
    if (!modal) return;
    renderAskThread();
    modal.style.display = '';
    var q = document.getElementById('ai-ask-input');
    if (q) setTimeout(function () { q.focus(); }, 50);
  }

  function hideAskModal() {
    var modal = document.getElementById('ai-ask-modal');
    if (modal) modal.style.display = 'none';
  }

  function closeAskSession() {
    hideAskModal();
    clearAskSession();
    uncheckAskBoxes();
  }

  function lastAssistantAnswer() {
    var t = lastAssistantTurn();
    return t ? String(t.content || '') : '';
  }

  function threadAsText() {
    return _askThread
      .map(function (t) {
        var block = (t.role === 'assistant' ? 'AI' : 'You') + ':\n' + t.content;
        if (t.role === 'assistant' && t.sources && t.sources.length) {
          block += '\n\nSources\n' + formatSourcesPlain(t.sources);
        }
        return block;
      })
      .join('\n\n');
  }

  function appendLastToLawElements() {
    var last = lastAssistantTurn();
    if (!last || !String(last.content || '').trim()) {
      toast('No AI answer to append yet', 'warning');
      return;
    }
    if (!sourcesPass(last.sources, !!last.refusal) || last.refusal) {
      toast('Append disabled — sources required (at least two URLs)', 'warning');
      return;
    }
    var answer = String(last.content || '').trim();
    if (!/\bSources\b/i.test(answer) && last.sources && last.sources.length) {
      answer = answer + '\n\nSources\n' + formatSourcesPlain(last.sources);
    }
    var existing = getField('lawElements').trim();
    var next = existing ? existing + '\n\n' + answer : answer;
    confirmAsync(
      existing
        ? 'Append the last AI answer (with Sources) to Law / Elements of offence?'
        : 'Insert the last AI answer (with Sources) into Law / Elements of offence?',
      'Append AI answer',
    ).then(function (ok) {
      if (!ok) return;
      setField('lawElements', next);
      markFilledViaAi();
      toast('Appended to Law / Elements — verify sources before relying on it', 'success', 5000);
    });
  }

  function sendAskQuestion() {
    if (_askRunning) {
      toast('AI request already in progress', 'warning');
      return;
    }
    if (!window.api || typeof window.api.aiAskQuestion !== 'function') {
      toast('Ask AI is not available in this build', 'error');
      return;
    }
    var input = document.getElementById('ai-ask-input');
    var question = input ? String(input.value || '').trim() : '';
    if (!question) {
      toast('Enter a question first', 'warning');
      return;
    }

    function doSend() {
      var includeEl = document.getElementById('ai-ask-include-offences');
      var includeOffences = !!(includeEl && includeEl.checked);
      var history = _askThread.map(function (t) {
        return { role: t.role, content: t.content };
      });
      _askRunning = true;
      toast('Sending (web search + sources required)\u2026', 'info', 3000);
      var sendBtn = document.getElementById('ai-ask-send');
      if (sendBtn) sendBtn.disabled = true;
      window.api
        .aiAskQuestion({
          confirmed: true,
          question: question,
          history: history,
          includeOffences: includeOffences,
          formData: includeOffences ? getOpenFormData() : {},
          attendanceId: typeof currentAttendanceId !== 'undefined' ? currentAttendanceId : null,
        })
        .then(function (res) {
          _askRunning = false;
          if (sendBtn) sendBtn.disabled = false;
          if (!res || !res.ok) {
            toast((res && res.error) || 'Ask AI failed', 'error', 7000);
            return;
          }
          _askThread.push({ role: 'user', content: question });
          _askThread.push({
            role: 'assistant',
            content: res.answer || '',
            sources: Array.isArray(res.sources) ? res.sources : [],
            refusal: !!res.refusal,
          });
          if (input) input.value = '';
          renderAskThread();
          if (res.refusal) {
            toast('AI could not verify from reliable sources', 'warning', 6000);
          }
        })
        .catch(function (e) {
          _askRunning = false;
          if (sendBtn) sendBtn.disabled = false;
          toast('Ask AI failed: ' + (e && e.message ? e.message : e), 'error');
        });
    }

    if (!_askSessionConfirmed) {
      confirmAsync(
        'Send what you type (and prior turns in this session) to OpenAI with web search?\n\n' +
          'Answers must include Sources. Unsourced case law is blocked. ' +
          'This is a draft for solicitor verification — not legal advice.\n\n' +
          'You control what is sent. Do not paste client names or privileged instructions unless you intend to.',
        'Ask AI',
      ).then(function (ok) {
        if (!ok) return;
        _askSessionConfirmed = true;
        doSend();
      });
      return;
    }
    doSend();
  }

  function onAskCheckboxChange(cb) {
    if (!cb.checked) {
      closeAskSession();
      return;
    }
    showAskModal();
  }

  function observeForm() {
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('input[data-field="aiFillLawElements"]')) {
        onFillCheckboxChange(t);
      } else if (t.matches('input[data-field="aiAskQuestion"]')) {
        onAskCheckboxChange(t);
      }
    });
  }

  function wireModals() {
    setInsertEnabled(false);
    setAskAppendEnabled(false);

    var copyBtn = document.getElementById('ai-law-draft-copy');
    var insertBtn = document.getElementById('ai-law-draft-insert');
    var closeBtn = document.getElementById('ai-law-draft-close');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = document.getElementById('ai-law-draft-text');
        copyText(text ? text.value : '');
      });
    }
    if (insertBtn) insertBtn.addEventListener('click', insertIntoLawElements);
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        hideReviewModal();
        uncheckFillBoxes();
      });
    }

    var askSend = document.getElementById('ai-ask-send');
    var askClose = document.getElementById('ai-ask-close');
    var askClear = document.getElementById('ai-ask-clear');
    var askCopyLast = document.getElementById('ai-ask-copy-last');
    var askCopyThread = document.getElementById('ai-ask-copy-thread');
    var askAppend = document.getElementById('ai-ask-append-law');
    var askInput = document.getElementById('ai-ask-input');
    if (askSend) askSend.addEventListener('click', sendAskQuestion);
    if (askClose) askClose.addEventListener('click', closeAskSession);
    if (askClear) {
      askClear.addEventListener('click', function () {
        clearAskSession();
        toast('Thread cleared', 'info');
      });
    }
    if (askCopyLast) {
      askCopyLast.addEventListener('click', function () {
        var a = lastAssistantAnswer();
        if (!a) toast('No AI answer yet', 'warning');
        else copyText(a);
      });
    }
    if (askCopyThread) {
      askCopyThread.addEventListener('click', function () {
        var t = threadAsText();
        if (!t) toast('Thread is empty', 'warning');
        else copyText(t);
      });
    }
    if (askAppend) askAppend.addEventListener('click', appendLastToLawElements);
    if (askInput) {
      askInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          sendAskQuestion();
        }
      });
    }
  }

  window.AiLawElements = {
    runFill: runFill,
    insertIntoLawElements: insertIntoLawElements,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      observeForm();
      wireModals();
    });
  } else {
    observeForm();
    wireModals();
  }
})();

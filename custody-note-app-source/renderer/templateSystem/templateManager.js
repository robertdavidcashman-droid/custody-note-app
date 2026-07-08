/* ═══════════════════════════════════════════════════════
   TEMPLATE SYSTEM — Template Manager UI
   Vanilla JS full-screen modal.
   Depends on: placeholders.js, templateEngine.js, templateStore.js
   ═══════════════════════════════════════════════════════ */

/**
 * Open the Template Manager modal.
 *
 * @param {object} [opts]
 * @param {object} [opts.record]    Current attendance record data (for live preview)
 * @param {object} [opts.settings]  App settings cache (for solicitor/firm fields)
 * @param {Function} [opts.onUse]   Callback(subject, content, meta) when user clicks "Use Template".
 *                                  meta: { placeholders: string[], missing: string[] } — missing keys had no record data (replaced with blank).
 */
function openTemplateManager(opts) {
  opts = opts || {};

  /* Remove stale instance */
  var stale = document.getElementById('tpl-manager-overlay');
  if (stale) stale.remove();

  /* Build initial data map */
  var _dataMap = tplBuildData({ record: opts.record || {}, settings: opts.settings || window._appSettingsCache || {} });

  /* State */
  var _templates    = tplGetAll();
  var _selectedId   = _templates.length ? _templates[0].id : '';
  var _mode         = _selectedId ? 'edit' : 'create';
  var _name         = '';
  var _subject      = '';
  var _content      = '';
  var _insertTarget = 'content'; /* 'subject' | 'content' */

  /* ── Helpers ──────────────────────────────────────────── */

  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _refreshDataMap() {
    /* Called when record context is updated externally */
    _dataMap = tplBuildData({ record: opts.record || {}, settings: opts.settings || window._appSettingsCache || {} });
  }

  function _loadTemplate(id) {
    var t = null;
    for (var i = 0; i < _templates.length; i++) {
      if (_templates[i].id === id) { t = _templates[i]; break; }
    }
    if (!t) return;
    _selectedId = t.id;
    _name       = t.name;
    _subject    = t.subject || '';
    _content    = t.content || '';
    _mode       = 'edit';
    _renderAll();
  }

  function _resetForm() {
    _selectedId = '';
    _name       = '';
    _subject    = '';
    _content    = '';
    _mode       = 'create';
    _renderAll();
  }

  /* ── DOM refs ─────────────────────────────────────────── */

  function $id(id) { return document.getElementById(id); }

  /* ── Build / update ───────────────────────────────────── */

  function _renderSidebar() {
    var listEl = $id('tpl-mgr-list');
    if (!listEl) return;

    if (_templates.length === 0) {
      listEl.innerHTML = '<div class="tpl-mgr-empty">No templates yet. Click <strong>New</strong> to create one.</div>';
      return;
    }

    listEl.innerHTML = _templates.map(function(t) {
      var active = t.id === _selectedId ? ' tpl-mgr-list-item--active' : '';
      return '<button type="button" class="tpl-mgr-list-item' + active + '" data-tpl-id="' + _esc(t.id) + '">' +
               '<span class="tpl-mgr-item-name">' + _esc(t.name) + '</span>' +
               (t.subject ? '<span class="tpl-mgr-item-subject">' + _esc(t.subject) + '</span>' : '') +
             '</button>';
    }).join('');

    listEl.querySelectorAll('.tpl-mgr-list-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _loadTemplate(btn.getAttribute('data-tpl-id'));
      });
    });
  }

  function _renderPreview() {
    _refreshDataMap();
    var subjectEl = $id('tpl-mgr-preview-subject');
    var contentEl = $id('tpl-mgr-preview-content');
    var warnEl    = $id('tpl-mgr-missing-warn');
    if (!subjectEl || !contentEl || !warnEl) return;

    var combined  = _subject + '\n' + _content;
    var val       = tplValidate(combined, _dataMap);
    var previewSub = tplRender(_subject, _dataMap, { missing: 'keep' });
    var previewCnt = tplRender(_content, _dataMap, { missing: 'keep' });

    subjectEl.textContent = previewSub || '(no subject)';
    contentEl.textContent = previewCnt || '(no content)';

    if (val.missing.length) {
      warnEl.innerHTML = '&#9888; Missing data for: ' +
        val.missing.map(function(k) { return '<code>[' + _esc(k) + ']</code>'; }).join(', ');
      warnEl.style.display = '';
    } else {
      warnEl.style.display = 'none';
    }
  }

  function _renderTitle() {
    var el = $id('tpl-mgr-form-title');
    if (el) el.textContent = _mode === 'create' ? 'New template' : 'Edit template';
  }

  function _renderDeleteBtn() {
    var el = $id('tpl-mgr-delete-btn');
    if (el) el.style.display = _mode === 'edit' ? '' : 'none';
  }

  function _syncFormFields() {
    var nameEl    = $id('tpl-mgr-name');
    var subjectEl = $id('tpl-mgr-subject');
    var contentEl = $id('tpl-mgr-content');
    if (nameEl)    nameEl.value    = _name;
    if (subjectEl) subjectEl.value = _subject;
    if (contentEl) contentEl.value = _content;
  }

  function _renderAll() {
    _renderSidebar();
    _renderTitle();
    _renderDeleteBtn();
    _syncFormFields();
    _renderPreview();
  }

  /* ── Placeholder chip list ────────────────────────────── */

  function _renderChips() {
    var el = $id('tpl-mgr-chips');
    if (!el) return;
    el.innerHTML = TEMPLATE_PLACEHOLDERS.map(function(p) {
      var hasValue = _dataMap[p.key] && String(_dataMap[p.key]).trim() !== '';
      var cls = hasValue ? 'tpl-chip tpl-chip--filled' : 'tpl-chip tpl-chip--empty';
      var title = _esc(p.label) + ' — ' + _esc(p.description) +
                  (hasValue ? '\nCurrent value: ' + _esc(_dataMap[p.key]) : '\nNo data for this record') +
                  '\nExample: ' + _esc(p.example);
      return '<button type="button" class="' + cls + '" data-key="' + _esc(p.key) + '" title="' + title + '">' +
               '[' + _esc(p.key) + ']' +
             '</button>';
    }).join('');

    el.querySelectorAll('.tpl-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        var key   = chip.getAttribute('data-key');
        var token = '[' + key + ']';
        if (_insertTarget === 'subject') {
          var subj = $id('tpl-mgr-subject');
          if (subj) { _insertAtCursor(subj, token); _subject = subj.value; }
        } else {
          var cont = $id('tpl-mgr-content');
          if (cont) { _insertAtCursor(cont, token); _content = cont.value; }
        }
        _renderPreview();
      });
    });
  }

  function _insertAtCursor(el, text) {
    var start = el.selectionStart;
    var end   = el.selectionEnd;
    var val   = el.value;
    el.value = val.slice(0, start) + text + val.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
  }

  /* ── Save / Delete / Use ──────────────────────────────── */

  function _handleSave() {
    var nameEl    = $id('tpl-mgr-name');
    var subjectEl = $id('tpl-mgr-subject');
    var contentEl = $id('tpl-mgr-content');
    if (!nameEl || !contentEl) return;

    _name    = nameEl.value.trim();
    _subject = (subjectEl && subjectEl.value) || '';
    _content = contentEl.value || '';

    if (!_name) { alert('Please enter a template name.'); nameEl.focus(); return; }
    if (!_content.trim()) { alert('Please enter the template content.'); contentEl.focus(); return; }

    if (_mode === 'create') {
      var created = tplCreate({ name: _name, subject: _subject, content: _content });
      _templates = tplGetAll();
      _selectedId = created.id;
      _mode = 'edit';
    } else {
      tplUpdate(_selectedId, { name: _name, subject: _subject, content: _content });
      _templates = tplGetAll();
    }

    if (typeof showToast === 'function') showToast('Template saved', 'success');
    _renderAll();
  }

  function _handleDelete() {
    if (!_selectedId) return;
    var t = null;
    for (var i = 0; i < _templates.length; i++) {
      if (_templates[i].id === _selectedId) { t = _templates[i]; break; }
    }
    var tName = t ? t.name : 'this template';
    if (!confirm('Delete "' + tName + '"?')) return;
    tplDelete(_selectedId);
    _templates = tplGetAll();
    _selectedId = _templates.length ? _templates[0].id : '';
    if (_selectedId) {
      _loadTemplate(_selectedId);
    } else {
      _resetForm();
    }
  }

  function _handleUse() {
    var nameEl    = $id('tpl-mgr-name');
    var subjectEl = $id('tpl-mgr-subject');
    var contentEl = $id('tpl-mgr-content');
    if (nameEl)    _name    = nameEl.value.trim();
    if (subjectEl) _subject = subjectEl.value;
    if (contentEl) _content = contentEl.value;

    _refreshDataMap();

    var combined = (_subject || '') + '\n' + (_content || '');
    var val      = tplValidate(combined, _dataMap);
    var renderOpts = { missing: 'blank' };

    var finalSubject = tplRender(_subject, _dataMap, renderOpts);
    var finalContent = tplRender(_content, _dataMap, renderOpts);

    if (window.__TPL_DEBUG) {
      console.log('[template] use', { dataMap: _dataMap, placeholders: val.placeholders, missing: val.missing, subject: finalSubject, contentLen: finalContent.length });
    }

    if (val.missing.length && typeof showToast === 'function') {
      showToast('No data in record for: ' + val.missing.join(', ') + ' — those gaps are left empty.', 'warning', 7000);
    }

    if (typeof opts.onUse === 'function') {
      opts.onUse(finalSubject, finalContent, { missing: val.missing, placeholders: val.placeholders });
      _closeModal();
    } else {
      /* Fallback: copy to clipboard */
      var full = (finalSubject ? 'Subject: ' + finalSubject + '\n\n' : '') + finalContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(full).then(function() {
          if (typeof showToast === 'function') {
            showToast('Copied to clipboard — open Templates from a record and use “Insert” to put text into a note field.', 'info', 6000);
          }
        });
      } else {
        alert(full);
      }
    }
  }

  function _closeModal() {
    var el = $id('tpl-manager-overlay');
    if (el) el.remove();
  }

  /* ── Build HTML ───────────────────────────────────────── */

  var hasRecord = opts.record && (opts.record.forename || opts.record.surname || opts.record.policeStationName);
  var contextBadge = hasRecord
    ? '<span class="tpl-mgr-context-badge">&#128204; Live data from current record</span>'
    : '<span class="tpl-mgr-context-badge tpl-mgr-context-badge--none">&#128204; No record open — preview uses example data</span>';

  var html =
    '<div id="tpl-manager-overlay" class="tpl-mgr-overlay" role="dialog" aria-modal="true" aria-label="Template Manager">' +
      '<div class="tpl-mgr-box">' +

        /* Header */
        '<div class="tpl-mgr-header">' +
          '<div class="tpl-mgr-header-left">' +
            '<span class="tpl-mgr-header-icon">&#128196;</span>' +
            '<h2 class="tpl-mgr-header-title">Template Manager</h2>' +
            contextBadge +
          '</div>' +
          '<button type="button" class="tpl-mgr-close" id="tpl-mgr-close-btn" aria-label="Close">&times;</button>' +
        '</div>' +

        /* Body: 2-column */
        '<div class="tpl-mgr-body">' +

          /* ─ Sidebar ─ */
          '<aside class="tpl-mgr-sidebar">' +
            '<div class="tpl-mgr-sidebar-header">' +
              '<h3 class="tpl-mgr-sidebar-title">Templates</h3>' +
              '<button type="button" class="tpl-mgr-btn tpl-mgr-btn--outline" id="tpl-mgr-new-btn">+ New</button>' +
            '</div>' +
            '<div id="tpl-mgr-list" class="tpl-mgr-list"></div>' +
          '</aside>' +

          /* ─ Main ─ */
          '<main class="tpl-mgr-main">' +

            /* Form */
            '<section class="tpl-mgr-section">' +
              '<h3 id="tpl-mgr-form-title" class="tpl-mgr-section-title">Edit template</h3>' +

              '<div class="tpl-mgr-field">' +
                '<label class="tpl-mgr-label" for="tpl-mgr-name">Template name</label>' +
                '<input type="text" id="tpl-mgr-name" class="tpl-mgr-input" placeholder="Example: Bail information email">' +
              '</div>' +

              '<div class="tpl-mgr-field">' +
                '<label class="tpl-mgr-label" for="tpl-mgr-subject">Subject line</label>' +
                '<input type="text" id="tpl-mgr-subject" class="tpl-mgr-input" placeholder="Example: Bail details — [CLIENT_NAME]">' +
              '</div>' +

              '<div class="tpl-mgr-field">' +
                '<label class="tpl-mgr-label" for="tpl-mgr-content">Content</label>' +
                '<textarea id="tpl-mgr-content" class="tpl-mgr-textarea" rows="10" ' +
                  'placeholder="Dear [CLIENT_NAME],\n\nYour bail return date is [BAIL_RETURN_DATE].\n\nKind regards,\n[SOLICITOR_NAME]"></textarea>' +
              '</div>' +

              '<div class="tpl-mgr-actions">' +
                '<button type="button" class="tpl-mgr-btn tpl-mgr-btn--primary" id="tpl-mgr-save-btn">Save template</button>' +
                '<button type="button" class="tpl-mgr-btn tpl-mgr-btn--outline" id="tpl-mgr-delete-btn" style="display:none">Delete</button>' +
                '<button type="button" class="tpl-mgr-btn tpl-mgr-btn--success" id="tpl-mgr-use-btn">&#10003; Use template</button>' +
              '</div>' +
            '</section>' +

            /* Insert target toggle */
            '<section class="tpl-mgr-section">' +
              '<div class="tpl-mgr-insert-header">' +
                '<h3 class="tpl-mgr-section-title">Insert placeholder</h3>' +
                '<div class="tpl-mgr-target-toggle">' +
                  '<span class="tpl-mgr-target-label">Insert into:</span>' +
                  '<button type="button" class="tpl-mgr-target-btn tpl-mgr-target-btn--active" id="tpl-mgr-target-content">Content</button>' +
                  '<button type="button" class="tpl-mgr-target-btn" id="tpl-mgr-target-subject">Subject</button>' +
                '</div>' +
              '</div>' +
              '<div id="tpl-mgr-chips" class="tpl-mgr-chips"></div>' +
            '</section>' +

            /* Preview */
            '<section class="tpl-mgr-section tpl-mgr-section--preview">' +
              '<h3 class="tpl-mgr-section-title">Live preview</h3>' +
              '<div id="tpl-mgr-missing-warn" class="tpl-mgr-warn" style="display:none"></div>' +
              '<div class="tpl-mgr-preview-block">' +
                '<div class="tpl-mgr-preview-label">Subject</div>' +
                '<div id="tpl-mgr-preview-subject" class="tpl-mgr-preview-text tpl-mgr-preview-subject"></div>' +
              '</div>' +
              '<div class="tpl-mgr-preview-block">' +
                '<div class="tpl-mgr-preview-label">Content</div>' +
                '<div id="tpl-mgr-preview-content" class="tpl-mgr-preview-text"></div>' +
              '</div>' +
            '</section>' +

          '</main>' +
        '</div>' + /* end body */

      '</div>' + /* end box */
    '</div>';   /* end overlay */

  document.body.insertAdjacentHTML('beforeend', html);

  /* ── Wire events ──────────────────────────────────────── */

  $id('tpl-mgr-close-btn').addEventListener('click', _closeModal);
  $id('tpl-manager-overlay').addEventListener('click', function(e) {
    if (e.target === this) _closeModal();
  });
  document.addEventListener('keydown', function _escHandler(e) {
    if (e.key === 'Escape') {
      _closeModal();
      document.removeEventListener('keydown', _escHandler);
    }
  });

  $id('tpl-mgr-new-btn').addEventListener('click', _resetForm);
  $id('tpl-mgr-save-btn').addEventListener('click', _handleSave);
  $id('tpl-mgr-delete-btn').addEventListener('click', _handleDelete);
  $id('tpl-mgr-use-btn').addEventListener('click', _handleUse);

  /* Live preview updates */
  ['tpl-mgr-name', 'tpl-mgr-subject', 'tpl-mgr-content'].forEach(function(id) {
    var el = $id(id);
    if (!el) return;
    el.addEventListener('input', function() {
      if (id === 'tpl-mgr-name')    _name    = el.value;
      if (id === 'tpl-mgr-subject') _subject = el.value;
      if (id === 'tpl-mgr-content') _content = el.value;
      _renderPreview();
    });
  });

  /* Insert target toggle */
  $id('tpl-mgr-target-content').addEventListener('click', function() {
    _insertTarget = 'content';
    this.classList.add('tpl-mgr-target-btn--active');
    $id('tpl-mgr-target-subject').classList.remove('tpl-mgr-target-btn--active');
  });
  $id('tpl-mgr-target-subject').addEventListener('click', function() {
    _insertTarget = 'subject';
    this.classList.add('tpl-mgr-target-btn--active');
    $id('tpl-mgr-target-content').classList.remove('tpl-mgr-target-btn--active');
  });

  /* ── Initial render ───────────────────────────────────── */

  if (_selectedId) {
    _loadTemplate(_selectedId);
  } else {
    _renderAll();
  }
  _renderChips();
}

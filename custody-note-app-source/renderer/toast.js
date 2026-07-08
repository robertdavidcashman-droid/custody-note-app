/* ═══════════════════════════════════════════════════════════
   TOAST / MODAL SYSTEM  –  replaces all alert() / confirm()
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Toast ── */
  var _toastEl = null;
  var _toastTimer = null;
  var _toastQueue = [];
  var _toastBusy = false;

  function getToastEl() {
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.id = 'cn-toast';
      _toastEl.className = 'cn-toast';
      _toastEl.setAttribute('role', 'status');
      _toastEl.setAttribute('aria-live', 'polite');
      _toastEl.setAttribute('aria-atomic', 'true');
      document.body.appendChild(_toastEl);
    }
    return _toastEl;
  }

  function _showNextToast() {
    if (!_toastQueue.length) { _toastBusy = false; return; }
    _toastBusy = true;
    var item = _toastQueue.shift();
    var el = getToastEl();
    el.textContent = item.message;
    el.className = 'cn-toast cn-toast-visible cn-toast-' + (item.type || 'info');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      el.className = 'cn-toast';
      setTimeout(function () {
        _toastBusy = false;
        if (_toastQueue.length) _showNextToast();
      }, 300);
    }, item.duration || 3500);
  }

  function showToast(message, type, duration) {
    if (message == null || message === '') return;
    if (_toastQueue.length >= 10) _toastQueue.shift();
    _toastQueue.push({ message: String(message), type: type, duration: duration });
    if (!_toastBusy) _showNextToast();
  }

  /* ── Confirm modal ── */
  function showConfirm(message, title) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'cn-confirm-overlay';

      var box = document.createElement('div');
      box.className = 'cn-confirm-box';

      if (title) {
        var h = document.createElement('h3');
        h.className = 'cn-confirm-title';
        h.textContent = title;
        box.appendChild(h);
      }

      var p = document.createElement('p');
      p.className = 'cn-confirm-msg';
      p.style.whiteSpace = 'pre-line';
      p.textContent = message;
      box.appendChild(p);

      var btns = document.createElement('div');
      btns.className = 'cn-confirm-btns';

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Cancel';

      var okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn btn-primary';
      okBtn.textContent = 'OK';

      btns.appendChild(cancelBtn);
      btns.appendChild(okBtn);
      box.appendChild(btns);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      function esc(e) { if (e.key === 'Escape') done(false); }

      function done(result) {
        document.removeEventListener('keydown', esc);
        document.body.removeChild(overlay);
        resolve(result);
      }

      okBtn.addEventListener('click', function () { done(true); });
      cancelBtn.addEventListener('click', function () { done(false); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done(false); });
      document.addEventListener('keydown', esc);
      okBtn.focus();
    });
  }

  /* ── Prompt (text input) modal ── */
  function showPrompt(message, title, placeholder, defaultValue) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'cn-confirm-overlay';

      var box = document.createElement('div');
      box.className = 'cn-confirm-box';

      if (title) {
        var h = document.createElement('h3');
        h.className = 'cn-confirm-title';
        h.textContent = title;
        box.appendChild(h);
      }

      var p = document.createElement('p');
      p.className = 'cn-confirm-msg';
      p.style.whiteSpace = 'pre-line';
      p.textContent = message;
      box.appendChild(p);

      var input = document.createElement('textarea');
      input.className = 'form-input';
      input.rows = 3;
      input.placeholder = placeholder || '';
      input.value = (defaultValue != null && defaultValue !== '') ? String(defaultValue) : '';
      input.style.width = '100%';
      input.style.marginTop = '0.75rem';
      input.style.marginBottom = '0.75rem';
      input.style.boxSizing = 'border-box';
      box.appendChild(input);

      var btns = document.createElement('div');
      btns.className = 'cn-confirm-btns';

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Cancel';

      var okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn btn-primary';
      okBtn.textContent = 'OK';

      btns.appendChild(cancelBtn);
      btns.appendChild(okBtn);
      box.appendChild(btns);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      function esc(e) { if (e.key === 'Escape') done(null); }

      function done(result) {
        document.removeEventListener('keydown', esc);
        document.body.removeChild(overlay);
        resolve(result);
      }

      okBtn.addEventListener('click', function () { done(input.value ? input.value.trim() : ''); });
      cancelBtn.addEventListener('click', function () { done(null); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done(null); });
      document.addEventListener('keydown', esc);
      input.focus();
    });
  }

  /* ── Generic modal ── */
  function showModal(title, html) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'cn-confirm-overlay';

      var box = document.createElement('div');
      box.className = 'cn-confirm-box cn-modal-box';

      var h = document.createElement('h3');
      h.className = 'cn-confirm-title';
      h.textContent = title;
      box.appendChild(h);

      var body = document.createElement('div');
      body.className = 'cn-modal-body';
      body.innerHTML = html;
      box.appendChild(body);

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn btn-secondary';
      closeBtn.textContent = 'Close';
      closeBtn.style.marginTop = '1rem';
      closeBtn.style.width = '100%';
      box.appendChild(closeBtn);

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      function esc(e) { if (e.key === 'Escape') done(); }

      function done() {
        document.removeEventListener('keydown', esc);
        document.body.removeChild(overlay);
        resolve();
      }

      closeBtn.addEventListener('click', done);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done(); });
      document.addEventListener('keydown', esc);
    });
  }

  /* ── Choice modal (multi-option) ──
     options: [{ id: 'a', label: 'Do A', variant: 'primary'|'secondary'|'danger' }, ...]
     Resolves with the id of the chosen option, or null if dismissed.            */
  function showChoice(message, title, options) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'cn-confirm-overlay';

      var box = document.createElement('div');
      box.className = 'cn-confirm-box';

      if (title) {
        var h = document.createElement('h3');
        h.className = 'cn-confirm-title';
        h.textContent = title;
        box.appendChild(h);
      }

      var p = document.createElement('p');
      p.className = 'cn-confirm-msg';
      p.style.whiteSpace = 'pre-line';
      p.textContent = message;
      box.appendChild(p);

      var btns = document.createElement('div');
      btns.className = 'cn-confirm-btns cn-confirm-btns--stacked';

      function done(result) {
        document.removeEventListener('keydown', esc);
        if (overlay.parentNode) document.body.removeChild(overlay);
        resolve(result);
      }
      function esc(e) { if (e.key === 'Escape') done(null); }

      var safeOptions = Array.isArray(options) ? options : [];
      safeOptions.forEach(function (opt, i) {
        var b = document.createElement('button');
        b.type = 'button';
        var variant = opt.variant === 'danger' ? 'btn btn-danger'
          : opt.variant === 'secondary' ? 'btn btn-secondary'
          : 'btn btn-primary';
        b.className = variant;
        b.textContent = opt.label;
        b.addEventListener('click', function () { done(opt.id); });
        btns.appendChild(b);
        if (i === 0) setTimeout(function () { try { b.focus(); } catch (e) {} }, 0);
      });

      box.appendChild(btns);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      overlay.addEventListener('click', function (e) { if (e.target === overlay) done(null); });
      document.addEventListener('keydown', esc);
    });
  }

  /* Export to global scope */
  window.showToast = showToast;
  window.showConfirm = showConfirm;
  window.showPrompt = showPrompt;
  window.showModal = showModal;
  window.showChoice = showChoice;
})();

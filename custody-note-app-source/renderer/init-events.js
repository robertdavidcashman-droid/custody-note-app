// Replaces all inline event handlers and inline <script> code that was
// in index.html so that 'unsafe-inline' can be removed from script-src CSP.
// Loaded last in the script order so all renderer functions are already defined.
(function () {

  // 1. Authority record-picker close button
  var pickerClose = document.getElementById('authority-record-picker-close');
  if (pickerClose) {
    pickerClose.addEventListener('click', function () { _closeAuthorityRecordPicker(); });
  }

  // 2. Authority fill-modal close button
  var fillClose = document.getElementById('authority-fill-modal-close');
  if (fillClose) {
    fillClose.addEventListener('click', function () { _closeAuthorityFillModal(); });
  }

  // 3. External-link anchors using data-ext-href attribute (help page + help modal)
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-ext-href]');
    if (!el) return;
    e.preventDefault();
    var url = el.getAttribute('data-ext-href');
    if (url && window.api && window.api.openExternal) window.api.openExternal(url);
  });

  // 4. Unregister stale service workers (not used in Electron)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister(); });
      if (regs.length) console.log('[SW] Unregistered', regs.length, 'stale service worker(s)');
    });
    if ('caches' in window) {
      caches.keys().then(function (names) {
        names.forEach(function (n) { caches.delete(n); });
        if (names.length) console.log('[SW] Cleared', names.length, 'cache(s)');
      });
    }
  }

  // 5. Fallback: if init() never runs (e.g. script error), hide splash after 9s
  setTimeout(function () {
    var s = document.getElementById('splash');
    if (s && s.parentNode) {
      s.classList.add('fade-out');
      setTimeout(function () { s.remove(); }, 600);
    }
  }, 9000);

  // 6. Admin panel toggle: Ctrl+Shift+A
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      var panel = document.getElementById('admin-licence-panel');
      if (panel) {
        var show = panel.style.display !== 'flex';
        panel.style.display = show ? 'flex' : 'none';
      }
    }
  });

  /* 7. Preload-failure guard.
        If the preload script never ran (e.g. esbuild bundling failed because
        a `lib/*.js` file referenced in preload.js is missing), every
        contextBridge.exposeInMainWorld call is skipped and window.api,
        window.custodyNoteBuildInfo are undefined.
        Without this guard the user sees the splash → faded splash → empty
        shell with a "www.custodynote.com" link inside the splash advert,
        which can be mistaken for a marketing page. We surface a clear,
        in-app diagnostic instead. Runs after 1500 ms so the normal preload
        path (sync, < 100 ms) is unaffected. */
  function _showPreloadFailureOverlay(detail) {
    if (document.getElementById('custody-preload-failure')) return;
    var splash = document.getElementById('splash');
    if (splash && splash.parentNode) {
      try { splash.classList.add('fade-out'); setTimeout(function () { splash.remove(); }, 300); } catch (_) {}
    }
    var overlay = document.createElement('div');
    overlay.id = 'custody-preload-failure';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Custody Note startup error');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:200000;'
      + 'background:rgba(15,23,42,0.97);color:#e2e8f0;'
      + 'display:flex;align-items:center;justify-content:center;'
      + 'font-family:"Segoe UI",system-ui,sans-serif;padding:1.5rem;';
    var box = document.createElement('div');
    box.style.cssText = 'max-width:560px;background:#1e293b;border:1px solid rgba(255,255,255,0.12);'
      + 'border-radius:1rem;padding:2rem 2.25rem;box-shadow:0 20px 60px rgba(0,0,0,0.5);';
    var h = document.createElement('h2');
    h.textContent = 'Custody Note could not start cleanly';
    h.style.cssText = 'margin:0 0 0.75rem;font-size:1.25rem;color:#f8fafc;';
    var p1 = document.createElement('p');
    p1.style.cssText = 'margin:0 0 0.75rem;font-size:0.95rem;line-height:1.5;color:#cbd5e1;';
    p1.textContent = 'The desktop app loaded but the preload bridge between the app shell and '
      + 'the secure desktop process failed. Records cannot be opened, saved, or exported '
      + 'until this is fixed. This is NOT a marketing page or trial — your local data is '
      + 'still on disk and untouched.';
    var p2 = document.createElement('p');
    p2.style.cssText = 'margin:0 0 1rem;font-size:0.9rem;line-height:1.5;color:#94a3b8;';
    p2.innerHTML = '<strong>What to try:</strong><br>'
      + '&bull; Close Custody Note and reopen it from the Start Menu shortcut named '
      + '<strong>Custody Note</strong> (not the Chrome Apps shortcut).<br>'
      + '&bull; If the problem persists, run the latest installer (Custody-Note-Setup-x.y.z.exe) '
      + 'over the existing install &mdash; this never deletes records.<br>'
      + '&bull; The full diagnostic is in the start log at the path below.';
    var diag = document.createElement('pre');
    diag.style.cssText = 'background:#0f172a;border-radius:0.5rem;padding:0.75rem;'
      + 'font-size:0.78rem;font-family:Consolas,monospace;white-space:pre-wrap;'
      + 'word-break:break-word;color:#fca5a5;max-height:140px;overflow:auto;';
    var detailMsg = (detail && detail.message) ? String(detail.message) : 'preload script did not load';
    diag.textContent = detailMsg.length > 1200 ? detailMsg.slice(0, 1200) + '\n...' : detailMsg;
    box.appendChild(h);
    box.appendChild(p1);
    box.appendChild(p2);
    box.appendChild(diag);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  function _showPartialPreloadBanner(modules) {
    if (!modules || !modules.length) return;
    if (document.getElementById('custody-preload-partial')) return;
    var banner = document.createElement('div');
    banner.id = 'custody-preload-partial';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:150000;'
      + 'background:#7f1d1d;color:#fee2e2;padding:0.55rem 1rem;'
      + 'font-family:"Segoe UI",system-ui,sans-serif;font-size:0.85rem;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,0.4);';
    var names = modules.map(function (m) { return m && m.module ? m.module : '?'; }).join(', ');
    banner.innerHTML = '<strong>Custody Note: degraded preload.</strong> '
      + 'Email helpers unavailable (' + names + '). Other features still work. '
      + 'Reinstall the latest version to recover.';
    document.body.insertBefore(banner, document.body.firstChild);
  }

  document.addEventListener('custody-preload-error', function () {
    _showPreloadFailureOverlay(window.__custodyNotePreloadError);
  });

  setTimeout(function () {
    var hasApi = !!(window.api && typeof window.api.licenceStatus === 'function');
    var info = window.custodyNoteBuildInfo;
    if (!hasApi || !info) {
      _showPreloadFailureOverlay(window.__custodyNotePreloadError || {
        message: 'window.api / window.custodyNoteBuildInfo not exposed by preload.',
      });
      return;
    }
    if (info.preloadOk === false) {
      _showPartialPreloadBanner(info.preloadModuleErrors || []);
    }
  }, 1500);

})();

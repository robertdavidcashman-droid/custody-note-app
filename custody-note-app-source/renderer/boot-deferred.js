/**
 * Cold-start deferred script loader.
 *
 * Heavy views / LAA / billing / AI / wheel-picker scripts are NOT parse-blocking
 * on first paint. They load after the first frame (idle callback), or sooner if
 * a feature calls window.__cnEnsureDeferredScripts().
 *
 * Order matches the previous index.html <script> list (dependency-safe).
 */
(function () {
  'use strict';

  var DEFERRED_SCRIPTS = [
    'renderer/aiLawElements.js',
    'renderer/widgets/wheelDateTimePicker.js',
    'renderer/views/officerEmailsPanel.js',
    'renderer/views/officerEmailsStandalone.js',
    'renderer/views/reports.js',
    'renderer/views/authorities.js',
    'renderer/views/settings.js',
    'renderer/views/list.js',
    'renderer/csv-exporter.js',
    'renderer/laa-forms.js',
    'renderer/filenameUtils.js',
    'renderer/billingUtils.js',
    'renderer/views/billing.js',
    'renderer/views/workflow-stepper.js',
    'renderer/views/documents-screen.js',
    'renderer/views/billing-screen.js',
    'renderer/views/completion-screen.js',
    'renderer/views/station-mileage-admin.js',
    'renderer/audit-log.js',
    'renderer/templateSystem/placeholders.js',
    'renderer/templateSystem/templateEngine.js',
    'renderer/templateSystem/templateStore.js',
    'renderer/templateSystem/templateManager.js',
  ];

  var _promise = null;
  var _done = false;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () { resolve(src); };
      s.onerror = function () { reject(new Error('[boot-deferred] failed to load ' + src)); };
      (document.body || document.documentElement).appendChild(s);
    });
  }

  function ensureDeferredScripts() {
    if (_done) return Promise.resolve();
    if (_promise) return _promise;
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    _promise = DEFERRED_SCRIPTS.reduce(function (chain, src) {
      return chain.then(function () { return loadScript(src); });
    }, Promise.resolve()).then(function () {
      _done = true;
      try {
        var ms = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
        console.log('[Boot] deferred-scripts-loaded ' + ms);
      } catch (_) {}
      try {
        if (window.OfficerEmailsPanel && typeof window.OfficerEmailsPanel.init === 'function') {
          window.OfficerEmailsPanel.init();
        }
      } catch (e) { console.error('[boot-deferred] OfficerEmailsPanel.init', e); }
      try {
        if (window.OfficerEmailsStandalone && typeof window.OfficerEmailsStandalone.init === 'function') {
          window.OfficerEmailsStandalone.init();
        }
      } catch (e) { console.error('[boot-deferred] OfficerEmailsStandalone.init', e); }
      try {
        if (typeof tplStoreInit === 'function') {
          tplStoreInit().catch(function () {});
        }
      } catch (_) {}
    }).catch(function (err) {
      console.error(err && err.message ? err.message : err);
      _promise = null;
      throw err;
    });
    return _promise;
  }

  window.__cnEnsureDeferredScripts = ensureDeferredScripts;
  window.__cnDeferredScriptList = DEFERRED_SCRIPTS.slice();

  function kickoff() {
    var run = function () { ensureDeferredScripts().catch(function () {}); };
    /* Start immediately after critical path — overlaps splash / init IPC. */
    setTimeout(run, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kickoff);
  } else {
    kickoff();
  }
})();

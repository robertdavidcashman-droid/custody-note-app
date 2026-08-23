/**
 * Home Updates strip — product / workflow tips (not legal advice).
 * Bundled fallback + optional refresh from custodynote.com/product-tips.json.
 */
(function (root) {
  'use strict';

  var REMOTE_URL = 'https://custodynote.com/product-tips.json';
  var DISMISS_KEY = 'cn_tips_dismissed_ids';
  var CACHE_KEY = 'cn_tips_cache_v1';

  var FALLBACK_TIPS = [
    {
      id: 'pace-breaks',
      title: 'PACE tip',
      body: 'Note interview breaks and refreshments — Code C expects a clear record of welfare pauses.',
      href: 'https://custodynote.com/pace-custody-note-requirements',
    },
    {
      id: 'dscc-ref',
      title: 'Billing tip',
      body: 'Capture the DSCC reference (or private-matter reason) before you leave the station — it is hard to reconstruct later.',
      href: 'https://custodynote.com/attendance-notes-legal-aid-billing',
    },
    {
      id: 'free-pro',
      title: 'Free during beta',
      body: 'Free during beta. No credit card. Paid Pro planned after beta. Core notes, PDF and local backup stay free while we test; managed cloud backup is planned for Pro.',
      href: 'https://custodynote.com/pricing',
    },
    {
      id: 'invite',
      title: 'Invite a colleague',
      body: 'Share Custody Note with another rep — free during beta. No credit card. Paid Pro planned after beta.',
      href: 'https://custodynote.com/download',
    },
    {
      id: 'offline',
      title: 'Offline-first',
      body: 'Your database lives on this device. Finish the note in the custody suite even with no signal.',
      href: 'https://custodynote.com/offline-attendance-note-software',
    },
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readDismissed() {
    try {
      var raw = localStorage.getItem(DISMISS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function rememberDismissed(id) {
    try {
      var list = readDismissed();
      if (list.indexOf(id) === -1) list.push(id);
      if (list.length > 40) list = list.slice(-40);
      localStorage.setItem(DISMISS_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function loadCachedTips() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && Array.isArray(parsed.tips) && parsed.tips.length) return parsed.tips;
    } catch (_) {}
    return FALLBACK_TIPS.slice();
  }

  function cacheTips(tips) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), tips: tips }));
    } catch (_) {}
  }

  function pickTip(tips) {
    var dismissed = readDismissed();
    var available = (tips || []).filter(function (t) {
      return t && t.id && dismissed.indexOf(t.id) === -1;
    });
    if (!available.length) available = tips && tips.length ? tips : FALLBACK_TIPS;
    if (!available.length) return null;
    var dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000)) % available.length;
    return available[dayIndex];
  }

  function openHref(href) {
    if (!href) return;
    if (window.api && typeof window.api.openExternal === 'function') {
      window.api.openExternal(href);
      return;
    }
    try {
      window.open(href, '_blank', 'noopener');
    } catch (_) {}
  }

  function renderTip(tip) {
    var rootEl = document.getElementById('home-tips-strip');
    if (!rootEl || !tip) {
      if (rootEl) rootEl.style.display = 'none';
      return;
    }
    rootEl.style.display = '';
    var titleEl = document.getElementById('home-tips-title');
    var bodyEl = document.getElementById('home-tips-body');
    var linkEl = document.getElementById('home-tips-link');
    if (titleEl) titleEl.textContent = tip.title || 'Tip';
    if (bodyEl) bodyEl.textContent = tip.body || '';
    if (linkEl) {
      if (tip.href) {
        linkEl.style.display = '';
        linkEl.href = tip.href;
        linkEl.onclick = function (e) {
          e.preventDefault();
          openHref(tip.href);
        };
      } else {
        linkEl.style.display = 'none';
      }
    }
    var dismissBtn = document.getElementById('home-tips-dismiss');
    if (dismissBtn) {
      dismissBtn.onclick = function () {
        rememberDismissed(tip.id);
        rootEl.style.display = 'none';
      };
    }
  }

  function shouldFetchRemote() {
    try {
      if (typeof window !== 'undefined' && window.__CUSTODYNOTE_E2E__) return false;
    } catch (_) {}
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    } catch (_) {}
    return true;
  }

  function refreshFromRemote(tips) {
    if (!shouldFetchRemote()) return Promise.resolve(tips);
    if (typeof fetch !== 'function') return Promise.resolve(tips);
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      try {
        if (ctrl) ctrl.abort();
      } catch (_) {}
    }, 4000);
    return fetch(REMOTE_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (!res || !res.ok) throw new Error('tips fetch failed');
        return res.json();
      })
      .then(function (data) {
        var list = Array.isArray(data) ? data : data && data.tips;
        if (!Array.isArray(list) || !list.length) return tips;
        cacheTips(list);
        return list;
      })
      .catch(function () {
        return tips;
      })
      .finally(function () {
        clearTimeout(timer);
      });
  }

  function mountHomeTipsStrip() {
    var tips = loadCachedTips();
    renderTip(pickTip(tips));
    refreshFromRemote(tips).then(function (next) {
      renderTip(pickTip(next));
    });
  }

  root.ProductTips = {
    mountHomeTipsStrip: mountHomeTipsStrip,
    pickTip: pickTip,
    FALLBACK_TIPS: FALLBACK_TIPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);

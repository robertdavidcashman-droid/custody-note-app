/* ═══════════════════════════════════════════════
   MAGIC LINK LOGIN + LICENCE GATE
   Passwordless email login with polling.
   Falls back to licence key activation.
   ═══════════════════════════════════════════════ */
(function () {
  'use strict';

  var REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  var POLL_INTERVAL_MS = 3000;
  var POLL_MAX_MS = 15 * 60 * 1000; // stop polling after 15 min

  var _licenceChecked = false;
  var _revalidateTimer = null;
  var _pollTimer = null;
  var _pollStartTime = 0;
  var _currentPollId = null;
  var _warningBanner = null;

  window.__licenceReady = false;
  window.__licenceCallbacks = [];
  window.__licenceExpired = false;
  window.__licenceNeedsValidation = false;

  function onLicenceReady(cb) {
    if (window.__licenceReady) cb();
    else window.__licenceCallbacks.push(cb);
  }
  window.onLicenceReady = onLicenceReady;

  function markReady() {
    window.__licenceReady = true;
    window.__licenceCallbacks.forEach(function (cb) { try { cb(); } catch (_) {} });
    window.__licenceCallbacks = [];
  }

  function hasRealPaidKey(status) {
    var keyStr = String(status && status.key || '');
    return !!status && !!status.key && !keyStr.startsWith('TRIAL-') && !keyStr.startsWith('ACCOUNT-');
  }

  function hasFutureExpiry(status) {
    if (!status || !status.expiresAt) return false;
    return new Date(status.expiresAt).getTime() > Date.now();
  }

  function shouldBypassLoginOverlay(status) {
    return hasRealPaidKey(status) || (hasFutureExpiry(status) && !status.isTrial);
  }

  function graceBannerMessage(status) {
    if (status && status.message) return status.message;
    var days = (status && status.graceDays) || 60;
    return 'Connect to the internet to verify your subscription — your licence is still active. (Offline grace: ' + days + ' days.)';
  }

  function clearLicenceBanner() {
    if (_warningBanner) { try { _warningBanner.remove(); } catch (_) {} _warningBanner = null; }
  }

  function handleValidationSuccess() {
    window.__licenceExpired = false;
    window.__licenceNeedsValidation = false;
    clearLicenceBanner();
    document.dispatchEvent(new CustomEvent('licence-activated'));
  }

  function runStartupValidation() {
    if (!window.api || !window.api.licenceValidate) return;
    window.api.licenceValidate().then(function (result) {
      if (result && result.valid === true) {
        handleValidationSuccess();
        startRevalidation();
      }
    }).catch(function (e) { console.error('[licence-validate]', e); });
  }

  /* ── Overlay management ── */

  function showOverlay(opts) {
    var overlay = document.getElementById('licence-overlay');
    if (!overlay) return;
    overlay.style.display = '';
    var title = document.getElementById('licence-title');
    var msg = document.getElementById('licence-message');
    var err = document.getElementById('licence-error');
    var renewSec = document.getElementById('licence-renew-section');
    var emailKeySec = document.getElementById('licence-overlay-email-key');
    if (title) title.textContent = opts.title || 'Sign in to Custody Note';
    if (msg) msg.textContent = opts.message || 'Enter the email address you used to purchase.';
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    if (renewSec) renewSec.style.display = opts.showRenew ? '' : 'none';
    if (emailKeySec) emailKeySec.style.display = opts.hideEmailKey ? 'none' : '';

    showEmailForm();

    var emailInput = document.getElementById('magic-link-email');
    var overlayEmailInput = document.getElementById('overlay-forgot-licence-email');
    var prefill = opts.prefillEmail || '';
    if (emailInput && prefill && !emailInput.value) emailInput.value = prefill;
    if (overlayEmailInput && prefill && !overlayEmailInput.value) overlayEmailInput.value = prefill;
    if (emailInput) emailInput.focus();
  }

  function hideOverlay() {
    var overlay = document.getElementById('licence-overlay');
    if (overlay) overlay.style.display = 'none';
    stopPolling();
  }

  function showError(text) {
    var err = document.getElementById('licence-error');
    if (err) { err.textContent = text; err.style.display = ''; }
  }

  function clearError() {
    var err = document.getElementById('licence-error');
    if (err) { err.textContent = ''; err.style.display = 'none'; }
  }

  /* ── UI state switching ── */

  function showEmailForm() {
    var form = document.getElementById('magic-link-form');
    var waiting = document.getElementById('magic-link-waiting');
    var fallback = document.getElementById('licence-key-fallback');
    var emailKeySec = document.getElementById('licence-overlay-email-key');
    if (form) form.style.display = '';
    if (waiting) waiting.style.display = 'none';
    if (fallback) fallback.style.display = '';
    if (emailKeySec) emailKeySec.style.display = '';
  }

  function showWaitingState(email) {
    var form = document.getElementById('magic-link-form');
    var waiting = document.getElementById('magic-link-waiting');
    var fallback = document.getElementById('licence-key-fallback');
    var emailKeySec = document.getElementById('licence-overlay-email-key');
    var sentEmail = document.getElementById('magic-link-sent-email');
    var statusEl = document.getElementById('magic-link-poll-status');
    if (form) form.style.display = 'none';
    if (waiting) waiting.style.display = '';
    if (fallback) fallback.style.display = 'none';
    if (emailKeySec) emailKeySec.style.display = 'none';
    if (sentEmail) sentEmail.textContent = email;
    if (statusEl) statusEl.textContent = 'Waiting for you to click the link\u2026';
  }

  /* ── Banners ── */

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function showWarningBanner(message, daysRemaining) {
    if (_warningBanner) { try { _warningBanner.remove(); } catch (_) {} }
    _warningBanner = document.createElement('div');
    _warningBanner.className = 'licence-warning-banner';
    if (daysRemaining != null && daysRemaining <= 2) _warningBanner.classList.add('licence-warning-critical');
    _warningBanner.innerHTML = '<span class="licence-warning-icon">&#9888;</span> <span>' + esc(message) + '</span> <button type="button" class="licence-warning-dismiss" title="Dismiss">&times;</button>';
    _warningBanner.querySelector('.licence-warning-dismiss').addEventListener('click', function () {
      _warningBanner.style.display = 'none';
    });
    var header = document.querySelector('.app-header');
    if (header) header.insertAdjacentElement('afterend', _warningBanner);
  }

  function showExpiryBanner(message) {
    if (_warningBanner) { try { _warningBanner.remove(); } catch (_) {} }
    _warningBanner = document.createElement('div');
    _warningBanner.className = 'licence-warning-banner licence-warning-critical';
    _warningBanner.innerHTML =
      '<span class="licence-warning-icon">&#9888;</span> <span>' + esc(message) + '</span> ' +
      '<a href="https://www.custodynote.com/pricing" target="_blank" rel="noopener" style="color:#fbbf24;text-decoration:underline;margin-left:0.5rem;font-weight:600;">Renew</a>' +
      ' <button type="button" class="licence-warning-dismiss" title="Dismiss" style="margin-left:0.5rem;">&times;</button>';
    _warningBanner.querySelector('.licence-warning-dismiss').addEventListener('click', function () {
      _warningBanner.style.display = 'none';
    });
    var header = document.querySelector('.app-header');
    if (header) header.insertAdjacentElement('afterend', _warningBanner);
  }

  function showGraceBanner(status) {
    window.__licenceNeedsValidation = true;
    window.__licenceExpired = false;
    showWarningBanner(graceBannerMessage(status), null);
  }

  /* ── Polling ── */

  function startPolling(pollId, email) {
    stopPolling();
    _currentPollId = pollId;
    _pollStartTime = Date.now();

    _pollTimer = setInterval(function () {
      if (Date.now() - _pollStartTime > POLL_MAX_MS) {
        stopPolling();
        showEmailForm();
        showError('Login link expired. Please send a new one.');
        return;
      }
      if (!window.api || !window.api.authPoll) return;
      var activePollId = _currentPollId;
      if (!activePollId) return;
      window.api.authPoll({ pollId: activePollId }).then(function (resp) {
        if (activePollId !== _currentPollId) return;
        if (resp.ok) {
          stopPolling();
          hideOverlay();
          markReady();
          handleValidationSuccess();
          startRevalidation();
        } else if (resp.expired) {
          stopPolling();
          showEmailForm();
          showError('Login link expired. Please send a new one.');
        }
      }).catch(function (e) { console.error('[auth-poll]', e); });
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _currentPollId = null;
  }

  /* ── Send magic link ── */

  function sendMagicLink(email, btn) {
    if (!window.api || !window.api.authMagicLink) {
      showError('Login is not available. Please restart the app.');
      return;
    }
    clearError();
    btn.disabled = true;
    btn.textContent = 'Sending\u2026';

    window.api.authMagicLink({ email: email }).then(function (resp) {
      btn.disabled = false;
      btn.textContent = 'Send login link';
      if (resp && resp.ok && resp.pollId) {
        showWaitingState(email);
        startPolling(resp.pollId, email);
      } else {
        showError(resp && resp.error ? resp.error : 'Could not send login link. Please try again.');
      }
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = 'Send login link';
      showError('Connection error. Check your internet and try again.');
    });
  }

  function requestOverlayLicenceEmail(email, btn, msgEl) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (msgEl) { msgEl.textContent = 'Enter a valid email address.'; msgEl.style.color = '#fca5a5'; }
      return;
    }
    if (window.requestLicenceKeyEmail) {
      window.requestLicenceKeyEmail(email, msgEl, btn);
      return;
    }
    if (!window.custodyNote || !window.custodyNote.requestLicenceEmail) {
      if (msgEl) { msgEl.textContent = 'Email recovery is not available. Restart the app.'; msgEl.style.color = '#fca5a5'; }
      return;
    }
    btn.disabled = true;
    if (msgEl) { msgEl.textContent = 'Sending\u2026'; msgEl.style.color = '#94a3b8'; }
    window.custodyNote.requestLicenceEmail(email).then(function (res) {
      btn.disabled = false;
      if (msgEl) {
        if (res && res.success === false) {
          msgEl.textContent = res.message || 'Could not send email. Try again or contact support.';
          msgEl.style.color = '#fca5a5';
        } else {
          msgEl.textContent = (res && res.message) || 'If that email exists in our system, your licence key has been sent. Check spam.';
          msgEl.style.color = '#86efac';
        }
      }
    }).catch(function () {
      btn.disabled = false;
      if (msgEl) { msgEl.textContent = 'Could not connect. Please try again later.'; msgEl.style.color = '#fca5a5'; }
    });
  }

  /* ── UI event binding ── */

  var _uiInited = false;

  function initLicenceUI() {
    if (_uiInited) return;
    _uiInited = true;

    var sendBtn = document.getElementById('magic-link-send-btn');
    var emailInput = document.getElementById('magic-link-email');

    if (sendBtn && emailInput) {
      sendBtn.addEventListener('click', function () {
        var email = (emailInput.value || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          showError('Please enter a valid email address.');
          return;
        }
        sendMagicLink(email, sendBtn);
      });
      emailInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); sendBtn.click(); }
      });
    }

    var overlayForgotBtn = document.getElementById('overlay-forgot-licence-btn');
    var overlayForgotEmail = document.getElementById('overlay-forgot-licence-email');
    var overlayForgotMsg = document.getElementById('overlay-forgot-licence-msg');
    if (overlayForgotBtn && overlayForgotEmail) {
      overlayForgotBtn.addEventListener('click', function () {
        requestOverlayLicenceEmail((overlayForgotEmail.value || '').trim(), overlayForgotBtn, overlayForgotMsg);
      });
      overlayForgotEmail.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); overlayForgotBtn.click(); }
      });
    }

    var resendBtn = document.getElementById('magic-link-resend-btn');
    if (resendBtn) {
      resendBtn.addEventListener('click', function () {
        var sentEmailEl = document.getElementById('magic-link-sent-email');
        var email = sentEmailEl ? sentEmailEl.textContent : '';
        if (!email) { showEmailForm(); return; }
        stopPolling();
        resendBtn.disabled = true;
        resendBtn.textContent = 'Sending\u2026';
        window.api.authMagicLink({ email: email }).then(function (resp) {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend link';
          if (resp && resp.ok && resp.pollId) {
            startPolling(resp.pollId, email);
            var statusEl = document.getElementById('magic-link-poll-status');
            if (statusEl) statusEl.textContent = 'New link sent! Waiting\u2026';
          } else {
            var statusEl = document.getElementById('magic-link-poll-status');
            if (statusEl) statusEl.textContent = resp && resp.error ? resp.error : 'Could not resend. Try again.';
          }
        }).catch(function () {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend link';
          var statusEl = document.getElementById('magic-link-poll-status');
          if (statusEl) statusEl.textContent = 'Connection error. Check your internet and try again.';
        });
      });
    }

    var changeBtn = document.getElementById('magic-link-change-btn');
    if (changeBtn) {
      changeBtn.addEventListener('click', function () {
        stopPolling();
        showEmailForm();
        var magicEmail = document.getElementById('magic-link-email');
        if (magicEmail) magicEmail.focus();
      });
    }

    var toggle = document.getElementById('licence-key-toggle');
    var keyForm = document.getElementById('licence-key-form');
    if (toggle && keyForm) {
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        keyForm.style.display = keyForm.style.display === 'none' ? '' : 'none';
      });
    }

    var activateBtn = document.getElementById('licence-activate-btn');
    if (activateBtn) {
      activateBtn.addEventListener('click', function () {
        var keyEl = document.getElementById('licence-key-input');
        var rawKey = keyEl ? keyEl.value : '';
        var key = (typeof rawKey === 'string' ? rawKey : '').replace(/\s/g, '').trim().toUpperCase();
        if (!key) { showError('Please paste your licence key.'); return; }
        activateBtn.disabled = true;
        activateBtn.textContent = 'Activating\u2026';
        window.api.licenceActivate({ key: key }).then(function (result) {
          activateBtn.disabled = false;
          activateBtn.textContent = 'Activate';
          if (result && result.success) {
            hideOverlay();
            handleValidationSuccess();
            markReady();
            startRevalidation();
          } else {
            showError(result && result.message ? result.message : 'Activation failed. Check your key and try again.');
          }
        }).catch(function (e) {
          activateBtn.disabled = false;
          activateBtn.textContent = 'Activate';
          showError('Error: ' + (e && e.message ? e.message : 'Unknown error'));
        });
      });
      var licKeyInput = document.getElementById('licence-key-input');
      if (licKeyInput) {
        licKeyInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); activateBtn.click(); }
        });
      }
    }
  }

  window.initLicenceUI = initLicenceUI;
  window.showLicenceOverlay = showOverlay;

  window.openLicenceOverlaySignIn = function () {
    showOverlay({
      title: 'Sign in to Custody Note',
      message: 'Enter the email address you used to purchase.',
    });
    initLicenceUI();
  };

  /* ── Revalidation ── */

  function startRevalidation() {
    if (_revalidateTimer) clearInterval(_revalidateTimer);
    _revalidateTimer = setInterval(function () {
      if (!window.api || !window.api.licenceValidate) return;
      window.api.licenceValidate().then(function (result) {
        if (result && result.valid === true) {
          handleValidationSuccess();
          return;
        }
        if (result && result.valid === false) {
          var st = result.status || {};
          if (st.status === 'revoked') {
            window.__licenceExpired = true;
            window.__licenceNeedsValidation = false;
            showExpiryBanner(st.message || 'Your licence has been revoked. Contact support.');
          } else if (st.status === 'expired') {
            window.__licenceExpired = true;
            window.__licenceNeedsValidation = false;
            showExpiryBanner(st.message || 'Your subscription has expired. Renew to continue creating new records.');
          } else if (st.status === 'grace_expired') {
            showGraceBanner(st);
          }
        }
      }).catch(function (e) { console.error('[licence-revalidate]', e); });
    }, REVALIDATE_INTERVAL_MS);
  }

  /* ── Initial check ── */

  function enterAppWithOptionalValidation(status) {
    hideOverlay();
    markReady();
    window.__licenceExpired = false;
    startRevalidation();
    runStartupValidation();
    if (status && status.isTrial && status.daysRemaining != null && status.status === 'active') {
      var trialMsg = 'Free trial: ' + status.daysRemaining + ' day' + (status.daysRemaining !== 1 ? 's' : '') + ' remaining';
      showWarningBanner(trialMsg, status.daysRemaining);
    }
    if (window.syncQuickFileSettingsFromAccount) {
      window.syncQuickFileSettingsFromAccount({ toastOnPull: true }).catch(function (e) {
        console.error('[qf-sync]', e);
      });
    }
  }

  function checkLicence() {
    if (_licenceChecked) return;
    _licenceChecked = true;

    try {
      var e2e = window.__CUSTODYNOTE_E2E__;
      if (e2e && e2e.skipLicenceGate) {
        hideOverlay();
        markReady();
        return;
      }
    } catch (_) {}

    if (!window.api || !window.api.licenceStatus) {
      markReady();
      return;
    }

    var authPromise = (window.api.authStatus) ? window.api.authStatus() : Promise.resolve({});

    Promise.all([window.api.licenceStatus(), authPromise]).then(function (results) {
      var status = results[0];
      var auth = results[1] || {};

      if (!status) {
        showLoginOverlay('');
        return;
      }

      if (status.status === 'error') {
        showLicenceErrorOverlay(status.message || 'Stored licence could not be read.');
        return;
      }

      var prefillEmail = status.email || auth.email || '';
      var hasAuthToken = !!auth.loggedIn;
      var hasRealKey = hasRealPaidKey(status);
      var isTrialOnly = !!status.isTrial && !hasAuthToken && !status.signInWithAccount;

      if (isTrialOnly && !hasRealKey && !shouldBypassLoginOverlay(status)) {
        showLoginOverlay(prefillEmail);
        return;
      }

      if (status.status === 'revoked') {
        window.__licenceExpired = true;
        window.__licenceNeedsValidation = false;
        hideOverlay();
        markReady();
        showExpiryBanner(status.message || 'Your licence has been revoked.');
        return;
      }

      if (status.status === 'expired') {
        window.__licenceExpired = true;
        window.__licenceNeedsValidation = false;
        hideOverlay();
        markReady();
        startRevalidation();
        var expiredMsg = status.isTrial
          ? 'Your free trial has ended. Subscribe to continue.'
          : (status.message || 'Your subscription has expired.');
        showExpiryBanner(expiredMsg);
        return;
      }

      if (status.status === 'grace_expired') {
        window.__licenceExpired = false;
        hideOverlay();
        markReady();
        showGraceBanner(status);
        startRevalidation();
        runStartupValidation();
        return;
      }

      hideOverlay();
      markReady();
      window.__licenceExpired = false;
      window.__licenceNeedsValidation = false;

      if (status.status === 'expiring_soon') {
        startRevalidation();
        showWarningBanner(status.message, status.daysRemaining || 7);
        runStartupValidation();
        return;
      }

      if (status.status === 'active') {
        enterAppWithOptionalValidation(status);
      }
    }).catch(function () {
      showLoginOverlay('');
    });
  }

  function showLoginOverlay(prefillEmail) {
    showOverlay({
      title: 'Sign in to Custody Note',
      message: 'Enter the email address you used to purchase.',
      showRenew: true,
      prefillEmail: prefillEmail || '',
    });
    initLicenceUI();
  }

  function showLicenceErrorOverlay(message) {
    markReady();
    showOverlay({
      title: 'Licence file problem',
      message: message + ' Contact support at custodynote.com/support if this continues.',
      showRenew: false,
      hideEmailKey: false,
    });
    initLicenceUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkLicence);
  } else {
    checkLicence();
  }
})();

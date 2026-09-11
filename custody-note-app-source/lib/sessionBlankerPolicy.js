'use strict';

/**
 * Credential-free OS lock blanker policy.
 *
 * Dismiss is only allowed when no real client/case content is (or may be)
 * visible. When dismiss is blocked, the blanker must still offer an escape
 * path (Quit + unlock-this-session) — never a Settings catch-22 dead-end.
 *
 * Conservative: any open attendance, meaningful form data, records list,
 * quick capture client fields, home surfaces with client/case content,
 * open scratchpad text, or officer-email compose fields blocks dismiss.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.SessionBlankerPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var DEAD_END_COPY_MARKERS = [
    'this lock cannot be dismissed',
    'set a recovery or admin password in Settings',
    'set a recovery password or admin password in Settings',
  ];

  /**
   * @param {object} state
   * @param {boolean} [state.formViewActive]
   * @param {boolean} [state.hasOpenAttendance]
   * @param {boolean} [state.hasMeaningfulFormData]
   * @param {boolean} [state.formContextBarHasText]
   * @param {boolean} [state.listViewActive]
   * @param {boolean} [state.listHasRows]
   * @param {boolean} [state.quickCaptureViewActive]
   * @param {boolean} [state.quickCaptureHasClientData]
   * @param {boolean} [state.homeViewActive]
   * @param {boolean} [state.homeHasActiveMatters]
   * @param {boolean} [state.homeHasRecentCases]
   * @param {boolean} [state.homeFocusHasClientText]
   * @param {boolean} [state.scratchpadOpenWithText]
   * @param {boolean} [state.officerEmailsViewActive]
   * @param {boolean} [state.officerEmailsHasClientData]
   * @returns {boolean}
   */
  function mayDismissCredentialFreeBlanker(state) {
    var s = state && typeof state === 'object' ? state : {};
    /* Floating scratchpad sits above every view. */
    if (s.scratchpadOpenWithText) return false;
    if (s.formViewActive) {
      if (s.hasOpenAttendance) return false;
      if (s.hasMeaningfulFormData) return false;
      if (s.formContextBarHasText) return false;
    }
    if (s.listViewActive && s.listHasRows) return false;
    if (s.quickCaptureViewActive && s.quickCaptureHasClientData) return false;
    if (s.officerEmailsViewActive && s.officerEmailsHasClientData) return false;
    if (s.homeViewActive) {
      if (s.homeHasActiveMatters) return false;
      if (s.homeHasRecentCases) return false;
      if (s.homeFocusHasClientText) return false;
    }
    return true;
  }

  function _escapeReason(reason) {
    return String(reason || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _reasonPhrase(reason) {
    if (reason) {
      return 'an OS <code>' + _escapeReason(reason) + '</code> event';
    }
    return 'an OS lock event';
  }

  /**
   * Build presentation for the credential-free blanker.
   * Never returns a dead-end (no controls) when gatherFailed or dismiss is blocked.
   *
   * @param {object} state gather result (ignored when gatherFailed)
   * @param {{ reason?: string, gatherFailed?: boolean }} [opts]
   * @returns {{
   *   mode: 'safe-dismiss' | 'sensitive-escape',
   *   allowDismiss: boolean,
   *   offerQuit: boolean,
   *   offerUnlockThisSession: boolean,
   *   heading: string,
   *   bodyHtml: string,
   *   unlockConfirmMessage: string,
   *   afterUnlockToast: string
   * }}
   */
  function resolveCredentialFreeBlankerPresentation(state, opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var gatherFailed = !!o.gatherFailed;
    var allowDismiss = false;
    if (!gatherFailed) {
      allowDismiss = mayDismissCredentialFreeBlanker(state);
    }

    var reasonPhrase = _reasonPhrase(o.reason);
    var heading = 'Session locked';
    var afterUnlockToast =
      'Set a recovery password in Settings > Security so the next lock can be unlocked properly.';
    var unlockConfirmMessage =
      'Client or case data will be visible on screen. Unlock this session anyway?';

    if (allowDismiss) {
      return {
        mode: 'safe-dismiss',
        allowDismiss: true,
        offerQuit: false,
        offerUnlockThisSession: false,
        heading: heading,
        bodyHtml:
          '<p style="max-width:36rem;line-height:1.5;">'
          + 'CustodyNote was locked because the operating system reported '
          + reasonPhrase
          + '. No recovery or admin password is set, so this is a visual lock only. '
          + 'Nothing sensitive appears to be on screen — you can dismiss and continue. '
          + 'Afterwards, set a recovery password so the next lock can be unlocked properly.</p>',
        unlockConfirmMessage: unlockConfirmMessage,
        afterUnlockToast: afterUnlockToast,
      };
    }

    var sensitiveLead = gatherFailed
      ? 'CustodyNote was locked because the operating system reported '
        + reasonPhrase
        + '. No recovery or admin password is set, and the app could not confirm '
        + 'the screen is empty of client or case data.'
      : 'CustodyNote was locked because the operating system reported '
        + reasonPhrase
        + '. No recovery or admin password is set, and client or case data may be on screen.';

    return {
      mode: 'sensitive-escape',
      allowDismiss: false,
      offerQuit: true,
      offerUnlockThisSession: true,
      heading: heading,
      bodyHtml:
        '<p style="max-width:36rem;line-height:1.5;">'
        + sensitiveLead
        + '</p>'
        + '<p style="max-width:36rem;margin-top:1rem;line-height:1.5;color:#cbd5e1;">'
        + 'Quit Custody Note and reopen when ready, or unlock this session to continue '
        + '(data will be visible). After unlocking, set a recovery password in '
        + 'Settings &gt; Security so the next lock can be unlocked properly.</p>',
      unlockConfirmMessage: unlockConfirmMessage,
      afterUnlockToast: afterUnlockToast,
    };
  }

  /**
   * True when an existing blanker DOM node already has a usable escape control
   * (Dismiss, Quit, or Unlock this session). Old dead-end overlays return false
   * so the caller may replace them.
   * @param {Element|null} el
   * @returns {boolean}
   */
  function blankerHasEscapeControls(el) {
    if (!el || typeof el.querySelector !== 'function') return false;
    return !!(
      el.querySelector('#cn-credentialfree-dismiss')
      || el.querySelector('#cn-credentialfree-quit')
      || el.querySelector('#cn-credentialfree-unlock-session')
    );
  }

  /**
   * Detect legacy dead-end copy that told users to open Settings while locked.
   * @param {string} text
   * @returns {boolean}
   */
  function isDeadEndBlankerCopy(text) {
    var t = String(text || '').toLowerCase();
    if (!t) return false;
    for (var i = 0; i < DEAD_END_COPY_MARKERS.length; i++) {
      if (t.indexOf(DEAD_END_COPY_MARKERS[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }

  return {
    mayDismissCredentialFreeBlanker: mayDismissCredentialFreeBlanker,
    resolveCredentialFreeBlankerPresentation: resolveCredentialFreeBlankerPresentation,
    blankerHasEscapeControls: blankerHasEscapeControls,
    isDeadEndBlankerCopy: isDeadEndBlankerCopy,
  };
});

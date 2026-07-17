/**
 * DB-backed QuickFile configured check for billing / completion workflow.
 * Always prefers main-process quickfile-connection-state (pulls from server when needed).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.QuickfileConfigured = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function isQuickFileConfiguredFromConnection(qfConnection) {
    if (qfConnection && Array.isArray(qfConnection.missing)) {
      return qfConnection.missing.length === 0;
    }
    return false;
  }

  function isQuickFileConfiguredFromSettings(dbSettings) {
    var s = dbSettings || (typeof window !== 'undefined' ? window._appSettingsCache : {}) || {};
    return !!(
      String(s.quickfileAccountNumber || '').trim()
      && String(s.quickfileApiKey || '').trim()
      && String(s.quickfileAppId || '').trim()
    );
  }

  /**
   * @returns {Promise<boolean>}
   */
  function fetchQuickFileConfigured() {
    if (typeof window === 'undefined' || !window.api) {
      return Promise.resolve(false);
    }
    var pConn = window.api.quickfileConnectionState
      ? window.api.quickfileConnectionState()
      : Promise.resolve(null);
    var pSettings = window.api.getSettings
      ? window.api.getSettings()
      : Promise.resolve({});
    return Promise.all([pConn, pSettings]).then(function (results) {
      var qfConnection = results[0];
      var dbSettings = results[1] || {};
      if (typeof window !== 'undefined' && dbSettings) {
        window._appSettingsCache = Object.assign({}, window._appSettingsCache || {}, dbSettings);
      }
      if (isQuickFileConfiguredFromConnection(qfConnection)) return true;
      return isQuickFileConfiguredFromSettings(dbSettings);
    }).catch(function () {
      if (typeof hasQuickFileSettingsConfigured === 'function') {
        return hasQuickFileSettingsConfigured();
      }
      return isQuickFileConfiguredFromSettings(null);
    });
  }

  return {
    fetchQuickFileConfigured: fetchQuickFileConfigured,
    isQuickFileConfiguredFromConnection: isQuickFileConfiguredFromConnection,
    isQuickFileConfiguredFromSettings: isQuickFileConfiguredFromSettings,
  };
});

const { contextBridge, ipcRenderer } = require('electron');

/* Why this helper is INLINED (and not require('./lib/emailComposeDraft'))
   ----------------------------------------------------------------------
   The renderer is sandboxed (sandbox: true) and Electron 28 bundles the
   preload at runtime via esbuild. Relative requires like
       require('./lib/emailComposeDraft')
   work in plain Node tests but FAIL when the preload is loaded from inside
   an asar at runtime, with:
       Unable to load preload script: …\app.asar\preload.js
       Error: module not found: ./lib/emailComposeDraft
   The result is that EVERY contextBridge.exposeInMainWorld call below is
   skipped, window.api / window.custodyNoteBuildInfo / window.custodyNote are undefined
   in the renderer, and app.js init() shows a "Run in Electron: npm start"
   placeholder instead of the real app — exactly the v1.6.18 symptom that
   prompted this audit.

   Inlining the helper here is the only stable fix for sandbox + asar:
       • No relative require, so esbuild has nothing to resolve.
       • lib/emailComposeDraft.js still exists for plain-Node consumers
         (tests/emailComposeDraft.module.test.js) which DON'T have the
         asar/sandbox limitation. tests/preloadIntegrity.test.js asserts
         export name parity; tests/preloadOutlookWebComposeParity.test.js keeps
         the inlined OWA compose URL builder aligned with lib/outlookWebCompose.js.
       • No behaviour change: the same export shape is re-exposed via
         contextBridge.exposeInMainWorld('CustodyEmailCompose', …) below.
*/
const custodyEmailComposeDraft = (function buildEmailComposeDraft() {
  'use strict';

  const PENDING_EMAIL_DRAFT_KEY = 'custodynite_pending_email_draft';

  function normalizeDraft(d) {
    var x = d || {};
    return {
      to: String(x.to != null ? x.to : '').trim(),
      cc: String(x.cc != null ? x.cc : ''),
      subject: String(x.subject != null ? x.subject : ''),
      body: String(x.body != null ? x.body : ''),
      templateId: String(x.templateId != null ? x.templateId : ''),
      createdAt: x.createdAt || new Date().toISOString(),
      mode: String(x.mode != null ? x.mode : ''),
    };
  }

  function buildMailtoLink(draft) {
    var d = normalizeDraft(draft);
    var to = d.to;
    var cc = d.cc;
    var subject = d.subject;
    var body = d.body;
    var parts = [];
    if (cc) parts.push('cc=' + encodeURIComponent(cc));
    if (subject) parts.push('subject=' + encodeURIComponent(subject));
    if (body) {
      var normalizedBody = body.replace(/\n/g, '\r\n');
      parts.push('body=' + encodeURIComponent(normalizedBody));
    }
    return 'mailto:' + encodeURIComponent(to || '') + (parts.length ? '?' + parts.join('&') : '');
  }

  /* Must mirror lib/outlookWebCompose.js (see tests/preloadOutlookWebComposeParity.test.js). */
  function normalizeBodyToCrlf(body) {
    return String(body == null ? '' : body)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n/g, '\r\n');
  }

  function buildOutlookWebComposeUrl(fields) {
    var f = fields || {};
    var toS = String(f.to != null ? f.to : '').trim();
    var ccS = String(f.cc != null ? f.cc : '');
    var subS = String(f.subject != null ? f.subject : '');
    var bodS = normalizeBodyToCrlf(f.body != null ? f.body : '');
    var parts = [];
    if (toS) parts.push('to=' + encodeURIComponent(toS));
    if (String(ccS).trim()) parts.push('cc=' + encodeURIComponent(ccS));
    if (subS) parts.push('subject=' + encodeURIComponent(subS));
    if (bodS) parts.push('body=' + encodeURIComponent(bodS));
    return parts.length
      ? 'https://outlook.office.com/mail/0/deeplink/compose?' + parts.join('&')
      : 'https://outlook.office.com/mail/0/deeplink/compose';
  }

  function buildOutlookWebComposeLink(draft) {
    var d = normalizeDraft(draft);
    return buildOutlookWebComposeUrl({
      to: d.to,
      cc: d.cc,
      subject: d.subject,
      body: d.body,
    });
  }

  function savePendingEmailDraft(draft, storage) {
    if (!storage || typeof storage.setItem !== 'function') {
      throw new Error('savePendingEmailDraft: storage required');
    }
    var normalized = normalizeDraft(draft);
    if (!normalized.createdAt) normalized.createdAt = new Date().toISOString();
    storage.setItem(PENDING_EMAIL_DRAFT_KEY, JSON.stringify(normalized));
  }

  function getPendingEmailDraft(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      var raw = storage.getItem(PENDING_EMAIL_DRAFT_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function clearPendingEmailDraft(storage) {
    if (!storage || typeof storage.removeItem !== 'function') return;
    storage.removeItem(PENDING_EMAIL_DRAFT_KEY);
  }

  function mergeTemplatePlaceholders(text, map) {
    map = map || {};
    return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (_, key) {
      return Object.prototype.hasOwnProperty.call(map, key) && map[key] != null
        ? String(map[key])
        : '';
    });
  }

  function normalizeMergedEmailText(text) {
    return String(text || '')
      .split('\n')
      .map(function (line) { return line.replace(/[ \t]+$/g, ''); })
      .join('\n')
      .replace(/[ \t\r\n]+$/g, '');
  }

  function openEmailDraft(draft, mode, env) {
    var d = normalizeDraft(draft);
    var m = mode != null ? String(mode) : '';
    if (!m && d.mode) m = d.mode;
    if (m !== 'mailto' && m !== 'outlook-web') m = 'mailto';

    var to = d.to;
    if (to && to.indexOf('@') < 0) {
      return false;
    }

    var link = m === 'outlook-web'
      ? buildOutlookWebComposeLink(d)
      : buildMailtoLink(d);

    env = env || {};
    var win = env.window || (typeof window !== 'undefined' ? window : globalThis);

    try {
      if (m === 'outlook-web') {
        var opened = win.open(link, '_blank', 'noopener,noreferrer');
        if (!opened) {
          console.error('openEmailDraft: browser blocked popup (window.open returned null)');
          return false;
        }
        return true;
      }
      win.location.href = link;
      return true;
    } catch (error) {
      console.error('openEmailDraft:', error);
      return false;
    }
  }

  function resumePendingEmailDraft(mode, storage, env) {
    var pending = getPendingEmailDraft(storage);
    if (!pending) return false;
    return openEmailDraft(pending, mode, env);
  }

  function createMemoryStorage() {
    var m = Object.create(null);
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null;
      },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
    };
  }

  function buildFullEmailClipboardText(draft) {
    var d = normalizeDraft(draft);
    var body = String(d.body || '');
    return 'To: ' + (d.to || '') + '\nSubject: ' + (d.subject || '') + '\n\n' + body;
  }

  return {
    PENDING_EMAIL_DRAFT_KEY: PENDING_EMAIL_DRAFT_KEY,
    normalizeDraft: normalizeDraft,
    buildMailtoLink: buildMailtoLink,
    buildOutlookWebComposeLink: buildOutlookWebComposeLink,
    savePendingEmailDraft: savePendingEmailDraft,
    getPendingEmailDraft: getPendingEmailDraft,
    clearPendingEmailDraft: clearPendingEmailDraft,
    mergeTemplatePlaceholders: mergeTemplatePlaceholders,
    normalizeMergedEmailText: normalizeMergedEmailText,
    buildFullEmailClipboardText: buildFullEmailClipboardText,
    openEmailDraft: openEmailDraft,
    resumePendingEmailDraft: resumePendingEmailDraft,
    createMemoryStorage: createMemoryStorage,
  };
})();

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),
  attendanceList: () => ipcRenderer.invoke('attendance-list'),
  attendanceListFull: () => ipcRenderer.invoke('attendance-list-full'),
  attendanceSearch: (params) => ipcRenderer.invoke('attendance-search', params),
  attendanceGet: (id) => ipcRenderer.invoke('attendance-get', id),
  attendanceSave: (payload) => ipcRenderer.invoke('attendance-save', payload),
  attendanceForceStatus: (params) => ipcRenderer.invoke('attendance-force-status', params),
  attendanceDelete: (params) => ipcRenderer.invoke('attendance-delete', params),
  attendanceArchive: (id) => ipcRenderer.invoke('attendance-archive', id),
  attendanceUnarchive: (id) => ipcRenderer.invoke('attendance-unarchive', id),
  attendanceUndelete: (id) => ipcRenderer.invoke('attendance-undelete', id),
  attendanceCheckDuplicate: (params) => ipcRenderer.invoke('attendance-check-duplicate', params),
  stationsList: () => ipcRenderer.invoke('stations-list'),
  stationsReplace: (stations) => ipcRenderer.invoke('stations-replace', stations),
  firmsList: () => ipcRenderer.invoke('firms-list'),
  firmSave: (firm) => ipcRenderer.invoke('firm-save', firm),
  firmDelete: (id) => ipcRenderer.invoke('firm-delete', id),
  firmSetDefault: (id) => ipcRenderer.invoke('firm-set-default', id),
  generateUfn: (dateStr) => ipcRenderer.invoke('generate-ufn', dateStr),
  loadReferenceData: () => ipcRenderer.invoke('load-reference-data'),
  loadMagistratesCourts: () => ipcRenderer.invoke('load-magistrates-courts'),
  saveCsv: (payload) => ipcRenderer.invoke('save-csv', payload),
  backupNow: () => ipcRenderer.invoke('backup-now'),
  officerEmails: {
    listDrafts: (custodyNoteId) => ipcRenderer.invoke('officer-email-drafts-list', custodyNoteId),
    getDraft: (id) => ipcRenderer.invoke('officer-email-drafts-get', id),
    createDraft: (data) => ipcRenderer.invoke('officer-email-drafts-create', data),
    updateDraft: (id, data) => ipcRenderer.invoke('officer-email-drafts-update', id, data),
    duplicateDraft: (id) => ipcRenderer.invoke('officer-email-drafts-duplicate', id),
    cancelDraft: (id) => ipcRenderer.invoke('officer-email-drafts-cancel', id),
    deleteDraft: (id) => ipcRenderer.invoke('officer-email-drafts-delete', id),
    markOpenedInOutlook: (id) => ipcRenderer.invoke('officer-email-drafts-mark-opened', id),
    markSentManually: (id) => ipcRenderer.invoke('officer-email-drafts-mark-sent-manually', id),
    openOutlookDraft: (id) => ipcRenderer.invoke('officer-email-drafts-open-outlook', id),
    openOneOffOutlook: (fields) => ipcRenderer.invoke('officer-email-drafts-open-one-off-outlook', fields),
    getComposeUrl: (payload) => ipcRenderer.invoke('officer-email-drafts-compose-url', payload),
    copyText: (text) => ipcRenderer.invoke('officer-email-drafts-copy', text),
    buildPreview: (fields) => ipcRenderer.invoke('officer-email-drafts-preview', fields),
  },
  flushAndBackup: () => ipcRenderer.invoke('flush-and-backup'),
  backupStatus: () => ipcRenderer.invoke('backup-status'),
  onBackupStatusChanged: (cb) => ipcRenderer.on('backup-status-changed', (_, data) => cb(data)),
  reportEditorActivity: () => ipcRenderer.send('editor-activity'),
  confirmClose: () => ipcRenderer.send('close-confirmed'),
  onCheckUnsavedChanges: (cb) => ipcRenderer.on('check-unsaved-changes', () => cb()),
  dbRepair: () => ipcRenderer.invoke('db-repair'),
  getDesktopPath: () => ipcRenderer.invoke('get-desktop-path'),
  getDbPath: () => ipcRenderer.invoke('get-db-path'),
  setRecoveryPassword: (pw) => ipcRenderer.invoke('set-recovery-password', pw),
  hasRecoveryPassword: () => ipcRenderer.invoke('has-recovery-password'),
  sessionLockStatus: () => ipcRenderer.invoke('session-lock-status'),
  sessionUnlock: (password) => ipcRenderer.invoke('session-unlock', password),
  onSessionForceLock: (cb) => ipcRenderer.on('session-force-lock', (_, data) => cb(data)),
  recoverKeyFromCloud: () => ipcRenderer.invoke('recover-key-from-cloud'),
  isDbEncrypted: () => ipcRenderer.invoke('is-db-encrypted'),
  isSafeStorageAvailable: () => ipcRenderer.invoke('is-safe-storage-available'),
  chooseFolder: (opts) => ipcRenderer.invoke('choose-folder', opts || {}),
  detectCloudFolders: () => ipcRenderer.invoke('detect-cloud-folders'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  createDesktopShortcut: () => ipcRenderer.invoke('create-desktop-shortcut'),
  openAppFolder: () => ipcRenderer.invoke('open-app-folder'),
  printToPdf: (options) => ipcRenderer.invoke('print-to-pdf', options),
  previewPdfFromHtml: (options) => ipcRenderer.invoke('preview-pdf-from-html', options),
  previewPdfBase64: (params) => ipcRenderer.invoke('preview-pdf-base64', params),
  exportDocx: (options) => ipcRenderer.invoke('export-docx', options),
  printPdfFile: (filePath) => ipcRenderer.invoke('print-pdf-file', filePath),
  quickfileFetchClients: () => ipcRenderer.invoke('quickfile-fetch-clients'),
  quickfileTestConnection: () => ipcRenderer.invoke('quickfile-test-connection'),
  quickfileSettingsStatus: () => ipcRenderer.invoke('quickfile-settings-status'),
  quickfileConnectionState: () => ipcRenderer.invoke('quickfile-connection-state'),
  quickfileSettingsPush: () => ipcRenderer.invoke('quickfile-settings-push'),
  quickfileSettingsEnsure: () => ipcRenderer.invoke('quickfile-settings-ensure'),
  quickfileSuggestNextInvoiceNumber: () => ipcRenderer.invoke('quickfile-suggest-next-invoice-number'),
  quickfileCreateInvoice: (params) => ipcRenderer.invoke('quickfile-create-invoice', params),
  /* Postcode lookup */
  postcodeLookup: (postcode) => ipcRenderer.invoke('postcode-lookup', postcode),
  /* Station mileage */
  stationMileageGet: (stationId) => ipcRenderer.invoke('station-mileage-get', stationId),
  stationsMileageList: () => ipcRenderer.invoke('stations-mileage-list'),
  stationMileageSave: (params) => ipcRenderer.invoke('station-mileage-save', params),
  stationMileageBulkSave: (stations) => ipcRenderer.invoke('station-mileage-bulk-save', stations),
  /* Billing audit log */
  billingAuditLogAdd: (params) => ipcRenderer.invoke('billing-audit-log-add', params),
  billingAuditLogGet: (attendanceId) => ipcRenderer.invoke('billing-audit-log-get', attendanceId),
  /* Billable attendances report */
  billableAttendances: () => ipcRenderer.invoke('billable-attendances'),
  billingViewRecords: () => ipcRenderer.invoke('billing-view-records'),
  attendanceInvoiceStatus: (attendanceId) => ipcRenderer.invoke('attendance-invoice-status', attendanceId),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  importRecordFromFile: () => ipcRenderer.invoke('import-record-from-file'),
  importRecordFromPath: (filePath) => ipcRenderer.invoke('import-record-from-path', filePath),
  onAutoImportImported: (cb) => ipcRenderer.on('auto-import:imported', (_, payload) => cb(payload)),
  onAutoImportError: (cb) => ipcRenderer.on('auto-import:error', (_, payload) => cb(payload)),
  /* Audit & compliance */
  auditLogGet: (id) => ipcRenderer.invoke('audit-log-get', id),
  supervisorApprove: (params) => ipcRenderer.invoke('supervisor-approve', params),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getBankHolidays: () => ipcRenderer.invoke('get-bank-holidays'),
  getSafeStorageStatus: () => ipcRenderer.invoke('get-safe-storage-status'),
  auditLogGetHistory: (id) => ipcRenderer.invoke('audit-log-get-history', id),
  attendanceExportCsv: (params) => ipcRenderer.invoke('attendance-export-csv', params),
  /* Photo file storage */
  photoSave: (params) => ipcRenderer.invoke('photo-save', params),
  photoLoad: (params) => ipcRenderer.invoke('photo-load', params),
  photoDelete: (params) => ipcRenderer.invoke('photo-delete', params),
  photosDuplicateFolder: (params) => ipcRenderer.invoke('photos-duplicate-folder', params),
  /* LAA Official PDF forms */
  laaGenerateOfficialPdf: (params) => ipcRenderer.invoke('laa-generate-official-pdf', params),
  laaOpenOfficialTemplate: (formType) => ipcRenderer.invoke('laa-open-official-template', formType),
  laaGeneratePdfBuffer: (params) => ipcRenderer.invoke('laa-generate-pdf-buffer', params),
  laaEnsureTemplates: (opts) => ipcRenderer.invoke('laa-ensure-templates', opts),
  laaGetTemplateStatus: () => ipcRenderer.invoke('laa-get-template-status'),
  onLaaTemplatesUpdated: (cb) => ipcRenderer.on('laa-templates-updated', (_, data) => cb(data)),
  htmlToPdfBuffer: (params) => ipcRenderer.invoke('html-to-pdf-buffer', params),
  /* Auth */
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authMagicLink: (params) => ipcRenderer.invoke('auth:magic-link', params),
  authPoll: (params) => ipcRenderer.invoke('auth:poll', params),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  /* Licence */
  licenceStatus: () => ipcRenderer.invoke('licence:status'),
  licenceActivate: (params) => ipcRenderer.invoke('licence:activate', params),
  licenceValidate: () => ipcRenderer.invoke('licence:validate'),
  licenceDeactivate: () => ipcRenderer.invoke('licence:deactivate'),
  licenceEmailKey: (params) => ipcRenderer.invoke('licence:email-key', params),
  licenceDeactivateMachine: () => ipcRenderer.invoke('licence:deactivate-machine'),
  prepareTrial: () => ipcRenderer.invoke('prepare-trial'),
  getS3BackupStatus: () => ipcRenderer.invoke('get-s3-backup-status'),
  testS3Backup: () => ipcRenderer.invoke('test-s3-backup'),
  onS3BackupStatus: (cb) => ipcRenderer.on('s3-backup-status', () => cb()),
  /* Managed cloud backup */
  cloudBackupStatus: () => ipcRenderer.invoke('cloud-backup-status'),
  cloudBackupCheckEntitlement: () => ipcRenderer.invoke('cloud-backup-check-entitlement'),
  cloudBackupSubscribe: () => ipcRenderer.invoke('cloud-backup-subscribe'),
  cloudBackupList: () => ipcRenderer.invoke('cloud-backup-list'),
  cloudBackupRestore: (params) => ipcRenderer.invoke('cloud-backup-restore', params),
  localBackupList: () => ipcRenderer.invoke('local-backup-list'),
  localBackupRestore: (params) => ipcRenderer.invoke('local-backup-restore', params),
  onCloudBackupStatusChanged: (cb) => ipcRenderer.on('cloud-backup-status-changed', (_, data) => cb(data)),
  /* Cross-device sync */
  syncNow: () => ipcRenderer.invoke('sync-now'),
  syncFullResync: () => ipcRenderer.invoke('sync-full-resync'),
  syncStatus: () => ipcRenderer.invoke('sync-status'),
  syncScheduleOnReconnect: () => ipcRenderer.invoke('sync-schedule-on-reconnect'),
  syncGetDiagnostics: () => ipcRenderer.invoke('sync-get-diagnostics'),
  attendanceHomeStats: () => ipcRenderer.invoke('attendance-home-stats'),
  syncForceRetry: () => ipcRenderer.invoke('sync-force-retry'),
  syncConflictsList: () => ipcRenderer.invoke('sync-conflicts-list'),
  syncConflictResolve: (params) => ipcRenderer.invoke('sync-conflict-resolve', params),
  /* Lightweight, PII-redacted (main-side) crash/error reporting sink. */
  reportClientError: (payload) => ipcRenderer.invoke('report-client-error', payload),
  onSyncStatusChanged: (cb) => ipcRenderer.on('sync-status-changed', (_, data) => cb(data)),
  onSyncPullWarning: (cb) => ipcRenderer.on('sync-pull-warning', (_, data) => cb(data)),
  onRecordsUpdatedFromSync: (cb) => ipcRenderer.on('records-updated-from-sync', (_, data) => cb(data)),
  onSyncConflictsDetected: (cb) => ipcRenderer.on('sync-conflicts-detected', (_, data) => cb(data)),
  /* Auto-update */
  onAppUpdateStatus: (cb) => ipcRenderer.on('app-update-status', (_, data) => cb(data)),
  appUpdateInstall: () => ipcRenderer.invoke('app-update-install'),
  appCheckUpdates: () => ipcRenderer.invoke('app-check-updates'),
  getAutoUpdateState: () => ipcRenderer.invoke('get-auto-update-state'),
  appUpdateResetLoop: () => ipcRenderer.invoke('app-update-reset-loop'),
  appUpdateDiagnosticInstall: () => ipcRenderer.invoke('app-update-diagnostic-install'),
});

contextBridge.exposeInMainWorld('custodyNoteBuildInfo', {
  isPackaged: process.env.CUSTODYNOTE_PACKAGED === '1',
  /** Dev / unpackaged builds — may expose extra diagnostics elsewhere. */
  isDevBuild: process.env.CUSTODYNOTE_PACKAGED !== '1' || process.env.NODE_ENV === 'development',
  /** Always true in this build because the email helper is now inlined in
      preload.js (no relative require to fail). Kept on the bridge so the
      renderer's preload-failure guard in init-events.js, the e2e tests, and
      future health-check IPCs can confirm the bridge is fully wired. */
  preloadOk: true,
  preloadModuleErrors: [],
});

/** Template merge + pending-draft helpers (lib/emailComposeDraft inlined). */
contextBridge.exposeInMainWorld('CustodyEmailCompose', custodyEmailComposeDraft);

/* Playwright / automated tests: fresh userData has no licence — allow skipping the sign-in overlay when env is set.
   H27 — never expose the E2E hook in packaged installers, even if a user
   sets the env var. Main.js sets CUSTODYNOTE_PACKAGED='1' when app.isPackaged. */
if (process.env.CUSTODYNOTE_PACKAGED !== '1') {
  contextBridge.exposeInMainWorld('__CUSTODYNOTE_E2E__', {
    skipLicenceGate: process.env.CUSTODYNOTE_E2E_SKIP_LICENCE_GATE === '1',
  });
  contextBridge.exposeInMainWorld('__cnSyncDiag', async () => {
    const status = await ipcRenderer.invoke('sync-status');
    const diag = await ipcRenderer.invoke('sync-get-diagnostics');
    const payload = { status, diag, at: new Date().toISOString() };
    console.log('[cnSyncDiag]', payload);
    return payload;
  });
}

contextBridge.exposeInMainWorld('custodyNote', {
  requestLicenceEmail: (email) => ipcRenderer.invoke('custody:requestLicenceEmail', email),
  adminLogin: (password) => ipcRenderer.invoke('custody:adminLogin', password),
  adminSetPassword: (opts) => ipcRenderer.invoke('custody:adminSetPassword', opts),
  adminHasPassword: () => ipcRenderer.invoke('custody:adminHasPassword'),
  adminSearch: (emailQuery) => ipcRenderer.invoke('custody:adminSearch', emailQuery),
  adminRevealLicence: (id) => ipcRenderer.invoke('custody:adminRevealLicence', id),
  adminResend: (id) => ipcRenderer.invoke('custody:adminResend', id),
  adminSync: () => ipcRenderer.invoke('custody:adminSync'),
  adminDashboard: () => ipcRenderer.invoke('custody:adminDashboard'),
  adminResendToEmail: (opts) => ipcRenderer.invoke('custody:adminResendToEmail', opts),
  serverConfigured: () => ipcRenderer.invoke('custody:serverConfigured'),
});

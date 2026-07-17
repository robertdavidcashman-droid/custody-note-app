/* ═══════════════════════════════════════════════════════
   TEMPLATE SYSTEM — Store
   Persists templates via window.api.setSettings() (SQLite-backed IPC).
   Settings key: customTemplatesJson
   In-memory cache avoids repeated IPC round-trips.
   ═══════════════════════════════════════════════════════ */

var _tplStoreCache = null;   /* null = not yet loaded */
var _tplStoreReady = false;

/* ── IDs ─────────────────────────────────────────────── */

function _tplCreateId() {
  return 'tpl_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
}

/* ── Normalise ───────────────────────────────────────── */

function _tplNormalise(t) {
  var now = new Date().toISOString();
  return {
    id:        String(t.id        || _tplCreateId()),
    name:      String(t.name      || 'Untitled').trim(),
    subject:   String(t.subject   || '').trim(),
    content:   String(t.content   || ''),
    createdAt: String(t.createdAt || now),
    updatedAt: String(t.updatedAt || now)
  };
}

/* ── Persist ─────────────────────────────────────────── */

function _tplPersist(templates) {
  _tplStoreCache = templates;
  var json = JSON.stringify(templates);
  /* Mirror into _appSettingsCache so other code sees it synchronously */
  if (window._appSettingsCache) {
    window._appSettingsCache.customTemplatesJson = json;
  }
  if (window.api && window.api.setSettings) {
    window.api.setSettings({ customTemplatesJson: json }).catch(function(e) {
      console.error('[templateStore] setSettings failed', e);
    });
  }
}

/* ── Bootstrap ───────────────────────────────────────── */

/**
 * Load templates from settings into cache.
 * Call once at startup; returns a Promise.
 */
function tplStoreInit() {
  if (_tplStoreReady) return Promise.resolve(_tplStoreCache);

  /* Try reading from in-memory settings first */
  var cached = window._appSettingsCache && window._appSettingsCache.customTemplatesJson;
  if (cached) {
    try {
      var parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        _tplStoreCache = parsed.map(_tplNormalise);
        _tplStoreReady = true;
        if (_tplStoreCache.length === 0) _tplSeedDefaults();
        return Promise.resolve(_tplStoreCache);
      }
    } catch (_) {}
  }

  /* Fall back to IPC read */
  if (window.api && window.api.getSettings) {
    return window.api.getSettings().then(function(s) {
      s = s || {};
      try {
        var raw = JSON.parse(s.customTemplatesJson || '[]');
        _tplStoreCache = Array.isArray(raw) ? raw.map(_tplNormalise) : [];
      } catch (_) {
        _tplStoreCache = [];
      }
      _tplStoreReady = true;
      if (_tplStoreCache.length === 0) _tplSeedDefaults();
      return _tplStoreCache;
    }).catch(function() {
      _tplStoreCache = [];
      _tplStoreReady = true;
      _tplSeedDefaults();
      return _tplStoreCache;
    });
  }

  _tplStoreCache = [];
  _tplStoreReady = true;
  _tplSeedDefaults();
  return Promise.resolve(_tplStoreCache);
}

/* ── CRUD ────────────────────────────────────────────── */

/** @returns {Array} Snapshot of all templates (sync after init). */
function tplGetAll() {
  return (_tplStoreCache || []).slice();
}

/** Create a new template and persist it. @returns {object} */
function tplCreate(input) {
  var now = new Date().toISOString();
  var t = _tplNormalise({
    id:        _tplCreateId(),
    name:      (input.name    || '').trim() || 'Untitled',
    subject:   (input.subject || '').trim(),
    content:   input.content  || '',
    createdAt: now,
    updatedAt: now
  });
  var all = tplGetAll();
  all.unshift(t);
  _tplPersist(all);
  return t;
}

/**
 * Update an existing template by id.
 * @returns {object|null} Updated template or null if not found.
 */
function tplUpdate(id, patch) {
  var all = tplGetAll();
  var idx = -1;
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return null;
  all[idx] = _tplNormalise(Object.assign({}, all[idx], patch, {
    id:        all[idx].id,
    createdAt: all[idx].createdAt,
    updatedAt: new Date().toISOString()
  }));
  _tplPersist(all);
  return all[idx];
}

/** Delete a template by id. */
function tplDelete(id) {
  _tplPersist(tplGetAll().filter(function(t) { return t.id !== id; }));
}

/* ── Default templates ───────────────────────────────── */

function _tplSeedDefaults() {
  var now = new Date().toISOString();

  var defaults = [
    {
      id: _tplCreateId(),
      name: 'Client attendance note',
      subject: 'Attendance note — [CLIENT_NAME]',
      content: [
        'Client: [CLIENT_NAME]',
        'DOB: [DOB]',
        'Custody Reference: [CUSTODY_REFERENCE]',
        'Police Station: [POLICE_STATION]',
        'Officer: [OFFICER_NAME]',
        'Interview Date: [INTERVIEW_DATE]',
        'Allegation: [ALLEGATION]',
        '',
        'Disclosure Summary:',
        '[DISCLOSURE_SUMMARY]',
        '',
        'Advice Given:',
        '[ADVICE_GIVEN]',
        '',
        'Prepared by [SOLICITOR_NAME] of [FIRM_NAME] on [TODAY_DATE] at [NOW_TIME].'
      ].join('\n'),
      createdAt: now,
      updatedAt: now
    },
    {
      id: _tplCreateId(),
      name: 'Bail information email',
      subject: 'Bail details — [CLIENT_NAME]',
      content: [
        'Dear [CLIENT_NAME],',
        '',
        'Please note the following bail details in respect of your matter.',
        '',
        'Police Station: [POLICE_STATION]',
        'Bail Return Date: [BAIL_RETURN_DATE]',
        'Bail Conditions: [BAIL_CONDITIONS]',
        '',
        'If anything is unclear, please do not hesitate to contact me.',
        '',
        'Kind regards,',
        '[SOLICITOR_NAME]',
        '[FIRM_NAME]',
        '[SOLICITOR_EMAIL]',
        '[SOLICITOR_PHONE]'
      ].join('\n'),
      createdAt: now,
      updatedAt: now
    },
    {
      id: _tplCreateId(),
      name: 'Disclosure request to officer',
      subject: '[CLIENT_NAME] — [POLICE_STATION] — [INTERVIEW_DATE]',
      content: [
        'Dear [OFFICER_NAME],',
        '',
        'I write in connection with the above-named client who was seen at [POLICE_STATION] on [INTERVIEW_DATE].',
        '',
        'Could you please provide disclosure in respect of the following allegation:',
        '',
        '[ALLEGATION]',
        '',
        'I look forward to hearing from you.',
        '',
        'Many thanks,',
        '[SOLICITOR_NAME]',
        '[FIRM_NAME]'
      ].join('\n'),
      createdAt: now,
      updatedAt: now
    }
  ];

  _tplStoreCache = defaults;
  _tplPersist(defaults);
}

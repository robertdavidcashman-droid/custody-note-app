'use strict';

const { buildOutlookWebComposeUrl } = require('./outlookWebCompose');

/**
 * Pending email draft + mailto / Outlook Web compose URL helpers.
 * Storage is injectable for tests (memory) or localStorage in renderer.
 */

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

/**
 * Same behaviour as {{name}} in email-templates.js — leaves unknown keys blank.
 */
function mergeTemplatePlaceholders(text, map) {
  map = map || {};
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, function (_, key) {
    return Object.prototype.hasOwnProperty.call(map, key) && map[key] != null
      ? String(map[key])
      : '';
  });
}

/** Trim trailing spaces per line and trailing whitespace on the merged email (preserves intentional blank lines). */
function normalizeMergedEmailText(text) {
  return String(text || '')
    .split('\n')
    .map(function (line) {
      return line.replace(/[ \t]+$/g, '');
    })
    .join('\n')
    .replace(/[ \t\r\n]+$/g, '');
}

/**
 * @param {object} draft
 * @param {'mailto'|'outlook-web'} mode
 * @param {{ window?: Window }} [env]
 * @returns {boolean}
 */
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
    } else {
      win.location.href = link;
    }
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
    setItem: function (k, v) {
      m[k] = String(v);
    },
    removeItem: function (k) {
      delete m[k];
    },
  };
}

/** Clipboard-friendly full email (To / Subject / body — user pastes manually; nothing is sent). */
function buildFullEmailClipboardText(draft) {
  var d = normalizeDraft(draft);
  var body = String(d.body || '');
  return 'To: ' + (d.to || '') + '\nSubject: ' + (d.subject || '') + '\n\n' + body;
}

module.exports = {
  PENDING_EMAIL_DRAFT_KEY,
  normalizeDraft,
  buildMailtoLink,
  buildOutlookWebComposeLink,
  savePendingEmailDraft,
  getPendingEmailDraft,
  clearPendingEmailDraft,
  mergeTemplatePlaceholders,
  normalizeMergedEmailText,
  buildFullEmailClipboardText,
  openEmailDraft,
  resumePendingEmailDraft,
  createMemoryStorage,
};

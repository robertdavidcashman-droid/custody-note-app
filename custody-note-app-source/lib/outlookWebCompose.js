'use strict';

/**
 * Outlook Web compose deeplink helpers (https://outlook.office.com/mail/0/deeplink/compose).
 *
 * Security: confidential custody-note email bodies must NOT appear in URL query
 * strings (browser history, proxy logs, referrer leaks). Default compose URLs
 * are subject-only; the full message is copied to the clipboard for paste.
 */

const OUTLOOK_WEB_COMPOSE_BASE = 'https://outlook.office.com/mail/0/deeplink/compose';

/** @deprecated use OUTLOOK_WEB_COMPOSE_URL_MAX_SAFE_LENGTH */
const DEFAULT_MAX_OUTLOOK_COMPOSE_URL_LENGTH = 1800;

const OUTLOOK_WEB_COMPOSE_URL_MAX_SAFE_LENGTH = 1800;

/** @deprecated body is no longer placed in URLs; kept for clipboard notice parity */
const TRUNCATION_CLIPBOARD_NOTICE = '[… full message copied to clipboard — paste into body …]';

/** @deprecated use TRUNCATION_CLIPBOARD_NOTICE */
const BODY_TRUNCATION_URL_SUFFIX = '\r\n' + TRUNCATION_CLIPBOARD_NOTICE;

/**
 * Normalise any mix of CR / LF / CRLF to CRLF for OWA body parameters.
 * @param {string} body
 * @returns {string}
 */
function normalizeBodyToCrlf(body) {
  return String(body == null ? '' : body)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\r\n');
}

/** @deprecated use normalizeBodyToCrlf */
const normalizeBodyNewlinesToCRLF = normalizeBodyToCrlf;

/**
 * @param {{ to?: string, cc?: string, subject?: string, body?: string }} fields
 * @param {{ includeBody?: boolean }} [options] includeBody is opt-in only (default false)
 * @returns {string}
 */
function buildOutlookWebComposeUrl(fields, options) {
  const f = fields || {};
  const opts = options || {};
  const includeBody = opts.includeBody === true;
  const toS = String(f.to != null ? f.to : '').trim();
  const ccS = String(f.cc != null ? f.cc : '');
  const subS = String(f.subject != null ? f.subject : '');
  const bodS = normalizeBodyToCrlf(f.body != null ? f.body : '');
  const parts = [];
  if (toS) parts.push('to=' + encodeURIComponent(toS));
  if (String(ccS).trim()) parts.push('cc=' + encodeURIComponent(ccS));
  if (subS) parts.push('subject=' + encodeURIComponent(subS));
  if (includeBody && bodS) parts.push('body=' + encodeURIComponent(bodS));
  return parts.length ? OUTLOOK_WEB_COMPOSE_BASE + '?' + parts.join('&') : OUTLOOK_WEB_COMPOSE_BASE;
}

/**
 * Same plain-text shape as buildFullEmailClipboardText in lib/emailComposeDraft.js
 * (To / Subject / blank line / body). Use for "copy whole draft" actions only —
 * not for paste-into-Outlook-body after a subject-only compose open.
 *
 * @param {{ to?: string, subject?: string, body?: string }} fields
 * @returns {string}
 */
function buildFullComposePlainTextForClipboard(fields) {
  const x = fields || {};
  const body = String(x.body != null ? x.body : '');
  return 'To: ' + String(x.to != null ? x.to : '') + '\nSubject: ' + String(x.subject != null ? x.subject : '') + '\n\n' + body;
}

/**
 * Body-only clipboard payload for Outlook Web paste.
 * To/Subject are already in the subject-only compose URL; pasting a To:/Subject:
 * header block into Outlook's body field often yields an empty message body.
 *
 * @param {{ body?: string } | string} fieldsOrBody
 * @returns {string}
 */
function buildBodyPlainTextForClipboard(fieldsOrBody) {
  if (fieldsOrBody == null) return '';
  if (typeof fieldsOrBody === 'string') return String(fieldsOrBody);
  return String(fieldsOrBody.body != null ? fieldsOrBody.body : '');
}

/** @deprecated use buildFullComposePlainTextForClipboard */
const buildOutlookComposeClipboardText = buildFullComposePlainTextForClipboard;

/**
 * Build a safe Outlook Web compose URL (subject-only) and clipboard text for the body.
 *
 * @param {{ to?: string, cc?: string, subject?: string, body?: string }} fields
 * @param {{ maxUrlLength?: number } | number} [optionsOrMax] legacy: number max length, or { maxUrlLength }
 * @returns {{ url: string, truncated: boolean, fullPlainTextForClipboard: string, bodyPlainTextForClipboard: string, bodyUsedInUrl: string, urlLength: number }}
 */
function truncateOutlookComposeForShellOpen(fields, optionsOrMax) {
  const f = fields || {};
  let opts = {};
  if (typeof optionsOrMax === 'number' && optionsOrMax > 0) {
    opts = { maxUrlLength: optionsOrMax };
  } else if (optionsOrMax && typeof optionsOrMax === 'object') {
    opts = optionsOrMax;
  }
  const maxLen = typeof opts.maxUrlLength === 'number' && opts.maxUrlLength > 0
    ? opts.maxUrlLength
    : OUTLOOK_WEB_COMPOSE_URL_MAX_SAFE_LENGTH;

  const toS = String(f.to != null ? f.to : '').trim();
  const ccS = String(f.cc != null ? f.cc : '');
  const subS = String(f.subject != null ? f.subject : '');
  const rawBody = String(f.body != null ? f.body : '');
  const hasBody = Boolean(rawBody.trim());

  const fullPlainTextForClipboard = buildFullComposePlainTextForClipboard({
    to: toS,
    subject: subS,
    body: rawBody,
  });
  const bodyPlainTextForClipboard = buildBodyPlainTextForClipboard(rawBody);

  function urlFor(subjectUsed, ccUsed) {
    return buildOutlookWebComposeUrl(
      { to: toS, cc: ccUsed, subject: subjectUsed },
      { includeBody: false }
    );
  }

  let subjectWork = subS;
  while (subjectWork.length > 0 && urlFor(subjectWork, ccS).length > maxLen) {
    subjectWork = subjectWork.slice(0, Math.max(0, subjectWork.length - 100));
  }

  let url = urlFor(subjectWork, ccS);
  if (url.length > maxLen && String(ccS).trim()) {
    return truncateOutlookComposeForShellOpen(
      { to: toS, cc: '', subject: subS, body: rawBody },
      opts
    );
  }
  if (url.length > maxLen) {
    url = OUTLOOK_WEB_COMPOSE_BASE;
  }

  return {
    url,
    truncated: hasBody,
    fullPlainTextForClipboard,
    bodyPlainTextForClipboard,
    bodyUsedInUrl: '',
    urlLength: url.length,
  };
}

module.exports = {
  OUTLOOK_WEB_COMPOSE_BASE,
  OUTLOOK_WEB_COMPOSE_URL_MAX_SAFE_LENGTH,
  DEFAULT_MAX_OUTLOOK_COMPOSE_URL_LENGTH,
  TRUNCATION_CLIPBOARD_NOTICE,
  BODY_TRUNCATION_URL_SUFFIX,
  normalizeBodyToCrlf,
  normalizeBodyNewlinesToCRLF,
  buildOutlookWebComposeUrl,
  buildFullComposePlainTextForClipboard,
  buildBodyPlainTextForClipboard,
  buildOutlookComposeClipboardText,
  truncateOutlookComposeForShellOpen,
};

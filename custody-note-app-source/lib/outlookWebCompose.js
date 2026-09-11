'use strict';

/**
 * Outlook compose helpers for officer emails and related flows.
 *
 * Launch strategy (body must appear IN Outlook — clipboard paste is not OK):
 *   1. Build an Outlook Web compose URL that includes to, subject, AND body
 *      when the full URL fits within a safe length.
 *   2. If the URL would be too long (typical for longer officer emails),
 *      return an .eml draft payload instead — Outlook desktop opens it with
 *      the full body via X-Unsent: 1 (HTML + quoted-printable; see outlookComposeEml).
 *
 * Confidential bodies are preferred off the URL when possible (.eml path).
 * Short messages that fit use the OWA body= query param (encodeURIComponent once).
 */

const { buildOutlookComposeEmlContent } = require('./outlookComposeEml');

const OUTLOOK_WEB_COMPOSE_BASE = 'https://outlook.office.com/mail/0/deeplink/compose';

/** @deprecated use OUTLOOK_WEB_COMPOSE_URL_MAX_SAFE_LENGTH */
const DEFAULT_MAX_OUTLOOK_COMPOSE_URL_LENGTH = 1800;

/**
 * Conservative max for shell.openExternal / browser hand-off. Longer messages
 * use the .eml path so the body is never silently dropped.
 */
const OUTLOOK_WEB_COMPOSE_URL_MAX_SAFE_LENGTH = 1800;

/** @deprecated clipboard paste is no longer the primary body path */
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
 * @param {{ includeBody?: boolean }} [options] includeBody defaults to false for
 *   legacy callers; prepareOutlookComposeForOpen always opts in when using OWA.
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
 * (To / Subject / blank line / body). Use for "copy whole draft" actions only.
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
 * Body-only clipboard payload (Copy body button / optional secondary aid).
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
 * Prepare an Outlook launch that places the current body INTO Outlook.
 *
 * @param {{ to?: string, cc?: string, subject?: string, body?: string }} fields
 * @param {{ maxUrlLength?: number } | number} [optionsOrMax]
 * @returns {{
 *   method: 'outlook-web' | 'outlook-desktop-eml',
 *   url: string,
 *   emlContent: string,
 *   truncated: boolean,
 *   bodyPlacedInCompose: boolean,
 *   fullPlainTextForClipboard: string,
 *   bodyPlainTextForClipboard: string,
 *   bodyUsedInUrl: string,
 *   urlLength: number,
 *   to: string,
 *   subject: string,
 *   body: string
 * }}
 */
function prepareOutlookComposeForOpen(fields, optionsOrMax) {
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

  const urlWithBody = buildOutlookWebComposeUrl(
    { to: toS, cc: ccS, subject: subS, body: rawBody },
    { includeBody: true }
  );

  if (!hasBody || urlWithBody.length <= maxLen) {
    /* Empty body: still open subject/to only. Non-empty body that fits: put it in the URL. */
    return {
      method: 'outlook-web',
      url: urlWithBody,
      emlContent: '',
      truncated: false,
      bodyPlacedInCompose: hasBody,
      fullPlainTextForClipboard,
      bodyPlainTextForClipboard,
      bodyUsedInUrl: hasBody ? normalizeBodyToCrlf(rawBody) : '',
      urlLength: urlWithBody.length,
      to: toS,
      subject: subS,
      body: rawBody,
    };
  }

  /* Body too long for a reliable OWA URL — open Outlook desktop via .eml. */
  const emlContent = buildOutlookComposeEmlContent({
    to: toS,
    cc: ccS,
    subject: subS,
    body: rawBody,
  });
  const subjectOnlyUrl = buildOutlookWebComposeUrl(
    { to: toS, cc: ccS, subject: subS, body: '' },
    { includeBody: false }
  );

  return {
    method: 'outlook-desktop-eml',
    url: subjectOnlyUrl,
    emlContent,
    truncated: false,
    bodyPlacedInCompose: true,
    fullPlainTextForClipboard,
    bodyPlainTextForClipboard,
    bodyUsedInUrl: '',
    urlLength: subjectOnlyUrl.length,
    to: toS,
    subject: subS,
    body: rawBody,
  };
}

/**
 * @deprecated Prefer prepareOutlookComposeForOpen — same return shape plus method/emlContent.
 * Kept so existing call sites and tests that still import this name keep working.
 */
function truncateOutlookComposeForShellOpen(fields, optionsOrMax) {
  return prepareOutlookComposeForOpen(fields, optionsOrMax);
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
  prepareOutlookComposeForOpen,
  truncateOutlookComposeForShellOpen,
};

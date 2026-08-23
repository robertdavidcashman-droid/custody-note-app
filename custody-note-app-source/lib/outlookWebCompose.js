'use strict';

/**
 * Outlook compose helpers for officer emails and related flows.
 *
 * Launch strategy (body must appear IN Outlook — clipboard paste is not OK):
 *   1. Open Outlook (default): always use an X-Unsent .eml draft when the body
 *      is non-empty. OWA `body=` is unreliable (often opens compose with an empty
 *      body even when the query param is present), so Open must not depend on it.
 *   2. Copy / share link (`preferEmlForBody: false`): OWA URL with body= when the
 *      URL fits; otherwise subject/to only (body stays in the draft / .eml).
 *
 * .eml uses HTML + quoted-printable (see outlookComposeEml) so New Outlook and
 * Apple Mail keep an editable body.
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
 * @param {{ maxUrlLength?: number, preferEmlForBody?: boolean } | number} [optionsOrMax]
 *   preferEmlForBody defaults to true (Open Outlook). Pass false for copy-link /
 *   share URL so short bodies can still appear in an OWA body= query string.
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
  /* Default true: Open Outlook must not rely on OWA body= (often empty compose). */
  const preferEmlForBody = opts.preferEmlForBody !== false;

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
  const subjectOnlyUrl = buildOutlookWebComposeUrl(
    { to: toS, cc: ccS, subject: subS, body: '' },
    { includeBody: false }
  );

  /* Open path: any non-empty body → .eml so compose is never empty. */
  if (hasBody && preferEmlForBody) {
    const emlContent = buildOutlookComposeEmlContent({
      to: toS,
      cc: ccS,
      subject: subS,
      body: rawBody,
    });
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

  /* Copy-link / empty body: OWA URL (with body when it fits and preferEml is off). */
  if (!hasBody || urlWithBody.length <= maxLen) {
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

  /* Copy-link with body too long for a reliable OWA URL — still produce .eml. */
  const emlContent = buildOutlookComposeEmlContent({
    to: toS,
    cc: ccS,
    subject: subS,
    body: rawBody,
  });

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

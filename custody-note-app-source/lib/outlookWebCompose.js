'use strict';

/**
 * Outlook Web compose deeplink helpers (https://outlook.office.com/mail/0/deeplink/compose).
 *
 * URL length: OWA compose deeplinks are far more fragile than the Windows shell
 * handoff limit. Around/above 2KB Outlook Web may open the app but ignore the
 * query fields (to/subject/body). Keep the deeplink under 1800 chars and copy
 * the full email to clipboard when the body is truncated.
 */

const OUTLOOK_WEB_COMPOSE_BASE = 'https://outlook.office.com/mail/0/deeplink/compose';

/** @deprecated use OUTLOOK_WEB_COMPOSE_URL_MAX_SAFE_LENGTH */
const DEFAULT_MAX_OUTLOOK_COMPOSE_URL_LENGTH = 1800;

const OUTLOOK_WEB_COMPOSE_URL_MAX_SAFE_LENGTH = 1800;

/** Appended to the body in the URL when the full message does not fit the shell limit. */
const TRUNCATION_CLIPBOARD_NOTICE = '[… remainder copied to clipboard …]';

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
 * @returns {string}
 */
function buildOutlookWebComposeUrl(fields) {
  const f = fields || {};
  const toS = String(f.to != null ? f.to : '').trim();
  const ccS = String(f.cc != null ? f.cc : '');
  const subS = String(f.subject != null ? f.subject : '');
  const bodS = normalizeBodyToCrlf(f.body != null ? f.body : '');
  const parts = [];
  if (toS) parts.push('to=' + encodeURIComponent(toS));
  if (String(ccS).trim()) parts.push('cc=' + encodeURIComponent(ccS));
  if (subS) parts.push('subject=' + encodeURIComponent(subS));
  if (bodS) parts.push('body=' + encodeURIComponent(bodS));
  return parts.length ? OUTLOOK_WEB_COMPOSE_BASE + '?' + parts.join('&') : OUTLOOK_WEB_COMPOSE_BASE;
}

/**
 * Same plain-text shape as buildFullEmailClipboardText in lib/emailComposeDraft.js
 * (To / Subject / blank line / body).
 *
 * @param {{ to?: string, subject?: string, body?: string }} fields
 * @returns {string}
 */
function buildFullComposePlainTextForClipboard(fields) {
  const x = fields || {};
  const body = String(x.body != null ? x.body : '');
  return 'To: ' + String(x.to != null ? x.to : '') + '\nSubject: ' + String(x.subject != null ? x.subject : '') + '\n\n' + body;
}

/** @deprecated use buildFullComposePlainTextForClipboard */
const buildOutlookComposeClipboardText = buildFullComposePlainTextForClipboard;

/**
 * @param {{ to?: string, cc?: string, subject?: string, body?: string }} fields
 * @param {{ maxUrlLength?: number } | number} [optionsOrMax] legacy: number max length, or { maxUrlLength }
 * @returns {{ url: string, truncated: boolean, fullPlainTextForClipboard: string, bodyUsedInUrl: string }}
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

  const fullPlainTextForClipboard = buildFullComposePlainTextForClipboard({
    to: toS,
    subject: subS,
    body: rawBody,
  });

  const normalizedBody = normalizeBodyToCrlf(rawBody);
  const idealUrl = buildOutlookWebComposeUrl({ to: toS, cc: ccS, subject: subS, body: rawBody });

  if (idealUrl.length <= maxLen) {
    return {
      url: idealUrl,
      truncated: false,
      fullPlainTextForClipboard,
      bodyUsedInUrl: normalizedBody,
      urlLength: idealUrl.length,
    };
  }

  const suffix = '\r\n' + TRUNCATION_CLIPBOARD_NOTICE;

  function urlFor(subjectUsed, bodyArg) {
    return buildOutlookWebComposeUrl({ to: toS, cc: ccS, subject: subjectUsed, body: bodyArg });
  }

  let subjectWork = subS;
  while (subjectWork.length > 0 && urlFor(subjectWork, suffix).length > maxLen) {
    subjectWork = subjectWork.slice(0, Math.max(0, subjectWork.length - 100));
  }

  if (urlFor(subjectWork, suffix).length > maxLen) {
    if (String(ccS).trim()) {
      return truncateOutlookComposeForShellOpen(
        { to: toS, cc: '', subject: subS, body: rawBody },
        opts
      );
    }
    let u = urlFor('', '');
    if (u.length > maxLen) {
      u = OUTLOOK_WEB_COMPOSE_BASE;
    }
    return {
      url: u,
      truncated: true,
      fullPlainTextForClipboard,
      bodyUsedInUrl: '',
      urlLength: u.length,
    };
  }

  let lo = 0;
  let hi = normalizedBody.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const candidate = normalizedBody.slice(0, mid) + suffix;
    if (urlFor(subjectWork, candidate).length <= maxLen) lo = mid;
    else hi = mid - 1;
  }

  const bodyUsedInUrl = normalizedBody.slice(0, lo) + suffix;
  const url = urlFor(subjectWork, bodyUsedInUrl);
  return {
    url,
    truncated: true,
    fullPlainTextForClipboard,
    bodyUsedInUrl,
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
  buildOutlookComposeClipboardText,
  truncateOutlookComposeForShellOpen,
};

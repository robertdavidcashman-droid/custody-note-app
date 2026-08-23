'use strict';

/**
 * RFC 5322 .eml draft builder for Outlook desktop compose.
 *
 * Outlook opens .eml files with X-Unsent: 1 as an editable draft (To, Subject,
 * Body prefilled). This is the reliable body-transfer path when Outlook Web
 * compose URLs cannot carry a full message (length limits / silent body drop).
 *
 * Body is emitted as text/html (escaped plain text + <br>) with
 * quoted-printable transfer encoding. New Outlook drops plain-text bodies when
 * X-Unsent is set, but keeps HTML bodies. QP keeps the on-disk file 7-bit safe
 * (avoids UTF-8 file-encoding body drops). Apple Mail draft UTI is included so
 * macOS Mail opens an editable draft.
 *
 * Pure Node — no Electron dependency. Main process writes the file and calls
 * shell.openPath.
 */

const CRLF = '\r\n';

/**
 * Strip CR/LF from header values to prevent header injection.
 * @param {string} s
 * @returns {string}
 */
function stripHeaderInjection(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
}

/**
 * RFC 2047 base64 encoded-word for non-ASCII header values.
 * @param {string} value
 * @returns {string}
 */
function encodeHeaderValue(value) {
  const s = stripHeaderInjection(value);
  if (!s) return '';
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return '=?utf-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

/**
 * Escape plain text for an HTML body part.
 * @param {string} s
 * @returns {string}
 */
function escapeHtmlText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert plain-text officer email body to a minimal HTML body that preserves
 * line breaks in Outlook compose.
 * @param {string} body
 * @returns {string}
 */
function plainBodyToHtml(body) {
  const escaped = escapeHtmlText(body)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return '<html><body>' + escaped.split('\n').join('<br>' + CRLF) + '</body></html>';
}

/**
 * Reverse plainBodyToHtml for test round-trips.
 * @param {string} html
 * @returns {string}
 */
function htmlBodyToPlain(html) {
  return String(html == null ? '' : html)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^<html><body>/i, '')
    .replace(/<\/body><\/html>\s*$/i, '')
    /* <br> may be followed by a soft/hard newline from the builder — consume both. */
    .replace(/<br\s*\/?>\n?/gi, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Quoted-printable encode a UTF-8 body (RFC 2045 §6.7). Soft line breaks keep
 * lines ≤ 76 chars; trailing spaces/tabs on a line are encoded.
 * @param {string} text
 * @returns {string}
 */
function encodeQuotedPrintable(text) {
  const bytes = Buffer.from(String(text == null ? '' : text), 'utf8');
  let out = '';
  let line = '';

  function pushChunk(chunk) {
    if (line.length + chunk.length > 75) {
      out += line + '=' + CRLF;
      line = '';
    }
    line += chunk;
  }

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0d) continue;
    if (b === 0x0a) {
      if (line.length > 0) {
        const lastCh = line.charCodeAt(line.length - 1);
        if (lastCh === 0x20 || lastCh === 0x09) {
          line = line.slice(0, -1) + (lastCh === 0x20 ? '=20' : '=09');
        }
      }
      out += line + CRLF;
      line = '';
      continue;
    }
    if (b === 0x3d) {
      pushChunk('=3D');
      continue;
    }
    if (b >= 0x20 && b <= 0x7e) {
      pushChunk(String.fromCharCode(b));
      continue;
    }
    let hex = b.toString(16).toUpperCase();
    if (hex.length === 1) hex = '0' + hex;
    pushChunk('=' + hex);
  }
  out += line;
  return out;
}

/**
 * Decode quoted-printable produced by encodeQuotedPrintable.
 * @param {string} qp
 * @returns {string}
 */
function decodeQuotedPrintable(qp) {
  const raw = String(qp == null ? '' : qp)
    .replace(/=\r\n/g, '')
    .replace(/=\n/g, '');
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '=' && i + 2 < raw.length && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    bytes.push(raw.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Build an RFC 5322 .eml message Outlook opens as an unsent draft.
 *
 * @param {{ to?: string, cc?: string, subject?: string, body?: string, date?: Date }} fields
 * @returns {string}
 */
function buildOutlookComposeEmlContent(fields) {
  const f = fields || {};
  const to = stripHeaderInjection(f.to);
  const cc = stripHeaderInjection(f.cc);
  const subject = encodeHeaderValue(f.subject);
  const body = String(f.body == null ? '' : f.body);
  const date = f.date instanceof Date ? f.date : new Date();

  const headers = [
    'MIME-Version: 1.0',
    /* text/html: New Outlook drops plain-text bodies when X-Unsent is set. */
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    'X-Unsent: 1',
    /* Apple Mail editable draft; harmless on Windows Outlook. */
    'X-Uniform-Type-Identifier: com.apple.mail-draft',
    'X-Mailer: CustodyNote',
    'Date: ' + date.toUTCString(),
  ];
  if (to) headers.push('To: ' + encodeHeaderValue(to));
  if (cc) headers.push('Cc: ' + encodeHeaderValue(cc));
  headers.push('Subject: ' + subject);

  const htmlBody = plainBodyToHtml(body);
  return headers.join(CRLF) + CRLF + CRLF + encodeQuotedPrintable(htmlBody) + CRLF;
}

/**
 * Extract the plain-text body from an .eml produced by buildOutlookComposeEmlContent.
 * Used by tests to prove round-trip fidelity.
 *
 * @param {string} eml
 * @returns {string}
 */
function extractEmlPlainBody(eml) {
  const raw = String(eml == null ? '' : eml);
  const idx = raw.indexOf(CRLF + CRLF);
  if (idx < 0) return '';
  let body = raw.slice(idx + 4);
  if (body.endsWith(CRLF)) body = body.slice(0, -CRLF.length);
  const decoded = /Content-Transfer-Encoding:\s*quoted-printable/i.test(raw.slice(0, idx))
    ? decodeQuotedPrintable(body)
    : body;
  if (/Content-Type:\s*text\/html/i.test(raw.slice(0, idx))) {
    return htmlBodyToPlain(decoded);
  }
  return decoded.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

module.exports = {
  buildOutlookComposeEmlContent,
  extractEmlPlainBody,
  encodeHeaderValue,
  stripHeaderInjection,
  encodeQuotedPrintable,
  decodeQuotedPrintable,
  plainBodyToHtml,
  htmlBodyToPlain,
};

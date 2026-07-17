'use strict';

/**
 * Clipboard copy with Clipboard API when available, textarea fallback otherwise.
 * Injectable `env` for tests (navigator, document, isSecureContext).
 *
 * @param {string} text
 * @param {{ navigator?: Navigator, document?: Document, isSecureContext?: boolean }} [env]
 * @returns {Promise<boolean>}
 */
async function copyText(text, env) {
  if (!text) return false;

  env = env || (typeof globalThis !== 'undefined' ? globalThis : {});
  var nav = env.navigator;
  var doc = env.document;
  var secure = env.isSecureContext !== false;

  if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function' && secure) {
    await nav.clipboard.writeText(String(text));
    return true;
  }

  if (!doc || typeof doc.createElement !== 'function' || !doc.body) {
    return false;
  }

  var textarea = doc.createElement('textarea');
  textarea.value = String(text);
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  doc.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  var successful = false;
  try {
    successful = doc.execCommand && doc.execCommand('copy');
  } catch (_) {
    successful = false;
  }
  doc.body.removeChild(textarea);

  return successful;
}

module.exports = {
  copyText,
};

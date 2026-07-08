'use strict';

/**
 * lib/escapeHtml.js
 * ----------------------------------------------------------------------------
 * Single canonical HTML/XML escape helper for CustodyNote. Before this module
 * the renderer had at least three inconsistent `esc()` implementations, one
 * of which (app.js, ~line 13103) escaped only `&`, `<`, and `>` and was
 * therefore unsafe in attribute contexts (an attacker controlling a field
 * could break out of `data-id="…"` with a `"` and inject arbitrary
 * attributes including `onerror=…`). This module is attribute-safe in all
 * contexts that exist in the app today.
 *
 * Usage from the renderer:
 *   var esc = require('./lib/escapeHtml').escapeHtml;
 *   el.innerHTML = '<div title="' + esc(value) + '">' + esc(value) + '</div>';
 *
 * Usage where this file cannot be `require`d (the renderer is not a CJS
 * environment), inline the same body — see app.js where escapeHtml is also
 * defined as a top-level function for that reason.
 *
 * Returns '' for null/undefined; coerces non-strings via String(...).
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
    .replace(/=/g, '&#61;'); // belt-and-braces against unquoted-attribute injection
}

module.exports = { escapeHtml };

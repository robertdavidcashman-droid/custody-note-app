'use strict';

/**
 * Deep-sort object keys so JSON.stringify is stable across key insertion order.
 * Used to compare semantic equality of parsed attendance data (e.g. burst duplicate guard).
 */
function sortKeysDeep(val) {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(sortKeysDeep);
  const sorted = {};
  Object.keys(val).sort().forEach(function (k) {
    sorted[k] = sortKeysDeep(val[k]);
  });
  return sorted;
}

function stableStringify(obj) {
  return JSON.stringify(sortKeysDeep(obj));
}

module.exports = { stableStringify, sortKeysDeep };

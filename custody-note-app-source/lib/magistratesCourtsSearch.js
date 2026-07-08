'use strict';

/**
 * Filter and rank magistrates court names for typeahead search.
 * Shared by renderer (via script tag) and node --test.
 */

function decodeCourtName(name) {
  return String(name || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCourtList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const name = decodeCourtName(item);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort(function(a, b) {
    return a.localeCompare(b, 'en', { sensitivity: 'base' });
  });
}

function normalizeCourtSearchQuery(query) {
  return String(query || '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?…]+$/g, '')
    .trim();
}

function rankCourtMatch(name, query) {
  const n = String(name || '').toLowerCase();
  const q = normalizeCourtSearchQuery(query).toLowerCase();
  if (!q) return 0;
  if (n.startsWith(q)) return 3;
  const words = n.split(/\s+/);
  if (words.some(function(w) { return w.startsWith(q); })) return 2;
  if (n.includes(q)) return 1;
  return 0;
}

function searchMagistratesCourts(courts, query, limit) {
  const list = normalizeCourtList(courts);
  const max = typeof limit === 'number' && limit > 0 ? limit : 20;
  const q = normalizeCourtSearchQuery(query);
  if (!q) return [];
  if (q.length < 2) return [];

  return list
    .map(function(name) {
      return { name: name, rank: rankCourtMatch(name, q) };
    })
    .filter(function(row) { return row.rank > 0; })
    .sort(function(a, b) {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    })
    .slice(0, max)
    .map(function(row) { return row.name; });
}

var MagistratesCourtsSearch = {
  decodeCourtName: decodeCourtName,
  normalizeCourtList: normalizeCourtList,
  normalizeCourtSearchQuery: normalizeCourtSearchQuery,
  rankCourtMatch: rankCourtMatch,
  searchMagistratesCourts: searchMagistratesCourts,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MagistratesCourtsSearch;
}
if (typeof window !== 'undefined') {
  window.MagistratesCourtsSearch = MagistratesCourtsSearch;
}

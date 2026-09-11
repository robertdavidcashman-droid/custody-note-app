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

/** Generic tokens present in almost every court title — never let these steal short queries. */
var COURT_WORD_STOPLIST = {
  magistrates: true,
  "magistrates'": true,
  court: true,
  courts: true,
  family: true,
  county: true,
  and: true,
  the: true,
  of: true,
  'in': true,
};

function normalizeCourtSearchQuery(query) {
  return String(query || '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?…]+$/g, '')
    .trim();
}

function stripWordPunctuation(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9']+$/gi, '')
    .replace(/'/g, "'");
}

function isCourtStopWord(word) {
  var w = stripWordPunctuation(word);
  if (!w) return true;
  if (COURT_WORD_STOPLIST[w]) return true;
  // "Magistrates'" / "Magistrates" with any trailing punctuation
  if (w.indexOf('magistrate') === 0) return true;
  return false;
}

function rankCourtMatch(name, query) {
  const n = String(name || '').toLowerCase();
  const q = normalizeCourtSearchQuery(query).toLowerCase();
  if (!q) return 0;
  // Strongest: whole name starts with the town/query
  if (n.startsWith(q)) return 4;

  const words = n.split(/\s+/);
  var meaningfulWordPrefix = words.some(function(w) {
    if (isCourtStopWord(w)) return false;
    return w.toLowerCase().startsWith(q);
  });
  if (meaningfulWordPrefix) return 3;

  // Short queries (1–3 chars): do NOT fall through to stop-word prefixes or
  // substring includes — "ma" lives inside almost every "Magistrates'" token.
  if (q.length < 4) return 0;

  // Longer queries: allow stop-word prefixes (e.g. "court") and substring includes
  if (words.some(function(w) { return w.toLowerCase().startsWith(q); })) return 2;

  // Substring include, but ignore hits that only land inside a stop word
  var idx = n.indexOf(q);
  while (idx !== -1) {
    var before = n.slice(0, idx);
    var afterStart = idx;
    var wordStart = before.lastIndexOf(' ') + 1;
    var wordEnd = n.indexOf(' ', afterStart);
    if (wordEnd === -1) wordEnd = n.length;
    var hitWord = n.slice(wordStart, wordEnd);
    if (!isCourtStopWord(hitWord)) return 1;
    idx = n.indexOf(q, idx + 1);
  }
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
  isCourtStopWord: isCourtStopWord,
  COURT_WORD_STOPLIST: COURT_WORD_STOPLIST,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MagistratesCourtsSearch;
}
if (typeof window !== 'undefined') {
  window.MagistratesCourtsSearch = MagistratesCourtsSearch;
}

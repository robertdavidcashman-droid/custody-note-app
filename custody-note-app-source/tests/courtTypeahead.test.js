'use strict';

/**
 * Court typeahead regression tests — Sevenoaks and related failure modes.
 *
 * Root causes addressed:
 * 1. Empty court list during IPC load showed misleading "No courts match".
 * 2. Trailing punctuation (Sevenoaks.) failed substring search.
 * 3. CSS contain:paint on .form-section clipped the absolute dropdown.
 * 4. Dropdown used absolute positioning inside scroll/contain containers.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const search = require('../lib/magistratesCourtsSearch');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const courts = JSON.parse(fs.readFileSync(path.join(root, 'data', 'magistrates-courts.json'), 'utf8'));

const SEVENOAKS = "Sevenoaks Magistrates' Court and Family Court";

describe('court typeahead search — Sevenoaks in live data', () => {
  it('Sevenoaks is present in magistrates-courts.json', () => {
    assert.ok(courts.includes(SEVENOAKS), courts.filter(function(n) { return /Sevenoaks/i.test(n); }).join(' | '));
  });

  it('finds Sevenoaks for exact query "Sevenoaks"', () => {
    const hits = search.searchMagistratesCourts(courts, 'Sevenoaks', 20);
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0], SEVENOAKS);
  });

  it('finds Sevenoaks when user types with trailing full stop (common autocorrect)', () => {
    assert.strictEqual(search.normalizeCourtSearchQuery('Sevenoaks.'), 'Sevenoaks');
    const hits = search.searchMagistratesCourts(courts, 'Sevenoaks.', 20);
    assert.ok(hits.some(function(n) { return /Sevenoaks/i.test(n); }), hits.join(' | '));
  });

  it('does not match "Seven Oaks" with a space (official name has no space)', () => {
    const hits = search.searchMagistratesCourts(courts, 'Seven Oaks', 20);
    assert.strictEqual(hits.length, 0);
  });

  it('returns empty for empty court list (simulates load failure — must not throw)', () => {
    const hits = search.searchMagistratesCourts([], 'Sevenoaks', 20);
    assert.deepStrictEqual(hits, []);
  });
});

describe('court typeahead — load race UX (app.js wiring)', () => {
  it('dedupes concurrent loadMagistratesCourts via shared promise', () => {
    assert.match(appJs, /_magistratesCourtsLoadPromise/);
    assert.match(appJs, /if \(_magistratesCourtsLoadPromise\) return _magistratesCourtsLoadPromise/);
  });

  it('ensureMagistratesCourtsLoaded re-runs suggestions after load when field focused', () => {
    assert.match(appJs, /function ensureMagistratesCourtsLoaded/);
    assert.match(appJs, /if \(document\.activeElement === input\)[\s\S]{0,120}setSuggestions/);
  });

  it('shows Loading magistrates courts instead of No courts match when list empty', () => {
    assert.match(appJs, /Loading magistrates courts/);
    assert.doesNotMatch(
      appJs,
      /if \(!items\.length\)[\s\S]{0,120}magistratesCourts\.length/
    );
  });

  it('uses normalizeCourtSearchQuery before searching', () => {
    assert.match(appJs, /normalizeCourtSearchQuery/);
  });

  it('shows explicit message when court list fails to load', () => {
    assert.match(appJs, /Court list failed to load/);
  });

  it('logs court count after successful load', () => {
    assert.match(appJs, /\[loadMagistratesCourts\] count=/);
  });

  it('shows court name field hint for typeahead', () => {
    assert.match(appJs, /court-name-hint/);
    assert.match(appJs, /Type 2\+ letters for magistrates court suggestions/);
  });
});

describe('court typeahead — dropdown visibility (CSS + fixed positioning)', () => {
  it('form-section does not use contain:content (clips paint / dropdown)', () => {
    assert.doesNotMatch(stylesCss, /\.form-section[^}]*contain:\s*content/);
    assert.match(stylesCss, /\.form-section[^}]*contain:\s*layout style/);
  });

  it('court dropdown uses fixed positioning to escape scroll containers', () => {
    assert.match(appJs, /dropdown\.style\.position = 'fixed'/);
    assert.match(appJs, /court-autocomplete-dropdown/);
  });

  it('court-autocomplete-dropdown has elevated open styles', () => {
    assert.match(stylesCss, /\.court-autocomplete-dropdown\.open/);
  });
});

describe('court typeahead — simulated load race', () => {
  it('empty list then populated list finds Sevenoaks (models late IPC response)', () => {
    let loaded = [];
    function simulateSearchWhileLoading(query) {
      return search.searchMagistratesCourts(loaded, query, 20);
    }
    assert.deepStrictEqual(simulateSearchWhileLoading('Sevenoaks'), []);
    loaded = courts;
    const hits = simulateSearchWhileLoading('Sevenoaks');
    assert.ok(hits.some(function(n) { return /Sevenoaks/i.test(n); }));
  });
});

describe('billing panel button placement (finalise visibility regression)', () => {
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  it('#billing-panel-btn is in header-form-actions not form-page-header', () => {
    const headerIdx = indexHtml.indexOf('id="header-form-actions"');
    const btnIdx = indexHtml.indexOf('id="billing-panel-btn"');
    const formHeaderIdx = indexHtml.indexOf('class="form-page-header"');
    assert.ok(headerIdx >= 0 && btnIdx > headerIdx && btnIdx < formHeaderIdx);
    const formHeader = indexHtml.slice(formHeaderIdx, indexHtml.indexOf('id="standalone-back-bar"', formHeaderIdx));
    assert.ok(!formHeader.includes('billing-panel-btn'));
  });

  it('styles keep header primary action visible when form-active', () => {
    assert.match(stylesCss, /#header-form-actions #billing-panel-btn/);
    assert.match(stylesCss, /body\.form-active #view-form > \.form-page-header \{ display: none; \}/);
  });
});

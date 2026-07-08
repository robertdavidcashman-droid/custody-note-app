'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const search = require('../lib/magistratesCourtsSearch');

const dataPath = path.join(__dirname, '..', 'data', 'magistrates-courts.json');
const courts = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

describe('magistratesCourtsSearch', () => {
  it('returns empty for queries under 2 characters', () => {
    assert.deepStrictEqual(search.searchMagistratesCourts(courts, 'S', 20), []);
    assert.deepStrictEqual(search.searchMagistratesCourts(courts, '', 20), []);
  });

  it('finds Sheffield when typing the start of the town name', () => {
    const hits = search.searchMagistratesCourts(courts, 'Shef', 20);
    assert.ok(hits.some(function(name) { return /Sheffield Magistrates' Court/i.test(name); }), hits.join(' | '));
  });

  it('finds Sefton for "Se"', () => {
    const hits = search.searchMagistratesCourts(courts, 'Se', 20);
    assert.ok(hits.some(function(name) { return /Sefton Magistrates' Court/i.test(name); }), hits.join(' | '));
  });

  it('finds Sevenoaks for "Seven"', () => {
    const hits = search.searchMagistratesCourts(courts, 'Seven', 20);
    assert.ok(hits.some(function(name) { return /Sevenoaks/i.test(name); }), hits.join(' | '));
  });

  it('strips trailing punctuation from search queries', () => {
    assert.strictEqual(search.normalizeCourtSearchQuery('Sevenoaks.'), 'Sevenoaks');
    const hits = search.searchMagistratesCourts(courts, 'Sevenoaks.', 20);
    assert.ok(hits.some(function(name) { return /Sevenoaks/i.test(name); }), hits.join(' | '));
  });

  it('exports normalizeCourtSearchQuery', () => {
    assert.strictEqual(typeof search.normalizeCourtSearchQuery, 'function');
  });

  it('prefers names that start with the query', () => {
    const hits = search.searchMagistratesCourts(['Southampton Magistrates\' Court', 'East Hampshire Magistrates\' Court'], 'South', 5);
    assert.strictEqual(hits[0], 'Southampton Magistrates\' Court');
  });

  it('decodes HTML entities in court names', () => {
    const hits = search.searchMagistratesCourts(["Barking &amp; Dagenham Magistrates' Court"], 'Bark', 5);
    assert.ok(hits.some(function (name) { return name.indexOf('Barking & Dagenham') !== -1; }), hits.join(' | '));
  });

  it('deduplicates and sorts normalized lists', () => {
    const normalized = search.normalizeCourtList(["B Court", 'B Court', '  A Court ']);
    assert.deepStrictEqual(normalized, ['A Court', 'B Court']);
  });
});

describe('data/magistrates-courts.json', () => {
  it('contains a comprehensive England and Wales magistrates court list', () => {
    assert.ok(Array.isArray(courts));
    assert.ok(courts.length >= 250, 'expected at least 250 courts, got ' + courts.length);
  });

  it('spans the alphabet beyond B–C', () => {
    const letters = new Set(courts.map(function(name) {
      return String(name).trim().charAt(0).toUpperCase();
    }));
    for (const letter of ['A', 'M', 'S', 'Y']) {
      assert.ok(letters.has(letter), 'missing courts starting with ' + letter);
    }
  });

  it('excludes finance/admin entries', () => {
    for (const name of courts) {
      assert.doesNotMatch(name, /finance unit|adminstration|admin team/i, name);
    }
  });

  it('includes courts outside the old partial B–C sample', () => {
    const mustInclude = [
      'Derby Magistrates\' Court',
      'Sheffield Magistrates\' Court',
      'York Magistrates\' Court and Family Court',
    ];
    for (const expected of mustInclude) {
      assert.ok(courts.includes(expected), 'missing ' + expected);
    }
  });
});

describe('magistratesCourtsSearch browser script load', () => {
  it('exposes window.MagistratesCourtsSearch without Node module (Electron renderer)', () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!DOCTYPE html>', { runScripts: 'outside-only' });
    const script = fs.readFileSync(path.join(__dirname, '..', 'lib', 'magistratesCourtsSearch.js'), 'utf8');
    dom.window.eval(script);
    assert.ok(dom.window.MagistratesCourtsSearch, 'MagistratesCourtsSearch missing on window');
    const hits = dom.window.MagistratesCourtsSearch.searchMagistratesCourts(courts, 'ma', 5);
    assert.ok(hits.length > 0, hits.join(' | '));
  });
});

describe('main IPC wiring for magistrates courts', () => {
  it('registers load-magistrates-courts handler in main.js', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(mainJs, /ipcMain\.handle\('load-magistrates-courts'/);
    assert.match(mainJs, /magistrates-courts\.json/);
  });

  it('exposes loadMagistratesCourts on preload bridge', () => {
    const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    assert.match(preload, /loadMagistratesCourts:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('load-magistrates-courts'\)/);
  });
});

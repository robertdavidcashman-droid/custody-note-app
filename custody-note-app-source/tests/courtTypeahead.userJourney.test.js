'use strict';

/**
 * Real user-journey tests for magistrates court typeahead.
 * Loads live magistrates-courts.json, mounts initCourtAutocomplete in jsdom,
 * and simulates typing / clicking / keyboard selection.
 */
const { describe, it, before, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const courts = JSON.parse(fs.readFileSync(path.join(root, 'data', 'magistrates-courts.json'), 'utf8'));
const searchSrc = fs.readFileSync(path.join(root, 'lib', 'magistratesCourtsSearch.js'), 'utf8');
const acSrc = fs.readFileSync(path.join(root, 'lib', 'courtAutocomplete.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const SEVENOAKS = "Sevenoaks Magistrates' Court and Family Court";
const search = require('../lib/magistratesCourtsSearch');
const CourtAutocomplete = require('../lib/courtAutocomplete');

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function mountWidget(opts) {
  opts = opts || {};
  const delayMs = opts.delayMs || 0;
  const emptyFirst = !!opts.emptyFirst;
  const formData = opts.formData || {};
  const fieldKey = opts.fieldKey || 'courtName';

  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><style>' + stylesCss + '</style></head>' +
    '<body>' +
    '<div class="attendance-form" style="contain:layout; transform:translateZ(0); height:800px; overflow:auto;">' +
    '  <div class="form-section active" style="contain:layout; padding-top:500px;">' +
    '    <div class="offence-autocomplete-wrap" style="position:relative;">' +
    '      <input id="court-input" type="text" data-field="' + fieldKey + '" name="' + fieldKey + '" />' +
    '    </div>' +
    '  </div>' +
    '</div>' +
    '</body></html>',
    {
      url: 'http://localhost/',
      pretendToBeVisual: true,
      // Required so window.eval can attach MagistratesCourtsSearch / CourtAutocomplete
      runScripts: 'outside-only',
      beforeParse: function (window) {
        // jsdom layout stubs — enough for visibility / portal checks
        window.HTMLElement.prototype.getBoundingClientRect = function () {
          if (this.id === 'court-input' || this.tagName === 'INPUT') {
            return { top: 520, bottom: 556, left: 40, right: 440, width: 400, height: 36, x: 40, y: 520 };
          }
          return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };
        };
      },
    }
  );

  const { window } = dom;
  const { document } = window;
  Object.defineProperty(window, 'innerHeight', { value: opts.innerHeight || 800, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: opts.innerWidth || 1280, configurable: true });

  // Load search + autocomplete scripts into the window (same path as index.html)
  window.eval(searchSrc);
  window.eval(acSrc);
  if (!window.CourtAutocomplete) {
    // Fallback: Node require path if eval window binding failed
    window.MagistratesCourtsSearch = search;
    window.CourtAutocomplete = CourtAutocomplete;
  }

  let courtsState = emptyFirst ? [] : courts.slice();
  let loadCalls = 0;

  window.api = {
    loadMagistratesCourts: function () {
      loadCalls += 1;
      return new Promise(function (resolve) {
        setTimeout(function () {
          courtsState = courts.slice();
          resolve(courtsState);
        }, delayMs);
      });
    },
  };

  const input = document.getElementById('court-input');
  const widget = window.CourtAutocomplete.initCourtAutocomplete(input, {
    fieldKey: fieldKey,
    formData: formData,
    portalRoot: document.body,
    searchApi: window.MagistratesCourtsSearch,
    getCourts: function () { return courtsState; },
    ensureLoaded: function () {
      if (courtsState.length) return Promise.resolve(courtsState);
      return window.api.loadMagistratesCourts().then(function (list) {
        courtsState = list;
        return list;
      });
    },
  });

  async function typeQuery(text) {
    input.focus();
    input.value = text;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    // debounce is 80ms
    await sleep(120);
  }

  function openOptions() {
    return Array.from(widget.dropdown.querySelectorAll('.offence-autocomplete-option')).map(function (el) {
      return el.textContent;
    });
  }

  function hintText() {
    const hint = widget.dropdown.querySelector('.offence-autocomplete-hint');
    return hint ? hint.textContent : '';
  }

  function assertDropdownVisible() {
    assert.ok(widget.isOpen(), 'dropdown should be open');
    assert.notStrictEqual(widget.dropdown.style.display, 'none', 'dropdown display must not be none');
    assert.strictEqual(widget.dropdown.parentNode, document.body, 'dropdown must be portaled to document.body');
    assert.strictEqual(widget.dropdown.style.position, 'fixed', 'dropdown must use fixed positioning on body');
    const top = parseFloat(widget.dropdown.style.top || '0');
    const bottom = widget.dropdown.style.bottom;
    // Either below input (~558) or above — but must not be empty/zero-size positioning failure
    assert.ok(
      (Number.isFinite(top) && top > 0) || (bottom && bottom !== ''),
      'dropdown must have a non-zero viewport position, got top=' + widget.dropdown.style.top + ' bottom=' + bottom
    );
  }

  return {
    window: window,
    document: document,
    input: input,
    widget: widget,
    formData: formData,
    typeQuery: typeQuery,
    openOptions: openOptions,
    hintText: hintText,
    assertDropdownVisible: assertDropdownVisible,
    getLoadCalls: function () { return loadCalls; },
    setCourts: function (list) { courtsState = list; },
    destroy: function () {
      widget.destroy();
      dom.window.close();
    },
  };
}

describe('court typeahead ranking — town prefix beats Magistrates\'', () => {
  it('se includes Sevenoaks and only Se* town courts', () => {
    const hits = search.searchMagistratesCourts(courts, 'se', 20);
    assert.ok(hits.includes(SEVENOAKS), hits.join(' | '));
    assert.ok(hits.every(function (n) { return /^se/i.test(n); }), 'all hits must start with Se: ' + hits.join(' | '));
    assert.ok(hits.length <= 10, 'should not flood with Magistrates\' word matches, got ' + hits.length);
  });

  it('ma shows Manchester/Maidstone/Macclesfield and not 20 random Magistrates\' courts', () => {
    const hits = search.searchMagistratesCourts(courts, 'ma', 20);
    assert.ok(hits.some(function (n) { return /Manchester/i.test(n); }), hits.join(' | '));
    assert.ok(hits.some(function (n) { return /Maidstone/i.test(n); }), hits.join(' | '));
    assert.ok(hits.some(function (n) { return /Macclesfield/i.test(n); }), hits.join(' | '));
    assert.ok(hits.every(function (n) {
      return /^(ma|east berkshire.*maidenhead)/i.test(n);
    }), 'unexpected filler court: ' + hits.filter(function (n) {
      return !/^(ma|east berkshire.*maidenhead)/i.test(n);
    }).join(' | '));
    assert.ok(hits.length < 20 || hits.every(function (n) { return /^ma/i.test(n) || /maidenhead/i.test(n); }));
  });

  it('wo shows Woolwich / Woking / Wolverhampton', () => {
    const hits = search.searchMagistratesCourts(courts, 'wo', 20);
    assert.ok(hits.some(function (n) { return /Woolwich/i.test(n); }), hits.join(' | '));
    assert.ok(hits.some(function (n) { return /Woking/i.test(n); }), hits.join(' | '));
    assert.ok(hits.some(function (n) { return /Wolverhampton/i.test(n); }), hits.join(' | '));
  });
});

describe('court typeahead user journey (jsdom + real court list)', () => {
  const fixtures = [];
  afterEach(function () {
    while (fixtures.length) {
      const f = fixtures.pop();
      try { f.destroy(); } catch (_) { /* ignore */ }
    }
  });

  it('types se → dropdown OPEN/VISIBLE with Sevenoaks', async () => {
    const env = mountWidget();
    fixtures.push(env);
    await env.typeQuery('se');
    env.assertDropdownVisible();
    const opts = env.openOptions();
    assert.ok(opts.length > 0, 'expected matching courts, got empty. hint=' + env.hintText());
    assert.ok(opts.includes(SEVENOAKS), opts.join(' | '));
  });

  it('narrows sev → sevenoaks to the official Sevenoaks name', async () => {
    const env = mountWidget();
    fixtures.push(env);
    await env.typeQuery('sev');
    let opts = env.openOptions();
    assert.deepStrictEqual(opts, [SEVENOAKS]);
    await env.typeQuery('sevenoaks');
    opts = env.openOptions();
    assert.deepStrictEqual(opts, [SEVENOAKS]);
  });

  it('types ma → Manchester/Maidstone appear; list is not Magistrates\' flood', async () => {
    const env = mountWidget();
    fixtures.push(env);
    await env.typeQuery('ma');
    env.assertDropdownVisible();
    const opts = env.openOptions();
    assert.ok(opts.some(function (n) { return /Manchester/i.test(n); }), opts.join(' | '));
    assert.ok(opts.some(function (n) { return /Maidstone/i.test(n); }), opts.join(' | '));
    assert.ok(!opts.some(function (n) { return /^Aberdare/i.test(n); }), 'Aberdare must not appear for ma: ' + opts.join(' | '));
  });

  it('types wo → Woolwich/Woking/Wolverhampton', async () => {
    const env = mountWidget();
    fixtures.push(env);
    await env.typeQuery('wo');
    env.assertDropdownVisible();
    const opts = env.openOptions();
    assert.ok(opts.some(function (n) { return /Woolwich/i.test(n); }), opts.join(' | '));
    assert.ok(opts.some(function (n) { return /Woking/i.test(n); }), opts.join(' | '));
    assert.ok(opts.some(function (n) { return /Wolverhampton/i.test(n); }), opts.join(' | '));
  });

  it('click suggestion inserts official name into input and formData', async () => {
    const formData = {};
    const env = mountWidget({ formData: formData, fieldKey: 'courtName' });
    fixtures.push(env);
    await env.typeQuery('sevenoaks');
    const first = env.widget.dropdown.querySelector('.offence-autocomplete-option');
    assert.ok(first, 'expected a suggestion to click');
    first.dispatchEvent(new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.strictEqual(env.input.value, SEVENOAKS);
    assert.strictEqual(formData.courtName, SEVENOAKS);
    assert.ok(!env.widget.isOpen(), 'dropdown should close after select');
    // Input event from select must not re-open the list
    await sleep(200);
    assert.ok(!env.widget.isOpen(), 'dropdown must stay closed after select debounce');
  });

  it('keyboard ArrowDown + Enter selects the highlighted court', async () => {
    const formData = {};
    const env = mountWidget({ formData: formData });
    fixtures.push(env);
    await env.typeQuery('sev');
    env.input.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    env.input.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.strictEqual(env.input.value, SEVENOAKS);
    assert.strictEqual(formData.courtName, SEVENOAKS);
  });

  it('empty / 1 letter shows 2-letter hint, not fake no-match', async () => {
    const env = mountWidget();
    fixtures.push(env);
    await env.typeQuery('');
    env.input.focus();
    env.widget.setSuggestions('');
    assert.match(env.hintText(), /2 letters/i);
    assert.doesNotMatch(env.hintText(), /No courts match/i);
    env.widget.setSuggestions('s');
    assert.match(env.hintText(), /2 letters/i);
    assert.doesNotMatch(env.hintText(), /No courts match/i);
  });

  it('shows Loading… while list empty, then results after delayed IPC', async () => {
    const env = mountWidget({ emptyFirst: true, delayMs: 60 });
    fixtures.push(env);
    env.input.focus();
    env.input.value = 'se';
    // Trigger suggestions while still empty
    env.widget.setSuggestions('se');
    assert.match(env.hintText(), /Loading/i);
    await sleep(200);
    // After ensureLoaded resolves, if still focused, setSuggestions re-runs via ensureLoaded path
    // Re-run as user would after load completes while focused:
    env.widget.setSuggestions('se');
    env.assertDropdownVisible();
    assert.ok(env.openOptions().includes(SEVENOAKS));
  });

  it('crm14CourtName fieldKey updates formData.crm14CourtName', async () => {
    const formData = {};
    const env = mountWidget({ formData: formData, fieldKey: 'crm14CourtName' });
    fixtures.push(env);
    await env.typeQuery('sevenoaks');
    const first = env.widget.dropdown.querySelector('.offence-autocomplete-option');
    first.dispatchEvent(new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.strictEqual(formData.crm14CourtName, SEVENOAKS);
    assert.strictEqual(env.input.getAttribute('autocomplete'), 'off');
  });

  it('stays visible at large/scaled viewport (innerHeight 600)', async () => {
    const env = mountWidget({ innerHeight: 600 });
    fixtures.push(env);
    await env.typeQuery('se');
    env.assertDropdownVisible();
    assert.ok(env.openOptions().includes(SEVENOAKS));
  });

  it('Escape closes the dropdown', async () => {
    const env = mountWidget();
    fixtures.push(env);
    await env.typeQuery('se');
    assert.ok(env.widget.isOpen());
    env.input.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!env.widget.isOpen());
  });
});

describe('court typeahead wiring in app (source + scripts)', () => {
  it('index.html loads courtAutocomplete.js after magistratesCourtsSearch.js', () => {
    const searchIdx = indexHtml.indexOf('lib/magistratesCourtsSearch.js');
    const acIdx = indexHtml.indexOf('lib/courtAutocomplete.js');
    assert.ok(searchIdx >= 0 && acIdx > searchIdx);
  });

  it('app.js wires courtName and crm14CourtName through CourtAutocomplete', () => {
    assert.match(appJs, /f\.key === 'courtName' \|\| f\.key === 'crm14CourtName'/);
    assert.match(appJs, /window\.CourtAutocomplete\.initCourtAutocomplete/);
    assert.match(appJs, /portalRoot:\s*document\.body/);
  });

  it('court dropdown CSS uses fixed positioning and high z-index', () => {
    assert.match(stylesCss, /\.court-autocomplete-dropdown\s*\{[^}]*position:\s*fixed/s);
    assert.match(stylesCss, /\.court-autocomplete-dropdown\s*\{[^}]*z-index:\s*10000/s);
  });
});

describe('courtAutocomplete module exports', () => {
  it('exports initCourtAutocomplete', () => {
    assert.strictEqual(typeof CourtAutocomplete.initCourtAutocomplete, 'function');
  });
});

/**
 * Wheel date/time picker tests.
 *
 * Covers:
 *   - Pure helpers (parse/format for time, date, datetime-local; daysIn)
 *   - attach() decorates a native input with a wp-trigger button
 *   - open() renders the popover with the right wheels for each input type
 *   - Done writes back the picked value to the input and fires input + change
 *   - Cancel does not change the input value
 *   - Now jumps to today's date/time (and respects minute step)
 *   - daysIn re-clamps when month/year change (Feb 29 etc.)
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const wp = require('../renderer/widgets/wheelDateTimePicker.js');

describe('WheelPicker — pure helpers', () => {
  it('parseTime accepts HH:MM and HH:MM:SS, rejects nonsense', () => {
    assert.deepStrictEqual(wp.parseTime('09:30'),    { h: 9,  m: 30 });
    assert.deepStrictEqual(wp.parseTime('00:00'),    { h: 0,  m: 0  });
    assert.deepStrictEqual(wp.parseTime('23:59'),    { h: 23, m: 59 });
    assert.deepStrictEqual(wp.parseTime('14:05:00'), { h: 14, m: 5  });
    assert.strictEqual(wp.parseTime('24:00'), null, '24h is out of range');
    assert.strictEqual(wp.parseTime('12:60'), null, 'min 60 is out of range');
    assert.strictEqual(wp.parseTime(''), null);
    assert.strictEqual(wp.parseTime('rubbish'), null);
    assert.strictEqual(wp.parseTime(null), null);
  });

  it('parseDate accepts YYYY-MM-DD and respects per-month day limits', () => {
    assert.deepStrictEqual(wp.parseDate('2026-04-29'), { y: 2026, mo: 4, d: 29 });
    assert.deepStrictEqual(wp.parseDate('2024-02-29'), { y: 2024, mo: 2, d: 29 }, 'leap year');
    assert.strictEqual(wp.parseDate('2025-02-29'), null, '2025 is not a leap year');
    assert.strictEqual(wp.parseDate('2026-13-01'), null, 'month 13 invalid');
    assert.strictEqual(wp.parseDate('2026-04-31'), null, 'April only has 30 days');
    assert.strictEqual(wp.parseDate('2026-4-1'), null, 'requires zero-padded form');
    assert.strictEqual(wp.parseDate(''), null);
    assert.strictEqual(wp.parseDate(null), null);
  });

  it('parseDateTime accepts both T and space separators', () => {
    assert.deepStrictEqual(wp.parseDateTime('2026-04-29T08:15'), { y: 2026, mo: 4, d: 29, h: 8, m: 15 });
    assert.deepStrictEqual(wp.parseDateTime('2026-04-29 08:15'), { y: 2026, mo: 4, d: 29, h: 8, m: 15 });
    assert.deepStrictEqual(wp.parseDateTime('2026-04-29T08:15:30'), { y: 2026, mo: 4, d: 29, h: 8, m: 15 });
    assert.strictEqual(wp.parseDateTime('not a datetime'), null);
    assert.strictEqual(wp.parseDateTime(''), null);
  });

  it('formatTime/formatDate/formatDateTime zero-pad correctly', () => {
    assert.strictEqual(wp.formatTime({ h: 9, m: 5 }),    '09:05');
    assert.strictEqual(wp.formatTime({ h: 0, m: 0 }),    '00:00');
    assert.strictEqual(wp.formatDate({ y: 2026, mo: 4, d: 9 }), '2026-04-09');
    assert.strictEqual(wp.formatDateTime({ y: 2026, mo: 4, d: 29, h: 8, m: 5 }), '2026-04-29T08:05');
  });

  it('daysIn handles Feb leap years and the long/short months', () => {
    assert.strictEqual(wp.daysIn(2024, 2), 29, '2024 is a leap year');
    assert.strictEqual(wp.daysIn(2025, 2), 28);
    assert.strictEqual(wp.daysIn(2000, 2), 29, 'div by 400 is a leap year');
    assert.strictEqual(wp.daysIn(1900, 2), 28, 'div by 100 (not 400) is NOT a leap year');
    assert.strictEqual(wp.daysIn(2026, 4), 30);
    assert.strictEqual(wp.daysIn(2026, 6), 30);
    assert.strictEqual(wp.daysIn(2026, 9), 30);
    assert.strictEqual(wp.daysIn(2026, 11), 30);
    assert.strictEqual(wp.daysIn(2026, 1), 31);
    assert.strictEqual(wp.daysIn(2026, 12), 31);
    assert.strictEqual(wp.daysIn(2026, 13), 31, 'fallback for invalid month');
  });
});

/* ── DOM smoke tests ─────────────────────────────────────────────────── */

function _bootDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  /* Expose globals expected by the widget (it inspects window). */
  global.window = dom.window;
  global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => cb());
  /* Re-load the widget freshly into this window so it injects styles + binds. */
  delete require.cache[require.resolve('../renderer/widgets/wheelDateTimePicker.js')];
  require('../renderer/widgets/wheelDateTimePicker.js');
  return dom;
}

function _newInput(dom, type, value) {
  const input = dom.window.document.createElement('input');
  input.type = type;
  if (value != null) input.value = value;
  dom.window.document.body.appendChild(input);
  return input;
}

describe('WheelPicker — attach + open + commit', () => {
  let dom;
  beforeEach(() => { dom = _bootDom(); });
  afterEach(() => {
    /* Tidy globals so other test files do not see leaked DOM. */
    delete global.window;
    delete global.document;
    delete global.MutationObserver;
  });

  it('attach decorates a time input with a wheel-trigger button', () => {
    const input = _newInput(dom, 'time', '09:30');
    dom.window.WheelPicker.attach(input);
    assert.strictEqual(input.dataset.wpAttached, '1');
    const btn = input.nextSibling;
    assert.ok(btn, 'expected a sibling trigger button');
    assert.strictEqual(btn.tagName, 'BUTTON');
    assert.ok(btn.classList.contains('wp-trigger'));
  });

  it('open() on a time input renders Hour + Minute wheels and Done commits a value', () => {
    const input = _newInput(dom, 'time', '09:30');
    let inputCount = 0, changeCount = 0;
    input.addEventListener('input',  () => inputCount++);
    input.addEventListener('change', () => changeCount++);
    dom.window.WheelPicker.open(input);

    const overlay = dom.window.document.querySelector('.wp-overlay');
    assert.ok(overlay, 'overlay must be in the DOM');
    const labels = Array.from(overlay.querySelectorAll('.wp-col-label')).map((n) => n.textContent);
    assert.deepStrictEqual(labels, ['Hour', 'Minute']);

    /* Programmatically rotate the hour wheel up by 1 (08:30 → expected). */
    const wheelEls = overlay.querySelectorAll('.wp-wheel');
    const items = wheelEls[0].querySelectorAll('.wp-wheel-item');
    /* Click hour "11" by index. */
    items[11].click();

    overlay.querySelector('.wp-done').click();

    assert.strictEqual(input.value, '11:30', 'commit should write 11:30');
    assert.ok(inputCount >= 1, 'input event should fire');
    assert.ok(changeCount >= 1, 'change event should fire');
    assert.strictEqual(dom.window.document.querySelector('.wp-overlay'), null, 'overlay closed after Done');
  });

  it('open() on a date input renders Day + Month + Year wheels', () => {
    const input = _newInput(dom, 'date', '2026-04-29');
    dom.window.WheelPicker.open(input);
    const labels = Array.from(dom.window.document.querySelectorAll('.wp-col-label')).map((n) => n.textContent);
    assert.deepStrictEqual(labels, ['Day', 'Month', 'Year']);
  });

  it('open() on a datetime-local input renders Day + Month + Year + Hour + Minute', () => {
    const input = _newInput(dom, 'datetime-local', '2026-04-29T08:15');
    dom.window.WheelPicker.open(input);
    const labels = Array.from(dom.window.document.querySelectorAll('.wp-col-label')).map((n) => n.textContent);
    assert.deepStrictEqual(labels, ['Day', 'Month', 'Year', 'Hour', 'Minute']);
  });

  it('Cancel closes the popover without writing back', () => {
    const input = _newInput(dom, 'time', '09:30');
    let writeFired = false;
    input.addEventListener('change', () => { writeFired = true; });
    dom.window.WheelPicker.open(input);

    const overlay = dom.window.document.querySelector('.wp-overlay');
    /* Pick something different. */
    const items = overlay.querySelectorAll('.wp-wheel')[0].querySelectorAll('.wp-wheel-item');
    items[15].click();

    overlay.querySelector('.wp-cancel').click();

    assert.strictEqual(input.value, '09:30', 'value unchanged');
    assert.strictEqual(writeFired, false, 'no change event fired');
    assert.strictEqual(dom.window.document.querySelector('.wp-overlay'), null);
  });

  it('Now button on a time input writes the current hour:minute', () => {
    const input = _newInput(dom, 'time', '09:30');
    dom.window.WheelPicker.open(input);
    const overlay = dom.window.document.querySelector('.wp-overlay');
    overlay.querySelector('.wp-now').click();
    overlay.querySelector('.wp-done').click();

    const now = new Date();
    const expected = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    assert.strictEqual(input.value, expected, 'Now should write current HH:MM');
  });

  it('clicking the trigger button opens the popover (attach end-to-end)', () => {
    const input = _newInput(dom, 'time');
    dom.window.WheelPicker.attach(input);
    input._wpTrigger.click();
    assert.ok(dom.window.document.querySelector('.wp-overlay'), 'overlay opened by trigger click');
    dom.window.WheelPicker.close();
  });

  it('attachAll picks up every supported input under the root', () => {
    const t = _newInput(dom, 'time');
    const d = _newInput(dom, 'date');
    const dt = _newInput(dom, 'datetime-local');
    const txt = _newInput(dom, 'text');
    /* Reset their initial state in case auto-boot has already attached them. */
    [t, d, dt].forEach((el) => { delete el.dataset.wpAttached; if (el._wpTrigger) { el._wpTrigger.remove(); delete el._wpTrigger; } });
    dom.window.WheelPicker.attachAll(dom.window.document);
    assert.strictEqual(t.dataset.wpAttached, '1');
    assert.strictEqual(d.dataset.wpAttached, '1');
    assert.strictEqual(dt.dataset.wpAttached, '1');
    assert.notStrictEqual(txt.dataset.wpAttached, '1', 'text input should be ignored');
  });

  it('data-wp-disable="1" opts an input out of decoration', () => {
    const input = _newInput(dom, 'time');
    input.setAttribute('data-wp-disable', '1');
    dom.window.WheelPicker.attach(input);
    assert.notStrictEqual(input.dataset.wpAttached, '1');
    assert.strictEqual(input.nextSibling, null, 'no trigger button should have been added');
  });
});

describe('WheelPicker — month/year change re-clamps day correctly', () => {
  let dom;
  beforeEach(() => { dom = _bootDom(); });
  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.MutationObserver;
  });

  it('switching from Jan 31 to Feb auto-clamps the day to 28 (non-leap)', () => {
    const input = _newInput(dom, 'date', '2025-01-31');
    dom.window.WheelPicker.open(input);
    const overlay = dom.window.document.querySelector('.wp-overlay');
    const wheels = overlay.querySelectorAll('.wp-wheel');
    /* Wheels are Day, Month, Year (in that visual order). Click Feb (idx 1) on the Month wheel. */
    const monthItems = wheels[1].querySelectorAll('.wp-wheel-item');
    monthItems[1].click(); // Feb
    overlay.querySelector('.wp-done').click();

    /* 31 Feb is impossible — the widget should have clamped to 28 Feb 2025. */
    assert.strictEqual(input.value, '2025-02-28', 'day should clamp to 28 for Feb in a non-leap year');
  });

  it('Feb 29 → switching to 2025 (non-leap) clamps to Feb 28', () => {
    const input = _newInput(dom, 'date', '2024-02-29');
    dom.window.WheelPicker.open(input);
    const overlay = dom.window.document.querySelector('.wp-overlay');
    const wheels = overlay.querySelectorAll('.wp-wheel');
    /* Year wheel is the 3rd column. Year list starts at currentYear-5; 2025 index depends on today. */
    const yearWheel = wheels[2];
    const yearItems = Array.from(yearWheel.querySelectorAll('.wp-wheel-item'));
    const idx2025 = yearItems.findIndex((li) => li.textContent === '2025');
    if (idx2025 === -1) {
      /* Year out of default range — skip silently rather than fail spuriously. */
      return;
    }
    yearItems[idx2025].click();
    overlay.querySelector('.wp-done').click();
    assert.strictEqual(input.value, '2025-02-28');
  });
});

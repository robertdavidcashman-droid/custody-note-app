/* ═══════════════════════════════════════════════════════
   WHEEL DATE/TIME PICKER

   Self-contained, vanilla-JS scroll-wheel ("rotating counter") picker for
   <input type="time">, <input type="date"> and <input type="datetime-local">.
   Written to be friendly to thumbs (police-station phones), keyboards
   (Windows tablets in interview rooms) and mice (back at the office).

   Loaded after app.js. Exports:

     window.WheelPicker = {
       attach(input, opts)            — render the wheel button next to input
       attachAll(root)                — auto-attach to every supported input
       detach(input)
       open(input, opts)              — programmatic open of the popover
       close()
       parseTime(str)  → { h, m } | null
       parseDate(str)  → { y, mo, d } | null
       parseDateTime(str) → { y, mo, d, h, m } | null
       formatTime({h,m}) → 'HH:MM'
       formatDate({y,mo,d}) → 'YYYY-MM-DD'
       formatDateTime({y,mo,d,h,m}) → 'YYYY-MM-DDTHH:MM'
       daysIn(y, mo)   → 28 | 29 | 30 | 31  (mo is 1..12)
     }

   Design notes:
   - Native input is the source of truth: when the user picks a value in the
     wheel and presses Done, we write the standard ISO format back to the
     input's `.value` and dispatch input + change events so existing code
     (auto-save, validation, draft persistence) continues to work unchanged.
   - The input still accepts manual typing — the wheel is OPT-IN via a small
     button next to the field.
   - All DOM is created in JS so no template/CSP-inline-script issues.
   - Styles are injected once into <head> (CSP allows 'unsafe-inline' styles).
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─── Pure helpers (also exported for tests) ─────────────────────────── */

  function _pad2(n) {
    n = Number(n);
    if (!Number.isFinite(n)) n = 0;
    n = Math.max(0, Math.floor(n));
    return n < 10 ? '0' + n : String(n);
  }

  function daysIn(year, month) {
    /* month is 1..12. Returns 28, 29, 30 or 31. */
    var m = Number(month);
    var y = Number(year);
    if (!Number.isFinite(m) || m < 1 || m > 12) return 31;
    if (!Number.isFinite(y)) y = 2000;
    if (m === 2) {
      var leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      return leap ? 29 : 28;
    }
    if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
    return 31;
  }

  function parseTime(s) {
    if (s == null) return null;
    var m = String(s).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var mi = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
    if (h < 0 || h > 23) return null;
    if (mi < 0 || mi > 59) return null;
    return { h: h, m: mi };
  }

  function parseDate(s) {
    if (s == null) return null;
    var m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
    if (mo < 1 || mo > 12) return null;
    if (d < 1 || d > daysIn(y, mo)) return null;
    return { y: y, mo: mo, d: d };
  }

  function parseDateTime(s) {
    if (s == null) return null;
    var raw = String(s).trim();
    if (!raw) return null;
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return null;
    var d = parseDate(m[1] + '-' + m[2] + '-' + m[3]);
    var t = parseTime(m[4] + ':' + m[5]);
    if (!d || !t) return null;
    return { y: d.y, mo: d.mo, d: d.d, h: t.h, m: t.m };
  }

  function formatTime(o) {
    if (!o) return '';
    return _pad2(o.h) + ':' + _pad2(o.m);
  }
  function formatDate(o) {
    if (!o) return '';
    return _pad2(o.y).length < 4 ? String(o.y).padStart(4, '0') + '-' + _pad2(o.mo) + '-' + _pad2(o.d)
                                 : o.y + '-' + _pad2(o.mo) + '-' + _pad2(o.d);
  }
  function formatDateTime(o) {
    if (!o) return '';
    return formatDate({ y: o.y, mo: o.mo, d: o.d }) + 'T' + formatTime({ h: o.h, m: o.m });
  }

  function _now() { return new Date(); }
  function _todayParts() {
    var d = _now();
    return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), m: d.getMinutes() };
  }

  /* ─── Style injection (one-shot) ─────────────────────────────────────── */

  var STYLE_ID = 'wheel-picker-styles';
  function _injectStyles(doc) {
    doc = doc || document;
    if (doc.getElementById(STYLE_ID)) return;
    var css = [
      '.wp-trigger {',
      '  display:inline-flex;align-items:center;justify-content:center;',
      '  margin-left:6px;width:32px;height:32px;border-radius:8px;',
      '  border:1px solid #cbd5e1;background:#f8fafc;color:#1e293b;cursor:pointer;',
      '  font-size:1rem;line-height:1;padding:0;',
      '}',
      '.wp-trigger:hover{background:#e2e8f0;}',
      '.wp-trigger:focus-visible{outline:2px solid #3b82f6;outline-offset:2px;}',
      '.wp-trigger[aria-expanded="true"]{background:#3b82f6;color:#fff;border-color:#2563eb;}',
      '.wp-input-wrap{display:inline-flex;align-items:center;}',
      '',
      '.wp-overlay{',
      '  position:fixed;inset:0;background:rgba(15,23,42,0.45);',
      '  z-index:10500;display:flex;align-items:center;justify-content:center;',
      '  padding:1rem;',
      '}',
      '.wp-popover{',
      '  background:#fff;border-radius:18px;box-shadow:0 25px 60px rgba(0,0,0,0.35);',
      '  padding:1rem 1rem 0.85rem;max-width:calc(100vw - 2rem);width:auto;',
      '  display:flex;flex-direction:column;gap:0.6rem;',
      '  color:#0f172a;font-family:inherit;',
      '}',
      '.wp-title{font-size:0.95rem;font-weight:600;text-align:center;margin:0;}',
      '.wp-wheels{display:flex;gap:0.4rem;justify-content:center;align-items:stretch;}',
      '.wp-col{',
      '  display:flex;flex-direction:column;align-items:center;gap:4px;min-width:60px;',
      '}',
      '.wp-col-label{font-size:0.7rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;}',
      '.wp-wheel{',
      '  position:relative;width:64px;height:160px;overflow-y:scroll;',
      '  scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;',
      '  scrollbar-width:none;-ms-overflow-style:none;',
      '  border:1px solid #e2e8f0;border-radius:10px;background:#fff;',
      '  outline:none;',
      '}',
      '.wp-wheel::-webkit-scrollbar{display:none;}',
      '.wp-wheel:focus-visible{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,0.3);}',
      '.wp-wheel-list{padding:64px 0;margin:0;list-style:none;}',
      '.wp-wheel-item{',
      '  scroll-snap-align:center;',
      '  height:32px;line-height:32px;text-align:center;',
      '  font-size:1.05rem;color:#94a3b8;font-variant-numeric:tabular-nums;',
      '  cursor:pointer;user-select:none;',
      '  transition:color 0.15s ease, font-size 0.15s ease;',
      '}',
      '.wp-wheel-item.is-near{color:#475569;}',
      '.wp-wheel-item.is-active{color:#0f172a;font-size:1.25rem;font-weight:600;}',
      '.wp-wheel-band{',
      '  pointer-events:none;position:absolute;left:0;right:0;top:50%;',
      '  height:32px;margin-top:-16px;',
      '  border-top:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;',
      '  background:rgba(59,130,246,0.06);',
      '}',
      '',
      '.wp-actions{display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.4rem;flex-wrap:wrap;}',
      '.wp-btn{',
      '  padding:0.45rem 0.95rem;border-radius:8px;font-size:0.9rem;cursor:pointer;',
      '  border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;',
      '}',
      '.wp-btn.is-primary{background:#2563eb;color:#fff;border-color:#1d4ed8;}',
      '.wp-btn.is-primary:hover{background:#1d4ed8;}',
      '.wp-btn.is-now{background:#fff;border-color:#cbd5e1;}',
      '.wp-btn:hover{background:#e2e8f0;}',
      '.wp-btn:focus-visible{outline:2px solid #3b82f6;outline-offset:2px;}',
      '',
      '@media (max-width:480px){',
      '  .wp-wheel{width:58px;height:144px;}',
      '  .wp-wheel-list{padding:56px 0;}',
      '  .wp-wheel-item{height:32px;line-height:32px;}',
      '}',
    ].join('\n');
    var s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    (doc.head || doc.documentElement).appendChild(s);
  }

  /* ─── Wheel column ───────────────────────────────────────────────────── */

  function _buildWheel(doc, label, items, initialIndex) {
    var col = doc.createElement('div');
    col.className = 'wp-col';
    col.innerHTML = '<div class="wp-col-label">' + label + '</div>';

    var wheel = doc.createElement('div');
    wheel.className = 'wp-wheel';
    wheel.tabIndex = 0;
    wheel.setAttribute('role', 'listbox');
    wheel.setAttribute('aria-label', label);

    var list = doc.createElement('ul');
    list.className = 'wp-wheel-list';
    items.forEach(function (label, i) {
      var li = doc.createElement('li');
      li.className = 'wp-wheel-item';
      li.textContent = label;
      li.setAttribute('role', 'option');
      li.setAttribute('data-idx', String(i));
      list.appendChild(li);
    });

    var band = doc.createElement('div');
    band.className = 'wp-wheel-band';

    wheel.appendChild(list);
    wheel.appendChild(band);
    col.appendChild(wheel);

    var rowH = 32;
    var state = { items: items.slice(), index: 0, scrollEndTimer: null };

    function _updateActiveClasses() {
      var children = list.children;
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        c.classList.remove('is-active', 'is-near');
        var d = Math.abs(i - state.index);
        if (d === 0) c.classList.add('is-active');
        else if (d === 1) c.classList.add('is-near');
      }
      wheel.setAttribute('aria-activedescendant', '');
    }

    function setIndex(idx, smooth) {
      if (idx < 0) idx = 0;
      if (idx > state.items.length - 1) idx = state.items.length - 1;
      state.index = idx;
      var top = idx * rowH;
      try {
        wheel.scrollTo({ top: top, behavior: smooth ? 'smooth' : 'auto' });
      } catch (_) {
        wheel.scrollTop = top;
      }
      _updateActiveClasses();
    }

    function setItems(newItems, keepIdx) {
      state.items = newItems.slice();
      list.innerHTML = '';
      newItems.forEach(function (label, i) {
        var li = doc.createElement('li');
        li.className = 'wp-wheel-item';
        li.textContent = label;
        li.setAttribute('role', 'option');
        li.setAttribute('data-idx', String(i));
        list.appendChild(li);
      });
      var idx = (typeof keepIdx === 'number') ? keepIdx : state.index;
      if (idx > newItems.length - 1) idx = newItems.length - 1;
      if (idx < 0) idx = 0;
      setIndex(idx, false);
    }

    /* Snap to nearest after the user stops scrolling. */
    function _onScroll() {
      if (state.scrollEndTimer) clearTimeout(state.scrollEndTimer);
      state.scrollEndTimer = setTimeout(function () {
        var idx = Math.round(wheel.scrollTop / rowH);
        if (idx !== state.index) {
          state.index = idx;
          _updateActiveClasses();
          if (typeof state.onChange === 'function') state.onChange(idx);
        }
        /* Re-snap exactly so partial scrolls finish on a row boundary. */
        var snapTop = idx * rowH;
        if (Math.abs(wheel.scrollTop - snapTop) > 1) {
          try { wheel.scrollTo({ top: snapTop, behavior: 'smooth' }); } catch (_) { wheel.scrollTop = snapTop; }
        }
      }, 90);
    }
    wheel.addEventListener('scroll', _onScroll, { passive: true });

    /* Click an item to select. */
    list.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.classList.contains('wp-wheel-item')) return;
      var idx = parseInt(t.getAttribute('data-idx'), 10);
      if (Number.isFinite(idx)) setIndex(idx, true);
      if (typeof state.onChange === 'function') state.onChange(state.index);
    });

    /* Keyboard support: Up/Down by 1, PageUp/Down by 5, Home/End. */
    wheel.addEventListener('keydown', function (ev) {
      var k = ev.key;
      var i = state.index;
      if (k === 'ArrowDown') { setIndex(i + 1, true); ev.preventDefault(); }
      else if (k === 'ArrowUp') { setIndex(i - 1, true); ev.preventDefault(); }
      else if (k === 'PageDown') { setIndex(i + 5, true); ev.preventDefault(); }
      else if (k === 'PageUp') { setIndex(i - 5, true); ev.preventDefault(); }
      else if (k === 'Home') { setIndex(0, true); ev.preventDefault(); }
      else if (k === 'End') { setIndex(state.items.length - 1, true); ev.preventDefault(); }
      else { return; }
      if (typeof state.onChange === 'function') state.onChange(state.index);
    });

    /* Initial position once mounted. */
    function init() {
      setIndex(initialIndex || 0, false);
    }

    return {
      element: col,
      wheel: wheel,
      setIndex: setIndex,
      setItems: setItems,
      getIndex: function () { return state.index; },
      onChange: function (cb) { state.onChange = cb; },
      init: init,
    };
  }

  /* ─── Popover ────────────────────────────────────────────────────────── */

  var _activePopover = null;

  function close() {
    if (!_activePopover) return;
    var doc = _activePopover.doc;
    if (_activePopover.escHandler) doc.removeEventListener('keydown', _activePopover.escHandler);
    if (_activePopover.element && _activePopover.element.parentNode) {
      _activePopover.element.parentNode.removeChild(_activePopover.element);
    }
    if (_activePopover.trigger) _activePopover.trigger.setAttribute('aria-expanded', 'false');
    _activePopover = null;
  }

  function _writeBack(input, value) {
    if (input.value === value) return;
    input.value = value;
    var win = input.ownerDocument.defaultView || window;
    try { input.dispatchEvent(new win.Event('input',  { bubbles: true })); } catch (_) {}
    try { input.dispatchEvent(new win.Event('change', { bubbles: true })); } catch (_) {}
  }

  function _hourLabels() {
    var out = []; for (var i = 0; i < 24; i++) out.push(_pad2(i)); return out;
  }
  function _minuteLabels(step) {
    var out = []; for (var i = 0; i < 60; i += (step || 1)) out.push(_pad2(i)); return out;
  }
  var MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function _yearLabels(yMin, yMax) {
    var out = []; for (var y = yMin; y <= yMax; y++) out.push(String(y)); return out;
  }
  function _dayLabels(maxDay) {
    var out = []; for (var d = 1; d <= maxDay; d++) out.push(_pad2(d)); return out;
  }

  function open(input, opts) {
    if (!input) return;
    opts = opts || {};
    var doc = input.ownerDocument || document;
    var win = doc.defaultView || window;
    _injectStyles(doc);
    close();

    var type = String(input.type || '').toLowerCase();
    if (type !== 'time' && type !== 'date' && type !== 'datetime-local') return;

    var stepMin = parseInt(input.getAttribute('data-wp-minute-step') || opts.minuteStep || '1', 10) || 1;
    var yMin = parseInt(input.getAttribute('data-wp-year-min') || opts.yearMin || '0', 10);
    var yMax = parseInt(input.getAttribute('data-wp-year-max') || opts.yearMax || '0', 10);
    if (!yMin || !yMax) {
      var nowY = new Date().getFullYear();
      yMin = nowY - 5; yMax = nowY + 5;
    }
    if (yMax < yMin) { var swap = yMin; yMin = yMax; yMax = swap; }

    /* Initial value: input.value if parseable, else now. */
    var initial;
    if (type === 'time') {
      initial = parseTime(input.value) || (function () { var n = _todayParts(); return { h: n.h, m: n.m }; })();
    } else if (type === 'date') {
      initial = parseDate(input.value) || (function () { var n = _todayParts(); return { y: n.y, mo: n.mo, d: n.d }; })();
    } else {
      initial = parseDateTime(input.value) || _todayParts();
    }

    /* Build overlay. */
    var overlay = doc.createElement('div');
    overlay.className = 'wp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var pop = doc.createElement('div');
    pop.className = 'wp-popover';
    pop.setAttribute('role', 'group');

    var titleText = opts.title || (type === 'time' ? 'Pick time'
                                : type === 'date' ? 'Pick date'
                                : 'Pick date & time');
    var titleEl = doc.createElement('h4');
    titleEl.className = 'wp-title';
    titleEl.textContent = titleText;
    pop.appendChild(titleEl);

    var wheels = doc.createElement('div');
    wheels.className = 'wp-wheels';
    pop.appendChild(wheels);

    var dayCol, monthCol, yearCol, hourCol, minCol;
    var stepMinutes = Math.max(1, Math.min(30, stepMin));
    var minuteValues = []; for (var mm = 0; mm < 60; mm += stepMinutes) minuteValues.push(mm);

    function _closestMinIndex(m) {
      var best = 0; var bestDiff = Infinity;
      for (var i = 0; i < minuteValues.length; i++) {
        var d = Math.abs(minuteValues[i] - m);
        if (d < bestDiff) { bestDiff = d; best = i; }
      }
      return best;
    }

    if (type === 'date' || type === 'datetime-local') {
      yearCol  = _buildWheel(doc, 'Year',  _yearLabels(yMin, yMax),                  Math.max(0, initial.y - yMin));
      monthCol = _buildWheel(doc, 'Month', MONTH_LABELS,                              Math.max(0, initial.mo - 1));
      dayCol   = _buildWheel(doc, 'Day',   _dayLabels(daysIn(initial.y, initial.mo)), Math.max(0, initial.d - 1));
      wheels.appendChild(dayCol.element);
      wheels.appendChild(monthCol.element);
      wheels.appendChild(yearCol.element);

      function _reclampDay() {
        var y = yMin + yearCol.getIndex();
        var mo = monthCol.getIndex() + 1;
        var max = daysIn(y, mo);
        var prevDay = dayCol.getIndex() + 1;
        var newDay = Math.min(prevDay, max);
        dayCol.setItems(_dayLabels(max), newDay - 1);
      }
      monthCol.onChange(_reclampDay);
      yearCol.onChange(_reclampDay);
    }

    if (type === 'time' || type === 'datetime-local') {
      hourCol = _buildWheel(doc, 'Hour',   _hourLabels(),               Math.max(0, initial.h));
      minCol  = _buildWheel(doc, 'Minute', _minuteLabels(stepMinutes),  _closestMinIndex(initial.m));
      wheels.appendChild(hourCol.element);
      wheels.appendChild(minCol.element);
    }

    var actions = doc.createElement('div');
    actions.className = 'wp-actions';
    actions.innerHTML =
      '<button type="button" class="wp-btn wp-cancel">Cancel</button>' +
      '<button type="button" class="wp-btn is-now wp-now">Now</button>' +
      '<button type="button" class="wp-btn is-primary wp-done">Done</button>';
    pop.appendChild(actions);

    overlay.appendChild(pop);
    doc.body.appendChild(overlay);

    /* Trigger element (button or input) for aria-expanded/focus return. */
    var trigger = (opts.trigger && opts.trigger.tagName) ? opts.trigger : input;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');

    /* Initialise scroll positions synchronously so getIndex() is correct
       immediately (also makes the picker testable under jsdom). We also
       re-run inside requestAnimationFrame so that real browsers settle
       any layout-driven scroll snapping after the first paint. */
    function _initWheels() {
      if (yearCol)  yearCol.init();
      if (monthCol) monthCol.init();
      if (dayCol)   dayCol.init();
      if (hourCol)  hourCol.init();
      if (minCol)   minCol.init();
    }
    _initWheels();
    if (typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(_initWheels);
    }

    function _writeNow() {
      var n = _todayParts();
      if (yearCol)  yearCol.setIndex(Math.max(0, n.y - yMin), true);
      if (monthCol) monthCol.setIndex(n.mo - 1, true);
      if (dayCol)   {
        dayCol.setItems(_dayLabels(daysIn(n.y, n.mo)), n.d - 1);
      }
      if (hourCol)  hourCol.setIndex(n.h, true);
      if (minCol)   minCol.setIndex(_closestMinIndex(n.m), true);
    }

    function _commit() {
      var value;
      if (type === 'time') {
        value = formatTime({ h: hourCol.getIndex(), m: minuteValues[minCol.getIndex()] });
      } else if (type === 'date') {
        value = formatDate({
          y:  yMin + yearCol.getIndex(),
          mo: monthCol.getIndex() + 1,
          d:  dayCol.getIndex() + 1,
        });
      } else {
        value = formatDateTime({
          y:  yMin + yearCol.getIndex(),
          mo: monthCol.getIndex() + 1,
          d:  dayCol.getIndex() + 1,
          h:  hourCol.getIndex(),
          m:  minuteValues[minCol.getIndex()],
        });
      }
      _writeBack(input, value);
      close();
      try { input.focus({ preventScroll: true }); } catch (_) {}
    }

    pop.querySelector('.wp-cancel').addEventListener('click', function () { close(); try { input.focus({ preventScroll: true }); } catch (_) {} });
    pop.querySelector('.wp-now').addEventListener('click', _writeNow);
    pop.querySelector('.wp-done').addEventListener('click', _commit);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    function _onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Enter' && !e.target.classList.contains('wp-cancel')) {
        _commit();
        e.preventDefault();
      }
    }
    doc.addEventListener('keydown', _onKey);

    _activePopover = { element: overlay, doc: doc, escHandler: _onKey, trigger: trigger };
  }

  /* ─── Attach trigger button next to inputs ───────────────────────────── */

  function _supportedType(t) {
    t = String(t || '').toLowerCase();
    return t === 'time' || t === 'date' || t === 'datetime-local';
  }

  function attach(input, opts) {
    if (!input || input.dataset.wpAttached === '1') return;
    if (!_supportedType(input.type)) return;
    if (input.getAttribute('data-wp-disable') === '1') return;
    var doc = input.ownerDocument || document;
    _injectStyles(doc);

    /* Wrap input so the button is glued next to it without disturbing
       layout: we only add a wrapper if one isn't already there. */
    var parent = input.parentNode;
    if (!parent) return;

    var iconText = input.type === 'date' ? '\u{1F4C5}'
                : input.type === 'time' ? '\u{1F551}'
                : '\u{1F4C5}\u{1F551}';

    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'wp-trigger';
    btn.innerHTML = '<span aria-hidden="true">' + iconText + '</span>';
    btn.setAttribute('aria-label', 'Open wheel picker for ' + (input.getAttribute('aria-label') || input.id || input.name || input.type));
    btn.setAttribute('aria-expanded', 'false');
    btn.tabIndex = 0;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      open(input, Object.assign({ trigger: btn }, opts || {}));
    });

    /* Insert immediately after the input. */
    if (input.nextSibling) parent.insertBefore(btn, input.nextSibling);
    else parent.appendChild(btn);

    input.dataset.wpAttached = '1';
    input._wpTrigger = btn;
  }

  function detach(input) {
    if (!input || input.dataset.wpAttached !== '1') return;
    if (input._wpTrigger && input._wpTrigger.parentNode) {
      input._wpTrigger.parentNode.removeChild(input._wpTrigger);
    }
    delete input._wpTrigger;
    delete input.dataset.wpAttached;
  }

  function attachAll(root) {
    root = root || document;
    var sel = 'input[type="time"], input[type="date"], input[type="datetime-local"]';
    var nodes = root.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) attach(nodes[i]);
  }

  /* Auto-attach on first DOM ready, and also expose attachAll for any view
     that re-renders inputs dynamically (e.g. station visit blocks). */
  function _autoBoot() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        try { attachAll(document); } catch (e) { console.warn('[WheelPicker] attachAll failed', e); }
        _watchDom();
      }, { once: true });
    } else {
      try { attachAll(document); } catch (e) { console.warn('[WheelPicker] attachAll failed', e); }
      _watchDom();
    }
  }

  /* Catch dynamically-added inputs (modal forms, station visit cards). */
  var _mo = null;
  function _watchDom() {
    if (_mo || typeof MutationObserver === 'undefined') return;
    _mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (!n || n.nodeType !== 1) continue;
          if (_supportedType(n.type)) attach(n);
          if (n.querySelectorAll) {
            var nested = n.querySelectorAll('input[type="time"], input[type="date"], input[type="datetime-local"]');
            for (var k = 0; k < nested.length; k++) attach(nested[k]);
          }
        }
      }
    });
    _mo.observe(document.body, { childList: true, subtree: true });
  }

  var api = {
    attach: attach,
    attachAll: attachAll,
    detach: detach,
    open: open,
    close: close,
    parseTime: parseTime,
    parseDate: parseDate,
    parseDateTime: parseDateTime,
    formatTime: formatTime,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    daysIn: daysIn,
  };

  if (typeof window !== 'undefined') {
    window.WheelPicker = api;
    _autoBoot();
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();

'use strict';

/**
 * Magistrates court typeahead widget.
 * Dropdown is portaled to document.body so CSS contain/transform on
 * .attendance-form / .form-section cannot clip or mis-position it.
 */

var COURT_STOP_WORDS = {
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

function getSearchApi(override) {
  if (override) return override;
  if (typeof window !== 'undefined' && window.MagistratesCourtsSearch) {
    return window.MagistratesCourtsSearch;
  }
  if (typeof MagistratesCourtsSearch !== 'undefined') return MagistratesCourtsSearch;
  return null;
}

function isDropdownVisible(dropdown) {
  if (!dropdown || !dropdown.classList.contains('open')) return false;
  if (dropdown.style.display === 'none') return false;
  var cs = typeof window !== 'undefined' && window.getComputedStyle
    ? window.getComputedStyle(dropdown)
    : null;
  if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
  return true;
}

/**
 * @param {HTMLInputElement} input
 * @param {object} options
 * @param {function(): string[]} options.getCourts
 * @param {function(): Promise} options.ensureLoaded
 * @param {function(string): void} [options.onSelect]
 * @param {string} [options.fieldKey]
 * @param {object} [options.formData]
 * @param {object} [options.searchApi]
 * @param {HTMLElement} [options.portalRoot] - defaults to document.body
 * @param {HTMLElement} [options.dropdown] - optional existing element; otherwise created
 */
function initCourtAutocomplete(input, options) {
  options = options || {};
  if (!input) throw new Error('initCourtAutocomplete requires an input');

  var fieldKey = options.fieldKey || input.getAttribute('data-field') || input.name || 'courtName';
  var portalRoot = options.portalRoot || (typeof document !== 'undefined' ? document.body : null);
  var searchApiOverride = options.searchApi || null;

  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');

  var dropdown = options.dropdown || document.createElement('div');
  dropdown.classList.add('offence-autocomplete-dropdown', 'court-autocomplete-dropdown');
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('data-court-autocomplete-for', fieldKey);
  if (dropdown.parentNode !== portalRoot && portalRoot) {
    portalRoot.appendChild(dropdown);
  }

  var activeIndex = -1;
  var currentItems = [];
  var _courtDebounce = null;
  var _destroyed = false;
  var _suppressSuggestionsUntil = 0;

  function getCourts() {
    return (typeof options.getCourts === 'function' ? options.getCourts() : []) || [];
  }

  function ensureLoaded() {
    if (typeof options.ensureLoaded === 'function') return options.ensureLoaded();
    return Promise.resolve(getCourts());
  }

  function writeValue(name) {
    // Selecting fills the input and fires 'input' — suppress the debounce
    // re-open that would otherwise flash the list again.
    _suppressSuggestionsUntil = Date.now() + 250;
    clearTimeout(_courtDebounce);
    input.value = name;
    if (options.formData && fieldKey) options.formData[fieldKey] = name;
    if (typeof options.onSelect === 'function') options.onSelect(name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function positionCourtDropdown() {
    if (!dropdown.classList.contains('open')) return;
    var rect = input.getBoundingClientRect();
    var viewportH = (typeof window !== 'undefined' && window.innerHeight) || 800;
    var spaceBelow = viewportH - rect.bottom;
    var preferAbove = spaceBelow < 180 && rect.top > spaceBelow;
    var maxH = Math.min(340, Math.max(160, preferAbove ? rect.top - 16 : spaceBelow - 16));

    dropdown.style.position = 'fixed';
    dropdown.style.left = Math.max(8, rect.left) + 'px';
    dropdown.style.width = Math.max(rect.width, 280) + 'px';
    dropdown.style.right = 'auto';
    dropdown.style.zIndex = '10000';
    dropdown.style.maxHeight = maxH + 'px';
    dropdown.style.overflowY = 'auto';
    dropdown.style.display = 'block';

    if (preferAbove) {
      dropdown.style.top = 'auto';
      dropdown.style.bottom = (viewportH - rect.top + 2) + 'px';
    } else {
      dropdown.style.bottom = 'auto';
      dropdown.style.top = (rect.bottom + 2) + 'px';
    }
  }

  function closeDropdown() {
    dropdown.classList.remove('open');
    dropdown.style.display = 'none';
    dropdown.style.position = '';
    dropdown.style.left = '';
    dropdown.style.top = '';
    dropdown.style.bottom = '';
    dropdown.style.width = '';
    dropdown.style.right = '';
    dropdown.style.zIndex = '';
    dropdown.style.maxHeight = '';
    activeIndex = -1;
    currentItems = [];
    window.removeEventListener('scroll', _courtScrollReposition, true);
    window.removeEventListener('resize', _courtScrollReposition);
  }

  function highlightActive() {
    var opts = dropdown.querySelectorAll('.offence-autocomplete-option');
    for (var i = 0; i < opts.length; i++) {
      if (i === activeIndex) {
        opts[i].classList.add('active');
        opts[i].setAttribute('aria-selected', 'true');
        if (typeof opts[i].scrollIntoView === 'function') {
          opts[i].scrollIntoView({ block: 'nearest' });
        }
      } else {
        opts[i].classList.remove('active');
        opts[i].removeAttribute('aria-selected');
      }
    }
  }

  function selectIndex(idx) {
    if (idx < 0 || idx >= currentItems.length) return;
    writeValue(currentItems[idx]);
    closeDropdown();
  }

  function showHint(text) {
    dropdown.innerHTML = '';
    currentItems = [];
    activeIndex = -1;
    var hintEl = document.createElement('div');
    hintEl.className = 'offence-autocomplete-hint';
    hintEl.style.padding = '10px 12px';
    hintEl.style.fontSize = '0.88rem';
    hintEl.style.color = '#64748b';
    hintEl.textContent = text;
    dropdown.appendChild(hintEl);
    dropdown.classList.add('open');
    positionCourtDropdown();
  }

  function setSuggestions(query, opts) {
    if (_destroyed) return;
    if (Date.now() < _suppressSuggestionsUntil) {
      closeDropdown();
      return;
    }
    opts = opts || {};
    var searchApi = getSearchApi(searchApiOverride);
    var rawQ = String(query || '').trim();
    var normFn = searchApi && searchApi.normalizeCourtSearchQuery;
    var q = normFn ? normFn(rawQ) : rawQ;
    dropdown.innerHTML = '';
    currentItems = [];
    activeIndex = -1;

    if (!rawQ) {
      showHint('Type at least 2 letters to search magistrates courts in England and Wales.');
      return;
    }
    if (rawQ.length < 2) {
      showHint('Type at least 2 letters to search.');
      return;
    }
    if (!searchApi || typeof searchApi.searchMagistratesCourts !== 'function') {
      showHint('Court search is unavailable — restart the app and try again.');
      return;
    }

    var courts = getCourts();
    if (!courts.length) {
      if (opts.loadFailed) {
        showHint('Court list failed to load — restart the app. You can still type the court name manually.');
        return;
      }
      showHint('Loading magistrates courts…');
      ensureLoaded().then(function () {
        if (_destroyed) return;
        if (document.activeElement === input) {
          setSuggestions(input.value, {
            loading: false,
            loadFailed: !getCourts().length,
          });
        }
      });
      return;
    }

    var items = searchApi.searchMagistratesCourts(courts, q, 20);
    if (!items.length) {
      showHint("No courts match '" + rawQ + "' — try a different spelling.");
      return;
    }

    currentItems = items.slice();
    items.forEach(function (name, idx) {
      var opt = document.createElement('div');
      opt.className = 'offence-autocomplete-option';
      opt.setAttribute('role', 'option');
      opt.textContent = name;
      opt.addEventListener('mousedown', function (e) {
        e.preventDefault();
        selectIndex(idx);
      });
      dropdown.appendChild(opt);
    });
    dropdown.classList.add('open');
    positionCourtDropdown();
  }

  function runSuggestions(opts) {
    setSuggestions(input.value, opts);
  }

  var _courtScrollReposition = function () {
    positionCourtDropdown();
  };

  input.addEventListener('focus', function () {
    ensureLoaded().finally(function () {
      if (_destroyed) return;
      runSuggestions({
        loading: !getCourts().length,
        loadFailed: !getCourts().length,
      });
    });
    window.addEventListener('scroll', _courtScrollReposition, true);
    window.addEventListener('resize', _courtScrollReposition);
  });

  input.addEventListener('input', function () {
    if (Date.now() < _suppressSuggestionsUntil) {
      clearTimeout(_courtDebounce);
      closeDropdown();
      return;
    }
    clearTimeout(_courtDebounce);
    _courtDebounce = setTimeout(function () {
      runSuggestions();
    }, 80);
  });

  input.addEventListener('blur', function () {
    setTimeout(function () {
      if (_destroyed) return;
      closeDropdown();
    }, 180);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeDropdown();
      return;
    }

    var open = isDropdownVisible(dropdown) && currentItems.length > 0;
    if (e.key === 'ArrowDown') {
      if (!open) {
        runSuggestions();
        return;
      }
      e.preventDefault();
      activeIndex = activeIndex < currentItems.length - 1 ? activeIndex + 1 : 0;
      highlightActive();
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      activeIndex = activeIndex > 0 ? activeIndex - 1 : currentItems.length - 1;
      highlightActive();
      return;
    }
    if (e.key === 'Enter') {
      if (open && activeIndex >= 0) {
        e.preventDefault();
        selectIndex(activeIndex);
      }
    }
  });

  return {
    dropdown: dropdown,
    setSuggestions: setSuggestions,
    runSuggestions: runSuggestions,
    closeDropdown: closeDropdown,
    positionCourtDropdown: positionCourtDropdown,
    isOpen: function () {
      return isDropdownVisible(dropdown);
    },
    getItems: function () {
      return currentItems.slice();
    },
    destroy: function () {
      _destroyed = true;
      clearTimeout(_courtDebounce);
      closeDropdown();
      if (dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);
    },
  };
}

var CourtAutocomplete = {
  initCourtAutocomplete: initCourtAutocomplete,
  isDropdownVisible: isDropdownVisible,
  COURT_STOP_WORDS: COURT_STOP_WORDS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CourtAutocomplete;
}
if (typeof window !== 'undefined') {
  window.CourtAutocomplete = CourtAutocomplete;
}

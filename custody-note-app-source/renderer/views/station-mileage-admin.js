/* ═══════════════════════════════════════════════════════
   STATION MILEAGE ADMIN
   Manage mileage_from_base for each police station.
   Depends on: showToast, esc (app.js globals), window.api
   ═══════════════════════════════════════════════════════ */

var _mileageStations = [];
var _mileageDirty = {};

function loadStationMileage() {
  if (!window.api || !window.api.stationsMileageList) return;

  window.api.stationsMileageList().then(function (rows) {
    _mileageStations = rows || [];
    _mileageDirty = {};
    _renderMileageTable();
  }).catch(function () {
    showToast('Could not load station mileage data', 'error');
  });
}

function _mileageEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _renderMileageTable() {
  var wrap = document.getElementById('station-mileage-table-wrap');
  if (!wrap) return;

  var search = (document.getElementById('mileage-search')?.value || '').toLowerCase().trim();

  var filtered = _mileageStations;
  if (search) {
    filtered = _mileageStations.filter(function (s) {
      return (s.name + ' ' + (s.code || '') + ' ' + (s.scheme || '') + ' ' + (s.region || '')).toLowerCase().indexOf(search) !== -1;
    });
  }

  if (!filtered.length) {
    wrap.innerHTML = '<p class="settings-hint">No stations found.</p>';
    return;
  }

  var html = '<table class="billable-table"><thead><tr>' +
    '<th>Station Name</th><th>Code</th><th>Scheme</th><th>Region</th>' +
    '<th>Mileage from Base</th><th>Postcode</th>' +
    '</tr></thead><tbody>';

  filtered.forEach(function (s) {
    var mileVal = s.mileage_from_base != null ? s.mileage_from_base : '';
    html += '<tr>' +
      '<td>' + _mileageEsc(s.name) + '</td>' +
      '<td>' + _mileageEsc(s.code) + '</td>' +
      '<td>' + _mileageEsc(s.scheme) + '</td>' +
      '<td>' + _mileageEsc(s.region) + '</td>' +
      '<td><input type="number" class="form-input mileage-input" data-sid="' + s.id + '" data-field="mileage" value="' + mileVal + '" step="0.1" placeholder="miles" style="width:100px;"></td>' +
      '<td><input type="text" class="form-input mileage-input" data-sid="' + s.id + '" data-field="postcode" value="' + _mileageEsc(s.postcode || '') + '" placeholder="e.g. CT1 1AA" style="width:120px;"></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('.mileage-input').forEach(function (inp) {
    inp.addEventListener('input', function () {
      var sid = inp.getAttribute('data-sid');
      var field = inp.getAttribute('data-field');
      if (!_mileageDirty[sid]) _mileageDirty[sid] = {};
      if (field === 'mileage') {
        _mileageDirty[sid].mileage_from_base = inp.value !== '' ? parseFloat(inp.value) : null;
      } else {
        _mileageDirty[sid].postcode = inp.value;
      }
    });
  });
}

function _saveAllMileage() {
  var ids = Object.keys(_mileageDirty);
  if (!ids.length) {
    showToast('No changes to save', 'info');
    return;
  }

  var updates = ids.map(function (id) {
    var existing = _mileageStations.find(function (s) { return String(s.id) === id; });
    return {
      id: parseInt(id, 10),
      mileage_from_base: _mileageDirty[id].mileage_from_base !== undefined
        ? _mileageDirty[id].mileage_from_base
        : (existing ? existing.mileage_from_base : null),
      postcode: _mileageDirty[id].postcode !== undefined
        ? _mileageDirty[id].postcode
        : (existing ? existing.postcode : ''),
    };
  });

  window.api.stationMileageBulkSave(updates).then(function () {
    showToast('Station mileage saved', 'success');
    _mileageDirty = {};
    loadStationMileage();
  }).catch(function () {
    showToast('Failed to save station mileage', 'error');
  });
}

(function _initMileageListeners() {
  document.addEventListener('DOMContentLoaded', function () {
    var searchEl = document.getElementById('mileage-search');
    if (searchEl) searchEl.addEventListener('input', _renderMileageTable);

    var saveBtn = document.getElementById('mileage-save-all');
    if (saveBtn) saveBtn.addEventListener('click', _saveAllMileage);

    var backBtn = document.getElementById('station-mileage-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (typeof goBack === 'function') goBack(); else if (typeof showView === 'function') showView('home');
      });
    }
  });
})();

/* ═══════════════════════════════════════════════════════
   REPORTS VIEW  (extracted from app.js)
   Depends on: pad2, safeJson, esc, LAA (app.js globals)
   ═══════════════════════════════════════════════════════ */

function loadReports() {
  if (!window.api) return;
  (window.api.attendanceListFull || window.api.attendanceList)().then(function(rows) {
    var now = new Date();
    var thisMonth = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
    var thisYear = String(now.getFullYear());
    var monthCount = 0, yearCount = 0, escapeCount = 0;
    var firmMap = {}, stationMap = {};

    var typeMap = { custody: 0, voluntary: 0, telephone: 0 };
    rows.forEach(function(r) {
      var d = safeJson(r.data);
      var dt = d.date || '';
      if (dt.indexOf(thisMonth) === 0) monthCount++;
      if (dt.indexOf(thisYear) === 0) yearCount++;
      if (d.isEscapeFee === 'Yes' || (d.totalNet && parseFloat(d.totalNet) > LAA.escapeThreshold)) escapeCount++;
      if (d._formType === 'telephone') typeMap.telephone++;
      else if (d.attendanceMode === 'voluntary') typeMap.voluntary++;
      else typeMap.custody++;
      var fn = d.firmName || 'Unknown';
      firmMap[fn] = (firmMap[fn] || 0) + 1;
      var sn = d.policeStationName || 'Unknown';
      stationMap[sn] = (stationMap[sn] || 0) + 1;
    });

    var monthEl = document.getElementById('report-month-total');
    var yearEl = document.getElementById('report-year-total');
    var escEl = document.getElementById('report-escape-count');
    if (monthEl) monthEl.textContent = monthCount + ' attendances';
    if (yearEl) yearEl.textContent = yearCount + ' attendances';
    if (escEl) escEl.textContent = escapeCount;

    var typeDiv = document.getElementById('report-by-type');
    if (typeDiv) {
      typeDiv.innerHTML = '<div class="report-row"><span class="report-row-label">Custody</span><span class="report-row-val">' + typeMap.custody + '</span></div>' +
        '<div class="report-row"><span class="report-row-label">Voluntary</span><span class="report-row-val">' + typeMap.voluntary + '</span></div>' +
        '<div class="report-row"><span class="report-row-label">Telephone</span><span class="report-row-val">' + typeMap.telephone + '</span></div>';
    }

    var firmDiv = document.getElementById('report-by-firm');
    if (firmDiv) {
      firmDiv.innerHTML = '';
      var firmEntries = Object.keys(firmMap).map(function(k) { return [k, firmMap[k]]; });
      firmEntries.sort(function(a, b) { return b[1] - a[1]; });
      firmEntries.forEach(function(entry) {
        firmDiv.innerHTML += '<div class="report-row"><span class="report-row-label">' + esc(entry[0]) + '</span><span class="report-row-val">' + entry[1] + '</span></div>';
      });
      if (!firmEntries.length) firmDiv.innerHTML = '<div class="report-row" style="color:var(--text-muted)">No data yet</div>';
    }

    var statDiv = document.getElementById('report-by-station');
    if (statDiv) {
      statDiv.innerHTML = '';
      var statEntries = Object.keys(stationMap).map(function(k) { return [k, stationMap[k]]; });
      statEntries.sort(function(a, b) { return b[1] - a[1]; });
      statEntries.forEach(function(entry) {
        statDiv.innerHTML += '<div class="report-row"><span class="report-row-label">' + esc(entry[0]) + '</span><span class="report-row-val">' + entry[1] + '</span></div>';
      });
      if (!statEntries.length) statDiv.innerHTML = '<div class="report-row" style="color:var(--text-muted)">No data yet</div>';
    }
  });
}

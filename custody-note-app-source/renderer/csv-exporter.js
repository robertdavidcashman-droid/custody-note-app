/* ═══════════════════════════════════════════════════════
   CSV EXPORT FOR BILLING  (extracted from app.js)
   Depends on: formData, LAA, safeJson, showToast, calculateProfitCostsFromData (app.js globals)
   ═══════════════════════════════════════════════════════ */

function csvSafe(val) {
  if (val == null) return '';
  var s = String(val);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function _csvFmtDate(val) {
  if (!val) return '';
  var m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : val;
}

function exportCsv() {
  (window.api.attendanceListFull || window.api.attendanceList)().then(function(rows) {
    if (!rows.length) { showToast('No attendances to export', 'warning'); return; }
    var headers = ['UFN','Date','Client Surname','Client Initial','Station','Police Station ID',
      'Scheme ID','Custody No','DSCC No','Duty Solicitor','Matter Type','Outcome Decision',
      'Total Mins','Travel Social','Travel Unsocial','Waiting Social',
      'Waiting Unsocial','Advice Social','Advice Unsocial','Miles','Disbursements','No Attendances',
      'Net Profit','Net Travel','Net Waiting','Escape Fee','Firm','LAA Account','Status'];
    var csvRows = [headers.join(',')];
    rows.forEach(function(r) {
      var d = safeJson(r.data);
      var calc = calculateProfitCostsFromData(d);
      var row = [
        csvSafe(d.ufn), csvSafe(_csvFmtDate(d.date)),
        csvSafe(d.surname), csvSafe((d.forename || '').charAt(0)),
        csvSafe(d.policeStationName), csvSafe(d.policeStationCode || ''),
        csvSafe(d.schemeId), csvSafe(d.custodyNumber),
        csvSafe(d.dsccRef), csvSafe(d.dutySolicitor),
        csvSafe(d.matterTypeCode), csvSafe(d.outcomeDecision),
        d.totalMinutes || 0, d.travelSocial || 0, d.travelUnsocial || 0,
        d.waitingSocial || 0, d.waitingUnsocial || 0,
        d.adviceSocial || 0, d.adviceUnsocial || 0,
        d.milesClaimable || 0,
        (d.disbursements || []).reduce(function(sum, dis) { return sum + (parseFloat(dis.amount) || 0); }, 0).toFixed(2),
        d.numAttendances || 1,
        calc.totalWithMiles.toFixed(2), calc.travelCost ? calc.travelCost.toFixed(2) : '0', calc.waitingCost ? calc.waitingCost.toFixed(2) : '0',
        calc.isEscape ? 'Yes' : 'No',
        csvSafe(d.firmName), csvSafe(d.firmLaaAccount),
        r.status || 'draft',
      ];
      csvRows.push(row.join(','));
    });
    var csv = csvRows.join('\n');
    var fn = 'attendances-export-' + new Date().toISOString().slice(0, 10) + '.csv';
    window.api.saveCsv({ csv: csv, filename: fn })
      .then(function(p) { showToast('CSV saved: ' + p, 'success'); })
      .catch(function(e) { showToast('Failed: ' + (e && e.message), 'error'); });
  });
}

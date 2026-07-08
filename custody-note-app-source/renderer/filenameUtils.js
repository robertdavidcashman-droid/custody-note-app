/* ═══════════════════════════════════════════════════════
   FILENAME & NAMING UTILITIES
   Deterministic formatting for invoices, attachments,
   police station short names, firm names, and dates.
   ═══════════════════════════════════════════════════════ */

var DOCUMENT_TYPE_OPTIONS = [
  { value: 'police_station_attendance_note', label: 'Police Station Attendance Note' },
  { value: 'declaration', label: 'Declaration' },
  { value: 'custody_record', label: 'Custody Record' },
  { value: 'disclosure', label: 'Disclosure' },
  { value: 'interview_notes', label: 'Interview Notes' },
  { value: 'legal_aid_form', label: 'Legal Aid Form' },
  { value: 'invoice_support', label: 'Invoice Support' },
  { value: 'other', label: 'Other' },
];

function _stripForbiddenChars(str) {
  return String(str || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
}

function _collapseSpaces(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function _safeUnderscore(str) {
  return _stripForbiddenChars(_collapseSpaces(str)).replace(/\s/g, '_');
}

function formatStationShort(policeStation) {
  if (!policeStation) return '';
  var s = _collapseSpaces(policeStation);
  s = s.replace(/\bpolice\s+station\b/i, 'ps').replace(/\bPS\b/, 'ps');
  return s.trim();
}

function formatInvoiceTitle(clientName, policeStation) {
  var client = _collapseSpaces(clientName);
  var station = formatStationShort(policeStation);
  if (!client && !station) return '';
  return [client, station].filter(Boolean).join(' - ');
}

function formatDateForFilename(dateStr) {
  if (!dateStr) return '';
  var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return m[3] + '.' + m[2] + '.' + m[1].slice(2);
}

function formatFirmForFilename(firmName) {
  return _safeUnderscore(firmName);
}

function formatDocumentType(documentType, customType) {
  if (!documentType) return 'document';
  if (documentType === 'other' && customType) {
    return _safeUnderscore(customType).toLowerCase().replace(/_+/g, '_');
  }
  return String(documentType).replace(/\s+/g, '_').toLowerCase();
}

function formatAttachmentFilename(opts) {
  var client = _safeUnderscore(opts.clientName || '');
  var station = _safeUnderscore(opts.policeStation || '').replace(/_police_station$/i, '_police_station').replace(/_PS$/i, '_police_station');
  if (station && !/police_station$/i.test(station)) {
    station = station + '_police_station';
  }
  station = station.toLowerCase().replace(/^(.)/, function (c) { return c.toUpperCase(); });
  station = station.replace(/_p/g, function (m, offset) {
    var before = station.slice(0, offset);
    if (before.length === 0 || before.endsWith('_')) return m;
    return m;
  });
  var rawStation = _safeUnderscore(opts.policeStation || '');
  if (/police.station/i.test(opts.policeStation || '')) {
    station = rawStation;
  } else if (rawStation) {
    station = rawStation + '_police_station';
  }
  var dateFmt = formatDateForFilename(opts.attendanceDate);
  var docType = formatDocumentType(opts.documentType, opts.customDocumentType);
  var firm = formatFirmForFilename(opts.firmName);
  var ext = opts.extension || '.pdf';
  if (ext.charAt(0) !== '.') ext = '.' + ext;

  var parts = [client, station, dateFmt, docType, firm].filter(Boolean);
  var name = parts.join('_-_');
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 240);
  return name + ext;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return parseInt(m[3], 10) + '.' + parseInt(m[2], 10) + '.' + m[1].slice(2);
}

function buildAttachmentTitle(opts) {
  var client = _collapseSpaces(opts.clientName || '');
  var station = _collapseSpaces(opts.policeStation || opts.stationName || '');
  var dateFmt = formatDateShort(opts.attendanceDate || opts.date || '');
  var firm = _collapseSpaces(opts.firmName || '');
  return [client, station, dateFmt, 'police station attendance note', firm]
    .filter(Boolean).join(' - ');
}

function buildLine1Description(record) {
  var client = _collapseSpaces(record.clientName || '');
  var station = _collapseSpaces(record.policeStation || record.stationName || '');
  var dateFmt = formatDateForFilename(record.attendanceDate || record.date || '');
  return ['Police Station Attendance Fixed Fee', client, station, dateFmt]
    .filter(Boolean).join(' - ');
}

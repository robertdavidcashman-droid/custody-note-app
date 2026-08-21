/**
 * Anywhere ↔ Desktop bridge payload (v1).
 * Does not merge codebases — exchange is via explicit JSON export/import.
 */
const BRIDGE_APP = 'custodynote-anywhere';
const BRIDGE_FORMAT = 'cn-anywhere-bridge';
const BRIDGE_VERSION = 1;

function isBridgePayload(obj) {
  return !!(
    obj &&
    typeof obj === 'object' &&
    obj.format === BRIDGE_FORMAT &&
    Number(obj.version) === BRIDGE_VERSION &&
    Array.isArray(obj.attendances)
  );
}

function buildBridgeFromAnywhereBackup(backupObj) {
  const src = backupObj && typeof backupObj === 'object' ? backupObj : {};
  const attendances = Array.isArray(src.attendances) ? src.attendances : Array.isArray(src) ? src : [];
  return {
    format: BRIDGE_FORMAT,
    version: BRIDGE_VERSION,
    sourceApp: BRIDGE_APP,
    exportedAt: new Date().toISOString(),
    attendances: attendances.map((rec) => ({
      anywhereId: String((rec && rec.id) || ''),
      attendanceMode: (rec && rec.attendanceMode) || 'custody',
      status: (rec && rec.status) || 'draft',
      updatedAt: (rec && rec.updatedAt) || null,
      data: (rec && rec.data && typeof rec.data === 'object') ? rec.data : {},
    })),
  };
}

/**
 * Map one Anywhere attendance into desktop attendanceSave shape.
 */
function mapBridgeAttendanceToDesktop(item) {
  const data = Object.assign({}, (item && item.data) || {});
  if (!data._formType) {
    if (item.attendanceMode === 'voluntary') data._formType = 'attendance';
    else if (item.attendanceMode === 'telephone') data._formType = 'telephone';
    else data._formType = 'attendance';
  }
  if (!data.attendanceMode && item.attendanceMode) data.attendanceMode = item.attendanceMode;
  if (item.anywhereId) data._importedFromAnywhereId = item.anywhereId;
  data._importedFromAnywhereAt = new Date().toISOString();
  const status = item.status === 'completed' || item.status === 'finalised' ? 'draft' : (item.status || 'draft');
  return { data, status: status === 'finalised' ? 'draft' : status };
}

module.exports = {
  BRIDGE_APP,
  BRIDGE_FORMAT,
  BRIDGE_VERSION,
  isBridgePayload,
  buildBridgeFromAnywhereBackup,
  mapBridgeAttendanceToDesktop,
};

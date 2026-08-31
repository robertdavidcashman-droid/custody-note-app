'use strict';

/**
 * Privacy-safe daily usage heartbeat helpers.
 * Payload is limited to hashed machineId, platform, appVersion, and licence tier.
 * Never includes case content, client names, UFNs, notes, emails, or licence keys.
 */

const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_STATE_FILE = 'cn-usage-heartbeat.json';
const ALLOWED_PAYLOAD_KEYS = Object.freeze(['machineId', 'platform', 'appVersion', 'tier']);
const MACHINE_ID_HEX_RE = /^[a-f0-9]{32}$/;

/**
 * @param {string|number|null|undefined} lastHeartbeatAt ISO string or epoch ms
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function shouldSendHeartbeat(lastHeartbeatAt, nowMs) {
  const now = nowMs != null ? Number(nowMs) : Date.now();
  if (!Number.isFinite(now)) return true;
  if (lastHeartbeatAt == null || lastHeartbeatAt === '') return true;
  const last =
    typeof lastHeartbeatAt === 'number'
      ? lastHeartbeatAt
      : Date.parse(String(lastHeartbeatAt));
  if (!Number.isFinite(last)) return true;
  return now - last >= HEARTBEAT_INTERVAL_MS;
}

/**
 * @param {{ machineId: string, platform: string, appVersion: string, tier: string }} fields
 * @returns {{ machineId: string, platform: string, appVersion: string, tier: string }}
 */
function buildHeartbeatPayload(fields) {
  const src = fields && typeof fields === 'object' ? fields : {};
  return {
    machineId: String(src.machineId || ''),
    platform: String(src.platform || ''),
    appVersion: String(src.appVersion || ''),
    tier: String(src.tier || 'none'),
  };
}

/**
 * @param {object} payload
 * @returns {boolean}
 */
function payloadIsPrivacySafe(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).sort();
  const allowed = [...ALLOWED_PAYLOAD_KEYS].sort();
  if (keys.length !== allowed.length) return false;
  for (let i = 0; i < allowed.length; i++) {
    if (keys[i] !== allowed[i]) return false;
  }
  if (!MACHINE_ID_HEX_RE.test(String(payload.machineId || ''))) return false;
  const blob = JSON.stringify(payload).toLowerCase();
  // Refuse obvious PII / case fields if they ever leak into values.
  if (
    /@/.test(blob) ||
    /\bufn\b/.test(blob) ||
    /\bcustody\s*number\b/.test(blob) ||
    /\bclient\b/.test(blob) ||
    /\blicen[cs]e[-_]?key\b/.test(blob)
  ) {
    return false;
  }
  return true;
}

/**
 * @param {string} filePath
 * @param {{ readFileSync: Function }} fsModule
 * @returns {string|null}
 */
function readLastHeartbeatAt(filePath, fsModule) {
  try {
    const raw = fsModule.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || data.lastHeartbeatAt == null || data.lastHeartbeatAt === '') return null;
    return data.lastHeartbeatAt;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} filePath
 * @param {{ writeFileSync: Function }} fsModule
 * @param {string|number} at
 */
function writeLastHeartbeatAt(filePath, fsModule, at) {
  const stamp = typeof at === 'number' ? new Date(at).toISOString() : String(at);
  fsModule.writeFileSync(
    filePath,
    JSON.stringify({ lastHeartbeatAt: stamp }, null, 0),
    'utf8'
  );
}

module.exports = {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STATE_FILE,
  ALLOWED_PAYLOAD_KEYS,
  MACHINE_ID_HEX_RE,
  shouldSendHeartbeat,
  buildHeartbeatPayload,
  payloadIsPrivacySafe,
  readLastHeartbeatAt,
  writeLastHeartbeatAt,
};

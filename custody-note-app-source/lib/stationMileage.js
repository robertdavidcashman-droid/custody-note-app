'use strict';

/**
 * Police-station / travel mileage helpers.
 *
 * ANY value in police_stations.mileage_from_base is a user (or seeded) standard
 * and must survive apply → save → reload → export exactly (46 stays 46, not
 * 45.8 / 46.6). Live/calculated road distances must never silently replace a
 * known standard unless allowLiveOverride is explicitly true.
 *
 * There is no Google Maps / OS routing / km↔miles converter in this app; these
 * helpers are the single guard against drift from float formatting, catalogue
 * replace, or a future live-distance feature.
 */

/** Seeded LAA codes with known practice standards (Kent / Medway). */
const STANDARD_MILEAGES_BY_CODE = Object.freeze({
  BG039: 46, // Tonbridge
  BG028: 46, // Gillingham, Kent (Medway custody)
  BG027: 46, // Rochester (Medway scheme)
  BG030: 46, // Chatham (Medway scheme)
});

/**
 * Representative sample of station standards for systemic tests.
 * Tonbridge/Medway 46 is one row; other rows are plausible stored standards
 * that must also stay exact (integers and intentional decimals).
 */
const REPRESENTATIVE_STANDARD_MILEAGES = Object.freeze([
  { code: 'BG039', name: 'Tonbridge', miles: 46 },
  { code: 'BG028', name: 'Gillingham, Kent', miles: 46 },
  { code: 'BG027', name: 'Rochester', miles: 46 },
  { code: 'BG030', name: 'Chatham', miles: 46 },
  { code: 'BG001', name: 'Maidstone', miles: 12 },
  { code: 'BG002', name: 'Sevenoaks', miles: 8 },
  { code: 'BG003', name: 'Gravesend', miles: 18 },
  { code: 'BG004', name: 'Ashford', miles: 28 },
  { code: 'BG006', name: 'Dartford', miles: 22 },
  { code: 'BG008', name: 'Folkestone', miles: 42 },
  { code: 'BG010', name: 'Dover', miles: 48 },
  { code: 'BG013', name: 'Margate', miles: 52 },
  { code: 'BG014', name: 'Canterbury', miles: 38 },
  { code: 'BG017', name: 'Sittingbourne', miles: 24 },
  { code: 'RD003', name: 'Brixton', miles: 15 },
  { code: 'MA001', name: 'Manchester sample', miles: 6 },
  { code: 'XXFRAC', name: 'Intentional half-mile', miles: 12.5 },
]);

/**
 * Parse/clean a mileage value for storage.
 * Near-integers (float noise only) snap to exact integers.
 * Intentional fractions (e.g. 12.5) are preserved — this does NOT round 45.8→46.
 *
 * @param {*} value
 * @returns {number|null}
 */
function normalizeMileageForStorage(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim().replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 1e-9) return rounded;
  const cleaned = Math.round(n * 10000) / 10000;
  const oneDec = Math.round(cleaned * 10) / 10;
  if (Math.abs(cleaned - oneDec) < 1e-9) return oneDec;
  return cleaned;
}

/**
 * Exact string form for form fields / DB mirrors — whole miles have no ".0".
 * @param {*} value
 * @returns {string}
 */
function formatExactMiles(value) {
  const n = normalizeMileageForStorage(value);
  if (n == null) return '';
  return String(n);
}

/**
 * Display helper: whole miles as "46", intentional decimals as stored.
 * Never force toFixed(1) on the stored claim value.
 * @param {*} value
 * @returns {string}
 */
function formatMilesForDisplay(value) {
  return formatExactMiles(value);
}

/**
 * Look up a seeded canonical standard for a station code (case-insensitive).
 * @param {string} code
 * @returns {number|null}
 */
function getStandardMileageForCode(code) {
  if (!code) return null;
  const key = String(code).trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(STANDARD_MILEAGES_BY_CODE, key)) {
    return STANDARD_MILEAGES_BY_CODE[key];
  }
  return null;
}

/**
 * Decide miles when filling a custody note / invoice from the station table.
 * Never lets a live/calculated figure replace a known standard unless
 * allowLiveOverride is explicitly true.
 *
 * @param {{
 *   standardMiles?: *,
 *   existingMiles?: *,
 *   liveMiles?: *,
 *   allowLiveOverride?: boolean,
 *   stationCode?: string
 * }} opts
 * @returns {number|null}
 */
function resolveMilesForAutofill(opts) {
  opts = opts || {};
  const existing = normalizeMileageForStorage(opts.existingMiles);
  if (existing != null && existing > 0) return existing;

  let standard = normalizeMileageForStorage(opts.standardMiles);
  if (standard == null && opts.stationCode) {
    standard = getStandardMileageForCode(opts.stationCode);
  }
  if (standard != null && standard > 0) return standard;

  if (opts.allowLiveOverride === true) {
    const live = normalizeMileageForStorage(opts.liveMiles);
    if (live != null && live > 0) return live;
  }
  return null;
}

/**
 * Decide what value to keep on the station mileage table when a proposed or
 * live figure arrives. ANY existing stored standard is protected from live
 * distance unless allowLiveOverride is set.
 *
 * @param {{
 *   stationCode?: string,
 *   currentMiles?: *,
 *   proposedMiles?: *,
 *   liveMiles?: *,
 *   allowLiveOverride?: boolean
 * }} opts
 * @returns {number|null}
 */
function resolveMilesForStationTable(opts) {
  opts = opts || {};
  const canonical = getStandardMileageForCode(opts.stationCode);
  const current = normalizeMileageForStorage(opts.currentMiles);
  const proposed = normalizeMileageForStorage(opts.proposedMiles);
  const live = normalizeMileageForStorage(opts.liveMiles);

  if (opts.allowLiveOverride === true && live != null && live > 0) {
    return live;
  }

  // Explicit Station Mileage admin edit
  if (proposed != null) {
    return proposed;
  }

  // Any existing stored standard wins over live/calculated
  if (current != null && current > 0) {
    return current;
  }

  if (canonical != null && canonical > 0) {
    return canonical;
  }

  // Do not silently adopt live road distance as the new table standard
  return null;
}

/**
 * True when a candidate looks like a drifted road distance vs an exact standard
 * (e.g. 45.8 / 46.6 vs 46) rather than an intentional different integer.
 */
function isLiveDriftFromStandard(standardMiles, candidateMiles) {
  const standard = normalizeMileageForStorage(standardMiles);
  const candidate = normalizeMileageForStorage(candidateMiles);
  if (standard == null || candidate == null) return false;
  if (standard === candidate) return false;
  if (Number.isInteger(candidate) && candidate !== standard) return false;
  const delta = Math.abs(candidate - standard);
  return delta > 0 && delta < 1.5;
}

/**
 * Simulate apply → form string → re-parse → export for a stored standard.
 * Used by tests and as the contract for UI/export paths.
 *
 * @param {*} standardMiles
 * @param {{ liveMiles?: *, allowLiveOverride?: boolean, stationCode?: string }} [opts]
 * @returns {{ stored: number|null, formStr: string, claimMiles: number|null, exportMiles: number|null }}
 */
function roundTripStandardMileage(standardMiles, opts) {
  opts = opts || {};
  const stored = normalizeMileageForStorage(standardMiles);
  const claimMiles = resolveMilesForAutofill({
    standardMiles: stored,
    existingMiles: '',
    liveMiles: opts.liveMiles,
    allowLiveOverride: opts.allowLiveOverride === true,
    stationCode: opts.stationCode,
  });
  const formStr = formatExactMiles(claimMiles);
  const exportMiles = normalizeMileageForStorage(formStr);
  return { stored, formStr, claimMiles, exportMiles };
}

/**
 * Merge a replacement LAA station catalogue while preserving per-station
 * mileage_from_base and postcode (matched by name+code).
 * Repairs live drift against seeded canonicals; never drops other standards.
 *
 * @param {Array<{name?:string,code?:string,mileage_from_base?:*,postcode?:string}>} existingRows
 * @param {Array<{name?:string,code?:string,scheme?:string,region?:string,schemeCode?:string,kind?:string}>} incoming
 * @returns {Array<object>}
 */
function mergeStationsPreservingMileage(existingRows, incoming) {
  const byKey = new Map();
  (existingRows || []).forEach(function (r) {
    byKey.set(String(r.name || '') + '\0' + String(r.code || ''), r);
  });
  return (incoming || []).map(function (s) {
    const key = String(s.name || '') + '\0' + String(s.code || '');
    const prev = byKey.get(key);
    let mileage = prev && prev.mileage_from_base != null
      ? normalizeMileageForStorage(prev.mileage_from_base)
      : null;
    const canonical = getStandardMileageForCode(s.code);
    if (mileage == null && canonical != null) {
      mileage = canonical;
    } else if (canonical != null && isLiveDriftFromStandard(canonical, mileage)) {
      mileage = canonical;
    } else if (mileage == null) {
      mileage = null;
    }
    return {
      name: s.name || '',
      code: s.code || '',
      scheme: s.scheme || '',
      region: s.region || '',
      schemeCode: s.schemeCode || s.scheme_code || '',
      kind: s.kind || 'station',
      mileage_from_base: mileage,
      postcode: prev && prev.postcode != null ? String(prev.postcode) : '',
    };
  });
}

/**
 * SQL updates to (re)apply seeded canonical standards. Safe to run repeatedly.
 * @returns {Array<{sql:string, params:Array}>}
 */
function canonicalStandardMileageStatements() {
  return Object.keys(STANDARD_MILEAGES_BY_CODE).map(function (code) {
    return {
      sql: 'UPDATE police_stations SET mileage_from_base = ? WHERE code = ?',
      params: [STANDARD_MILEAGES_BY_CODE[code], code],
    };
  });
}

const StationMileage = {
  STANDARD_MILEAGES_BY_CODE,
  REPRESENTATIVE_STANDARD_MILEAGES,
  normalizeMileageForStorage,
  formatExactMiles,
  formatMilesForDisplay,
  getStandardMileageForCode,
  resolveMilesForAutofill,
  resolveMilesForStationTable,
  isLiveDriftFromStandard,
  roundTripStandardMileage,
  mergeStationsPreservingMileage,
  canonicalStandardMileageStatements,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StationMileage;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StationMileage = StationMileage;
}

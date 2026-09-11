'use strict';

/**
 * Systemic station-mileage preservation.
 *
 * Scope: the WHOLE mileage surface — not only Tonbridge/Medway.
 * Every stored police_stations.mileage_from_base value is a standard and must
 * survive apply / save / reload / export without silent drift (46→45.8/46.6).
 *
 * Run: node --test tests/stationMileageStandard.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const {
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
} = require('../lib/stationMileage');
const { runMigrations, LATEST_VERSION } = require('../main/dbMigrations');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'station-mileage-admin.js'), 'utf8');
const billingJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');
const billingScreenJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing-screen.js'), 'utf8');
const stationVisitsJs = fs.readFileSync(path.join(root, 'renderer', 'lib', 'station-visits.js'), 'utf8');
const billingUtilsJs = fs.readFileSync(path.join(root, 'renderer', 'billingUtils.js'), 'utf8');
const quickfileClientJs = fs.readFileSync(path.join(root, 'lib', 'quickfileClient.js'), 'utf8');
const stationMileageJs = fs.readFileSync(path.join(root, 'lib', 'stationMileage.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function scalar(db, sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  let v = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    v = row[Object.keys(row)[0]];
  }
  stmt.free();
  return v;
}

function driftedLive(standard) {
  // Classic road-distance nudge patterns (Tonbridge 46 → 45.8 / 46.6)
  const n = Number(standard);
  if (!Number.isFinite(n)) return 0;
  return Number((n - 0.2).toFixed(1));
}

function driftedLiveAlt(standard) {
  const n = Number(standard);
  if (!Number.isFinite(n)) return 0;
  return Number((n + 0.6).toFixed(1));
}

describe('full mileage surface audit (no live distance / no km conversion)', () => {
  it('repo has no miles↔km or maps/routing distance calculator', () => {
    const bodies = [mainJs, appJs, adminJs, billingJs, billingScreenJs, stationVisitsJs, billingUtilsJs, quickfileClientJs, stationMileageJs];
    for (const src of bodies) {
      assert.doesNotMatch(src, /maps\.googleapis|Distance Matrix|openrouteservice|\bosrm\b|haversine|kmToMiles|milesToKm|1\.60934|0\.62137|1609\.34/);
    }
  });

  it('documents every write path for station / claim / invoice miles', () => {
    assert.match(mainJs, /station-mileage-save/);
    assert.match(mainJs, /station-mileage-bulk-save/);
    assert.match(mainJs, /stations-replace/);
    assert.match(mainJs, /invoice_mileage_miles/);
    assert.match(mainJs, /normalizeMileageForStorage/);
    assert.match(appJs, /autoFillMileageFromStation/);
    assert.match(adminJs, /normalizeMileageForStorage/);
    assert.match(stationVisitsJs, /formatExactMiles/);
  });

  it('miles inputs use step=any (not step=0.1) so integers are not forced onto a decimal grid', () => {
    assert.match(adminJs, /step="any"/);
    assert.match(billingJs, /id="billing-mileage-miles"[\s\S]*?step="any"/);
    assert.match(billingScreenJs, /id="wf-miles"[\s\S]*?step="any"/);
    assert.match(appJs, /data-sv-field="milesClaimable"[\s\S]*?step="any"|step="any"[\s\S]*?data-sv-field="milesClaimable"/);
    assert.doesNotMatch(adminJs, /data-field="mileage"[^>]*step="0\.1"/);
  });

  it('visit breakdown display does not force toFixed(1) on miles cells', () => {
    const idx = appJs.indexOf('function updateVisitBreakdownTable');
    assert.ok(idx > 0);
    const slice = appJs.slice(idx, idx + 3500);
    assert.match(slice, /formatMilesForDisplay|formatExactMiles/);
    assert.doesNotMatch(slice, /visitMi\.toFixed\(1\)/);
    assert.doesNotMatch(slice, /totMiles\.toFixed\(1\)/);
  });
});

describe('canonical Tonbridge / Medway seeds (examples of the systemic rule)', () => {
  it('Tonbridge (BG039) standard is exactly 46', () => {
    assert.strictEqual(getStandardMileageForCode('BG039'), 46);
    assert.strictEqual(STANDARD_MILEAGES_BY_CODE.BG039, 46);
  });

  it('Medway custody stations are exactly 46', () => {
    assert.strictEqual(getStandardMileageForCode('BG028'), 46);
    assert.strictEqual(getStandardMileageForCode('BG027'), 46);
    assert.strictEqual(getStandardMileageForCode('BG030'), 46);
  });
});

describe('representative standard mileage table — exact round-trip for every entry', () => {
  it('sample covers Tonbridge/Medway plus a broad set of other stations', () => {
    assert.ok(REPRESENTATIVE_STANDARD_MILEAGES.length >= 12);
    const codes = REPRESENTATIVE_STANDARD_MILEAGES.map((r) => r.code);
    assert.ok(codes.includes('BG039'));
    assert.ok(codes.includes('BG028'));
    assert.ok(codes.includes('BG001'));
    assert.ok(codes.includes('XXFRAC'));
  });

  for (const row of REPRESENTATIVE_STANDARD_MILEAGES) {
    it(`${row.name} [${row.code}] = ${row.miles} survives apply/save/reload/export exactly`, () => {
      const liveA = driftedLive(row.miles);
      const liveB = driftedLiveAlt(row.miles);
      // Live must not equal the standard for this assertion to be meaningful
      if (Number.isInteger(row.miles)) {
        assert.notStrictEqual(liveA, row.miles);
        assert.notStrictEqual(liveB, row.miles);
      }

      const rt = roundTripStandardMileage(row.miles, {
        stationCode: row.code,
        liveMiles: liveA,
        allowLiveOverride: false,
      });
      assert.strictEqual(rt.stored, row.miles);
      assert.strictEqual(rt.claimMiles, row.miles);
      assert.strictEqual(rt.exportMiles, row.miles);
      assert.strictEqual(rt.formStr, formatExactMiles(row.miles));
      if (Number.isInteger(row.miles)) {
        assert.strictEqual(rt.formStr, String(row.miles));
        assert.ok(!rt.formStr.includes('.'), 'whole miles must not gain a decimal');
      }

      // Second live nudge pattern
      assert.strictEqual(
        resolveMilesForAutofill({
          standardMiles: row.miles,
          liveMiles: liveB,
          allowLiveOverride: false,
        }),
        row.miles
      );

      // Station table: live cannot overwrite any stored standard
      assert.strictEqual(
        resolveMilesForStationTable({
          stationCode: row.code,
          currentMiles: row.miles,
          liveMiles: liveA,
        }),
        row.miles
      );
    });
  }

  it('intentional fraction 12.5 is preserved (not snapped to 12 or 13)', () => {
    assert.strictEqual(normalizeMileageForStorage(12.5), 12.5);
    assert.strictEqual(formatExactMiles(12.5), '12.5');
    const rt = roundTripStandardMileage(12.5, { liveMiles: 12.3 });
    assert.strictEqual(rt.exportMiles, 12.5);
  });
});

describe('normalize / format — no km conversion, exact integers', () => {
  it('keeps 46 exact (not 45.8 / 46.6 / 46.0 string)', () => {
    assert.strictEqual(normalizeMileageForStorage(46), 46);
    assert.strictEqual(normalizeMileageForStorage('46'), 46);
    assert.strictEqual(normalizeMileageForStorage(46.0), 46);
    assert.strictEqual(formatExactMiles(46), '46');
    assert.strictEqual(formatMilesForDisplay(46), '46');
    assert.notStrictEqual(formatExactMiles(46), '46.0');
    assert.notStrictEqual(formatExactMiles(46), '45.8');
  });

  it('does not apply miles↔km conversion to standards', () => {
    const viaKm = Math.round(46 * 1.609344 * 10) / 10 / 1.609344;
    assert.notStrictEqual(normalizeMileageForStorage(46), normalizeMileageForStorage(viaKm));
    assert.strictEqual(normalizeMileageForStorage(46), 46);
    const googleish = 73709 * 0.000621371;
    assert.strictEqual(Number(googleish.toFixed(1)), 45.8);
    assert.notStrictEqual(normalizeMileageForStorage(46), 45.8);
  });
});

describe('live / calculated distance must never replace ANY known standard without opt-in', () => {
  it('detects 45.8 and 46.6 as live drift from standard 46', () => {
    assert.strictEqual(isLiveDriftFromStandard(46, 45.8), true);
    assert.strictEqual(isLiveDriftFromStandard(46, 46.6), true);
    assert.strictEqual(isLiveDriftFromStandard(46, 46), false);
    assert.strictEqual(isLiveDriftFromStandard(46, 40), false);
  });

  it('autofill: live without allowLiveOverride is ignored when a standard exists', () => {
    for (const row of REPRESENTATIVE_STANDARD_MILEAGES) {
      if (!Number.isInteger(row.miles)) continue;
      assert.strictEqual(
        resolveMilesForAutofill({
          standardMiles: row.miles,
          liveMiles: driftedLive(row.miles),
          allowLiveOverride: false,
        }),
        row.miles,
        row.code
      );
    }
  });

  it('autofill: live only when explicitly allowed AND no standard/existing', () => {
    assert.strictEqual(
      resolveMilesForAutofill({ liveMiles: 45.8, allowLiveOverride: true }),
      45.8
    );
    assert.strictEqual(resolveMilesForAutofill({ liveMiles: 45.8 }), null);
    assert.strictEqual(
      resolveMilesForAutofill({
        stationCode: 'BG039',
        liveMiles: 45.8,
        allowLiveOverride: true,
      }),
      46
    );
  });

  it('station table: live cannot overwrite Maidstone-style non-canonical standards either', () => {
    assert.strictEqual(
      resolveMilesForStationTable({
        stationCode: 'BG001',
        currentMiles: 12,
        liveMiles: 11.8,
      }),
      12
    );
    assert.strictEqual(
      resolveMilesForStationTable({
        stationCode: 'BG014',
        currentMiles: 38,
        liveMiles: 37.4,
      }),
      38
    );
  });

  it('station table: without allowLiveOverride, live alone does not become the new standard', () => {
    assert.strictEqual(
      resolveMilesForStationTable({
        stationCode: 'BG999',
        currentMiles: null,
        liveMiles: 45.8,
      }),
      null
    );
  });

  it('station table: explicit admin proposed value is accepted', () => {
    assert.strictEqual(
      resolveMilesForStationTable({
        stationCode: 'BG039',
        currentMiles: 46,
        proposedMiles: 47,
      }),
      47
    );
  });

  it('station table: allowLiveOverride is the only path for live replace', () => {
    assert.strictEqual(
      resolveMilesForStationTable({
        stationCode: 'BG039',
        currentMiles: 46,
        liveMiles: 45.8,
        allowLiveOverride: true,
      }),
      45.8
    );
  });
});

describe('mergeStationsPreservingMileage preserves the whole table', () => {
  it('preserves every representative standard across catalogue replace', () => {
    const existing = REPRESENTATIVE_STANDARD_MILEAGES.filter((r) => r.code !== 'XXFRAC').map((r) => ({
      name: r.name,
      code: r.code,
      mileage_from_base: r.miles,
      postcode: 'TN15 6ER',
    }));
    const incoming = existing.map((r) => ({
      name: r.name,
      code: r.code,
      scheme: 'Test',
      region: 'Test',
      kind: 'station',
    }));
    const merged = mergeStationsPreservingMileage(existing, incoming);
    assert.strictEqual(merged.length, existing.length);
    for (let i = 0; i < merged.length; i++) {
      assert.strictEqual(merged[i].mileage_from_base, existing[i].mileage_from_base, existing[i].code);
      assert.strictEqual(merged[i].postcode, 'TN15 6ER');
    }
  });

  it('repairs live drift on seeded Tonbridge/Medway codes', () => {
    const existing = [
      { name: 'Tonbridge', code: 'BG039', mileage_from_base: 45.8, postcode: '' },
      { name: 'Gillingham, Kent', code: 'BG028', mileage_from_base: 46.6, postcode: '' },
      { name: 'Maidstone', code: 'BG001', mileage_from_base: 12, postcode: '' },
    ];
    const incoming = existing.map((r) => ({ name: r.name, code: r.code, kind: 'station' }));
    const merged = mergeStationsPreservingMileage(existing, incoming);
    assert.strictEqual(merged[0].mileage_from_base, 46);
    assert.strictEqual(merged[1].mileage_from_base, 46);
    assert.strictEqual(merged[2].mileage_from_base, 12);
  });
});

describe('sql.js REAL round-trip for the full representative sample', () => {
  it('INSERT/SELECT keeps every sample mileage exact', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE police_stations (code TEXT, mileage_from_base REAL)');
    for (const row of REPRESENTATIVE_STANDARD_MILEAGES) {
      db.run('INSERT INTO police_stations VALUES (?, ?)', [
        row.code,
        normalizeMileageForStorage(row.miles),
      ]);
      const got = Number(scalar(db, 'SELECT mileage_from_base FROM police_stations WHERE code = ?', [row.code]));
      assert.strictEqual(got, row.miles, row.code);
      assert.strictEqual(formatExactMiles(got), formatExactMiles(row.miles), row.code);
    }
    db.close();
  });
});

describe('migrations seed Tonbridge + Medway standards exactly', () => {
  it('LATEST_VERSION applies canonical standards including Medway', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    runMigrations(db);
    db.run(
      "INSERT INTO police_stations (name, code, scheme, region, scheme_code, kind, mileage_from_base) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['Tonbridge', 'BG039', 'West Kent (Tonbridge)', 'Kent', '7007', 'station', null]
    );
    db.run(
      "INSERT INTO police_stations (name, code, scheme, region, scheme_code, kind, mileage_from_base) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['Gillingham, Kent', 'BG028', 'Medway', 'Kent', '7003', 'station', null]
    );
    db.run(
      "INSERT INTO police_stations (name, code, scheme, region, scheme_code, kind, mileage_from_base) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['Rochester', 'BG027', 'Medway', 'Kent', '7003', 'station', 45.8]
    );
    db.run(
      "INSERT INTO police_stations (name, code, scheme, region, scheme_code, kind, mileage_from_base) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['Chatham', 'BG030', 'Medway', 'Kent', '7003', 'station', 46.6]
    );
    db.run(
      "INSERT INTO police_stations (name, code, scheme, region, scheme_code, kind, mileage_from_base) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['Maidstone', 'BG001', 'Mid Kent', 'Kent', '7001', 'station', 12]
    );
    db.run('DELETE FROM schema_version');
    db.run(
      "INSERT INTO schema_version (version, name, applied_at) VALUES (2, 'tonbridge-mileage-46', ?)",
      [new Date().toISOString()]
    );
    const result = runMigrations(db);
    assert.ok(result.applied.length >= 1, 'expected newer migrations to apply, got ' + JSON.stringify(result));
    assert.ok(LATEST_VERSION >= 3, 'expected schema migration v3+ for Medway standards');
    assert.strictEqual(Number(scalar(db, "SELECT mileage_from_base FROM police_stations WHERE code = 'BG039'")), 46);
    assert.strictEqual(Number(scalar(db, "SELECT mileage_from_base FROM police_stations WHERE code = 'BG028'")), 46);
    assert.strictEqual(Number(scalar(db, "SELECT mileage_from_base FROM police_stations WHERE code = 'BG027'")), 46);
    assert.strictEqual(Number(scalar(db, "SELECT mileage_from_base FROM police_stations WHERE code = 'BG030'")), 46);
    assert.strictEqual(Number(scalar(db, "SELECT mileage_from_base FROM police_stations WHERE code = 'BG001'")), 12);
    db.close();
  });
});

describe('wiring — save / apply / replace / export use stationMileage helpers', () => {
  it('main.js stations-replace preserves mileage via mergeStationsPreservingMileage', () => {
    assert.match(mainJs, /mergeStationsPreservingMileage/);
    const replaceIdx = mainJs.indexOf("ipcMain.handle('stations-replace'");
    assert.ok(replaceIdx > 0);
    const slice = mainJs.slice(replaceIdx, replaceIdx + 2500);
    assert.match(slice, /mileage_from_base/);
    assert.match(slice, /mergeStationsPreservingMileage/);
  });

  it('main.js station mileage save + QuickFile invoice normalize via normalizeMileageForStorage', () => {
    assert.match(mainJs, /normalizeMileageForStorage/);
    const saveIdx = mainJs.indexOf("ipcMain.handle('station-mileage-save'");
    const bulkIdx = mainJs.indexOf("ipcMain.handle('station-mileage-bulk-save'");
    const invIdx = mainJs.indexOf("ipcMain.handle('quickfile-create-invoice'");
    assert.ok(saveIdx > 0 && bulkIdx > 0 && invIdx > 0);
    assert.match(mainJs.slice(saveIdx, saveIdx + 800), /normalizeMileageForStorage/);
    assert.match(mainJs.slice(bulkIdx, bulkIdx + 800), /normalizeMileageForStorage/);
    assert.match(mainJs.slice(invIdx, invIdx + 4000), /normalizeMileageForStorage|milesForInvoice/);
  });

  it('app.js autoFillMileageFromStation uses resolveMilesForAutofill + formatExactMiles', () => {
    const idx = appJs.indexOf('function autoFillMileageFromStation');
    assert.ok(idx > 0);
    const slice = appJs.slice(idx, idx + 2200);
    assert.match(slice, /resolveMilesForAutofill/);
    assert.match(slice, /formatExactMiles/);
    assert.match(slice, /allowLiveOverride:\s*false/);
    assert.doesNotMatch(slice, /\.toFixed\(1\)/);
  });

  it('station-mileage-admin save path normalizes mileage values', () => {
    assert.match(adminJs, /normalizeMileageForStorage/);
    assert.match(adminJs, /formatExactMiles/);
  });

  it('billing screens format miles with formatExactMiles and step=any', () => {
    assert.match(billingJs, /formatExactMiles/);
    assert.match(billingScreenJs, /formatExactMiles/);
    assert.match(billingJs, /allowLiveOverride:\s*false/);
    assert.match(billingScreenJs, /allowLiveOverride:\s*false/);
  });

  it('index.html loads lib/stationMileage.js before app.js', () => {
    const smIdx = indexHtml.indexOf('lib/stationMileage.js');
    const appIdx = indexHtml.indexOf('app.js');
    assert.ok(smIdx > 0 && appIdx > smIdx);
  });

  it('canonical statements cover Tonbridge and Medway codes', () => {
    const stmts = canonicalStandardMileageStatements();
    const codes = stmts.map((s) => s.params[1]).sort();
    assert.deepStrictEqual(codes, ['BG027', 'BG028', 'BG030', 'BG039']);
    stmts.forEach((s) => assert.strictEqual(s.params[0], 46));
  });

  it('QuickFile description may use toFixed(1) for display text only (no regression)', () => {
    assert.match(quickfileClientJs, /toFixed\(1\)/);
    assert.match(quickfileClientJs, /GBP\/mile/);
  });
});

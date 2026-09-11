/**
 * Static checks for legal/operational risk controls (no Electron required).
 */
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
// Schema DDL now lives in the versioned migration runner.
const dbMigrationsJs = fs.readFileSync(path.join(root, 'main', 'dbMigrations.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

describe('Confidentiality / data boundary', () => {
  it('preload exposes attendance CRUD only via contextBridge (no raw ipcRenderer)', () => {
    assert.ok(!preloadJs.includes('exposeInMainWorld') || preloadJs.includes('contextBridge.exposeInMainWorld'));
    assert.ok(!preloadJs.match(/exposeInMainWorld\([^,]+,\s*ipcRenderer\b/));
  });

  it('photo paths are scoped under attendance id in main', () => {
    assert.ok(mainJs.includes("path.join(app.getPath('userData'), 'photos', String(attendanceId)"));
  });
});

describe('Legal record integrity (main process)', () => {
  it('finalised records block non-finalise saves', () => {
    assert.ok(
      mainJs.includes("existing.status === 'finalised'") && mainJs.includes("'locked'"),
      'attendance-save must reject draft writes to finalised rows'
    );
  });

  it('sync pull refuses to downgrade finalised to draft', () => {
    assert.ok(
      mainJs.includes("localStatus === 'finalised'") && mainJs.includes('protect_finalised'),
      'sync must not overwrite local finalised with remote draft'
    );
  });

  it('draft case-key merge prevents duplicate drafts for same DSCC', () => {
    assert.ok(mainJs.includes('findExistingDraftIdByCaseKey'));
    assert.ok(mainJs.includes("One copy per case"));
  });

  it('duplicate check only compares finalised attendances (billing/legal risk)', () => {
    assert.ok(
      mainJs.includes("attendance-check-duplicate") ||
        mainJs.includes("ipcMain.handle('attendance-check-duplicate'")
    );
    assert.ok(
      mainJs.includes("status='finalised'") && mainJs.includes('attendance-check-duplicate'),
      'duplicate detection should target finalised records'
    );
  });

  it('audit_log table and attendance-save inserts exist', () => {
    assert.ok((mainJs + dbMigrationsJs).includes('CREATE TABLE IF NOT EXISTS audit_log'));
    assert.ok(mainJs.includes("INSERT INTO audit_log"));
  });

  it('billing invoice duplicate guard references invoice id', () => {
    assert.ok(mainJs.includes('allowDuplicate') && mainJs.includes('quickfile_invoice_id'));
  });
});

describe('Renderer — autosave and validation', () => {
  it('quietSave warns on failure (no silent data loss)', () => {
    const i = appJs.indexOf('function quietSave()');
    assert.ok(i !== -1);
    const block = appJs.slice(i, appJs.indexOf('\n  function ', i + 15));
    assert.ok(block.includes('showToast('), 'quietSave should surface save failures');
  });

  it('validateBeforeFinalise exists for gate before legal lock', () => {
    assert.ok(
      appJs.includes('validateBeforeFinalise') || appJs.includes('function validateBeforeFinalise'),
      'finalise path should validate'
    );
  });
});

function extractCheckboxGroupOptions(source, key) {
  const marker = "key: '" + key + "'";
  const start = source.indexOf(marker);
  assert.ok(start !== -1, key + ' field missing');
  const optsIdx = source.indexOf('options: [', start);
  assert.ok(optsIdx !== -1 && optsIdx - start < 400, key + ' options missing');
  const close = source.indexOf(']', optsIdx);
  const block = source.slice(optsIdx, close + 1);
  const opts = [];
  const re = /'((?:\\'|[^'])*)'/g;
  let m;
  while ((m = re.exec(block))) {
    opts.push(m[1].replace(/\\'/g, "'"));
  }
  return opts;
}

describe('PACE s.24 / s.37 grounds (statutory lists)', () => {
  const arrest = extractCheckboxGroupOptions(appJs, 'groundsForArrest');
  const detention = extractCheckboxGroupOptions(appJs, 'groundsForDetention');

  it('arrest grounds match PACE s.24(5) limbs (10 options)', () => {
    assert.deepStrictEqual(arrest, [
      "To ascertain the person's name",
      "To ascertain the person's address",
      'To prevent causing physical injury to himself or any other person',
      'To prevent suffering physical injury',
      'To prevent causing loss of or damage to property',
      'To prevent an offence against public decency',
      'To prevent causing an unlawful obstruction of the highway',
      'To protect a child or other vulnerable person',
      "To allow the prompt and effective investigation of the offence or of the person's conduct",
      'To prevent any prosecution being hindered by the disappearance of the person',
    ]);
  });

  it('arrest grounds omit standalone search-powers option', () => {
    assert.ok(!arrest.some((o) => /search powers under PACE/i.test(o)));
  });

  it('detention grounds are exactly the two PACE s.37(3) options', () => {
    assert.deepStrictEqual(detention, [
      'To secure or preserve evidence relating to an offence for which the person is under arrest',
      'To obtain such evidence by questioning the person',
    ]);
  });

  it('detention grounds omit insufficient-evidence / further-investigation item', () => {
    assert.ok(!detention.some((o) => /further investigation|Insufficient evidence/i.test(o)));
  });
});

describe('PACE grounds legacy label migration', () => {
  function extractFn(source, name) {
    const idx = source.indexOf('function ' + name);
    assert.ok(idx !== -1, name + ' missing');
    let depth = 0;
    let started = false;
    let end = idx;
    for (let i = idx; i < source.length; i++) {
      if (source[i] === '{') { depth++; started = true; }
      if (source[i] === '}') { depth--; }
      if (started && depth === 0) { end = i + 1; break; }
    }
    return source.slice(idx, end);
  }

  const migrate = new Function(
    extractFn(appJs, 'migrateLegacyPaceGrounds') + '; return migrateLegacyPaceGrounds;'
  )();

  it('maps old arrest limbs onto statutory labels (no silent wipe)', () => {
    const d = {
      groundsForArrest: [
        "To ascertain the person's name/address",
        'To prevent physical injury to self or others',
        'To prevent damage to property',
        'To prevent an offence against public decency',
        'To protect a child or vulnerable person',
        'To allow prompt and effective investigation',
        'To exercise search powers under PACE',
        'To prevent disappearance of the person',
      ].join('|'),
    };
    migrate(d);
    const parts = d.groundsForArrest.split('|');
    assert.ok(parts.includes("To ascertain the person's name"));
    assert.ok(parts.includes("To ascertain the person's address"));
    assert.ok(parts.includes('To prevent causing physical injury to himself or any other person'));
    assert.ok(parts.includes('To prevent causing loss of or damage to property'));
    assert.ok(parts.includes('To prevent an offence against public decency'));
    assert.ok(parts.includes('To protect a child or other vulnerable person'));
    assert.ok(parts.includes("To allow the prompt and effective investigation of the offence or of the person's conduct"));
    assert.ok(parts.includes('To prevent any prosecution being hindered by the disappearance of the person'));
    assert.ok(!parts.includes('To exercise search powers under PACE'));
  });

  it('maps old detention limbs and preserves removed item as Other', () => {
    const d = {
      groundsForDetention: [
        'To secure or preserve evidence',
        'To obtain evidence by questioning',
        'Insufficient evidence to charge \u2013 further investigation needed',
      ].join('|'),
    };
    migrate(d);
    const parts = d.groundsForDetention.split('|');
    assert.ok(parts.includes('To secure or preserve evidence relating to an offence for which the person is under arrest'));
    assert.ok(parts.includes('To obtain such evidence by questioning the person'));
    assert.ok(parts.some((p) => p.startsWith('Other:') && /Insufficient evidence/i.test(p)));
  });

  it('leaves already-migrated values unchanged', () => {
    const d = {
      groundsForArrest: "To ascertain the person's name|To protect a child or other vulnerable person",
    };
    const before = d.groundsForArrest;
    migrate(d);
    assert.strictEqual(d.groundsForArrest, before);
  });
});

describe('LAA police stations Annex A data', () => {
  const stations = JSON.parse(
    fs.readFileSync(path.join(root, 'data', 'police-stations-laa.json'), 'utf8')
  );
  const byCode = Object.fromEntries(stations.map((s) => [s.code, s]));

  it('includes MA100 Great Broughton on Whitehaven / Workington scheme 6007', () => {
    const s = byCode.MA100;
    assert.ok(s, 'MA100 must exist');
    assert.strictEqual(s.name, 'Great Broughton');
    assert.strictEqual(s.scheme, 'Whitehaven / Workington');
    assert.strictEqual(s.schemeCode, '6007');
    assert.strictEqual(s.kind, 'station');
  });

  it('LN066 is Tottenham Court Road (no continued-heading leftover)', () => {
    assert.strictEqual(byCode.LN066.name, 'Tottenham Court Road');
    assert.ok(!/contd/i.test(byCode.LN066.name));
  });

  it('Llanelli WA005–WA008 and WA902 use scheme Llanelli (no transitional footnote)', () => {
    for (const code of ['WA005', 'WA006', 'WA007', 'WA008', 'WA902']) {
      assert.strictEqual(byCode[code].scheme, 'Llanelli', code);
      assert.ok(!/These Police Station ID codes/i.test(byCode[code].scheme), code);
    }
  });

  it('BR904 scheme is Sedgemoor / Taunton Deane', () => {
    assert.strictEqual(byCode.BR904.scheme, 'Sedgemoor / Taunton Deane');
    assert.ok(!/Sedgemore|Taunton Dane/i.test(byCode.BR904.scheme));
  });
});

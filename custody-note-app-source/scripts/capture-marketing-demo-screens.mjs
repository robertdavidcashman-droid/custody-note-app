/**
 * Capture FILLED marketing screenshots with obvious SAMPLE / demo data.
 *
 * Seeds fictional attendances (e.g. "SAMPLE — Jane Doe") into an isolated
 * temp userData DB, then screenshots the real app UI via Playwright Electron.
 *
 * Output (PNG + WebP):
 *   website-product-shots/screenshots/records-list.{png,webp}
 *   website-product-shots/screenshots/app/records-list.{png,webp}
 *   website-product-shots/screenshots/billing-docs.{png,webp}  (when available)
 *   website-product-shots/screenshots/consult-tab.{png,webp}   (when available)
 *
 * Run:  xvfb-run -a node scripts/capture-marketing-demo-screens.mjs
 *
 * Never touches the developer's real Custody Note database.
 */
import { _electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.resolve(APP_ROOT, 'website-product-shots', 'screenshots');
const VIEWPORT = { width: 1440, height: 900 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLE_RECORDS = [
  {
    status: 'finalised',
    data: {
      forename: 'SAMPLE — Jane',
      surname: 'Doe (demonstration only)',
      policeStationName: 'Example Custody Suite (demo)',
      dsccRef: 'DEMO-1001',
      date: '2026-08-12',
      custodyNumber: 'DEMO-CN-441',
      ufn: 'DEMO/01/26',
      outcomeDecision: 'Bail without charge',
      bailDate: '2026-08-19',
      attendanceMode: 'custody',
      workType: 'Own client',
      offenceSummary: 'SAMPLE allegation — not a real case',
    },
  },
  {
    status: 'draft',
    data: {
      forename: 'SAMPLE — Alex',
      surname: 'Rivera (demonstration only)',
      policeStationName: 'Demo Central Police Station',
      dsccRef: 'DEMO-1002',
      date: '2026-08-15',
      custodyNumber: 'DEMO-CN-442',
      ufn: 'DEMO/02/26',
      attendanceMode: 'custody',
      workType: 'Duty',
      offenceSummary: 'SAMPLE allegation — demonstration only',
    },
  },
  {
    status: 'finalised',
    data: {
      forename: 'SAMPLE — Sam',
      surname: 'Patel (demonstration only)',
      policeStationName: 'Demo North Custody',
      dsccRef: 'private',
      dsccPrivateMatter: 'Yes',
      date: '2026-08-10',
      attendanceMode: 'voluntary',
      workType: 'Own client',
      outcomeDecision: 'NFA',
      offenceSummary: 'SAMPLE voluntary interview — demo data',
    },
  },
  {
    status: 'draft',
    data: {
      forename: 'SAMPLE — Morgan',
      surname: 'Lee (demonstration only)',
      policeStationName: 'Example Station (demo)',
      dsccRef: 'DEMO-TEL-3',
      date: '2026-08-17',
      _formType: 'telephone',
      workType: 'Telephone advice',
      offenceSummary: 'SAMPLE telephone advice — demonstration only',
    },
  },
  {
    status: 'finalised',
    data: {
      forename: 'SAMPLE — Casey',
      surname: 'Nguyen (demonstration only)',
      policeStationName: 'Demo West Custody Suite',
      dsccRef: 'DEMO-1005',
      date: '2026-08-08',
      custodyNumber: 'DEMO-CN-450',
      ufn: 'DEMO/05/26',
      attendanceMode: 'custody',
      workType: 'Duty',
      outcomeDecision: 'Charged',
      courtName: 'Demo Magistrates Court',
      offenceSummary: 'SAMPLE charge outcome — not a real case',
      photos: { attachments: [{ name: 'demo-disclosure.pdf' }] },
    },
  },
];

async function dismissFirstLaunchModal(page) {
  const skip = page.locator('#fl-skip');
  try {
    await skip.waitFor({ state: 'visible', timeout: 20000 });
  } catch {
    return;
  }
  await skip.click();
  try {
    await page.locator('#first-launch-modal').waitFor({ state: 'hidden', timeout: 10000 });
  } catch {
    /* already gone */
  }
}

async function shoot(page, relPath) {
  const file = path.join(OUT_ROOT, `${relPath}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, type: 'png', fullPage: false });
  console.log(`  saved ${relPath}.png`);
  return file;
}

function toWebp(pngPath) {
  const webpPath = pngPath.replace(/\.png$/i, '.webp');
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-i', pngPath, '-c:v', 'libwebp', '-quality', '82', webpPath],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) {
    console.warn(`  webp convert failed for ${pngPath}:`, r.stderr?.slice(-200));
    return null;
  }
  console.log(`  saved ${path.relative(OUT_ROOT, webpPath)}`);
  return webpPath;
}

async function seedSampleRecords(page) {
  const results = await page.evaluate(async (records) => {
    if (!window.api || typeof window.api.attendanceSave !== 'function') {
      return { ok: false, error: 'window.api.attendanceSave missing' };
    }
    const ids = [];
    for (const rec of records) {
      const id = await window.api.attendanceSave({
        data: rec.data,
        status: rec.status,
      });
      ids.push(id);
    }
    return { ok: true, ids };
  }, SAMPLE_RECORDS);
  if (!results.ok) throw new Error(results.error || 'seed failed');
  console.log(`[capture] seeded ${results.ids.length} SAMPLE attendances`);
}

async function fillOpenConsultationDemo(page) {
  /* Open a custody attendance and fill visible demo fields for a richer shot. */
  await page.evaluate(() => {
    const btn = document.getElementById('home-card-attendance');
    if (btn) btn.click();
  });
  await sleep(1500);

  await page.evaluate(() => {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('forename', 'SAMPLE — Jane');
    set('surname', 'Doe (demonstration only)');
    set('policeStationName', 'Example Custody Suite (demo)');
    set('dsccRef', 'DEMO-1001');
    set('custodyNumber', 'DEMO-CN-441');
    set('ufn', 'DEMO/01/26');
    set('date', '2026-08-12');
    /* Tick a few consultation checklist boxes if present */
    document
      .querySelectorAll('#section-consultation input[type="checkbox"]')
      .forEach((cb, i) => {
        if (i < 4 && cb instanceof HTMLInputElement && !cb.checked) {
          cb.click();
        }
      });
  });

  await page.evaluate(() => {
    if (typeof window.showSection === 'function') window.showSection(5);
  });
  await sleep(800);
}

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.mkdirSync(path.join(OUT_ROOT, 'app'), { recursive: true });

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-marketing-cap-'));
  console.log(`[capture] userData = ${userData}`);
  console.log(`[capture] output    = ${OUT_ROOT}`);

  const electronApp = await _electron.launch({
    args: [path.join(APP_ROOT, 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: userData,
      CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
    },
    timeout: 90000,
  });

  const page = await electronApp.firstWindow();
  await page.setViewportSize(VIEWPORT);
  await page.waitForLoadState('domcontentloaded');

  await Promise.race([
    page.locator('#splash').waitFor({ state: 'hidden', timeout: 45000 }),
    page.locator('.bottom-nav-btn').first().waitFor({ state: 'visible', timeout: 45000 }),
  ]).catch(() => {});

  await page.waitForFunction(() => typeof window.showView === 'function', { timeout: 45000 });
  await dismissFirstLaunchModal(page);
  await sleep(800);

  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      w.setSize(1440, 900);
      w.setResizable(false);
    }
  });
  await sleep(400);

  await page.addStyleTag({
    content: `
      .setup-warning-banner,
      .pin-tip-banner,
      .trial-status-banner,
      #trial-banner,
      .licence-banner,
      .freemium-banner,
      .freemium-add-on-banner { display: none !important; }
    `,
  });

  console.log('[capture] seeding SAMPLE demo records');
  await seedSampleRecords(page);
  await sleep(500);

  console.log('[capture] records list (filled)');
  await page.evaluate(() => {
    if (typeof window.showView === 'function') window.showView('list');
  });
  await sleep(1000);
  await page.evaluate(() => {
    if (typeof window.refreshList === 'function') window.refreshList();
  });
  await sleep(800);

  /* Overlay a subtle demo watermark so marketing use is obvious */
  await page.addStyleTag({
    content: `
      #attendance-list::before {
        content: "SAMPLE / DEMO DATA — not real client information";
        display: block;
        text-align: center;
        font-size: 11px;
        letter-spacing: 0.04em;
        color: #93c5fd;
        opacity: 0.85;
        padding: 6px 8px 10px;
      }
    `,
  });
  await sleep(200);

  const recordsPng = await shoot(page, 'records-list');
  toWebp(recordsPng);
  /* Mirror under app/ for InlineScreenshot catalog paths */
  const appRecordsPng = path.join(OUT_ROOT, 'app', 'records-list.png');
  fs.copyFileSync(recordsPng, appRecordsPng);
  toWebp(appRecordsPng);

  console.log('[capture] billing docs (with seeded records)');
  await page.evaluate(() => {
    if (typeof window.showView === 'function') window.showView('billing');
  });
  await sleep(1200);
  const billingPng = await shoot(page, 'billing-docs');
  toWebp(billingPng);

  console.log('[capture] consultation section with SAMPLE client');
  await page.evaluate(() => {
    if (typeof window.showView === 'function') window.showView('home');
  });
  await sleep(600);
  await fillOpenConsultationDemo(page);
  const consultPng = await shoot(page, 'consult-tab');
  toWebp(consultPng);

  await electronApp.close().catch(() => {});
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  console.log('[capture] complete');
}

main().catch((err) => {
  console.error('[capture] fatal:', err);
  process.exit(1);
});

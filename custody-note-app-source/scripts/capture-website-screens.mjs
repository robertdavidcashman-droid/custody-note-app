/**
 * Drives the Custody Note Electron app via Playwright to capture clean,
 * anonymised screenshots of every relevant screen for the marketing website.
 *
 * Output: c:/Users/rober/custody-note-website/public/screenshots/raw-v2/*.png
 *
 * Run:  node scripts/capture-website-screens.mjs
 *
 * Uses an isolated temp userData dir, so it never touches the developer's real
 * Custody Note database. The form sections are captured against a blank draft —
 * field labels/structure are visible, no client data is present.
 */
import { _electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(APP_ROOT, '..', 'custody-note-website', 'public', 'screenshots', 'raw-v2');

const VIEWPORT = { width: 1440, height: 900 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    /* may already be gone */
  }
}

async function dismissAnyOpenOverlay(page) {
  await page.evaluate(() => {
    document
      .querySelectorAll('.cn-confirm-overlay, .modal.open, .sections-index-modal.open')
      .forEach((el) => {
        const closer =
          el.querySelector('[data-close], .modal-close, .btn-secondary') ||
          el.querySelector('button');
        if (closer && closer instanceof HTMLElement) closer.click();
      });
  });
  await sleep(150);
}

async function shoot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, type: 'png', fullPage: false });
  console.log(`  saved ${name}.png`);
}

async function showView(page, view) {
  await page.evaluate((v) => {
    if (typeof window.showView === 'function') window.showView(v);
  }, view);
  await sleep(700);
}

async function showSection(page, idx) {
  await page.evaluate((i) => {
    if (typeof window.showSection === 'function') window.showSection(i);
  }, idx);
  await sleep(700);
}

async function captureCustodyForm(page, prefix) {
  await page.evaluate(() => {
    const btn = document.getElementById('home-card-attendance');
    if (btn) btn.click();
  });
  await sleep(1500);

  const sections = [
    'case-arrival',
    'journey',
    'custody-record',
    'offences',
    'disclosure',
    'consultation',
    'interview',
    'outcome',
    'time-fees',
  ];

  for (let i = 0; i < sections.length; i++) {
    await showSection(page, i);
    await sleep(400);
    await shoot(page, `${prefix}-${String(i + 1).padStart(2, '0')}-${sections[i]}`);
  }

  await page.evaluate(() => {
    const exitBtn = document.getElementById('form-save-exit');
    if (exitBtn) exitBtn.click();
  });
  await sleep(700);
  await page.evaluate(() => {
    const discardBtn =
      document.getElementById('save-exit-discard') ||
      document.querySelector('.cn-confirm-overlay .btn-secondary');
    if (discardBtn instanceof HTMLElement) discardBtn.click();
  });
  await sleep(800);
  await dismissAnyOpenOverlay(page);
  await showView(page, 'home');
}

async function captureVoluntaryForm(page) {
  await page.evaluate(() => {
    const btn = document.getElementById('home-card-voluntary');
    if (btn) btn.click();
  });
  await sleep(1500);

  /* Voluntary has 7 sections per docs/UI text */
  const labels = [
    'case-arrival',
    'journey',
    'client-details',
    'offences',
    'disclosure',
    'consultation',
    'interview-outcome',
  ];
  for (let i = 0; i < labels.length; i++) {
    await showSection(page, i);
    await sleep(400);
    await shoot(page, `voluntary-${String(i + 1).padStart(2, '0')}-${labels[i]}`);
  }

  await page.evaluate(() => {
    const exitBtn = document.getElementById('form-save-exit');
    if (exitBtn) exitBtn.click();
  });
  await sleep(700);
  await page.evaluate(() => {
    const discardBtn =
      document.getElementById('save-exit-discard') ||
      document.querySelector('.cn-confirm-overlay .btn-secondary');
    if (discardBtn instanceof HTMLElement) discardBtn.click();
  });
  await sleep(800);
  await dismissAnyOpenOverlay(page);
  await showView(page, 'home');
}

async function captureQuickCapture(page) {
  await page.evaluate(() => {
    const btn = document.getElementById('home-card-quick');
    if (btn) btn.click();
  });
  await sleep(1200);
  await shoot(page, 'quick-capture');
  await page.evaluate(() => {
    const back =
      document.getElementById('qc-back') ||
      document.querySelector('#view-quickcapture .btn-secondary');
    if (back instanceof HTMLElement) back.click();
  });
  await sleep(500);
  await dismissAnyOpenOverlay(page);
  await showView(page, 'home');
}

async function captureTelAdvice(page) {
  await page.evaluate(() => {
    const btn = document.getElementById('home-card-telephone');
    if (btn) btn.click();
  });
  await sleep(1500);
  /* Tel advice opens the form view in tel mode; capture each section briefly. */
  for (let i = 0; i < 6; i++) {
    await showSection(page, i);
    await sleep(400);
    await shoot(page, `tel-advice-${String(i + 1).padStart(2, '0')}`);
  }
  await page.evaluate(() => {
    const exitBtn = document.getElementById('form-save-exit');
    if (exitBtn) exitBtn.click();
  });
  await sleep(700);
  await page.evaluate(() => {
    const discardBtn =
      document.getElementById('save-exit-discard') ||
      document.querySelector('.cn-confirm-overlay .btn-secondary');
    if (discardBtn instanceof HTMLElement) discardBtn.click();
  });
  await sleep(800);
  await dismissAnyOpenOverlay(page);
  await showView(page, 'home');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-capture-'));
  console.log(`[capture] userData = ${userData}`);
  console.log(`[capture] output    = ${OUT_DIR}`);

  const electronApp = await _electron.launch({
    args: [path.join(APP_ROOT, 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: userData,
      CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
    },
    timeout: 60000,
  });

  const page = await electronApp.firstWindow();
  await page.setViewportSize(VIEWPORT);
  await page.waitForLoadState('domcontentloaded');

  /* Wait for splash to clear or app shell to appear */
  await Promise.race([
    page.locator('#splash').waitFor({ state: 'hidden', timeout: 30000 }),
    page.locator('.bottom-nav-btn').first().waitFor({ state: 'visible', timeout: 30000 }),
  ]).catch(() => {});

  await page.waitForFunction(() => typeof window.showView === 'function', { timeout: 30000 });
  await dismissFirstLaunchModal(page);
  await sleep(800);

  /* Make window deterministic in size */
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      w.setSize(1440, 900);
      w.setResizable(false);
    }
  });
  await sleep(500);

  /* Hide first-launch nag banners that pollute every screenshot. */
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
  await sleep(200);

  /* ─── Top-level views ─────────────────────────── */
  console.log('[capture] top-level views');
  await showView(page, 'home');
  await shoot(page, 'home');

  await captureQuickCapture(page);

  await showView(page, 'list');
  await shoot(page, 'records-list');

  await showView(page, 'firms');
  await shoot(page, 'firms');

  await showView(page, 'billing');
  await shoot(page, 'billing-dashboard');

  await showView(page, 'settings');
  await shoot(page, 'settings');

  /* ─── Custody attendance form, all 9 sections ─── */
  console.log('[capture] custody form sections');
  await showView(page, 'home');
  await captureCustodyForm(page, 'custody');

  /* ─── Voluntary attendance form, all 7 sections ── */
  console.log('[capture] voluntary form sections');
  await showView(page, 'home');
  await captureVoluntaryForm(page);

  /* ─── Telephone advice form ───────────────────── */
  console.log('[capture] telephone advice form');
  await showView(page, 'home');
  await captureTelAdvice(page);

  /* ─── Done ────────────────────────────────────── */
  await electronApp.close().catch(() => {});
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* file locks on Windows are fine; tmp will be cleaned eventually */
  }
  console.log('[capture] complete');
}

main().catch((err) => {
  console.error('[capture] fatal:', err);
  process.exit(1);
});

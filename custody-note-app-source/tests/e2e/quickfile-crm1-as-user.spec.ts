/**
 * End-to-end (requirement D): drives the QuickFile connection panel and the
 * CRM1 pre-submit validation summary as a real user, inside a real Electron
 * window against an isolated userData dir. No live QuickFile API is called —
 * the connection state is driven purely from the local settings DB.
 *
 * Path exercised:
 *   1. Open Settings -> QuickFile card. Fresh DB => panel shows account-sync
 *      messaging (credentials sync from Custody Note account).
 *   2. Save mock credentials via IPC + refresh => "Credentials loaded from
 *      your account" (configured, not yet verified).
 *   3. Persist a successful health-check result via IPC + refresh =>
 *      "Connected" with a "Last verified" time.
 *   4. Seed a sparse matter (no DOB/address), open it, trigger CRM1 generation,
 *      and assert the pre-submit validation summary lists the specific missing
 *      fields instead of silently producing a blank form.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

const consoleErrors: string[] = [];
const pageErrors: string[] = [];

const stamp = Date.now();
const SURNAME = `Crm1User${stamp}`;

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-qf-crm1-e2e-'));
  electronApp = await _electron.launch({
    args: [path.join(__dirname, '..', '..', 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: testUserData,
      CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
    },
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const splash = page.locator('#splash');
  await splash.waitFor({ state: 'hidden', timeout: 60_000 }).catch(async () => {
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30_000 });
  });
  await page.waitForFunction(
    () => typeof (window as unknown as { api?: unknown }).api !== 'undefined',
    { timeout: 30_000 },
  );
  await dismissFirstLaunchModalIfPresent(page);
});

test.afterAll(async () => {
  if (electronApp) {
    try {
      await Promise.race([electronApp.close(), new Promise<void>((r) => setTimeout(r, 12_000))]);
    } catch { /* ignore */ }
    try { const p = electronApp.process(); if (p && !p.killed) p.kill(); } catch { /* ignore */ }
  }
  try { fs.rmSync(testUserData, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function openQuickFilePanel() {
  await page.locator('.bottom-nav-btn[data-nav="settings"]').click();
  await expect(page.locator('#view-settings')).toHaveClass(/active/, { timeout: 10_000 });
  /* The panel renders from DB-backed state even when the QuickFile add-on card
     is locked (hidden) in a fresh/unlicensed test DB, so wait for it to be
     attached rather than visible. */
  await page.waitForSelector('#qf-connection-status', { state: 'attached', timeout: 10_000 });
  /* Re-derive the panel from the latest DB-backed state (the renderer exposes this). */
  await page.evaluate(() => {
    const w = window as unknown as { refreshQuickFileConnectionPanel?: () => void };
    if (typeof w.refreshQuickFileConnectionPanel === 'function') w.refreshQuickFileConnectionPanel();
  });
  await page.waitForTimeout(250);
}

test('QuickFile connection panel reflects DB-backed state (not set up -> saved -> connected)', async () => {
  /* 1. Fresh DB: not configured. */
  await openQuickFilePanel();
  await expect(page.locator('#qf-connection-status')).toHaveAttribute('data-state', 'not_configured', { timeout: 10_000 });
  await expect(page.locator('#qf-status-headline')).toContainText(/Not set up/i);
  await expect(page.locator('#qf-status-instructions')).toContainText(/another computer|Custody Note account/i);

  /* 2. Save mock credentials (no live API call) and refresh. */
  await page.evaluate(async () => {
    const w = window as unknown as { api: { setSettings: (s: Record<string, string>) => Promise<unknown> } };
    await w.api.setSettings({
      quickfileAccountNumber: '1234567',
      quickfileApiKey: 'MOCK-API-KEY',
      quickfileAppId: 'MOCK-APP-ID',
      quickfileLastConnectionOkAt: '',
      quickfileLastConnectionError: '',
      quickfileLastConnectionCheckedAt: '',
    });
  });
  await openQuickFilePanel();
  await expect(page.locator('#qf-connection-status')).toHaveAttribute('data-state', 'configured_untested');
  await expect(page.locator('#qf-status-headline')).toContainText(/loaded from your account/i);

  /* 3. Persist a successful health-check result and refresh => Connected. */
  await page.evaluate(async () => {
    const w = window as unknown as { api: { setSettings: (s: Record<string, string>) => Promise<unknown> } };
    await w.api.setSettings({ quickfileLastConnectionOkAt: new Date().toISOString(), quickfileLastConnectionError: '' });
  });
  await openQuickFilePanel();
  await expect(page.locator('#qf-connection-status')).toHaveAttribute('data-state', 'connected');
  await expect(page.locator('#qf-status-headline')).toContainText(/Connected/i);
  await expect(page.locator('#qf-status-detail')).toContainText(/Last verified/i);
});

test('CRM1 generation shows a pre-submit validation summary for incomplete client data', async () => {
  /* Seed a sparse, finalised matter missing DOB/address/postcode. */
  const attendanceId = await page.evaluate(async (surname) => {
    const w = window as unknown as { api: { attendanceSave: (p: unknown) => Promise<number> } };
    const data = {
      _formType: 'attendance',
      attendanceMode: 'custody',
      forename: 'Sam',
      surname,
      date: '2026-04-20',
      policeStationName: 'CRM1 Test Police Station',
      offenceSummary: 'Test offence for CRM1 validation',
    };
    const id = await w.api.attendanceSave({ id: null, data, status: 'draft' });
    return id;
  }, SURNAME);
  expect(attendanceId).toBeTruthy();

  /* Open the record from the Records list (real user path) so formData loads. */
  await page.locator('.bottom-nav-btn[data-nav="home"]').click();
  await page.waitForTimeout(250);
  await page.locator('.bottom-nav-btn[data-nav="list"]').click();
  await expect(page.locator('#view-list')).toHaveClass(/active/);
  const rowText = page
    .locator('#attendance-list li')
    .filter({ has: page.locator(`.amend-btn[data-id="${attendanceId}"]`) })
    .locator('.list-item-text');
  await expect(rowText).toBeVisible({ timeout: 15_000 });
  await rowText.click();
  await expect(page.locator('#view-form')).toHaveClass(/active/, { timeout: 15_000 });
  await page.waitForFunction(
    (id: number) => {
      const w = window as unknown as { currentAttendanceId?: number; formData?: { surname?: string } };
      return w.currentAttendanceId === id && !!w.formData && !!w.formData.surname;
    },
    attendanceId,
    { timeout: 10_000 },
  );

  await page.evaluate(() => {
    const w = window as unknown as { openLaaForm?: (t: string) => void };
    if (typeof w.openLaaForm !== 'function') throw new Error('openLaaForm not exposed');
    w.openLaaForm('crm1');
  });

  /* The pre-submit summary modal should appear with specific field problems. */
  const dialog = page.locator('.cn-confirm-box').filter({ hasText: 'check before submitting' });
  await expect(dialog, 'CRM1 pre-submit summary should appear').toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText(/Date of birth/i);
  await expect(dialog).toContainText(/Address/i);

  /* User chooses to go back and fix — no PDF generated, no silent failure. */
  await dialog.getByRole('button', { name: /go back and fix/i }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });

  const ignored = [
    'electron/js2c',
    'DevTools',
    'ERR_CONNECTION_REFUSED',
    'Autofill.',
    'Failed to load resource: the server responded with a status of 404',
  ];
  const critical = consoleErrors.filter((e) => !ignored.some((skip) => e.includes(skip)));
  expect(critical, `Console errors: ${critical.join(' || ')}`).toHaveLength(0);
});

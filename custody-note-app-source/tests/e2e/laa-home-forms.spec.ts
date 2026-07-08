/**
 * E2E: Home-screen LAA form cards (CRM1–3, Applicant Declaration).
 *
 * Regression for the bug where clicking home LAA cards appeared to do nothing
 * because the attendance picker used position:absolute inside the scrollable home
 * view (off-screen). These tests assert the fixed overlay is visible and the
 * picker flow reaches openLaaForm.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

async function launchApp(): Promise<void> {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-laa-home-e2e-'));
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
  const splash = page.locator('#splash');
  await splash.waitFor({ state: 'hidden', timeout: 60_000 }).catch(async () => {
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30_000 });
  });
  await page.waitForFunction(
    () => typeof (window as unknown as { api?: unknown }).api !== 'undefined',
    { timeout: 30_000 },
  );
  await dismissFirstLaunchModalIfPresent(page);
  await page.waitForFunction(
    () => typeof (window as unknown as { openLaaForm?: unknown }).openLaaForm === 'function',
    { timeout: 30_000 },
  );
}

async function goHome(): Promise<void> {
  await page.locator('.bottom-nav-btn[data-nav="home"]').click();
  await expect(page.locator('#view-home')).toHaveClass(/active/, { timeout: 10_000 });
}

async function clickHomeLaaCard(formType: string): Promise<void> {
  const card = page.locator(`[data-laa-form="${formType}"]`);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click();
}

test.describe('Home LAA forms', () => {
  test.beforeAll(async () => {
    await launchApp();
  });

  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    if (electronApp) {
      try {
        await Promise.race([
          electronApp.close(),
          new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
        ]);
      } catch {
        /* ignore */
      }
      try {
        const proc = electronApp.process();
        if (proc && !proc.killed) proc.kill();
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(testUserData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('all home LAA cards open the fixed picker overlay', async () => {
    await goHome();
    for (const formType of ['crm1', 'crm2', 'crm3', 'declaration'] as const) {
      await clickHomeLaaCard(formType);
      const overlay = page.locator('.attendance-picker-overlay');
      await expect(overlay, `${formType} must show picker`).toBeVisible({ timeout: 10_000 });
      await overlay.getByRole('button', { name: 'Cancel' }).click();
      await expect(overlay).toBeHidden({ timeout: 5_000 });
    }
  });

  test('clicking CRM1 on home shows fixed attendance picker in viewport', async () => {
    await goHome();
    await clickHomeLaaCard('crm1');

    const overlay = page.locator('.attendance-picker-overlay');
    await expect(overlay, 'picker overlay must appear').toBeVisible({ timeout: 10_000 });
    await expect(overlay).toContainText(/Select attendance for CRM1/i);

    const inViewport = await overlay.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight;
    });
    expect(inViewport, 'overlay must be in viewport (not off-screen at top of home)').toBe(true);

    await overlay.getByRole('button', { name: 'Cancel' }).click();
    await expect(overlay).toBeHidden({ timeout: 5_000 });
  });

  test('empty database shows blank form and create attendance actions', async () => {
    await goHome();
    await clickHomeLaaCard('declaration');

    const overlay = page.locator('.attendance-picker-overlay');
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    await expect(overlay).toContainText(/No attendances yet/i);
    await expect(overlay.getByRole('button', { name: 'Generate blank form' })).toBeVisible();
    await expect(overlay.getByRole('button', { name: 'Create new attendance' })).toBeVisible();

    await overlay.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Generate blank form opens CRM1 pre-submit validation (not silent no-op)', async () => {
    await goHome();
    await clickHomeLaaCard('crm1');

    const overlay = page.locator('.attendance-picker-overlay');
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    await overlay.getByRole('button', { name: 'Generate blank form' }).click();
    await expect(overlay).toBeHidden({ timeout: 5_000 });

    const dialog = page.locator('.cn-confirm-box').filter({ hasText: 'check before submitting' });
    await expect(dialog, 'CRM1 validation must appear after blank form').toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: /go back and fix/i }).click();
  });

  test('selecting attendance from picker reaches CRM1 validation', async () => {
    const stamp = Date.now();
    const surname = `LaaHome${stamp}`;
    const attendanceId = await page.evaluate(async (name: string) => {
      const w = window as unknown as {
        api: {
          attendanceSave: (p: { id: null; data: Record<string, string>; status: string }) => Promise<number>;
        };
      };
      return w.api.attendanceSave({
        id: null,
        data: {
          surname: name,
          forename: 'E2E',
          policeStationName: 'Test Station',
          date: '2026-06-22',
        },
        status: 'draft',
      });
    }, surname);
    expect(attendanceId).toBeTruthy();

    await goHome();
    await clickHomeLaaCard('crm1');

    const overlay = page.locator('.attendance-picker-overlay');
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    await overlay.locator('.attendance-picker-item').filter({ hasText: surname }).click();
    await expect(overlay).toBeHidden({ timeout: 5_000 });

    const dialog = page.locator('.cn-confirm-box').filter({ hasText: 'check before submitting' });
    await expect(dialog, 'CRM1 validation after picking attendance').toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: /go back and fix/i }).click();
  });

  test('laaEnsureTemplates reports bundled official PDFs as ok', async () => {
    const status = await page.evaluate(async () => {
      const w = window as unknown as {
        api: {
          laaEnsureTemplates: (o: { skipRemote?: boolean }) => Promise<{
            ok: boolean;
            forms?: Record<string, { ok?: boolean; version?: string }>;
          }>;
        };
      };
      return w.api.laaEnsureTemplates({ skipRemote: true });
    });

    expect(status.ok, 'template ensure must succeed with bundled PDFs').toBe(true);
    expect(status.forms?.crm1?.ok).toBe(true);
    expect(status.forms?.crm2?.ok).toBe(true);
    expect(status.forms?.crm3?.ok).toBe(true);
    expect(status.forms?.declaration?.ok).toBe(true);
    expect(status.forms?.crm1?.version).toMatch(/^v\d+/);
  });

  test('Settings shows active LAA template versions', async () => {
    await page.locator('.bottom-nav-btn[data-nav="settings"]').click();
    await expect(page.locator('#view-settings')).toHaveClass(/active/, { timeout: 10_000 });

    const versions = page.locator('#settings-laa-versions');
    await expect(versions).toBeAttached({ timeout: 10_000 });
    await expect(versions).toContainText(/CRM1/i, { timeout: 15_000 });
    await expect(versions).toContainText(/v16|bundled|updated download/i);
  });
});

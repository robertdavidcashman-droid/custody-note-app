/**
 * End-to-end proof: typed UI input is persisted to SQLite and discoverable via IPC search.
 * Uses isolated userData — does not touch the developer's normal Custody Note database.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-critical-e2e-'));
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
  await splash.waitFor({ state: 'hidden', timeout: 60000 }).catch(async () => {
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30000 });
  });
  await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined', {
    timeout: 30000,
  });
  await dismissFirstLaunchModalIfPresent(page);
});

test.afterAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  if (electronApp) {
    try {
      await Promise.race([
        electronApp.close(),
        new Promise<void>(resolve => setTimeout(resolve, 12_000)),
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
    /* ignore cleanup on Windows file locks */
  }
});

test('surname typed in form persists after save as draft and exit; search finds record', async () => {
  const marker = `E2EJourney${Date.now()}`;

  await page.locator('.bottom-nav-btn[data-nav="new-attendance"]').click();
  await page.waitForTimeout(800);
  await expect(page.locator('#view-form')).toHaveClass(/active/);

  const surnameInput = page.locator('#view-form [data-field="surname"]').first();
  await expect(surnameInput).toBeVisible({ timeout: 15000 });
  await surnameInput.fill(marker);

  /* #form-save-exit keeps inline display:none; programmatic click matches smoke test (main.js). */
  await page.evaluate(() => {
    document.getElementById('form-save-exit')?.click();
  });

  const draftBtn = page.locator('#save-exit-draft');
  await expect(draftBtn).toBeVisible({ timeout: 10000 });
  await draftBtn.click();

  await expect(page.locator('#view-home')).toHaveClass(/active/, { timeout: 20000 });

  const searchResult = await page.evaluate(async (q: string) => {
    const w = window as unknown as {
      api: {
        attendanceSearch: (p: {
          query: string;
          page?: number;
          pageSize?: number;
        }) => Promise<{ rows: { client_name?: string }[]; total: number }>;
      };
    };
    return w.api.attendanceSearch({ query: q, page: 1, pageSize: 50 });
  }, marker);

  expect(searchResult.total, 'attendanceSearch should find the saved draft').toBeGreaterThanOrEqual(1);
  const hit = (searchResult.rows || []).find(r => (r.client_name || '').includes(marker));
  expect(hit, `client_name should contain ${marker}`).toBeTruthy();
});

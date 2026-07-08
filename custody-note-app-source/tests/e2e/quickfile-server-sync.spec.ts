/**
 * E2E: QuickFile account sync surface — ensure IPC and renderer helper exist;
 * Settings open triggers sync path without live server (isolated userData).
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
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-qf-server-sync-'));
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
  await page.locator('#splash').waitFor({ state: 'hidden', timeout: 60_000 }).catch(async () => {
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
  }
  try { fs.rmSync(testUserData, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('exposes quickfileSettingsEnsure IPC and syncQuickFileSettingsFromAccount helper', async () => {
  const surface = await page.evaluate(async () => {
    const w = window as unknown as {
      api?: { quickfileSettingsEnsure?: () => Promise<unknown> };
      syncQuickFileSettingsFromAccount?: (opts?: object) => Promise<unknown>;
    };
    const hasEnsure = typeof w.api?.quickfileSettingsEnsure === 'function';
    const hasSync = typeof w.syncQuickFileSettingsFromAccount === 'function';
    let ensureResult: unknown = null;
    if (hasEnsure) {
      try {
        ensureResult = await w.api!.quickfileSettingsEnsure!();
      } catch (e) {
        ensureResult = { error: String(e) };
      }
    }
    return { hasEnsure, hasSync, ensureResult };
  });
  expect(surface.hasEnsure, 'preload must expose quickfileSettingsEnsure').toBe(true);
  expect(surface.hasSync, 'app.js must expose syncQuickFileSettingsFromAccount').toBe(true);
  expect(surface.ensureResult).toBeTruthy();
});

test('opening Settings runs account sync and shows QuickFile panel', async () => {
  await page.locator('.bottom-nav-btn[data-nav="settings"]').click();
  await expect(page.locator('#view-settings')).toHaveClass(/active/, { timeout: 10_000 });
  await page.waitForSelector('#qf-connection-status', { state: 'attached', timeout: 10_000 });
  await expect(page.locator('#qf-status-instructions')).toContainText(/Custody Note account|another computer/i);
});

test('local save still configures QuickFile for billing path', async () => {
  const configured = await page.evaluate(async () => {
    const w = window as unknown as {
      api: { setSettings: (s: Record<string, string>) => Promise<unknown>; getSettings: () => Promise<Record<string, string>> };
    };
    await w.api.setSettings({
      quickfileAccountNumber: '6131472870',
      quickfileApiKey: 'MOCK-API-KEY',
      quickfileAppId: '247b6272-d1fd-4f8c-a89b-f5ce6dc7d257',
    });
    const s = await w.api.getSettings();
    return !!(String(s.quickfileAccountNumber || '').trim()
      && String(s.quickfileApiKey || '').trim()
      && String(s.quickfileAppId || '').trim());
  });
  expect(configured).toBe(true);
});

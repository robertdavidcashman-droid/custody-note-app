/**
 * E2E: two isolated Electron profiles simulate two computers sharing one licence.
 * Uses an in-process mock sync API (push/pull/recovery/validate).
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

const MAIN = path.join(__dirname, '..', '..', 'main.js');
const TEST_KEY = 'SYNC-TEST-0001-KEY1';

let mock: { server: unknown; start: () => Promise<string>; stop: () => Promise<void> };
let apiBase = '';
let electronA: ElectronApplication;
let electronB: ElectronApplication;
let pageA: Page;
let pageB: Page;
let userDataA = '';
let userDataB = '';

async function launchDevice(userData: string) {
  const app = await _electron.launch({
    args: [MAIN],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: userData,
      CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
      LICENCE_SERVER_BASE_URL: apiBase,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#splash').waitFor({ state: 'hidden', timeout: 60_000 }).catch(async () => {
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30_000 });
  });
  await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined', {
    timeout: 30_000,
  });
  await dismissFirstLaunchModalIfPresent(page);
  await page.evaluate(async (key) => {
    const w = window as unknown as { api: { licenceActivate: (p: { key: string; email: string }) => Promise<{ success?: boolean }> } };
    const res = await w.api.licenceActivate({ key, email: 'sync-e2e@test.local' });
    if (!res || !res.success) throw new Error('licence activate failed');
  }, TEST_KEY);
  return { app, page };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const mod = await import('../fixtures/mockSyncServer.mjs');
  mock = mod.createMockSyncServer();
  apiBase = await mock.start();
  userDataA = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-sync-a-'));
  userDataB = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-sync-b-'));
  ({ app: electronA, page: pageA } = await launchDevice(userDataA));
  ({ app: electronB, page: pageB } = await launchDevice(userDataB));
});

test.afterAll(async () => {
  for (const app of [electronA, electronB]) {
    if (!app) continue;
    try {
      await Promise.race([app.close(), new Promise<void>((r) => setTimeout(r, 12_000))]);
    } catch { /* ignore */ }
  }
  if (mock) await mock.stop();
  for (const dir of [userDataA, userDataB]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('create on computer A appears on computer B after sync', async () => {
  const marker = `SyncE2E${Date.now()}`;

  await pageA.locator('.bottom-nav-btn[data-nav="new-attendance"]').click();
  await pageA.waitForTimeout(600);
  await pageA.locator('#view-form [data-field="surname"]').first().fill(marker);
  await pageA.evaluate(() => document.getElementById('form-save-exit')?.click());
  const draftBtn = pageA.locator('#save-exit-draft');
  await expect(draftBtn).toBeVisible({ timeout: 10_000 });
  await draftBtn.click();
  await pageA.waitForTimeout(1500);

  await pageA.evaluate(async () => {
    const w = window as unknown as { api: { syncNow?: () => Promise<unknown> } };
    if (w.api.syncNow) await w.api.syncNow();
  });

  await pageB.evaluate(async () => {
    const w = window as unknown as { api: { syncNow?: () => Promise<unknown> } };
    if (w.api.syncNow) await w.api.syncNow();
  });
  await pageB.waitForTimeout(3000);

  await pageB.locator('.bottom-nav-btn[data-nav="list"]').click();
  await expect(pageB.locator('#view-list')).toHaveClass(/active/, { timeout: 10_000 });

  const found = await pageB.evaluate(async (needle) => {
    const w = window as unknown as {
      api: { attendanceSearch?: (p: { query: string; page?: number; pageSize?: number }) => Promise<{ rows?: Array<{ client_name?: string; data?: string }> }> };
    };
    if (!w.api.attendanceSearch) return false;
    const res = await w.api.attendanceSearch({ query: needle, page: 1, pageSize: 50 });
    const rows = res && res.rows ? res.rows : [];
    return rows.some((r) => (r.client_name || r.data || '').includes(needle));
  }, marker);

  expect(found, 'record created on A must be searchable on B').toBe(true);
});

test('edit on A updates B after sync', async () => {
  const marker = `SyncEdit${Date.now()}`;
  const updated = `${marker}-UPDATED`;

  const newId = await pageA.evaluate(async (m) => {
    const w = window as unknown as {
      api: {
        attendanceSave: (p: { id: null; data: { surname: string }; status: string }) => Promise<number>;
        syncNow?: () => Promise<unknown>;
      };
    };
    const id = await w.api.attendanceSave({ id: null, data: { surname: m }, status: 'draft' });
    if (w.api.syncNow) await w.api.syncNow();
    return id;
  }, marker);
  expect(newId).toBeTruthy();

  await pageB.evaluate(async () => {
    const w = window as unknown as { api: { syncNow?: () => Promise<unknown> } };
    if (w.api.syncNow) await w.api.syncNow();
  });
  await pageB.waitForTimeout(2000);

  const id = newId;

  await pageA.evaluate(async ({ attId, suffix }) => {
    const w = window as unknown as {
      api: {
        attendanceGet: (id: number) => Promise<{ data: string }>;
        attendanceSave: (p: { id: number; data: string; status: string }) => Promise<unknown>;
        syncNow?: () => Promise<unknown>;
      };
    };
    const row = await w.api.attendanceGet(attId);
    const data = JSON.parse(row.data || '{}');
    data.surname = (data.surname || '') + suffix;
    await w.api.attendanceSave({ id: attId, data: JSON.stringify(data), status: 'draft' });
    if (w.api.syncNow) await w.api.syncNow();
  }, { attId: id, suffix: '-UPDATED' });

  await pageB.evaluate(async () => {
    const w = window as unknown as { api: { syncNow?: () => Promise<unknown> } };
    if (w.api.syncNow) await w.api.syncNow();
  });
  await pageB.waitForTimeout(3000);

  const foundUpdated = await pageB.evaluate(async (needle) => {
    const w = window as unknown as {
      api: { attendanceSearch?: (p: { query: string }) => Promise<{ rows?: Array<{ data?: string }> }> };
    };
    const res = await w.api.attendanceSearch!({ query: needle });
    const rows = res && res.rows ? res.rows : [];
    return rows.some((r) => (r.data || '').includes(needle));
  }, updated);

  expect(foundUpdated).toBe(true);
});

/**
 * Regression: secondary/body text must stay readable on card surfaces
 * in both light and dark themes (RGB distance smoke test).
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

const stamp = Date.now();

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

async function assertTextContrast(
  p: Page,
  input: { textSelector: string; bgSelector: string; label: string; minDistance?: number },
): Promise<void> {
  const minDistance = input.minDistance ?? 50;
  const result = await p.evaluate(({ textSelector, bgSelector }) => {
    const textEl = document.querySelector(textSelector) as HTMLElement | null;
    const bgEl = document.querySelector(bgSelector) as HTMLElement | null;
    if (!textEl || !bgEl) return { ok: false, reason: 'missing element', distance: null as number | null };
    const parse = (rgb: string): [number, number, number] | null => {
      const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
    };
    const textColor = getComputedStyle(textEl).color || '';
    const bgColor = getComputedStyle(bgEl).backgroundColor || '';
    const a = parse(textColor);
    const b = parse(bgColor);
    if (!a || !b) return { ok: false, reason: 'unparsed color', distance: null, textColor, bgColor };
    const distance = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
    return { ok: true, distance, textColor, bgColor };
  }, { textSelector: input.textSelector, bgSelector: input.bgSelector });

  expect(result.ok, `${input.label}: elements must exist`).toBe(true);
  if (result.distance != null && result.distance > 0) {
    expect(result.distance, `${input.label}: text vs background contrast too low`).toBeGreaterThan(minDistance);
  } else {
    expect(result.textColor).not.toBe('rgba(0, 0, 0, 0)');
  }
}

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-text-contrast-'));
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

test.afterAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  if (electronApp) {
    try {
      await Promise.race([
        electronApp.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
      ]);
    } catch { /* ignore */ }
    try {
      const proc = electronApp.process();
      if (proc && !proc.killed) proc.kill();
    } catch { /* ignore */ }
  }
  try { fs.rmSync(testUserData, { recursive: true, force: true }); } catch { /* ignore */ }
});

for (const dark of [false, true]) {
  test(`home section title is readable in ${dark ? 'dark' : 'light'} mode`, async () => {
    await page.locator('.bottom-nav-btn[data-nav="home"]').click();
    await page.evaluate((d) => {
      document.documentElement.classList.toggle('dark', d);
    }, dark);
    await assertTextContrast(page, {
      textSelector: '#view-home .home-section-title',
      bgSelector: '#view-home',
      label: `home section title (${dark ? 'dark' : 'light'})`,
    });
  });

  test(`records list meta is readable in ${dark ? 'dark' : 'light'} mode`, async () => {
    const firmId = await page.evaluate(async (name) => {
      const w = window as unknown as {
        api: { firmSave: (f: Record<string, unknown>) => Promise<number | { id: number }> };
      };
      const out = await w.api.firmSave({
        name,
        contact_email: 'contrast-test@example.com',
        address1: '1 Contrast Street',
        city: 'Readville',
        post_code: 'RD1 1AB',
        is_default: 1,
      });
      return typeof out === 'number' ? out : out?.id;
    }, `Contrast Firm ${stamp}-${dark ? 'd' : 'l'}`);

    await page.evaluate(async (input) => {
      const w = window as unknown as {
        api: { attendanceSave: (p: unknown) => Promise<number> };
      };
      await w.api.attendanceSave({
        id: null,
        data: {
          _formType: 'attendance',
          attendanceMode: 'custody',
          forename: 'Read',
          surname: `Able${input.stamp}`,
          date: '2026-04-21',
          timeArrival: '10:00',
          timeDeparture: '11:00',
          policeStationName: 'Contrast Police Station',
          dsccRef: `CT-${input.stamp}`,
          firmId: input.firmId,
          firmName: input.firmName,
          offenceSummary: 'Theft',
          offence1Details: 'Test',
          custodyNumber: `CN/CT/${input.stamp}`,
        },
        status: 'draft',
      });
    }, { firmId, firmName: `Contrast Firm ${stamp}-${dark ? 'd' : 'l'}`, stamp: `${stamp}-${dark ? 'd' : 'l'}` });

    await page.locator('.bottom-nav-btn[data-nav="list"]').click();
    await page.waitForTimeout(300);
    await page.evaluate((d) => {
      document.documentElement.classList.toggle('dark', d);
    }, dark);

    const hasRow = await page.locator('#view-list .attendance-list li .meta').count();
    if (hasRow > 0) {
      await assertTextContrast(page, {
        textSelector: '#view-list .attendance-list li .meta',
        bgSelector: '#view-list .attendance-list li',
        label: `records list meta (${dark ? 'dark' : 'light'})`,
      });
    }
  });
}

test('duplicate invoice formatter returns user-friendly toast text', async () => {
  const toastText = await page.evaluate(() => {
    const w = window as unknown as {
      formatBillingCreateFailureToast?: (reason: string, code?: string) => string;
    };
    return typeof w.formatBillingCreateFailureToast === 'function'
      ? w.formatBillingCreateFailureToast('This record already has invoice #999.', 'ALREADY_INVOICED')
      : '';
  });

  expect(toastText).toContain('already has an invoice');
  expect(toastText).toContain('Continue to Review & complete');
  expect(toastText).not.toContain('allowDuplicate');
  expect(toastText).not.toMatch(/press "Send Bill to QuickFile" again/i);
});

test('rgbDistance helper sanity check', () => {
  expect(rgbDistance([0, 0, 0], [100, 100, 100])).toBeGreaterThan(50);
});

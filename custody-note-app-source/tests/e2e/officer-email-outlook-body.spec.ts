/**
 * Electron + Playwright: drive Officer Emails standalone UI and assert the
 * Open-Outlook launch payload contains the CURRENT email-box text.
 *
 * Real Outlook GUI is not opened (CI has no Outlook). When
 * CUSTODYNOTE_TEST_USERDATA is set, main writes last-outlook-launch.json
 * with the exact URL / .eml payload that would be launched.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

const SPECIAL_BODY = [
  'Dear Officer,',
  '',
  'Re: Smith & Jones — CR/12345/26',
  '',
  "The client's position is that he didn't attend the address.",
  '',
  'Please confirm whether CCTV, BWV and/or telephone evidence has been obtained.',
  '',
  'Kind regards,',
  'Robert Cashman',
].join('\n');

type LaunchCapture = {
  method: string;
  to: string;
  subject: string;
  body: string;
  url: string;
  bodyUsedInUrl: string;
  emlContent: string;
  bodyPlacedInCompose: boolean;
};

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-officer-email-e2e-'));
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

function readCapture(): LaunchCapture {
  const p = path.join(testUserData, 'last-outlook-launch.json');
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw) as LaunchCapture;
}

async function waitForCaptureAfter(prevMtimeMs: number): Promise<LaunchCapture> {
  const p = path.join(testUserData, 'last-outlook-launch.json');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs > prevMtimeMs) {
        return readCapture();
      }
    } catch {
      /* not yet */
    }
    await page.waitForTimeout(100);
  }
  throw new Error('timed out waiting for last-outlook-launch.json');
}

function captureMtime(): number {
  const p = path.join(testUserData, 'last-outlook-launch.json');
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

async function openOfficerEmailsView(): Promise<void> {
  await page.locator('#home-card-officer-emails').click();
  await expect(page.locator('#view-officer-emails')).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator('#oes-body')).toBeVisible({ timeout: 15000 });
}

async function clickOpenOutlook(): Promise<LaunchCapture> {
  const before = captureMtime();
  /* Auto-confirm the Open Outlook dialog if present. */
  page.once('dialog', async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      /* ignore */
    }
  });
  await page.locator('#oes-open').click();
  /* showChoice path: click primary if custom modal appears */
  const choiceOpen = page.locator('button:has-text("Open Outlook Web")').last();
  try {
    if (await choiceOpen.isVisible({ timeout: 1500 })) {
      await choiceOpen.click();
    }
  } catch {
    /* may already have proceeded via showChoice promise mock absence */
  }
  return waitForCaptureAfter(before);
}

test('A/B/C/D/E/F officer-email Open Outlook uses live box text in launch payload', async () => {
  await openOfficerEmailsView();

  /* C) completely typed replacement */
  await page.locator('#oes-to').fill('officer@example.police.uk');
  await page.locator('#oes-subject').fill('Typed subject');
  const typed = 'Completely typed replacement body.\n\nSecond paragraph.';
  await page.locator('#oes-body').fill(typed);
  let cap = await clickOpenOutlook();
  expect(cap.body).toBe(typed);
  expect(cap.bodyPlacedInCompose).toBe(true);
  expect(cap.method).toBe('outlook-web');
  expect(new URL(cap.url).searchParams.get('body')?.replace(/\r\n/g, '\n')).toBe(typed);

  /* A/B) generate then amend */
  await page.locator('#oes-client').fill('Joe Bloggs');
  await page.locator('#oes-station').fill('Tonbridge');
  await page.locator('#oes-date').fill('15.05.26');
  await page.locator('#oes-offence').fill('Theft');
  await page.locator('#oes-gen').click();
  await page.waitForTimeout(800);
  const generated = await page.locator('#oes-body').inputValue();
  expect(generated.length).toBeGreaterThan(20);

  /* A) unedited generated */
  cap = await clickOpenOutlook();
  expect(cap.body).toBe(generated);
  expect(cap.body).toContain('Joe Bloggs');

  /* B) amended */
  const amended = generated + '\n\nAMENDED LIVE MARKER';
  await page.locator('#oes-body').fill(amended);
  cap = await clickOpenOutlook();
  expect(cap.body).toBe(amended);
  expect(cap.body).toContain('AMENDED LIVE MARKER');
  expect(new URL(cap.url).searchParams.get('body')?.replace(/\r\n/g, '\n')).toBe(amended);

  /* D + E special multiline */
  await page.locator('#oes-subject').fill('Re: Smith & Jones');
  await page.locator('#oes-body').fill(SPECIAL_BODY);
  cap = await clickOpenOutlook();
  expect(cap.body).toBe(SPECIAL_BODY);
  const decoded = new URL(cap.url).searchParams.get('body') || '';
  expect(decoded.replace(/\r\n/g, '\n')).toBe(SPECIAL_BODY);
  expect(decoded).toContain("didn't");
  expect(decoded).toContain('Smith & Jones');

  /* F) second click newest */
  await page.locator('#oes-body').fill('second click newest body');
  cap = await clickOpenOutlook();
  expect(cap.body).toBe('second click newest body');

  /* Long body → .eml path with full body */
  const longBody = 'LIVE_LONG_MARKER\n\n' + 'x'.repeat(5000);
  await page.locator('#oes-body').fill(longBody);
  cap = await clickOpenOutlook();
  expect(cap.body).toBe(longBody);
  expect(cap.method).toBe('outlook-desktop-eml');
  expect(cap.url).not.toContain('body=');
  expect(cap.emlContent).toContain('X-Unsent: 1');
  expect(cap.emlContent).toContain('LIVE_LONG_MARKER');
});

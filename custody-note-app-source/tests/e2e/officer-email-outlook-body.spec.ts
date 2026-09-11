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
  capturedAt?: string;
};

const CAPTURE_WAIT_MS = 60_000;
const CAPTURE_POLL_MS = 200;

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

function capturePath(): string {
  return path.join(testUserData, 'last-outlook-launch.json');
}

function readCapture(): LaunchCapture {
  const raw = fs.readFileSync(capturePath(), 'utf8');
  return JSON.parse(raw) as LaunchCapture;
}

function tryReadCapture(): LaunchCapture | null {
  try {
    return readCapture();
  } catch {
    return null;
  }
}

function captureFingerprint(): string {
  const cap = tryReadCapture();
  if (!cap) return '';
  /* Prefer capturedAt (stable across coarse FS mtime); fall back to body+url. */
  if (cap.capturedAt) return `at:${cap.capturedAt}`;
  return `body:${cap.body}\nurl:${cap.url}\nmethod:${cap.method}`;
}

/**
 * Poll last-outlook-launch.json until a NEW capture appears after prevFingerprint.
 * CI (Windows) can be slow to flush IPC + disk; 15s was too tight.
 */
async function waitForCaptureAfter(prevFingerprint: string): Promise<LaunchCapture> {
  const p = capturePath();
  const deadline = Date.now() + CAPTURE_WAIT_MS;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const st = fs.statSync(p);
      if (st.size > 2) {
        const cap = readCapture();
        const fp = cap.capturedAt
          ? `at:${cap.capturedAt}`
          : `body:${cap.body}\nurl:${cap.url}\nmethod:${cap.method}`;
        if (fp && fp !== prevFingerprint) {
          return cap;
        }
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await page.waitForTimeout(CAPTURE_POLL_MS);
  }
  const blanker = await page.locator('#cn-credentialfree-blanker').count().catch(() => -1);
  const overlay = await page.locator('.cn-confirm-overlay').count().catch(() => -1);
  const exists = fs.existsSync(p);
  throw new Error(
    `timed out waiting for last-outlook-launch.json` +
      ` (waited ${CAPTURE_WAIT_MS}ms, exists=${exists}, blanker=${blanker}, confirmOverlay=${overlay}` +
      (lastErr ? `, lastReadError=${lastErr}` : '') +
      `)`
  );
}

/** Dismiss credential-free session blanker if a CI OS lock event raised it. */
async function ensureBlankerNotBlocking(): Promise<void> {
  const blanker = page.locator('#cn-credentialfree-blanker');
  if (!(await blanker.isVisible({ timeout: 400 }).catch(() => false))) return;

  const dismiss = page.locator('#cn-credentialfree-dismiss');
  if (await dismiss.isVisible({ timeout: 500 }).catch(() => false)) {
    await dismiss.click();
    await blanker.waitFor({ state: 'hidden', timeout: 10000 });
    return;
  }

  const unlock = page.locator('#cn-credentialfree-unlock-session');
  if (await unlock.isVisible({ timeout: 500 }).catch(() => false)) {
    await unlock.click();
    const confirmYes = page.locator('#cn-credentialfree-confirm-yes');
    await confirmYes.waitFor({ state: 'visible', timeout: 5000 });
    await confirmYes.click();
    await blanker.waitFor({ state: 'hidden', timeout: 10000 });
    return;
  }

  /* Last resort: remove overlay so the Open Outlook click can fire. */
  await page.evaluate(() => {
    const el = document.getElementById('cn-credentialfree-blanker');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
}

async function openOfficerEmailsView(): Promise<void> {
  await ensureBlankerNotBlocking();
  await page.locator('#home-card-officer-emails').click();
  await expect(page.locator('#view-officer-emails')).toHaveClass(/active/, { timeout: 15000 });
  await expect(page.locator('#oes-body')).toBeVisible({ timeout: 15000 });
}

async function confirmOpenOutlookOverlayOrDialog(): Promise<void> {
  /*
   * showChoice path (production): wait for the confirm overlay primary and click it.
   * Prefer role+name so we do not hit Cancel (often listed first). Native dialog
   * fallback is accepted via page.once('dialog') in clickOpenOutlook.
   */
  const overlay = page.locator('.cn-confirm-overlay');
  try {
    await overlay.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    /* Native dialog may already have been accepted, or go() already ran. */
    return;
  }
  await ensureBlankerNotBlocking();
  const choiceOpen = overlay.getByRole('button', { name: 'Open Outlook Web' });
  await choiceOpen.waitFor({ state: 'visible', timeout: 10000 });
  await choiceOpen.click();
  await overlay.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
}

async function clickOpenOutlookOnce(): Promise<LaunchCapture> {
  await ensureBlankerNotBlocking();
  await expect(page.locator('#cn-credentialfree-blanker')).toHaveCount(0);

  const before = captureFingerprint();

  /* Auto-confirm native window.confirm fallback if showChoice is absent. */
  page.once('dialog', async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      /* ignore */
    }
  });

  const openBtn = page.locator('#oes-open');
  await expect(openBtn).toBeVisible({ timeout: 15000 });
  await expect(openBtn).toBeEnabled();
  await openBtn.click();
  await confirmOpenOutlookOverlayOrDialog();
  return waitForCaptureAfter(before);
}

/** One retry: Windows CI occasionally drops the first confirm before capture lands. */
async function clickOpenOutlook(): Promise<LaunchCapture> {
  try {
    return await clickOpenOutlookOnce();
  } catch (firstErr) {
    /* Dismiss a stuck Cancel/confirm overlay before retrying. */
    const overlay = page.locator('.cn-confirm-overlay');
    if (await overlay.count().catch(() => 0)) {
      const cancel = overlay.getByRole('button', { name: /^Cancel$/ });
      if (await cancel.count().catch(() => 0)) {
        await cancel.click().catch(() => undefined);
      } else {
        await page.keyboard.press('Escape').catch(() => undefined);
      }
      await overlay.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    }
    try {
      return await clickOpenOutlookOnce();
    } catch (secondErr) {
      const detail = firstErr instanceof Error ? firstErr.message : String(firstErr);
      throw new Error(
        `Open Outlook capture failed after retry. First: ${detail}. Second: ` +
          (secondErr instanceof Error ? secondErr.message : String(secondErr))
      );
    }
  }
}

test('A/B/C/D/E/F officer-email Open Outlook uses live box text in launch payload', async () => {
  test.setTimeout(240_000);
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

/**
 * Runtime reproduction for the LAA declaration bug.
 *
 * Symptom reported by the user: the PDF attendance note "just prints the
 * privacy bit and not everything else", and the in-app declaration does not
 * show. The existing tests in tests/laaDeclarationPdf.test.js only string-grep
 * app.js source, so they cannot catch a RUNTIME failure where
 * window.LaaDeclarationPdf is unavailable and every helper returns ''.
 *
 * This spec launches the real Electron renderer and asserts, against the live
 * window, that:
 *   1. window.LaaDeclarationPdf is loaded with the official wording.
 *   2. window.buildPdfHtml(record, settings) — the real PDF builder — contains
 *      the full CRM2 client declaration, the CRM14 applicant declaration, the
 *      fraud notice AND the privacy notice (not just the privacy line).
 *   3. window.buildLaaDeclarationFormHtmlForUi(...) — the in-app block — renders
 *      the official declaration text rather than the "could not be loaded"
 *      fallback.
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

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-laa-e2e-'));
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

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
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
  // Builders are attached once app.js has run.
  await page.waitForFunction(
    () => typeof (window as unknown as { buildPdfHtml?: unknown }).buildPdfHtml === 'function',
    { timeout: 30_000 },
  );
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
  try {
    fs.rmSync(testUserData, { recursive: true, force: true });
  } catch { /* ignore Windows file locks */ }
});

test('window.LaaDeclarationPdf is loaded with the official wording', async () => {
  const result = await page.evaluate(() => {
    const w = window as unknown as { LaaDeclarationPdf?: Record<string, unknown> };
    const L = w.LaaDeclarationPdf;
    if (!L) return { loaded: false };
    const id = (s: string) => s;
    return {
      loaded: true,
      advice: (L.buildLaaDeclarationFormHtml as (v: string, r: unknown, e: (s: string) => string) => string)(
        'adviceAssistance', {}, id,
      ),
      crm14: (L.buildCrm14ApplicantDeclarationNoteHtml as (e: (s: string) => string) => string)(id),
    };
  });

  expect(result.loaded, 'window.LaaDeclarationPdf must be defined in the renderer').toBe(true);
  expect(result.advice).toContain('Legal Aid Agency Privacy Notice');
  expect(result.advice).toContain('As far as I know all the information I have given is true');
  expect(result.crm14).toContain('right to representation for the purposes of criminal proceedings');
});

test('PDF builder renders the FULL declaration, not just the privacy line', async () => {
  const html = await page.evaluate(() => {
    const w = window as unknown as {
      buildPdfHtml: (d: Record<string, unknown>, s: Record<string, unknown>) => string;
    };
    const record = {
      forename: 'Jane',
      surname: 'Doe',
      date: '2026-06-18',
      policeStationName: 'Test Police Station',
      privacyNoticeAccepted: 'Yes',
      laaHasPartner: 'No',
      // Trigger section 14 (CRM14) rendering.
      crm14CaseType: 'Either way offence',
      crm14RepAuthorised: 'Yes',
    };
    return w.buildPdfHtml(record, {});
  });

  // Privacy notice (the part that DID print).
  expect(html).toContain('Executive Agency of the Ministry of Justice');
  // The acknowledgment row label (hardcoded fallback — prints even when broken).
  expect(html).toContain('Privacy Notice acknowledged?');

  // The bits that were MISSING in the bug report:
  // CRM2 client declaration (section 11) — retained as fallback when wording module missing.
  expect(html, 'Online applicant declaration must be in the PDF').toContain(
    'left anything out that:',
  );
  expect(html, 'Online applicant declaration must be in the PDF').toContain(
    'right to representation for the purposes of criminal proceedings',
  );
  // CRM14 fraud notice (section 14).
  expect(html, 'CRM14 fraud notice must be in the PDF').toContain(
    'Making a false declaration is an offence',
  );
  // CRM14 applicant declaration (section 14).
  expect(html, 'CRM14 applicant declaration must be in the PDF').toContain(
    'left anything out that:',
  );
  expect(html, 'CRM14 fair processing notice must be in the PDF').toContain(
    'Fair Processing Notice',
  );
  // CRM14 representative declaration.
  expect(html, 'CRM14 representative declaration must be in the PDF').toContain(
    'authorised to provide representation under a contract issued by the LAA',
  );
});

test('in-app LAA declaration block renders official text (no fallback)', async () => {
  const blocks = await page.evaluate(() => {
    const w = window as unknown as {
      buildLaaDeclarationFormHtmlForUi: (v: string, r?: unknown) => string;
    };
    return {
      advice: w.buildLaaDeclarationFormHtmlForUi('crm14Applicant'),
      crm14: w.buildLaaDeclarationFormHtmlForUi('crm14Applicant'),
    };
  });

  expect(blocks.advice).not.toContain('could not be loaded');
  expect(blocks.advice).toContain('Legal Aid Agency Privacy Notice');
  expect(blocks.advice).toContain('left anything out that:');
  expect(blocks.advice).toContain('Applicant\u2019s Declaration');

  expect(blocks.crm14).not.toContain('could not be loaded');
  expect(blocks.crm14).toContain('Making a false declaration is an offence');
  expect(blocks.crm14).toContain('left anything out that:');
  expect(blocks.crm14).toContain('Fair Processing Notice');
  expect(blocks.crm14).toContain('right to representation for the purposes of criminal proceedings');
});

test('no critical console/page errors during declaration rendering', async () => {
  const critical = [...consoleErrors, ...pageErrors].filter(
    (e) => /LaaDeclaration|declaration|buildPdfHtml/i.test(e),
  );
  expect(critical, `declaration-related runtime errors: ${critical.join(' | ')}`).toHaveLength(0);
});

// Defensive: if a broken/stale install fails to load lib/laaDeclarationPdf.js,
// the PDF must still render official CRM2 wording from bundled refData — never
// silently omit the legal declaration. This runs last so intentional console.error
// does not affect other checks.
test('PDF still renders CRM2 declaration from refData when the wording module is missing', async () => {
  const html = await page.evaluate(() => {
    const w = window as unknown as {
      LaaDeclarationPdf?: unknown;
      buildPdfHtml: (d: Record<string, unknown>, s: Record<string, unknown>) => string;
    };
    const saved = w.LaaDeclarationPdf;
    try {
      w.LaaDeclarationPdf = undefined;
      return w.buildPdfHtml({ forename: 'Jane', surname: 'Doe', date: '2026-06-18' }, {});
    } finally {
      w.LaaDeclarationPdf = saved;
    }
  });

  expect(html, 'must fall back to bundled refData CRM2 wording').toContain(
    'As far as I know all the information I have given is true and I have not withheld any relevant information',
  );
  expect(html).toContain('Legal Aid Agency Privacy Notice');
});

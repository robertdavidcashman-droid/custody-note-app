/**
 * Drives the full Finish-matter / Billing flow as a user would,
 * inside a real Electron window, against an isolated userData dir.
 *
 * Goal: prove that nothing in the billing UI is "missing or not rendering"
 * (the symptom the user reported on custodynote.com).
 *
 * Path exercised:
 *   1. Seed a firm via IPC.
 *   2. Seed a finalised custody attendance via IPC (with all fields needed
 *      for billing: client, station, date, firm).
 *   3. Open Records list, click the row, confirm the form loads.
 *   4. Click "Finish matter" (#billing-panel-btn) -> workflow overlay.
 *   5. Step 1 (Documents) -> Next.
 *   6. Step 2 (Billing review): assert every required card is present
 *      (Invoice Details, Charges, QuickFile Preview, Documents to Attach,
 *      Invoice Narrative). Edit charges, confirm the live preview recalcs.
 *      Because QuickFile is not configured in the isolated userData,
 *      assert the "QuickFile not configured" callout is shown and the
 *      "Next: Review & complete" button is enabled (i.e. billing is NOT
 *      blocked when QF is unconfigured — that is the documented behaviour).
 *   7. Step 3 (Review & complete): assert the completion panel renders
 *      with the billing summary table.
 *   8. Throughout: capture all console errors and page errors and fail
 *      if anything critical surfaced.
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
const FIRM_NAME = `BillingTest Firm ${stamp}`;
const SURNAME = `BillingUser${stamp}`;
const FORENAME = 'Pat';
const STATION_NAME = 'BillingTest Central Police Station';
const DSCC_REF = `BT-${stamp}`;

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-billing-e2e-'));
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

test('user can drive a finalised matter through Finish matter > billing > review', async () => {
  /* ---------- 1. Seed firm via IPC so billing has a valid instructing firm ---------- */
  const firmId = await page.evaluate(async (firmName) => {
    const w = window as unknown as {
      api: { firmSave: (f: Record<string, unknown>) => Promise<number | { id: number }> };
    };
    const out = await w.api.firmSave({
      name: firmName,
      contact_email: 'billing-test@example.com',
      address1: '1 Test Street',
      city: 'Testville',
      post_code: 'TE1 5ST',
      is_default: 1,
    });
    return typeof out === 'number' ? out : out?.id;
  }, FIRM_NAME);
  expect(firmId, 'firm should save and return an id').toBeTruthy();

  /* ---------- 2. Seed a finalised attendance with billing-relevant fields ---------- */
  const attendanceId = await page.evaluate(
    async (input) => {
      const w = window as unknown as {
        api: { attendanceSave: (p: unknown) => Promise<number> };
      };
      const data = {
        _formType: 'attendance',
        attendanceMode: 'custody',
        forename: input.forename,
        surname: input.surname,
        date: '2026-04-20',
        timeArrival: '10:00',
        timeDeparture: '12:30',
        policeStationName: input.station,
        dsccRef: input.dscc,
        custodyNumber: `CN/BT/${input.dscc}`,
        firmId: input.firmId,
        firmName: input.firmName,
        offenceSummary: 'Theft (s.1 Theft Act 1968) — billing flow test scenario',
        offence1Details: 'Alleged shoplifting from a supermarket',
        milesClaimable: 12,
        parkingCost: 4.5,
        /* Section 9 finalise-required fields */
        feeEarnerName: 'E2E Test Solicitor',
        outcomeStation: 'NFA',
        timeRecordingChecked: 'yes',
        finalisedNotes: 'All work complete. Ready for billing.',
      };
      const id = await w.api.attendanceSave({ id: null, data, status: 'draft' });
      await w.api.attendanceSave({ id, data, status: 'finalised' });
      return id;
    },
    { forename: FORENAME, surname: SURNAME, station: STATION_NAME, dscc: DSCC_REF, firmId, firmName: FIRM_NAME },
  );
  expect(attendanceId, 'attendance should save and finalise').toBeTruthy();

  /* ---------- 3. Open the record from the Records list (UI path) ---------- */
  /* Bounce home -> list to force a fresh refreshList() after our IPC seed. */
  await page.locator('.bottom-nav-btn[data-nav="home"]').click();
  await page.waitForTimeout(250);
  await page.locator('.bottom-nav-btn[data-nav="list"]').click();
  await expect(page.locator('#view-list')).toHaveClass(/active/);
  await expect(page.locator('#attendance-list')).toBeVisible();

  /* renderer/views/list.js puts data-id on the action buttons, not on the
     <li> itself. Wait for the row to appear, identified by its Edit button. */
  const editBtn = page.locator(`#attendance-list .amend-btn[data-id="${attendanceId}"]`);
  await expect(editBtn, 'finalised record should appear in the Records list').toBeVisible({
    timeout: 15_000,
  });

  /* Open the record by clicking the title — same as a real user. */
  const rowText = page
    .locator(`#attendance-list li`)
    .filter({ has: page.locator(`.amend-btn[data-id="${attendanceId}"]`) })
    .locator('.list-item-text');
  await rowText.click();

  await expect(page.locator('#view-form'), 'clicking row should load the form view').toHaveClass(
    /active/,
    { timeout: 15_000 },
  );

  /* Wait for openAttendance() to have populated currentAttendanceId / formData. */
  await page.waitForFunction(
    (id: number) => {
      const w = window as unknown as { currentAttendanceId?: number; formData?: { surname?: string } };
      return w.currentAttendanceId === id && !!w.formData && !!w.formData.surname;
    },
    attendanceId,
    { timeout: 10_000 },
  );

  /* ---------- 4. Open the Finish-matter workflow ----------
   * The visible "Finish matter" button (#billing-panel-btn) lives inside
   * .form-page-header, which CSS hides when body.form-active is set
   * (the app uses #header-form-actions in the global header instead, and
   * that header has no Finish-matter button). The user-equivalent paths
   * are (a) the bottom-bar finalise pill, or (b) the in-section button.
   * For deterministic billing testing we call the same exposed entry point
   * that the pill / section buttons use under the hood: window.openWorkflow(). */
  await page.evaluate(() => {
    const w = window as unknown as { openWorkflow?: (startStep: number) => void };
    if (typeof w.openWorkflow !== 'function') {
      throw new Error('window.openWorkflow is not exposed — workflow-stepper.js may not have loaded');
    }
    w.openWorkflow(0);
  });

  /* Workflow overlay opens at step 0 (Documents) by default. */
  const overlay = page.locator('#workflow-overlay');
  await expect(overlay, 'Finish-matter workflow should open').toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.wf-stepper'), 'stepper should render with 3 steps').toBeVisible();
  const stepLabels = await page.locator('.wf-stepper .wf-step-label').allTextContents();
  expect(stepLabels.join('|')).toContain('Billing review');
  expect(stepLabels.join('|')).toContain('Review & complete');

  /* ---------- 5. Step 1 (Documents) — advance to Billing ---------- */
  /* Use the stepper to jump straight to step 1 (Billing review). The
     "Next" buttons on the documents step intercept with form buttons
     behind the overlay; the stepper is always visible inside the overlay. */
  await page.locator('#workflow-overlay .wf-stepper .wf-step[data-wf-idx="1"]').click();

  /* ---------- 6. Step 2 (Billing review) — assert every required section ---------- */
  await expect(page.locator('.wf-billing'), 'billing screen container should render').toBeVisible({
    timeout: 10_000,
  });

  /* Required cards. */
  const cardTitles = await page.locator('.wf-billing .wf-card-title').allTextContents();
  const joined = cardTitles.join(' | ');
  expect(joined, `cards rendered: ${joined}`).toMatch(/Invoice Details/);
  expect(joined).toMatch(/Your invoice/);
  expect(joined).toMatch(/Invoice total \(QuickFile preview\)/);
  expect(joined).toMatch(/Invoice Narrative/);

  /* Charges form — every input present and editable. */
  await expect(page.locator('#wf-fee')).toBeVisible();
  await expect(page.locator('#wf-miles')).toBeVisible();
  await expect(page.locator('#wf-rate')).toBeVisible();
  await expect(page.locator('#wf-parking')).toBeVisible();
  await expect(page.locator('#wf-vat')).toBeVisible();

  /* Invoice details — populated, not blank. */
  const invoiceTitle = (await page.locator('#wf-invoice-title').textContent()) || '';
  expect(invoiceTitle.trim(), 'invoice title should be populated').not.toBe('');
  expect(invoiceTitle).toMatch(new RegExp(SURNAME));

  /* Live preview totals are present and numeric. */
  const subBefore = (await page.locator('#wf-prev-sub').textContent()) || '';
  expect(subBefore).toMatch(/\u00A3[\d,]+\.\d{2}/);

  /* Edit fee and confirm preview recalcs. */
  await page.locator('#wf-fee').fill('200');
  await page.locator('#wf-fee').dispatchEvent('input');
  await page.waitForTimeout(150);
  const subAfter = (await page.locator('#wf-prev-sub').textContent()) || '';
  expect(subAfter, 'subtotal should change after editing fee').not.toBe(subBefore);

  /* Narrative input editable. */
  const narrative = page.locator('#wf-narrative');
  await expect(narrative).toBeVisible();
  await narrative.fill('Billing test narrative — automated.');

  /* QuickFile-not-configured callout should be visible (fresh isolated DB
     has no QF settings) AND the "Next: complete without invoice" path
     should NOT exist (because the QF card itself is hidden), but
     "Next: Review & complete" SHOULD be present so billing is not blocked. */
  const qfMissing = await page.locator('.wf-qf-not-configured-card').isVisible().catch(() => false);
  const nextComplete = page.locator('#wf-bill-next-complete');
  expect(qfMissing, 'fresh DB should show QuickFile-not-configured callout').toBe(true);
  await expect(nextComplete, '"Next: Review & complete" must be enabled when QF is not configured').toBeVisible();

  /* Documents-to-Attach card renders even with no docs (empty state). */
  const docCard = page.locator('.wf-doc-selection');
  await expect(docCard, 'Documents-to-Attach card should render').toBeVisible();

  /* ---------- 7. Step 3 (Review & complete) ---------- */
  await nextComplete.click();
  await expect(
    page.locator('.wf-completion').first(),
    'completion screen should render',
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.locator('.wf-billing-summary-table'),
    'completion screen should include the billing summary table',
  ).toBeVisible();

  /* ---------- 8. No critical console / page errors during billing flow ---------- */
  const ignored = [
    'electron/js2c',
    'DevTools',
    'ERR_CONNECTION_REFUSED',
    'Autofill.enable',
    'Autofill.setAddresses',
  ];
  const critical = consoleErrors.filter((e) => !ignored.some((skip) => e.includes(skip)));
  const criticalPage = pageErrors.filter((e) => !e.includes('Script error'));
  expect(critical, `Console errors during billing flow: ${critical.join(' || ')}`).toHaveLength(0);
  expect(criticalPage, `Page crashes during billing flow: ${criticalPage.join(' || ')}`).toHaveLength(0);
});

test('Records list Bill button opens matter billing without opening the form', async () => {
  test.setTimeout(120_000);

  /* Previous test may leave billing workflow open — tear down overlay and navigate directly. */
  await page.evaluate(() => {
    const w = window as unknown as { showView?: (name: string) => void };
    const overlay = document.getElementById('workflow-overlay');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    const inline = document.querySelector('#matter-billing-stage #workflow-overlay');
    if (inline && inline.parentNode) inline.parentNode.removeChild(inline);
    if (typeof w.showView === 'function') w.showView('list');
  });
  await expect(page.locator('#view-list')).toHaveClass(/active/, { timeout: 15_000 });
  await dismissFirstLaunchModalIfPresent(page);

  const firmId = await page.evaluate(async (firmName) => {
    const w = window as unknown as {
      api: { firmSave: (f: Record<string, unknown>) => Promise<number | { id: number }> };
    };
    const out = await w.api.firmSave({
      name: firmName,
      contact_email: 'bill-list@example.com',
      is_default: 1,
    });
    return typeof out === 'number' ? out : out?.id;
  }, `BillList Firm ${stamp}`);
  expect(firmId).toBeTruthy();

  const attendanceId = await page.evaluate(
    async (input) => {
      const w = window as unknown as { api: { attendanceSave: (p: unknown) => Promise<number> } };
      const data = {
        _formType: 'attendance',
        attendanceMode: 'custody',
        forename: input.forename,
        surname: input.surname,
        date: '2026-05-10',
        policeStationName: input.station,
        firmId: input.firmId,
        firmName: input.firmName,
        feeEarnerName: 'E2E Bill List',
        outcomeStation: 'NFA',
        timeRecordingChecked: 'yes',
      };
      const id = await w.api.attendanceSave({ id: null, data, status: 'draft' });
      await w.api.attendanceSave({ id, data, status: 'finalised' });
      return id;
    },
    { forename: 'Bill', surname: `List${stamp}`, station: STATION_NAME, firmId, firmName: `BillList Firm ${stamp}` },
  );
  expect(attendanceId).toBeTruthy();

  await page.evaluate(() => {
    const w = window as unknown as { showView?: (name: string) => void; refreshList?: () => void };
    if (typeof w.showView === 'function') w.showView('list');
    if (typeof w.refreshList === 'function') w.refreshList();
  });
  await expect(page.locator('#view-list')).toHaveClass(/active/);

  const billBtn = page
    .locator('#attendance-list li')
    .filter({ has: page.locator(`.amend-btn[data-id="${attendanceId}"]`) })
    .locator('.bill-btn');
  await expect(billBtn, 'Bill button should be enabled on finalised row').toBeVisible({ timeout: 15_000 });
  await expect(billBtn).toBeEnabled();
  await billBtn.click();

  await expect(page.locator('#view-matter-billing')).toHaveClass(/active/, { timeout: 10_000 });
  await page.waitForFunction(
    (id: number) => {
      const w = window as unknown as { currentAttendanceId?: number };
      return w.currentAttendanceId === id;
    },
    attendanceId,
    { timeout: 10_000 },
  );
  await expect(page.locator('#workflow-overlay, .wf-inline #workflow-overlay').first()).toBeVisible({
    timeout: 15_000,
  });
});

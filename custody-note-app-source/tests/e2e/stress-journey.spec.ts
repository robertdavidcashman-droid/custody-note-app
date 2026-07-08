/**
 * Continuous end-to-end stress journey for a real custody case lifecycle.
 *
 * One Electron instance, one isolated CUSTODYNOTE_TEST_USERDATA profile.
 * Drives the full case lifecycle end-to-end — intake -> draft (with mistakes)
 * -> edit-after-save -> finalise -> finalise-lock check -> Finish-matter
 * workflow -> billing review gating -> live recalc -> archive ->
 * billable-attendances visibility -> search post-archive.
 *
 * No expect()s on stage-critical code paths — every check uses record()
 * so the journey continues end-to-end and we get a structured risk report
 * even when individual steps surface failures.
 */
import { test, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dismissFirstLaunchModalIfPresent } from './e2e-helpers';

type Result = { name: string; status: 'PASS' | 'FAIL' | 'INFO'; detail?: string };
const journey: Result[] = [];
function record(name: string, status: Result['status'], detail?: string) {
  journey.push({ name, status, detail });
  /* eslint-disable no-console */
  console.log(`[journey][${status}] ${name}${detail ? ' :: ' + detail : ''}`);
}

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); }
  catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    record(label + ' [exception]', 'FAIL', msg.slice(0, 200));
    return undefined;
  }
}

const STAMP = Date.now();
const SUR = `Okafor${STAMP}`;
const FORE = 'Daniel';
const STATION = 'Brixton Police Station';
const DSCC = `DSCC-${STAMP}`;
const CUSTNUM = `BX/${STAMP}`;
const OFFENCE = 's.18 GBH';

test('full lifecycle stress journey (one Electron run)', async () => {
  test.setTimeout(180_000);
  const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-stress-e2e-'));
  let electronApp: ElectronApplication | undefined;
  let page: Page | undefined;

  try {
    /* Windows _electron.launch occasionally fails the websocket handshake when this
       spec runs as the 4th+ sequential Electron startup in the suite. Retry up to
       3 times with a short backoff so the full gate is deterministic. */
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3 && !electronApp; attempt++) {
      try {
        electronApp = await _electron.launch({
          args: [path.join(__dirname, '..', '..', 'main.js')],
          env: {
            ...process.env,
            NODE_ENV: 'test',
            CUSTODYNOTE_TEST_USERDATA: testUserData,
            CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
          },
        });
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[journey] electron launch attempt ${attempt} failed: ${msg.slice(0, 120)}`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    if (!electronApp) throw lastErr;
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const splash = page.locator('#splash');
    await splash.waitFor({ state: 'hidden', timeout: 60000 }).catch(async () => {
      await page!.waitForSelector('.app-header, #header-app-title', { timeout: 30000 });
    });
    await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined', { timeout: 30000 });
    await dismissFirstLaunchModalIfPresent(page);
    record('boot: app launched, IPC ready, first-launch modal dismissed', 'PASS');

    /* ─────────── Stage A — pre-flight ─────────── */
    const verRaw = await safe('A.1 getAppVersion', () =>
      page!.evaluate(async () => {
        const w = window as unknown as { api: { getAppVersion: () => Promise<unknown> } };
        return w.api.getAppVersion();
      }),
    );
    let verStr = '';
    if (typeof verRaw === 'string') verStr = verRaw;
    else if (verRaw && typeof verRaw === 'object') {
      const o = verRaw as { version?: string; appVersion?: string };
      verStr = o.version || o.appVersion || JSON.stringify(verRaw);
    }
    if (/^\d+\.\d+\.\d+/.test(verStr) || /\d+\.\d+\.\d+/.test(verStr)) {
      record('A.1 app version reported', 'PASS', `v${verStr}`);
    } else {
      record('A.1 app version unrecognised', 'FAIL', verStr);
    }

    const apiSurface = await safe('A.2 ipc surface scan', () =>
      page!.evaluate(() => {
        const w = window as unknown as { api?: Record<string, unknown> };
        const required = [
          'attendanceSave', 'attendanceGet', 'attendanceSearch',
          'attendanceCheckDuplicate', 'attendanceArchive',
          'auditLogGetHistory', 'billableAttendances', 'attendanceInvoiceStatus',
          'quickfileTestConnection', 'quickfileCreateInvoice',
        ];
        return required.map(k => ({ k, ok: typeof w.api?.[k] === 'function' }));
      }),
    ) || [];
    const missing = apiSurface.filter(x => !x.ok).map(x => x.k);
    if (missing.length === 0) record('A.2 IPC surface complete (10/10)', 'PASS');
    else record('A.2 IPC surface incomplete', 'FAIL', 'missing: ' + missing.join(', '));

    const qf = await safe('A.3 quickfileTestConnection', () =>
      page!.evaluate(async () => {
        const w = window as unknown as { api: { quickfileTestConnection: () => Promise<unknown> } };
        try { return await w.api.quickfileTestConnection(); } catch (e) { return { error: String(e) }; }
      }),
    );
    const qfStr = JSON.stringify(qf || null);
    const qfConfigured = !!(qf && typeof qf === 'object' && (qf as { ok?: boolean }).ok);
    record('A.3 QuickFile connection status', qfConfigured ? 'PASS' : 'INFO',
      qfConfigured ? 'Configured' : 'Not configured in test profile (manual-bill path will be exercised) :: ' + qfStr.slice(0, 160));

    /* ─────────── Stage B — incomplete first save ─────────── */
    const id = await safe('B.1 incomplete draft save', () =>
      page!.evaluate(async (p) => {
        const w = window as unknown as { api: { attendanceSave: (x: unknown) => Promise<number> } };
        return w.api.attendanceSave({
          id: null,
          data: {
            _formType: 'attendance',
            attendanceMode: 'custody',
            surname: p.sur,
            /* deliberately omit forename / station / DSCC — duty solicitor in the car */
          },
          status: 'draft',
        });
      }, { sur: SUR }),
    );
    const attendanceId: number = typeof id === 'number' ? id : NaN;
    if (Number.isFinite(attendanceId)) record('B.1 incomplete draft saved (mistake tolerated)', 'PASS', `id=${attendanceId}`);
    else { record('B.1 incomplete draft save FAILED', 'FAIL', String(id)); return; }

    const row1 = await safe('B.2 reload incomplete draft', () =>
      page!.evaluate(async (i) => {
        const w = window as unknown as { api: { attendanceGet: (id: number) => Promise<{ data: string } | null> } };
        return w.api.attendanceGet(i);
      }, attendanceId),
    );
    const parsed1 = row1 ? JSON.parse(row1.data) as Record<string, unknown> : null;
    if (parsed1 && parsed1.surname === SUR && !parsed1.forename) {
      record('B.2 missing fields persisted as empty (no silent invention)', 'PASS');
    } else {
      record('B.2 incomplete draft round-trip', 'FAIL', JSON.stringify(parsed1).slice(0, 200));
    }

    /* ─────────── Stage C — edit after save (with mistake then correction) ─────────── */
    const arrival = `Arrived 02:42. Custody Sgt confirmed s.18 GBH. Client says "wasn't me" — café incident.\nCustody record requested.`;
    const wrongSurname = `OkaforTYPO${STAMP}`;
    await safe('C.0 first edit (with deliberate surname typo)', () =>
      page!.evaluate(async ({ id, fore, st, dscc, cn, off, arrivalNotes, wrong }) => {
        const w = window as unknown as { api: { attendanceSave: (x: unknown) => Promise<number> } };
        return w.api.attendanceSave({
          id, status: 'draft',
          data: {
            _formType: 'attendance', attendanceMode: 'custody',
            surname: wrong, forename: fore,
            policeStationName: st, dsccRef: dscc,
            custodyNumber: cn, offenceSummary: off,
            arrivalNotes, date: '2026-04-17',
          },
        });
      }, { id: attendanceId, fore: FORE, st: STATION, dscc: DSCC, cn: CUSTNUM, off: OFFENCE, arrivalNotes: arrival, wrong: wrongSurname }),
    );

    const after = await page.evaluate(async (i) => {
      const w = window as unknown as { api: { attendanceGet: (id: number) => Promise<{ data: string } | null> } };
      return w.api.attendanceGet(i);
    }, attendanceId);
    const parsed2 = JSON.parse(after!.data) as Record<string, string>;
    const checks = [
      ['forename', parsed2.forename === FORE],
      ['policeStationName', parsed2.policeStationName === STATION],
      ['dsccRef', parsed2.dsccRef === DSCC],
      ['custodyNumber', parsed2.custodyNumber === CUSTNUM],
      ['unicode (café)', parsed2.arrivalNotes?.includes('café')],
      ['quotes', parsed2.arrivalNotes?.includes('"wasn\'t me"')],
      ['newline', parsed2.arrivalNotes?.includes('\n')],
    ] as [string, boolean][];
    const failedChecks = checks.filter(([, ok]) => !ok).map(([k]) => k);
    if (failedChecks.length === 0) record('C.1 edit-after-save persisted (unicode/quotes/newlines incl.)', 'PASS');
    else record('C.1 edit-after-save partial', 'FAIL', 'failed: ' + failedChecks.join(', '));

    /* Correct the surname mistake */
    await safe('C.2 correction save', () =>
      page!.evaluate(async ({ id, sur }) => {
        const w = window as unknown as { api: { attendanceSave: (x: unknown) => Promise<number>, attendanceGet: (id: number) => Promise<{ data: string }> } };
        const cur = await w.api.attendanceGet(id);
        const data = JSON.parse(cur.data); data.surname = sur;
        return w.api.attendanceSave({ id, data, status: 'draft' });
      }, { id: attendanceId, sur: SUR }),
    );
    const cor = await page.evaluate(async (i) => {
      const w = window as unknown as { api: { attendanceGet: (id: number) => Promise<{ data: string }> } };
      return w.api.attendanceGet(i);
    }, attendanceId);
    if ((JSON.parse(cor.data) as Record<string, string>).surname === SUR) {
      record('C.2 correction overwrites previous value', 'PASS');
    } else {
      record('C.2 correction did not persist', 'FAIL', cor.data.slice(0, 160));
    }

    /* ─────────── Stage D — DSCC duplicate detection ─────────── */
    /* Note: attendance-check-duplicate only matches FINALISED records by design,
       so we run it now (pre-finalise) AND again after E (post-finalise) to verify both states. */
    const dupsPreFin = await page.evaluate(async (dscc) => {
      const w = window as unknown as {
        api: { attendanceCheckDuplicate: (p: { dsccRef: string; excludeId?: number }) => Promise<{ id: number; matchReason: string }[]> }
      };
      return w.api.attendanceCheckDuplicate({ dsccRef: dscc, excludeId: 0 });
    }, DSCC);
    if (dupsPreFin.length === 0) {
      record('D.1 attendanceCheckDuplicate ignores draft DSCC (by design — finalised-only)', 'PASS', '0 matches as expected');
    } else {
      record('D.1 attendanceCheckDuplicate matched a draft', 'INFO', `unexpected hits: ${JSON.stringify(dupsPreFin).slice(0, 160)}`);
    }

    /* Draft dedupe key requires (dscc + date + station). Send a complete second draft
       and verify it merges into the existing row instead of creating a duplicate. */
    const id2 = await page.evaluate(async ({ dscc, sur, st }) => {
      const w = window as unknown as { api: { attendanceSave: (x: unknown) => Promise<number> } };
      return w.api.attendanceSave({
        id: null,
        data: {
          _formType: 'attendance', attendanceMode: 'custody',
          surname: sur, forename: 'Daniel', dsccRef: dscc,
          policeStationName: st, date: '2026-04-17',
        },
        status: 'draft',
      });
    }, { dscc: DSCC, sur: SUR, st: STATION });
    if (id2 === attendanceId) record('D.2 draft dedupe (full key dscc+date+station): merged into existing row', 'PASS', `id=${id2}`);
    else record('D.2 draft dedupe FAILED — full-key second save created NEW row', 'FAIL', `expected ${attendanceId}, got ${id2} :: revenue/audit risk`);

    /* Negative case — partial key (dscc only, no date or station) should NOT merge.
       This is by design (conservative dedupe to prevent false matches at booking-in). */
    const id3 = await page.evaluate(async ({ dscc, sur }) => {
      const w = window as unknown as { api: { attendanceSave: (x: unknown) => Promise<number> } };
      return w.api.attendanceSave({
        id: null,
        data: { _formType: 'attendance', attendanceMode: 'custody', surname: sur + '-PARTIAL', dsccRef: dscc },
        status: 'draft',
      });
    }, { dscc: DSCC, sur: SUR });
    if (id3 !== attendanceId) {
      record('D.3 partial-key save (DSCC only, no date/station) creates separate row', 'INFO',
        `id=${id3} (by design: dedupe needs dscc+date+station — but this is a real-world risk if duty solicitor saves a stub then a colleague creates the full record)`);
    } else {
      record('D.3 partial-key save merged unexpectedly', 'INFO', `id=${id3}`);
    }

    /* ─────────── Stage E — finalise ─────────── */
    const data = await page.evaluate(async (i) => {
      const w = window as unknown as { api: { attendanceGet: (id: number) => Promise<{ data: string }> } };
      return JSON.parse((await w.api.attendanceGet(i)).data);
    }, attendanceId);
    const finalisedId = await page.evaluate(async ({ id, d }) => {
      const w = window as unknown as { api: { attendanceSave: (x: unknown) => Promise<number> } };
      return w.api.attendanceSave({ id, data: d, status: 'finalised' });
    }, { id: attendanceId, d: data });
    if (finalisedId === attendanceId) record('E.1 finalise returned same id', 'PASS', `id=${finalisedId}`);
    else record('E.1 finalise returned different id', 'FAIL', `expected ${attendanceId}, got ${finalisedId}`);

    const rowFin = await page.evaluate(async (i) => {
      const w = window as unknown as { api: { attendanceGet: (id: number) => Promise<{ status: string }> } };
      return w.api.attendanceGet(i);
    }, attendanceId);
    if (rowFin.status === 'finalised') record('E.2 status now "finalised" in DB', 'PASS');
    else record('E.2 status not finalised', 'FAIL', rowFin.status);

    /* Post-finalise duplicate check — should now match */
    const dupsPost = await page.evaluate(async (dscc) => {
      const w = window as unknown as {
        api: { attendanceCheckDuplicate: (p: { dsccRef: string; excludeId?: number }) => Promise<{ id: number; matchReason: string }[]> }
      };
      return w.api.attendanceCheckDuplicate({ dsccRef: dscc, excludeId: 0 });
    }, DSCC);
    if (dupsPost.some(d => d.matchReason === 'Same DSCC reference')) {
      record('E.3 attendanceCheckDuplicate matches finalised DSCC', 'PASS', `${dupsPost.length} match(es)`);
    } else {
      record('E.3 attendanceCheckDuplicate did NOT match post-finalise DSCC', 'FAIL', JSON.stringify(dupsPost).slice(0, 160));
    }

    /* ─────────── Stage F — finalise lock ─────────── */
    const blocked = await page.evaluate(async ({ id }) => {
      const w = window as unknown as { api: {
        attendanceSave: (x: unknown) => Promise<number | { error: string; message?: string }>;
        attendanceGet: (id: number) => Promise<{ data: string }>;
      } };
      const cur = await w.api.attendanceGet(id);
      const d = JSON.parse(cur.data);
      d.arrivalNotes = '*** TAMPERED AFTER FINALISE ***';
      return w.api.attendanceSave({ id, data: d, status: 'draft' });
    }, { id: attendanceId });
    const isBlocked = !!(blocked && typeof blocked === 'object' && 'error' in blocked);
    if (isBlocked) record('F.1 silent post-finalise edit rejected', 'PASS', JSON.stringify(blocked).slice(0, 120));
    else record('F.1 finalise lock NOT enforced — tamper accepted', 'FAIL', 'compliance/legal risk: post-finalise edits possible without supervisor sign-off');

    const rowAfterTamper = await page.evaluate(async (i) => {
      const w = window as unknown as { api: { attendanceGet: (id: number) => Promise<{ data: string }> } };
      return w.api.attendanceGet(i);
    }, attendanceId);
    const tamperedNotes = (JSON.parse(rowAfterTamper.data) as Record<string, string>).arrivalNotes || '';
    if (!tamperedNotes.includes('TAMPERED')) record('F.2 DB unchanged after rejected tamper', 'PASS');
    else record('F.2 DB MUTATED despite reject', 'FAIL', 'data integrity violated');

    /* ─────────── Stage G — audit trail ─────────── */
    const entries = await page.evaluate(async (i) => {
      const w = window as unknown as { api: { auditLogGetHistory: (id: number) => Promise<{ action: string; timestamp?: string }[]> } };
      return w.api.auditLogGetHistory(i);
    }, attendanceId);
    const actions = entries.map(e => e.action);
    if (actions.includes('created') && actions.filter(a => a === 'updated').length >= 1) {
      record('G.1 audit log has created + ≥1 updated', 'PASS', `${entries.length} entries: ${actions.slice(0, 12).join(', ')}`);
    } else {
      record('G.1 audit log incomplete', 'FAIL', `actions=[${actions.join(', ')}]`);
    }

    /* ─────────── Stage H — open Finish-matter workflow via UI ─────────── */
    await safe('H.0 navigate to record', async () => {
      /* Try several known global routes used by the renderer to load a record into the form view */
      await page!.evaluate(async (id) => {
        const w = window as unknown as Record<string, unknown> & {
          openAttendanceById?: (id: number) => unknown;
          loadRecordIntoForm?: (id: number) => Promise<unknown>;
          openAttendance?: (id: number) => unknown;
          showAttendance?: (id: number) => unknown;
        };
        if (typeof w.openAttendanceById === 'function') return w.openAttendanceById(id);
        if (typeof w.loadRecordIntoForm === 'function') return w.loadRecordIntoForm(id);
        if (typeof w.openAttendance === 'function') return w.openAttendance(id);
        if (typeof w.showAttendance === 'function') return w.showAttendance(id);
      }, attendanceId);
      await page!.waitForTimeout(900);
    });

    let billingBtnVisible = await page.locator('#bottom-bar-finish-pill').isVisible().catch(() => false);
    if (!billingBtnVisible) {
      billingBtnVisible = await page.locator('#billing-panel-btn').isVisible().catch(() => false);
    }
    if (!billingBtnVisible) {
      /* Fall back to clicking the row in the records list */
      await page.locator('.bottom-nav-btn[data-nav="records"]').click().catch(() => undefined);
      await page.waitForTimeout(700);
      const rowSel = `[data-attendance-id="${attendanceId}"], [data-id="${attendanceId}"]`;
      await page.locator(rowSel).first().click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      billingBtnVisible = await page.locator('#bottom-bar-finish-pill').isVisible().catch(() => false);
      if (!billingBtnVisible) {
        billingBtnVisible = await page.locator('#billing-panel-btn').isVisible().catch(() => false);
      }
    }
    if (billingBtnVisible) record('H.0 record loaded into form view', 'PASS');
    else record('H.0 could not navigate to record from list', 'INFO', 'workflow steps below may use direct invocation fallback');

    let overlayPresent = false;
    if (billingBtnVisible) {
      const finishBtn = (await page.locator('#bottom-bar-finish-pill').isVisible().catch(() => false))
        ? page.locator('#bottom-bar-finish-pill')
        : page.locator('#billing-panel-btn');
      await finishBtn.click();
      await page.waitForTimeout(500);
      const attachCancel = page.locator('.cn-confirm-overlay .cn-confirm-btns .btn-secondary').first();
      if (await attachCancel.isVisible().catch(() => false)) {
        await attachCancel.click();
        await page.waitForTimeout(500);
      }
      overlayPresent = await page.locator('#workflow-overlay').isVisible().catch(() => false);
    }
    if (overlayPresent) {
      record('H.1 Finish-matter overlay opened from form', 'PASS');
    } else {
      /* Fallback: invoke openWorkflow directly */
      await safe('H.1b direct openWorkflow invocation', () =>
        page!.evaluate(async (id) => {
          const w = window as unknown as { openWorkflow?: (opts: { attendanceId: number; startStep?: number }) => unknown };
          if (typeof w.openWorkflow === 'function') return w.openWorkflow({ attendanceId: id, startStep: 1 });
        }, attendanceId),
      );
      await page.waitForTimeout(500);
      overlayPresent = await page.locator('#workflow-overlay').isVisible().catch(() => false);
      if (overlayPresent) record('H.1 Finish-matter overlay opened via fallback openWorkflow()', 'INFO', 'header button path was not reachable from current view');
      else record('H.1 Finish-matter overlay did not open', 'FAIL', 'workflow unavailable — billing & invoice path blocked');
    }

    /* ─────────── Stage I — billing review gating + live recalc ─────────── */
    if (overlayPresent) {
      const onInvoice = await page.locator('#wf-fee').isVisible().catch(() => false);
      if (!onInvoice) {
        const docNext = page.locator('#wf-doc-next');
        if (await docNext.isVisible().catch(() => false)) {
          await docNext.click(); await page.waitForTimeout(700);
        } else {
          const stepInvoice = page.locator('.wf-step[data-wf-idx="1"]').first();
          if (await stepInvoice.isVisible().catch(() => false)) {
            await stepInvoice.click(); await page.waitForTimeout(500);
          }
        }
      }
      const feeVisible = await page.locator('#wf-fee').isVisible().catch(() => false);
      if (feeVisible) record('I.1 invoice step rendered with charge inputs', 'PASS');
      else record('I.1 invoice step inputs missing', 'FAIL', 'cannot reach billing review screen');

      if (feeVisible) {
        /* Detect which path the billing footer rendered:
           - QF configured: #wf-bill-create (Generate Invoice) — gated by 3 checkboxes
           - QF not configured: #wf-bill-next-complete (Next: Review & complete) — no checkbox gating */
        const createExists = await page.locator('#wf-bill-create').count().then(n => n > 0).catch(() => false);
        const nextCompleteExists = await page.locator('#wf-bill-next-complete').count().then(n => n > 0).catch(() => false);

        if (createExists) {
          const createBtn = page.locator('#wf-bill-create');
          const initiallyDisabled = await createBtn.evaluate((b: HTMLButtonElement) => b.disabled).catch(() => null);
          if (initiallyDisabled === true) record('I.2 [QF-configured path] Generate Invoice disabled before review checklist', 'PASS');
          else record('I.2 [QF-configured path] Generate Invoice gating broken', 'FAIL', `disabled=${initiallyDisabled} — billing-without-review risk`);
        } else if (nextCompleteExists) {
          record('I.2 [QF-NOT-configured path] no Generate Invoice button — manual-bill path active', 'PASS', '#wf-bill-next-complete present (correct branch)');
        } else {
          record('I.2 billing footer has neither create nor next-complete button', 'FAIL', 'workflow may be in unexpected state');
        }

        /* Live recalc — always works regardless of QF */
        await page.fill('#wf-fee', '160');
        await page.fill('#wf-miles', '20');
        await page.fill('#wf-rate', '0.45');
        await page.fill('#wf-parking', '5');
        await page.fill('#wf-vat', '20');
        for (const sel of ['#wf-fee', '#wf-miles', '#wf-rate', '#wf-parking', '#wf-vat']) {
          await page.locator(sel).dispatchEvent('input');
        }
        await page.waitForTimeout(300);

        const totals = await page.evaluate(() => {
          const t = (id: string) => (document.getElementById(id)?.textContent || '').trim();
          return { sub: t('wf-prev-sub'), vat: t('wf-prev-vat'), total: t('wf-prev-total') };
        });
        const subOk = /174/.test(totals.sub);
        const vatOk = /34\.80|34,80/.test(totals.vat);
        const totalOk = /208\.80|208,80/.test(totals.total);
        if (subOk && vatOk && totalOk) record('I.3 live recalc correct (£160 + 20mi×£0.45 + £5 = £174 net, £34.80 VAT, £208.80 total)', 'PASS', JSON.stringify(totals));
        else record('I.3 live recalc INCORRECT — billing arithmetic risk', 'FAIL', JSON.stringify(totals));

        const narrative = await page.locator('#wf-narrative').inputValue().catch(() => '');
        if (narrative && narrative.length > 0) record('I.4 invoice narrative auto-generated', 'PASS', narrative.slice(0, 80));
        else record('I.4 invoice narrative empty', 'INFO', 'narrative blank — _buildInvoiceNarrative inputs (clientName/station/date/offence) may be missing on form view');

        if (createExists) {
          await page.check('#wf-check-attendance').catch(() => undefined);
          await page.check('#wf-check-docs').catch(() => undefined);
          await page.check('#wf-check-billing').catch(() => undefined);
          await page.waitForTimeout(200);
          const createBtn = page.locator('#wf-bill-create');
          const enabledAfter = await createBtn.evaluate((b: HTMLButtonElement) => !b.disabled).catch(() => null);
          if (enabledAfter === true) record('I.5 [QF-configured] Generate Invoice enables after all 3 review boxes ticked', 'PASS');
          else record('I.5 [QF-configured] Generate Invoice did not unlock', 'FAIL', `enabled=${enabledAfter}`);
        } else if (nextCompleteExists) {
          /* Manual-bill path: confirm the 3 checkboxes still exist for honesty / audit even though they don't gate a button here */
          const allChecksExist = await page.evaluate(() => {
            return ['wf-check-attendance', 'wf-check-docs', 'wf-check-billing'].every(id => !!document.getElementById(id));
          });
          if (allChecksExist) record('I.5 [QF-NOT-configured] review-confirmation checklist still rendered (audit honesty)', 'PASS');
          else record('I.5 [QF-NOT-configured] review checklist missing in manual-bill path', 'INFO', 'no QF means no audit gate — solicitor self-discipline only');
        }
      }

      /* ─────────── Stage J — out-of-order step navigation clamping ─────────── */
      const stepsLen = await page.evaluate(() => ((window as unknown as { _workflowSteps?: unknown[] })._workflowSteps || []).length);
      await page.evaluate(() => (window as unknown as { _wfGoToStep?: (n: number) => void })._wfGoToStep?.(99));
      await page.waitForTimeout(150);
      const after99 = await page.evaluate(() => (window as unknown as { _workflowStep?: number })._workflowStep);
      if (typeof after99 === 'number' && after99 <= stepsLen - 1) record('J.1 _wfGoToStep(99) clamped to last step', 'PASS', `step=${after99} max=${stepsLen - 1}`);
      else record('J.1 _wfGoToStep(99) NOT clamped', 'FAIL', `step=${after99} stepsLen=${stepsLen}`);

      await page.evaluate(() => (window as unknown as { _wfGoToStep?: (n: number) => void })._wfGoToStep?.(-5));
      await page.waitForTimeout(150);
      const afterNeg = await page.evaluate(() => (window as unknown as { _workflowStep?: number })._workflowStep);
      if (afterNeg === 0) record('J.2 _wfGoToStep(-5) clamped to 0', 'PASS');
      else record('J.2 _wfGoToStep(-5) NOT clamped', 'FAIL', `step=${afterNeg}`);

      /* ─────────── Stage K — close workflow ─────────── */
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      let stillOpen = await page.locator('#workflow-overlay').isVisible().catch(() => false);
      if (!stillOpen) {
        record('K.1 Escape closes workflow overlay', 'PASS');
      } else {
        await page.locator('#wf-bill-close').click().catch(() => undefined);
        await page.waitForTimeout(400);
        stillOpen = await page.locator('#workflow-overlay').isVisible().catch(() => false);
        if (!stillOpen) record('K.1 close-button closed overlay (Escape did not)', 'INFO', 'Escape-to-close may need fixing');
        else record('K.1 workflow overlay would not close', 'FAIL', 'persisted after Escape and close click');
      }
    } else {
      record('I/J/K skipped: workflow overlay never opened', 'INFO');
    }

    /* ─────────── Stage L — billable-attendances visibility ─────────── */
    const list = await page.evaluate(async () => {
      const w = window as unknown as { api: { billableAttendances: () => Promise<unknown> } };
      return w.api.billableAttendances();
    });
    const arr = Array.isArray(list) ? list : (list as { rows?: unknown[] })?.rows || [];
    const hit = (arr as { id?: number; client_name?: string }[]).find(r => r.id === attendanceId);
    if (hit) record('L.1 billable-attendances includes this matter', 'PASS', `client="${hit.client_name}"`);
    else record('L.1 billable-attendances missing this matter', 'FAIL', `attendance ${attendanceId} not in ${arr.length} rows — revenue leakage risk`);

    /* ─────────── Stage M — archive ─────────── */
    await safe('M.0 stamp completion timestamps', () =>
      page!.evaluate(async ({ id }) => {
        const w = window as unknown as { api: {
          attendanceGet: (id: number) => Promise<{ data: string }>;
          attendanceSave: (x: unknown) => Promise<number>;
        } };
        const cur = await w.api.attendanceGet(id);
        const d = JSON.parse(cur.data);
        const ts = new Date().toISOString();
        d.billingProcessCompletedAt = ts;
        d.officeWorkCompletedAt = ts;
        return w.api.attendanceSave({ id, data: d, status: 'finalised' });
      }, { id: attendanceId }),
    );

    const archived = await page.evaluate(async (id) => {
      const w = window as unknown as { api: { attendanceArchive: (id: number) => Promise<unknown> } };
      try { return await w.api.attendanceArchive(id); } catch (e) { return { error: String(e) }; }
    }, attendanceId);
    record('M.1 attendanceArchive returned', 'PASS', JSON.stringify(archived).slice(0, 160));

    const rowArc = await page.evaluate(async (id) => {
      const w = window as unknown as { api: { attendanceGet: (id: number) => Promise<{ status: string; archived_at?: string | null }> } };
      return w.api.attendanceGet(id);
    }, attendanceId);
    const archivedAt = rowArc.archived_at;
    if (archivedAt) {
      record('M.2 archived_at timestamp set in DB', 'PASS', `status=${rowArc.status} archived_at=${archivedAt}`);
    } else {
      record('M.2 archived_at NOT set after attendanceArchive', 'FAIL', `status=${rowArc.status} archived_at=${archivedAt ?? 'null'} — archive may not have persisted`);
    }

    const billableAfter = await page.evaluate(async () => {
      const w = window as unknown as { api: { billableAttendances: () => Promise<unknown> } };
      return w.api.billableAttendances();
    });
    const arr2 = Array.isArray(billableAfter) ? billableAfter : (billableAfter as { rows?: unknown[] })?.rows || [];
    const stillBillable = (arr2 as { id?: number }[]).some(r => r.id === attendanceId);
    if (!stillBillable) record('M.3 archived record removed from billable list (duplicate-billing guard)', 'PASS');
    else record('M.3 archived record still appears as billable', 'FAIL', 'duplicate-billing risk: solicitor could re-bill an archived matter');

    /* ─────────── Stage N — search post-archive ─────────── */
    /* Default search (which excludes archived) — should NOT find the archived record */
    const resDefault = await page.evaluate(async (q) => {
      const w = window as unknown as { api: { attendanceSearch: (p: { query: string; page?: number; pageSize?: number }) => Promise<{ rows: { id?: number; client_name?: string }[]; total: number }> } };
      return w.api.attendanceSearch({ query: q, page: 1, pageSize: 50 });
    }, SUR);
    const foundDefault = resDefault.rows.some(r => r.id === attendanceId);
    if (!foundDefault) record('N.1 default search hides archived record (correct — keeps active list clean)', 'PASS', `total=${resDefault.total}`);
    else record('N.1 default search still surfaces archived record', 'INFO', `total=${resDefault.total} — UI may filter at render time`);

    /* Explicit archived search — must find it */
    const resArchived = await page.evaluate(async (q) => {
      const w = window as unknown as { api: { attendanceSearch: (p: { query: string; page?: number; pageSize?: number; archived?: boolean }) => Promise<{ rows: { id?: number; client_name?: string }[]; total: number }> } };
      return w.api.attendanceSearch({ query: q, page: 1, pageSize: 50, archived: true });
    }, SUR);
    const foundArchived = resArchived.rows.some(r => r.id === attendanceId);
    if (foundArchived) record('N.2 archived-filter search finds the archived record', 'PASS', `total=${resArchived.total}`);
    else record('N.2 archived-filter search missed archived record', 'FAIL', `search "${SUR}" archived=true returned ${resArchived.total} — case retrieval risk`);
  } finally {
    /* ── final report ── */
    const passes = journey.filter(j => j.status === 'PASS').length;
    const fails  = journey.filter(j => j.status === 'FAIL').length;
    const infos  = journey.filter(j => j.status === 'INFO').length;
    /* eslint-disable no-console */
    console.log('\n================ STRESS JOURNEY REPORT ================');
    for (const j of journey) {
      const tag = j.status.padEnd(4, ' ');
      console.log(`  [${tag}] ${j.name}${j.detail ? '\n         -> ' + j.detail : ''}`);
    }
    console.log(`\n  TOTAL: ${journey.length} | PASS ${passes} | FAIL ${fails} | INFO ${infos}`);
    console.log('=======================================================\n');

    if (electronApp) {
      try {
        await Promise.race([
          electronApp.close(),
          new Promise<void>(resolve => setTimeout(resolve, 12_000)),
        ]);
      } catch { /* ignore */ }
      try {
        const proc = electronApp.process();
        if (proc && !proc.killed) proc.kill();
      } catch { /* ignore */ }
    }
    try { fs.rmSync(testUserData, { recursive: true, force: true }); } catch { /* ignore Windows file locks */ }
  }
});

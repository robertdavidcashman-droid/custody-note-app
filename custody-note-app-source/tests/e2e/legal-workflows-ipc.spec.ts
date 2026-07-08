/**
 * Legal / operational persistence and IPC tests (high-stakes workflows).
 * Exercises real main-process handlers via preload — not UI-only smoke.
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

let electronApp: ElectronApplication;
let page: Page;
let testUserData: string;

function custodyPayload(overrides: Record<string, unknown> = {}) {
  const stamp = Date.now();
  return {
    _formType: 'attendance',
    attendanceMode: 'custody',
    surname: `LegalTest${stamp}`,
    forename: 'Client',
    date: '2026-03-28',
    policeStationName: 'LegalTest Central Police Station',
    dsccRef: `LT-${stamp}`,
    arrivalNotes: `Narrative with unicode — café "quotes" and <tags> should persist.\nLine two.`,
    custodyNumber: `CN/LT/${stamp}`,
    ...overrides,
  };
}

test.beforeAll(async () => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-legal-e2e-'));
  electronApp = await _electron.launch({
    args: [path.join(__dirname, '..', '..', 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CUSTODYNOTE_TEST_USERDATA: testUserData,
    },
  });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const splash = page.locator('#splash');
  await splash.waitFor({ state: 'hidden', timeout: 60000 }).catch(async () => {
    /* First-launch modal may appear; header should still load */
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30000 });
  });
  await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined', {
    timeout: 30000,
  });
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
    /* ignore cleanup on Windows file locks */
  }
});

test.describe('Attendance persistence via IPC', () => {
  test('creates draft, persists indexed fields and JSON data, reloads identically', async () => {
    const data = custodyPayload();
    const id = await page.evaluate(async (d) => {
      const w = window as unknown as {
        api: { attendanceSave: (p: unknown) => Promise<number> };
      };
      return w.api.attendanceSave({ id: null, data: d, status: 'draft' });
    }, data);
    expect(id).toBeTruthy();
    expect(typeof id).toBe('number');

    const row = await page.evaluate(async (attId) => {
      const w = window as unknown as {
        api: { attendanceGet: (id: number) => Promise<{ data: string; status: string } | null> };
      };
      return w.api.attendanceGet(attId);
    }, id as number);
    expect(row).toBeTruthy();
    expect(row!.status).toBe('draft');
    const parsed = JSON.parse(row!.data) as Record<string, string>;
    expect(parsed.surname).toBe(data.surname);
    expect(parsed.forename).toBe(data.forename);
    expect(parsed.policeStationName).toBe(data.policeStationName);
    expect(parsed.dsccRef).toBe(data.dsccRef);
    expect(parsed.arrivalNotes).toBe(data.arrivalNotes);
    expect(parsed.custodyNumber).toBe(data.custodyNumber);
  });

  test('draft dedupe: second save with same DSCC updates same row', async () => {
    const dscc = `DEDUPE-${Date.now()}`;
    const id1 = await page.evaluate(
      async ({ dsccRef, base }) => {
        const w = window as unknown as {
          api: { attendanceSave: (p: unknown) => Promise<number> };
        };
        return w.api.attendanceSave({
          id: null,
          data: { ...base, dsccRef },
          status: 'draft',
        });
      },
      { dsccRef: dscc, base: custodyPayload({ dsccRef: dscc, surname: 'DedupeA' }) }
    );
    const id2 = await page.evaluate(
      async ({ dsccRef, base }) => {
        const w = window as unknown as {
          api: { attendanceSave: (p: unknown) => Promise<number> };
        };
        return w.api.attendanceSave({
          id: null,
          data: { ...base, dsccRef, surname: 'DedupeB' },
          status: 'draft',
        });
      },
      { dsccRef: dscc, base: custodyPayload({ dsccRef: dscc, surname: 'DedupeB' }) }
    );
    expect(id2).toBe(id1);

    const row = await page.evaluate(async (attId) => {
      const w = window as unknown as {
        api: { attendanceGet: (id: number) => Promise<{ data: string } | null> };
      };
      return w.api.attendanceGet(attId);
    }, id1 as number);
    const parsed = JSON.parse(row!.data) as { surname: string };
    expect(parsed.surname).toBe('DedupeB');
  });

  test('finalised record rejects non-finalise data writes (locked)', async () => {
    const data = custodyPayload({ surname: `Lock${Date.now()}` });
    const id = await page.evaluate(async (d) => {
      const w = window as unknown as {
        api: { attendanceSave: (p: unknown) => Promise<number | { error: string }> };
      };
      return w.api.attendanceSave({ id: null, data: d, status: 'draft' });
    }, data);
    await page.evaluate(
      async ({ attId, d }) => {
        const w = window as unknown as {
          api: { attendanceSave: (p: unknown) => Promise<number> };
        };
        await w.api.attendanceSave({ id: attId, data: d, status: 'finalised' });
      },
      { attId: id, d: data }
    );

    const blocked = await page.evaluate(
      async ({ attId, d }) => {
        const w = window as unknown as {
          api: { attendanceSave: (p: unknown) => Promise<number | { error: string }> };
        };
        const next = { ...d, arrivalNotes: 'Attempted silent change after finalise' };
        return w.api.attendanceSave({ id: attId, data: next, status: 'draft' });
      },
      { attId: id, d: data }
    );
    expect(blocked && typeof blocked === 'object' && 'error' in blocked).toBe(true);
    const err = blocked as { error: string; message?: string };
    expect(err.error).toBe('locked');
    expect(String(err.message || '').toLowerCase()).toContain('finalised');

    const row = await page.evaluate(async (attId) => {
      const w = window as unknown as {
        api: { attendanceGet: (id: number) => Promise<{ data: string } | null> };
      };
      return w.api.attendanceGet(attId);
    }, id as number);
    const parsed = JSON.parse(row!.data) as { arrivalNotes: string };
    expect(parsed.arrivalNotes).toBe(data.arrivalNotes);
  });

  test('audit trail records creation and updates', async () => {
    const data = custodyPayload({ surname: `Audit${Date.now()}` });
    const id = await page.evaluate(async (d) => {
      const w = window as unknown as {
        api: { attendanceSave: (p: unknown) => Promise<number> };
      };
      return w.api.attendanceSave({ id: null, data: d, status: 'draft' });
    }, data);

    await page.evaluate(
      async ({ attId, d }) => {
        const w = window as unknown as {
          api: { attendanceSave: (p: unknown) => Promise<number> };
        };
        const next = { ...d, forename: 'UpdatedForename' };
        await w.api.attendanceSave({ id: attId, data: next, status: 'draft' });
      },
      { attId: id, d: data }
    );

    const entries = await page.evaluate(async (attId) => {
      const w = window as unknown as {
        api: { auditLogGetHistory: (id: number) => Promise<{ action: string }[]> };
      };
      return w.api.auditLogGetHistory(attId);
    }, id as number);

    const actions = entries.map(e => e.action);
    expect(actions).toContain('created');
    expect(actions).toContain('updated');
  });
});

test.describe('Duplicate and search (operational risk)', () => {
  test('attendance-check-duplicate finds finalised DSCC match', async () => {
    const dscc = `DUPCHK-${Date.now()}`;
    const payload = custodyPayload({ dsccRef: dscc });
    const id = await page.evaluate(async (d) => {
      const w = window as unknown as {
        api: { attendanceSave: (p: unknown) => Promise<number> };
      };
      return w.api.attendanceSave({ id: null, data: d, status: 'draft' });
    }, payload);
    await page.evaluate(
      async ({ attId, d }) => {
        const w = window as unknown as {
          api: { attendanceSave: (p: unknown) => Promise<number> };
        };
        await w.api.attendanceSave({ id: attId, data: d, status: 'finalised' });
      },
      { attId: id, d: payload }
    );

    const dups = await page.evaluate(
      async (dsccRef) => {
        const w = window as unknown as {
          api: {
            attendanceCheckDuplicate: (p: {
              dsccRef: string;
              excludeId?: number;
            }) => Promise<{ id: number; matchReason: string }[]>;
          };
        };
        return w.api.attendanceCheckDuplicate({ dsccRef, excludeId: 0 });
      },
      dscc
    );
    expect(dups.length).toBeGreaterThanOrEqual(1);
    expect(dups.some(d => d.matchReason === 'Same DSCC reference')).toBe(true);
  });

  test('attendance-search returns created record by client fragment', async () => {
    const marker = `SearchMarker${Date.now()}`;
    const payload = custodyPayload({ surname: marker, forename: 'FindMe' });
    await page.evaluate(async (d) => {
      const w = window as unknown as {
        api: { attendanceSave: (p: unknown) => Promise<number> };
      };
      await w.api.attendanceSave({ id: null, data: d, status: 'draft' });
    }, payload);

    const res = await page.evaluate(async (q) => {
      const w = window as unknown as {
        api: {
          attendanceSearch: (p: { query: string; page?: number; pageSize?: number }) => Promise<{
            rows: { client_name?: string }[];
            total: number;
          }>;
        };
      };
      return w.api.attendanceSearch({ query: q, page: 1, pageSize: 50 });
    }, marker.slice(0, 12));

    expect(res.total).toBeGreaterThanOrEqual(1);
    const hit = res.rows.find(r => (r.client_name || '').includes(marker));
    expect(hit).toBeTruthy();
  });
});

test.describe('Billing IPC surface', () => {
  test('billing list IPC methods are exposed (handlers verified in unit billingWorkflow.test.js)', async () => {
    const ok = await page.evaluate(() => {
      const w = window as unknown as { api?: Record<string, unknown> };
      return (
        typeof w.api?.billableAttendances === 'function' &&
        typeof w.api?.billingViewRecords === 'function' &&
        typeof w.api?.attendanceInvoiceStatus === 'function'
      );
    });
    expect(ok).toBe(true);
  });
});

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
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-fullsys-e2e-'));
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

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => pageErrors.push(err.message));

  const splash = page.locator('#splash');
  await splash.waitFor({ state: 'hidden', timeout: 60000 }).catch(async () => {
    await page.waitForSelector('.app-header, #header-app-title', { timeout: 30000 });
  });
  await page.waitForFunction(() => typeof (window as unknown as { api?: unknown }).api !== 'undefined', {
    timeout: 30000,
  });
  await dismissFirstLaunchModalIfPresent(page);
  await page.waitForTimeout(500);
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

// ================================================================
// 1. App loads without crash
// ================================================================
test('app loads and renders a visible body', async () => {
  await expect(page.locator('body')).toBeVisible();
});

// ================================================================
// 2. Basic UI elements exist
// ================================================================
test('UI has buttons and inputs', async () => {
  const buttons = await page.locator('button').count();
  const inputs = await page.locator('input, textarea, select').count();
  expect(buttons + inputs).toBeGreaterThan(0);
});

// ================================================================
// 3. Bottom navigation bar is present and functional
// ================================================================
test('bottom nav bar has all expected tabs', async () => {
  const nav = page.locator('#bottom-nav');
  await expect(nav).toBeVisible();

  for (const label of ['Home', 'Records', 'New', 'Firms', 'Settings']) {
    await expect(nav.locator(`.bottom-nav-label:has-text("${label}")`)).toBeVisible();
  }
});

test('clicking Records tab shows list view', async () => {
  await page.locator('.bottom-nav-btn[data-nav="list"]').click();
  await page.waitForTimeout(500);
  const listView = page.locator('#view-list');
  await expect(listView).toHaveClass(/active/);
});

test('clicking Settings tab shows settings view', async () => {
  await page.locator('.bottom-nav-btn[data-nav="settings"]').click();
  await page.waitForTimeout(500);
  const settingsView = page.locator('#view-settings');
  await expect(settingsView).toHaveClass(/active/);
});

test('clicking Home tab shows home view', async () => {
  await page.locator('.bottom-nav-btn[data-nav="home"]').click();
  await page.waitForTimeout(500);
  const homeView = page.locator('#view-home');
  await expect(homeView).toHaveClass(/active/);
});

// ================================================================
// 4. Create new attendance record
// ================================================================
test('can start a new attendance record', async () => {
  await page.locator('.bottom-nav-btn[data-nav="new-attendance"]').click();
  await page.waitForTimeout(1000);

  const formView = page.locator('#view-form');
  await expect(formView).toHaveClass(/active/);
});

// ================================================================
// 5. Form inputs accept data
// ================================================================
test('form inputs are fillable and retain values', async () => {
  const inputs = page.locator('#view-form input:visible, #view-form textarea:visible');
  const count = await inputs.count();
  expect(count).toBeGreaterThan(0);

  const fillableTypes = ['text', 'email', 'tel', 'number', 'search', 'url'];

  let filled = 0;
  for (let i = 0; i < Math.min(count, 10); i++) {
    const input = inputs.nth(i);
    const tag = await input.evaluate(el => el.tagName.toLowerCase());
    const type = await input.getAttribute('type') || 'text';
    const readOnly = await input.getAttribute('readonly');
    const disabled = await input.getAttribute('disabled');

    if (readOnly !== null || disabled !== null) continue;

    if (tag === 'textarea' || fillableTypes.includes(type)) {
      const testVal = `E2E-Test-${i}`;
      await input.fill(testVal);
      const val = await input.inputValue();
      expect(val).toBe(testVal);
      filled++;
    }
  }
  expect(filled).toBeGreaterThan(0);
});

// ================================================================
// 6. Input visibility — text not invisible on background
// ================================================================
test('input text is visible (not same colour as background)', async () => {
  const inputs = page.locator('#view-form input[type="text"]:visible').first();
  if (await inputs.count() === 0) return;

  const { color, bg } = await inputs.evaluate(el => ({
    color: getComputedStyle(el).color,
    bg: getComputedStyle(el).backgroundColor,
  }));

  expect(color).not.toBe(bg);
});

// ================================================================
// 7. Gear menu opens and has items
// ================================================================
test('gear menu opens and shows items', async () => {
  const gearBtn = page.locator('.header-icon-btn').first();
  if (await gearBtn.isVisible()) {
    await gearBtn.click();
    await page.waitForTimeout(300);

    const dropdown = page.locator('.gear-dropdown:not(.hidden)');
    if (await dropdown.count() > 0) {
      const items = await dropdown.locator('.gear-item').count();
      expect(items).toBeGreaterThan(0);

      // Gear menu should be scrollable (overflow fix)
      const overflowY = await dropdown.evaluate(el => getComputedStyle(el).overflowY);
      expect(overflowY).toBe('auto');

      // Close it
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  }
});

// ================================================================
// 8. Footer status indicators exist
// ================================================================
test('footer has status indicators', async () => {
  await page.locator('.bottom-nav-btn[data-nav="home"]').click();
  await page.waitForTimeout(300);
  const footer = page.locator('.app-footer, #app-footer');
  if (await footer.count() > 0) {
    await expect(footer.first()).toBeVisible();
  }
});

// ================================================================
// 9. Records list view loads (isolated DB may be empty — persistence is covered in critical-journey.spec.ts)
// ================================================================
test('list view activates and attendance list container is present', async () => {
  await page.locator('.bottom-nav-btn[data-nav="list"]').click();
  await page.waitForTimeout(500);

  const listView = page.locator('#view-list');
  await expect(listView).toHaveClass(/active/);
  await expect(listView).toBeVisible();
  await expect(page.locator('#attendance-list')).toBeVisible();
});

// ================================================================
// 10. Settings page has expected sections
// ================================================================
test('settings page has key sections', async () => {
  await page.locator('.bottom-nav-btn[data-nav="settings"]').click();
  await page.waitForTimeout(500);

  const settingsView = page.locator('#view-settings');
  await expect(settingsView).toHaveClass(/active/);

  // Check for key settings cards (headings may be below the fold)
  for (const heading of ['Support', 'Useful Links']) {
    const section = settingsView.getByRole('heading', { name: heading });
    if (await section.count() > 0) {
      await section.first().scrollIntoViewIfNeeded();
      await expect(section.first()).toBeVisible();
    }
  }
});

// ================================================================
// 11. Dark mode toggle works
// ================================================================
test('dark mode can be toggled without crash', async () => {
  const html = page.locator('html');
  const wasDark = await html.evaluate(el => el.classList.contains('dark'));

  // Toggle via the theme button if it exists
  const themeBtn = page.locator('#theme-toggle-btn, .theme-toggle, [data-action="toggle-theme"]').first();
  if (await themeBtn.count() > 0 && await themeBtn.isVisible()) {
    await themeBtn.click();
    await page.waitForTimeout(300);

    const isDark = await html.evaluate(el => el.classList.contains('dark'));
    expect(isDark).not.toBe(wasDark);

    // Toggle back
    await themeBtn.click();
    await page.waitForTimeout(300);
  }
});

// ================================================================
// 12. No console errors or page crashes
// ================================================================
test('no critical console errors or page crashes', async () => {
  // Filter out known non-critical warnings
  const critical = consoleErrors.filter(e =>
    !e.includes('electron/js2c') &&
    !e.includes('DevTools') &&
    !e.includes('ERR_CONNECTION_REFUSED') &&
    !e.includes('Failed to load resource: the server responded with a status of 404')
  );
  const criticalPage = pageErrors.filter(e =>
    !e.includes('Script error')
  );

  expect(critical, `Console errors: ${critical.join('; ')}`).toHaveLength(0);
  expect(criticalPage, `Page crashes: ${criticalPage.join('; ')}`).toHaveLength(0);
});

// ================================================================
// 13. Window title is correct
// ================================================================
test('window title is Custody Note', async () => {
  const title = await page.title();
  expect(title).toContain('Custody Note');
});

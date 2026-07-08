# Testing Custody Note

Automated checks are split into three layers. Use **`npm run test:all`** (alias **`npm run test:ci`**) to run everything in order, or run layers individually while developing.

## Commands

| Command | What runs |
|---------|-----------|
| `npm run test:unit` | Node’s built-in test runner on `tests/*.test.js` — fast static/source checks and helpers. |
| `npm run test:e2e` | [Playwright](https://playwright.dev/) launches the real Electron app and runs `tests/e2e/*.spec.ts`. Requires browser/Electron install (see below). |
| `npm test` | In-app **smoke / stress** test: spawns Electron with `ELECTRON_RUN_AS_TEST=1`; embedded script in `main.js` drives UI and exits 0 or 1. |
| `npm run test:all` | Runs **unit → e2e → smoke** in sequence. Fails fast on first failure. |
| `SKIP_SMOKE=1 npm run test:all` | Same as above but **skips** `npm test` (faster when you only need unit + Playwright). On Windows PowerShell: `$env:SKIP_SMOKE=1; npm run test:all`. |

## Prerequisites

1. **Dependencies:** `npm ci` or `npm install` in the repo root.
2. **Playwright (e2e):** After install, run:
   ```bash
   npx playwright install
   ```
   The Electron-driven tests use `@playwright/test`’s `_electron` launcher with the app’s own `electron` dependency.
3. **Display / headless:** E2E and smoke tests start a real Electron window. On a developer machine, run from an interactive session. In CI, use a Windows runner (see `.github/workflows/test.yml`) or ensure a virtual display where applicable.
4. **Single instance:** The app uses a single-instance lock. **Close any running Custody Note** before running `npm test` or overlapping e2e runs, or the extra instance may exit immediately and fail the smoke step.

## What each layer proves

- **Unit tests:** Regressions in `app.js`, `main.js`, billing, finalise flow, stable JSON helpers, etc., mostly without launching the full UI.
- **E2E (`tests/e2e/`):** Real IPC (`window.api.*`), isolated temp user data via `CUSTODYNOTE_TEST_USERDATA`, and UI flows. **`critical-journey.spec.ts`** checks that a surname typed in the form is saved and found via `attendanceSearch`. UI specs set **`CUSTODYNOTE_E2E_SKIP_LICENCE_GATE=1`** when launching Electron so a fresh temp profile is not blocked by the sign-in overlay (see `preload.js` / `renderer/licence.js`).
- **Smoke (`npm test`):** Broad navigation and save/exit paths inside the renderer, executed when the test env is set.

## Troubleshooting

- **Smoke times out:** Increase patience or ensure no other instance holds the lock; check console for `[App] Another instance is already running`.
- **Playwright cannot find Electron:** Run from the project root so `node_modules/electron` resolves.
- **E2E flaky on first launch:** Isolated temp user data triggers the **Welcome setup** wizard (`#first-launch-modal`). UI specs call **`dismissFirstLaunchModalIfPresent`** (`tests/e2e/e2e-helpers.ts`) after `window.api` is ready so bottom-nav clicks are not intercepted.

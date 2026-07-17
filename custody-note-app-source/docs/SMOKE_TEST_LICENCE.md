# Smoke test: sign-in → validate → add-ons

Use a **paid / active subscription** test account on **production** (`custodynote.com`) or your **staging** API URL if you override it in the app.

## 1. App launch & sign-in

1. Start the app (`npm start` or installed build).
2. Open **Licence** (overlay or **Settings → Licence**).
3. **Sign in** with email + password for an account that has an **active** subscription.
4. Confirm **Settings → Licence** shows **“Signed in — {your email}”** (not a masked `CN-…` key) when using account auth.

## 2. Online validation & entitlements

1. Stay online; trigger validation if there is a **Refresh / Validate** action, or restart the app (validation runs on schedule / startup per your build).
2. In **Settings → Licence**, status should be **active** (or expiring soon), not **grace** / **invalid**.
3. Open **Settings** and scroll to:
   - **QuickFile** — the **locked** panel should be **hidden** and QuickFile fields **visible** when entitlements are present.
   - **Officer email** (or equivalent) — same: **unlocked** when `emailAddon` is entitled.

If add-ons stay locked but the subscription is active, check **main process logs** for `/api/licence/validate` errors and confirm the site returns `entitlements.quickfile` / `entitlements.emailAddon` with future `expiresAt` (see network from a manual API check below).

## 3. Optional: API check (curl)

Replace `YOUR_ACCESS_TOKEN` with a JWT from login (same as stored in app licence data is not trivial to read—use browser devtools on custodynote.com or a test login response).

```bash
curl -sS -X POST "https://custodynote.com/api/licence/validate" ^
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" ^
  -H "Content-Type: application/json" ^
  -d "{\"machineId\":\"smoke-test-machine\",\"appVersion\":\"1.0.0\"}"
```

Expect JSON with `"valid": true`, `"entitlements": { "quickfile": { "expiresAt": "..." }, "emailAddon": { "expiresAt": "..." } }` for an active subscription.

## 4. Regression: licence key path

1. Sign out / clear licence (if your build allows) and activate with a **real `CN-…` key** (legacy path).
2. Confirm validation still works and add-ons unlock the same way when the subscription is active.

## 5. Automated sanity (local)

- **Desktop:** `npm run test:unit` — runs Node unit tests (does not hit production APIs).
- **Website:** `npm run build` in `custody-note-website` — typecheck + production build.

# Manual Actions Required After the Hardening Pass

This file lists everything the **human operator** must do that the
hardening pass could not do for them. Work through it in order. Each
item ends with a one-line "verify" you can paste into a terminal or
browser to confirm completion.

---

## 1. Rotate the GitHub Personal Access Token (CRITICAL)

The `.env` file previously contained a live `GH_TOKEN`. It has been
replaced with a placeholder. **Treat the old token as compromised and
revoke it immediately.**

1. Go to <https://github.com/settings/tokens>.
2. Find the existing CustodyNote release token. Click **Delete**.
   (Or, if it is a fine-grained PAT, go to
   <https://github.com/settings/personal-access-tokens> and revoke it.)
3. Generate a new **fine-grained** PAT scoped to the
   `robertcashman-bit/custody-note-app` repository only.
   - Permissions: `Contents: Read and write`, `Actions: Read-only`,
     `Metadata: Read-only` (auto-included).
   - Expiration: 90 days. Set a calendar reminder to rotate.
4. Paste the new token into `.env`:
   ```
   GH_TOKEN=github_pat_<your new token>
   ```
5. Verify it works: `npm run release:current` should not fail with a
   401 from GitHub.

**Verify rotation succeeded:** the old token should fail
`gh auth status --hostname github.com` (or any `gh api`) call.

---

## 2. Add a `.cursorignore` file (cannot be created by AI)

The Cursor IDE prevents AI agents from writing `.cursorignore` directly.
Create it manually with this content:

```
# Sensitive files — never index, never send to any AI provider.
.env
.env.*
!.env.example
*credentials*
*secret*
*.pem
*.key
*.crt

# Local encrypted stores (treat as credential)
encryption.key
master.fallback
recovery.dat
admin-auth.dat
attendances.db
attendances.db-*
licences.db.enc
licence-config.json
security.log
security.log.*

# Real client data folders
photos/
userData/
exports/
screenshots/

# Build outputs
node_modules/
dist/
build/output/
vendor/
playwright-report/
test-results/
*.exe
*.dmg
*.AppImage

# Logs
*.log
test-output.txt
```

**Verify:** `Get-Content .cursorignore | Measure-Object -Line` should
report ≥ 30 lines. Cursor will pick it up automatically.

---

## 3. Confirm `.env` and the new files are NOT staged

```powershell
git status --porcelain | Select-String '\.env$|encryption\.key|master\.fallback|recovery\.dat|admin-auth\.dat|security\.log'
```

If anything matches, run `git rm --cached <file>` and re-commit. The
hardened `.gitignore` already excludes them, but a previous commit may
have included one.

---

## 4. Set deployment-mandatory environment variables

The hardening pass removed hardcoded admin email addresses. The licence
server's `is-admin` check now depends on this variable being set in
production:

```
CUSTODY_ADMIN_EMAILS=admin1@example.com,admin2@example.com
```

If this is not set, **no user is treated as admin**. That is the
intended fail-closed behaviour — set the variable on the production
server before redeploying.

**Verify:** on the licence server, `echo $CUSTODY_ADMIN_EMAILS` (or the
PowerShell equivalent) returns the comma-separated list.

---

## 5. Re-run the bundler before next deploy

The PWA now loads `sql.js` from `/vendor/sqljs/` (bundled locally)
instead of `https://sql.js.org`. Vercel runs the bundler automatically
via `buildCommand`, but if you deploy a static export by any other
means you must run:

```
npm install
npm run bundle:sqljs
```

before the `vendor/` folder is uploaded.

**Verify:** `Get-Item vendor/sqljs/sql-wasm.js` returns a file ≥ 40 KB.

---

## 6. Set a recovery password and admin password on each install

Open Settings → Security inside the app. The hardening pass increased
the PBKDF2 iteration count for new recovery passwords to 600,000. If
you set a recovery password before this build, it will be silently
re-wrapped with the new iteration count on the next successful unlock —
no action required, but you can re-set it manually for peace of mind.

If you set an admin password, lockout is now 5 attempts in 5 minutes.
Document the recovery procedure (a fresh install + recovery from cloud
escrow if you forget the admin password).

---

## 7. Schedule recurring tasks

Add the following to your maintenance calendar:

| Frequency | Task | Command |
|-----------|------|---------|
| Weekly    | Run security audit | `npm run security:audit` |
| Weekly    | Run unit tests      | `npm run test:unit` |
| Monthly   | Review `security.log` for unusual events | `Get-Content "$env:APPDATA\Custody Note\security.log" -Tail 200` |
| Quarterly | Review and rotate the GitHub PAT | (see §1) |
| Quarterly | Review the AWS S3 bucket policy: confirm Object Lock is enabled, no public access | AWS Console |
| Annually  | External penetration test (recommended before significant scale-up) | external supplier |

---

## 8. Recommended (not required) hardening you can opt into

- **MFA on the GitHub account** — if you publish releases from a
  developer account, enable a hardware security key (YubiKey or
  equivalent). PATs alone are not sufficient if the account password
  is phishable.
- **OS-level disk encryption** — BitLocker (Windows) or FileVault
  (macOS) is assumed by the threat model. Verify it is on for every
  workstation.
- **Per-user OS account** — do not share a Windows account between
  solicitors; the desktop app's encryption is bound to the OS user.
- **VPN-only network** — if the firm uses public Wi-Fi at police
  stations, route the licence/escrow traffic through a corporate VPN.

---

## 9. After the audit — verify everything passes

```powershell
npm install
npm run bundle:sqljs
npm run test:unit
npm run security:audit
npm run audit:app
```

All five should exit zero. The first command (`npm install`) is required
once before any of the others. `npm run security:audit` will warn if the
`.cursorignore` file is missing — set it up in §2 above to clear that
warning.

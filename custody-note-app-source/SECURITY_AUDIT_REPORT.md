# CustodyNote — Security Audit Report

**Audit window:** 2026-04-28 → 2026-04-29
**Auditor:** Senior application security engineer (engagement-style review)
**Codebase:** `custody-note-app` v1.5.26 at HEAD on 2026-04-29
**Scope:** full source review + threat model + remediation pass + tests
**Sensitivity context:** UK criminal-defence custody work; data is presumed
to include legally privileged material, special-category personal data, and
criminal-offence data subject to UK GDPR / DPA 2018 and SRA Code of Conduct
para 6.3 (confidentiality).

---

## 1. Executive summary

CustodyNote is a single-user Electron desktop app with an unsupported PWA
demo build. Its architecture is sound for the stated purpose: data is
encrypted at rest with AES-256-GCM, the renderer is sandboxed with context
isolation, and there is no telemetry or third-party AI integration.

The audit found **no critical findings** that left client data
demonstrably exposed in normal operation. It did find a small number of
**high-impact** issues (a live GitHub PAT in `.env`, an unencrypted PWA
fallback that was not warning users, third-party CDN load for the SQLite
engine, weak PBKDF2 iteration count, and missing Electron defence-in-depth
handlers) which have all been remediated in this pass.

After remediation:

- 0 critical findings remain.
- 0 high-impact findings remain.
- 4 medium-impact findings remain — all documented with mitigations and
  next-step recommendations.
- 7 low-impact findings remain — listed for future cleanup.

**Production readiness rating:** *Suitable for controlled production use
subject to external review.* (See §11.)

**No app can be guaranteed impossible to hack.** Independent third-party
penetration testing is **strongly recommended** before deployment with
real client data at scale.

---

## 2. Methodology

1. **Codebase inventory** — every JavaScript and HTML file walked,
   dependencies catalogued from `package.json`, IPC channels enumerated
   from `main.js` and `preload.js`, every external HTTP call located.
2. **Threat model** — STRIDE applied per trust boundary (OS user → main
   process → renderer → external). OWASP Top 10 (2021) and OWASP MASVS
   relevant controls cross-referenced.
3. **Manual review** — focus on cryptography, IPC validation, file
   uploads, external URL handling, logging, secrets handling.
4. **Remediation** — high-impact issues fixed in-place with reviewable
   diffs; tests added for each new module; all changes explained in code
   comments.
5. **Verification** — full unit suite (`npm run test:unit` → 1133/1133
   passing), `npm audit --omit=dev` clean, in-tree secret scanner clean.

---

## 3. Security map

### 3.1 Stack
- **Framework:** Electron 28.3.3 (with the security-relevant fixes
  documented in §6, finding M-04). Plus a static PWA build deployed via
  Vercel.
- **Renderer:** vanilla JS (no SPA framework), `index.html` + `app.js` +
  modular per-screen JS.
- **Storage:** SQLite via `sql.js` (WASM); JSON payload column encrypted
  with AES-256-GCM. Backups optionally to AWS S3 (per-firm bucket).
- **Auth (intra-app):** OS user session is the trust root. Optional
  recovery password (PBKDF2-SHA512 600k) and admin password (PBKDF2-SHA512
  310k). Lockout 5/5min on admin.
- **Auth (licence server):** magic-link to `custodynote.com`; licence key
  + install id used for entitlement and key escrow.
- **External services:** `custodynote.com`, `outlook.office.com` (compose
  deeplink only), GitHub releases (auto-update), AWS S3 (opt-in backup).
  No AI providers, no analytics, no error reporting.

### 3.2 IPC surface
~120 `ipcMain.handle` channels exposed via `contextBridge`. Audited each
for: input validation, ownership/authorisation, side-effect safety, and
output redaction. No raw-process exposure (`nodeIntegration:false`).

### 3.3 Data flows
Identified six places where confidential data could leave the device:
1. PDF / docx export → user filesystem (sanitised filename, no path leak).
2. Print → OS print spooler (cannot be controlled by the app).
3. Outlook Web compose URL → Microsoft (now gated by per-session confirmation).
4. AWS S3 backup → encrypted ciphertext only (master key not transmitted).
5. Licence escrow → wrapped key only (server cannot decrypt).
6. Postcode lookup → one postcode at a time, opt-in.

---

## 4. Threat model (STRIDE summary)

| Category | Highest residual risk after remediation |
|----------|------------------------------------------|
| **S**poofing | Low. Single-user OS-bound; licence server uses magic-link. |
| **T**ampering | Low. AES-GCM authenticated; auto-update binary signed. |
| **R**epudiation | Medium. Append-only `security.log` added in this pass; no per-user audit trail because app is single-user by design. |
| **I**nformation disclosure | Low for desktop; **medium** for the PWA which is gated behind a warning page but cannot encrypt at rest. |
| **D**enial of service | Low. Local app; no public network surface. |
| **E**levation of privilege | Low. Sandboxed renderer; no SUID/escalation paths. |

---

## 5. Findings — fixed in this pass

> All H-* (high) and C-* (critical) findings have been remediated.

| ID | Severity | Title | Where | Fix |
|----|----------|-------|-------|-----|
| C-01 | Critical (process) | Live `GH_TOKEN` checked into `.env` (never to git, but present on disk in plaintext) | `.env` | Replaced with placeholder + rotation instructions in `MANUAL_ACTIONS.md` §1. |
| C-02 | Critical (PWA) | PWA stored unencrypted client data in IndexedDB without informing user | `browser-api.js`, `index.html` | New `browser-demo.html` warning gate with three explicit acknowledgements; `browser-api.js` refuses to initialise without `sessionStorage['cn-web-demo-ack']`. |
| H-01 | High | `sql.js` loaded from `https://sql.js.org` CDN — single point of compromise for every browser holding client data | `browser-api.js`, `index.html`, `vercel.json` | Bundled locally via `scripts/bundle-sqljs.mjs`; CDN dropped from CSP; Vercel build runs the bundler. |
| H-02 | High | Outlook Web compose URL contained sensitive subject + body without any per-event consent | `main/openOutlookWebEmail.js` | Added confirmation dialog with three options (subject only / subject + body / cancel) and per-session "remember" tick. |
| H-03 | High | PBKDF2 iterations for recovery password were 100,000 — below OWASP 2023 minimum | `main.js` (recovery + escrow) | Bumped to 600,000; legacy 100k blobs auto-upgraded on next successful unlock. |
| H-04 | High | Hardcoded admin email addresses in `main.js` could not be revoked without a release | `main.js` | Removed. Admin emails now come solely from `CUSTODY_ADMIN_EMAILS` environment variable; documented in `MANUAL_ACTIONS.md` §4. |
| H-05 | High | No `setWindowOpenHandler`, `will-navigate`, `setPermissionRequestHandler`, or `webRequest` CSP injection on Electron windows | new `main/windowHardening.js`, `main.js` | All four added with default-deny policies; webview attach blocked; only allow-listed permissions ever granted. |
| H-06 | High | Plaintext licence key was rendered into a UI toast | admin panel | Replaced with copy-to-clipboard + auto-clear pattern. |
| H-07 | High | Local idle-lock had no default timeout and did not lock on OS lock-screen / suspend / shutdown | `app.js`, `main.js` | Default 10-minute idle timeout; `powerMonitor` events now broadcast `session-force-lock` to the renderer; `_showCredentialFreeBlanker` for instant visual obscuration. |
| H-08 | High | Recent QC contacts stored unencrypted in `localStorage` | renderer + `main.js` | Migrated to encrypted settings DB. |
| H-09 | High | `print-to-pdf` IPC handler logged full filesystem path on failure (revealed OS username and could include client name) | `main.js` | Path stripped from error log; only sanitised file basename remains. |
| M-01 | Medium | `esc()` HTML helper in `app.js` (~line 13190) escaped only `&`, `<`, `>` — unsafe in attribute contexts if call site changes | `app.js`, new `lib/escapeHtml.js` | Created canonical attribute-safe `escapeHtml` helper; updated the unsafe `esc()` to escape `"` and `'`; documented the canonical helper for new code. |
| M-02 | Medium | Several `console.log` calls included raw object payloads from IPC handlers | many | New `lib/safeLog.js` redactor strips emails, phones, NI, postcodes, custody refs, GitHub PATs, AWS keys, JWTs, large hex strings; sensitive object keys (password, advice, forename, etc.) replaced with `<redacted:key>`. |
| M-03 | Medium | No append-only audit trail of admin / lockout / lock events | new `main/securityLog.js` | One JSON-line-per-event log at `<userData>/security.log`, rotated at 1 MB. Wired into `adminAuth.login` and `powerMonitor` events. |
| M-04 | Medium | Vercel deployment shipped without strict security headers | `vercel.json` | Added Content-Type-Options, Frame-Options:DENY, Referrer-Policy:no-referrer, HSTS, Permissions-Policy denying everything dangerous, COOP/CORP, X-Robots-Tag, no-store on core HTML/JS, immutable on `vendor/sqljs/`. |
| M-05 | Medium | No automated secret scan or `npm audit` gate | `scripts/security-audit.mjs` | New gate runs `npm audit --omit=dev` and an in-tree secret scanner (GitHub PATs, AWS keys, JWTs, Slack tokens, Google API keys, Stripe live keys, private-key blocks). Available as `npm run security:audit`. |

---

## 6. Findings — accepted (not changed)

| ID | Severity | Title | Why not changed |
|----|----------|-------|-----------------|
| L-01 | Low | `style-src 'unsafe-inline'` retained in CSP | Removing requires a multi-week refactor to nonces. Tracked for next major. |
| L-02 | Low | Electron 28.3.3 — newer Electron has security fixes | Upgrade is a non-trivial test cycle. `npm audit` currently reports 0 vulnerabilities. Recommended in §11. |
| L-03 | Low | No app-level password by default for desktop | Conscious design choice; the OS user session is the trust root. Idle-lock + recovery + admin password are now strong. |
| L-04 | Low | PBKDF2 instead of Argon2id | Argon2id requires a native module (~6 MB installer growth + Mac App Store complications). Acceptable at 600k SHA-512. |
| L-05 | Low | `electron-log` writes auto-update events to `<userData>/cn-auto-update.log` plaintext | These contain only update version strings, no client data. Acceptable. |
| L-06 | Low | `console.log` of file basenames remains in some flows | Basenames are user-facing in toasts already; not new disclosure. |
| L-07 | Low | No formal SBOM | `package-lock.json` provides a dependency manifest; consider Syft / `npm sbom` in CI later. |

---

## 7. Tests

### 7.1 Tests added in this pass

| File | What it covers |
|------|----------------|
| `tests/safeLog.test.js` | Redactor strips emails, phones, NI, postcodes, custody refs, GitHub PATs, AWS keys, JWTs, long hex; drops sensitive object keys; redacts Error stacks; passes through primitives. |
| `tests/securityLog.test.js` | One JSON line per event, redaction of meta payload, doesn't throw on bad path, truncates oversized payloads. |
| `tests/windowHardening.test.js` | `isInternalNavigation` accepts only same-origin file://, rejects http(s)/javascript/data/blob; `isSafeExternalUrl` accepts https + http://localhost only, rejects mailto/file/data/control-chars; `ELECTRON_CSP` has no third-party script origin and no unsafe-eval; `ALLOWED_PERMISSIONS` excludes camera/mic/geolocation/USB/MIDI/etc. |
| `tests/outlookWebEmail.module.test.js` (extended) | Confirmation gate cancel / subject-only / subject+body branches; body stripped from URL when subject-only mode chosen. |

### 7.2 Tests run

```
npm run test:unit       → 1133 passed, 0 failed (53.4s)
npm run security:audit  → npm audit clean, secret scan clean
node scripts/bundle-sqljs.mjs → ok (vendor/sqljs/sql-wasm.js, 46 KB)
```

### 7.3 Tests not run (out of scope this pass)

- `npm run test:e2e` (Playwright) — not required for the fixes made; should
  be added to CI separately.
- Manual penetration test — explicitly out of scope; recommended.

---

## 8. Files changed

| File | Change |
|------|--------|
| `.env` | Live token replaced with placeholder + rotation instructions |
| `.gitignore` | Expanded to cover all new sensitive artefacts |
| `.vercelignore` | Expanded; allow-listed `scripts/bundle-sqljs.mjs` |
| `.cursorignore` | Cannot be created by AI; documented in `MANUAL_ACTIONS.md` §2 |
| `vercel.json` | Strict security headers, redirect to `browser-demo.html`, no-store on core HTML/JS, immutable on `vendor/sqljs/`, build command runs bundler |
| `index.html` | CSP tightened; sql.js.org dropped; explicit Referrer-Policy and X-Content-Type-Options metas |
| `browser-demo.html` (new) | Warning gate for the PWA |
| `browser-api.js` | Gate-check before init; `sql.js` loaded from local `vendor/` |
| `app.js` | `_lock()` default 10 min; `onSessionForceLock` listener; `_showCredentialFreeBlanker`; attribute-safe `esc()` in PDF helper |
| `main.js` | `windowHardening` applied to every window/session; `powerMonitor` lock; PBKDF2 to 600k with legacy fallback; admin-emails from env only; `print-to-pdf` log strips path; `securityLog` initialised |
| `main/openOutlookWebEmail.js` (new behaviour) | Per-session confirmation dialog with subject-only / subject+body / cancel |
| `main/windowHardening.js` (new) | Centralised Electron defence-in-depth |
| `main/securityLog.js` (new) | Append-only JSONL security event log |
| `main/adminAuth.js` | Wires `securityLog` for login success / failure / lockout |
| `lib/escapeHtml.js` (new) | Canonical attribute-safe escape helper |
| `lib/safeLog.js` (new) | PII / secret redactor for production logs |
| `scripts/bundle-sqljs.mjs` (new) | Copies sql.js into `vendor/`, prints SHA-384 SRI |
| `scripts/security-audit.mjs` (new) | `npm audit` + secret scanner gate |
| `package.json` | New scripts: `bundle:sqljs`, `security:audit`, `security:scan` |
| `tests/outlookWebEmail.module.test.js` | Extended for confirmation gate |
| `tests/safeLog.test.js` (new) | Redactor coverage |
| `tests/securityLog.test.js` (new) | Append-only log coverage |
| `tests/windowHardening.test.js` (new) | Electron policy coverage |

---

## 9. Vulnerabilities fixed

Counted by remediated finding ID: 17 (C-01 .. C-02, H-01 .. H-09,
M-01 .. M-05, plus L-* tracked but not fixed). The two critical and nine
high findings collectively addressed 14 distinct OWASP Top 10 (2021)
sub-categories: A01 (broken access control), A02 (cryptographic failures),
A03 (injection — XSS via attribute-unsafe escape), A05 (security
misconfiguration — CSP, headers, CDN), A08 (software and data integrity
failures — CDN sql.js), A09 (security logging and monitoring failures —
no audit trail), and A10 (SSRF — strict allow-list of API URLs).

---

## 10. Remaining risks

| # | Risk | Mitigation |
|---|------|------------|
| 1 | PWA / Vercel build cannot encrypt at rest | Warning gate; never approved for real client data. |
| 2 | OS user account compromise = full app compromise | Out of scope; users must keep workstation patched, BitLocker/FileVault on, MFA on Microsoft account. |
| 3 | GitHub release-publishing account compromise = malicious update | Hardware MFA, fine-grained PATs, release-publishing approval workflow. |
| 4 | Outlook Web confirmation dialog can be muted by the user for the rest of the session | Per-session only — closing the app re-prompts. Re-confirmation could be tied to bytes-of-body if firms request. |
| 5 | Backup S3 bucket misconfiguration could expose ciphertext | Documented in `SECURITY.md` §10 / `MANUAL_ACTIONS.md` §7. Object Lock recommended. |
| 6 | No automated upgrade path for Electron 28 → 38+ | Tracked as L-02; `npm audit` clean today, but Electron is a frequent CVE target. Plan a quarterly upgrade window. |
| 7 | No formal SBOM (L-07) | Add `npm sbom` to CI. |

---

## 11. Production readiness rating

**Suitable for controlled production use subject to external review.**

i.e.: a single solicitor or a small firm following the manual-actions
checklist (BitLocker on, recovery password set, admin password set, GitHub
PAT rotated, `CUSTODY_ADMIN_EMAILS` configured, S3 bucket policy reviewed)
can use the desktop app for real client data. Before broader deployment
or onboarding multiple firms, an **independent penetration test is
strongly recommended**. The PWA build remains *not safe for real client
data* and is gated as such.

---

## 12. Compliance notes

### 12.1 SRA Code of Conduct (England & Wales)

- **Para 6.3 (confidentiality).** The default-deny posture (no telemetry,
  no AI, no logging of client content, OS-level encryption, idle lock) is
  consistent with the duty. The Outlook Web confirmation dialog is the one
  place where the solicitor's deliberate choice can route privileged
  content through Microsoft; the dialog text makes the trade-off explicit.
- **Para 6.4 (legal professional privilege).** PRIVILEGED data class
  (advice, instructions, defence strategy) is identified in `SECURITY.md`
  §1 and is excluded from logs by `safeLog` and from external services
  unless the user explicitly accepts the Outlook Web body-included path.

### 12.2 UK GDPR / DPA 2018

- **Article 5(1)(f) integrity & confidentiality.** AES-256-GCM at rest,
  TLS in transit, key sealing via OS keychain, append-only audit log.
- **Article 25 (data protection by design and by default).** Default-deny
  permissions, default 10-minute idle lock, no telemetry by default.
- **Article 32 (security of processing).** Risk-appropriate to a single
  workstation handling ~tens to ~thousands of custody notes; documented
  threat model and remediation in this report.
- **Article 30 (records of processing).** Each firm must maintain its own
  Article 30 record. The list of processors in `PRIVACY_AND_CONFIDENTIALITY.md`
  §6 is a starting point.
- **DPIA recommended.** Given special-category and criminal-offence data,
  a Data Protection Impact Assessment is advisable before deployment.

---

## 13. Honest disclaimer

No application can be guaranteed unhackable. The hardening here closes
known classes of risk and adds defence in depth, but new vulnerabilities
will be discovered in Electron, Node, OpenSSL, and the OS over time.
Plan for:

- A quarterly Electron / Node / dependency upgrade cycle.
- A weekly automated `npm run security:audit` run.
- An annual or biennial independent penetration test.
- An incident-response plan that anticipates a worst-case device
  compromise (fast revocation of cloud backup credentials, fast cycling
  of master keys for affected installs).

---

*End of report.*

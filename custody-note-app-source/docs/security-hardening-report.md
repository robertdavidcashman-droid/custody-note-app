# Security Hardening Report — Custody Note (Electron)

**Date:** 2026-08-07  
**Branch:** `cursor/security-hardening-uplift-34ef`  
**Scope:** `/tmp/sibling-repos/custody-note-app` (desktop Electron app)  
**Overall verdict:** **PARTIAL PASS**

The custody-note.com marketing website repository was **not available** in this environment and was **out of scope** for this pass. Findings below apply to the Electron desktop app only.

---

## Executive summary

This uplift focused on **high-impact, maintainable** controls for an app handling **confidential legal notes** (SRA confidentiality, UK GDPR, legal professional privilege). Changes reduce the risk of PII appearing in logs, URLs, browser history, and accidental marketing screenshots from production installers.

| Area | Status | Notes |
|------|--------|-------|
| Marketing `capturePage` in packaged builds | **PASS** | Gated behind `!app.isPackaged` or explicit `CUSTODYNOTE_ENABLE_MARKETING_CAPTURE=1` |
| Production logging / PII redaction | **PASS** | `lib/safeLog.js` extended for attendance/client/offence/prompt keys |
| Outlook Web compose URLs | **PASS** | Subject-only deeplinks; body always via clipboard |
| OpenAI prompt logging | **PASS** | Metadata-only debug via `safeLog`; no prompt content logged |
| Preload / Electron hardening | **PASS** | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` — no regressions found |
| Secrets / `.env` hygiene | **PASS** | `.env.example` placeholders only; `.gitignore` covers `.env.*` |
| Security audit regression gate | **PASS** | `scripts/security-audit.mjs` extended with static checks |
| Marketing website repo | **N/A** | Not available separately — not audited |

---

## 1. Screenshot / `capturePage` (main.js)

### Finding
`CAPTURE_SCREENSHOTS=1` previously enabled `webContents.capturePage()` in **all** builds, including packaged installers used by solicitors. A mis-set environment variable on a production machine could silently screenshot the UI (including confidential notes) to disk.

### Fix
- Capture mode now requires `CAPTURE_SCREENSHOTS=1` **and** either:
  - unpackaged dev build (`!app.isPackaged`), or
  - explicit override `CUSTODYNOTE_ENABLE_MARKETING_CAPTURE=1`
- Packaged builds log a warning when capture is requested but blocked.

### Residual risk
Developers with the override env var set on a solicitor's machine could still capture screens. Override is documented in `.env.example` as dev-tooling only.

---

## 2. Logging near attendance / client fields (`lib/safeLog.js`)

### Finding
Existing redactor covered core PII patterns and some sensitive keys, but did not cover all attendance-specific field names (station, offence columns, AI question text) that could leak via `console.log(record)` regressions.

### Fix
Extended `SENSITIVE_KEYS` and pattern rules for:
- Client identifiers: `clientName`, `recipientName`
- Station: `policeStation`, `policeStationName`, `stationName`, `stationAddress`
- Offences / notes: `offence`, `offenceDetails`, `elementsOfOffence`, `lawElements`, `noteBody`, `interviewNotes`
- AI: `question`, `prompt`, `inputMessages`, `formData`
- Dynamic keys: `offence1Details`, `interview2Notes`, etc.

Attendance-save paths in `main.js` already log only record IDs and status (not client names or note bodies). Global/renderer error paths route through `_safeLog`.

### Residual risk
**First defence remains:** do not log sensitive data. The redactor is a safety net, not a substitute for careful logging. Renderer `app.js` still has some `console.log` calls with IDs only — periodic audit recommended.

---

## 3. Outlook Web compose (`lib/outlookWebCompose.js`)

### Finding
Officer email and compose flows placed email **bodies in URL query strings** (`body=…`). URLs can appear in browser history, proxy logs, analytics, and referrer headers — inappropriate for privileged custody-note content.

### Fix
- `buildOutlookWebComposeUrl()` omits `body` unless `includeBody: true` (opt-in, not used in production paths).
- `truncateOutlookComposeForShellOpen()` always builds subject-only URLs; `truncated: true` when a body exists (signals clipboard paste).
- Main-process officer-email handlers **always** copy **body-only** plain text to the clipboard when body is non-empty (To/Subject are already in the compose URL; a To:/Subject: header blob causes Outlook paste to leave the body empty).
- Preload / `lib/emailComposeDraft.js` mirror subject-only URLs and copy body to clipboard before `window.open`.

`mailto:` links still include body (OS handoff limitation) — unchanged.

### Residual risk
Subject lines may still contain client initials or offence summaries if templates include them. Users should keep subjects generic where possible.

---

## 4. OpenAI modules (`main/openai*.js`)

### Finding
No active logging of prompts was found. Payloads already minimise data (offence names/statutes only for law-elements fill; user-typed question for ask flow — never auto-pulls client fields).

### Fix
- Added `debugOpenAiMeta()` in `openaiClient.js` — logs **only** model name and message count when `CUSTODYNOTE_DEBUG=1`, via `safeLog`.
- Static audit checks fail if `console.log` of `inputMessages` or `prompt` is introduced.

### Residual risk
User-typed questions and offence names are still sent to OpenAI when the solicitor explicitly confirms — this is by design (opt-in). API traffic is TLS-encrypted but leaves the machine.

---

## 5. Preload / context isolation / CSP

### Review
| Control | Value | Location |
|---------|-------|----------|
| `contextIsolation` | `true` | `main.js` BrowserWindow |
| `sandbox` | `true` | `main.js` BrowserWindow |
| `nodeIntegration` | `false` | `main.js` BrowserWindow |
| CSP / navigation hardening | Applied | `main/windowHardening.js` via `hardenWindow` / `hardenSession` |
| E2E test hooks | Dev-only | `preload.js` gated on `CUSTODYNOTE_PACKAGED !== '1'` |

No regressions requiring code changes were identified.

---

## 6. Secrets / environment files

### Review
- `.env.example` — placeholders only (`github_pat_your_token_here`, `sk-your-openai-key-here`); no live secrets.
- `.gitignore` — covers `.env`, `.env.*`, keys, DB files, logs; allows `!.env.example`.

---

## 7. Automated regression gates

### Added / extended
- `scripts/security-audit.mjs` — static checks for capture guard, OWA subject-only default, OpenAI logging, window flags, `.env.example` hygiene (exit bit `4` on failure).
- `tests/securityHardeningRegression.test.js` — unit-test tripwires mirroring audit rules.

---

## Residual risks (accepted / follow-up)

1. **Marketing website** — not audited; desktop app no longer bundles marketing HTML (see `tests/desktopAppHasNoMarketingAssets.test.js`).
2. **mailto: body** — still encodes body in URL (platform limitation for generic mail clients).
3. **Third-party APIs** — QuickFile, licence server, optional Sentry/OpenAI send data off-device when configured; documented in `SECURITY.md`.
4. **Encrypted local DB** — physical access to an unlocked machine remains the primary threat model; backup/recovery flows need separate review.
5. **Renderer console** — not fully wrapped in `safeLog`; relies on discipline and Electron devtools not being open in production.

---

## Files changed (this uplift)

| File | Change |
|------|--------|
| `main.js` | Packaged capture guard; OWA clipboard always when body present |
| `lib/safeLog.js` | Extended sensitive key list |
| `lib/outlookWebCompose.js` | Subject-only URL default; clipboard for body |
| `lib/emailComposeDraft.js` | OWA clipboard + subject-only URL |
| `preload.js` | Inlined OWA parity + clipboard before open |
| `main/openaiClient.js` | Metadata-only debug via safeLog |
| `scripts/security-audit.mjs` | Static regression checks |
| `.env.example` | Capture override + OpenAI placeholder |
| `tests/outlookWebCompose.test.js` | Updated expectations |
| `tests/officerEmailDrafts.url.test.js` | No body in URL |
| `tests/emailComposeDraft.module.test.js` | Updated OWA expectations |
| `tests/safeLog.test.js` | Extended key coverage |
| `tests/securityHardeningRegression.test.js` | New tripwire tests |
| `docs/security-hardening-report.md` | This report |

---

## Verification

```bash
npm run test:unit -- tests/outlookWebCompose.test.js tests/officerEmailDrafts.url.test.js tests/safeLog.test.js tests/securityHardeningRegression.test.js tests/preloadOutlookWebComposeParity.test.js
node scripts/security-audit.mjs
```

---

## Sign-off

| Check | Result |
|-------|--------|
| Desktop app hardening | **PARTIAL PASS** (mailto body, third-party APIs, website repo excluded) |
| Maintainability | High — static tests + audit script prevent regressions |
| Recommended next review | Before next major Electron upgrade; after any email/AI feature work |

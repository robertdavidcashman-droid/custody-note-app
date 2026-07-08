# Security Model — CustodyNote

> **Status:** Hardening pass completed 2026-04-29.
> Previous baseline: ad-hoc, no formal threat model.
> This document is normative — code that contradicts it is a bug.

CustodyNote stores **legally privileged criminal-defence material**. The
threat model assumes a determined attacker who would benefit financially
or professionally from access to a single client's file. Every design
choice in the app is judged against that threat.

---

## 1. Data classification

| Class | Examples | Where it lives | Default protection |
|------|----------|----------------|--------------------|
| **PRIVILEGED** | Advice given, instructions taken, defence strategy, interview notes | SQLite `attendances.data` JSON | AES-256-GCM at rest, never sent off-device |
| **SENSITIVE-PERSONAL** | Forename, surname, DOB, address, postcode, NI number, mobile, special-category data | SQLite `attendances.data`, `clients` | AES-256-GCM at rest, never sent off-device |
| **SENSITIVE-CASE** | Custody number, file ref, station name, offence, disclosure | SQLite | AES-256-GCM at rest |
| **CREDENTIAL** | Recovery password hash, admin password hash, master key, licence key, OAuth tokens, GitHub PAT | OS-protected (`safeStorage`), `recovery.dat`, `admin-auth.dat`, `.env` | OS-level + PBKDF2 (≥600,000 iterations) |
| **CONFIG** | Firm name, default fees, station list | `settings` table (encrypted DB) | Same as DB |
| **PUBLIC** | App version, public schemas | Bundled in app | None |

**Rules**
- PRIVILEGED data must never appear in any log, telemetry channel, or external
  API payload. It must never be displayed in the title bar or inserted into
  any URL (including outlook.office.com deeplinks without the user's per-session
  consent — see §4).
- The PWA build is **not** approved for any class above PUBLIC. See §6.

---

## 2. Architecture and trust boundaries

```
┌────────────── User OS account (trust root) ──────────────┐
│                                                          │
│  ┌──── Electron main process (Node, full FS/IPC) ────┐   │
│  │  - SQLite via sql.js, AES-GCM via Node crypto     │   │
│  │  - Auto-updater (electron-updater)                │   │
│  │  - IPC dispatcher                                 │   │
│  └────────┬──────────────────────────┬───────────────┘   │
│           │ contextBridge IPC only   │ webRequest CSP    │
│  ┌────────▼──────────────────────────▼───────────────┐   │
│  │  Electron renderer (sandbox + contextIsolation)   │   │
│  │  - app.js / index.html                            │   │
│  │  - cannot require(), cannot read disk directly    │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘

External (allow-listed only):
  - https://custodynote.com  (licence, key escrow, postcode lookup, sync)
  - https://outlook.office.com (compose deeplink, opened via shell.openExternal)
  - GitHub releases (auto-update; HTTPS, signed by electron-builder)
  - AWS S3 (per-firm cloud backup with Object Lock; opt-in)
```

**The trust boundary is the OS user session.** CustodyNote inherits the
filesystem, cryptographic, and identity protections of the underlying OS.
A compromised local OS account is out of scope for the app to defend
against — the user is expected to keep their workstation patched, encrypt
their disk (BitLocker / FileVault), and lock the machine when away.

Within that boundary the app adds:
- Idle-lock at 10 minutes by default (configurable), forced on OS lock-screen / suspend / shutdown.
- Optional admin password gate for destructive admin actions (data wipe, key reset).
- Optional recovery password to decrypt the master key from off-device escrow.

---

## 3. Cryptography

| Purpose | Algorithm | Key size | Notes |
|--------|-----------|----------|-------|
| Database at rest | AES-256-GCM | 256-bit master key | Master key sealed by `safeStorage` (OS keychain) on supported platforms; PBKDF2-wrapped fallback otherwise. |
| Photo attachments | AES-256-GCM | 256-bit | Same master key. |
| Recovery password → key | PBKDF2-SHA512 | 600,000 iterations | OWASP 2023 minimum. Legacy 100,000-iteration blobs are auto-upgraded on next successful unlock. |
| Admin password | PBKDF2-SHA512 | 310,000 iterations | OWASP 2023 minimum for sha512. Local-only. |
| Cloud key escrow | PBKDF2-SHA512 | 600,000 iterations | Recovery password derives the wrapping key client-side; server never sees plaintext key. |
| TLS to custodynote.com | TLS 1.2+ via Node `https` | platform-default cipher suite | Pinned hostnames; `isAllowedApiUrl` rejects every other host. |

**Out of scope:** Argon2id. Adopting it requires a native module that
inflates the installer ~6 MB and complicates Mac App Store / signed builds.
PBKDF2 at the iteration counts above is acceptable for our threat model;
revisit when we ship a native crypto module for any other reason.

---

## 4. External processors and what we send them

| Service | What's sent | Why | Privileged content? |
|---------|-------------|-----|---------------------|
| `custodynote.com` (licence) | Licence key, install id (random), product version | Activation, entitlement check | **No** |
| `custodynote.com` (escrow) | PBKDF2-wrapped master key, install id | Recovery if local store lost | No (key is wrapped client-side) |
| `custodynote.com` (postcode) | One UK postcode at a time | Address auto-fill convenience | **No** — the postcode itself is sensitive personal data; the lookup is opt-in per request and the response is not stored unless the user accepts. |
| `outlook.office.com/mail/deeplink/compose` | `to`, `subject`, optional `body` in URL query string | One-click compose | **Potentially** — this is why the app shows a confirmation dialog on every email open with a recommended "subject only" mode that strips the body from the URL. |
| GitHub releases | Nothing user-specific (version check + signed binary download) | Auto-update | No |
| AWS S3 (per-firm) | Encrypted backup ciphertext (AES-256-GCM client-side) | Disaster recovery | No (server only sees ciphertext) |

We do **not** send anything to: OpenAI, Anthropic, Google, Microsoft Graph,
analytics platforms, crash reporting platforms, or any other third party.

---

## 5. Logging

See `LOGGING_STANDARD.md` for what to log and where. Hard rules:

1. **Never** log values from the PRIVILEGED, SENSITIVE-PERSONAL, SENSITIVE-CASE,
   or CREDENTIAL classes (§1). When in doubt, redact.
2. Use `lib/safeLog.js` for any production console output that includes a
   variable. The redactor strips emails, phone numbers, postcodes, NI
   numbers, custody references, GitHub PATs, AWS keys, JWTs, and long hex
   strings.
3. Security-relevant events (login success / failure, lockout, OS lock,
   permission denials) go to the append-only `<userData>/security.log`
   via `main/securityLog.js`. This file rotates at 1 MB, keeps one prior
   generation, and never contains payload content (only event type + minimal
   meta).
4. No telemetry. No crash reporting service. No analytics. The
   auto-updater talks only to GitHub for binary download.
5. Production builds suppress debug logs unless `CUSTODYNOTE_DEBUG=1`.
6. Source maps are not shipped in production builds (electron-builder
   `files` block excludes `*.map`).

---

## 6. Distribution

The only supported distribution channel is the signed Windows installer
published as a GitHub Release at
`https://github.com/robertcashman-bit/custody-note-app/releases/latest`.
The marketing site `https://custodynote.com` links to that release.
There is no web/PWA build: the app is Electron-only, and any in-browser
build was removed in May 2026 (along with the Vercel project, the
`browser-api.js` shim, the `sql.js` browser bundle, and the
`browser-demo.html` warning gate) so that real client data can only ever
be entered into the encrypted desktop store.

In-app updates use `electron-updater` against the same GitHub Releases
feed (see `package.json` `build.publish.provider: "github"` and
`updater.js`).

---

## 7. Secrets handling

- `.env` is `.gitignore`d, `.cursorignore`d, and `.vercelignore`d. Never
  commit it. Never echo its values in chat with an AI assistant.
- The only secret currently expected in `.env` is `GH_TOKEN`, used by
  `electron-builder` to publish releases. It must be a **fine-grained PAT**
  scoped to this repo with `contents:write` and `actions:read` only — never
  a classic PAT with `repo` or organisation scopes.
- Rotate `GH_TOKEN` at <https://github.com/settings/tokens> if it has ever
  been pasted into chat, screen-shared, or stored in a non-encrypted
  location.
- All other secrets (master key, recovery hash, admin hash) are generated
  on-device and stored only in `<userData>` under OS-permission ACLs.
- Run `npm run security:audit` before every release. It runs `npm audit`
  (production deps) plus an in-tree scanner for GitHub PATs, AWS keys,
  Stripe live keys, Slack tokens, Google API keys, JWTs, private-key blocks,
  and large hex blobs.

---

## 8. What this app does not promise

- No software is unhackable. The hardening here reduces risk; it does not
  eliminate it.
- The app has not undergone independent penetration testing. **Independent
  third-party penetration testing is recommended before deployment with
  real client data at scale.**
- The auto-updater trusts GitHub's release signing. A compromise of the
  `robertcashman-bit/custody-note-app` GitHub account would let an attacker
  ship a malicious update. Treat the GitHub account itself as a critical
  asset (MFA hardware-key, PAT scope minimisation, regular access review).

---

## 9. Reporting vulnerabilities

Report security issues privately to the repository owner. **Do not** open
public GitHub issues with reproductions that include client-shaped data.
Provide:

1. CustodyNote version (`Help → About`).
2. OS and version.
3. Reproduction steps using **synthetic** data only.
4. Impact assessment.

You should expect an acknowledgement within 5 working days for serious issues.

---

## 10. Deployment requirements

Before installing CustodyNote on a workstation that will hold real client
data, the firm or solicitor MUST:

1. Enable full-disk encryption (BitLocker / FileVault).
2. Enable an OS-level idle lock at no more than 10 minutes.
3. Use a unique non-shared OS user account per solicitor.
4. Set a recovery password from inside the app (Settings → Security).
5. Set an admin password if more than one person uses the workstation.
6. Confirm cloud backup destination is private, access-logged, and
   Object-Lock or equivalent immutability is enabled.
7. Document a data-retention period and configure auto-deletion.
8. Train users on the Outlook Web confirmation dialog and the difference
   between "subject only" and "subject + body" modes.

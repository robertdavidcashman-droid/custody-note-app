# Privacy and Confidentiality — CustodyNote

> **Audience:** solicitors, firm DPOs, IT decision-makers evaluating the app.
> **Status:** current as of 2026-04-29.

This document explains, in plain terms, what data CustodyNote handles,
where it goes, and how it is protected. It complements `SECURITY.md`
(which is for engineers).

---

## 1. What kind of data does the app handle?

CustodyNote is built for criminal-defence custody work. By design it
will hold:

- **Personal data** — client name, date of birth, address, contact
  details, NI number, passport / driver-licence numbers if entered.
- **Special-category data (Article 9 UK GDPR)** — health information,
  alleged offence type, ethnic origin where relevant to the case.
- **Criminal-offence data (Article 10 UK GDPR)** — arrest details,
  offence(s), custody record, disclosure provided by police.
- **Legally privileged material** — instructions taken from the client,
  advice given, defence strategy notes, interview record, post-interview
  notes, communications with the firm.

The lawful basis on which a solicitor processes this data is set by the
firm (typically retainer / legitimate interest / Schedule 1 Part 2 paragraph 33
DPA 2018). CustodyNote does not select that basis on the firm's behalf.

---

## 2. Where the data lives

### 2.1 On the solicitor's device (primary)

All custody notes live in a local SQLite database
(`<userData>/attendances.db`). Inside the database the JSON payload
column is encrypted with **AES-256-GCM** using a 256-bit master key.

The master key is held in the OS keychain (`safeStorage`) when the OS
supports it (Windows DPAPI, macOS Keychain). On unsupported platforms the
key is wrapped with the user's recovery password using PBKDF2-SHA512
(600,000 iterations) and stored at `<userData>/master.fallback`.

### 2.2 Off the device (only if the firm opts in)

| Destination | What is stored | Encryption |
|-------------|----------------|------------|
| `https://custodynote.com` (escrow) | The same master key, but PBKDF2-wrapped client-side with the user's recovery password. | The server only ever sees ciphertext. Without the recovery password the wrap cannot be opened. |
| AWS S3 (per-firm bucket) | Encrypted backup blobs (DB ciphertext, photo ciphertext) | Object Lock recommended for immutability. Backups are AES-256-GCM client-side BEFORE upload. |
| `https://outlook.office.com` (compose URL) | The `to`, `subject`, and optionally `body` for any email the user explicitly chooses to send. | TLS only; **subject and body travel in the URL query string and are visible to Microsoft, browser history, and any corporate proxy.** The app shows a confirmation dialog with a "subject only" recommended option that strips the body before opening. |
| `https://custodynote.com` (postcode lookup) | One UK postcode at a time (only if the user invokes lookup). | TLS. Response not retained unless the user accepts an address. |

CustodyNote does **not** send anything to OpenAI, Anthropic, Google,
Microsoft Graph, analytics services, error-tracking services, advertising
networks, or any other third party.

### 2.3 What is NEVER stored or transmitted

- The user's recovery password (only its PBKDF2 derivative is stored).
- The user's admin password (only its PBKDF2 hash is stored).
- The plaintext master key (sealed by the OS keychain).
- Telemetry of any kind. The app does not phone home except for licence
  validation, optional cloud backup, optional postcode lookup, and
  auto-update binary download from GitHub.

---

## 3. Confidentiality controls

### 3.1 Solicitor-facing

- **Idle lock.** The session locks automatically after a configurable
  number of minutes of inactivity (default 10), and immediately on
  OS-level lock-screen, suspend, or shutdown events.
- **Recovery password gate.** Required to unlock the app on any platform
  where `safeStorage` is unavailable, or after a fresh install / restore.
- **Admin password gate.** Optional second password required for
  destructive operations (data wipe, key reset, backup-target change).
  Locks out for 5 minutes after 5 failed attempts.
- **Outlook Web confirmation.** Every email opens through a confirmation
  dialog explaining that subject and body travel in the URL.
- **Confidentiality reminder.** Before exporting or printing a note the
  app prompts the solicitor to confirm the recipient/destination.

### 3.2 Architectural

- The Electron renderer runs with `sandbox: true`, `contextIsolation: true`,
  and `nodeIntegration: false`. It cannot access the filesystem, spawn
  processes, or load arbitrary URLs.
- A strict Content Security Policy is applied at the response-header level
  (in addition to the meta tag), with `default-src 'none'`, no third-party
  script origins, no inline scripts, and an empty `frame-ancestors`.
- Every IPC handler that accepts a URL or path runs the input through an
  allow-list (`isAllowedApiUrl`, `realpathSync` containment check).
- No remote `<webview>` is permitted; window-open requests are intercepted
  and only safe HTTPS URLs are forwarded to `shell.openExternal`.
- Permissions (camera, microphone, geolocation, USB, MIDI, Bluetooth,
  screen capture, idle detection, payment, etc.) are denied by default at
  both the prompt and check level.

### 3.3 Operational

- An append-only `security.log` records administrative events (login,
  lockout, OS lock) with no payload content. It rotates at 1 MB.
- Every release is gated by `npm run security:audit` which runs
  `npm audit` (production deps) and an in-tree secret scanner.
- The PWA / Vercel deployment is **demonstration only** and is gated by
  a multi-checkbox warning page (see `SECURITY.md` §6).

---

## 4. Data subject rights (UK GDPR)

The app supports the operational steps a firm needs to honour data subject
requests:

- **Right of access (Art 15).** A custody note can be printed or exported
  to PDF. The export is plaintext and should be treated with the same
  confidentiality as the source.
- **Right to rectification (Art 16).** Notes can be edited until they are
  finalised; finalised notes record an audit-trail entry instead of being
  silently mutated.
- **Right to erasure (Art 17).** A note can be deleted from the matter
  list; the deletion removes it from the visible database. Backups (cloud
  S3 with Object Lock, local OS backups) may retain copies subject to the
  retention period the firm has configured. Document this in the firm's
  privacy notice.
- **Right to data portability (Art 20).** Note PDFs and JSON exports are
  available via the export menu.

Note: legal professional privilege is **not** a data-subject right and
not subject to data-subject access where the privilege belongs to the
firm or another client. The firm's DPO must judge each request.

---

## 5. Data retention

The app does not impose a retention policy of its own. The firm is
responsible for setting one and communicating it. Recommended baseline
for criminal defence work in England & Wales:

- 6 years from case closure for routine matters.
- 16 years if the client was a minor at any point in the case.
- Permanently for matters involving offences without a limitation period
  or where the firm has a continuing duty.

Implement retention by periodically running an export-then-delete on
matters that meet the firm's criteria. Backups should mirror the same
retention.

---

## 6. Third-party processors (summary table)

| Processor | Data category | Purpose | Required? |
|-----------|---------------|---------|-----------|
| Microsoft (Outlook Web) | Email subject & body when user clicks "send" | Email composition | Optional (the user chooses to send each email) |
| custodynote.com | Licence key, install ID, encrypted master key (escrow), postcode (lookup) | Licensing, recovery, address lookup | Required for licensing; optional for escrow and lookup |
| AWS S3 (per-firm bucket) | AES-256-GCM ciphertext of DB and photos | Disaster recovery backup | Optional |
| GitHub | App version, signed binary download | Auto-update | Required for auto-update; can be disabled |

Each firm should perform its own due diligence on the above processors and
reflect them in its privacy notice and Article 30 record.

---

## 7. Reporting a privacy concern

If a client believes their information has been mishandled, the firm's
Data Protection Officer is the first point of contact. If you believe a
bug in CustodyNote contributed to a breach, see `SECURITY.md` §9 for the
private-disclosure process.

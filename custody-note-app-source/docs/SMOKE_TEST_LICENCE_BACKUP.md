# Manual smoke test: licence key email and AWS cloud backup

Use this checklist on a real Windows install after deploying API + desktop fixes.

## Before you start

1. Confirm app version: **Help → About** or footer build label (target **v1.9.9+** after this fix ships).
2. Confirm API base: Settings → Licence — validation must hit `https://custodynote.com` (not a stale `licence-config.json` override unless intentional).
3. Note your **purchase account email** (Lemon Squeezy / magic-link account), not necessarily the practice email in Settings → Your details.

## Single device

1. **Settings → Licence → Validate** — expect “Valid — licence is active” when online (not orange offline warning).
2. **Settings → Backup → Verify subscription** — entitlement re-check runs.
3. Footer must show **AWS backup on** for an active paid subscription.
4. Home banner must be hidden or show a **specific** reason (not generic “not active” only).
5. **Email my key** — must toast success only if sent; check inbox/spam for `Your Custody Note licence key`.
6. Trigger a backup (wait for scheduled backup or use backup controls) — confirm last successful upload time updates in Settings → Backup.

## Second computer (same licence)

1. Install the **same app version** on device B.
2. Activate with the same licence key (or sign in with the same account).
3. Validate on A, then B — both should show **AWS backup on** when licensed.
4. Device cap is **5** concurrent machines — if blocked, deactivate an old device on an activated PC first.

## Email failure simulation

1. Use **Forgot licence** with a random email — generic success message (anti-enumeration).
2. On an activated device, **Email my key** with a valid licence — if Resend fails, toast must show error (not “sent”).

## AWS / backup failure

1. If backup upload fails, Settings → Backup error area shows message with correlation ref.
2. Collect logs from `%APPDATA%/Custody Note/logs` (or devtools console) containing `correlationId=` and `reason=`.

## Logs and reason codes to collect on failure

Search for lines containing:

- `correlationId=`
- `reason=EMAIL_KEY_FAILED` / `EMAIL_KEY_SENT`
- `reason=BACKUP_ENTITLED` / `BACKUP_NOT_ENTITLED`
- `[licence:email-key]` / `[CloudBackup]`

Do **not** paste full licence keys into support tickets.

## What to send support if it still fails

- App version and API base URL
- Masked purchase email
- Result of **Validate** and **Verify subscription**
- Footer backup label text
- Home banner exact text
- Email my key toast message + `correlationId` from logs
- Whether multiple PCs are in use and how many are activated

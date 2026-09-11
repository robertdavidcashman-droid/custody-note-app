# Analytics (privacy-safe)

Custody Note collects **no case content, client names, or note bodies** in product analytics.

## Desktop events (opt-in / aggregated)

| Event | When | Payload (allowed) |
| --- | --- | --- |
| `app_activated` | First Free licence created | `platform`, `appVersion`, `tier=free` |
| `usage_heartbeat` | Packaged launch, at most once per 24h per machine | `machineId` (SHA-256 hash, 32 hex), `platform`, `appVersion`, `tier` |
| `first_attendance_created` | First saved attendance | `platform`, `appVersion` only |
| `attendance_finalised` | Finalise action | count only / boolean |
| `pdf_exported` | PDF export | boolean |
| `pro_upgrade_click` | Pricing / upgrade CTA | `source` (settings\|banner\|share) |
| `referral_share` | Share invite text | `channel` (clipboard\|email) |

Implementation notes:

- Existing packaged ping: `POST /api/stats/trial-started` (now may include `tier: free`). One-shot when Free / legacy trial licence is first created.
- Daily usage ping: `POST /api/stats/heartbeat` with `{ machineId, platform, appVersion, tier }`. Packaged builds only; deferred after first window load (same idea as updater `startup-deferred`); fire-and-forget with an 8s timeout; failures swallowed. Local `cn-usage-heartbeat.json` in userData stores `lastHeartbeatAt` so relaunches within 24 hours do not ping again. Used by admin stats for unique machines seen in the last 7 / 30 days. Do **not** reuse `trial-started` for this (would inflate unique Free/trial starts).
- `machineId` is a SHA-256 hash (32 hex chars) of hostname|platform|arch|cpu|totalmem — never a raw hostname or hardware serial.
- `tier` is the current licence tier (`free` / `pro` / `trial`), not always free.
- Do not attach UFN, custody number, officer names, note text, emails, or licence keys.
- Sentry remains separate and opt-in.

## Website (GA4 / Clarity)

Use existing [`lib/cta-analytics.ts`](../custody-note-website/lib/cta-analytics.ts) for Free download and Pro pricing CTAs. Funnel labels:

- `cta_download_free`
- `cta_upgrade_pro`
- `cta_firm_contact`

## Admin

Website admin stats may show Free installs vs Pro conversions from Lemon + trial-started pings. Treat historical “trial” counters as Free activations after freemium launch. Unique active machines (7 / 30 day) come from heartbeat pings, not from trial-started.

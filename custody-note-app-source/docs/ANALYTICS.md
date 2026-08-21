# Analytics (privacy-safe)

Custody Note collects **no case content, client names, or note bodies** in product analytics.

## Desktop events (opt-in / aggregated)

| Event | When | Payload (allowed) |
| --- | --- | --- |
| `app_activated` | First Free licence created | `platform`, `appVersion`, `tier=free` |
| `first_attendance_created` | First saved attendance | `platform`, `appVersion` only |
| `attendance_finalised` | Finalise action | count only / boolean |
| `pdf_exported` | PDF export | boolean |
| `pro_upgrade_click` | Pricing / upgrade CTA | `source` (settings\|banner\|share) |
| `referral_share` | Share invite text | `channel` (clipboard\|email) |

Implementation notes:

- Existing packaged ping: `POST /api/stats/trial-started` (now may include `tier: free`).
- Do not attach UFN, custody number, officer names, or note text.
- Sentry remains separate and opt-in.

## Website (GA4 / Clarity)

Use existing [`lib/cta-analytics.ts`](../custody-note-website/lib/cta-analytics.ts) for Free download and Pro pricing CTAs. Funnel labels:

- `cta_download_free`
- `cta_upgrade_pro`
- `cta_firm_contact`

## Admin

Website admin stats may show Free installs vs Pro conversions from Lemon + trial-started pings. Treat historical “trial” counters as Free activations after freemium launch.

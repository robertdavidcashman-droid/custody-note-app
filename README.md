# Custody Note

LAA-compliant custody note app for freelance reps.

**Sole publisher:** [`robertdavidcashman-droid/custody-note-app`](https://github.com/robertdavidcashman-droid/custody-note-app) — releases, updater feed, and CI live here.

## Download

- **Windows:** [latest droid release](https://github.com/robertdavidcashman-droid/custody-note-app/releases/latest) (currently includes Windows installer; see release assets).
- **Mac:** notarized Mac builds are **not** shipping from droid. Actions currently has incomplete Apple secrets (typically only `APPLE_APP_SPECIFIC_PASSWORD` + `GH_PAT`). Still needed before claiming notarization: `MAC_CERTIFICATE_P12_BASE64`, `MAC_CERTIFICATE_P12_PASSWORD`, `MAC_KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`. See [`DEPLOY_ONCE.md`](DEPLOY_ONCE.md) §5. Historical Mac **1.9.68** remains on `robertcashman-bit/custody-note-app` (leave that repo unarchived; do not publish new versions there).

## Docs

- [`DEPLOY_ONCE.md`](DEPLOY_ONCE.md) — one-time cutover clicks + Mac secrets checklist
- [`WORKSPACES.md`](WORKSPACES.md) — five-workspace layout

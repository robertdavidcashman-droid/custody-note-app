# Five Workspaces

Multi-project layout for all Custody Note / police station rep sites.

**Sole publisher:** `robertdavidcashman-droid`. New desktop releases and updater feeds publish only from this org.

**Bit policy:** Do **not** publish new Custody Note releases from `robertcashman-bit`. Keep `robertcashman-bit/custody-note-app` **unarchived** so historical Mac 1.9.68 stays available until droid has Mac notarization secrets.

## Deploy once, then never think about it

**One-time clicks:** see [`DEPLOY_ONCE.md`](DEPLOY_ONCE.md)

| Everyday action | Automatic result |
|-----------------|------------------|
| Push a website repo’s primary branch | Vercel production deploy |
| Bump `custody-note-app-source` version + changelog on `main` | Tag → Windows installer → **droid** updater → website changelog → Vercel (Mac only when notarization secrets exist) |

Health check anytime:

```bash
bash scripts/verify-all-deploys.sh
```

## Projects

| Workspace | Domain | Folder | GitHub repo | Vercel project |
|-----------|--------|--------|-------------|----------------|
| PoliceStationAgent.com | policestationagent.com | `one/` | `robertdavidcashman-droid/one` | web44ai |
| PoliceStationRepUK.com | policestationrepuk.org | `Policestationrepuk/` | `robertdavidcashman-droid/Policestationrepuk` | policestationrepuk-new |
| CustodyNote website | custodynote.com | `custody-note-website/` | `robertdavidcashman-droid/custody-note-website` | custody-note-website |
| PSRUKTrain.com | psrtrain.com | `pstrain-rebuild/` | `robertdavidcashman-droid/psrtrain` *(seed required)* | pstrain-rebuild |
| CustodyNoteApp | (desktop) | `.` + `custody-note-app-source/` | `robertdavidcashman-droid/custody-note-app` | none — updater feed is this same repo |

Configuration: [`workspaces.manifest.json`](workspaces.manifest.json)

## Automatic setup

### Cloud Agent (automatic on every run)

[`.cursor/environment.json`](.cursor/environment.json) runs:

1. `scripts/bootstrap-github-repos.sh` — create missing GitHub repos (needs `GITHUB_PAT`)
2. `scripts/sync-all-workspaces.sh` — clone or pull all repos
3. `scripts/verify-workspaces.sh` — health check

Manual sync anytime:

```bash
bash scripts/sync-all-workspaces.sh
bash scripts/verify-workspaces.sh
bash scripts/seed-missing-workspaces.sh   # needs GITHUB_PAT — seeds RepUK/PSRTrain onto droid
bash scripts/verify-all-deploys.sh
```

### MacBook (one-time install, then automatic every 5 min)

```bash
export REPUK_DIR="$HOME/Policestationrepuk"
export PSRTRAIN_DIR="$HOME/pstrain-rebuild"
bash scripts/install-mac-sync-agent.sh
```

Test without pushing:

```bash
bash scripts/mac-push-missing-repos.sh --dry-run
```

Logs: `~/Library/Logs/cursor-workspace-sync.log`

### Cursor Cloud / Actions secrets (one-time)

| Secret | Where | Purpose |
|--------|-------|---------|
| `GH_PAT` | App repo Actions secrets | Optional: push website from CI when default token cannot |
| `GITHUB_PAT` | Cursor Cloud secrets | Bootstrap/seed repos from agents |
| `VERCEL_TOKEN` | Cursor Cloud secrets | `verify-vercel-links.sh` |

**Mac notarization (this repo only — required before Mac ships from droid):**  
`MAC_CERTIFICATE_P12_BASE64`, `MAC_CERTIFICATE_P12_PASSWORD`, `MAC_KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`

Details: [`DEPLOY_ONCE.md`](DEPLOY_ONCE.md)

## Open all five in Cursor

File → Open Workspace from File → `all-workspaces.code-workspace`

## Vercel

Each website repo connects to **one** Vercel project. Do not link `one` to the pstrain project (see `one/scripts/verify-deployment-target.js`).

```bash
bash scripts/verify-vercel-links.sh
```

## Desktop app release (automatic)

1. Edit `custody-note-app-source/package.json` version + `changelog.json`
2. Merge to `main`
3. `Auto-tag release if needed` creates `v{x.y.z}`
4. `Release and deploy` builds Windows (and Mac **only if** notarization secrets exist), publishes to **droid** releases, syncs website

Root workflows live in [`.github/workflows/`](.github/workflows/) — **not** under `custody-note-app-source/.github/`.

## GitHub health check

Workflow [`.github/workflows/workspace-sync-check.yml`](.github/workflows/workspace-sync-check.yml) runs every 6 hours and reports missing repos.

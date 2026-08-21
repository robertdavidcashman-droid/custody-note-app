# Five Workspaces

Multi-project layout for all Custody Note / police station rep sites.

## Projects

| Workspace | Domain | Mac folder (`$HOME`) | GitHub repo | Vercel project |
|-----------|--------|----------------------|-------------|----------------|
| PoliceStationAgent.com | policestationagent.com | `policestationagent/` | `robertcashman-bit/policestationagent` | web44ai |
| PoliceStationRepUK.com | policestationrepuk.org | `Policestationrepuk/` | `robertcashman-bit/Policestationrepuk` | policestationrepuk-new |
| CustodyNote website | custodynote.com | `custody-note-website/` | `robertcashman-bit/custody-note-website` | custody-note-website |
| PSRUKTrain.com | psrtrain.com | `pstrain-rebuild/` | `robertcashman-bit/pstrain-rebuild` | pstrain-rebuild |
| CustodyNoteApp | (desktop) | `custody-note-app/` (this repo) | `robertcashman-bit/custody-note-app` | none (GitHub Releases) |

Configuration: [`workspaces.manifest.json`](workspaces.manifest.json)

Cloud Agent nested clones still use the `dir` field under this repo. Mac sibling checkouts use `homeDir` under `$HOME`.

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
```

### MacBook (shared with `~/dev-hub` sync)

Preferred: `~/dev-hub/scripts/install-mac-sync-schedule.sh` (every 30 minutes).

Optional legacy agent (every 5 minutes):

```bash
bash scripts/install-mac-sync-agent.sh
```

## GitHub health check

Workflow [`.github/workflows/workspace-sync-check.yml`](.github/workflows/workspace-sync-check.yml) runs every 6 hours and fails if any manifest repo is missing on GitHub.

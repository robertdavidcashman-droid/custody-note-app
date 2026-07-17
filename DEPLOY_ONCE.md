# Deploy once, then never think about it

**Sole GitHub home:** `robertdavidcashman-droid`. Archive `robertcashman-bit` repos and do not publish there.

After these **one-click / one-form** steps, every workspace deploys automatically.

## Your clicks (do these once)

### 1. Authenticate Vercel in Cursor
Cursor Desktop → MCP / Integrations → **Vercel** → **Authenticate**.

### 2. One-time Custody Note install (existing desktops)
Older installs poll the archived **bit** feed and will stay on 1.9.51. Install **1.9.52** once from:

https://github.com/robertdavidcashman-droid/custody-note-app/releases/tag/v1.9.52

After that, Check for updates uses the droid feed.

### 3. Optional — website push from CI
Open:  
https://github.com/robertdavidcashman-droid/custody-note-app/settings/secrets/actions

If Actions cannot push `custody-note-website` with the default token, add:

| Field | Value |
|-------|--------|
| Name | `GH_PAT` |
| Value | Classic PAT from **`robertdavidcashman-droid`** with scope **`repo`** |

Create the PAT:  
https://github.com/settings/tokens/new?scopes=repo&description=CustodyNote%20droid%20GH_PAT

Optional (Cursor Cloud Agent secrets):
| Name | Purpose |
|------|---------|
| `GITHUB_PAT` | Create/seed missing repos + agent pushes |
| `VERCEL_TOKEN` | `bash scripts/verify-vercel-links.sh` |

### 4. Confirm Vercel Git links (one screen each)
Vercel → Project → **Settings → Git → Connect Repository**

| Vercel project | Connect to |
|----------------|------------|
| `web44ai` | `robertdavidcashman-droid/one` |
| Project serving **policestationrepuk.org** | `robertdavidcashman-droid/policestationrepuk` |
| `custody-note-website` | `robertdavidcashman-droid/custody-note-website` |
| Project serving **psrtrain.com** | `robertdavidcashman-droid/psrtrain` *(after source is seeded)* |

### 5. Optional — Mac signed app builds
Same Actions secrets page, paste Apple cert secrets. Without them, **Windows-only** releases still publish.

### 6. Seed RepUK onto droid (one-time, if the droid repo is missing)

Cloud agents cannot create new GitHub repos under your account. On a machine signed in as **robertdavidcashman-droid**:

```bash
gh repo create robertdavidcashman-droid/policestationrepuk --public \
  --description "PoliceStationRepUK.com — sole home on droid"
# from a clone that already has the site (e.g. workspace Policestationrepuk/)
git remote add droid https://github.com/robertdavidcashman-droid/policestationrepuk.git
git push droid master:master
git remote set-url origin https://github.com/robertdavidcashman-droid/policestationrepuk.git
```

Or: `bash scripts/seed-missing-workspaces.sh` with `GITHUB_PAT` that can create repos.

PSRTrain (`robertdavidcashman-droid/psrtrain`) stays empty until you point `SRC_PSRTRAIN=owner/repo` at the live source.

### 7. Lock bit forever
When you can open the bit GitHub account, **Archive** (do not delete yet):

- `robertcashman-bit/custody-note-app`
- `robertcashman-bit/Policestationrepuk`
- any other bit repos you no longer use

---

## After that (automatic)

| What you do | What happens |
|-------------|--------------|
| Push website repo primary branch | Vercel production deploy |
| Bump `custody-note-app-source/package.json` + `changelog.json` on `main` | Auto-tag → Windows (and Mac if secrets) → **droid** updater feed → website changelog → Vercel |

## Health check

```bash
bash scripts/verify-all-deploys.sh
```

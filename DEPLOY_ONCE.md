# Deploy once, then never think about it

After these **one-click / one-form** steps, every workspace deploys automatically.

## Your clicks (do these once)

### 1. Authenticate Vercel in Cursor
Cursor Desktop → MCP / Integrations → **Vercel** → **Authenticate**.

### 2. Add one GitHub Actions secret
Open:  
https://github.com/robertdavidcashman-droid/custody-note-app/settings/secrets/actions

**New repository secret**
| Field | Value |
|-------|--------|
| Name | `GH_PAT` |
| Value | Classic PAT from **`robertcashman-bit`** with scope **`repo`** |

Create the PAT here (one page):  
https://github.com/settings/tokens/new?scopes=repo&description=CustodyNote%20deploy%20GH_PAT

Optional (Cursor Cloud Agent secrets — same PAT):
| Name | Purpose |
|------|---------|
| `GITHUB_PAT` | Create/seed missing repos + agent pushes |
| `VERCEL_TOKEN` | `bash scripts/verify-vercel-links.sh` |

### 3. Confirm Vercel Git links (one screen each)
Vercel → Project → **Settings → Git → Connect Repository**

| Vercel project | Connect to |
|----------------|------------|
| `web44ai` | `robertdavidcashman-droid/one` |
| Project serving **policestationrepuk.org** | `robertcashman-bit/Policestationrepuk` *(until droid mirror exists)* or `robertdavidcashman-droid/policestationrepuk` |
| `custody-note-website` | `robertdavidcashman-droid/custody-note-website` |
| Project serving **psrtrain.com** | Repo that has the live Next app (see seed script) |

### 4. Optional — Mac signed app builds
Same Actions secrets page, paste Apple cert secrets. Without them, **Windows-only** releases still publish.

---

## After that (automatic)

| What you do | What happens |
|-------------|--------------|
| Push website repo primary branch | Vercel production deploy |
| Bump `custody-note-app-source/package.json` + `changelog.json` on `main` | Auto-tag → Windows (and Mac if secrets) → **robertcashman-bit** updater feed → website changelog → Vercel |

## Health check

```bash
bash scripts/verify-all-deploys.sh
```

## Unblock v1.9.52 right after GH_PAT is set

```bash
# From a machine/agent with GH_PAT (or after secret is on the repo, use Actions):
bash custody-note-app-source/deploy-bundles/publish-v1.9.52-to-bit.sh
# Or: Actions → "Publish updater feed" → Run workflow → tag v1.9.52
```

# Deploy once, then never think about it

**Sole publisher:** `robertdavidcashman-droid`. All new Custody Note desktop releases, updater feeds, and in-repo docs/workflows publish from this org only.

**Do not archive** `robertcashman-bit/custody-note-app`. Bit shipped live Win+Mac **1.9.68** and still holds the notarized Mac assets and certs. Leave it open so Mac users on that feed are not stranded. Do not publish new versions from bit.

After these **one-click / one-form** steps, every workspace deploys automatically.

## Your clicks (do these once)

### 1. Authenticate Vercel in Cursor
Cursor Desktop → MCP / Integrations → **Vercel** → **Authenticate**.

### 2. One-time Custody Note install (older Windows desktops)
Older installs that still poll the bit feed stay on whatever bit last published. Install the current Windows build once from droid:

https://github.com/robertdavidcashman-droid/custody-note-app/releases/latest

After that, Check for updates uses the **droid** feed (`package.json` → `build.publish.owner: robertdavidcashman-droid`).

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
| Project serving **policestationrepuk.org** | `robertdavidcashman-droid/Policestationrepuk` |
| `custody-note-website` | `robertdavidcashman-droid/custody-note-website` |
| Project serving **psrtrain.com** | `robertdavidcashman-droid/psrtrain` *(after source is seeded)* |

### 5. Mac notarized builds (required before claiming Mac ships from droid)

Mac CI skips when the P12 secret is missing. **Do not claim Mac is shipping from this repo until all of these Actions secrets exist on `robertdavidcashman-droid/custody-note-app`:**

| Secret | What |
|--------|------|
| `MAC_CERTIFICATE_P12_BASE64` | Base64 of your Developer ID `.p12` |
| `MAC_CERTIFICATE_P12_PASSWORD` | Password for that `.p12` |
| `MAC_KEYCHAIN_PASSWORD` | Any random password for the CI keychain |
| `APPLE_ID` | Apple ID email |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (`xxxx-xxxx-xxxx-xxxx`) |

`APPLE_APP_SPECIFIC_PASSWORD` alone is not enough. Until the full set is present, Release and deploy publishes **Windows only** on droid. Historical Mac **1.9.68** remains on bit — leave that repo unarchived.

After secrets are uploaded, run **Actions → Release macOS only** for the target tag (or rely on the next full Release and deploy).

**Option B — on your Mac (certs already in Keychain)**  
```bash
cd custody-note-app-source
bash scripts/publish-mac-1.9.52-on-this-mac.sh
```
That uses `.env.local` (created via `node scripts/setup-apple-env.mjs` if missing) and uploads to the **droid** GitHub release.

### 6. Finish remaining Git pushes (one PAT + one button)

Cloud agents run as `cursor[bot]` and **cannot** create repos or push `custody-note-website` / `psrtrain`. Do this once:

1. Create a classic PAT while logged in as **`robertdavidcashman-droid`**:  
   https://github.com/settings/tokens/new?scopes=repo&description=CustodyNote%20droid%20GH_PAT  
2. Add it as Actions secret **`GH_PAT`**:  
   https://github.com/robertdavidcashman-droid/custody-note-app/settings/secrets/actions  
3. Run the workflow:  
   https://github.com/robertdavidcashman-droid/custody-note-app/actions/workflows/finish-droid-cutover.yml  
   → **Run workflow** → **Run workflow**

That seeds `policestationrepuk`, pushes the website changelog, and stubs empty `psrtrain`.

### 7. Bit repo policy

- **Keep** `robertcashman-bit/custody-note-app` **unarchived** (Mac 1.9.68 + notarization history).
- **Do not** publish new desktop releases from bit.
- Other bit website/repos can be retired later if unused; that is separate from Custody Note desktop publishing.

---

## After that (automatic)

| What you do | What happens |
|-------------|--------------|
| Push website repo primary branch | Vercel production deploy |
| Bump `custody-note-app-source/package.json` + `changelog.json` on `main` | Auto-tag → Windows (and Mac **only if** secrets above exist) → **droid** updater feed → website changelog → Vercel |

## Health check

```bash
bash scripts/verify-all-deploys.sh
```

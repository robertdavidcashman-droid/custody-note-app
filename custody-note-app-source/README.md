# Custody Note

Custody Note is an LAA-compliant desktop app for recording custody notes and police station attendances. Bright, easy-to-use form that flows logically at the station; PDF export; email PDF to yourself; hourly backup; optional signatures and speech recognition.

## Run the app

1. Install dependencies (once):

   ```bash
   cd <path-to-this-app>
   npm install
   ```

2. Start the app:

   ```bash
   npm start
   ```

## Automated tests

Full gate: **`npm run test:all`** (unit tests, Playwright Electron e2e, then in-app smoke). See **[docs/TESTING.md](docs/TESTING.md)** for prerequisites (`npx playwright install`), `SKIP_SMOKE`, and troubleshooting.

## Releasing a new version

Version and changelog are automated. From the app folder:

```bash
# Patch release (1.4.6 → 1.4.7), prompts for changelog items
npm run release patch

# Publish current version to GitHub and deploy website (no version bump)
npm run release:current

# With changelog from command line (semicolon-separated)
npm run release patch -- --changes "Security fixes; Updated dependencies"

# Minor (1.4.6 → 1.5.0) or major (1.4.6 → 2.0.0)
npm run release minor
npm run release major
```

**Requires:** `GH_TOKEN` or `GITHUB_TOKEN` (GitHub PAT with `repo` scope) for publishing. For `release:current` to also deploy the website, the script runs `npm run deploy` in the sibling folder `custody note - website production` (that deploy needs Vercel configured locally or in CI).

### Publish and deploy automatically (one command or CI)

- **Local:** Copy `.env.example` to `.env`, set `GH_TOKEN=ghp_...`, then run `npm run release:current`. That builds the installer, publishes it to GitHub Releases, and deploys the website to Vercel so the download page shows the new version.
- **CI:** Push a version tag to trigger build, publish, and deploy with no local token:
  1. In this repo’s **Settings > Secrets and variables > Actions** add: `VERCEL_TOKEN` (from Vercel) and `GH_PAT` (GitHub PAT with repo scope, used to clone the website repo).
  2. Push a tag that matches the current `package.json` version, e.g. `git tag v1.4.9` then `git push origin v1.4.9`. The workflow **Release and deploy** (`.github/workflows/release-publish.yml`) will build the Windows installer, publish it to GitHub Releases, and deploy the website.

### Pushing to GitHub (so it goes every time)

- Use a PAT with **repo** scope (and **workflow** only if you need to push changes to `.github/workflows/`).
- **Do not commit** `.github/workflows/` in this repo if your token lacks **workflow** scope — otherwise `git push` will fail with "refusing to allow an OAuth App to create or update workflow".
- To get CI on push without that scope: add the workflow **once** on GitHub: create `.github/workflows/test.yml` in the repo (e.g. via the website) and paste the contents of `docs/github-actions-test.yml.example`. After that, normal pushes (code, changelog, etc.) will always succeed.

### Signing the Windows installer (recommended)

Unsigned installers trigger Windows SmartScreen warnings. To sign the app you need a code signing certificate (PFX) from a trusted CA. Set `CSC_LINK` and `CSC_KEY_PASSWORD` before building; see **[SIGNING.md](SIGNING.md)** for full instructions.

The script: (1) bumps version, (2) updates changelog, (3) syncs to website, (4) builds and publishes the installer to GitHub, (5) deploys the website to Vercel. A token is required by default; pass `--no-publish` explicitly for local build-only runs.

Release safety checks are enforced automatically: build/release will fail if `package.json` version and `changelog.json` latest release are not in sync.

To sync changelog to the website without releasing (e.g. after editing changelog.json manually):

```bash
npm run sync-website
```

## Features

- **List** – Search and open past attendances.
- **New attendance** – Form in logical order: Arrival/Departure → Client & Matter → Custody → Disclosure → Attend on client → Interview → Outcome.
- **Settings** – Your email, DSCC PIN, backup folder. Hourly backups run automatically.
- **Backup now** – Immediate backup to your chosen folder.
- **Export PDF** – Save attendance note as PDF to Desktop.
- **Email PDF to me** – Save PDF and open your email client so you can attach it and send to the firm yourself.
- **LAA forms** – Link to GOV.UK legal aid claim forms (opens in browser).

Data is stored in a local database in the app data folder. Backups are saved every hour to the folder you set in Settings.

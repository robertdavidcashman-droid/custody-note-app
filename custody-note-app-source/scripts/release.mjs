#!/usr/bin/env node
/**
 * Release script: bumps version, builds app, publishes to GitHub, pushes to trigger Vercel.
 *
 * Usage:
 *   npm run release [patch|minor|major|current] [-- --changes "item1; item2; item3"]
 *   npm run release patch
 *   npm run release minor -- --changes "New feature X"
 *
 * If --changes is not provided, reads one change per line from stdin until empty line.
 *
 * Requires: GH_TOKEN or GITHUB_TOKEN (GitHub PAT with repo scope) for publishing.
 *
 * Flags: --skip-website-sync — do not run npm-equivalent sync to custody-note-website after push
 *        (use if the website repo is unavailable; run `npm run sync-website` later).
 *
 * This script:
 * 1. Bumps version in package.json (or uses current version in "current" mode)
 * 2. Appends to changelog.json (or validates changelog in "current" mode)
 * 3. Builds the Electron app and publishes to GitHub (creates release, uploads installer)
 * 4. Commits + pushes version bump — Vercel deploys automatically via git integration
 * 5. Runs sync-website so custodynote.com releases.json matches (unless --skip-website-sync)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');

/** Load GH_TOKEN from .env or .env.local if not already set */
function loadEnvToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return;
  for (const name of ['.env', '.env.local']) {
    const p = join(APP_ROOT, name);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*GH_TOKEN\s*=\s*(.+?)\s*$/);
        if (m) {
          process.env.GH_TOKEN = m[1].replace(/^["']|["']$/g, '').trim();
          return;
        }
      }
    } catch (_) {}
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function fail(message) {
  throw new Error(message);
}

function verifyReleaseConsistency(pkg, changelog) {
  const releases = Array.isArray(changelog.releases) ? changelog.releases : [];
  if (!pkg.version || typeof pkg.version !== 'string') fail('package.json version is missing or invalid.');
  if (releases.length === 0) fail('changelog.json has no releases.');
  const latest = releases.filter(r => r && r.latest === true);
  if (latest.length !== 1) fail(`changelog.json must have exactly one latest=true entry (found ${latest.length}).`);
  const latestRelease = latest[0];
  if (!latestRelease.version) fail('Latest changelog entry has no version.');
  if (latestRelease.version !== pkg.version) {
    fail(`Version mismatch: package.json=${pkg.version}, changelog latest=${latestRelease.version}`);
  }
  if (!releases[0] || releases[0].version !== latestRelease.version || releases[0].latest !== true) {
    fail('Latest changelog entry must be first in releases array.');
  }
}

function parseVersion(v) {
  return v.split('.').map(Number);
}

function bumpVersion(version, type) {
  const [major, minor, patch] = parseVersion(version);
  if (type === 'major') return [major + 1, 0, 0].join('.');
  if (type === 'minor') return [major, minor + 1, 0].join('.');
  return [major, minor, (patch || 0) + 1].join('.');
}

async function readChangesFromStdin() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const changes = [];
  process.stderr.write('Enter changelog items (one per line, empty line to finish):\n');
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) break;
    changes.push(trimmed);
  }
  return changes;
}

function parseChangesArg(argv) {
  const idx = argv.indexOf('--changes');
  if (idx !== -1 && argv[idx + 1]) {
    return argv[idx + 1].split(';').map(s => s.trim()).filter(Boolean);
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const type = ['patch', 'minor', 'major'].includes(mode) ? mode : null;
  const useCurrentVersion = mode === 'current';
  let changes = parseChangesArg(argv);

  const pkgPath = join(APP_ROOT, 'package.json');
  const changelogPath = join(APP_ROOT, 'changelog.json');
  const pkg = readJson(pkgPath);
  const changelog = existsSync(changelogPath) ? readJson(changelogPath) : { releases: [] };
  let releases = changelog.releases || [];
  let newVersion = pkg.version;
  const today = new Date().toISOString().slice(0, 10);

  if (type) {
    newVersion = bumpVersion(pkg.version, type);
    if (!changes || changes.length === 0) {
      changes = await readChangesFromStdin();
    }
    if (changes.length === 0) {
      changes = ['Bug fixes and improvements'];
    }

    // Update package.json
    pkg.version = newVersion;
    pkg.lastUpdated = today;
    pkg.buildTime = new Date().toISOString();
    writeJson(pkgPath, pkg);
    console.log(`Version bumped to ${newVersion}`);

    // Update changelog.json
    for (const r of releases) r.latest = false;
    releases.unshift({
      version: newVersion,
      date: today,
      latest: true,
      changes,
    });
    changelog.releases = releases;
    writeJson(changelogPath, changelog);
    console.log('Changelog updated');
  } else if (useCurrentVersion) {
    verifyReleaseConsistency(pkg, changelog);
    console.log(`Using existing release metadata for v${newVersion}`);
  } else {
    fail('Usage: npm run release [patch|minor|major|current] [-- --changes "item1; item2"]');
  }

  // Always verify consistency before build/publish
  verifyReleaseConsistency(pkg, changelog);

  // Build and publish app to GitHub
  loadEnvToken();
  const { spawn } = await import('child_process');
  const hasToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const skipPublish = argv.includes('--no-publish');
  const skipBuild = argv.includes('--skip-build');
  if (!hasToken && !skipPublish && !skipBuild) {
    fail('GH_TOKEN or GITHUB_TOKEN is required for release publish. Set a token or pass --no-publish/--skip-build explicitly.');
  }
  const doPublish = hasToken && !skipPublish && !skipBuild;

  if (skipBuild) {
    console.log('--skip-build set — skipping app build entirely.');
  } else if (doPublish) {
    console.log('Building and publishing to GitHub...');
    await new Promise((resolve, reject) => {
      const proc = spawn(
        'npx',
        ['electron-builder', '--win', '--publish', 'always'],
        {
          cwd: APP_ROOT,
          stdio: 'inherit',
          shell: true,
          env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN },
        }
      );
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Build/publish exited ${code}`))));
    });
    // electron-builder creates a DRAFT release. Publish it (set draft=false) so electron-updater picks it up.
    const ghApiHeaders = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'CustodyNote-ReleaseScript',
      'Content-Type': 'application/json',
    };
    const tag = `v${newVersion}`;
    let releaseReady = false;
    for (const delayMs of [3000, 5000, 10000]) {
      await new Promise((r) => setTimeout(r, delayMs));
      const listRes = await fetch(`https://api.github.com/repos/robertcashman-bit/custody-note-app/releases?per_page=20`, { headers: ghApiHeaders });
      if (!listRes.ok) continue;
      const allReleases = await listRes.json();
      const matchingRelease = allReleases.find((r) => r.tag_name === tag);
      if (!matchingRelease) continue;
      if (!matchingRelease.draft) {
        console.log(`GitHub release ${tag} is already published.`);
        releaseReady = true;
        break;
      }
      const patchRes = await fetch(`https://api.github.com/repos/robertcashman-bit/custody-note-app/releases/${matchingRelease.id}`, {
        method: 'PATCH',
        headers: ghApiHeaders,
        body: JSON.stringify({ draft: false }),
      });
      if (patchRes.ok) {
        console.log(`GitHub release ${tag} published (draft → live).`);
        releaseReady = true;
        break;
      }
    }
    if (!releaseReady) {
      console.warn(`Warning: could not find or publish release ${tag} on GitHub. Publish manually or re-run.`);
    }

    // Verify GitHub latest release matches expected version before website deploy.
    const skipVerify = argv.includes('--skip-verify');
    if (!skipVerify) {
      const latestUrl = 'https://api.github.com/repos/robertcashman-bit/custody-note-app/releases/latest';
      let latestVersion = null;
      let latestAssetNames = [];
      for (const delayMs of [3000, 5000, 8000]) {
        await new Promise((r) => setTimeout(r, delayMs));
        const latestRes = await fetch(latestUrl, { headers: ghApiHeaders });
        if (!latestRes.ok) continue;
        const latestData = await latestRes.json();
        latestVersion = String(latestData.tag_name || '').replace(/^v/, '');
        latestAssetNames = (latestData.assets || []).map((a) => a.name);
        if (latestVersion === newVersion) break;
      }
      if (latestVersion !== newVersion) {
        console.warn(`Warning: GitHub latest is v${latestVersion || 'unknown'}, expected v${newVersion}. Proceeding with website deploy.`);
      } else {
        console.log(`GitHub latest release verified: v${latestVersion}`);
      }

      // Guard: if "latest" lacks latest-mac.yml, Mac auto-updater on previous versions
      // will fail on every startup. Auto-demote to prerelease so /releases/latest
      // falls back to the previous full release until the Mac assets are uploaded.
      const allowMacBreakage = argv.includes('--allow-missing-mac-assets');
      const hasMacFeed = latestAssetNames.includes('latest-mac.yml');
      if (latestVersion === newVersion && !hasMacFeed && !allowMacBreakage) {
        console.warn(
          `\nWARNING: Release v${newVersion} has no latest-mac.yml. Mac auto-update would break for v${newVersion - 1} users.`
        );
        console.warn('Demoting v' + newVersion + ' to prerelease so /releases/latest returns the previous full release.');
        try {
          const idRes = await fetch(`https://api.github.com/repos/robertcashman-bit/custody-note-app/releases/tags/v${newVersion}`, { headers: ghApiHeaders });
          if (idRes.ok) {
            const rel = await idRes.json();
            const patchRes = await fetch(`https://api.github.com/repos/robertcashman-bit/custody-note-app/releases/${rel.id}`, {
              method: 'PATCH',
              headers: ghApiHeaders,
              body: JSON.stringify({ prerelease: true, make_latest: 'false' }),
            });
            if (patchRes.ok) {
              console.warn('Demoted to prerelease. To finish the release: build Mac assets locally (npm run build:mac:signed),');
              console.warn('upload them to the v' + newVersion + ' release, then PATCH prerelease=false via GitHub API.');
              console.warn('Or re-run release with --allow-missing-mac-assets to skip this guard.');
            } else {
              console.warn('Failed to PATCH release to prerelease:', patchRes.status);
            }
          }
        } catch (e) {
          console.warn('Demote-to-prerelease failed:', e && e.message ? e.message : e);
        }
      }
    }
  } else {
    if (skipPublish) {
      console.warn('--no-publish set — building only (no GitHub release).');
    }
    await new Promise((resolve, reject) => {
      const proc = spawn('npm', ['run', 'build:only'], {
        cwd: APP_ROOT,
        stdio: 'inherit',
        shell: true,
      });
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Build exited ${code}`))));
    });
  }
  console.log('Build complete.');

  // Commit and push version bump so Vercel deploys via git integration (skip if re-publishing same version)
  const { execSync } = await import('child_process');
  execSync('git add package.json changelog.json', { cwd: APP_ROOT, stdio: 'inherit' });
  let hasStagedVersionFiles = true;
  try {
    execSync('git diff --cached --quiet', { cwd: APP_ROOT, stdio: 'ignore' });
    hasStagedVersionFiles = false;
  } catch {
    /* exit 1 = staged diff exists */
  }
  if (hasStagedVersionFiles) {
    console.log('Committing version bump...');
    execSync(`git commit -m "chore(release): v${newVersion}"`, { cwd: APP_ROOT, stdio: 'inherit' });
    execSync('git push origin master', { cwd: APP_ROOT, stdio: 'inherit' });
    console.log('Pushed to origin/master \u2014 Vercel deploy will trigger automatically.');
  } else {
    console.log('No package.json/changelog changes to commit (e.g. npm run release current) — skipping git push.');
  }

  if (argv.includes('--skip-website-sync')) {
    console.log('--skip-website-sync set — skipping custody-note-website sync (run npm run sync-website when ready).');
  } else {
    console.log('Syncing marketing site releases.json (custody-note-website)...');
    try {
      execSync('node scripts/sync-website.mjs', { cwd: APP_ROOT, stdio: 'inherit' });
      console.log('Website releases synced and pushed.');
    } catch (err) {
      console.error('sync-website failed:', err && err.message ? err.message : err);
      console.error('Fix the issue and run: npm run sync-website');
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

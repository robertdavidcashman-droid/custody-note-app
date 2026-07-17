#!/usr/bin/env node
/**
 * Interactive setup for Apple notarisation credentials.
 * Writes .env.local (gitignored) — never prints secrets to stdout.
 *
 * Usage: node scripts/setup-apple-env.mjs
 */
import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(APP_ROOT, '.env.local');

function promptDialog(message, { hidden = false } = {}) {
  const hiddenPart = hidden ? ' with hidden answer' : '';
  const script = `text returned of (display dialog ${JSON.stringify(message)} default answer ""${hiddenPart} with title "Custody Note — Apple Signing" buttons {"Cancel", "Continue"} default button "Continue")`;
  const result = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
  if (result.status !== 0) {
    const err = (result.stderr || '').trim();
    if (/User canceled/i.test(err)) {
      console.error('Cancelled.');
      process.exit(1);
    }
    throw new Error(err || 'Dialog failed');
  }
  return (result.stdout || '').trim();
}

function normalizeAppPassword(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, '');
  if (/^[a-z0-9]{16}$/i.test(s)) {
    s = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
  }
  return s;
}

function isValidAppPassword(raw) {
  return /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(normalizeAppPassword(raw));
}

function main() {
  if (existsSync(ENV_PATH)) {
    const overwrite = spawnSync(
      'osascript',
      ['-e', 'button returned of (display alert "A .env.local file already exists. Overwrite it?" buttons {"Cancel", "Overwrite"} default button "Overwrite" as warning)'],
      { encoding: 'utf8' }
    );
    if ((overwrite.stdout || '').trim() !== 'Overwrite') {
      console.log('Kept existing .env.local.');
      process.exit(0);
    }
  }

  console.log('Opening dialogs — enter each value when prompted…');

  const appleId = promptDialog(
    'Apple ID email (your Developer Program account):'
  );
  if (!appleId || !appleId.includes('@')) {
    console.error('Invalid Apple ID — must be an email address.');
    process.exit(1);
  }

  spawnSync('open', ['https://appleid.apple.com/account/manage'], { stdio: 'ignore' });

  const appPassword = normalizeAppPassword(
    promptDialog(
      'App-Specific Password ONLY (NOT your Apple ID login password).\n\n' +
        'Generate at appleid.apple.com → Sign-In and Security → App-Specific Passwords.\n\n' +
        'Format: xxxx-xxxx-xxxx-xxxx',
      { hidden: true }
    )
  );
  if (!isValidAppPassword(appPassword)) {
    console.error(
      'App-Specific Password must look like xxxx-xxxx-xxxx-xxxx.\n' +
        'That is NOT your normal Apple ID password — generate a new one at appleid.apple.com.'
    );
    process.exit(1);
  }

  const teamId = promptDialog(
    'Team ID (10 characters — developer.apple.com → Account → Membership):'
  );
  if (!/^[A-Z0-9]{10}$/i.test(teamId.trim())) {
    console.error('Team ID must be exactly 10 letters/numbers.');
    process.exit(1);
  }

  const contents = [
    `APPLE_ID=${appleId.trim()}`,
    `APPLE_APP_SPECIFIC_PASSWORD=${appPassword}`,
    `APPLE_TEAM_ID=${teamId.trim().toUpperCase()}`,
    '',
  ].join('\n');

  writeFileSync(ENV_PATH, contents, { mode: 0o600 });
  console.log(`Saved credentials to .env.local (mode 600, gitignored).`);
  console.log('You can now run: npm run build:mac:signed');
}

main();

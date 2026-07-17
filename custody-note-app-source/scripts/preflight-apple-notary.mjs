#!/usr/bin/env node
/**
 * Fail fast when Apple notarization credentials are missing or rejected (HTTP 401).
 * Run in CI before the 10+ minute signed Mac build.
 */
import { spawnSync } from 'child_process';

function fail(msg) {
  console.error(`[preflight-notary] FAIL: ${msg}`);
  process.exit(1);
}

function normalizeAppPassword(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, '');
  if (/^[a-z0-9]{16}$/i.test(s)) {
    s = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
  }
  return s;
}

const appleId = String(process.env.APPLE_ID || '').trim();
const appPassword = normalizeAppPassword(process.env.APPLE_APP_SPECIFIC_PASSWORD);
const teamId = String(process.env.APPLE_TEAM_ID || '').trim();

if (!appleId || !appPassword || !teamId) {
  fail('APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID must be set in GitHub Actions secrets.');
}

if (!appleId.includes('@')) {
  fail(`APPLE_ID "${appleId}" does not look like an email address.`);
}

if (!/^[A-Z0-9]{10}$/.test(teamId)) {
  fail(`APPLE_TEAM_ID "${teamId}" is not a valid 10-character Team ID.`);
}

const result = spawnSync(
  'xcrun',
  [
    'notarytool', 'history',
    '--apple-id', appleId,
    '--password', appPassword,
    '--team-id', teamId,
    '--output-format', 'json',
  ],
  { encoding: 'utf8', timeout: 120000 },
);

const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
if (result.status !== 0) {
  if (/401|Invalid credentials|Username or password is incorrect/i.test(combined)) {
    fail(
      'Apple notarization credentials were rejected (HTTP 401).\n' +
      'Regenerate an app-specific password at https://appleid.apple.com/ → Sign-In and Security →\n' +
      'App-Specific Passwords, then update the APPLE_APP_SPECIFIC_PASSWORD GitHub Actions secret.\n' +
      `notarytool output: ${combined.split('\n').slice(0, 6).join(' ')}`,
    );
  }
  fail(`notarytool history failed (exit ${result.status}): ${combined.split('\n').slice(0, 8).join(' ')}`);
}

console.log('[preflight-notary] Apple notarization credentials accepted.');

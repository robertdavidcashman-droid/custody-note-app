#!/usr/bin/env node
/**
 * Authenticate gh/git with workflow scope, then push pending commits.
 *
 * GitHub OAuth (Cursor/gh default) cannot push .github/workflows without
 * the `workflow` scope. Use either:
 *   A) Device login:  node scripts/github-auth-with-workflow.mjs --login
 *   B) Classic PAT:   GH_TOKEN=github_pat_... node scripts/github-auth-with-workflow.mjs --push
 *
 * Create a classic PAT at:
 * https://github.com/settings/tokens/new?scopes=repo,workflow,read:org,gist
 */
import { spawnSync, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gh = [join(homedir(), '.local', 'bin', 'gh'), 'gh'].find((p) => p === 'gh' || existsSync(p)) || 'gh';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: root, ...opts });
  return r;
}

function ghAuthStatus() {
  const r = run(gh, ['auth', 'status', '-h', 'github.com']);
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const hasWorkflow = /Token scopes:.*\bworkflow\b/.test(text);
  const account = (text.match(/account\s+(\S+)/) || [])[1] || null;
  return { ok: r.status === 0, hasWorkflow, account, text };
}

function loadGhToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  for (const file of [join(root, '.env'), join(root, '.env.local')]) {
    if (!existsSync(file)) continue;
    const m = readFileSync(file, 'utf8').match(/^GH_TOKEN=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

function loginWithToken(token) {
  const r = spawnSync(gh, ['auth', 'login', '--with-token'], {
    input: token + '\n',
    encoding: 'utf8',
    cwd: root,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (r.status !== 0) process.exit(r.status || 1);
  run(gh, ['auth', 'setup-git']);
}

function deviceLogin() {
  console.log('[github-auth] Opening device login for robertcashman-bit (needs workflow scope)…');
  console.log('[github-auth] Sign in as robertcashman-bit — not robertdavidcashman-droid.');
  const r = spawnSync(
    gh,
    ['auth', 'login', '-h', 'github.com', '--git-protocol', 'https', '-s', 'repo,workflow,read:org,gist', '-w'],
    { cwd: root, stdio: 'inherit' },
  );
  if (r.status !== 0) process.exit(r.status || 1);
}

function pushMaster() {
  const status = ghAuthStatus();
  if (!status.ok || !status.hasWorkflow) {
    console.error('[github-auth] Still missing workflow scope.');
    console.error(status.text);
    console.error('\nCreate a classic PAT: https://github.com/settings/tokens/new?scopes=repo,workflow,read:org,gist');
    console.error('Then: GH_TOKEN=github_pat_... node scripts/github-auth-with-workflow.mjs --push');
    process.exit(1);
  }
  console.log(`[github-auth] OK — ${status.account || 'github.com'} has workflow scope.`);
  execSync('git push origin master', { cwd: root, stdio: 'inherit' });
  console.log('[github-auth] Pushed master.');
}

const mode = process.argv[2] || '--push';
if (mode === '--login') {
  deviceLogin();
  pushMaster();
} else if (mode === '--push') {
  const status = ghAuthStatus();
  if (!status.hasWorkflow) {
    const token = loadGhToken();
    if (token) {
      console.log('[github-auth] Logging in with GH_TOKEN from env/.env…');
      loginWithToken(token);
    }
  }
  pushMaster();
} else {
  console.error('Usage: node scripts/github-auth-with-workflow.mjs [--login | --push]');
  process.exit(1);
}

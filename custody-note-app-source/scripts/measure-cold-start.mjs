#!/usr/bin/env node
/**
 * Measure Custody Note cold-start markers ([Boot] lines from main + renderer).
 *
 * Usage:
 *   xvfb-run -a node scripts/measure-cold-start.mjs
 *   CUSTODYNOTE_BOOT_CLEAR_CACHE=1 xvfb-run -a node scripts/measure-cold-start.mjs  # A/B only
 *
 * Writes JSON summary to stdout and /opt/cursor/artifacts/cold-start-*.json when writable.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const electronBin = require(path.join(ROOT, 'node_modules/electron'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-boot-'));
const t0 = Date.now();
const marks = {};
const rawLines = [];

function note(name, ms) {
  if (marks[name] == null) marks[name] = ms;
}

const env = Object.assign({}, process.env, {
  CUSTODYNOTE_E2E_SKIP_LICENCE_GATE: '1',
  ELECTRON_ENABLE_LOGGING: '1',
});

const child = spawn(electronBin, ['.', `--user-data-dir=${userData}`], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let buf = '';
let done = false;

function finish(reason) {
  if (done) return;
  done = true;
  clearTimeout(killTimer);
  const summary = {
    reason,
    elapsedMs: Date.now() - t0,
    marks,
    clearCacheEnv: process.env.CUSTODYNOTE_BOOT_CLEAR_CACHE || '0',
  };
  console.log(JSON.stringify(summary, null, 2));
  try {
    const artDir = '/opt/cursor/artifacts';
    if (fs.existsSync('/opt/cursor') || fs.existsSync(artDir)) {
      try { fs.mkdirSync(artDir, { recursive: true }); } catch (_) {}
      const tag = process.env.CUSTODYNOTE_BOOT_CLEAR_CACHE === '1' ? 'with-clearcache' : 'optimized';
      fs.writeFileSync(path.join(artDir, 'cold-start-' + tag + '.json'), JSON.stringify(summary, null, 2));
      fs.writeFileSync(path.join(artDir, 'cold-start-' + tag + '.log'), rawLines.join('\n'));
    }
  } catch (_) {}
  try { child.kill(); } catch (_) {}
  setTimeout(() => {
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
  }, 300);
}

function onChunk(chunk) {
  const text = chunk.toString();
  buf += text;
  const lines = buf.split(/\r?\n/);
  buf = lines.pop() || '';
  for (const line of lines) {
    if (/\[Boot\]|\[Startup\]/.test(line)) rawLines.push(line);
    const m = line.match(/\[Boot\]\s+(\S+)\s+(\d+)/);
    if (m) {
      note(m[1], Number(m[2]));
      process.stderr.write(line + '\n');
    }
    if (/BOOT_DONE|renderer-first-interactive|renderer-splash-hide/.test(line)) {
      finish('boot-done');
    }
  }
}

child.stdout.on('data', onChunk);
child.stderr.on('data', onChunk);

const killTimer = setTimeout(() => finish('timeout'), 60000);

child.on('exit', () => {
  if (!done) finish('exit');
});

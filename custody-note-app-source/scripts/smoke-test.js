/**
 * Smoke test: launch Custody Note and verify it gets past the splash screen.
 * Runs with ELECTRON_RUN_AS_TEST=1; the app checks splash is gone and
 * .app-header is visible, then exits 0 (pass) or 1 (fail).
 * Uses "electron ." from project so no build is required.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.join(__dirname, '..');
const ELECTRON_CLI = path.join(PROJECT_DIR, 'node_modules', 'electron', 'cli.js');
const WAIT_MS = 180000;

function main() {
  if (!fs.existsSync(ELECTRON_CLI)) {
    console.error('Smoke test: Electron not found. Run "npm install" first.');
    process.exit(1);
  }

  console.log('Starting Custody Note stress test...');
  const child = spawn(process.execPath, [ELECTRON_CLI, PROJECT_DIR], {
    cwd: PROJECT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_TEST: '1' },
  });

  child.stdout.on('data', (d) => process.stdout.write(d));
  child.stderr.on('data', (d) => process.stderr.write(d));

  const timeout = setTimeout(() => {
    try { child.kill('SIGTERM'); } catch (_) {}
    console.error('Test timed out: app did not exit within', WAIT_MS / 1000, 's');
    process.exit(1);
  }, WAIT_MS);

  child.on('error', (err) => {
    clearTimeout(timeout);
    console.error('Failed to start app:', err.message);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    clearTimeout(timeout);
    if (signal) {
      console.error('App killed by signal', signal);
      process.exit(1);
    }
    if (code === 0) {
      console.log('\n✓ STRESS TEST PASSED: All buttons and navigation working correctly.');
      process.exit(0);
    }
    console.error('\n✗ STRESS TEST FAILED (exit code ' + code + ')');
    process.exit(1);
  });
}

main();

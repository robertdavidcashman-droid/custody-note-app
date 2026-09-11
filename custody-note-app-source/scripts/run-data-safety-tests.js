#!/usr/bin/env node
/**
 * Data-safety CI gate — focused suite that must pass before release/deploy.
 * Does not weaken assertions; failures block the pipeline.
 *
 * Includes architecture, durability, empty-cloud, silent-death, stress,
 * cross-device SoT, fault-injection / chaos / canary scale harness.
 */
const { spawn } = require('child_process');
const path = require('path');
const { readdirSync } = require('fs');

const testsDir = path.join(__dirname, '..', 'tests');

const EXTRA = new Set([
  'attendanceDurability.test.js',
  'saveNowDurability.test.js',
  'emptySyncRecovery.test.js',
  'backupPathAndGenerational.test.js',
  'footerStatusChips.test.js',
  'silentSyncDeath.test.js',
  'syncStress.test.js',
  'crossDeviceSync.test.js',
  'p0SecurityDurabilityFixes.test.js',
]);

const files = readdirSync(testsDir)
  .filter((f) => /^dataSafety.*\.test\.js$/.test(f) || EXTRA.has(f))
  .sort()
  .map((f) => path.join('tests', f));

if (files.length === 0) {
  console.error('[test:data-safety] No data-safety test files found');
  process.exit(1);
}

console.log('[test:data-safety] Running', files.length, 'file(s):');
for (const f of files) console.log('  -', f);

const proc = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  shell: false,
  cwd: path.join(__dirname, '..'),
});

proc.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code == null ? 1 : code);
});

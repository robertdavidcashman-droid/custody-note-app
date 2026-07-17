#!/usr/bin/env node
/**
 * Cross-shell unit-test runner.
 *
 * Replaces `node --test tests/*.test.js` which relied on shell glob expansion.
 * PowerShell (the default shell on GitHub Actions windows-latest) does not expand
 * globs in command arguments, so the previous form failed in CI with:
 *     Could not find 'D:\a\custody-note-app\tests\*.test.js'
 *
 * This script enumerates `tests/*.test.js` files in Node and spawns `node --test`
 * with the explicit file list, so it behaves identically on bash, cmd, and pwsh.
 *
 * Only top-level tests/ is scanned — tests/e2e/*.spec.ts belong to Playwright
 * and are run separately by `npm run test:e2e`.
 */
const { readdirSync } = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const testsDir = path.join(__dirname, '..', 'tests');
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join('tests', f));

if (files.length === 0) {
  console.error('[run-unit-tests] No *.test.js files found in tests/');
  process.exit(1);
}

console.log(`[run-unit-tests] Running ${files.length} unit test file(s) via node --test`);

const extraArgs = process.argv.slice(2);
const proc = spawn(process.execPath, ['--test', ...extraArgs, ...files], {
  stdio: 'inherit',
  shell: false,
  cwd: path.join(__dirname, '..'),
});

proc.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code == null ? 1 : code);
});

/**
 * Run full automated test gate: unit tests, Playwright e2e, then in-app smoke test.
 * Set SKIP_SMOKE=1 to skip npm test (smoke) for faster local runs.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

function run(command, label) {
  console.log(`\n[test:all] ${label}\n`);
  const r = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    cwd: root,
    env: process.env,
  });
  const code = r.status != null ? r.status : 1;
  if (code !== 0) {
    console.error(`[test:all] FAILED (${code}): ${label}`);
    process.exit(code);
  }
}

run('npm run test:unit', 'npm run test:unit');
run('npm run test:e2e', 'npm run test:e2e');

if (process.env.SKIP_SMOKE === '1') {
  console.log('\n[test:all] SKIP_SMOKE=1 — skipping npm test (smoke)\n');
  process.exit(0);
}

run('npm test', 'npm test (smoke / ELECTRON_RUN_AS_TEST)');
console.log('\n[test:all] All steps passed.\n');
process.exit(0);

#!/usr/bin/env node
/**
 * Re-push an existing release tag so GitHub Actions "Release and deploy" runs.
 * Tags pushed by GITHUB_TOKEN (auto-tag workflow) do not trigger other workflows.
 *
 * Usage: node scripts/trigger-release-deploy.mjs [v1.9.20]
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = process.argv[2] || `v${pkg.version}`;

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

console.log(`[trigger-release-deploy] Re-pushing ${tag} to start Release and deploy…`);
run('git fetch origin --tags --force');
try {
  run(`git push origin :refs/tags/${tag}`);
  console.log(`[trigger-release-deploy] Deleted remote ${tag}`);
} catch (_) {
  console.log(`[trigger-release-deploy] Remote ${tag} not present (continuing)`);
}
run(`git push origin ${tag}`);
console.log(`[trigger-release-deploy] Pushed ${tag} — watch Actions for Release and deploy.`);

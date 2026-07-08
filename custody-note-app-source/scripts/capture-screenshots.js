/**
 * Captures real screenshots from Custody Note using a blank database.
 * Output: custody note - website production/public/screenshots/
 *
 * Usage: npm run capture-screenshots
 * (Run from the bullseye-app / custody-note-app project root)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const CAPTURE_USERDATA = path.join(ROOT, 'capture-userdata-temp');
const WEBSITE_SCREENSHOTS = path.resolve(ROOT, '..', '..', '..', 'custody note - website production', 'public', 'screenshots');

function runElectron(args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['electron', '.', ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
      shell: true,
    });
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron exited ${code}: ${stderr}`));
    });
    proc.on('error', reject);
  });
}

function rmRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) rmRecursive(full);
    else fs.unlinkSync(full);
  }
  fs.rmdirSync(dir);
}

async function main() {
  console.log('[capture-screenshots] Creating blank database...\n');
  rmRecursive(CAPTURE_USERDATA);
  fs.mkdirSync(CAPTURE_USERDATA, { recursive: true });
  await runElectron(['--user-data-dir=' + CAPTURE_USERDATA], { TRIAL_INIT_ONLY: '1' });

  if (!fs.existsSync(WEBSITE_SCREENSHOTS)) {
    fs.mkdirSync(WEBSITE_SCREENSHOTS, { recursive: true });
  }
  console.log('[capture-screenshots] Running app and capturing screenshots...\n');
  await runElectron(
    ['--user-data-dir=' + CAPTURE_USERDATA],
    { CAPTURE_SCREENSHOTS: '1', CAPTURE_OUTPUT_DIR: WEBSITE_SCREENSHOTS }
  );

  rmRecursive(CAPTURE_USERDATA);
  console.log('\n[capture-screenshots] Done. Screenshots saved to:', WEBSITE_SCREENSHOTS);
}

main().catch((err) => {
  console.error('[capture-screenshots] Error:', err.message);
  if (fs.existsSync(CAPTURE_USERDATA)) rmRecursive(CAPTURE_USERDATA);
  process.exit(1);
});

/**
 * Prepares a trial distribution package: builds the app (if needed), creates a blank
 * database + encryption keys, packages everything into a zip ready to email.
 *
 * Output: Desktop/CustodyNote-Trial-YYYY-MM-DD.zip
 * Recipient extracts and runs "Custody Note.exe" — the app uses the bundled userData (blank DB).
 *
 * Usage: npm run prepare-trial
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const DIST = 'C:\\Users\\rober\\custody-note-dist';
const WIN_UNPACKED = path.join(DIST, 'win-unpacked');
const TRIAL_TEMP = path.join(ROOT, 'trial-userData-temp');
const DESKTOP = path.join(os.homedir(), 'Desktop');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', ...opts });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    proc.on('error', reject);
  });
}

function runElectronTrialInit() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, TRIAL_INIT_ONLY: '1' };
    const proc = spawn(
      'npx',
      ['electron', '.', '--user-data-dir=' + TRIAL_TEMP],
      { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT, shell: true }
    );
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron trial init exited ${code}: ${stderr}`));
    });
    proc.on('error', reject);
  });
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
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
  console.log('[prepare-trial] Starting...\n');

  // 1. Ensure build exists
  if (!fs.existsSync(WIN_UNPACKED) || !fs.existsSync(path.join(WIN_UNPACKED, 'Custody Note.exe'))) {
    console.log('[prepare-trial] Building app (electron-builder --dir)...\n');
    await run('npm', ['run', 'build'], { cwd: ROOT });
  } else {
    console.log('[prepare-trial] Using existing build at', WIN_UNPACKED);
  }

  // 2. Create blank userData via Electron
  rmRecursive(TRIAL_TEMP);
  fs.mkdirSync(TRIAL_TEMP, { recursive: true });

  console.log('[prepare-trial] Creating blank database and encryption keys...\n');
  await runElectronTrialInit();

  // 3. Copy userData into win-unpacked
  const userDataDest = path.join(WIN_UNPACKED, 'userData');
  rmRecursive(userDataDest);
  copyRecursive(TRIAL_TEMP, userDataDest);
  console.log('[prepare-trial] Copied userData into build\n');

  // 4. Create zip on Desktop
  const date = new Date().toISOString().slice(0, 10);
  const zipName = `CustodyNote-Trial-${date}.zip`;
  const zipPath = path.join(DESKTOP, zipName);

  console.log('[prepare-trial] Creating zip...\n');
  const ps = `Compress-Archive -Path "${path.join(WIN_UNPACKED, '*')}" -DestinationPath "${zipPath}" -Force`;
  await run('powershell', ['-NoProfile', '-Command', ps]);

  // 5. Cleanup temp
  rmRecursive(TRIAL_TEMP);

  console.log('\n[prepare-trial] Done.');
  console.log('  Output:', zipPath);
  console.log('\n  To send: attach this zip to your email. Recipient extracts and runs "Custody Note.exe".');
  console.log('  The database is blank; trial starts automatically on first run.\n');

  // Open folder
  spawn('explorer', [DESKTOP], { detached: true, stdio: 'ignore' });
}

main().catch((err) => {
  console.error('[prepare-trial] Error:', err.message);
  if (fs.existsSync(TRIAL_TEMP)) rmRecursive(TRIAL_TEMP);
  process.exit(1);
});

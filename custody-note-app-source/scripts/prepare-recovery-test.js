/**
 * Prepares the app for a manual recovery-password test by renaming key files
 * so the next app start will show the "Enter recovery password" modal.
 *
 * Usage:
 *   node scripts/prepare-recovery-test.js        Prepare for test (rename keys)
 *   node scripts/prepare-recovery-test.js --restore   Restore key files after test
 *
 * Requires: app has a recovery password set (recovery.dat exists). Run with app closed.
 */

const fs = require('fs');
const path = require('path');

const appName = 'custody-note';
const userData = process.env.APPDATA
  ? path.join(process.env.APPDATA, appName)
  : path.join(process.env.HOME || process.env.USERPROFILE, '.config', appName);

const files = {
  key: 'encryption.key',
  keyBak: 'encryption.key.bak',
  fallback: 'master.fallback',
  fallbackBak: 'master.fallback.bak',
  recovery: 'recovery.dat',
  db: 'attendances.db',
};

function main() {
  const restore = process.argv.includes('--restore');

  if (!fs.existsSync(userData)) {
    console.error('User data folder not found:', userData);
    process.exit(1);
  }

  if (restore) {
    let restored = 0;
    if (fs.existsSync(path.join(userData, files.keyBak))) {
      fs.renameSync(path.join(userData, files.keyBak), path.join(userData, files.key));
      console.log('Restored', files.key);
      restored++;
    }
    if (fs.existsSync(path.join(userData, files.fallbackBak))) {
      fs.renameSync(path.join(userData, files.fallbackBak), path.join(userData, files.fallback));
      console.log('Restored', files.fallback);
      restored++;
    }
    if (restored === 0) console.log('No .bak key files found to restore.');
    return;
  }

  // Prepare: need recovery.dat so the app will prompt for recovery password
  const recoveryPath = path.join(userData, files.recovery);
  const dbPath = path.join(userData, files.db);

  if (!fs.existsSync(recoveryPath)) {
    console.error('recovery.dat not found. Set a recovery password in Settings first, then run this script.');
    process.exit(1);
  }
  if (!fs.existsSync(dbPath)) {
    console.error('attendances.db not found. Use the app to create data, then run this script.');
    process.exit(1);
  }

  let renamed = 0;
  const keyPath = path.join(userData, files.key);
  const keyBakPath = path.join(userData, files.keyBak);
  const fallbackPath = path.join(userData, files.fallback);
  const fallbackBakPath = path.join(userData, files.fallbackBak);

  if (fs.existsSync(keyPath)) {
    fs.renameSync(keyPath, keyBakPath);
    console.log('Renamed', files.key, '->', files.keyBak);
    renamed++;
  }
  if (fs.existsSync(fallbackPath)) {
    fs.renameSync(fallbackPath, fallbackBakPath);
    console.log('Renamed', files.fallback, '->', files.fallbackBak);
    renamed++;
  }

  if (renamed === 0) {
    console.log('No key files found (encryption.key / master.fallback). Already in recovery state?');
    console.log('Start the app; if the recovery dialog appears, the test is ready.');
  } else {
    console.log('\nReady for recovery test. Next steps:');
    console.log('  1. Start the app (e.g. npm start).');
    console.log('  2. The "Recovery Password" modal should appear.');
    console.log('  3. Enter your recovery password, use Show to verify, then click Unlock.');
    console.log('  4. After testing, restore key files: node scripts/prepare-recovery-test.js --restore');
  }
}

main();

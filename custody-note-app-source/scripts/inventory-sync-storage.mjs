#!/usr/bin/env node
/**
 * READ-ONLY Custody Note sync / storage inventory.
 *
 * Does NOT decrypt, modify, delete, or migrate anything.
 * Safe to run while investigating a data-integrity incident.
 *
 * Usage:
 *   node scripts/inventory-sync-storage.mjs
 *   CUSTODYNOTE_USERDATA=/path/to/custody-note node scripts/inventory-sync-storage.mjs
 *
 * On Windows default userData: %APPDATA%\\custody-note
 * On Mac default userData: ~/Library/Application Support/custody-note
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveUserData() {
  if (process.env.CUSTODYNOTE_USERDATA && process.env.CUSTODYNOTE_USERDATA.trim()) {
    return path.resolve(process.env.CUSTODYNOTE_USERDATA.trim());
  }
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'custody-note');
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'custody-note');
  }
  return path.join(os.homedir(), '.config', 'custody-note');
}

function fmtBytes(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

function statSafe(p) {
  try {
    const st = fs.statSync(p);
    return { exists: true, size: st.size, mtime: st.mtime.toISOString(), isDir: st.isDirectory() };
  } catch (_) {
    return { exists: false };
  }
}

function listMatching(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names.filter(predicate).map((name) => {
    const full = path.join(dir, name);
    const st = statSafe(full);
    return { name, path: full, ...st };
  }).sort((a, b) => String(b.mtime || '').localeCompare(String(a.mtime || '')));
}

function main() {
  const userData = resolveUserData();
  const report = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    userData,
    userDataExists: fs.existsSync(userData),
    note: 'READ-ONLY inventory. Does not decrypt attendances.db. Mac with 66 records remains the primary recovery source until cloud verify succeeds.',
    criticalFiles: {},
    backupCandidates: [],
    safetyCopies: [],
    quarantineDirs: [],
    warnings: [],
  };

  const critical = [
    'attendances.db',
    'encryption.key',
    'encryption.key.bak',
    'recovery.dat',
    'master.fallback',
    'licence.dat',
    'licences.db.enc',
    'cn-auto-update-state.json',
  ];
  for (const name of critical) {
    report.criticalFiles[name] = statSafe(path.join(userData, name));
  }

  // recovery.dat.superseded-*
  report.criticalFiles.recoverySuperseded = listMatching(userData, (n) => n.startsWith('recovery.dat.superseded'));

  const backupsDir = path.join(userData, 'Backups');
  report.criticalFiles.BackupsFolder = statSafe(backupsDir);
  if (!report.criticalFiles.BackupsFolder.exists) {
    report.warnings.push('Backups folder missing under userData — local backup scheduler may show Backup queued / Backup folder missing.');
  } else {
    report.backupCandidates = listMatching(backupsDir, (n) => n.endsWith('.db'));
  }

  report.safetyCopies = listMatching(userData, (n) =>
    n.startsWith('attendances.db.') && (n.includes('.bak') || n.includes('pre-') || n.includes('repair') || n.endsWith('.tmp'))
  );
  report.quarantineDirs = listMatching(userData, (n) => n.startsWith('quarantine-'));

  const live = report.criticalFiles['attendances.db'];
  if (live.exists && live.size >= 512 * 1024) {
    report.warnings.push(
      'Live attendances.db is large (' + fmtBytes(live.size) + '). If the UI shows No records yet, treat as empty-large-DB class: restore from Mac or local backup, then Re-upload all local records to cloud (do NOT wipe this file).'
    );
  }
  if (!report.criticalFiles['encryption.key'].exists && !report.criticalFiles['master.fallback'].exists) {
    report.warnings.push('No encryption.key / master.fallback found — DB cannot be decrypted on this machine without recovery.dat + password or a key copy from another device.');
  }

  report.recoveryPriority = [
    '1. Mac (device that still lists 66 records) — Settings → Re-upload all local records to cloud; wait for verifyReceived > 0.',
    '2. Mac Backups/attendance-latest.db and attendance-backup-*.db — in-app Restore from Local Backup (marks dirty + rebuilds queue).',
    '3. userData safety copies attendances.db.pre-local-restore.* / repair.* — copy aside first, then restore via app if needed.',
    '4. Windows live DB — only after Mac cloud verify; use Full re-sync from cloud. Do not delete Windows attendances.db.',
    '5. recovery.dat.superseded-* — indicates canonical key adoption; do not delete; set a new recovery password after key adopt.',
  ];

  const outPath = process.env.CN_INVENTORY_OUT
    ? path.resolve(process.env.CN_INVENTORY_OUT)
    : null;
  const text = JSON.stringify(report, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, text + '\n', 'utf8');
    console.log('[inventory] wrote', outPath);
  }
  console.log(text);
}

main();

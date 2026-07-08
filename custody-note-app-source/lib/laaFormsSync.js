'use strict';

const fs = require('fs');
const path = require('path');
const laaManifest = require('./laaFormsManifest');

const REMOTE_MANIFEST_PATH = '/api/laa-forms/manifest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LOG_NAME = 'cn-laa-forms.log';

function appendLog(userDataDir, line) {
  if (!userDataDir) return;
  try {
    const logPath = path.join(userDataDir, LOG_NAME);
    const ts = new Date().toISOString();
    fs.appendFileSync(logPath, '[' + ts + '] ' + line + '\n', 'utf8');
  } catch (_) {}
}

function readState(userDataDir) {
  const statePath = path.join(userDataDir, 'cn-laa-forms-state.json');
  if (!fs.existsSync(statePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function writeState(userDataDir, state) {
  const statePath = path.join(userDataDir, 'cn-laa-forms-state.json');
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    appendLog(userDataDir, 'state write failed: ' + (err && err.message));
  }
}

function ensureUserDataDir(userDataDir) {
  const dir = path.join(userDataDir, 'laa-official-forms');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function copyBundledManifestToUserData(bundledDir, userDataDir) {
  const src = path.join(bundledDir, 'manifest.json');
  const destDir = ensureUserDataDir(userDataDir);
  const dest = path.join(destDir, 'manifest.json');
  if (!fs.existsSync(src)) return null;
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
  }
  return laaManifest.readManifestFile(dest);
}

function getActiveManifest(bundledDir, userDataDir) {
  const userDir = path.join(userDataDir, 'laa-official-forms');
  const userManifestPath = path.join(userDir, 'manifest.json');
  let manifest = laaManifest.readManifestFile(userManifestPath);
  if (manifest && laaManifest.validateManifest(manifest)) {
    const allOk = laaManifest.FORM_TYPES.every(function (ft) {
      return laaManifest.resolveTemplatePath(ft, manifest, userDir);
    });
    if (allOk) return { manifest, baseDir: userDir, source: 'downloaded' };
  }
  const bundledManifestPath = path.join(bundledDir, 'manifest.json');
  manifest = laaManifest.readManifestFile(bundledManifestPath);
  if (manifest && laaManifest.validateManifest(manifest)) {
    return { manifest, baseDir: bundledDir, source: 'bundled' };
  }
  return null;
}

function resolveTemplatePath(formType, bundledDir, userDataDir) {
  const userDir = path.join(userDataDir, 'laa-official-forms');
  const userManifest = laaManifest.readManifestFile(path.join(userDir, 'manifest.json'));
  if (userManifest) {
    const userPath = laaManifest.resolveTemplatePath(formType, userManifest, userDir);
    if (userPath) return userPath;
  }
  const bundledManifest = laaManifest.readManifestFile(path.join(bundledDir, 'manifest.json'));
  if (bundledManifest) {
    return laaManifest.resolveTemplatePath(formType, bundledManifest, bundledDir);
  }
  return null;
}

async function downloadFormPdf(formType, entry, userDataDir, httpGetBinary, apiBaseUrl) {
  const userDir = ensureUserDataDir(userDataDir);
  const url = apiBaseUrl.replace(/\/$/, '') + '/api/laa-forms/' + encodeURIComponent(formType) + '/' + encodeURIComponent(entry.filename);
  const resp = await httpGetBinary(url, 30000);
  if (!resp || !resp.ok || !resp.buffer || !resp.buffer.length) {
    throw new Error('Download failed for ' + formType + ' (HTTP ' + (resp && resp.statusCode) + ')');
  }
  const dest = path.join(userDir, entry.filename);
  fs.writeFileSync(dest, resp.buffer);
  if (!laaManifest.verifyFileSha256(dest, entry.sha256)) {
    try { fs.unlinkSync(dest); } catch (_) {}
    throw new Error('Checksum mismatch after download for ' + formType);
  }
  return dest;
}

async function ensureTemplates(opts) {
  const bundledDir = opts.bundledDir;
  const userDataDir = opts.userDataDir;
  const httpGet = opts.httpGet;
  const httpGetBinary = opts.httpGetBinary;
  const apiBaseUrl = opts.apiBaseUrl || 'https://custodynote.com';
  const forceRemote = !!(opts && opts.forceRemote);
  const skipRemote = !!(opts && opts.skipRemote);
  const state = readState(userDataDir);
  const now = Date.now();
  const lastCheck = state.lastCheckAt ? Date.parse(state.lastCheckAt) : 0;
  const shouldFetchRemote = !skipRemote && (forceRemote || !lastCheck || (now - lastCheck) >= CHECK_INTERVAL_MS);

  let active = getActiveManifest(bundledDir, userDataDir);
  if (!active) {
    appendLog(userDataDir, 'ERROR: no valid bundled LAA manifest');
    return { ok: false, error: 'LAA form templates are missing. Please reinstall Custody Note.', forms: {} };
  }

  const forms = laaManifest.listFormStatus(active.manifest, active.baseDir, active.source);
  const missing = laaManifest.FORM_TYPES.filter(function (ft) { return !forms[ft].ok; });
  if (missing.length) {
    appendLog(userDataDir, 'ERROR: missing templates: ' + missing.join(', '));
    return {
      ok: false,
      error: 'LAA form template(s) missing: ' + missing.join(', ') + '. Please reinstall Custody Note.',
      forms,
    };
  }

  let updated = false;
  const updatedForms = [];

  if (shouldFetchRemote && httpGet && httpGetBinary) {
    try {
      const manifestUrl = apiBaseUrl.replace(/\/$/, '') + REMOTE_MANIFEST_PATH;
      const resp = await httpGet(manifestUrl, 12000);
      state.lastCheckAt = new Date().toISOString();
      if (resp && resp.ok && resp.data) {
        let remote;
        try { remote = JSON.parse(resp.data); } catch (e) {
          appendLog(userDataDir, 'remote manifest parse failed: ' + e.message);
        }
        if (remote && laaManifest.validateManifest(remote)) {
          const userDir = ensureUserDataDir(userDataDir);
          let localForCompare = laaManifest.readManifestFile(path.join(userDir, 'manifest.json'));
          if (!localForCompare) {
            localForCompare = laaManifest.readManifestFile(path.join(bundledDir, 'manifest.json'));
          }
          const pending = laaManifest.compareManifests(localForCompare, remote);
          if (pending.length) {
            copyBundledManifestToUserData(bundledDir, userDataDir);
            for (const item of pending) {
              await downloadFormPdf(item.formType, item.entry, userDataDir, httpGetBinary, apiBaseUrl);
              updatedForms.push(item.formType + ' ' + item.entry.version);
              appendLog(userDataDir, 'downloaded ' + item.formType + ' ' + item.entry.version);
            }
            fs.writeFileSync(path.join(userDir, 'manifest.json'), JSON.stringify(remote, null, 2), 'utf8');
            updated = true;
            active = getActiveManifest(bundledDir, userDataDir);
            if (active) {
              Object.assign(forms, laaManifest.listFormStatus(active.manifest, active.baseDir, active.source));
            }
          }
        }
      } else if (resp && resp.statusCode === 404) {
        appendLog(userDataDir, 'remote manifest not yet published (404) — using bundled');
      }
    } catch (err) {
      appendLog(userDataDir, 'remote check failed: ' + (err && err.message));
    }
    writeState(userDataDir, state);
  }

  return {
    ok: true,
    forms,
    updated,
    updatedForms,
    lastCheckAt: state.lastCheckAt || null,
    source: active.source,
  };
}

module.exports = {
  REMOTE_MANIFEST_PATH,
  appendLog,
  ensureUserDataDir,
  getActiveManifest,
  resolveTemplatePath,
  ensureTemplates,
  readState,
};

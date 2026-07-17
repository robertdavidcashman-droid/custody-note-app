'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORM_TYPES = ['crm1', 'crm2', 'crm3', 'declaration'];

function readManifestFile(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.forms) return null;
    return raw;
  } catch (_) {
    return null;
  }
}

function validateManifest(manifest) {
  if (!manifest || !manifest.forms) return false;
  return FORM_TYPES.every(function (ft) {
    const entry = manifest.forms[ft];
    return entry && entry.filename && entry.version && entry.sha256;
  });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function verifyFileSha256(filePath, expectedSha) {
  if (!filePath || !fs.existsSync(filePath) || !expectedSha) return false;
  try {
    return sha256File(filePath) === String(expectedSha).toLowerCase();
  } catch (_) {
    return false;
  }
}

function getFormEntry(manifest, formType) {
  if (!manifest || !manifest.forms) return null;
  return manifest.forms[formType] || null;
}

function getFormFilename(manifest, formType) {
  const entry = getFormEntry(manifest, formType);
  return entry ? entry.filename : null;
}

function resolveTemplatePath(formType, manifest, baseDir) {
  const entry = getFormEntry(manifest, formType);
  if (!entry || !baseDir) return null;
  const full = path.join(baseDir, entry.filename);
  if (!fs.existsSync(full)) return null;
  if (!verifyFileSha256(full, entry.sha256)) return null;
  return full;
}

function listFormStatus(manifest, baseDir, source) {
  const out = {};
  FORM_TYPES.forEach(function (ft) {
    const entry = getFormEntry(manifest, ft);
    const resolved = resolveTemplatePath(ft, manifest, baseDir);
    out[ft] = {
      formType: ft,
      version: entry ? entry.version : null,
      date: entry ? entry.date : null,
      label: entry ? entry.label : ft,
      filename: entry ? entry.filename : null,
      source: resolved ? source : null,
      ok: !!resolved,
    };
  });
  return out;
}

function compareManifests(local, remote) {
  const updates = [];
  if (!local || !remote || !remote.forms) return updates;
  FORM_TYPES.forEach(function (ft) {
    const loc = getFormEntry(local, ft);
    const rem = getFormEntry(remote, ft);
    if (!rem || !rem.sha256) return;
    if (!loc || loc.sha256 !== rem.sha256) {
      updates.push({ formType: ft, entry: rem });
    }
  });
  return updates;
}

module.exports = {
  FORM_TYPES,
  readManifestFile,
  validateManifest,
  sha256File,
  verifyFileSha256,
  getFormEntry,
  getFormFilename,
  resolveTemplatePath,
  listFormStatus,
  compareManifests,
};

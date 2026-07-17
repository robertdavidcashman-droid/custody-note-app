'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'data', 'laa-official-forms', 'manifest.json');
const laaManifest = require('../lib/laaFormsManifest');

describe('LAA forms manifest', () => {
  it('bundled manifest.json exists and validates', () => {
    const manifest = laaManifest.readManifestFile(manifestPath);
    assert.ok(manifest, 'manifest must parse');
    assert.ok(laaManifest.validateManifest(manifest), 'manifest must include all four forms');
  });

  it('each bundled PDF matches manifest sha256', () => {
    const manifest = laaManifest.readManifestFile(manifestPath);
    const baseDir = path.join(root, 'data', 'laa-official-forms');
    laaManifest.FORM_TYPES.forEach(function (ft) {
      const entry = laaManifest.getFormEntry(manifest, ft);
      const filePath = path.join(baseDir, entry.filename);
      assert.ok(fs.existsSync(filePath), ft + ' PDF must exist: ' + entry.filename);
      assert.ok(
        laaManifest.verifyFileSha256(filePath, entry.sha256),
        ft + ' sha256 must match manifest'
      );
      assert.ok(laaManifest.resolveTemplatePath(ft, manifest, baseDir), ft + ' must resolve');
    });
  });

  it('compareManifests detects sha changes', () => {
    const local = laaManifest.readManifestFile(manifestPath);
    const remote = JSON.parse(JSON.stringify(local));
    remote.forms.crm1.sha256 = 'deadbeef';
    const updates = laaManifest.compareManifests(local, remote);
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].formType, 'crm1');
  });
});

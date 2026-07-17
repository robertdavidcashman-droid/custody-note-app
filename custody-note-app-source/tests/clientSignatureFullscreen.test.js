'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const attachment = require('../lib/clientSignatureAttachment');

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const stylesSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

describe('clientSignatureAttachment', () => {
  it('builds a dated PNG filename from form date', () => {
    assert.strictEqual(
      attachment.buildClientSignatureAttachmentName({ date: '2026-06-07' }),
      'Client_Signature_20260607.png'
    );
  });

  it('upserts a client signature attachment and replaces prior entries', () => {
    const formData = {
      date: '2026-06-07',
      photos: {
        attachments: [
          { name: 'Other.pdf', signatureKey: undefined },
          { name: 'Old.png', signatureKey: 'clientSig' },
        ],
      },
    };
    const entry = attachment.upsertClientSignatureAttachment(formData, 'data:image/png;base64,abc');
    assert.strictEqual(formData.photos.attachments.length, 2);
    assert.strictEqual(entry.signatureKey, 'clientSig');
    assert.strictEqual(entry.documentType, 'declaration');
    assert.strictEqual(entry.customDocumentType, 'Client signature');
    assert.strictEqual(entry.mime, 'image/png');
    assert.ok(formData.photos.attachments.every(function(a) { return a.signatureKey !== 'clientSig' || a === entry; }));
  });

  it('removeClientSignatureAttachment drops only clientSig entries', () => {
    const formData = {
      photos: {
        attachments: [
          { name: 'Keep.pdf' },
          { name: 'Sig.png', signatureKey: 'clientSig' },
        ],
      },
    };
    attachment.removeClientSignatureAttachment(formData);
    assert.deepStrictEqual(formData.photos.attachments.map(function(a) { return a.name; }), ['Keep.pdf']);
  });
});

describe('client signature fullscreen wiring', () => {
  it('loads clientSignatureAttachment before app.js', () => {
    const libMatch = indexSrc.match(/<script src="lib\/clientSignatureAttachment\.js"><\/script>/);
    const appMatch = indexSrc.match(/<script src="app\.js"><\/script>/);
    assert.ok(libMatch, 'clientSignatureAttachment script tag missing');
    assert.ok(appMatch, 'app.js script tag missing');
    assert.ok(libMatch.index < appMatch.index, 'clientSignatureAttachment must load before app.js');
  });

  it('uses a prominent full-screen button for clientSig with attachment save', () => {
    assert.match(appSrc, /btn-client-sign-fullscreen/);
    assert.match(appSrc, /Sign full screen/);
    assert.match(appSrc, /saveAsAttachment:\s*true/);
    assert.match(appSrc, /showLaaDeclaration:\s*true/);
    assert.match(appSrc, /cancelClears:\s*true/);
    assert.match(appSrc, /ClientSignatureAttachment\.upsertClientSignatureAttachment/);
    assert.match(appSrc, /ClientSignatureAttachment\.removeClientSignatureAttachment/);
  });

  it('full-screen client sign shows LAA declaration panel before the pad', () => {
    assert.match(appSrc, /sig-fs-decl-panel/);
    assert.match(appSrc, /buildLaaDeclarationFormHtmlForUi/);
    assert.match(appSrc, /showLaaDeclaration/);
  });

  it('labels client full-screen confirm as Save, not Done', () => {
    assert.match(appSrc, /doneBtn\.textContent = saveAsAttachment \? 'Save' : 'Done'/);
  });

  it('keeps signature pads white in dark mode for contrast', () => {
    assert.match(stylesSrc, /html\.dark \.signature-canvas \{ background: #ffffff/);
    assert.match(stylesSrc, /\.signature-canvas \{[\s\S]*background: #ffffff/);
  });

  it('styles full-screen signature controls for high visibility', () => {
    assert.match(stylesSrc, /\.btn-client-sign-fullscreen/);
    assert.match(stylesSrc, /\.sig-fs-btn-save/);
    assert.match(stylesSrc, /\.sig-fullscreen-overlay \.sig-fs-hint/);
    assert.match(stylesSrc, /\.sig-fs-decl-panel/);
  });

  it('clientSignatureAttachment uses browser-safe export', () => {
    const src = fs.readFileSync(path.join(root, 'lib', 'clientSignatureAttachment.js'), 'utf8');
    assert.match(src, /typeof module !== 'undefined' && module\.exports/);
    assert.match(src, /window\.ClientSignatureAttachment = ClientSignatureAttachment/);
  });
});

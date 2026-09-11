'use strict';

/**
 * Draft GitHub releases 404 on public browser_download_url
 * (`…/releases/download/untagged-…/…`). upload-mac-release-assets must verify
 * via the authenticated API asset URL instead — otherwise CI fails after
 * Gatekeeper already passed (see run 33794758014).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'scripts', 'upload-mac-release-assets.mjs');
const src = fs.readFileSync(srcPath, 'utf8');

describe('upload-mac-release-assets — draft-safe remote verify', () => {
  it('documents that draft public download URLs must not be used for verify', () => {
    assert.match(src, /browser_download_url/);
    assert.match(src, /draft/i);
    assert.match(src, /application\/octet-stream/);
    assert.match(src, /releaseAssetDownloadUrl|asset\.url/);
  });

  it('prefers API asset.url over browser_download_url for drafts', async () => {
    const mod = await import('../scripts/upload-mac-release-assets.mjs');
    const draftAsset = {
      name: 'Custody-Note-1.9.80-arm64.dmg',
      url: 'https://api.github.com/repos/robertcashman-bit/custody-note-app/releases/assets/999',
      browser_download_url:
        'https://github.com/robertcashman-bit/custody-note-app/releases/download/untagged-abc/Custody-Note-1.9.80-arm64.dmg',
    };
    assert.strictEqual(
      mod.releaseAssetDownloadUrl(draftAsset, true),
      draftAsset.url,
      'draft verify must use API asset URL, not public /releases/download/…',
    );
    assert.doesNotMatch(
      mod.releaseAssetDownloadUrl(draftAsset, true),
      /\/releases\/download\//,
    );
  });

  it('downloadReleaseAssetBuffer fetches API URL with octet-stream Accept (draft)', async () => {
    const mod = await import('../scripts/upload-mac-release-assets.mjs');
    const body = Buffer.from('notarized-dmg-bytes');
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), headers: init.headers || {} });
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      };
    };
    try {
      const asset = {
        name: 'Custody-Note-1.9.80-arm64.dmg',
        url: 'https://api.github.com/repos/robertcashman-bit/custody-note-app/releases/assets/999',
        browser_download_url:
          'https://github.com/robertcashman-bit/custody-note-app/releases/download/untagged-abc/Custody-Note-1.9.80-arm64.dmg',
      };
      const buf = await mod.downloadReleaseAssetBuffer(asset, { Authorization: 'Bearer test' }, {
        releaseIsDraft: true,
      });
      assert.strictEqual(buf.toString('utf8'), 'notarized-dmg-bytes');
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, asset.url);
      assert.doesNotMatch(calls[0].url, /\/releases\/download\//);
      assert.strictEqual(calls[0].headers.Accept, 'application/octet-stream');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('remoteSha512 matches local sha512 when API download succeeds on draft', async () => {
    const mod = await import('../scripts/upload-mac-release-assets.mjs');
    const body = Buffer.from('same-bytes-as-local');
    const expectedSha = createHash('sha512').update(body).digest('base64');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      assert.doesNotMatch(String(url), /\/releases\/download\//);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      };
    };
    try {
      const asset = {
        name: 'Custody-Note-1.9.80-arm64.dmg',
        url: 'https://api.github.com/repos/robertcashman-bit/custody-note-app/releases/assets/999',
        browser_download_url:
          'https://github.com/robertcashman-bit/custody-note-app/releases/download/untagged-abc/Custody-Note-1.9.80-arm64.dmg',
      };
      const remoteSha = await mod.remoteSha512(asset, {}, { releaseIsDraft: true });
      assert.strictEqual(remoteSha, expectedSha);
      assert.strictEqual(remoteSha, mod.sha512Base64(body));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses public-only assets while release is draft', async () => {
    const mod = await import('../scripts/upload-mac-release-assets.mjs');
    const publicOnly = {
      name: 'Custody-Note-1.9.80-arm64.dmg',
      browser_download_url:
        'https://github.com/robertcashman-bit/custody-note-app/releases/download/untagged-abc/Custody-Note-1.9.80-arm64.dmg',
    };
    assert.strictEqual(mod.releaseAssetDownloadUrl(publicOnly, true), null);
    await assert.rejects(
      () => mod.downloadReleaseAssetBuffer(publicOnly, {}, { releaseIsDraft: true }),
      /no API asset URL/,
    );
  });
});

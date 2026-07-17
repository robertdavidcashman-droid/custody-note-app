#!/usr/bin/env node
/**
 * Generates build/custody-note.icns for the macOS build target.
 *
 * Source:  icon-512.svg (repo root)
 * Output:  build/custody-note.icns
 *
 * Strategy: rasterise the SVG to a 1024x1024 master PNG via sharp, then
 * emit the standard macOS iconset sizes into a temporary .iconset folder
 * and run `iconutil -c icns` to produce the final .icns. iconutil is a
 * built-in macOS tool (no new dependency required) and only exists on
 * macOS — this script is therefore macOS-only by design and is only ever
 * invoked by `npm run build:mac`. It must never be wired into the
 * Windows build pipeline.
 *
 * On non-macOS hosts the script exits with a clear error rather than
 * producing a half-built icon.
 */
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..');
const SRC_SVG = join(APP_ROOT, 'icon-512.svg');
const BUILD_DIR = join(APP_ROOT, 'build');
const OUT_ICNS = join(BUILD_DIR, 'custody-note.icns');

function fail(msg) {
  console.error(`[build:icns] FAIL: ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`[build:icns] ${msg}`);
}

if (process.platform !== 'darwin') {
  fail(
    `must be run on macOS (current platform: ${process.platform}). ` +
    `iconutil is only available on macOS. The Windows .ico build is ` +
    `handled separately by scripts/build-icon.mjs.`
  );
}

if (!existsSync(SRC_SVG)) {
  fail(`source icon not found at ${SRC_SVG}`);
}

if (!existsSync(BUILD_DIR)) {
  mkdirSync(BUILD_DIR, { recursive: true });
}

/* The standard macOS iconset, per Apple's Human Interface Guidelines.
 * iconutil expects exactly these filenames inside the .iconset folder. */
const ICONSET_SIZES = [
  { name: 'icon_16x16.png',       px: 16 },
  { name: 'icon_16x16@2x.png',    px: 32 },
  { name: 'icon_32x32.png',       px: 32 },
  { name: 'icon_32x32@2x.png',    px: 64 },
  { name: 'icon_128x128.png',     px: 128 },
  { name: 'icon_128x128@2x.png',  px: 256 },
  { name: 'icon_256x256.png',     px: 256 },
  { name: 'icon_256x256@2x.png',  px: 512 },
  { name: 'icon_512x512.png',     px: 512 },
  { name: 'icon_512x512@2x.png',  px: 1024 },
];

const tmp = mkdtempSync(join(tmpdir(), 'cn-icns-'));
const iconset = join(tmp, 'custody-note.iconset');
mkdirSync(iconset, { recursive: true });

try {
  const svgBuf = readFileSync(SRC_SVG);
  info(`source: icon-512.svg (${svgBuf.length} bytes)`);

  /* Render the SVG at 1024x1024 once, then downscale from that master.
   * Going SVG -> 1024 PNG -> smaller sizes gives crisper small icons
   * than rendering the SVG fresh at each size. */
  const masterPng = await sharp(svgBuf, { density: 384 })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  info(`rendered 1024x1024 master (${masterPng.length} bytes)`);

  for (const spec of ICONSET_SIZES) {
    const out = join(iconset, spec.name);
    /* PNGs intended for an .iconset must be 72 DPI. The @2x suffix in
     * the filename is what tells macOS this is a retina variant — the
     * pHYs chunk must NOT advertise a different physical size. By
     * default sharp inherits density from the input (here 384 from the
     * SVG render), which makes iconutil reject the iconset as
     * "Invalid Iconset." withMetadata({ density: 72 }) forces a
     * compliant pHYs chunk. */
    await sharp(masterPng)
      .resize(spec.px, spec.px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .withMetadata({ density: 72 })
      .png()
      .toFile(out);
  }
  info(`generated ${ICONSET_SIZES.length} iconset entries (72 dpi)`);

  /* Belt-and-braces: explicitly force DPI to 72 via sips. This is a
   * built-in macOS tool and is the canonical way to set PNG DPI for
   * iconset compliance. Without this some sharp versions still emit
   * a pHYs chunk that iconutil rejects. */
  for (const spec of ICONSET_SIZES) {
    const out = join(iconset, spec.name);
    const sips = spawnSync('sips', ['-s', 'dpiHeight', '72', '-s', 'dpiWidth', '72', out], {
      encoding: 'utf8',
    });
    if (sips.status !== 0) {
      fail(`sips failed setting dpi on ${spec.name}: ${(sips.stderr || sips.stdout || '').trim()}`);
    }
  }
  info(`normalised dpi via sips`);

  const r = spawnSync('iconutil', ['-c', 'icns', '-o', OUT_ICNS, iconset], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    fail(
      `iconutil failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim()}\n` +
      `(iconset retained for debug at: ${iconset})`
    );
  }

  if (!existsSync(OUT_ICNS)) {
    fail(`iconutil reported success but ${OUT_ICNS} does not exist`);
  }
  info(`wrote ${OUT_ICNS}`);
} finally {
  /* On success we clean the tmp iconset. On a failed iconutil run, the
   * tmp folder is preserved because fail() calls process.exit(1) before
   * this finally executes against an uncaught error path — except when
   * an uncaught error throws out of the try block, in which case we
   * still want to leave the iconset for diagnosis. The simplest rule
   * that satisfies both is: only clean when the .icns exists. */
  if (existsSync(OUT_ICNS)) {
    try { rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
}

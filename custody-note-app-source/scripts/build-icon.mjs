import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pngPath = path.join(root, 'custody-note-icon.png');
const icoPath = path.join(root, 'custody-note.ico');
const square256Path = path.join(root, 'custody-note-icon-256.png');

const img = sharp(pngPath);
const meta = await img.metadata();
const { width, height } = meta;
const size = Math.min(width || 256, height || 256);
const left = Math.floor(((width || 256) - size) / 2);
const top = Math.floor(((height || 256) - size) / 2);

await sharp(pngPath)
  .extract({ left, top, width: size, height: size })
  .resize(256, 256)
  .png()
  .toFile(square256Path);

const buf = await pngToIco(square256Path);
fs.writeFileSync(icoPath, buf);
try { fs.unlinkSync(square256Path); } catch (_) {}
console.log('Created', icoPath);

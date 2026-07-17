import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pngPath = path.join(__dirname, '..', 'custody-note-icon.png');
const icoPath = path.join(__dirname, '..', 'custody-note.ico');

const buf = await pngToIco(pngPath);
fs.writeFileSync(icoPath, buf);
console.log('Created', icoPath);

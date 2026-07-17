const fs = require('fs');
const pdfParse = require('pdf-parse');

async function main() {
  const filePath = process.argv.slice(2).join(' ').trim();
  if (!filePath) {
    console.error('Usage: node scripts/dump-pdf-text.js <path-to-pdf>');
    process.exit(1);
  }
  const buf = fs.readFileSync(filePath);
  const result = await pdfParse(buf);
  const text = result && result.text ? result.text : '';
  const lines = text.split(/\r?\n/);
  console.log(lines.slice(0, 120).join('\n'));
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});


const pdfParse = require('pdf-parse');
const fs = require('fs');

const regionMap = {
  'BR': 'Avon & Somerset / Dorset / Devon & Cornwall / Wiltshire / Gloucestershire',
  'BG': 'Sussex / Kent / Surrey',
  'BM': 'West Midlands / Warwickshire',
  'EA': 'Essex / Hertfordshire / Bedfordshire / Cambridgeshire / Norfolk / Suffolk',
  'LS': 'West Yorkshire / South Yorkshire / Humberside / North Yorkshire',
  'LN': 'London',
  'LV': 'Merseyside',
  'MA': 'Greater Manchester / Lancashire / Cheshire / Cumbria',
  'NE': 'Northumbria / Durham / Cleveland',
  'NT': 'Nottinghamshire / Derbyshire / Lincolnshire / Northamptonshire / Leicestershire',
  'RD': 'Thames Valley',
  'SY': 'Hampshire / Isle of Wight',
  'WA': 'Wales',
  'HB': 'London',
};

function getRegion(code) {
  if (!code) return '';
  const prefix = code.replace(/[0-9]/g, '');
  return regionMap[prefix] || prefix;
}

function toTitleCase(str) {
  if (!str) return '';
  return str.replace(/\b\w+/g, w => {
    const upper = w.toUpperCase();
    if (['BTP', 'HM', 'HMC', 'RAF', 'RMP', 'MOD', 'SIB'].includes(upper)) return upper;
    if (['OF', 'ON', 'IN', 'THE', 'AND', 'LE', 'LA', 'DE', 'DU', 'EN'].includes(upper)) return upper.toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
}

const STATION_ID_RE = /^[A-Z]{2}\d{3}[A-Z]?$/;
const SCHEME_CODE_RE = /^\d{4}$/;
const PAGE_NUM_RE = /^\d{1,3}$/;
const HEADER_LINES = [
  'PS Scheme Name', 'PS', 'Scheme', 'Code',
  'Police Station Name', 'Police', 'station', 'ID',
];

async function main() {
  const pdfArg = process.argv[2];
  const candidates = pdfArg
    ? [pdfArg]
    : ['crime-lower-feb-2025.pdf', 'crime-lower-jan26.pdf'];
  let pdfFile = null;
  for (const c of candidates) {
    const p = c.startsWith('/') || /^[A-Za-z]:/.test(c) ? c : __dirname + '/' + c;
    if (fs.existsSync(p)) { pdfFile = p; break; }
  }
  if (!pdfFile) {
    console.error('No PDF found. Tried:', candidates.join(', '));
    process.exit(1);
  }
  console.log('Parsing:', pdfFile);
  const buf = fs.readFileSync(pdfFile);
  const data = await pdfParse(buf);
  const text = data.text;

  const annexStart = text.indexOf('Annex A \u2013 Police station and police station \nscheme codes');
  if (annexStart < 0) {
    console.error('Could not find start of Annex A');
    process.exit(1);
  }

  const annexEnd = text.indexOf('Annex A1 \u2013 Claiming travel time', annexStart + 100);
  if (annexEnd < 0) {
    console.error('Could not find end of Annex A (start of Annex A1)');
    process.exit(1);
  }

  const section = text.substring(annexStart, annexEnd);
  const rawLines = section.split('\n');

  const stations = [];
  let currentScheme = '';
  let currentSchemeCode = '';
  let nameBuffer = '';

  function isHeaderOrJunk(line) {
    if (HEADER_LINES.includes(line)) return true;
    if (PAGE_NUM_RE.test(line)) return true;
    if (line.startsWith('Travel time may be payable')) return true;
    if (line.startsWith('to the Fixed Fee')) return true;
    if (line.startsWith('for attendances at')) return true;
    if (line.startsWith('listed against this')) return true;
    if (line.startsWith('scheme \u2013 see')) return true;
    if (line.startsWith('You might find')) return true;
    if (line.startsWith('station or scheme')) return true;
    if (line === 'Annex A \u2013 Police station and police station') return true;
    if (line === 'scheme codes') return true;
    return false;
  }

  function flushStation(stationId) {
    const rawName = nameBuffer.replace(/\s+/g, ' ').trim();
    nameBuffer = '';
    if (!rawName || !stationId) return;

    const isNonPoliceVenue = /NON[\s-]+POLICE\s+STATION/i.test(rawName);
    let displayName;
    if (isNonPoliceVenue) {
      const cleaned = rawName.replace(/\s*NON[\s-]+POLICE\s+STATION\s*/i, ' ').replace(/\s+/g, ' ').trim();
      const baseName = cleaned || (currentScheme || 'Scheme venue');
      displayName = toTitleCase(baseName) + ' (non-police venue)';
    } else {
      displayName = toTitleCase(rawName);
    }

    stations.push({
      name: displayName,
      code: stationId,
      scheme: currentScheme,
      schemeCode: currentSchemeCode,
      region: getRegion(stationId),
      kind: isNonPoliceVenue ? 'venue' : 'station',
    });
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;
    if (isHeaderOrJunk(line)) continue;

    if (STATION_ID_RE.test(line)) {
      flushStation(line);
      continue;
    }

    const contdMatch = line.match(/^(.+?)\s*\(contd\.\)$/i);
    if (contdMatch) {
      nameBuffer = '';
      continue;
    }

    const schemeWithStation = line.match(/^(.+?)\s+(\d{4})\s+(.+)$/);
    if (schemeWithStation) {
      if (nameBuffer.trim()) {
        flushStation(null);
      }
      currentScheme = schemeWithStation[1].trim();
      currentSchemeCode = schemeWithStation[2];
      nameBuffer = schemeWithStation[3];
      continue;
    }

    const schemeCodeOnLine = line.match(/^(\d{4})\s+(.+)$/);
    if (schemeCodeOnLine) {
      if (nameBuffer.trim()) {
        currentScheme = nameBuffer.replace(/\s+/g, ' ').trim();
      }
      currentSchemeCode = schemeCodeOnLine[1];
      nameBuffer = schemeCodeOnLine[2];
      continue;
    }

    if (SCHEME_CODE_RE.test(line)) {
      if (nameBuffer.trim()) {
        currentScheme = nameBuffer.replace(/\s+/g, ' ').trim();
      }
      currentSchemeCode = line;
      nameBuffer = '';
      continue;
    }

    nameBuffer += ' ' + line;
  }

  const deduped = [];
  const seen = new Set();
  for (const s of stations) {
    const key = s.code;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(s);
    }
  }

  console.log('Total stations extracted:', deduped.length);
  console.log('Unique schemes:', new Set(deduped.map(s => s.scheme)).size);
  deduped.slice(0, 10).forEach(s => console.log(JSON.stringify(s)));

  fs.writeFileSync(__dirname + '/police-stations-laa.json', JSON.stringify(deduped, null, 2));
  console.log('Written to police-stations-laa.json');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

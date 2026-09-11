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

/** Annex A page-break leftovers like "Central London (Contd)" must not glue into station names. */
const CONTD_FRAGMENT_RE = /\s*[A-Za-z0-9 &/',.-]+\s*\(contd\.?\)\s*/gi;
const CONTD_LINE_RE = /^(.+?)\s*\(contd\.?\)$/i;

/** Llanelli transitional footnote sometimes concatenates onto the scheme title in PDF text. */
const LLANELLI_FOOTNOTE_RE = /\s*These Police Station ID codes must be used for Matters starting before[\s\S]*Llanelli Police Station Scheme\.?/i;

/**
 * Normalise scheme titles extracted from Annex A PDF text.
 * Keeps known PDF quirks (PROVST etc.) but strips footnotes and obvious OCR typos
 * that would otherwise poison every row in the scheme.
 */
function cleanSchemeName(scheme) {
  if (!scheme) return '';
  let s = String(scheme).replace(/\s+/g, ' ').trim();
  s = s.replace(LLANELLI_FOOTNOTE_RE, '').trim();
  // Known fee-sheet spelling for scheme 2005 (PDF sometimes reads Sedgemore / Dane).
  if (/^Sedgemore\s*\/\s*Taunton\s+Dane$/i.test(s)) {
    s = 'Sedgemoor / Taunton Deane';
  }
  return s;
}

/** Strip continued-heading leftovers from a station name buffer. */
function stripContinuedHeading(name) {
  if (!name) return '';
  return String(name)
    .replace(CONTD_FRAGMENT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve display name for a station ID.
 * Nameless Annex A IDs (e.g. MA100 under GREAT BROUGHTON) inherit the previous
 * station name in the same scheme rather than being dropped.
 */
function resolveStationName(rawName, opts) {
  const options = opts || {};
  const cleaned = stripContinuedHeading(rawName);
  if (cleaned) return cleaned;
  if (options.lastStationName) return String(options.lastStationName).trim();
  if (options.currentScheme) return String(options.currentScheme).trim();
  return '';
}

function buildStationRecord(stationId, rawName, ctx) {
  const context = ctx || {};
  const resolvedRaw = resolveStationName(rawName, {
    lastStationName: context.lastStationName,
    currentScheme: context.currentScheme,
  });
  if (!stationId || !resolvedRaw) return null;

  const isNonPoliceVenue = /NON[\s-]+POLICE\s+STATION/i.test(resolvedRaw);
  let displayName;
  if (isNonPoliceVenue) {
    const cleaned = resolvedRaw.replace(/\s*NON[\s-]+POLICE\s+STATION\s*/i, ' ').replace(/\s+/g, ' ').trim();
    const baseName = cleaned || (context.currentScheme || 'Scheme venue');
    displayName = toTitleCase(baseName) + ' (non-police venue)';
  } else {
    displayName = toTitleCase(resolvedRaw);
  }

  return {
    name: displayName,
    code: stationId,
    scheme: cleanSchemeName(context.currentScheme || ''),
    schemeCode: context.currentSchemeCode || '',
    region: getRegion(stationId),
    kind: isNonPoliceVenue ? 'venue' : 'station',
  };
}

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
  let lastStationName = '';

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
    // Discard Llanelli transitional footnote lines (scheme title stays "Llanelli").
    if (line.startsWith('These Police Station ID codes must be used')) return true;
    if (line.startsWith('for Matters starting before')) return true;
    if (line.startsWith('and on or after')) return true;
    if (line.startsWith('in the Llanelli Police Station Scheme')) return true;
    return false;
  }

  function flushStation(stationId) {
    const rawName = nameBuffer.replace(/\s+/g, ' ').trim();
    nameBuffer = '';
    const record = buildStationRecord(stationId, rawName, {
      currentScheme,
      currentSchemeCode,
      lastStationName,
    });
    if (!record) return;
    stations.push(record);
    lastStationName = record.name.replace(/\s*\(non-police venue\)\s*$/i, '').trim();
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;
    if (isHeaderOrJunk(line)) continue;

    if (STATION_ID_RE.test(line)) {
      flushStation(line);
      continue;
    }

    // Page-break scheme continuation heading — clear buffer, do not treat as a name.
    if (CONTD_LINE_RE.test(line)) {
      nameBuffer = '';
      continue;
    }

    const schemeWithStation = line.match(/^(.+?)\s+(\d{4})\s+(.+)$/);
    if (schemeWithStation) {
      if (nameBuffer.trim()) {
        flushStation(null);
      }
      currentScheme = cleanSchemeName(schemeWithStation[1].trim());
      currentSchemeCode = schemeWithStation[2];
      nameBuffer = schemeWithStation[3];
      lastStationName = '';
      continue;
    }

    const schemeCodeOnLine = line.match(/^(\d{4})\s+(.+)$/);
    if (schemeCodeOnLine) {
      if (nameBuffer.trim()) {
        currentScheme = cleanSchemeName(nameBuffer.replace(/\s+/g, ' ').trim());
      }
      currentSchemeCode = schemeCodeOnLine[1];
      nameBuffer = schemeCodeOnLine[2];
      lastStationName = '';
      continue;
    }

    if (SCHEME_CODE_RE.test(line)) {
      if (nameBuffer.trim()) {
        currentScheme = cleanSchemeName(nameBuffer.replace(/\s+/g, ' ').trim());
      }
      currentSchemeCode = line;
      nameBuffer = '';
      lastStationName = '';
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

module.exports = {
  cleanSchemeName,
  stripContinuedHeading,
  resolveStationName,
  buildStationRecord,
  toTitleCase,
  getRegion,
};

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

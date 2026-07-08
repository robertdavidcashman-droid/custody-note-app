#!/usr/bin/env node
/**
 * Build data/magistrates-courts.json from Open Court Data UK sitemap (HMCTS-sourced).
 * Run: node scripts/build-magistrates-courts.mjs
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { normalizeCourtList } from '../lib/magistratesCourtsSearch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outPath = path.join(root, 'data', 'magistrates-courts.json');
const SITEMAP_URL = 'https://opencourtdata.uk/sitemap/courts.xml';

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve, reject);
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

function slugFromLoc(loc) {
  const m = String(loc).match(/\/courts\/([^/]+)$/);
  return m ? m[1] : '';
}

function isMagistratesSlug(slug) {
  if (!slug) return false;
  if (/adminstration|finance|central-finance/i.test(slug)) return false;
  return /magistrates/i.test(slug);
}

function isUsableCourtName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) return false;
  if (/finance unit|adminstration|admin team/i.test(n)) return false;
  if (!/(court|courts|centre|center|justice)/i.test(n)) return false;
  return true;
}

function slugToFallbackName(slug) {
  return slug
    .replace(/-+/g, '-')
    .split('-')
    .filter(Boolean)
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && ['and', 'of', 'upon', 'the', 'in', 'on', 'at'].includes(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ')
    .replace(/Magistrates Court$/i, "Magistrates' Court")
    .replace(/\s+/g, ' ')
    .trim();
}

function titleFromHtml(html) {
  const m = String(html).match(/<title>([^|<]+)/i);
  if (!m) return null;
  const title = m[1].replace(/\s+/g, ' ').trim();
  if (!title || /court not found/i.test(title)) return null;
  return title;
}

async function fetchCourtTitle(slug) {
  const html = await fetchText(`https://opencourtdata.uk/courts/${slug}`);
  return titleFromHtml(html);
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  console.log('[build-magistrates-courts] Fetching sitemap…');
  const xml = await fetchText(SITEMAP_URL);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const slugs = [...new Set(locs.map(slugFromLoc).filter(isMagistratesSlug))].sort();
  console.log(`[build-magistrates-courts] Found ${slugs.length} magistrates court slugs`);

  const names = [];
  await mapPool(slugs, 12, async (slug) => {
    let name = null;
    try {
      name = await fetchCourtTitle(slug);
    } catch (err) {
      console.warn(`[build-magistrates-courts] fetch failed for ${slug}:`, err.message);
    }
    if (!name) name = slugToFallbackName(slug);
    if (isUsableCourtName(name)) names.push(name);
    return name;
  });

  const normalized = normalizeCourtList(names).filter(isUsableCourtName);
  fs.writeFileSync(outPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  console.log(`[build-magistrates-courts] Wrote ${normalized.length} courts to ${outPath}`);
}

main().catch((err) => {
  console.error('[build-magistrates-courts] Failed:', err);
  process.exit(1);
});

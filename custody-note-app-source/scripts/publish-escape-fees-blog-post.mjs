#!/usr/bin/env node
/**
 * Apply the police-station-escape-fees-2026 educational blog post to a
 * custody-note-website clone.
 *
 * Usage:
 *   WEBSITE_ROOT=../custody-note-website node scripts/publish-escape-fees-blog-post.mjs
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");
const WEBSITE_ROOT =
  (process.env.WEBSITE_ROOT && process.env.WEBSITE_ROOT.trim()) ||
  join(APP_ROOT, "..", "custody-note-website");
const PAYLOAD = join(
  APP_ROOT,
  "website-blog-payload",
  "police-station-escape-fees-2026",
);
const SLUG = "police-station-escape-fees-2026";

const ENTRY = `  {
    slug: "${SLUG}",
    title: "Police Station Escape Fees in 2026: The Note That Supports the Claim",
    excerpt:
      "Police station escape fees in 2026: the attendance note is the evidence. What the £650 threshold means, and what the note must show.",
    category: "Legal Aid",
    publishDate: "2026-08-20",
    updatedDate: "2026-08-20",
  },`;

function fail(msg) {
  console.error(`[publish-escape-fees] ${msg}`);
  process.exit(1);
}

if (!existsSync(WEBSITE_ROOT)) fail(`WEBSITE_ROOT not found: ${WEBSITE_ROOT}`);
if (!existsSync(PAYLOAD)) fail(`Payload missing: ${PAYLOAD}`);

const pageSrc = join(PAYLOAD, "page.tsx");
const staticPath = join(WEBSITE_ROOT, "lib", "staticBlogPosts.ts");
if (!existsSync(pageSrc)) fail(`Missing ${pageSrc}`);
if (!existsSync(staticPath)) fail(`Missing ${staticPath}`);

const pageDestDir = join(WEBSITE_ROOT, "app", "blog", SLUG);
const pageDest = join(pageDestDir, "page.tsx");
mkdirSync(pageDestDir, { recursive: true });
writeFileSync(pageDest, readFileSync(pageSrc));
console.log("[publish-escape-fees] Wrote", pageDest);

const imgDestDir = join(WEBSITE_ROOT, "public", "images", "blog", SLUG);
mkdirSync(imgDestDir, { recursive: true });
for (const name of ["featured.jpg", "featured.webp", "og.jpg"]) {
  const src = join(PAYLOAD, name);
  if (!existsSync(src)) fail(`Missing image ${src}`);
  copyFileSync(src, join(imgDestDir, name));
  console.log("[publish-escape-fees] Copied image", name);
}

let staticSrc = readFileSync(staticPath, "utf8");
if (staticSrc.includes(`slug: "${SLUG}"`)) {
  console.log("[publish-escape-fees] staticBlogPosts already has entry — leaving as-is");
} else {
  const marker = "export const STATIC_BLOG_POSTS: StaticBlogPost[] = [";
  const idx = staticSrc.indexOf(marker);
  if (idx < 0) fail("Could not find STATIC_BLOG_POSTS array in staticBlogPosts.ts");
  const insertAt = idx + marker.length;
  staticSrc =
    staticSrc.slice(0, insertAt) + "\n" + ENTRY + staticSrc.slice(insertAt);
  writeFileSync(staticPath, staticSrc);
  console.log("[publish-escape-fees] Inserted STATIC_BLOG_POSTS entry");
}

console.log("[publish-escape-fees] Done.");

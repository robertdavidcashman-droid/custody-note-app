#!/usr/bin/env node
/**
 * Converts seo-growth/blog-posts/custodynote.com/*.md → custody-note-website/data/blog-imports.json
 *
 * Usage:
 *   node seo-growth/scripts/publish-blog-from-markdown.mjs
 *   node seo-growth/scripts/publish-blog-from-markdown.mjs --stagger-weeks
 *
 * Env: WEBSITE_ROOT (default ../custody-note-website)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferCategory,
  markdownToHtml,
  parseFrontmatter,
  readJsonIfExists,
  slugify,
  writeJson,
} from "./markdown-blog-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const BLOG_SRC = path.join(__dirname, "..", "blog-posts", "custodynote.com");
const WEBSITE_ROOT =
  process.env.WEBSITE_ROOT?.trim() || path.join(APP_ROOT, "..", "custody-note-website");
const OUT_PATH = path.join(WEBSITE_ROOT, "data", "blog-imports.json");

/** Already live as dedicated static blog routes — skip re-import. */
const SKIP_SLUGS = new Set([
  "dscc-references-custody-records-and-attendance-notes",
  "ai-assisted-custody-notes-benefits-and-limits",
]);

const STAGGER_START = process.env.BLOG_STAGGER_START || "2026-06-20";

function staggerDate(index) {
  const d = new Date(`${STAGGER_START}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + index * 7);
  return d.toISOString().slice(0, 10);
}

function mdFileToPost(filePath, index, stagger) {
  const raw = fs.readFileSync(filePath, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  const slug = meta.slug || slugify(meta.title || path.basename(filePath, ".md"));
  if (SKIP_SLUGS.has(slug)) return null;

  const publishDate =
    stagger && process.argv.includes("--stagger-weeks")
      ? staggerDate(index)
      : (meta.publish_date || meta.last_updated || STAGGER_START).slice(0, 10);

  const contentHtml = markdownToHtml(body);
  const excerpt = meta.meta_description || meta.metaDescription || "";

  return {
    slug,
    title: meta.title,
    excerpt,
    category: inferCategory(meta.target_keyword || "", meta.title || ""),
    publishDate,
    updatedDate: (meta.last_updated || publishDate).slice(0, 10),
    author: meta.author || "Robert Cashman",
    contentHtml,
    source: "seo-growth",
    metaTitle: meta.meta_title || meta.metaTitle,
    metaDescription: excerpt,
    targetKeyword: meta.target_keyword,
  };
}

function main() {
  if (!fs.existsSync(BLOG_SRC)) {
    console.error("[publish-blog] Missing source dir:", BLOG_SRC);
    process.exit(1);
  }

  const existing = readJsonIfExists(OUT_PATH, { posts: [] });
  const releasePosts = (existing.posts || []).filter((p) => p.source === "changelog");
  const files = fs
    .readdirSync(BLOG_SRC)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const imported = [];
  let staggerIndex = 0;
  for (const file of files) {
    const post = mdFileToPost(path.join(BLOG_SRC, file), staggerIndex, true);
    if (!post) continue;
    imported.push(post);
    staggerIndex += 1;
  }

  const merged = {
    generatedAt: new Date().toISOString(),
    posts: [...imported, ...releasePosts].sort((a, b) => b.publishDate.localeCompare(a.publishDate)),
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeJson(OUT_PATH, merged);
  console.log(
    `[publish-blog] Wrote ${imported.length} imported posts (+ ${releasePosts.length} release posts) → ${OUT_PATH}`,
  );
}

main();

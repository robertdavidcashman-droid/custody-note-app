#!/usr/bin/env node
/**
 * Export sister-site SEO drafts (blog + local landing pages) into import-ready bundles.
 *
 * Output: seo-growth/exports/{site}/ — markdown + manifest.json for CMS import.
 *
 * Usage:
 *   node seo-growth/scripts/import-sister-site-content.mjs
 *   node seo-growth/scripts/import-sister-site-content.mjs --site policestationagent.com
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, slugify } from "./markdown-blog-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXPORTS = path.join(ROOT, "exports");

const SITES = [
  {
    domain: "policestationagent.com",
    blogDir: "policestationagent.com",
    localDir: "policestationagent",
    llms: "llms-policestationagent.com.txt",
  },
  {
    domain: "policestationrepuk.org",
    blogDir: "policestationrepuk.org",
    localDir: "policestationrepuk",
    llms: "llms-policestationrepuk.org.txt",
  },
  {
    domain: "psrtrain.com",
    blogDir: "psrtrain.com",
    localDir: "psrtrain",
    llms: "llms-psrtrain.com.txt",
  },
];

function copyMarkdownDir(srcDir, destDir, label) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let n = 0;
  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith(".md"))) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    n += 1;
  }
  console.log(`  ${label}: ${n} files`);
  return n;
}

function buildManifest(site, outDir) {
  const blogPosts = [];
  const blogDir = path.join(outDir, "blog");
  if (fs.existsSync(blogDir)) {
    for (const file of fs.readdirSync(blogDir).filter((f) => f.endsWith(".md"))) {
      const raw = fs.readFileSync(path.join(blogDir, file), "utf8");
      const { meta } = parseFrontmatter(raw);
      blogPosts.push({
        file,
        slug: meta.slug || slugify(meta.title || file.replace(/\.md$/, "")),
        title: meta.title,
        metaDescription: meta.meta_description,
        publishDate: meta.publish_date,
      });
    }
  }

  const localPages = [];
  const localDir = path.join(outDir, "local-seo");
  if (fs.existsSync(localDir)) {
    for (const file of fs.readdirSync(localDir).filter((f) => f.endsWith(".md"))) {
      localPages.push({ file, slug: file.replace(/\.md$/, "") });
    }
  }

  const manifest = {
    domain: site.domain,
    exportedAt: new Date().toISOString(),
    blogPosts,
    localPages,
    llmsTxt: fs.existsSync(path.join(outDir, "llms.txt")) ? "llms.txt" : null,
    importSteps: [
      `Upload blog/*.md to ${site.domain} CMS as /blog/{slug}`,
      `Upload local-seo/*.md as static pages`,
      "Copy llms.txt to site root",
      "Submit sitemap to GSC/Bing after first batch",
    ],
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

function exportSite(site) {
  const outDir = path.join(EXPORTS, site.domain.replace(/\./g, "_"));
  fs.mkdirSync(outDir, { recursive: true });

  copyMarkdownDir(path.join(ROOT, "blog-posts", site.blogDir), path.join(outDir, "blog"), "blog");
  copyMarkdownDir(path.join(ROOT, "local-seo", site.localDir), path.join(outDir, "local-seo"), "local-seo");

  const llmsSrc = path.join(ROOT, "llms", site.llms);
  if (fs.existsSync(llmsSrc)) {
    fs.copyFileSync(llmsSrc, path.join(outDir, "llms.txt"));
  }

  const manifest = buildManifest(site, outDir);
  console.log(`[export] ${site.domain} → ${outDir} (${manifest.blogPosts.length} blog, ${manifest.localPages.length} local)`);
}

function main() {
  const siteArg = process.argv.find((a) => a.startsWith("--site="))?.split("=")[1];
  const targets = siteArg ? SITES.filter((s) => s.domain === siteArg) : SITES;
  if (!targets.length) {
    console.error("[export] Unknown site:", siteArg);
    process.exit(1);
  }
  for (const site of targets) exportSite(site);
  console.log("[export] Done — import bundles in seo-growth/exports/");
}

main();

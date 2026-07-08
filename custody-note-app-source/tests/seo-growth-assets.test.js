/**
 * Validates seo-growth asset pack structure (no website runtime dependency).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "seo-growth");

function countMarkdown(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md")).length;
}

describe("seo-growth asset pack", () => {
  it("has required top-level deliverables", () => {
    for (const file of [
      "audit-report.md",
      "final-growth-report.md",
      "MANUAL_PUBLICATION_TODO.md",
      "multi-site-rollout-checklist.md",
      "content-calendar-90-days.csv",
      "buffer/buffer-posts.csv",
      "buffer/buffer-posts.json",
      "buffer/buffer-scheduled-results.json",
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `missing ${file}`);
    }
  });

  it("has ten blog drafts per site", () => {
    for (const site of [
      "custodynote.com",
      "policestationagent.com",
      "policestationrepuk.org",
      "psrtrain.com",
    ]) {
      const n = countMarkdown(path.join(ROOT, "blog-posts", site));
      assert.equal(n, 10, `${site} should have 10 blog drafts, got ${n}`);
    }
  });

  it("has local SEO drafts for partner sites", () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, "local-seo/policestationagent/kent-police-station-representative.md")),
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, "local-seo/policestationrepuk/kent-police-station-reps.md")),
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, "local-seo/psrtrain/police-station-representative-training.md")),
    );
  });

  it("buffer CSV has expected columns", () => {
    const header = fs
      .readFileSync(path.join(ROOT, "buffer/buffer-posts.csv"), "utf8")
      .split("\n")[0];
    assert.ok(header.includes("channel"));
    assert.ok(header.includes("post_text"));
    assert.ok(header.includes("suggested_date"));
  });

  it("growth automation scripts exist", () => {
    for (const file of [
      "scripts/schedule-buffer.mjs",
      "scripts/publish-blog-from-markdown.mjs",
      "scripts/import-sister-site-content.mjs",
      "scripts/markdown-blog-utils.mjs",
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `missing ${file}`);
    }
  });
});

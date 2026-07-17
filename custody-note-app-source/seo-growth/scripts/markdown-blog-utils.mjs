#!/usr/bin/env node
/** Shared markdown → blog-import JSON helpers for publish scripts. */
import fs from "node:fs";

export function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
    meta[key] = val;
  }
  return { meta, body: match[2].trim() };
}

export function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/** Minimal markdown → HTML for seo-growth blog drafts. */
export function markdownToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let para = [];

  function flushPara() {
    if (!para.length) return;
    out.push(`<p>${inlineMarkdown(para.join(" "))}</p>`);
    para = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushPara();
      out.push(`<h1>${inlineMarkdown(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushPara();
      out.push(`<h2>${inlineMarkdown(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushPara();
      out.push(`<h3>${inlineMarkdown(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("- ")) {
      flushPara();
      out.push(`<ul><li>${inlineMarkdown(trimmed.slice(2))}</li></ul>`);
      continue;
    }
    if (trimmed === "---") {
      flushPara();
      continue;
    }
    para.push(trimmed);
  }
  flushPara();
  return out.join("\n");
}

export function inferCategory(keyword, title) {
  const t = `${keyword} ${title}`.toLowerCase();
  if (t.includes("pace") || t.includes("interview")) return "Police Interviews";
  if (t.includes("dscc") || t.includes("custody record")) return "Custody Records";
  if (t.includes("bail") || t.includes("rui")) return "Attendance Notes";
  if (t.includes("laa") || t.includes("billing")) return "Legal Aid";
  if (t.includes("ai")) return "App Features";
  if (t.includes("template")) return "Attendance Notes";
  return "Attendance Notes";
}

export function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

#!/usr/bin/env node
/**
 * Schedule Buffer social posts from seo-growth/buffer/buffer-posts.json.
 *
 * Requires env (never commit):
 *   BUFFER_ACCESS_TOKEN — legacy Buffer API token, OR
 *   BUFFER_API_KEY — GraphQL bearer token
 *   BUFFER_CHANNEL_LINKEDIN, BUFFER_CHANNEL_FACEBOOK, BUFFER_CHANNEL_TWITTER — 24-char channel IDs
 *
 * Usage:
 *   node seo-growth/scripts/schedule-buffer.mjs --dry-run          # default
 *   node seo-growth/scripts/schedule-buffer.mjs --schedule --limit 14
 *   node seo-growth/scripts/schedule-buffer.mjs --schedule --site custodynote.com
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const POSTS_PATH = path.join(ROOT, "buffer", "buffer-posts.json");
const RESULTS_PATH = path.join(ROOT, "buffer", "buffer-scheduled-results.json");
const SCHEDULED_PATH = path.join(ROOT, "buffer", "buffer-scheduled-ids.json");

const CHANNEL_ENV = {
  LinkedIn: "BUFFER_CHANNEL_LINKEDIN",
  Facebook: "BUFFER_CHANNEL_FACEBOOK",
  "X/Twitter": "BUFFER_CHANNEL_TWITTER",
};

function appendBufferUtm(url, channel, site) {
  try {
    const u = new URL(url);
    u.searchParams.set("utm_source", "buffer");
    u.searchParams.set("utm_medium", "social");
    u.searchParams.set("utm_campaign", `${site}_${channel.toLowerCase().replace(/[^a-z]/g, "")}`);
    return u.toString();
  } catch {
    return url;
  }
}

function ukDateTimeToIso(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "09:30").split(":").map(Number);
  // UK is UTC+1 in June (BST)
  const dt = new Date(Date.UTC(y, m - 1, d, hh - 1, mm, 0));
  return dt.toISOString();
}

async function createLegacyBufferPost({ profileId, text, scheduledAt }) {
  const token = process.env.BUFFER_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("BUFFER_ACCESS_TOKEN not set");

  const body = new URLSearchParams();
  body.set("access_token", token);
  body.set("text", text);
  body.set("profile_ids[]", profileId);
  body.set("scheduled_at", String(Math.floor(new Date(scheduledAt).getTime() / 1000)));
  body.set("shorten", "true");

  const res = await fetch("https://api.bufferapp.com/1/updates/create.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(json.message || json.error || `Buffer API ${res.status}`);
  }
  return json;
}

async function createGraphqlBufferPost({ channelId, text, dueAt }) {
  const token = process.env.BUFFER_API_KEY?.trim();
  if (!token) throw new Error("BUFFER_API_KEY not set");

  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id status } }
        ... on MutationError { message }
      }
    }`;

  const res = await fetch("https://graph.buffer.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        input: {
          channelId,
          text,
          schedulingType: "automatic",
          mode: "customScheduled",
          dueAt,
        },
      },
    }),
  });
  const json = await res.json();
  const result = json?.data?.createPost;
  if (result?.message) throw new Error(result.message);
  return result?.post || result;
}

function loadScheduledIds() {
  if (!fs.existsSync(SCHEDULED_PATH)) return new Set();
  const rows = JSON.parse(fs.readFileSync(SCHEDULED_PATH, "utf8"));
  return new Set(Array.isArray(rows) ? rows : []);
}

function saveScheduledId(key) {
  const set = loadScheduledIds();
  set.add(key);
  fs.writeFileSync(SCHEDULED_PATH, JSON.stringify([...set], null, 2) + "\n");
}

async function main() {
  const dryRun = !process.argv.includes("--schedule");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 14;
  const siteFilter = process.argv.find((a) => a.startsWith("--site="))?.split("=")[1];

  const rows = JSON.parse(fs.readFileSync(POSTS_PATH, "utf8"));
  const pending = rows.filter((r) => {
    if (r.status === "scheduled") return false;
    if (siteFilter && r.site !== siteFilter) return false;
    const due = ukDateTimeToIso(r.suggested_date, r.suggested_time);
    return new Date(due) > new Date();
  });

  const batch = pending.slice(0, limit);
  const results = [];
  const scheduledIds = loadScheduledIds();

  console.log(`[buffer] ${dryRun ? "DRY RUN" : "SCHEDULING"} — ${batch.length} posts (${pending.length} eligible)`);

  for (const row of batch) {
    const channelId = process.env[CHANNEL_ENV[row.channel] || ""]?.trim();
    const link = appendBufferUtm(row.link, row.channel, row.site);
    const text = row.post_text.includes(link) ? row.post_text : `${row.post_text} ${link}`;
    const dueAt = ukDateTimeToIso(row.suggested_date, row.suggested_time);
    const dedupeKey = `${row.channel}|${row.link}|${row.suggested_date}`;

    if (scheduledIds.has(dedupeKey)) {
      console.log(`  skip (already scheduled): ${row.blog_title} / ${row.channel}`);
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] ${row.channel} @ ${dueAt}: ${row.blog_title.slice(0, 50)}…`);
      results.push({ ...row, dueAt, link, dryRun: true });
      continue;
    }

    if (!channelId) {
      console.warn(`  skip — set ${CHANNEL_ENV[row.channel]} for ${row.channel}`);
      continue;
    }

    try {
      let apiResult;
      if (process.env.BUFFER_ACCESS_TOKEN) {
        apiResult = await createLegacyBufferPost({
          profileId: channelId,
          text,
          scheduledAt: dueAt,
        });
      } else {
        apiResult = await createGraphqlBufferPost({ channelId, text, dueAt });
      }
      saveScheduledId(dedupeKey);
      results.push({ ...row, dueAt, link, scheduled: true, apiResult });
      console.log(`  ✓ scheduled: ${row.channel} — ${row.blog_title.slice(0, 40)}`);
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.warn(`  ✗ failed: ${row.channel} — ${err.message}`);
      results.push({ ...row, error: err.message });
    }
  }

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + "\n");
  console.log(`[buffer] Results → ${RESULTS_PATH}`);
  if (dryRun) {
    console.log("[buffer] Re-run with --schedule when BUFFER_* credentials and channel IDs are set.");
  }
}

main().catch((err) => {
  console.error("[buffer] failed:", err.message);
  process.exit(1);
});

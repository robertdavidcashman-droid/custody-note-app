# Buffer manual upload instructions

**Status:** Buffer API credentials were not available in the workspace. Posts are prepared as drafts.

## Files

- `buffer-posts.csv` — import-friendly spreadsheet (120 rows: 40 posts × 3 channels)
- `buffer-posts.json` — same data for Make/Zapier/custom scripts

## Recommended workflow

### Option A — Buffer web UI

1. Log in at [https://publish.buffer.com](https://publish.buffer.com)
2. Connect LinkedIn, Facebook, and X/Twitter channels if not already connected
3. Open `buffer-posts.csv` in Excel or Google Sheets
4. Sort by `suggested_date` ascending
5. For each row:
   - Create post in Buffer
   - Paste `post_text`
   - Add link attachment using `link` column
   - Schedule at `suggested_date` + `suggested_time` (UK timezone)
   - Set status to **scheduled**
6. Avoid scheduling more than **2 legal posts on the same day** across all four sites

### Option B — Buffer API (when credentials available)

Set environment variables (never commit keys):

```bash
export BUFFER_API_KEY="..."
export BUFFER_ACCESS_TOKEN="..."
export BUFFER_ORG_ID="..."
```

1. Call `get_account` to obtain organisation ID
2. Call `list_channels` to map channel names to IDs
3. Use `create_post` with `channelId`, text, link, and scheduled time
4. Save responses to `buffer-scheduled-results.json`

### Option C — Make / Zapier

1. Trigger: CSV row or Google Sheet row
2. Action: Buffer Create Post
3. Map columns: `post_text`, `link`, `suggested_date`, `suggested_time`, `channel`

## Scheduling rules (90-day plan)

- Start date: **10 June 2026**
- Posts spread across **90 days** (~3–4 social posts per week)
- Prefer **09:30** LinkedIn/Facebook, **12:30** X/Twitter (UK business hours)
- Skip most weekends unless promoting evergreen guides
- Re-use blog URLs with **varied copy** for follow-up posts (second column in JSON notes)

## Before publishing

- [ ] Replace `/blog/{slug}` URLs with live URLs after CMS publication
- [ ] Verify disclaimers on linked articles
- [ ] Match channel tone (LinkedIn = professional; X = shorter)

## custodynote.com live blog URLs

Many custodynote topics already exist as pillar pages or guides. After publishing new posts, update `link` column to actual URLs — see `blog-posts/blog-publication-summary.md`.

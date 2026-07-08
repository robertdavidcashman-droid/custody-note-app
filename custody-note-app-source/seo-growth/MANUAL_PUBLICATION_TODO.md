# Manual publication TODO

**Repository detected:** `custodynote.com` only (Next.js 15 in `custody-note-website`).

The other three sites are **not in this workspace**. Use drafts in this folder and the multi-site rollout checklist.

## custodynote.com — direct implementation

- [x] Six new tool landing pages wired (`/custody-note-template`, etc.)
- [x] Sitemap entries for new landing pages
- [x] RSS feed includes static blog posts
- [x] CTA event tracking (`data-event` on contact + landing CTAs)
- [x] `llms.txt` updated with new landing pages
- [x] **Deploy** custody-note-website changes (commit + push when ready)
- [x] Publish Phase 6 blog posts (gap fills) — DSCC + AI articles live on custodynote.com
- [x] **Custody Note Blog** in main navigation (desktop + mobile)
- [x] Responsive display fixes (lg breakpoint alignment, sticky CTAs, mobile menu)
- [ ] Submit updated sitemap in Google Search Console and Bing Webmaster Tools (manual — requires your Google/Microsoft login) after deploy

## policestationagent.com

1. Clone or open CMS/repo for policestationagent.com
2. Import local pages from `local-seo/policestationagent/` (12 Kent/Medway pages)
3. Publish blog posts from `blog-posts/policestationagent.com/`
4. Add `llms/llms-policestationagent.com.txt` to site root
5. Implement schema: LegalService, LocalBusiness, Person (Robert Cashman), FAQPage
6. Wire CTAs: Call Robert Cashman, WhatsApp Now, Email Instructions, Request Police Station Cover
7. Add GA4 events per `analytics/ANALYTICS_SETUP.md`

## policestationrepuk.org

1. Import category pages from `local-seo/policestationrepuk/` (8 county pages)
2. Publish blog posts from `blog-posts/policestationrepuk.org/`
3. Add `llms/llms-policestationrepuk.org.txt`
4. Schema: Organization, WebSite, SearchAction (if search exists), ItemList, FAQPage
5. CTAs: Register as a Police Station Rep, Find a Police Station Rep, Join the Directory

## psrtrain.com

1. Import training landing pages from `local-seo/psrtrain/` (9 pages)
2. Publish blog posts from `blog-posts/psrtrain.com/`
3. Add `llms/llms-psrtrain.com.txt`
4. Schema: Course, EducationalOrganization, Article, FAQPage
5. CTAs: Register Interest, Download Training Guide, Book Training, Join Course Updates

## Buffer social scheduling

1. Follow `buffer/BUFFER_MANUAL_UPLOAD_INSTRUCTIONS.md`
2. Or set `BUFFER_API_KEY` / access token and re-run scheduling script (TODO: add when credentials available)
3. Review all 120 draft rows in `buffer/buffer-posts.csv` before scheduling

## Indexing

Follow `indexing/INDEXING_CHECKLIST.md` for all four domains after publication.

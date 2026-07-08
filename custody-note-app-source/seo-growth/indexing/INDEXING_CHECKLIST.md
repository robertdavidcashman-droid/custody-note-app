# Indexing checklist

Apply to **each domain** after deploy/publication.

## Google Search Console

- [ ] Verify property (domain or URL prefix)
- [ ] Submit `https://{domain}/sitemap.xml`
- [ ] URL Inspection on homepage, top 5 commercial pages, 3 blog posts
- [ ] Confirm no accidental `noindex` on money pages
- [ ] Monitor Coverage report for 404s after migration

## Bing Webmaster Tools

- [ ] Verify site
- [ ] Submit same sitemap URL
- [ ] Enable IndexNow if supported

## custodynote.com specific

- [x] Dynamic sitemap at `/sitemap.xml`
- [x] IndexNow script: `npm run indexnow` (requires `INDEXNOW_KEY` in env)
- [x] robots.txt allows AI crawlers
- [x] Canonical tags via Next.js metadata
- [ ] Re-run IndexNow after deploying new landing pages

## Other sites

- [ ] Create sitemap.xml listing public pages + blog
- [ ] Add robots.txt with sitemap reference
- [ ] Upload llms.txt to site root
- [ ] Submit to GSC/Bing after first publish batch

## Schema validation

- [ ] [Google Rich Results Test](https://search.google.com/test/rich-results)
- [ ] [Schema.org validator](https://validator.schema.org/)
- [ ] No Review/Rating schema without genuine data

## Ongoing monitoring (weekly)

- [ ] Impressions, clicks, CTR by page (GSC)
- [ ] Top queries vs target keywords
- [ ] Crawl errors
- [ ] Core Web Vitals (PageSpeed Insights)

## Priority URLs — custodynote.com

1. https://custodynote.com/
2. https://custodynote.com/download
3. https://custodynote.com/trial
4. https://custodynote.com/custody-note-template
5. https://custodynote.com/ai-custody-note-tool
6. https://custodynote.com/police-station-attendance-notes
7. https://custodynote.com/demo

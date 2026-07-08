# Multi-site SEO growth rollout checklist

Use this after completing custodynote.com in `custody-note-website`.

## Per-site technical foundation

- [ ] Unique title tags (50–60 chars) on all indexable pages
- [ ] Unique meta descriptions (140–160 chars)
- [ ] One H1 per page; logical H2/H3 structure
- [ ] Canonical tags on all indexable pages
- [ ] `sitemap.xml` with all public URLs
- [ ] `robots.txt` allowing important crawlers; reference sitemap
- [ ] Open Graph + Twitter card metadata
- [ ] JSON-LD schema (site-specific — see `schema/schema-summary.md`)
- [ ] `/llms.txt` at site root
- [ ] IndexNow key + submit script (if stack supports it)
- [ ] GA4 + conversion events (`analytics/ANALYTICS_SETUP.md`)
- [ ] Google Search Console + Bing Webmaster Tools verified

## policestationagent.com

**Purpose:** Robert Cashman / Defence Legal Services agency site.

- [ ] 12 local landing pages (`local-seo/policestationagent/`)
- [ ] LegalService + LocalBusiness + Person schema
- [ ] CTAs with `data-event` tracking
- [ ] 10 blog posts (`blog-posts/policestationagent.com/`)
- [ ] Cross-link to policestationrepuk.org (directory) and custodynote.com (notes tool) contextually

## policestationrepuk.org

**Purpose:** Rep directory and registration.

- [ ] 8 county category pages (`local-seo/policestationrepuk/`)
- [ ] Organization + WebSite + SearchAction schema
- [ ] 10 blog posts (`blog-posts/policestationrepuk.org/`)
- [ ] Cross-link to psrtrain.com for training

## psrtrain.com

**Purpose:** Training and education.

- [ ] 9 training landing pages (`local-seo/psrtrain/`)
- [ ] Course + EducationalOrganization schema
- [ ] 10 blog posts (`blog-posts/psrtrain.com/`)
- [ ] Cross-link to policestationrepuk.org for registration

## custodynote.com (in repo)

- [x] Strong existing SEO foundation (~95 routes)
- [x] Six additional tool landing pages
- [x] CTA event tracker
- [ ] Publish remaining Phase 6 blog drafts where no live equivalent exists
- [ ] Deploy and submit sitemap

## Content and social (all sites)

- [ ] 90-day calendar: `content-calendar-90-days.md`
- [ ] Buffer CSV/JSON: `buffer/buffer-posts.csv`
- [ ] Stagger posts Mon–Fri business hours; max 1–2 legal posts per day across portfolio

## Compliance (all sites)

- [ ] General information disclaimer on advice pages
- [ ] Privacy, cookies, terms, contact pages present
- [ ] No fake reviews or rating schema
- [ ] No misleading regulatory claims

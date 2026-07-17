# Custody Note — Site audit report

**Audit date:** 9 June 2026  
**Site in repository:** https://custodynote.com (Next.js 15, Vercel)  
**Other sites:** Audited from positioning spec + drafts only (not in repo)

---

## custodynote.com — executive summary

| Metric | Status |
|--------|--------|
| Framework | Next.js 15 App Router |
| Public routes | ~95+ (guides, glossary, scenarios, offences, comparisons, blog) |
| Sitemap | Dynamic `app/sitemap.ts` + IndexNow on deploy |
| robots.txt | Allows AI crawlers explicitly |
| llms.txt | Dynamic route at `/llms.txt` |
| Schema | SoftwareApplication, FAQPage, Article, BreadcrumbList, Organization |
| Analytics | GA4 via `NEXT_PUBLIC_GA_MEASUREMENT_ID`; CTA event tracker added |
| Blog | 18 guides + 10 static posts + pillar pages |
| Priority fixes applied | 6 tool landing pages, RSS static posts, CTA tracking, sitemap dedupe |

---

## custodynote.com — key pages

| URL | Type | Current title | Proposed title | Current meta | Proposed meta | H1 | Proposed H1 | Main CTA | Tech SEO | Content | CRO | Internal links | Schema | Speed/a11y | Priority |
|-----|------|---------------|----------------|--------------|---------------|-----|-------------|----------|----------|---------|-----|----------------|--------|------------|----------|
| `/` | Home | Custody Note — … | Keep / tighten to 55 chars | Good | Keep | Custody Note | Keep | Try CustodyNote / Trial | OK | Strong | Good hero | Many | SoftwareApplication | Good | 8 |
| `/download` | Conversion | Download … | Keep | Good | Keep | Download | Keep | Download | OK | Clear | Primary funnel | OK | Product | Good | 9 |
| `/trial` | Conversion | 30-day trial | Keep | Good | Keep | Trial | Keep | Start trial | OK | Good | Strong | OK | — | Good | 9 |
| `/demo` | Conversion | Demo | Keep | Add demo_request event on button | Good | Request demo | Keep | Request Demo | OK | OK | Add data-event | Link features | — | Good | 8 |
| `/contact` | Contact | Contact — … | Keep | Good | Keep | Contact Us | Keep | Email | OK | OK | data-event added | Footer | Organization | Good | 7 |
| `/custody-note-template` | **NEW** landing | (new) | Custody Note Template (UK) — Structured Fields | (new) | 155 char draft in page | Template H1 | Keep | Download Template | Canonical via metadata | Unique | Trial CTA in shell | Related links | Article + FAQ | Good | 8 |
| `/ai-custody-note-tool` | **NEW** landing | (new) | AI Custody Note Tool — Benefits & Limits | (new) | As configured | AI tool H1 | Keep | Try CustodyNote | Same | Unique | Good | Features link | Article + FAQ | Good | 8 |
| `/blog` | Index | Blog | Keep | Good | Keep | Blog | Keep | Trial | OK | 28+ posts | OK | Cluster links | — | Good | 7 |
| `/police-station-attendance-notes` | Pillar | Strong | Keep | Strong | Keep | Pillar H1 | Keep | Trial | OK | Excellent | Strong | Hub | Article | Good | 9 |
| `/faq` | FAQ | FAQ | Keep | Good | Keep | FAQ | Keep | Trial | OK | Good | OK | OK | FAQPage | Good | 7 |

*Full route list available in `app/sitemap.ts`. Duplicate `/security` sitemap entry removed.*

---

## policestationagent.com — audit (external, draft basis)

| URL (proposed) | Type | Proposed title | Proposed meta | H1 | CTA | Priority |
|----------------|------|----------------|---------------|-----|-----|----------|
| `/` | Agency home | Police Station Agent — Kent Cover | Robert Cashman police station agency for criminal defence firms in Kent/Medway | Police station representation | Call / WhatsApp | 10 |
| `/kent-police-station-representative` | Local | Kent Police Station Representative | Local meta 155 chars | Kent PSR | Request cover | 9 |
| 11 other Kent/Medway pages | Local | Unique per town | Unique | Town + cover | Call/WhatsApp/Email | 8 |
| `/blog/*` | Blog | Per post | Per post | Post title | Request cover | 7 |

**Issues:** Site not in repo — implement schema (LegalService, Person), GA4 events, llms.txt.

---

## policestationrepuk.org — audit (external)

| URL (proposed) | Type | Proposed title | CTA | Priority |
|----------------|------|----------------|-----|----------|
| `/` | Directory home | Police Station Rep UK Directory | Find / Register | 10 |
| `/kent-police-station-reps` etc. | Category | {County} Police Station Reps | Find rep | 8 |
| `/search` | Search | Find a Rep | Search | 9 |
| `/register` | Conversion | Register as a Rep | Register | 10 |

**Issues:** SearchAction schema if search live; rep profile freshness.

---

## psrtrain.com — audit (external)

| URL (proposed) | Type | Proposed title | CTA | Priority |
|----------------|------|----------------|-----|----------|
| `/` | Training home | PSR Training — Police Station Reps | Register Interest | 10 |
| `/pace-interview-training` etc. | Course landing | Course-specific titles | Book Training | 8 |
| `/blog/*` | Blog | Per post | Register Interest | 7 |

---

## Cross-site issues

1. **No shared CMS** — content drafts in `seo-growth/`
2. **Buffer not scheduled** — no API credentials in environment
3. **Blog URL placeholders** — social CSV uses `/blog/{slug}` until CMS publish
4. **custodynote overlap** — several Phase 6 topics already live as pillar/guide pages (see blog-publication-summary.md)

---

## Priority scores (site-wide)

| Site | Overall priority (1–10) | Rationale |
|------|-------------------------|-----------|
| custodynote.com | 8 | In repo; foundation strong; deploy pending |
| policestationagent.com | 9 | Commercial + local SEO high value |
| policestationrepuk.org | 8 | Directory SEO + registration funnel |
| psrtrain.com | 7 | Training niche; longer sales cycle |

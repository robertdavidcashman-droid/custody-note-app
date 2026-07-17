# Blog publication summary

**Generated:** 9 June 2026

## custodynote.com — overlap with live content

Many Phase 6 topics already have strong live pages. **Publish drafts only where gaps exist**, or redirect canonicals to existing URLs.

| Phase 6 draft title | Live equivalent (if any) | Recommendation |
|---------------------|--------------------------|----------------|
| How to Write a Proper Police Station Attendance Note | `/how-to-write-attendance-notes` | **Skip publish** — link from social to live URL |
| What Should Go in a Custody Note? | `/what-must-be-included-in-attendance-notes` | **Skip** — use live page |
| Police Interview Note-Taking: Practical Checklist | `/police-station-interview-notes`, `/pace-interview-note-template` | **Skip** or merge FAQ into template page |
| DSCC References, Custody Records and Attendance Notes | `/glossary/custody-record`, `/dscc-attendance-note-workflow` | **Publish blog** as narrative supplement |
| Police Bail Notes: What to Record | `/bail-rui-follow-up-checklist`, `/police-bail-note-template` | **Skip** — promote template page |
| RUI Notes: What Criminal Practitioners Should Keep | `/rui-note-template`, `/bail-rui-follow-up-checklist` | **Skip** — promote template page |
| Why Good Attendance Notes Matter | `/why-switch`, `/what-makes-a-good-attendance-note` (guide) | **Skip** |
| AI-Assisted Custody Notes: Benefits and Limits | `/ai-custody-note-tool` (new landing) | **Publish blog** + cross-link landing |
| Police Station File Preparation Checklist | `/criminal-defence-file-review-checklist` | **Optional publish** or expand checklist page |
| Attendance Note Template for Police Station Representatives | `/attendance-note-template-uk`, `/custody-note-template` | **Skip** |

**Suggested new publishes on custodynote.com:** 2–3 posts (DSCC narrative, AI blog, optional file prep).

---

## policestationagent.com

10 drafts in `blog-posts/policestationagent.com/`. **All require CMS publish.**

Suggested URL pattern: `/blog/{slug}`

Primary CTA: Call Robert Cashman / Request Police Station Cover

---

## policestationrepuk.org

10 drafts in `blog-posts/policestationrepuk.org/`. **All require CMS publish.**

Primary CTA: Find a Police Station Rep / Register

---

## psrtrain.com

10 drafts in `blog-posts/psrtrain.com/`. **All require CMS publish.**

Primary CTA: Register Interest / Book Training

---

## Import format

Each markdown file includes YAML frontmatter:

```yaml
title, slug, meta_title, meta_description, target_keyword,
publish_date, last_updated, author, schema_type, status, canonical_url
```

Body: answer-first sections, FAQ, disclaimer, internal links.

---

## Word counts

Drafts are structured for expansion. Before publish, expand each to **800–1,500 words** where the topic warrants it (especially policestationagent.com client-facing posts).

Run: `wc -w seo-growth/blog-posts/**/*.md` to audit.

---

## Article schema (all sites)

```json
{
  "@type": "Article",
  "headline": "...",
  "author": { "@type": "Person", "name": "Robert Cashman" },
  "datePublished": "2026-06-09",
  "dateModified": "2026-06-09"
}
```

custodynote.com static posts: add to `lib/staticBlogPosts.ts` + create `app/blog/{slug}/page.tsx` following existing pattern.

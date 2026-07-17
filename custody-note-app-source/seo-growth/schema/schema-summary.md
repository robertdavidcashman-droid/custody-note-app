# Schema implementation summary

## custodynote.com (live in repo)

| Schema type | Where | Status |
|-------------|-------|--------|
| SoftwareApplication | Homepage / product pages | Live |
| Organization | Site-wide / about | Live |
| FAQPage | `/faq`, landing FAQs via `FaqJsonLd` | Live |
| Article | Guides, landing pages, blog | Live |
| BreadcrumbList | `Breadcrumbs` component | Live |
| Product | Pricing (if applicable) | Review per page |

**New landing pages:** Article + FAQPage via `SeoLandingShell` + `FaqJsonLd`.

**Rules followed:** No fake Review/AggregateRating schema.

---

## policestationagent.com (draft)

| Type | Page |
|------|------|
| LegalService | Homepage |
| LocalBusiness | Homepage + each Kent local page |
| Person | Robert Cashman — `/about` or homepage |
| Service | Police station representation |
| FAQPage | Each local landing page |
| BreadcrumbList | All inner pages |

Example Person snippet:

```json
{
  "@type": "Person",
  "name": "Robert Cashman",
  "jobTitle": "Police station representative",
  "worksFor": { "@type": "Organization", "name": "Defence Legal Services Ltd" }
}
```

---

## policestationrepuk.org (draft)

| Type | Page |
|------|------|
| Organization | Homepage |
| WebSite | Homepage |
| SearchAction | Search results (if `/search` exists) |
| ItemList | County category pages |
| FAQPage | Registration help |
| BreadcrumbList | Inner pages |

---

## psrtrain.com (draft)

| Type | Page |
|------|------|
| EducationalOrganization | Homepage |
| Course | Each training landing page |
| Article | Blog posts |
| FAQPage | Course pages |
| BreadcrumbList | Inner pages |

Course example:

```json
{
  "@type": "Course",
  "name": "PACE Interview Training",
  "description": "Practical PACE interview training for police station representatives.",
  "provider": { "@type": "Organization", "name": "PSR Train" }
}
```

---

## Validation

Test after publish: Google Rich Results Test + schema.org validator.

Do not add:

- Review / AggregateRating without genuine reviews
- Misleading address or regulatory claims

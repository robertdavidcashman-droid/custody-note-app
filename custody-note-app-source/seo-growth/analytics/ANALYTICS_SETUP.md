# Analytics setup

## custodynote.com (implemented / partial)

### Google Analytics 4

- Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` in Vercel env
- Cookie consent gates loading (existing pattern)
- Event helper: `lib/analytics.ts`
- Delegated click tracking: `components/CtaEventTracker.tsx`

### Conversion event names

| Event | Trigger | data-event attribute |
|-------|---------|----------------------|
| `call_click` | Tel links | `data-event="call_click"` |
| `whatsapp_click` | WhatsApp links | `data-event="whatsapp_click"` |
| `email_click` | Email / Outlook compose | `data-event="email_click"` |
| `form_submit` | Form success | `data-event="form_submit"` |
| `demo_request` | Trial/demo CTAs | `data-event="demo_request"` |
| `template_download` | Template/download CTAs | `data-event="template_download"` |
| `blog_cta_click` | In-article CTAs | `data-event="blog_cta_click"` |
| `cta_click` | Generic data-cta fallback | `data-cta="{id}"` |
| `outbound_partner_click` | Partner site links | programmatic |

### GA4 custom dimensions (recommended)

- `page_path`
- `cta_id`
- `link_text`
- `template_name` (template_download)
- `form_name` (form_submit)

### Google Search Console

- Verify custodynote.com
- Link to GA4 property

### Bing Webmaster Tools

- Verify domain
- Submit sitemap

### Microsoft Clarity (optional)

- Add script via Vercel or `app/layout.tsx` after consent
- Heatmaps on `/trial`, `/download`, `/demo`

### IndexNow

- Key file + `scripts/indexnow.mjs`
- Run on deploy via CI or manual `npm run indexnow`

---

## Other sites (TODO when CMS available)

Add same event names for parity:

| Site | Key events |
|------|------------|
| policestationagent.com | call_click, whatsapp_click, email_click |
| policestationrepuk.org | rep_registration, form_submit, outbound_directory_click |
| psrtrain.com | training_interest, form_submit, template_download |

### Implementation snippet (vanilla JS)

```javascript
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-event]');
  if (!el || typeof gtag !== 'function') return;
  gtag('event', el.dataset.event, {
    link_text: el.textContent?.trim().slice(0, 80),
    page_path: location.pathname,
  });
}, true);
```

---

## Reporting cadence

- **Weekly:** GA4 conversions, GSC top pages
- **Monthly:** Channel attribution, blog CTA performance
- **Quarterly:** Keyword rank review vs content calendar

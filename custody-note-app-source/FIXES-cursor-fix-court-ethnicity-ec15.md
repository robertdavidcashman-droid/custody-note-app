# Fixes in branch `cursor/fix-court-ethnicity-ec15`

## 1. Magistrates court typeahead (Outcome section)

**Problem:** At the end of a case (Section 8 Outcome), typing two letters in Court Name often showed no suggestions because the dropdown opened below the field, off the bottom of the screen.

**Fix:**
- Dropdown flips above the input when there is more viewport space above than below
- Magistrates court list preloads when opening the Outcome section and when the court field becomes visible

## 2. CRM ethnicity mapping

**Problem:** CRM1 HTML preview used legacy label codes (`Indian`, `A1`, `British`) while the form stores LAA numeric codes (`06`, `01`). Selecting **Indian** (`06`) did not tick the correct box; **White Other** (`14`) could appear wrong for Eastern European clients.

**Fix:** `renderer/laa-forms.js` now matches numeric LAA codes (same as official CRM1 PDF fill in `lib/laaCrm1Fill.js`), with legacy alias support.

## Tests

```bash
npm install
node --test tests/laaFormsEthnicity.test.js tests/courtTypeahead.test.js tests/crm1Fill.test.js tests/magistratesCourts.test.js
```

All 56 tests pass.

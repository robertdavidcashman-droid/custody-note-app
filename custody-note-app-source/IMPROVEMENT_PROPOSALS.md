# Improvement Proposals (Phase 5)

Improvements from the Full App Test Plan. Status updated below.

---

## UX

- **Default Case Status after client lookup:** DONE. Case Status defaults to "Existing case" and a toast shows "Client details imported" when client lookup applies data.

- **Section progress bar:** DONE. Coloured dots (green = complete, amber = partial, grey = empty) appear above the bottom navigation bar, with the current section highlighted. Click any dot to jump to that section.

---

## Data

- **Inline blur validation:** DONE. Required fields (date, station, name, DOB, NI, matter type, offence, sufficient benefit test, outcome, LAA declaration name) show a red border when left empty on blur, clearing automatically when the user enters a value.

- **Required-field checklist:** Already implemented. The finalise button shows a modal listing all missing required fields with clickable links to jump to the relevant section.

---

## Performance

- **List pagination:** DONE. Attendance list is now paginated (50 per page) with Back/Forward buttons, matching the Firms page. Search resets to page 1.

---

## QuickFile

- **Auto-suggest next invoice:** DONE. When creating a new attendance, if QuickFile credentials are configured, the next invoice number is automatically fetched and pre-filled into the Invoice No field.

---

*All proposals have been implemented.*

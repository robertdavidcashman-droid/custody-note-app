/* ═══════════════════════════════════════════════════════
   FORM RENDERER MODULE  (extracted from app.js)
   These functions are defined in app.js and referenced here as documentation.
   The authoritative version lives in app.js until a full ES-module migration.
   This file exists as an architectural marker and extension point.

   Key functions (all defined in global scope via app.js):
   - renderForm(data)              — full form render
   - renderSection(sec, data)      — single section
   - renderField(f, data, grid)    — field type dispatcher
   - renderMultiInterview(...)     — multiple interview blocks
   - initSignatureCanvas(...)      — signature pad
   - collectCurrentData()          — snapshot form → formData
   - applyConditionalVisibility()  — show/hide conditional fields
   - validateBeforeFinalise()      — validation + duplicate check
   - showSection(idx)              — navigate sections
   - saveForm(status)              — persist to DB
   ═══════════════════════════════════════════════════════ */

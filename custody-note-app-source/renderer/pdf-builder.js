/* ═══════════════════════════════════════════════════════
   PDF BUILDER MODULE  (extracted from app.js)
   These functions are defined in app.js and referenced here as documentation.
   The authoritative version lives in app.js until a full ES-module migration.
   This file exists as an architectural marker and extension point.

   Key functions (all defined in global scope via app.js):
   - buildPdfHtml(d, settings)    — full LAA-compliant PDF HTML
   - exportPdf()                  — save PDF to Desktop
   - emailPdf()                   — save + open Outlook Web compose
   - sendReportToFirm()           — plaintext email to instructing firm
   - printGeneratedDoc(html)      — open print window
   - docStyles()                  — shared CSS for generated docs
   - generateConflictCert()       — conflict of interest certificate
   - generateClientInstructionsDoc() — client instructions document
   - generatePreparedStatement()  — prepared statement template
   ═══════════════════════════════════════════════════════ */

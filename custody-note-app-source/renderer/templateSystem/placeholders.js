/* ═══════════════════════════════════════════════════════
   TEMPLATE SYSTEM — Placeholder Definitions
   All recognised [KEY] tokens with labels, descriptions, examples.
   ═══════════════════════════════════════════════════════ */

var TEMPLATE_PLACEHOLDERS = [
  { key: 'CLIENT_NAME',         label: 'Client full name',      description: 'Full client name',                       example: 'John Smith' },
  { key: 'CLIENT_FIRST_NAME',   label: 'Client first name',     description: 'Client given name',                      example: 'John' },
  { key: 'CLIENT_LAST_NAME',    label: 'Client last name',      description: 'Client family name',                     example: 'Smith' },
  { key: 'DOB',                 label: 'Date of birth',         description: 'Client date of birth',                   example: '01/02/1980' },
  { key: 'CLIENT_ADDRESS',      label: 'Client address',        description: 'Client postal address',                  example: '1 High Street, London' },
  { key: 'CLIENT_PHONE',        label: 'Client phone',          description: 'Client telephone number',                example: '07123 456789' },
  { key: 'CLIENT_EMAIL',        label: 'Client email',          description: 'Client email address',                   example: 'john@example.com' },
  { key: 'CASE_REFERENCE',      label: 'Case reference',        description: 'Internal case / file reference',         example: 'ABC123' },
  { key: 'CUSTODY_REFERENCE',   label: 'Custody reference',     description: 'Custody record number',                  example: 'CRN456' },
  { key: 'POLICE_STATION',      label: 'Police station',        description: 'Station name',                           example: 'Lewisham Police Station' },
  { key: 'OFFICER_NAME',        label: 'Officer name',          description: 'Officer full name (rank + surname)',      example: 'DC Jones' },
  { key: 'OFFICER_RANK',        label: 'Officer rank',          description: 'Officer rank abbreviation',              example: 'DC' },
  { key: 'INTERVIEW_DATE',      label: 'Interview date',        description: 'Date of interview',                      example: '23 March 2026' },
  { key: 'INTERVIEW_TIME',      label: 'Interview time',        description: 'Time interview started',                 example: '14:30' },
  { key: 'ARREST_DATE',         label: 'Arrest date',           description: 'Date of arrest',                         example: '22 March 2026' },
  { key: 'ARREST_TIME',         label: 'Arrest time',           description: 'Time of arrest',                         example: '22:10' },
  { key: 'BAIL_RETURN_DATE',    label: 'Bail return date',      description: 'Date client must return on bail',        example: '14 April 2026' },
  { key: 'BAIL_CONDITIONS',     label: 'Bail conditions',       description: 'Summary of bail conditions',             example: 'No contact with complainant' },
  { key: 'ALLEGATION',          label: 'Allegation',            description: 'Summary of allegation / offence',        example: 'Assault occasioning ABH' },
  { key: 'DISCLOSURE_SUMMARY',  label: 'Disclosure summary',    description: 'Police disclosure summary',              example: 'CCTV and witness account' },
  { key: 'ADVICE_GIVEN',        label: 'Advice given',          description: 'Summary of advice given to client',      example: 'No comment interview advised' },
  { key: 'SOLICITOR_NAME',      label: 'Solicitor name',        description: 'Fee earner / solicitor full name',       example: 'Jane Fee-Earner' },
  { key: 'SOLICITOR_EMAIL',     label: 'Solicitor email',       description: 'Fee earner email address',               example: 'robert@example.com' },
  { key: 'SOLICITOR_PHONE',     label: 'Solicitor phone',       description: 'Fee earner telephone number',            example: '07123 000000' },
  { key: 'FIRM_NAME',           label: 'Firm name',             description: 'Organisation / firm name',               example: 'Defence Legal Services' },
  { key: 'TODAY_DATE',          label: "Today's date",          description: "Today's date (auto-filled)",             example: '23 March 2026' },
  { key: 'NOW_TIME',            label: 'Current time',          description: 'Current time at render (auto-filled)',   example: '09:15' }
];

function tplTokenFor(key) {
  return '[' + key + ']';
}

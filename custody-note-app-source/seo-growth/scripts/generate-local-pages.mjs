#!/usr/bin/env node
/** Generate local SEO landing page drafts for sites not in repo */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "local-seo");

const PSA_PAGES = [
  { slug: "kent-police-station-representative", place: "Kent", stations: "Maidstone, Medway, Canterbury, Tonbridge" },
  { slug: "medway-police-station-representative", place: "Medway", stations: "Medway custody suite (Gillingham/Chatham area)" },
  { slug: "sevenoaks-police-station-cover", place: "Sevenoaks", stations: "Sevenoaks and nearby stations" },
  { slug: "swanley-police-station-cover", place: "Swanley", stations: "Swanley and North West Kent" },
  { slug: "dartford-police-station-cover", place: "Dartford", stations: "Dartford custody" },
  { slug: "gravesend-police-station-cover", place: "Gravesend", stations: "Gravesend and North Kent" },
  { slug: "maidstone-police-station-cover", place: "Maidstone", stations: "Maidstone custody" },
  { slug: "tonbridge-police-station-cover", place: "Tonbridge", stations: "Tonbridge area" },
  { slug: "tunbridge-wells-police-station-cover", place: "Tunbridge Wells", stations: "Tunbridge Wells and West Kent" },
  { slug: "chatham-police-station-cover", place: "Chatham", stations: "Medway towns including Chatham" },
  { slug: "gillingham-police-station-cover", place: "Gillingham", stations: "Gillingham and Medway" },
  { slug: "rochester-police-station-cover", place: "Rochester", stations: "Rochester and Medway" },
];

const PSRUK = ["Kent", "London", "Essex", "Surrey", "Sussex", "Hertfordshire", "Hampshire", "Thames Valley"];
const TRAIN = [
  "police-station-representative-training",
  "pace-interview-training",
  "police-station-accreditation-support",
  "criminal-defence-training",
  "sqe-criminal-practice-training",
  "youth-suspect-interview-training",
  "vulnerable-suspect-interview-training",
  "no-comment-interview-training",
  "voluntary-interview-training",
];

function psaPage(p) {
  return `---
site: policestationagent.com
slug: /${p.slug}
meta_title: ${p.place} Police Station Representative — Cover & Advice
meta_description: Police station representation in ${p.place} for criminal defence firms. Accredited cover, DSCC attendances, and structured attendance notes. General information — not case-specific advice.
h1: ${p.place} Police Station Representative
schema: [LegalService, LocalBusiness, FAQPage]
---

# ${p.place} Police Station Representative

**Last updated:** 9 June 2026

## Answer-first summary

Criminal defence firms instructing police station cover in **${p.place}** need prompt attendance, accredited representation where required, and clear attendance notes for billing and handover. Robert Cashman / Defence Legal Services provides agency cover across Kent and Medway including ${p.stations}.

## Local context

${p.place} falls within Kent Police force area. Custody suites vary in size and disclosure practice. Instructing solicitors should provide DSCC references, client details, offence summary, and conflict information as early as possible.

## What police station representation includes

- Attendance at custody or voluntary interview
- Review of initial disclosure
- Private consultation with the client
- Advice on interview strategy (answer, no comment, or prepared statement)
- Attendance at recorded interview where appropriate
- Outcome reporting to the instructing firm

## Primary CTAs

- **Call Robert Cashman** — urgent instructions
- **WhatsApp Now** — quick firm contact
- **Email Instructions** — DSCC reference and client details
- **Request Police Station Cover** — planned rota cover

## FAQ

### Do you cover ${p.place} overnight?

Police station work is 24/7. Contact availability depends on rota — confirm when instructing.

### What should firms send when instructing?

DSCC number, client name and DOB, station, offence, fee earner contact, and conflict status.

## Disclaimer

General information only. Not legal advice on specific facts. No outcome guarantees.

## Internal links

- [Kent police station representative](/kent-police-station-representative)
- [Contact](/contact)
- [Police station rep directory](https://policestationrepuk.org)
`;
}

function psrukPage(county) {
  const slug = `${county.toLowerCase().replace(/\s+/g, "-")}-police-station-reps`;
  return `---
site: policestationrepuk.org
slug: /${slug}
meta_title: ${county} Police Station Reps — Directory
meta_description: Find accredited police station representatives in ${county}. Search the directory for emergency and planned criminal defence cover.
h1: Police Station Reps in ${county}
schema: [ItemList, Organization]
---

# Police Station Reps in ${county}

## Answer-first summary

Use the directory to find accredited police station representatives covering **${county}**. Filter by availability, contact method, and areas covered. Verify accreditation and conflicts before instruction.

## CTAs

- **Find a Police Station Rep**
- **Register as a Police Station Rep**
- **Update Your Details**

## Tips for solicitors

Confirm exact custody suite, not just town name. ${county} may include multiple stations across force areas.

## Cross-links

- [Training for reps](https://psrtrain.com)
- [Contact directory owner](/contact)
`;
}

function trainPage(slug) {
  const title = slug.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  return `---
site: psrtrain.com
slug: /${slug}
meta_title: ${title} — UK Criminal Defence Training
meta_description: Practical ${title.toLowerCase()} for accredited representatives, trainees, and firms. Register interest for course dates.
h1: ${title}
schema: [Course, FAQPage]
---

# ${title}

## Answer-first summary

Structured training for criminal defence professionals covering PACE, interview procedure, note-taking, and accreditation preparation.

## Who this is for

- Trainee police station representatives
- Junior criminal practitioners
- Firms training staff
- SQE criminal practice learners

## CTAs

- **Register Interest**
- **Download Training Guide**
- **Book Training**
- **Join Course Updates**

## Disclaimer

Training content is general education, not legal advice on specific cases.
`;
}

fs.mkdirSync(path.join(ROOT, "policestationagent"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "policestationrepuk"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "psrtrain"), { recursive: true });

PSA_PAGES.forEach(p => fs.writeFileSync(path.join(ROOT, "policestationagent", `${p.slug}.md`), psaPage(p)));
PSRUK.forEach(c => fs.writeFileSync(path.join(ROOT, "policestationrepuk", `${c.toLowerCase().replace(/\s+/g, "-")}-police-station-reps.md`), psrukPage(c)));
TRAIN.forEach(s => fs.writeFileSync(path.join(ROOT, "psrtrain", `${s}.md`), trainPage(s)));

console.log("Local SEO drafts generated.");

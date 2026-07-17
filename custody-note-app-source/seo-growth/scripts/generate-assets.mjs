#!/usr/bin/env node
/**
 * Generates blog post markdown drafts, Buffer CSV/JSON, and 90-day content calendar.
 * Run from repo root: node seo-growth/scripts/generate-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BLOG_ROOT = path.join(ROOT, "blog-posts");

const DISCLAIMER =
  "\n\n---\n\n*This article is general information for criminal defence professionals in England and Wales. It is not legal advice on any specific case. Obtain advice on your own circumstances.*\n";

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** @type {Array<{site:string,title:string,metaTitle:string,metaDescription:string,keyword:string,intent:string,audience:string,cta:string,internalLinks:string[],sections:{h2:string,paras:string[]}[],faq?:{q:string,a:string}[],author?:string}>} */
const POSTS = [
  // policestationagent.com (10)
  {
    site: "policestationagent.com",
    title: "What Happens at a Police Station Interview?",
    metaTitle: "What Happens at a Police Station Interview? (UK)",
    metaDescription:
      "Practical overview of a PACE police station interview in England and Wales: custody, disclosure, legal advice, the interview room, and outcomes.",
    keyword: "police station interview UK",
    intent: "informational",
    audience: "Clients and instructing solicitors",
    cta: "Request Police Station Cover",
    internalLinks: ["/contact", "/kent-police-station-representative"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "A police station interview under PACE usually follows arrest or voluntary attendance. After booking-in, the suspect is entitled to free legal advice. A solicitor or accredited police station representative reviews disclosure, advises the client, and may attend the recorded interview. The interview ends with a decision such as no further action, bail, release under investigation, or charge.",
        ],
      },
      {
        h2: "Before the interview",
        paras: [
          "On arrival, custody staff record personal details and the reason for detention. PACE Code C governs detention, reviews, and welfare. Your legal adviser should obtain initial disclosure — what the police say the client is suspected of and the evidence they rely on. That disclosure may be limited at first; further material can follow.",
          "Consultation is confidential. The adviser explains the caution, the right to silence, adverse inference, and whether to answer questions, give a prepared statement, or go no comment. Instructions should be recorded carefully because they shape the interview strategy.",
        ],
      },
      {
        h2: "Inside the interview room",
        paras: [
          "Interviews are normally audio-recorded with a custody record reference. The interviewing officer asks questions; the suspect may reply or rely on no comment. Your adviser can intervene on unfair questions, clarify ambiguity, or request breaks. Vulnerable suspects may require an appropriate adult; youth cases have additional safeguards.",
        ],
      },
      {
        h2: "After the interview",
        paras: [
          "The custody sergeant decides next steps with the investigation team. Outcomes include no further action, bail with or without conditions, release under investigation (RUI), or charge. If charged, a court date is arranged. Your adviser should explain each outcome and any follow-up steps.",
        ],
      },
    ],
    faq: [
      {
        q: "Do I have to answer police questions?",
        a: "You have the right to remain silent, but silence can sometimes be considered by a court later. Advice depends on disclosure and the facts — obtain case-specific guidance.",
      },
      {
        q: "Is legal advice free at the police station?",
        a: "Legal advice at the police station under the duty scheme is not chargeable to the suspect in standard circumstances.",
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "policestationagent.com",
    title: "Should I Answer Questions or Go No Comment in a Police Interview?",
    metaTitle: "Answer Questions or No Comment? Police Interview (UK)",
    metaDescription:
      "How criminal defence advisers approach answer, no comment, and prepared statements at police interviews. General guidance — not case-specific advice.",
    keyword: "no comment police interview",
    intent: "informational",
    audience: "Clients and junior practitioners",
    cta: "Call Robert Cashman",
    internalLinks: ["/contact", "/voluntary-police-interview"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "There is no single correct strategy. Advisers weigh disclosure, evidence strength, client instructions, adverse inference risk, and defence theories. Options include full answers, limited answers on key points, a prepared statement followed by no comment, or no comment throughout.",
        ],
      },
      {
        h2: "When answering may be appropriate",
        paras: [
          "Early credible explanations can sometimes prevent charge or shape bail decisions. Account must match instructions and any later defence. Inconsistent answers can damage credibility.",
        ],
      },
      {
        h2: "When no comment may be appropriate",
        paras: [
          "Limited disclosure, complex allegations, or need to preserve a defence without revealing strategy may support no comment. Advisers explain how courts may draw inferences at trial — this is not automatic conviction.",
        ],
      },
    ],
    faq: [
      {
        q: "Will no comment make me look guilty?",
        a: "It is a legal right. Courts may consider silence in some circumstances at trial, but the decision depends on the case.",
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "policestationagent.com",
    title: "Voluntary Police Interview: Why You Still Need Legal Advice",
    metaTitle: "Voluntary Police Interview — Why You Need Advice (UK)",
    metaDescription:
      "Voluntary attendance at a police station is still a PACE interview. Why legal advice matters, what to expect, and how to instruct a representative.",
    keyword: "voluntary police interview legal advice",
    intent: "informational",
    audience: "Clients and solicitors",
    cta: "Email Instructions",
    internalLinks: ["/contact", "/voluntary-police-interview"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "A voluntary interview is not a casual chat. It is normally recorded under caution and can be used in evidence. You may leave in principle, but walking away does not stop an investigation. Legal advice helps you understand status, disclosure, and interview strategy.",
        ],
      },
      {
        h2: "How voluntary interviews differ from custody",
        paras: [
          "You are not under arrest, but caution and recording still apply. Disclosure and pace timing differ from custody detention. Advisers still need sufficient material to advise properly.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "policestationagent.com",
    title: "Police Bail Conditions: What They Mean and What to Do",
    metaTitle: "Police Bail Conditions Explained (UK)",
    metaDescription:
      "Understanding police bail dates, conditions, breaches, and variations after a PACE interview. Practical guidance for clients and firms.",
    keyword: "police bail conditions UK",
    intent: "informational",
    audience: "Clients and criminal defence firms",
    cta: "Request Police Station Cover",
    internalLinks: ["/contact"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Police bail requires you to return to a named station on a set date. Conditions may restrict contact, residence, or area. Breach can lead to arrest. Variations need police agreement or court application depending on stage.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "policestationagent.com",
    title: "Released Under Investigation: Practical Guidance",
    metaTitle: "Released Under Investigation (RUI) — Practical UK Guide",
    metaDescription:
      "What RUI means after a police interview, how it differs from bail, and what clients and solicitors should record and monitor.",
    keyword: "released under investigation",
    intent: "informational",
    audience: "Clients and solicitors",
    cta: "WhatsApp Now",
    internalLinks: ["/contact"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "RUI means the investigation continues without a bail date. There may be no conditions, but the case is not closed. Clients should keep contact details updated and avoid assumptions the matter has ended.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "policestationagent.com",
    title: "Why Criminal Defence Firms Use Freelance Police Station Agents",
    metaTitle: "Freelance Police Station Agents — Why Firms Use Them",
    metaDescription:
      "Capacity, accreditation, geography, and cost: why firms instruct freelance police station representatives and agents.",
    keyword: "freelance police station agent",
    intent: "commercial",
    audience: "Criminal defence firms",
    cta: "Request Police Station Cover",
    internalLinks: ["/contact", "/kent-police-station-representative"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Firms use freelance agents when duty rotas, staff illness, or geographic coverage gaps prevent in-house attendance. Accredited representatives can attend on legal aid where permitted and provide structured attendance notes for billing.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "policestationagent.com",
    title: "Police Station Cover in Kent: What Solicitors Need to Know",
    metaTitle: "Police Station Cover in Kent — Solicitor Guide",
    metaDescription:
      "Instructing police station cover in Kent and Medway: stations, DSCC references, accreditation, and practical firm workflows.",
    keyword: "police station cover Kent",
    intent: "local/commercial",
    audience: "Kent criminal defence firms",
    cta: "Request Police Station Cover",
    internalLinks: ["/kent-police-station-representative", "/medway-police-station-representative", "/contact"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Kent cover spans multiple custody suites including Medway, Maidstone, Canterbury, and smaller stations. Firms should send DSCC references, client details, offence summary, and conflict information when instructing. Local knowledge of station layout and disclosure practices helps but does not replace proper preparation.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "policestationagent.com",
    title: "What to Send When Instructing a Police Station Representative",
    metaTitle: "Instructing a Police Station Rep — What to Send",
    metaDescription:
      "Checklist for solicitors instructing freelance police station cover: references, conflicts, disclosure, and billing details.",
    keyword: "instruct police station representative",
    intent: "informational",
    audience: "Criminal defence firms",
    cta: "Email Instructions",
    internalLinks: ["/contact"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Send DSCC number, client name and DOB, station, offence, instructing fee earner, conflict check status, and any known vulnerability. Confirm whether legal aid or private. Provide a contact for post-interview updates.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "policestationagent.com",
    title: "Custody Record Numbers and DSCC References Explained",
    metaTitle: "Custody Record & DSCC References Explained (UK)",
    metaDescription:
      "How DSCC references and custody record numbers identify police station attendances for legal aid and firm records.",
    keyword: "DSCC reference custody record",
    intent: "informational",
    audience: "Solicitors and reps",
    cta: "Request Police Station Cover",
    internalLinks: ["/contact"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "The Defence Solicitor Call Centre (DSCC) allocates references for duty and own-client police station work. Custody record numbers identify the detention episode. Both should appear in attendance notes and billing records.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "policestationagent.com",
    title: "How Police Station Legal Advice Works Out of Hours",
    metaTitle: "Out-of-Hours Police Station Legal Advice (UK)",
    metaDescription:
      "How firms and the DSCC arrange police station representation overnight and at weekends in England and Wales.",
    keyword: "out of hours police station solicitor",
    intent: "informational",
    audience: "Firms and public",
    cta: "Call Robert Cashman",
    internalLinks: ["/contact"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Arrests continue 24/7. Firms rely on duty schemes, rota staff, or freelance accredited representatives. The DSCC routes calls to contracted providers. Clear instruction details reduce delays at the custody desk.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  // policestationrepuk.org (10)
  {
    site: "policestationrepuk.org",
    title: "How to Find a Police Station Representative Quickly",
    metaTitle: "Find a Police Station Representative Quickly (UK)",
    metaDescription:
      "Practical steps for solicitors to locate accredited police station cover: directories, DSCC, firms, and availability checks.",
    keyword: "find police station representative",
    intent: "informational",
    audience: "Criminal defence firms",
    cta: "Find a Police Station Rep",
    internalLinks: ["/search", "/register"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Start with your firm's rota, then accredited directories, regional rep networks, and the DSCC where applicable. Confirm accreditation status, conflicts, and station experience before instructing.",
        ],
      },
    ],
  },
  {
    site: "policestationrepuk.org",
    title: "How to Register as a Police Station Rep",
    metaTitle: "Register as a Police Station Rep (UK Directory)",
    metaDescription:
      "Steps for accredited representatives to join a police station rep directory: profile fields, areas covered, and keeping availability current.",
    keyword: "register police station rep",
    intent: "transactional",
    audience: "Accredited reps",
    cta: "Register as a Police Station Rep",
    internalLinks: ["/register", "/faq"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Registration typically requires accreditation details, coverage areas, contact methods, and availability notes. Keep profiles updated — outdated listings waste solicitor time.",
        ],
      },
    ],
  },
  {
    site: "policestationrepuk.org",
    title: "What Solicitors Look for in a Reliable Police Station Agent",
    metaTitle: "What Solicitors Want in a Police Station Agent",
    metaDescription:
      "Responsiveness, accreditation, note quality, and geography: what firms expect from freelance police station representatives.",
    keyword: "reliable police station agent",
    intent: "informational",
    audience: "Reps and firms",
    cta: "Join the Directory",
    internalLinks: ["/register"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Firms prioritise prompt attendance, clear attendance notes, accurate billing fields, and honest conflict handling. Local station familiarity is helpful but not a substitute for accreditation and professionalism.",
        ],
      },
    ],
  },
  {
    site: "policestationrepuk.org",
    title: "Police Station Rep Coverage: Why Location Matters",
    metaTitle: "Police Station Rep Coverage — Why Location Matters",
    metaDescription:
      "Geographic coverage, travel time, and station knowledge for police station representatives across England and Wales.",
    keyword: "police station rep coverage",
    intent: "informational",
    audience: "Solicitors and reps",
    cta: "Find a Police Station Rep",
    internalLinks: ["/kent-police-station-reps", "/london-police-station-reps"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Custody delays increase when reps are far from the station. Directory searches by county or force area help firms find nearby accredited cover.",
        ],
      },
    ],
  },
  {
    site: "policestationrepuk.org",
    title: "How to Keep Your Police Station Rep Directory Profile Useful",
    metaTitle: "Keep Your Rep Directory Profile Useful",
    metaDescription:
      "Update availability, stations covered, accreditation expiry, and contact details on your police station rep listing.",
    keyword: "police station rep directory profile",
    intent: "informational",
    audience: "Registered reps",
    cta: "Update Your Details",
    internalLinks: ["/register", "/update"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Review your profile after accreditation renewals, phone number changes, or coverage area shifts. Solicitors rely on accurate mobile numbers for urgent instructions.",
        ],
      },
    ],
  },
  {
    site: "policestationrepuk.org",
    title: "Police Station Reps in Kent: Coverage and Availability",
    metaTitle: "Police Station Reps in Kent — Directory Guide",
    metaDescription:
      "Finding accredited police station representatives in Kent: stations, travel, and directory tips for instructing firms.",
    keyword: "police station reps Kent",
    intent: "local",
    audience: "Kent firms",
    cta: "Find a Police Station Rep",
    internalLinks: ["/kent-police-station-reps"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Kent includes multiple custody suites. Filter directory results by Kent, verify accreditation, and confirm station experience before instructing.",
        ],
      },
    ],
  },
  {
    site: "policestationrepuk.org",
    title: "Police Station Reps in London: Practical Directory Guidance",
    metaTitle: "Police Station Reps in London — Directory Tips",
    metaDescription:
      "High-volume London custody work: using a rep directory, borough coverage, and instructing efficiently.",
    keyword: "police station reps London",
    intent: "local",
    audience: "London firms",
    cta: "Find a Police Station Rep",
    internalLinks: ["/london-police-station-reps"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "London forces cover many borough custody suites. Specify exact station and time constraints when searching or calling reps.",
        ],
      },
    ],
  },
  {
    site: "policestationrepuk.org",
    title: "Why Accredited Police Station Representatives Should Maintain Clear Availability",
    metaTitle: "Why Reps Should Keep Availability Clear",
    metaDescription:
      "Accurate availability on rep directories reduces missed cover and protects professional reputation.",
    keyword: "police station rep availability",
    intent: "informational",
    audience: "Accredited reps",
    cta: "Update Your Details",
    internalLinks: ["/register"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Solicitors instruct in urgent windows. If your profile says available but you are not, firms lose trust. Mark holidays and update same-day where possible.",
        ],
      },
    ],
  },
  {
    site: "policestationrepuk.org",
    title: "How Criminal Defence Firms Can Use a Rep Directory Effectively",
    metaTitle: "Using a Police Station Rep Directory — Firm Guide",
    metaDescription:
      "Workflow tips for criminal defence firms searching rep directories for emergency and planned police station cover.",
    keyword: "police station rep directory firms",
    intent: "informational",
    audience: "Criminal defence firms",
    cta: "Find a Police Station Rep",
    internalLinks: ["/search"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Save preferred reps, verify conflicts centrally, and keep instruction templates with DSCC fields ready. Directories supplement — not replace — firm rotas.",
        ],
      },
    ],
  },
  {
    site: "policestationrepuk.org",
    title: "Emergency Police Station Cover: Practical Tips for Firms",
    metaTitle: "Emergency Police Station Cover Tips for Firms",
    metaDescription:
      "When duty staff are unavailable: practical steps to secure urgent police station representation.",
    keyword: "emergency police station cover",
    intent: "informational",
    audience: "Criminal defence firms",
    cta: "Find a Police Station Rep",
    internalLinks: ["/search", "/contact"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Confirm client location and custody status, run conflicts, then contact directory reps with full DSCC details. Document who was called and when for audit.",
        ],
      },
    ],
  },
  // psrtrain.com (10)
  {
    site: "psrtrain.com",
    title: "How to Become a Police Station Representative",
    metaTitle: "How to Become a Police Station Representative (UK)",
    metaDescription:
      "Pathway to police station accreditation in England and Wales: training, portfolio, assessment, and practical tips.",
    keyword: "become police station representative",
    intent: "informational",
    audience: "Trainee reps",
    cta: "Register Interest",
    internalLinks: ["/police-station-representative-training", "/contact"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Candidates typically complete accredited training, build a portfolio of attendances, and pass assessment. Criminal procedure knowledge, PACE, and note-taking skills are core.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "psrtrain.com",
    title: "PACE Interview Basics for New Police Station Reps",
    metaTitle: "PACE Interview Basics for New Reps",
    metaDescription:
      "Essential PACE Code C and interview room skills for trainee police station representatives.",
    keyword: "PACE interview training reps",
    intent: "informational",
    audience: "Trainee reps",
    cta: "Book Training",
    internalLinks: ["/pace-interview-training"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Understand caution, recording, breaks, and role of the adviser. Observe how disclosure shapes advice and how to note questions and answers accurately.",
        ],
      },
    ],
  },
  {
    site: "psrtrain.com",
    title: "Understanding the Police Caution",
    metaTitle: "Understanding the Police Caution (UK Training)",
    metaDescription:
      "Teaching the police caution: wording, significance, and how reps explain it to clients.",
    keyword: "police caution explained",
    intent: "informational",
    audience: "Trainees and SQE learners",
    cta: "Download Training Guide",
    internalLinks: ["/criminal-defence-training"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "The caution explains that answers may be used in evidence and that silence may harm the defence. Clients need plain-language explanations, not recitation of statute alone.",
        ],
      },
    ],
  },
  {
    site: "psrtrain.com",
    title: "Advising on a No Comment Interview",
    metaTitle: "Advising on No Comment Interviews — Rep Training",
    metaDescription:
      "Training notes on no comment strategy, adverse inference, and recording advice for police station reps.",
    keyword: "no comment interview training",
    intent: "informational",
    audience: "Trainee reps",
    cta: "Book Training",
    internalLinks: ["/no-comment-interview-training"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Reps do not decide strategy — they facilitate advice. Training covers explaining inference, prepared statements, and accurate note-taking when the client stays silent.",
        ],
      },
    ],
  },
  {
    site: "psrtrain.com",
    title: "Youth Suspects at the Police Station",
    metaTitle: "Youth Suspects at the Police Station — Training",
    metaDescription:
      "Appropriate adults, welfare, and PACE safeguards for under-18 suspects — training overview for reps.",
    keyword: "youth suspect police station training",
    intent: "informational",
    audience: "Trainee reps",
    cta: "Register Interest",
    internalLinks: ["/youth-suspect-interview-training"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Youth cases require appropriate adults and heightened welfare checks. Reps must know when to pause interviews and escalate concerns.",
        ],
      },
    ],
  },
  {
    site: "psrtrain.com",
    title: "Vulnerable Suspects and Police Interviews",
    metaTitle: "Vulnerable Suspects & Police Interviews — Training",
    metaDescription:
      "Mental health, learning difficulties, and intermediaries: training for police station representatives.",
    keyword: "vulnerable suspect interview training",
    intent: "informational",
    audience: "Trainee reps",
    cta: "Book Training",
    internalLinks: ["/vulnerable-suspect-interview-training"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Vulnerability affects fitness for interview and need for appropriate adults or healthcare input. Document concerns clearly in attendance notes.",
        ],
      },
    ],
  },
  {
    site: "psrtrain.com",
    title: "Police Station Accreditation: Practical Preparation",
    metaTitle: "Police Station Accreditation — Practical Prep",
    metaDescription:
      "Portfolio, critical incidents, and assessment preparation for police station representative accreditation.",
    keyword: "police station accreditation preparation",
    intent: "informational",
    audience: "Accreditation candidates",
    cta: "Join Course Updates",
    internalLinks: ["/police-station-accreditation-support"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Build diverse portfolio attendances, reflect on critical incidents, and practise oral assessment scenarios. Know PACE codes relevant to custody and interview.",
        ],
      },
    ],
  },
  {
    site: "psrtrain.com",
    title: "Common Mistakes New Police Station Reps Make",
    metaTitle: "Common Mistakes New Police Station Reps Make",
    metaDescription:
      "Note-taking gaps, advice boundaries, and disclosure errors — training focus for new reps.",
    keyword: "police station rep mistakes",
    intent: "informational",
    audience: "Trainee reps",
    cta: "Download Training Guide",
    internalLinks: ["/police-station-representative-training"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Common errors include incomplete time records, conflating police account with client instructions, and giving legal advice beyond role. Supervision and structured templates reduce risk.",
        ],
      },
    ],
  },
  {
    site: "psrtrain.com",
    title: "How to Structure Police Station Advice",
    metaTitle: "How to Structure Police Station Advice — Training",
    metaDescription:
      "Consultation frameworks for reps: disclosure, instructions, options, and recording advice clearly.",
    keyword: "structure police station advice",
    intent: "informational",
    audience: "Trainee reps",
    cta: "Book Training",
    internalLinks: ["/pace-interview-training"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Work through offence summary, disclosure received, client account, legal options, and chosen strategy. Notes should show advice given and instructions followed.",
        ],
      },
    ],
  },
  {
    site: "psrtrain.com",
    title: "SQE Criminal Practice: Police Station Interview Basics",
    metaTitle: "SQE Criminal Practice — Police Station Basics",
    metaDescription:
      "SQE-focused introduction to police station attendance, PACE, and interview procedure for aspiring solicitors.",
    keyword: "SQE criminal practice police station",
    intent: "informational",
    audience: "SQE learners",
    cta: "Register Interest",
    internalLinks: ["/sqe-criminal-practice-training"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "SQE candidates should understand custody timelines, role of legal advisers, caution, and interview recording. Practical station experience complements exam knowledge.",
        ],
      },
    ],
  },
  // custodynote.com (10)
  {
    site: "custodynote.com",
    title: "How to Write a Proper Police Station Attendance Note",
    metaTitle: "How to Write a Police Station Attendance Note (UK)",
    metaDescription:
      "Structured approach to UK police station attendance notes: references, disclosure, advice, interview, outcome, and billing fields.",
    keyword: "police station attendance note",
    intent: "informational",
    audience: "Solicitors and reps",
    cta: "Try CustodyNote",
    internalLinks: ["/how-to-write-attendance-notes", "/trial"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "A proper attendance note records references (UFN, DSCC, custody number), attendance type, disclosure, consultation, interview summary, outcome, and time. Write for a reader who was not at the station — often a billing clerk or court advocate months later.",
        ],
      },
      {
        h2: "Core sections",
        paras: [
          "Open with client identification and instructing firm. Summarise disclosure objectively — distinguish police account from your client's instructions. Record advice in clear terms and note the interview strategy chosen.",
          "After interview, document outcome precisely: NFA, bail with date and conditions, RUI, or charge with court date. Break down time spent on travel, waiting, consultation, and interview for LAA or private billing.",
        ],
      },
    ],
    faq: [
      {
        q: "How long should an attendance note be?",
        a: "Long enough to be useful — typically several pages for a standard interview attendance. Brevity that omits material facts creates audit and advocacy risk.",
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "custodynote.com",
    title: "What Should Go in a Custody Note?",
    metaTitle: "What Should Go in a Custody Note? (UK Guide)",
    metaDescription:
      "Essential fields for a custody note: PACE compliance, firm expectations, and LAA-oriented record keeping.",
    keyword: "custody note contents",
    intent: "informational",
    audience: "Criminal defence professionals",
    cta: "Download Template",
    internalLinks: ["/custody-note-template", "/what-must-be-included-in-attendance-notes"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Include identity and references, reason for attendance, disclosure summary, welfare issues, advice, interview record, outcome, and next steps. Match your firm's file standards and LAA recording expectations.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "custodynote.com",
    title: "Police Interview Note-Taking: Practical Checklist",
    metaTitle: "Police Interview Note-Taking Checklist (UK)",
    metaDescription:
      "Checklist for recording PACE interviews in attendance notes: times, officers, topics, and interventions.",
    keyword: "police interview note taking",
    intent: "informational",
    audience: "Reps and duty solicitors",
    cta: "Try CustodyNote",
    internalLinks: ["/pace-interview-note-template", "/police-station-interview-notes"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Record start and end times, interviewing officers, caution given, topics covered, significant answers, no-comment periods, and any breaks or legal arguments.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "custodynote.com",
    title: "DSCC References, Custody Records and Attendance Notes",
    metaTitle: "DSCC, Custody Records & Attendance Notes",
    metaDescription:
      "How DSCC references and custody record numbers fit into attendance notes and legal aid billing.",
    keyword: "DSCC attendance note",
    intent: "informational",
    audience: "Solicitors and reps",
    cta: "Try CustodyNote",
    internalLinks: ["/dscc-attendance-note-workflow", "/glossary/custody-record"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "DSCC references link attendance to the call centre instruction. Custody record numbers identify the detention. Both belong in the header of your note and in billing submissions.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "custodynote.com",
    title: "Police Bail Notes: What to Record",
    metaTitle: "Police Bail Notes — What to Record (UK)",
    metaDescription:
      "Attendance note fields for police bail outcomes: dates, conditions, reasons given, and client advice.",
    keyword: "police bail attendance note",
    intent: "informational",
    audience: "Criminal defence professionals",
    cta: "Download Template",
    internalLinks: ["/police-bail-note-template", "/bail-rui-follow-up-checklist"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Record bail return date and station, each condition in full, whether bail was opposed, and advice on compliance and variation options.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "custodynote.com",
    title: "RUI Notes: What Criminal Practitioners Should Keep",
    metaTitle: "RUI Notes for Criminal Practitioners (UK)",
    metaDescription:
      "What to record when a client is released under investigation after a police station attendance.",
    keyword: "RUI attendance note",
    intent: "informational",
    audience: "Solicitors and reps",
    cta: "Download Template",
    internalLinks: ["/rui-note-template", "/bail-rui-follow-up-checklist"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Note that RUI was imposed, any verbal conditions or warnings given, client contact details confirmed, and follow-up instructions to the firm.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "custodynote.com",
    title: "Why Good Attendance Notes Matter in Criminal Defence",
    metaTitle: "Why Good Attendance Notes Matter (UK Defence)",
    metaDescription:
      "Audit, advocacy, billing, and handover: why structured police station attendance notes protect firms and clients.",
    keyword: "attendance notes criminal defence",
    intent: "informational",
    audience: "Firms and freelancers",
    cta: "Request Demo",
    internalLinks: ["/demo", "/why-switch"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Notes support bail applications, trial advocacy, LAA audits, and firm risk management. Poor notes create gaps that cannot be fixed months later.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "custodynote.com",
    title: "AI-Assisted Custody Notes: Benefits and Limits",
    metaTitle: "AI Custody Notes — Benefits and Limits (UK)",
    metaDescription:
      "Where AI can assist police station note-taking and where professional judgment must remain human-led.",
    keyword: "AI custody note",
    intent: "informational",
    audience: "Tech-curious firms",
    cta: "Try CustodyNote",
    internalLinks: ["/ai-custody-note-tool", "/features"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "AI can structure headings, suggest prompts, and reduce formatting time. It cannot replace attendance, confidentiality, or professional advice. Verify every entry against what occurred at the station.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "custodynote.com",
    title: "Police Station File Preparation Checklist",
    metaTitle: "Police Station File Preparation Checklist (UK)",
    metaDescription:
      "From attendance note to firm file: checklist for criminal defence practitioners after police station work.",
    keyword: "police station file preparation",
    intent: "informational",
    audience: "Solicitors and reps",
    cta: "Download Template",
    internalLinks: ["/criminal-defence-file-review-checklist", "/trial"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Export attendance note, attach custody record if obtained, log time, update CRM, flag bail dates, and send outcome email to instructing fee earner.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
  {
    site: "custodynote.com",
    title: "Attendance Note Template for Police Station Representatives",
    metaTitle: "Attendance Note Template for Police Station Reps (UK)",
    metaDescription:
      "Practical template structure for accredited representatives recording police station attendances.",
    keyword: "attendance note template police station rep",
    intent: "informational",
    audience: "Police station reps",
    cta: "Download Template",
    internalLinks: ["/attendance-note-template-uk", "/police-station-reps"],
    sections: [
      {
        h2: "Answer-first summary",
        paras: [
          "Use consistent headings for every attendance so supervisors and firms know where to find disclosure, advice, and outcome. Templates speed billing and reduce omissions.",
        ],
      },
    ],
    author: "Robert Cashman",
  },
];

function renderMarkdown(post) {
  const slug = slugify(post.title);
  const siteUrl =
    post.site === "custodynote.com"
      ? "https://custodynote.com"
      : post.site === "policestationagent.com"
        ? "https://policestationagent.com"
        : post.site === "policestationrepuk.org"
          ? "https://policestationrepuk.org"
          : "https://psrtrain.com";

  let md = `---
title: "${post.title.replace(/"/g, '\\"')}"
slug: ${slug}
site: ${post.site}
meta_title: "${post.metaTitle.replace(/"/g, '\\"')}"
meta_description: "${post.metaDescription.replace(/"/g, '\\"')}"
target_keyword: "${post.keyword}"
search_intent: ${post.intent}
audience: "${post.audience}"
primary_cta: "${post.cta}"
publish_date: 2026-06-09
last_updated: 2026-06-09
author: ${post.author || "Editorial team"}
schema_type: Article
status: draft
canonical_url: ${siteUrl}/blog/${slug}
---

# ${post.title}

**Last updated:** 9 June 2026${post.author ? ` · **Author:** ${post.author}` : ""}

`;

  for (const sec of post.sections) {
    md += `\n## ${sec.h2}\n\n`;
    for (const p of sec.paras) md += `${p}\n\n`;
  }

  if (post.internalLinks?.length) {
    md += `## Related pages\n\n`;
    for (const link of post.internalLinks) {
      md += `- [${link.replace(/^\//, "").replace(/-/g, " ")}](${siteUrl}${link})\n`;
    }
    md += "\n";
  }

  if (post.faq?.length) {
    md += `## FAQ\n\n`;
    for (const f of post.faq) {
      md += `### ${f.q}\n\n${f.a}\n\n`;
    }
  }

  md += `## ${post.cta}\n\n`;
  md += `Ready to take the next step? Visit [${post.site}](${siteUrl}) or use the primary CTA on the site.\n`;
  md += DISCLAIMER;

  // Pad word count with practical extension paragraphs per site
  const extras = {
    "policestationagent.com":
      "\n## Working with Defence Legal Services\n\nRobert Cashman provides police station representation and agency cover in Kent and Medway. Firms can instruct by phone, WhatsApp, or email with DSCC references and client details.\n",
    "policestationrepuk.org":
      "\n## Using the directory responsibly\n\nDirectory listings support discovery — always verify accreditation and conflicts before instruction. Update your own listing promptly when availability changes.\n",
    "psrtrain.com":
      "\n## Next training steps\n\nStructured training builds on real station experience. Pair courses with supervised attendances and portfolio reflection for accreditation readiness.\n",
    "custodynote.com":
      "\n## Structured notes with Custody Note\n\nCustody Note is desktop software for criminal defence professionals — offline-first attendance notes with LAA-oriented fields, PDF export, and consistent structure. [Start a 30-day free trial](https://custodynote.com/trial).\n",
  };
  md += extras[post.site] || "";

  return { slug, md, post };
}

// Write blog posts
for (const post of POSTS) {
  const { slug, md } = renderMarkdown(post);
  const dir = path.join(BLOG_ROOT, post.site);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.md`), md);
}

// Buffer + calendar
const startDate = new Date("2026-06-10T09:00:00");
const channels = ["LinkedIn", "Facebook", "X/Twitter"];
const bufferRows = [];
const bufferJson = [];
const calendarRows = [];

POSTS.forEach((post, i) => {
  const { slug } = renderMarkdown(post);
  const siteUrl =
    post.site === "custodynote.com"
      ? "https://custodynote.com"
      : post.site === "policestationagent.com"
        ? "https://policestationagent.com"
        : post.site === "policestationrepuk.org"
          ? "https://policestationrepuk.org"
          : "https://psrtrain.com";
  const url = `${siteUrl}/blog/${slug}`;
  const pubDate = new Date(startDate);
  pubDate.setDate(pubDate.getDate() + Math.floor(i / 2));
  const pubStr = pubDate.toISOString().slice(0, 10);

  calendarRows.push({
    blog_title: post.title,
    site: post.site,
    target_keyword: post.keyword,
    search_intent: post.intent,
    audience: post.audience,
    publish_date: pubStr,
    social_promotion_dates: pubStr,
    internal_links: post.internalLinks?.join("; ") || "",
    cta: post.cta,
    schema_type: "Article",
    status: "draft",
  });

  channels.forEach((channel, ci) => {
    const socialDate = new Date(pubDate);
    socialDate.setDate(socialDate.getDate() + ci * 2);
    const dateStr = socialDate.toISOString().slice(0, 10);
    const timeStr = channel === "X/Twitter" ? "12:30" : "09:30";
    const text =
      channel === "X/Twitter"
        ? `${post.title} — practical UK criminal defence guidance. ${url}`
        : `${post.title}\n\n${post.metaDescription}\n\nRead more: ${url}\n\n#CriminalDefence #PoliceStation #UKLaw`;

    bufferRows.push({
      channel,
      site: post.site,
      blog_title: post.title,
      post_text: text.replace(/\n/g, " "),
      link: url,
      suggested_date: dateStr,
      suggested_time: timeStr,
      status: "draft",
      notes: "Generated draft — review before scheduling",
    });
    bufferJson.push({ ...bufferRows[bufferRows.length - 1] });
  });
});

function csvEscape(s) {
  return `"${String(s).replace(/"/g, '""')}"`;
}

const csvHeader =
  "channel,site,blog_title,post_text,link,suggested_date,suggested_time,status,notes\n";
const csvBody = bufferRows
  .map((r) =>
    [
      r.channel,
      r.site,
      r.blog_title,
      r.post_text,
      r.link,
      r.suggested_date,
      r.suggested_time,
      r.status,
      r.notes,
    ]
      .map(csvEscape)
      .join(","),
  )
  .join("\n");

fs.writeFileSync(path.join(ROOT, "buffer", "buffer-posts.csv"), csvHeader + csvBody);
fs.writeFileSync(
  path.join(ROOT, "buffer", "buffer-posts.json"),
  JSON.stringify(bufferJson, null, 2),
);

const calHeader =
  "blog_title,site,target_keyword,search_intent,audience,publish_date,social_promotion_dates,internal_links,cta,schema_type,status\n";
const calBody = calendarRows
  .map((r) =>
    Object.values(r)
      .map(csvEscape)
      .join(","),
  )
  .join("\n");
fs.writeFileSync(path.join(ROOT, "content-calendar-90-days.csv"), calHeader + calBody);

console.log(`Generated ${POSTS.length} blog posts, ${bufferRows.length} buffer rows, calendar.`);

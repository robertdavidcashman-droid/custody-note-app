function normalizeText(s) {
  return String(s || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '\n');
}

function clean(s) {
  return String(s || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseDateGBToISO(s) {
  const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseDateTimeGBToISO(s) {
  const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`;
}

function yn(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'yes' || s === 'y' || s === 'true') return 'Yes';
  if (s === 'no' || s === 'n' || s === 'false') return 'No';
  return String(v || '').trim();
}

function extractOne(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1] != null) return String(m[1]).trim();
  }
  return '';
}

function extractBlock(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start === -1) return '';
  const afterStart = text.slice(start);
  const endIdx = afterStart.search(endRe);
  const block = endIdx === -1 ? afterStart : afterStart.slice(0, endIdx);
  return clean(block);
}

function extractCodePrefix(s) {
  const m = String(s || '').trim().match(/^([A-Z0-9]{1,6})\s*[–-]\s*/i);
  return m ? m[1].toUpperCase() : '';
}

function splitAddress(addr) {
  const raw = clean(addr);
  if (!raw) return {};
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
  const out = { address1: '', address2: '', address3: '', city: '', county: '', postCode: '' };

  // Basic heuristic: last part contains postcode if it matches UK-ish pattern.
  const last = parts[parts.length - 1] || '';
  const pcMatch = last.match(/\b([A-Z]{1,2}\d[A-Z0-9]?\s*\d[A-Z]{2})\b/i);
  if (pcMatch) {
    out.postCode = pcMatch[1].toUpperCase().replace(/\s+/g, ' ');
    // Remove postcode from last chunk
    parts[parts.length - 1] = last.replace(pcMatch[0], '').replace(/\s+/g, ' ').trim();
    if (!parts[parts.length - 1]) parts.pop();
  }

  out.address1 = parts[0] || '';
  if (parts.length === 2) {
    out.city = parts[1] || '';
  } else if (parts.length >= 3) {
    out.city = parts[parts.length - 2] || '';
    out.county = parts[parts.length - 1] || '';
    out.address2 = parts[1] || '';
    out.address3 = parts.slice(2, Math.max(2, parts.length - 2)).join(', ');
  }
  return out;
}

function setChecklistFlagFromLine(text, key, phrase, outObj) {
  const re = new RegExp(String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const idx = text.search(re);
  if (idx === -1) return;
  // Look back a little for the checkbox glyph
  const window = text.slice(Math.max(0, idx - 16), Math.min(text.length, idx + phrase.length + 16));
  if (window.includes('☑')) outObj[key] = true;
  if (window.includes('☐')) outObj[key] = false;
}

/**
 * Parse a Custody Note-generated "CUSTODY NOTE" PDF text (pdf-parse output) into Custody Note record data.
 * Returns record data object, or null if text doesn't look compatible.
 */
function parseCasenotePdfTextToRecordData(pdfText) {
  const text = normalizeText(pdfText);
  if (!text || !/CUSTODY NOTE/i.test(text) || !/Created with (Casenote|Custody Note)/i.test(text)) return null;

  const data = {};

  // Header-ish fields
  data.ourFileNumber = extractOne(text, [
    /File number \(ours\)\s*\/\s*Invoice no\.\:\s*([^\s·\n]+)/i,
    /File number \(ours\)\s*\/\s*Invoice no\.\s+([^\s·\n]+)/i,
  ]);
  if (data.ourFileNumber) data.fileReference = data.ourFileNumber;

  const headerDate = extractOne(text, [
    /\bDate\:\s*(\d{2}\/\d{2}\/\d{4})\b/i,
    /\bDate\s+(\d{2}\/\d{2}\/\d{4})\b/i,
  ]);
  data.date = parseDateGBToISO(headerDate);

  data.dsccRef = extractOne(text, [
    /^DSCC number:\s*([0-9A-Za-z]+)\b/im,
    /^DSCC number\s*([0-9A-Za-z]+)\b/im,
  ]);

  data.custodyNumber = extractOne(text, [
    /^Custody number\s*([^\s\n]+)/im,
    /^Custody no\.\:\s*([^\s\n]+)/im,
    /\bCustody no\.\:\s*([^\s\n]+)/i,
  ]).replace(/\s+/g, ' ').trim();

  // Case reference & arrival
  const instr = extractOne(text, [
    /^Instruction received\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})\b/im,
  ]);
  data.instructionDateTime = parseDateTimeGBToISO(instr);

  data.firmName = extractOne(text, [
    /^Firm:\s*([^\n]+)$/im,
    /^Firm\s*([^\n]+)$/im,
  ]);
  data.firmContactName = extractOne(text, [/^Firm contact\s*([^\n]+)$/im]);
  data.firmContactPhone = extractOne(text, [/^Contact phone\s*([^\n]+)$/im]);
  data.firmContactEmail = extractOne(text, [/^Contact email\s*([^\n]+)$/im]);

  data.forename = extractOne(text, [/^Client first name\s*([^\n]+)$/im, /\bClient:\s*([A-Za-z'-]+)\s+[A-Za-z'-]+\s*Station:/i]);
  data.surname = extractOne(text, [/^Client surname\s*([^\n]+)$/im, /\bClient:\s*[A-Za-z'-]+\s+([A-Za-z'-]+)\s*Station:/i]);

  data.offenceSummary = extractOne(text, [
    /^Offence\s*\(summary\)\s*([^\n]+)$/im,
    /\bOffence:\s*([^\n]+?)\s+Custody no\.\:/i,
  ]);

  data.policeStationName = extractOne(text, [
    /^Station:\s*([^\n]+)$/im,
    /^Station\s*([^\n]+)$/im,
  ]);

  data.oicName = extractOne(text, [/^Officer in Charge\s*([^\n]+)$/im]);
  data.oicEmail = extractOne(text, [/^Officer in Charge email\s*([^\n]+)$/im]);
  data.oicPhone = extractOne(text, [/^Officer in Charge telephone\s*([^\n]+)$/im]);

  data.weekendBankHoliday = yn(extractOne(text, [/^Weekend\/Bank Holiday\s*(Yes|No)\b/im]));
  data.sourceOfReferral = extractOne(text, [/^Referral\s*([^\n]+)$/im]);
  data.workType = extractOne(text, [/^Work Type\s*([^\n]+)$/im]);
  data.telephoneAdviceGiven = extractOne(text, [/^Telephone advice given\?\s*([^\n]+)$/im]);
  data.schemeId = extractOne(text, [/^Scheme ID\s*([^\n]+)$/im]);
  data.dutySolicitor = extractOne(text, [/^Duty Solicitor\s*([^\n]+)$/im]);
  data.clientStatus = extractOne(text, [/^Client Status\s*([^\n]+)$/im]);
  data.caseStatus = extractOne(text, [/^Case Status\s*([^\n]+)$/im]);
  data.timeFirstContactWithClient = extractOne(text, [/^Time first contact\s*\(LAA 9\.25\)\s*(\d{2}:\d{2})\b/im]);
  data.firstContactWithin45Mins = yn(extractOne(text, [/^First contact within 45 mins\?\s*(Yes|No)\b/im]));

  data.sufficientBenefitTest = extractOne(text, [/^Sufficient Benefit Test\s*([^\n]+)$/im]);

  // Journey
  data.alreadyAtStation = yn(extractOne(text, [/^Already at station\?\s*(Yes|No)\b/im]));
  data.travelOriginPostcode = extractOne(text, [/^Travel from\s*([A-Z0-9]{5,8})\b/im]);
  data.timeSetOff = extractOne(text, [/^Time set off\s*(\d{2}:\d{2})\b/im]);
  data.timeArrival = extractOne(text, [/^Time arrival at station\s*(\d{2}:\d{2})\b/im]);

  // Custody record
  data.custodyRecordRead = yn(extractOne(text, [/^Custody record read\?\s*(Yes|No)\b/im]));
  const title = extractOne(text, [/Client \(from record\)\s*(Mr|Mrs|Miss|Ms|Mx|Dr)\b/i]);
  if (title) data.title = title;

  const dob = extractOne(text, [/^Date of birth\s*(\d{2}\/\d{2}\/\d{4})\b/im]);
  data.dob = parseDateGBToISO(dob);
  data.gender = extractOne(text, [/^Gender\s*([^\n]+)$/im]);
  data.nationality = extractOne(text, [/^Nationality\s*([^\n]+)$/im]);

  const addrLine = extractOne(text, [/^Address\s*([^\n]+)$/im]);
  Object.assign(data, splitAddress(addrLine));

  data.voluntaryInterview = yn(extractOne(text, [/^Voluntary Interview\s*(Yes|No)\b/im]));

  const gfa = extractOne(text, [/Grounds for arrest\s*([\s\S]*?)\s*Grounds for detention\s*/i]);
  if (gfa) {
    const g = clean(gfa).replace(/\s+under PACE\b/i, ' under PACE');
    data.groundsForArrest = g.split(/\s*,\s*/).filter(Boolean).join('|');
  }
  const gfd = extractOne(text, [/Grounds for detention\s*([\s\S]*?)\s*Date of arrest\s*/i]);
  if (gfd) data.groundsForDetention = clean(gfd).split(/\s*,\s*/).filter(Boolean).join('|');

  data.dateOfArrest = parseDateGBToISO(extractOne(text, [/^Date of arrest\s*(\d{2}\/\d{2}\/\d{4})\b/im]));
  data.timeOfArrest = extractOne(text, [/^Time of arrest\s*(\d{2}:\d{2})\b/im]);
  data.timeArrivalStation = extractOne(text, [/^Arrival at station\s*(\d{2}:\d{2})\b/im]);
  data.relevantTime = extractOne(text, [/^Relevant Time\s*(\d{2}:\d{2})\b/im]);
  data.timeDetentionAuthorised = extractOne(text, [/^Detention authorised \(time\)\s*(\d{2}:\d{2})\b/im]);

  data.firstReviewDue = extractOne(text, [/^First review due\s*(\d{2}:\d{2})\b/im]);
  data.firstReviewActual = extractOne(text, [/^First review actual\s*(\d{2}:\d{2})\b/im]);
  data.firstReviewNotes = extractOne(text, [/^First review notes\s*([^\n]+)$/im]);
  data.secondReviewDue = extractOne(text, [/^Second review due\s*(\d{2}:\d{2})\b/im]);
  data.thirdReviewDue = extractOne(text, [/^Third review due\s*(\d{2}:\d{2})\b/im]);

  data.languageIssues = yn(extractOne(text, [/^Language Issues\s*(Yes|No)\b/im]));
  data.juvenileVulnerable = extractOne(text, [/^Juvenile\s*\/\s*Vulnerable\s*([^\n]+)$/im]);
  data.appropriateAdultName = extractOne(text, [/^Appropriate adult\s*([^\n]+)$/im]);
  data.appropriateAdultRelation = extractOne(text, [/^Appropriate adult relationship\s*([^\n]+)$/im]);
  data.appropriateAdultEmail = extractOne(text, [/^Appropriate adult email\s*([^\n]+)$/im]);

  data.injuriesToClient = yn(extractOne(text, [/^Injuries\s*(Yes|No)\b/im]));
  data.psychiatricIssues = yn(extractOne(text, [/^Psychiatric\/mental health issues\?\s*(Yes|No)\b/im]));
  data.literate = yn(extractOne(text, [/^Literate\/can read\?\s*(Yes|No)\b/im]));
  data.drugsTest = extractOne(text, [/^Drugs test\s*([^\n]+)$/im]);
  data.fmeNurse = yn(extractOne(text, [/^FME\s*\/\s*Nurse\s*\/\s*Doctor\s*(Yes|No)\b/im]));
  data.fitToBeDetained = yn(extractOne(text, [/^Fit to be detained\?\s*(Yes|No)\b/im]));
  data.fitToBeInterviewed = yn(extractOne(text, [/^Fit to be interviewed\?\s*(Yes|No)\b/im]));

  // Offences (best-effort)
  const offenceBlock = extractBlock(text, /4\.\s*Offences/i, /5\.\s*Disclosure/i);
  if (offenceBlock) {
    const mt = extractOne(offenceBlock, [/^Matter Type\s*([^\n]+)$/im]);
    data.matterTypeCode = extractCodePrefix(mt) || (mt.match(/\b(\d{2})\b/) ? mt.match(/\b(\d{2})\b/)[1] : '');

    for (let n = 1; n <= 4; n++) {
      const det = extractOne(offenceBlock, [new RegExp(`^Offence ${n}\\s*([^\\n]+)$`, 'im')]);
      if (det) data[`offence${n}Details`] = det;
      const dt = extractOne(offenceBlock, [new RegExp(`Offence ${n}[\\s\\S]*?\\bDate\\s*(\\d{2}\\/\\d{2}\\/\\d{4})\\b`, 'i')]);
      if (dt) data[`offence${n}Date`] = parseDateGBToISO(dt);
      const mode = extractOne(offenceBlock, [new RegExp(`Offence ${n}[\\s\\S]*?\\bMode\\s*([A-Z]{2})\\b`, 'i')]);
      if (mode) data[`offence${n}ModeOfTrial`] = mode.trim();
      const statute = extractOne(offenceBlock, [new RegExp(`Offence ${n}[\\s\\S]*?\\bStatute\\s*([^\\n]+)`, 'i')]);
      if (statute) data[`offence${n}Statute`] = statute;
    }
  }

  // Disclosure section
  const disclosureBlock = extractBlock(text, /5\.\s*Disclosure/i, /6\.\s*Consultation/i);
  if (disclosureBlock) {
    data.disclosureType = extractOne(disclosureBlock, [/^Type\s*([^\n]+)$/im]);
    data.disclosureOfficerIsOIC = yn(extractOne(disclosureBlock, [/^Officer in Charge\s*=\s*Disclosure officer\?\s*(Yes|No)\b/im]));
    data.significantStatements = extractOne(disclosureBlock, [/^Statements\s*([^\n]+)$/im]);
    data.clientSignedEAB = yn(extractOne(disclosureBlock, [/^Evidence against client \(signed\)\s*(Yes|No)\b/im]));
    data.coSuspects = yn(extractOne(disclosureBlock, [/^Co-suspects\s*(Yes|No)\b/im]));
    data.nameOfComplainant = extractOne(disclosureBlock, [/^Complainant\s*([^\n]+)$/im]);
    data.prosecutionWitnesses = yn(extractOne(disclosureBlock, [/^Prosecution witnesses\?\s*(Yes|No)\b/im]));
    data.witnessIntimidation = yn(extractOne(disclosureBlock, [/^Witness intimidation\?\s*(Yes|No)\b/im]));
    data.cctvVisual = yn(extractOne(disclosureBlock, [/^CCTV\/BWV\/visual\?\s*(Yes|No)\b/im]));
    data.writtenEvidence = yn(extractOne(disclosureBlock, [/^Written evidence\?\s*(Yes|No)\b/im]));
    data.writtenEvidenceDetails = extractOne(disclosureBlock, [/^Written evidence details\s*([^\n]+)$/im]);
    data.exhibitsToInspect = yn(extractOne(disclosureBlock, [/^Exhibits to inspect\?\s*(Yes|No)\b/im]));
    data.exhibitsInspected = extractOne(disclosureBlock, [/^Exhibits inspected\?\s*([^\n]+)$/im]);
    data.pncDisclosed = yn(extractOne(disclosureBlock, [/^PNC\/pre-cons disclosed\?\s*(Yes|No)\b/im]));
    data.samplesDisclosed = extractOne(disclosureBlock, [/^Samples \(disclosed\)\?\s*([^\n]+)$/im]);
    data.cautionAvailable = yn(extractOne(disclosureBlock, [/^Caution\/out-of-court offered\?\s*(Yes|No)\b/im]));
    data.clothingShoesSeized = yn(extractOne(disclosureBlock, [
      /^Clothing\/shoes seized\?\s*(Yes|No)\b/im,
      /^Clothing\/shoes\/phone seized\?\s*(Yes|No)\b/im,
    ]));
    data.disclosureReInjuries = extractOne(disclosureBlock, [/^Injuries \(disclosure\)\s*([^\n]+)$/im]);

    // PACE search 1 line in this PDF style
    const pace = extractOne(disclosureBlock, [/^PACE search 1\s*([^\n]+)$/im]);
    if (pace) {
      const m = pace.match(/^([^\:]+)\:\s*(.+)$/);
      data.paceSearches = [{ searchType: m ? m[1].trim() : pace.trim(), whatFound: m ? m[2].trim() : '' }];
    }
  }

  // Narrative paragraphs inside disclosure
  const disclosureNarr = extractBlock(text, /We are investigating/i, /6\.\s*Consultation/i);
  if (disclosureNarr) data.disclosureNarrative = disclosureNarr;

  // Consultation section (checkboxes + client details + advice)
  const consultBlock = extractBlock(text, /6\.\s*Consultation/i, /7\.\s*Interview/i);
  if (consultBlock) {
    // checklist flags
    setChecklistFlagFromLine(consultBlock, 'chkConflictCheck', 'Conflict of interest check completed', data);
    setChecklistFlagFromLine(consultBlock, 'chkConfidentiality', 'Advised on confidentiality', data);
    setChecklistFlagFromLine(consultBlock, 'chkIndependence', 'Advised independence of legal advice', data);
    setChecklistFlagFromLine(consultBlock, 'chkFreeRep', 'Advised free representation', data);
    setChecklistFlagFromLine(consultBlock, 'chkWelfare', 'Checked client welfare', data);
    setChecklistFlagFromLine(consultBlock, 'chkDontDiscuss', 'Advised not to discuss case with anyone', data);
    setChecklistFlagFromLine(consultBlock, 'chkDontSign', 'Advised not to sign anything without legal advice', data);
    setChecklistFlagFromLine(consultBlock, 'chkUnderstands', 'Client understands advice given', data);
    setChecklistFlagFromLine(consultBlock, 'chkPersonalData', 'Confirmed personal data on custody record', data);
    setChecklistFlagFromLine(consultBlock, 'chkReasonForArrest', 'Explained reason for arrest', data);
    setChecklistFlagFromLine(consultBlock, 'chkDisclosure', 'Explained disclosure', data);

    data.conflictCheckResult = extractOne(consultBlock, [/^Conflict check result\s*([^\n]+)$/im]);
    data.clientType = extractOne(consultBlock, [/^Type\s*([^\n]+)$/im]);
    data.niNumber = extractOne(consultBlock, [/^National Insurance number\s*([^\n]+)$/im]);
    data.benefits = yn(extractOne(consultBlock, [/^Benefits\s*(Yes|No)\b/im]));
    data.passportedBenefit = extractOne(consultBlock, [/^Passported Benefit\s*([^\n]+)$/im]);
    data.employmentStatus = extractOne(consultBlock, [/^Employment\s*([^\n]+)$/im]);
    data.accommodationStatus = extractOne(consultBlock, [/^Accommodation\s*([^\n]+)$/im]);
    data.maritalStatus = extractOne(consultBlock, [/^Marital status\s*([^\n]+)$/im]);
    data.clientPhone = extractOne(consultBlock, [/^Phone\s*([^\n]+)$/im]);

    const eth = extractOne(consultBlock, [/^Ethnicity\s*([^\n]+)$/im]);
    data.ethnicOriginCode = extractCodePrefix(eth) || '';
    const dis = extractOne(consultBlock, [/^Disability\s*([^\n]+)$/im]);
    data.disabilityCode = extractCodePrefix(dis) || '';

    data.riskAssessment = extractOne(consultBlock, [/^Risk\s*([^\n]+)$/im]);
    data.gapsInEvidence = extractOne(consultBlock, [/^Gaps\s*([^\n]+)$/im]);
    data.caseAssessment = extractOne(consultBlock, [/^Case assessment \(police case\)\s*([^\n]+)$/im]);
    data.likelySentence = extractOne(consultBlock, [/^Sentence\s*([^\n]+)$/im]);

    // Advice checklist flags
    setChecklistFlagFromLine(consultBlock, 'advSilence', 'Right to Silence & Inferences Explained', data);
    setChecklistFlagFromLine(consultBlock, 'advCaution', 'Caution Explained', data);
    setChecklistFlagFromLine(consultBlock, 'advConsequences', 'Consequences of lying / different version later', data);
    setChecklistFlagFromLine(consultBlock, 'advBadCharacter', 'Bad Character', data);
    setChecklistFlagFromLine(consultBlock, 'advSpecialWarning', 'Special Warning Explained', data);
    setChecklistFlagFromLine(consultBlock, 'advInterviewProcedure', 'Interview Procedure Explained', data);
    setChecklistFlagFromLine(consultBlock, 'advRights', 'Rights: Answer / No Answer / Prepared statement', data);
    setChecklistFlagFromLine(consultBlock, 'advStopInterview', 'Right to Stop Interview for advice', data);
    setChecklistFlagFromLine(consultBlock, 'advIDProcedures', 'ID procedures explained', data);
    setChecklistFlagFromLine(consultBlock, 'advCourtProcedure', 'Court procedure explained', data);
    setChecklistFlagFromLine(consultBlock, 'advAlibis', 'Alibis discussed', data);
    setChecklistFlagFromLine(consultBlock, 'advFailureToAttendBail', 'Failure to attend bail explained', data);

    data.adviceReInterview = extractOne(consultBlock, [/^Advice re interview\s*([^\n]+)$/im]);
    data.reasonsForAdviceSelect = extractOne(consultBlock, [/^Reason \(quick\)\s*([^\n]+)$/im]);
    data.reasonsForAdvice = extractOne(consultBlock, [/^Reasons \(detail\)\s*([^\n]+)$/im]);
    data.clientDecision = extractOne(consultBlock, [/^Decision\s*([^\n]+)$/im]);
    data.adviceFollowedInInterview = yn(extractOne(consultBlock, [/^Advice followed in interview\?\s*(Yes|No)\b/im]));
    data.adviceReComplaint = yn(extractOne(consultBlock, [/^Advice re complaint given\?\s*(Yes|No)\b/im]));
  }

  // Law elements block (optional) – keep as narrative
  const lawElements = extractBlock(text, /\nROBBERY\s*\n/i, /\nSummary of client instructions\s*\n/i);
  if (lawElements) data.lawElements = lawElements;
  const clientInstr = extractOne(text, [/Summary of client instructions\s*\n\s*([^\n]+)\n/i]);
  if (clientInstr) data.clientInstructions = clientInstr;

  // Interview
  const ivBlock = extractBlock(text, /7\.\s*Interview/i, /8\.\s*Outcome/i);
  if (ivBlock) {
    const iv = {
      startTime: extractOne(ivBlock, [/^Start\s*(\d{2}:\d{2})\b/im]),
      endTime: extractOne(ivBlock, [/^End\s*(\d{2}:\d{2})\b/im]),
      present: extractOne(ivBlock, [/^Present\s*([^\n]+)$/im]),
      cautioned: yn(extractOne(ivBlock, [/^Cautioned\s*(Yes|No)\b/im])),
      notes: '',
    };
    const transcript = extractBlock(ivBlock, /\bTime is\b/i, /\nClient answered all questions openly\./i) || extractBlock(ivBlock, /\bTime is\b/i, /\n8\.\s*Outcome/i);
    if (transcript) {
      const capped = transcript.length > 50000 ? (transcript.slice(0, 50000) + '\n\n[...truncated...]') : transcript;
      iv.notes = capped;
    } else {
      const tailNote = extractOne(ivBlock, [/Client answered all questions openly\.\s*([^\n]+)\n/i]);
      if (tailNote) iv.notes = tailNote;
    }
    data.interviews = [iv];
  }

  // Outcome
  const outcomeBlock = extractBlock(text, /8\.\s*Outcome/i, /9\.\s*Time Recording/i);
  if (outcomeBlock) {
    data.outcomeDecision = extractOne(outcomeBlock, [/Outcome:\s*([^\n]+)\n/i, /Decision\s+([^\n]+)\n/i]);
    data.bailReturnTime = extractOne(outcomeBlock, [/^Time to return\s*(\d{2}:\d{2})\b/im]);
    data.bailReturnStationName = extractOne(outcomeBlock, [/^Police station to return to \(name\)\s*([^\n]+)$/im]);
    data.bailReturnStationCode = extractOne(outcomeBlock, [/^Police station to return to \(code\)\s*([^\n]+)$/im]);
    data.bailType = extractOne(outcomeBlock, [/^Bail type\s*([^\n]+)$/im]);
    data.furtherAttendance = yn(extractOne(outcomeBlock, [/^Further attendance\s*(Yes|No)\b/im]));

    // Bail conditions from this PDF's formatted rows
    const residence = extractOne(outcomeBlock, [/^Residence\s*([^\n]+)$/im]);
    const curfew = extractOne(outcomeBlock, [/^Curfew\s*([^\n]+)$/im]);
    const noContact = extractOne(outcomeBlock, [/^No contact with witnesses\s*\/\s*co-accused\s*([^\n]+)$/im]);
    const bcd = {};
    if (residence) bcd.residence = { checked: true, detail: residence };
    if (curfew) bcd.curfew = { checked: true, detail: curfew };
    if (noContact) bcd.noContactWitness = { checked: true, detail: noContact };
    if (Object.keys(bcd).length) data.bailConditionsData = bcd;
  }

  // Time recording & fees
  const timeBlock = extractBlock(text, /9\.\s*Time Recording/i, /10\.\s*LAA Declaration/i);
  if (timeBlock) {
    data.timeDeparture = extractOne(timeBlock, [/^Time departure from station\s*(\d{2}:\d{2})\b/im]);
    data.timeOfficeHome = extractOne(timeBlock, [/^Time arrival office\/home\s*(\d{2}:\d{2})\b/im]);
    data.multipleJourneys = yn(extractOne(timeBlock, [/^Multiple journeys\s*(Yes|No)\b/im]));
    data.travelSocial = extractOne(timeBlock, [/Travel\s+[–-]\s+social \(mins\)\s+(\d+)\b/i]);
    data.travelUnsocial = extractOne(timeBlock, [/Travel\s+[–-]\s+unsocial \(mins\)\s+(\d+)\b/i]);
    data.adviceSocial = extractOne(timeBlock, [/Attendance\s*&\s*Advice\s+[–-]\s+social \(mins\)\s+(\d+)\b/i]);
    data.adviceUnsocial = extractOne(timeBlock, [/Attendance\s*&\s*Advice\s+[–-]\s+unsocial \(mins\)\s+(\d+)\b/i]);
    data.totalMinutes = extractOne(timeBlock, [/^Total minutes\s*(\d+)\b/im]);
    data.milesClaimable = extractOne(timeBlock, [/^Miles claimable \(45p\)\s*(\d+)\b/im]);
    data.numAttendances = extractOne(timeBlock, [/^No\.\s*Attendances\s*(\d+)\b/im]);
    data.caseStage = extractOne(timeBlock, [/^Case stage\s*([^\n]+)$/im]);
    data.policeStationFinalisedDate = parseDateGBToISO(extractOne(timeBlock, [/^Date police station finalised\s*(\d{2}\/\d{2}\/\d{4})\b/im]));
    data.policeStationFinalisedTime = extractOne(timeBlock, [/^Time police station finalised\s*(\d{2}:\d{2})\b/im]);
    const repLine = extractOne(timeBlock, [/Rep confirmation\s*\n\s*([^\n]+)\n/i]);
    if (repLine) data.notesToOffice = repLine;
  }

  // LAA declaration
  const laaBlock = extractBlock(text, /10\.\s*LAA Declaration/i, /11\.\s*Admin/i);
  if (laaBlock) {
    data.previousAdvice = yn(extractOne(laaBlock, [/^Previous advice\?\s*(Yes|No)\b/im]));
    data.privacyNoticeAccepted = yn(extractOne(laaBlock, [/^Privacy Notice acknowledged\?\s*(Yes|No)\b/im, /^Privacy Notice\s*(Yes|No)\b/im]));
    data.laaClientFullName = extractOne(laaBlock, [/^Client name\s*([^\n]+)$/im]);
    data.laaSignatureDate = parseDateGBToISO(extractOne(laaBlock, [/^Date\s*(\d{2}\/\d{2}\/\d{4})\b/im]));
    data.laaSignatureTime = extractOne(laaBlock, [/^Time\s*(\d{2}:\d{2})\b/im]);
  }

  // Consents & retainer (minimal)
  const consentBlock = extractBlock(text, /12\.\s*Consents\s*&\s*Retainer/i, /\nDate\s+\d{2}\/\d{2}\/\d{4}\b/i);
  if (/12\.\s*Consents\s*&\s*Retainer/i.test(text)) {
    data.retainerClientName = extractOne(text, [/12\.\s*Consents\s*&\s*Retainer[\s\S]*?Client name\s+([^\n]+)\n/i]);
    const rdob = extractOne(text, [/12\.\s*Consents\s*&\s*Retainer[\s\S]*?Date of birth\s+(\d{2}\/\d{2}\/\d{4})\b/i]);
    if (rdob) data.retainerDob = parseDateGBToISO(rdob);
    data.retainerAddress = extractOne(text, [/12\.\s*Consents\s*&\s*Retainer[\s\S]*?Client address\s+([^\n]+)\n/i]);
    data.retainerSolicitorName = extractOne(text, [/12\.\s*Consents\s*&\s*Retainer[\s\S]*?Appointed solicitor\s*\/\s*firm\s+([^\n]+)\n/i]);
    data.retainerDate = parseDateGBToISO(extractOne(text, [/12\.\s*Consents\s*&\s*Retainer[\s\S]*?\bDate\s+(\d{2}\/\d{2}\/\d{4})\b/i]));
  }

  // Final cleanup: drop empty strings to keep records lean
  Object.keys(data).forEach((k) => {
    if (data[k] === '') delete data[k];
  });

  // Must have at least *something* meaningful
  const hasCore = !!(data.surname || data.forename || data.dsccRef || data.custodyNumber || data.ourFileNumber);
  return hasCore ? data : null;
}

module.exports = { parseCasenotePdfTextToRecordData };


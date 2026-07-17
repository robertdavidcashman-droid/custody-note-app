/* duplicate-attendance.js — build a new draft payload from an existing attendance (same custody session, new client).
 *
 * Policy summary (see plan: tighten_duplicate_attendance_scope / duplicate_clear_checklist):
 *
 *   KEEP from the original attendance (shared custody session)
 *     - Station / OIC / firm / fee earner / date
 *     - Offences (offenceSummary, offence1-4 details, statute, mode of trial, otherOffencesNotes)
 *     - Disclosure officer (often same officer for co-suspects)
 *     - Interviews array, no-comment reasons, video capture / parade
 *     - Comms log, attending contacts
 *
 *   CLEAR for the new client
 *     - Client identity (name, DOB, address, phone, email, NI/ARC, gender, nationality, file refs)
 *     - Photos (metadata) — encrypted files are NOT copied either (orchestrator skip)
 *     - Custody / arrest, PACE reviews, strip search
 *     - Supervisor, appropriate adult, interpreter
 *     - Disclosure narrative / co-suspects / witnesses / CCTV / exhibits / devices / samples / special warnings
 *     - Conflict check + means/financial
 *     - Advice / instructions / consultation checklists
 *     - Outcome (decision, bail, court, follow-up)
 *     - Time recording, travel, fees, disbursements
 *     - Consents / retainer extras
 *     - Signatures (canvas data + dates) + fee-earner certification
 *     - CRM14 block (any /^crm14/i key)
 *     - Billing / QuickFile links
 *     - Officer email log (status, date, template, recipient)
 *     - Workflow timestamps and lock/archive flags
 */
(function (global) {
  'use strict';

  /* ─── Helpers ─── */

  function clearFields(d, fields) {
    if (!d || typeof d !== 'object') return;
    for (var i = 0; i < fields.length; i++) delete d[fields[i]];
  }

  function clearByPattern(d, regex) {
    if (!d || typeof d !== 'object') return;
    Object.keys(d).forEach(function (k) {
      if (regex.test(k)) delete d[k];
    });
  }

  /* Identity hard-reset: delete then re-assign '' so the field is always present
     (defends against odd merges/JSON shapes and keeps form-render code paths simple). */
  function hardResetIdentity(d, fields) {
    if (!d || typeof d !== 'object') return;
    for (var i = 0; i < fields.length; i++) {
      var k = fields[i];
      delete d[k];
      d[k] = '';
    }
  }

  /* ─── Grouped CLEAR map (one source of truth) ─── */

  var CLEAR = {
    /* A. Client identity */
    identity: [
      'title',
      'forename',
      'middleName',
      'surname',
      'laaClientFullName',
      'laaPartnerFullName',
      'dob',
      'custodyNumber',
      'address1',
      'address2',
      'address3',
      'city',
      'county',
      'postCode',
      'clientPhone',
      'clientEmail',
      'clientEmailConsent',
      'niNumber',
      'arcNumber',
      'gender',
      'nationality',
      'nationalityOther',
    ],

    /* B. Client/case identifiers */
    caseRefs: [
      'ufn',
      'maatId',
      'ourFileNumber',
      'fileReference',
      'dsccRef',
    ],

    /* C. Photos / attachments / documents (encrypted files are NOT copied either) */
    photos: [
      'photos',
      'photosOfInjuriesRequested',
    ],

    /* D. Custody / arrest / detention (PACE review + strip search via patterns below) */
    custody: [
      'groundsForArrest',
      'groundsForDetention',
      'dateOfArrest',
      'timeOfArrest',
      'timeArrivalStation',
      'relevantTime',
      'timeDetentionAuthorised',
      'arrestingOfficerName',
      'arrestingOfficerNumber',
      'custodyRecordRead',
      'custodyRecordIssues',
    ],

    /* E. Supervisor / appropriate adult / interpreter */
    supervisor: [
      'supervisorName',
      'supervisorComments',
      'supervisorDate',
      'supervisorTime',
      'appropriateAdultName',
      'appropriateAdultRelation',
      'appropriateAdultPhone',
      'appropriateAdultEmail',
      'appropriateAdultOrganisation',
      'appropriateAdultAddress',
      'interpreterName',
      'interpreterLanguage',
      'languageIssues',
      'juvenileVulnerable',
    ],

    /* G. Disclosure (NB: disclosure officer details KEPT — not in this list) */
    disclosure: [
      'disclosureType',
      'disclosureNarrative',
      'significantStatements',
      'clientSignedEAB',
      'coSuspects',
      'coSuspectDetails',
      'coSuspectConflict',
      'coSuspectConflictNotes',
      'nameOfComplainant',
      'prosecutionWitnesses',
      'witnessIntimidation',
      'cctvVisual',
      'cctvViewed',
      'cctvNotes',
      'writtenEvidence',
      'writtenEvidenceDetails',
      'exhibitsToInspect',
      'exhibitsInspected',
      'exhibitsNotes',
      'pncDisclosed',
      'pncNotes',
      'paceSearches',
      'samplesDisclosed',
      'forensicSamples',
      'clothingShoesSeized',
      'clothingShoesSeizedWhat',
      'clothingShoesSeizedNotes',
      'deviceSeized',
      'deviceType',
      'devicePinRequested',
      'devicePinProvided',
      'deviceExtractionConsent',
      'deviceRIPAAuthority',
      'deviceNotes',
      'specialWarningGiven',
      'specialWarningType',
      'specialWarningDetails',
      'specialWarningAdvice',
      'cautionAvailable',
      'disclosureReInjuries',
    ],

    /* H. Conflict check + means/financial */
    conflictAndMeans: [
      'conflictCheckResult',
      'conflictCheckDate',
      'conflictCheckNotes',
      'benefits',
      'benefitType',
      'benefitOther',
      'benefitNotes',
      'passportedBenefit',
      'grossIncome',
      'partnerIncome',
      'partnerName',
      'dependants',
      'capitalClient',
      'capitalPartner',
      'capitalTotal',
      'incomeNotes',
      'employmentStatus',
      'accommodationStatus',
      'accommodationDetails',
      'maritalStatus',
      'ethnicOriginCode',
      'disabilityCode',
      'riskAssessment',
    ],

    /* I. Advice / instructions / consultation checklists
       (chk* and outcomeOffence* via patterns below) */
    advice: [
      'gapsInEvidence',
      'lawElements',
      'caseAssessment',
      'caseAssessmentWhy',
      'likelySentence',
      'clientInstructions',
      'clientInstructionsDetail',
      'adviceReInterview',
      'reasonsForAdviceSelect',
      'reasonsForAdvice',
      'clientDecision',
      'adviceFollowedInInterview',
      'adviceFollowedExplanation',
      'adviceReComplaint',
      'representationsMade',
      'representationsChallenge',
      'representationsResponse',
      'instructionsSignRequired',
      'instructionsSignatureDate',
      'instructionsSignatureTime',
      'previousAdvice',
      'previousAdviceDetails',
      'telephoneAdviceSummary',
      /* Advice checklist items (consistent advNN naming) */
      'advSilence',
      'advAnswerQuestions',
      'advMixed',
      'advWrittenStatement',
      'advNoComment',
      'advConsentSamples',
      'advConsentSearch',
      'advBailRefused',
      'advFailureToAttendBail',
    ],

    /* K. Outcome (outcomeOffence* via pattern below) */
    outcome: [
      'outcomeDecision',
      'courtName',
      'courtDate',
      'courtTime',
      'handedBackToDSCCReason',
      'nonAttendanceReason',
      'bailDate',
      'bailReturnTime',
      'bailReturnStationName',
      'bailReturnStationCode',
      'bailType',
      'bailConditions',
      'bailConditionsChecklist',
      'bailConditionsData',
      'nextLocationName',
      'nextDate',
      'furtherAttendance',
      'followUpNeeded',
      'followUpRequired',
      'caseOutcomeStatus',
    ],

    /* L. Time recording / travel / fees / disbursements */
    time: [
      'timeSetOff',
      'timeArrival',
      'timeDeparture',
      'timeOfficeHome',
      'multipleJourneys',
      'waitingTimeStart',
      'waitingTimeEnd',
      'waitingTimeNotes',
      'travelSocial',
      'travelUnsocial',
      'waitingSocial',
      'waitingUnsocial',
      'adviceSocial',
      'adviceUnsocial',
      'totalMinutes',
      'milesClaimable',
      'parkingCost',
      'disbursements',
      'weekendBankHoliday',
      'timeFirstContactWithClient',
      'numSuspects',
      'numAttendances',
      'stationVisits',
      'caseStage',
      'policeStationFinalisedDate',
      'policeStationFinalisedTime',
      'notesToOffice',
      'consultationStart',
      'consultationEnd',
      'interviewStart',
      'interviewEnd',
    ],

    /* M. Consents / retainer extras */
    consents: [
      'retainerClientName',
      'retainerDob',
      'retainerAddress',
      'retainerType',
      'legalAidApplicationDate',
      'retainerSolicitorName',
      'retainerSolicitorAddress',
      'retainerDate',
      'retainerSigned',
      'retainerCopyOnFile',
      'clientAuthorityConfirmed',
      'authorityMethod',
      'authorityDateGiven',
      'authorityTimeGiven',
      'authorityConfirmedBy',
      'authorityLimitations',
      'appointedSolicitorRef',
      'retainerUfnMaat',
    ],

    /* N. Signatures (canvas data + dates + fee-earner cert) */
    signatures: [
      'clientSig',
      'repInstructionsSig',
      'clientInstructionsSig',
      'repConfirmationSig',
      'supervisorSig',
      'laaPartnerSig',
      'feeEarnerSig',
      'crm14PartnerSig',
      'laaSignatureDate',
      'laaSignatureTime',
      'feeEarnerCertification',
    ],

    /* P. Billing / QuickFile links */
    billing: [
      'quickfile_invoice_id',
      'quickfileInvoiceNumber',
      'quickfile_invoice_number',
      'quickfileInvoiceUrl',
      'invoiceNumberRef',
      'invoiceNotes',
    ],

    /* Q. Legacy officer-email JSON flags (no longer used; drafts live in officer_email_drafts) */
    email: [
      'officerEmailStatus',
      'lastOfficerEmailSentDate',
      'lastOfficerEmailTemplateUsed',
      'lastOfficerEmailRecipient',
    ],

    /* S. Workflow timestamps / lock/archive flags / conversion provenance */
    workflow: [
      'billingProcessCompletedAt',
      'officeWorkCompletedAt',
      '_locked',
      '_billingComplete',
      '_officeWorkComplete',
      'archivedAt',
      'archived',
      '_sectionLastModified',
      '_convertedToAttendance',
      '_convertedFromTelephone',
      '_convertedToCustodyAt',
      '_convertedFromVoluntary',
      '_sourceUfn',
      '_sourceVoluntaryId',
      '_chargesPrefilled',
    ],
  };

  /* Patterns (a single grep over keys handles wildcard groups). */
  var CLEAR_PATTERNS = [
    /^crm14/i,           /* CRM14 block */
    /^paceReview/i,      /* PACE review fields */
    /^stripSearch/i,     /* strip-search fields */
    /^outcomeOffence/i,  /* outcomeOffence1Details … outcomeOffence4Statute */
    /^chk[A-Z]/,         /* consultation checklist (chkConflictCheck, chkDisclosure, …) */
  ];

  /**
   * Build a new attendance `data` payload from an existing one for a NEW client
   * in the SAME custody session. See policy summary at top of file.
   *
   * @param {object} originalAttendance — parsed `data` JSON from attendance row
   * @param {number|string} [sourceAttendanceId] — id of the source row (traceability)
   * @returns {object} deep-cloned data ready for attendanceSave as a new draft
   */
  function duplicateAttendanceData(originalAttendance, sourceAttendanceId) {
    var d = JSON.parse(JSON.stringify(originalAttendance || {}));

    /* Apply each grouped CLEAR list. */
    Object.keys(CLEAR).forEach(function (group) {
      clearFields(d, CLEAR[group]);
    });

    /* Apply pattern-based clears. */
    CLEAR_PATTERNS.forEach(function (re) {
      clearByPattern(d, re);
    });

    /* Hard-reset identity fields so they're present as ''
       (also covers odd merges/JSON shapes). */
    hardResetIdentity(d, CLEAR.identity);

    /* Skip declaration/retainer auto-fill from (empty) name until user enters new client. */
    d._duplicateFreshClient = true;

    /* Traceability + dedup. */
    d._duplicateInstanceId =
      String(Date.now()) + '-' + Math.random().toString(36).slice(2, 11);
    if (sourceAttendanceId != null && sourceAttendanceId !== '') {
      d._duplicatedFromAttendanceId = sourceAttendanceId;
    }

    /* Visit metadata (parity with previous Duplicate behaviour). */
    if (d._formType === 'telephone') {
      /* Orchestrator should block telephone duplication; leave workType unchanged. */
    } else if (d.attendanceMode === 'voluntary') {
      d.workType = 'Further Voluntary Attendance';
      d.attendanceMode = 'voluntary';
    } else {
      d.workType = 'Further Police Station Attendance';
    }
    d.caseStatus = 'Existing case';
    d.clientType = 'Existing';

    return d;
  }

  /* Expose to browser (window) and Node (CommonJS for tests). */
  global.duplicateAttendanceData = duplicateAttendanceData;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { duplicateAttendanceData: duplicateAttendanceData, CLEAR: CLEAR, CLEAR_PATTERNS: CLEAR_PATTERNS };
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : globalThis));

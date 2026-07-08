/* duplicateAttendance.test.js
 *
 * Locks in the per-field clear/keep policy for the Duplicate Attendance feature.
 * If you intentionally change what carries across when a record is duplicated,
 * update this fixture and the assertions accordingly. See the duplicate-attendance
 * module header for the policy summary.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { duplicateAttendanceData } = require('../renderer/lib/duplicate-attendance');

/* A populated fixture covering every category. */
function makeFixture() {
  return {
    /* A. Identity */
    title: 'Mr', forename: 'John', middleName: 'David', surname: 'Smith',
    laaClientFullName: 'JOHN SMITH', laaPartnerFullName: 'PARTNER',
    dob: '1990-01-01', custodyNumber: 'CN123',
    address1: '1 High St', address2: 'Flat 2', address3: '', city: 'London',
    county: 'Greater London', postCode: 'SW1 1AA',
    clientPhone: '07700900000', clientEmail: 'john@example.com', clientEmailConsent: 'yes',
    niNumber: 'AB123456C', arcNumber: 'ARC1',
    gender: 'Male', nationality: 'British', nationalityOther: '',

    /* B. Case refs */
    ufn: '010125/001', maatId: 'M123', ourFileNumber: 'OFN1',
    fileReference: 'OFN1', dsccRef: 'DSCC1',

    /* C. Photos */
    photos: { intake: ['x'], attachments: [{ photoId: 'p1', name: 'doc.pdf' }] },
    photosOfInjuriesRequested: 'Yes',

    /* D. Custody / arrest */
    groundsForArrest: 'g1', groundsForDetention: 'g2',
    dateOfArrest: '2025-01-01', timeOfArrest: '10:00',
    relevantTime: '10:30', timeDetentionAuthorised: '10:35', timeArrivalStation: '10:20',
    arrestingOfficerName: 'PC X', arrestingOfficerNumber: 'PC123',
    custodyRecordRead: 'Yes', custodyRecordIssues: 'None',
    paceReview1Time: '12:00', paceReview1By: 'Insp X', paceReview2Notes: 'OK',
    stripSearchPerformed: 'No', stripSearchAuthorisedBy: '',

    /* E. Supervisor / AA / interpreter */
    supervisorName: 'S1', supervisorComments: 'OK',
    supervisorDate: '2025-01-01', supervisorTime: '17:00',
    appropriateAdultName: 'AA', appropriateAdultRelation: 'Mum',
    appropriateAdultPhone: '07700', appropriateAdultEmail: 'aa@x',
    appropriateAdultOrganisation: '', appropriateAdultAddress: '',
    interpreterName: 'I1', interpreterLanguage: 'Polish',
    languageIssues: '', juvenileVulnerable: 'No',

    /* F. Offences (KEEP) */
    offenceSummary: 'Theft', matterTypeCode: 'AA',
    offence1Details: 'Theft from shop', offence2Details: '',
    offence1Statute: 'Theft Act 1968', offence1ModeOfTrial: 'Either-way',
    otherOffencesNotes: 'none',

    /* G. Disclosure (officer KEPT, rest CLEAR) */
    disclosureOfficerIsOIC: 'Yes', disclosureOfficerName: 'DC X',
    disclosureOfficerPhone: '01000', disclosureOfficerEmail: 'dc@x',
    disclosureOfficerUnit: 'CID',
    disclosureType: 'Pre-interview', disclosureNarrative: 'Long narrative',
    significantStatements: 'None', clientSignedEAB: 'Yes',
    coSuspects: 'Yes', coSuspectDetails: 'Bob',
    coSuspectConflict: 'No', coSuspectConflictNotes: '',
    nameOfComplainant: 'Vic', prosecutionWitnesses: 'W1', witnessIntimidation: 'No',
    cctvVisual: 'Yes', cctvViewed: 'Yes', cctvNotes: 'unclear',
    writtenEvidence: 'Yes', writtenEvidenceDetails: 'statement',
    exhibitsToInspect: 'No', exhibitsInspected: '', exhibitsNotes: '',
    pncDisclosed: 'Yes', pncNotes: '',
    paceSearches: [{ type: 'S18' }],
    samplesDisclosed: 'No', forensicSamples: [{ type: 'DNA' }],
    clothingShoesSeized: 'No', clothingShoesSeizedWhat: '', clothingShoesSeizedNotes: '',
    deviceSeized: 'No', deviceType: '', devicePinRequested: '', devicePinProvided: '',
    deviceExtractionConsent: '', deviceRIPAAuthority: '', deviceNotes: '',
    specialWarningGiven: 'No', specialWarningType: '',
    specialWarningDetails: '', specialWarningAdvice: '',
    cautionAvailable: 'No', disclosureReInjuries: '',

    /* H. Conflict + means */
    conflictCheckResult: 'No conflict', conflictCheckDate: '2025-01-01', conflictCheckNotes: '',
    benefits: 'Yes', benefitType: 'UC', benefitOther: '',
    benefitNotes: '', passportedBenefit: 'Yes',
    grossIncome: '0', partnerIncome: '0', partnerName: '', dependants: '0',
    capitalClient: '0', capitalPartner: '0', capitalTotal: '0', incomeNotes: '',
    employmentStatus: 'Unemployed', accommodationStatus: 'Rented',
    accommodationDetails: '', maritalStatus: 'Single',
    ethnicOriginCode: 'A1', disabilityCode: 'N', riskAssessment: 'Low',

    /* I. Advice / instructions / checklists */
    chkConflictCheck: '1', chkDisclosure: '1', chkRetainer: '1',
    advSilence: '1', advFailureToAttendBail: '1', advNoComment: '1',
    gapsInEvidence: 'g', lawElements: 'l', caseAssessment: 'strong',
    caseAssessmentWhy: 'reasons', likelySentence: 'fine',
    clientInstructions: 'No comment', clientInstructionsDetail: 'detail',
    adviceReInterview: 'silence', reasonsForAdviceSelect: 'X',
    reasonsForAdvice: 'X', clientDecision: 'silence',
    adviceFollowedInInterview: 'Yes', adviceFollowedExplanation: '', adviceReComplaint: '',
    representationsMade: 'Yes', representationsChallenge: 'detention',
    representationsResponse: 'rejected',
    instructionsSignRequired: 'Yes', instructionsSignatureDate: '2025-01-01',
    instructionsSignatureTime: '12:00',
    previousAdvice: 'No', previousAdviceDetails: '', telephoneAdviceSummary: '',

    /* J. Interviews (KEEP) */
    interviews: [{
      startTime: '14:00', endTime: '15:00', present: 'PC X',
      cautioned: 'Yes', notes: 'No comment',
    }],
    noCommentReasons: 'Insufficient disclosure',
    vidCapDate: '2025-01-01', vidParadeDate: '',

    /* K. Outcome */
    outcomeDecision: 'Charged with Bail',
    outcomeOffence1Details: 'Theft', outcomeOffence1Statute: 'TA 1968',
    courtName: 'Magistrates', courtDate: '2025-02-01', courtTime: '10:00',
    handedBackToDSCCReason: '', nonAttendanceReason: '',
    bailDate: '2025-02-01', bailReturnTime: '10:00',
    bailReturnStationName: 'XYZ', bailReturnStationCode: 'XYZ1',
    bailType: 'Conditional', bailConditions: 'Reside',
    bailConditionsChecklist: ['Reside'], bailConditionsData: { x: 1 },
    nextLocationName: 'Mags', nextDate: '2025-02-01', furtherAttendance: 'No',
    followUpNeeded: 'Yes', followUpRequired: 'Yes',
    caseOutcomeStatus: 'Charged', _chargesPrefilled: true,

    /* L. Time / fees */
    timeSetOff: '09:00', timeArrival: '10:00',
    timeDeparture: '17:00', timeOfficeHome: '18:00',
    multipleJourneys: 'No',
    waitingTimeStart: '10:00', waitingTimeEnd: '11:00', waitingTimeNotes: 'wait',
    travelSocial: 0, travelUnsocial: 60,
    waitingSocial: 0, waitingUnsocial: 60,
    adviceSocial: 0, adviceUnsocial: 120, totalMinutes: 240,
    milesClaimable: 10, parkingCost: 5, disbursements: [{ type: 'park', cost: 5 }],
    weekendBankHoliday: 'No', timeFirstContactWithClient: '10:30',
    numSuspects: 1, numAttendances: 1,
    stationVisits: [{ timeSetOff: '08:00', timeArrival: '09:00', timeDeparture: '10:00', timeOfficeHome: '11:00' }],
    caseStage: 'PS',
    policeStationFinalisedDate: '2025-01-01', policeStationFinalisedTime: '17:00',
    notesToOffice: 'note',
    consultationStart: '11:00', consultationEnd: '12:00',
    interviewStart: '14:00', interviewEnd: '15:00',

    /* M. Consents / retainer */
    retainerClientName: 'JOHN SMITH', retainerDob: '1990-01-01', retainerAddress: '1 High St',
    retainerType: 'LAA', legalAidApplicationDate: '2025-01-01',
    retainerSolicitorName: 'Firm', retainerSolicitorAddress: 'Office',
    retainerDate: '2025-01-01', retainerSigned: 'Yes', retainerCopyOnFile: 'Yes',
    clientAuthorityConfirmed: 'Yes', authorityMethod: 'Verbal',
    authorityDateGiven: '2025-01-01', authorityTimeGiven: '11:00',
    authorityConfirmedBy: 'Rep', authorityLimitations: '',
    appointedSolicitorRef: 'X', retainerUfnMaat: '010125/001',

    /* N. Signatures */
    clientSig: 'data:image/png;base64,xx', repInstructionsSig: 'x',
    clientInstructionsSig: 'x', repConfirmationSig: 'x',
    supervisorSig: 'x', laaPartnerSig: 'x', feeEarnerSig: 'x', crm14PartnerSig: 'x',
    laaSignatureDate: '2025-01-01', laaSignatureTime: '17:00',
    feeEarnerCertification: 'Yes',

    /* O. CRM14 (any /^crm14/i key) */
    crm14ClientName: 'JOHN SMITH', crm14Date: '2025-01-01', crm14NIN: 'AB123456C',

    /* P. Billing */
    quickfile_invoice_id: 1, quickfileInvoiceNumber: 'INV1',
    quickfile_invoice_number: 'INV1', quickfileInvoiceUrl: 'http://x',
    invoiceNumberRef: 'INV1', invoiceNotes: 'paid',

    /* Q. Email log */
    officerEmailStatus: 'sent', lastOfficerEmailSentDate: '2025-01-02',
    lastOfficerEmailTemplateUsed: 'Bail', lastOfficerEmailRecipient: 'pc@x',

    /* S. Workflow / provenance */
    billingProcessCompletedAt: '2025-01-03T10:00:00Z',
    officeWorkCompletedAt: '2025-01-03T11:00:00Z',
    _locked: true, _billingComplete: true, _officeWorkComplete: true,
    archivedAt: '2025-01-03T12:00:00Z', archived: true,
    _sectionLastModified: { intake: 1 },
    _convertedToAttendance: true, _convertedFromTelephone: true,
    _convertedToCustodyAt: '2025-01-01', _convertedFromVoluntary: true,
    _sourceUfn: '0', _sourceVoluntaryId: 1,

    /* T. Shared session (KEEP) */
    policeStationId: 1, policeStationName: 'XYZ Custody',
    oicName: 'PC OIC', oicEmail: 'oic@x', oicPhone: '01000',
    firmId: 1, firmName: 'Firm Ltd', firmLaaAccount: 'F1',
    date: '2025-01-01', instructionDateTime: '2025-01-01T09:00',
    feeEarnerName: 'Jane Fee-Earner',
    attendanceMode: 'duty', _formType: 'attendance',

    /* R. Comms / contacts (KEEP) */
    commsLog: [{ time: '11:00', note: 'rang firm' }],
    attendingContacts: [{ name: 'Mate', relation: 'Friend', phone: '07700' }],
  };
}

/* Fields the policy says must be CLEARED on the new draft. */
const CLEARED_FIELDS = [
  /* A. Identity (hard-reset to '') */
  'title', 'forename', 'middleName', 'surname',
  'laaClientFullName', 'laaPartnerFullName',
  'dob', 'custodyNumber',
  'address1', 'address2', 'address3', 'city', 'county', 'postCode',
  'clientPhone', 'clientEmail', 'clientEmailConsent',
  'niNumber', 'arcNumber',
  'gender', 'nationality', 'nationalityOther',

  /* B. Case refs */
  'ufn', 'maatId', 'ourFileNumber', 'fileReference', 'dsccRef',

  /* C. Photos */
  'photos', 'photosOfInjuriesRequested',

  /* D. Custody / arrest (+ patterns) */
  'groundsForArrest', 'groundsForDetention',
  'dateOfArrest', 'timeOfArrest',
  'timeArrivalStation', 'relevantTime', 'timeDetentionAuthorised',
  'arrestingOfficerName', 'arrestingOfficerNumber',
  'custodyRecordRead', 'custodyRecordIssues',
  'paceReview1Time', 'paceReview1By', 'paceReview2Notes',
  'stripSearchPerformed', 'stripSearchAuthorisedBy',

  /* E. Supervisor / AA / interpreter */
  'supervisorName', 'supervisorComments',
  'supervisorDate', 'supervisorTime',
  'appropriateAdultName', 'appropriateAdultRelation',
  'appropriateAdultPhone', 'appropriateAdultEmail',
  'appropriateAdultOrganisation', 'appropriateAdultAddress',
  'interpreterName', 'interpreterLanguage',
  'languageIssues', 'juvenileVulnerable',

  /* G. Disclosure (officer KEPT — see KEPT_FIELDS) */
  'disclosureType', 'disclosureNarrative', 'significantStatements', 'clientSignedEAB',
  'coSuspects', 'coSuspectDetails', 'coSuspectConflict', 'coSuspectConflictNotes',
  'nameOfComplainant', 'prosecutionWitnesses', 'witnessIntimidation',
  'cctvVisual', 'cctvViewed', 'cctvNotes',
  'writtenEvidence', 'writtenEvidenceDetails',
  'exhibitsToInspect', 'exhibitsInspected', 'exhibitsNotes',
  'pncDisclosed', 'pncNotes',
  'paceSearches', 'samplesDisclosed', 'forensicSamples',
  'clothingShoesSeized', 'clothingShoesSeizedWhat', 'clothingShoesSeizedNotes',
  'deviceSeized', 'deviceType', 'devicePinRequested', 'devicePinProvided',
  'deviceExtractionConsent', 'deviceRIPAAuthority', 'deviceNotes',
  'specialWarningGiven', 'specialWarningType',
  'specialWarningDetails', 'specialWarningAdvice',
  'cautionAvailable', 'disclosureReInjuries',

  /* H. Conflict + means */
  'conflictCheckResult', 'conflictCheckDate', 'conflictCheckNotes',
  'benefits', 'benefitType', 'benefitOther', 'benefitNotes', 'passportedBenefit',
  'grossIncome', 'partnerIncome', 'partnerName', 'dependants',
  'capitalClient', 'capitalPartner', 'capitalTotal', 'incomeNotes',
  'employmentStatus', 'accommodationStatus', 'accommodationDetails', 'maritalStatus',
  'ethnicOriginCode', 'disabilityCode', 'riskAssessment',

  /* I. Advice / instructions */
  'chkConflictCheck', 'chkDisclosure', 'chkRetainer',
  'advSilence', 'advFailureToAttendBail', 'advNoComment',
  'gapsInEvidence', 'lawElements', 'caseAssessment', 'caseAssessmentWhy', 'likelySentence',
  'clientInstructions', 'clientInstructionsDetail',
  'adviceReInterview', 'reasonsForAdviceSelect', 'reasonsForAdvice', 'clientDecision',
  'adviceFollowedInInterview', 'adviceFollowedExplanation', 'adviceReComplaint',
  'representationsMade', 'representationsChallenge', 'representationsResponse',
  'instructionsSignRequired', 'instructionsSignatureDate', 'instructionsSignatureTime',
  'previousAdvice', 'previousAdviceDetails', 'telephoneAdviceSummary',

  /* K. Outcome */
  'outcomeDecision',
  'outcomeOffence1Details', 'outcomeOffence1Statute',
  'courtName', 'courtDate', 'courtTime',
  'handedBackToDSCCReason', 'nonAttendanceReason',
  'bailDate', 'bailReturnTime', 'bailReturnStationName', 'bailReturnStationCode',
  'bailType', 'bailConditions', 'bailConditionsChecklist', 'bailConditionsData',
  'nextLocationName', 'nextDate', 'furtherAttendance',
  'followUpNeeded', 'followUpRequired',
  'caseOutcomeStatus', '_chargesPrefilled',

  /* L. Time / fees */
  'timeSetOff', 'timeArrival', 'timeDeparture', 'timeOfficeHome',
  'multipleJourneys',
  'waitingTimeStart', 'waitingTimeEnd', 'waitingTimeNotes',
  'travelSocial', 'travelUnsocial',
  'waitingSocial', 'waitingUnsocial',
  'adviceSocial', 'adviceUnsocial', 'totalMinutes',
  'milesClaimable', 'parkingCost', 'disbursements',
  'weekendBankHoliday', 'timeFirstContactWithClient',
  'numSuspects', 'numAttendances', 'stationVisits', 'caseStage',
  'policeStationFinalisedDate', 'policeStationFinalisedTime',
  'notesToOffice',
  'consultationStart', 'consultationEnd', 'interviewStart', 'interviewEnd',

  /* M. Consents / retainer */
  'retainerClientName', 'retainerDob', 'retainerAddress',
  'retainerType', 'legalAidApplicationDate',
  'retainerSolicitorName', 'retainerSolicitorAddress',
  'retainerDate', 'retainerSigned', 'retainerCopyOnFile',
  'clientAuthorityConfirmed', 'authorityMethod', 'authorityDateGiven',
  'authorityTimeGiven', 'authorityConfirmedBy', 'authorityLimitations',
  'appointedSolicitorRef', 'retainerUfnMaat',

  /* N. Signatures */
  'clientSig', 'repInstructionsSig', 'clientInstructionsSig', 'repConfirmationSig',
  'supervisorSig', 'laaPartnerSig', 'feeEarnerSig', 'crm14PartnerSig',
  'laaSignatureDate', 'laaSignatureTime', 'feeEarnerCertification',

  /* O. CRM14 */
  'crm14ClientName', 'crm14Date', 'crm14NIN',

  /* P. Billing */
  'quickfile_invoice_id', 'quickfileInvoiceNumber', 'quickfile_invoice_number',
  'quickfileInvoiceUrl', 'invoiceNumberRef', 'invoiceNotes',

  /* Q. Email log */
  'officerEmailStatus', 'lastOfficerEmailSentDate',
  'lastOfficerEmailTemplateUsed', 'lastOfficerEmailRecipient',

  /* S. Workflow / provenance */
  'billingProcessCompletedAt', 'officeWorkCompletedAt',
  '_locked', '_billingComplete', '_officeWorkComplete',
  'archivedAt', 'archived',
  '_sectionLastModified',
  '_convertedToAttendance', '_convertedFromTelephone',
  '_convertedToCustodyAt', '_convertedFromVoluntary',
  '_sourceUfn', '_sourceVoluntaryId',
];

/* Fields that must SURVIVE on the new draft (shared custody session or per policy). */
const KEPT_FIELDS = [
  /* T. Shared custody session */
  'policeStationId', 'policeStationName',
  'oicName', 'oicEmail', 'oicPhone',
  'firmId', 'firmName', 'firmLaaAccount',
  'date', 'instructionDateTime',
  'feeEarnerName',

  /* F. Offences */
  'offenceSummary', 'matterTypeCode',
  'offence1Details', 'offence2Details',
  'offence1Statute', 'offence1ModeOfTrial',
  'otherOffencesNotes',

  /* G. Disclosure officer (often same officer for co-suspects) */
  'disclosureOfficerIsOIC', 'disclosureOfficerName',
  'disclosureOfficerPhone', 'disclosureOfficerEmail',
  'disclosureOfficerUnit',

  /* J. Interviews / video */
  'interviews', 'noCommentReasons',
  'vidCapDate', 'vidParadeDate',

  /* R. Comms / contacts */
  'commsLog', 'attendingContacts',
];

/* Identity fields are hard-reset to '' (always present). */
const IDENTITY_HARD_RESET = [
  'title', 'forename', 'middleName', 'surname',
  'laaClientFullName', 'laaPartnerFullName',
  'dob', 'custodyNumber',
  'address1', 'address2', 'address3', 'city', 'county', 'postCode',
  'clientPhone', 'clientEmail', 'clientEmailConsent',
  'niNumber', 'arcNumber',
  'gender', 'nationality', 'nationalityOther',
];

describe('duplicateAttendanceData — clear/keep policy', () => {
  it('clears every field listed in CLEARED_FIELDS', () => {
    const src = makeFixture();
    const out = duplicateAttendanceData(src, 999);
    const offenders = CLEARED_FIELDS.filter(k => {
      if (IDENTITY_HARD_RESET.includes(k)) {
        /* must be present and empty string */
        return out[k] !== '';
      }
      /* must be absent (deleted) */
      return Object.prototype.hasOwnProperty.call(out, k);
    });
    assert.deepStrictEqual(
      offenders,
      [],
      'These fields should have been cleared on the duplicate but were not: ' + JSON.stringify(offenders)
    );
  });

  it('keeps every field listed in KEPT_FIELDS', () => {
    const src = makeFixture();
    const out = duplicateAttendanceData(src, 999);
    const missing = KEPT_FIELDS.filter(k => !Object.prototype.hasOwnProperty.call(out, k));
    assert.deepStrictEqual(
      missing,
      [],
      'These fields should have been kept on the duplicate but were dropped: ' + JSON.stringify(missing)
    );
    /* spot-check a few values survived intact */
    assert.strictEqual(out.policeStationName, 'XYZ Custody');
    assert.strictEqual(out.oicName, 'PC OIC');
    assert.strictEqual(out.offenceSummary, 'Theft');
    assert.strictEqual(out.disclosureOfficerName, 'DC X');
    assert.deepStrictEqual(out.interviews, [{
      startTime: '14:00', endTime: '15:00', present: 'PC X',
      cautioned: 'Yes', notes: 'No comment',
    }]);
    assert.deepStrictEqual(out.commsLog, [{ time: '11:00', note: 'rang firm' }]);
    assert.deepStrictEqual(out.attendingContacts, [{ name: 'Mate', relation: 'Friend', phone: '07700' }]);
  });

  it('clears every CRM14-prefixed key (regardless of casing)', () => {
    const src = makeFixture();
    src.crm14Foo = 'x';
    src.CRM14Bar = 'y';
    const out = duplicateAttendanceData(src, 1);
    const remaining = Object.keys(out).filter(k => /^crm14/i.test(k));
    assert.deepStrictEqual(remaining, [], 'CRM14 keys should all be cleared');
  });

  it('clears every paceReview / stripSearch / outcomeOffence / chk pattern key', () => {
    const src = makeFixture();
    src.paceReview3Time = 'xx';
    src.stripSearchReason = 'xx';
    src.outcomeOffence4Statute = 'xx';
    src.chkClientId = '1';
    const out = duplicateAttendanceData(src, 1);
    assert.ok(!('paceReview3Time' in out), 'paceReview* must be cleared');
    assert.ok(!('stripSearchReason' in out), 'stripSearch* must be cleared');
    assert.ok(!('outcomeOffence4Statute' in out), 'outcomeOffence* must be cleared');
    assert.ok(!('chkClientId' in out), 'chk[A-Z]* must be cleared');
  });

  it('sets the duplicate-flag set (for autofill gating + traceability)', () => {
    const src = makeFixture();
    const out = duplicateAttendanceData(src, 12345);
    assert.strictEqual(out._duplicateFreshClient, true);
    assert.strictEqual(out._duplicatedFromAttendanceId, 12345);
    assert.ok(typeof out._duplicateInstanceId === 'string' && out._duplicateInstanceId.length > 0);
  });

  it('sets duty / voluntary work-type metadata correctly', () => {
    const duty = duplicateAttendanceData({ attendanceMode: 'duty', _formType: 'attendance' }, 1);
    assert.strictEqual(duty.workType, 'Further Police Station Attendance');
    assert.strictEqual(duty.caseStatus, 'Existing case');
    assert.strictEqual(duty.clientType, 'Existing');

    const vol = duplicateAttendanceData({ attendanceMode: 'voluntary', _formType: 'attendance' }, 2);
    assert.strictEqual(vol.workType, 'Further Voluntary Attendance');
    assert.strictEqual(vol.attendanceMode, 'voluntary');
  });

  it('does not crash on an empty / minimal source', () => {
    const out = duplicateAttendanceData({}, undefined);
    assert.strictEqual(typeof out, 'object');
    assert.strictEqual(out._duplicateFreshClient, true);
    assert.ok(typeof out._duplicateInstanceId === 'string');
  });
});

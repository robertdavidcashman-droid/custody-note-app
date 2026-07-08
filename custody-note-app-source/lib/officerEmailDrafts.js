'use strict';

const outlookWebCompose = require('./outlookWebCompose');

const DEFAULT_SIGN_OFF = '';

const TEMPLATE_UI_OPTIONS = require('./officerEmailTemplateOptions.js');

const TEMPLATE_TYPES = Object.freeze([
  'disclosure_confirm_attendance',
  'confirm_matter_effective',
  'voluntary_interview_confirmation',
  'confirm_outcome_after_attendance',
  'chase_disclosure',
  'chase_disclosure_follow_up',
  'request_officer_contact_details',
  'custody_log_request',
  'custody_record_detention_log_request',
  'chase_custody_log_follow_up',
  'request_update_after_delay',
  'bail_details_request',
  'chase_bail_details_follow_up',
  'rui_details_request',
  'matter_stood_down',
  'free_text_email',
]);

const CUSTODY_DDO_TEMPLATES = Object.freeze([
  'custody_log_request',
  'custody_record_detention_log_request',
  'chase_custody_log_follow_up',
]);

const STATUSES = Object.freeze([
  'draft',
  'ready_for_outlook',
  'opened_in_outlook',
  'sent_manually',
  'cancelled',
  'deleted',
]);

const STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  ready_for_outlook: 'Ready for Outlook',
  opened_in_outlook: 'Opened in Outlook',
  sent_manually: 'Sent manually',
  cancelled: 'Cancelled',
  deleted: 'Deleted',
});

const SUBJECT_SUFFIX = Object.freeze({
  disclosure_confirm_attendance: 'Confirm attendance — disclosure',
  confirm_matter_effective: 'Confirm matter effective',
  voluntary_interview_confirmation: 'Voluntary interview',
  confirm_outcome_after_attendance: 'Outcome — confirmation',
  chase_disclosure: 'Disclosure — urgent',
  chase_disclosure_follow_up: 'Disclosure — follow-up',
  request_officer_contact_details: 'Officer contact details',
  custody_log_request: 'Custody record',
  custody_record_detention_log_request: 'Custody record and detention log',
  chase_custody_log_follow_up: 'Custody record — follow-up',
  request_update_after_delay: 'Update — delay',
  bail_details_request: 'Police bail details',
  chase_bail_details_follow_up: 'Police bail details — follow-up',
  rui_details_request: 'RUI details',
  matter_stood_down: 'Matter stood down',
  free_text_email: 'Email',
});

const MAX_LENGTHS = Object.freeze({
  signOffName: 200,
  toEmail: 500,
  recipientName: 200,
  clientName: 200,
  policeStation: 200,
  offence: 300,
  attendanceDate: 100,
  attendanceTime: 50,
  extraNote: 2000,
  bailReturnDate: 200,
  bailConditions: 5000,
  userEmailAddress: 300,
  subject: 500,
  body: 20000,
});

/** @type {Record<string, string[]>} */
const ALLOWED_TRANSITIONS = {
  draft: ['ready_for_outlook', 'opened_in_outlook', 'cancelled', 'deleted'],
  ready_for_outlook: ['draft', 'opened_in_outlook', 'cancelled', 'deleted'],
  opened_in_outlook: ['sent_manually', 'cancelled', 'deleted'],
  sent_manually: [],
  cancelled: ['deleted'],
  deleted: [],
};

function str(x) {
  if (x == null) return '';
  return String(x);
}

function trimMax(s, max) {
  const t = str(s).trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

function canTransitionStatus(from, to) {
  const a = ALLOWED_TRANSITIONS[from];
  return !!(a && a.indexOf(to) >= 0);
}

function getTemplateDisplayName(templateType) {
  return SUBJECT_SUFFIX[templateType] || templateType || 'Email';
}

function getRecipientNameOrDefault(templateType, recipientName) {
  const r = trimMax(recipientName, MAX_LENGTHS.recipientName);
  if (r) return r;
  if (CUSTODY_DDO_TEMPLATES.indexOf(templateType) >= 0) return 'DDO';
  return 'Officer';
}

function phClient(clientName) {
  const t = trimMax(clientName, MAX_LENGTHS.clientName);
  return t || '[Client Name]';
}

function phStation(policeStation) {
  const t = trimMax(policeStation, MAX_LENGTHS.policeStation);
  return t || '[Police Station]';
}

function phOffence(offence) {
  const t = trimMax(offence, MAX_LENGTHS.offence);
  return t || '[Offence]';
}

function phDate(attendanceDate) {
  const t = trimMax(attendanceDate, MAX_LENGTHS.attendanceDate);
  return t || '[Date]';
}

function phDateWithTime(attendanceDate, attendanceTime) {
  const d = phDate(attendanceDate);
  const t = trimMax(attendanceTime, MAX_LENGTHS.attendanceTime);
  if (!t) return d;
  if (d === '[Date]') return t;
  return `${d} at ${t}`;
}

function disclosureEmailRequest(userEm) {
  if (userEm) return `Please send initial disclosure to me at ${userEm}.`;
  return 'Please send initial disclosure by reply to this email.';
}

function hasRecordedAttendanceWhen(attendanceDate, attendanceTime) {
  return !!trimMax(attendanceDate, MAX_LENGTHS.attendanceDate) || !!trimMax(attendanceTime, MAX_LENGTHS.attendanceTime);
}

function generateOfficerEmailSubject({ clientName, policeStation, offence, templateType }) {
  const c = phClient(clientName);
  const s = phStation(policeStation);
  const o = phOffence(offence);
  const tail = getTemplateDisplayName(templateType);
  const out = `${c} - ${s} - ${o} - ${tail}`;
  return trimMax(out, MAX_LENGTHS.subject);
}

function resolveSignOff(fields) {
  const name = trimMax(fields && fields.signOffName, MAX_LENGTHS.signOffName);
  return name || DEFAULT_SIGN_OFF;
}

function _bodyCommonEnd(recipientLine, mainBlock, hasManyThanks, signOff) {
  const lines = [recipientLine, '', mainBlock];
  const body = lines.join('\n');
  const closing = signOff ? `\n\nKind regards,\n\n${signOff}` : '\n\nKind regards,';
  if (hasManyThanks) {
    return body + '\n\nMany thanks.' + closing;
  }
  return body + closing;
}

function _custodyMatterBlock(client, station, date, attendanceTime, offence) {
  const timeLine = attendanceTime ? `\nTime: ${attendanceTime}` : '';
  return `Client: ${client}\nPolice station: ${station}\nDate: ${date}${timeLine}\nAllegation: ${offence}`;
}

function _buildBailDetailsMain(opts) {
  const {
    client, station, dateWithTime, offence, bailD, bailC, hasBailDate, hasBailCond, isFollowUp,
  } = opts;
  const chasePrefix = 'I emailed previously but have not yet received a response. ';

  if (isFollowUp && !hasBailDate && !hasBailCond) {
    return (
      `I act for ${client}, who attended ${station} on ${dateWithTime} in relation to an allegation of ${offence}.\n\n` +
      'I understand they were released on police bail. ' + chasePrefix +
      'Please could you confirm the bail return date and time, the police station(s) for return, and the bail conditions imposed.'
    );
  }

  const intro = isFollowUp
    ? `I act for ${client}, who attended ${station} on ${dateWithTime} in relation to an allegation of ${offence}.\n\n` +
      'I understand they were released on police bail.\n\n'
    : `I act for ${client}, who attended ${station} on ${dateWithTime} in relation to an allegation of ${offence}.\n\n` +
      'I understand they were released on police bail to return to the station.\n\n';

  if (!hasBailDate && !hasBailCond) {
    return intro + 'Please confirm the bail return date and time, the police station(s) for return, and the bail conditions imposed.';
  }
  if (hasBailDate && hasBailCond) {
    return (
      intro +
      `I understand the bail return date is ${bailD} and the conditions are:\n${bailC}\n\n` +
      (isFollowUp ? chasePrefix : '') +
      'Please confirm whether these details are correct, including the police station(s) for return.'
    );
  }
  if (hasBailDate) {
    return (
      intro +
      `I understand the bail return date is ${bailD}.\n\n` +
      (isFollowUp ? chasePrefix : '') +
      'Please confirm the date, time, police station(s) for return, and any bail conditions.'
    );
  }
  return (
    intro +
    `I understand the bail conditions are:\n${bailC}\n\n` +
    (isFollowUp ? chasePrefix : '') +
    'Please confirm the conditions, bail return date and time, and police station(s) for return.'
  );
}

function generateOfficerEmailBody(fields) {
  const templateType = str(fields.templateType);
  const rec = getRecipientNameOrDefault(templateType, fields.recipientName);
  const dear = 'Dear ' + rec + ',';
  const client = phClient(fields.clientName);
  const station = phStation(fields.policeStation);
  const date = phDate(fields.attendanceDate);
  const dateWithTime = phDateWithTime(fields.attendanceDate, fields.attendanceTime);
  const attendanceTime = trimMax(fields.attendanceTime, MAX_LENGTHS.attendanceTime);
  const offence = phOffence(fields.offence);
  const bailD = trimMax(fields.bailReturnDate, MAX_LENGTHS.bailReturnDate);
  const bailC = trimMax(fields.bailConditions, MAX_LENGTHS.bailConditions);
  const userEm = trimMax(fields.userEmailAddress, MAX_LENGTHS.userEmailAddress);
  const hasBailDate = !!bailD;
  const hasBailCond = !!bailC;

  let main = '';
  let hasManyThanks = true;

  switch (templateType) {
    case 'disclosure_confirm_attendance':
      main =
        `I have been instructed to represent ${client} at ${station} on ${dateWithTime} in relation to an allegation of ${offence}.\n\n` +
        'Please confirm that the matter remains effective for that attendance.\n\n' +
        disclosureEmailRequest(userEm);
      break;
    case 'custody_log_request':
      main =
        'Please may I have a copy of the full custody record for the matter below, including the custody record front sheet and decision log.\n\n' +
        _custodyMatterBlock(client, station, date, attendanceTime, offence);
      break;
    case 'custody_record_detention_log_request':
      main =
        'Please may I have a copy of the full custody record and detention log for the matter below, including the custody record front sheet and decision log.\n\n' +
        _custodyMatterBlock(client, station, date, attendanceTime, offence);
      break;
    case 'chase_custody_log_follow_up':
      main =
        `I act for ${client} at ${station} in relation to an allegation of ${offence}.\n\n` +
        'I requested a copy of the custody record previously but have not yet received it. Please may I have the full custody record, including the front sheet and decision log, for the matter below:\n\n' +
        _custodyMatterBlock(client, station, date, attendanceTime, offence);
      break;
    case 'chase_disclosure': {
      main =
        `I act for ${client} at ${station} in relation to an allegation of ${offence}.\n\n` +
        'Please send disclosure as soon as possible so that I can advise my client properly before interview.';
      if (hasRecordedAttendanceWhen(fields.attendanceDate, fields.attendanceTime)) {
        main += `\n\nThe attendance is listed for ${dateWithTime}.`;
      }
      main += '\n\n' + disclosureEmailRequest(userEm);
      break;
    }
    case 'chase_disclosure_follow_up':
      main =
        `I act for ${client} at ${station} in relation to an allegation of ${offence}.\n\n` +
        'I requested disclosure previously but have not yet received it. Please could you send disclosure as soon as possible so that I can advise my client properly.\n\n' +
        disclosureEmailRequest(userEm);
      break;
    case 'confirm_outcome_after_attendance':
      main =
        `I attended ${station} on ${dateWithTime} to represent ${client} in relation to an allegation of ${offence}.\n\n` +
        'Please could you confirm the outcome of the attendance — for example, whether the client was charged, released without charge, released on police bail, or released under investigation — and, if bailed, the bail return date and time, return police station(s), and conditions.';
      break;
    case 'confirm_matter_effective':
      main =
        `I have been asked to attend ${station} to represent ${client} on ${dateWithTime}.\n\n` +
        'Please confirm that the matter remains effective for that attendance.';
      break;
    case 'request_officer_contact_details':
      main =
        `I have been asked to attend ${station} to represent ${client} on ${dateWithTime}.\n\n` +
        'Please confirm the name, email address, and telephone number of the officer dealing with the matter (or the custody sergeant / disclosure officer, if different).';
      break;
    case 'request_update_after_delay':
      main =
        `I act for ${client} at ${station} in relation to an allegation of ${offence}.\n\n` +
        'There has been a delay in the matter proceeding. Please advise when the interview / charging decision / release is now expected, and whether the matter remains effective. If the client has been released, please confirm on what basis (police bail, released under investigation, or without charge).';
      break;
    case 'bail_details_request':
      hasManyThanks = false;
      main = _buildBailDetailsMain({
        client, station, dateWithTime, offence, bailD, bailC, hasBailDate, hasBailCond, isFollowUp: false,
      });
      break;
    case 'chase_bail_details_follow_up':
      hasManyThanks = false;
      main = _buildBailDetailsMain({
        client, station, dateWithTime, offence, bailD, bailC, hasBailDate, hasBailCond, isFollowUp: true,
      });
      break;
    case 'rui_details_request':
      main =
        `I act for ${client}, who attended ${station} on ${dateWithTime} in relation to an allegation of ${offence}.\n\n` +
        `I understand they were released under investigation on ${date}. Please confirm that this is correct and advise when a charging decision is expected.`;
      break;
    case 'matter_stood_down':
      main =
        `I was asked to attend ${station} on ${dateWithTime} to represent ${client} in relation to an allegation of ${offence}.\n\n` +
        'Please note that I am no longer instructed to attend / the matter is no longer proceeding on that basis. Please confirm that the attendance can be stood down.';
      break;
    case 'voluntary_interview_confirmation':
      main =
        `I have been asked to represent ${client} for a voluntary interview at ${station} on ${dateWithTime} in relation to an allegation of ${offence}.\n\n` +
        'Please confirm that the interview remains effective.\n\n' +
        disclosureEmailRequest(userEm);
      break;
    case 'free_text_email':
      main = '[Type your message here]';
      break;
    default:
      main = '';
  }

  return trimMax(_bodyCommonEnd(dear, main, hasManyThanks, resolveSignOff(fields)), MAX_LENGTHS.body);
}

function insertExtraNote(body, extraNote) {
  const note = trimMax(extraNote, MAX_LENGTHS.extraNote);
  if (!note) return body;
  const insert = 'Additional note: ' + note;
  const b = str(body);
  const idxThanks = b.indexOf('Many thanks');
  if (idxThanks >= 0) {
    return b.slice(0, idxThanks) + insert + '\n\n' + b.slice(idxThanks);
  }
  const idxKind = b.indexOf('Kind regards');
  if (idxKind >= 0) {
    return b.slice(0, idxKind) + insert + '\n\n' + b.slice(idxKind);
  }
  return b + '\n\n' + insert;
}

function buildOutlookComposeUrl({ toEmail, subject, body }) {
  const to = trimMax(toEmail, MAX_LENGTHS.toEmail);
  const sub = trimMax(subject, MAX_LENGTHS.subject);
  return outlookWebCompose.buildOutlookWebComposeUrl({
    to,
    cc: '',
    subject: sub,
    body: str(body),
  });
}

function isLikelyEmailAddress(email) {
  const e = trimMax(email, MAX_LENGTHS.toEmail);
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function _domainOf(email) {
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  return email.slice(at + 1).toLowerCase();
}

function isLikelyProfessionalEmail(email, extraDomains) {
  const d = _domainOf(trimMax(email, MAX_LENGTHS.toEmail));
  if (!d) return false;
  const extras = Array.isArray(extraDomains) ? extraDomains : [];
  for (let j = 0; j < extras.length; j++) {
    const dom = String(extras[j] || '').toLowerCase().trim();
    if (!dom) continue;
    if (d === dom || d.endsWith('.' + dom)) return true;
  }
  const roots = [
    'police.uk', 'met.police.uk', 'kent.police.uk',
    'cps.gov.uk', 'justice.gov.uk', 'gov.uk', 'judiciary.uk', 'mod.gov.uk',
    'nhs.net', 'nhs.uk',
  ];
  for (let i = 0; i < roots.length; i++) {
    if (d === roots[i] || d.endsWith('.' + roots[i])) return true;
  }
  if (d.endsWith('.police.uk') || d.endsWith('police.uk')) return true;
  if (d.endsWith('.gov.uk') || d === 'gov.uk') return true;
  return false;
}

function normaliseOfficerEmailDraft(data) {
  const x = data || {};
  return {
    custodyNoteId: trimMax(x.custodyNoteId != null ? x.custodyNoteId : x.custody_note_id, 64),
    templateType: trimMax(x.templateType != null ? x.templateType : x.template_type, 80),
    toEmail: trimMax(x.toEmail != null ? x.toEmail : x.to_email, MAX_LENGTHS.toEmail),
    recipientName: trimMax(x.recipientName != null ? x.recipientName : x.recipient_name, MAX_LENGTHS.recipientName),
    clientName: trimMax(x.clientName != null ? x.clientName : x.client_name, MAX_LENGTHS.clientName),
    policeStation: trimMax(x.policeStation != null ? x.policeStation : x.police_station, MAX_LENGTHS.policeStation),
    offence: trimMax(x.offence != null ? x.offence : x.offence, MAX_LENGTHS.offence),
    attendanceDate: trimMax(x.attendanceDate != null ? x.attendanceDate : x.attendance_date, MAX_LENGTHS.attendanceDate),
    attendanceTime: trimMax(x.attendanceTime != null ? x.attendanceTime : x.attendance_time, MAX_LENGTHS.attendanceTime),
    extraNote: trimMax(x.extraNote != null ? x.extraNote : x.extra_note, MAX_LENGTHS.extraNote),
    bailReturnDate: trimMax(x.bailReturnDate != null ? x.bailReturnDate : x.bail_return_date, MAX_LENGTHS.bailReturnDate),
    bailConditions: trimMax(x.bailConditions != null ? x.bailConditions : x.bail_conditions, MAX_LENGTHS.bailConditions),
    userEmailAddress: trimMax(x.userEmailAddress != null ? x.userEmailAddress : x.user_email_address, MAX_LENGTHS.userEmailAddress),
    subject: trimMax(x.subject != null ? x.subject : x.subject, MAX_LENGTHS.subject),
    body: trimMax(x.body != null ? x.body : x.body, MAX_LENGTHS.body),
    status: trimMax(x.status != null ? x.status : 'draft', 40),
  };
}

function _checkLen(field, val, max, errors) {
  if (str(val).length > max) errors.push(field + ' exceeds maximum length');
}

function validateOfficerEmailDraft(data, opts) {
  const options = opts || {};
  const errors = [];
  let n = normaliseOfficerEmailDraft(data);

  if (options.mode === 'create' && !n.templateType) {
    n = Object.assign({}, n, { templateType: 'disclosure_confirm_attendance' });
  }

  if (options.mode === 'create' && !n.custodyNoteId) {
    errors.push('custodyNoteId is required');
  }

  if (n.templateType && TEMPLATE_TYPES.indexOf(n.templateType) < 0) {
    errors.push('Invalid template type');
  }

  if (n.status && STATUSES.indexOf(n.status) < 0) {
    errors.push('Invalid status');
  }

  _checkLen('toEmail', n.toEmail, MAX_LENGTHS.toEmail, errors);
  _checkLen('recipientName', n.recipientName, MAX_LENGTHS.recipientName, errors);
  _checkLen('clientName', n.clientName, MAX_LENGTHS.clientName, errors);
  _checkLen('policeStation', n.policeStation, MAX_LENGTHS.policeStation, errors);
  _checkLen('offence', n.offence, MAX_LENGTHS.offence, errors);
  _checkLen('attendanceDate', n.attendanceDate, MAX_LENGTHS.attendanceDate, errors);
  _checkLen('attendanceTime', n.attendanceTime, MAX_LENGTHS.attendanceTime, errors);
  _checkLen('extraNote', n.extraNote, MAX_LENGTHS.extraNote, errors);
  _checkLen('bailReturnDate', n.bailReturnDate, MAX_LENGTHS.bailReturnDate, errors);
  _checkLen('bailConditions', n.bailConditions, MAX_LENGTHS.bailConditions, errors);
  _checkLen('userEmailAddress', n.userEmailAddress, MAX_LENGTHS.userEmailAddress, errors);
  _checkLen('subject', n.subject, MAX_LENGTHS.subject, errors);
  _checkLen('body', n.body, MAX_LENGTHS.body, errors);

  return { ok: errors.length === 0, errors, normalized: n };
}

function validateOpenOutlookFields(draft, opts) {
  const options = opts || {};
  const extraDomains = Array.isArray(options.extraDomains) ? options.extraDomains : [];
  const errors = [];
  const to = trimMax(draft.toEmail || draft.to_email, MAX_LENGTHS.toEmail);
  const subject = trimMax(draft.subject, MAX_LENGTHS.subject);
  const body = str(draft.body);
  if (!to) errors.push('Please enter a recipient email address.');
  else if (!isLikelyEmailAddress(to)) errors.push('The recipient email address does not look valid.');
  else if (!isLikelyProfessionalEmail(to, extraDomains)) {
    errors.push(
      'The recipient must be a police, government, NHS, or recognised professional email address (or your firm email set in Settings).'
    );
  }
  if (!subject.trim()) errors.push('Please enter a subject before opening Outlook.');
  if (!body.trim()) errors.push('Please enter an email body before opening Outlook.');
  return { ok: errors.length === 0, errors };
}

module.exports = {
  TEMPLATE_TYPES,
  STATUSES,
  STATUS_LABELS,
  ALLOWED_TRANSITIONS,
  MAX_LENGTHS,
  SUBJECT_SUFFIX,
  TEMPLATE_UI_OPTIONS,
  canTransitionStatus,
  getTemplateDisplayName,
  getRecipientNameOrDefault,
  resolveSignOff,
  generateOfficerEmailSubject,
  generateOfficerEmailBody,
  insertExtraNote,
  buildOutlookComposeUrl,
  isLikelyEmailAddress,
  isLikelyProfessionalEmail,
  normaliseOfficerEmailDraft,
  validateOfficerEmailDraft,
  validateOpenOutlookFields,
  str,
  trimMax,
};

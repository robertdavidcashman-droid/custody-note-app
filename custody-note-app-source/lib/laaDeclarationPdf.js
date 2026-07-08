'use strict';

/**
 * LAA Declaration blocks — official wording for in-app signature sections and PDFs.
 * Shared by renderer (script tag) and node --test.
 *
 * Sources:
 *  - CRM2 v15 Oct 2025 — Advice & Assistance client declaration + Privacy Notice
 *  - Applicant's declaration for online submissions v7 Feb 2025 — CRM14 / Apply
 */

var PRIVACY_ACK_LABEL = 'Privacy Notice acknowledged?';

function _privacySections() {
  if (typeof window !== 'undefined' && window.LaaPrivacyNoticeV7 && window.LaaPrivacyNoticeV7.LAA_PRIVACY_NOTICE_V7_SECTIONS) {
    return window.LaaPrivacyNoticeV7.LAA_PRIVACY_NOTICE_V7_SECTIONS;
  }
  try {
    return require('./laaPrivacyNoticeV7').LAA_PRIVACY_NOTICE_V7_SECTIONS;
  } catch (_) {
    return [];
  }
}

function _flattenPrivacySections() {
  if (typeof window !== 'undefined' && window.LaaPrivacyNoticeV7 && window.LaaPrivacyNoticeV7.flattenPrivacyNoticeSections) {
    return window.LaaPrivacyNoticeV7.flattenPrivacyNoticeSections(_privacySections());
  }
  try {
    return require('./laaPrivacyNoticeV7').flattenPrivacyNoticeSections(_privacySections());
  } catch (_) {
    return '';
  }
}

// CRM2 — Client's Declaration (Advice & Assistance, incl. police station).
var LAA_APPLICANT_DECLARATION =
  'As far as I know all the information I have given is true and I have not withheld any relevant information. ' +
  'I understand that if I give false information the services provided to me may be cancelled and I may be prosecuted.';

var LAA_PARTNER_DECLARATION_NOTE =
  'Partner\u2019s declaration: I declare that the information included in this application is a true statement of all my financial circumstances to the best of my knowledge and belief. I agree to the LAA checking the information I have given. I authorise those organisations to provide the information for which the LAA may ask. I have read the Fraud Notice.';

var CRM14_FRAUD_WARNING =
  'Making a false declaration is an offence. If you are found doing so, you may be prosecuted, potentially leading to a fine and/or a prison sentence. The Legal Aid Agency has a zero tolerance approach to fraud and will look to prosecute where there is evidence of fraud.';

var CRM14_FAIR_PROCESSING_NOTICE =
  'If false or inaccurate information is provided and fraud is identified, details will be passed to fraud prevention agencies to prevent fraud and money laundering. ' +
  'Further details explaining how the information held by fraud prevention agencies may be used can be found in the \u2018Fair Processing Notice\u2019, available on the website at: www.justice.gov.uk/legal-aid/make-an-application';

var CRM14_PARTNER_DECLARATION_PARAGRAPHS = [
  'I declare that the information included in this application is a true statement of all my financial circumstances to the best of my knowledge and belief. I agree to the LAA and HMCTS, or my partner\u2019s solicitor, checking the information I have given, with the Department for Work and Pensions, HM Revenue and Customs or other people and organisations. I authorise those people and organisations to provide the information for which the LAA, HMCTS or my partner\u2019s solicitor may ask.',
  'I understand that this application will be made electronically by the legal representative. I have read the Fraud Notice.',
];

var CRM14_REP_DECLARATION_PARAGRAPHS = [
  'I represent the applicant. I confirm that I am authorised to provide representation under a contract issued by the LAA.',
  'I confirm that I have been instructed to provide representation by:',
];

var CRM14_REP_INSTRUCTION_BULLETS = [
  'a firm which holds a contract issued by the LAA',
  'a solicitor employed by the LAA in the Public Defender Service who is authorised to provide representation.',
];

var CRM14_REP_DECLARATION_CLOSING = [
  'I confirm that I have gone through the questions on the Interests of Justice and financial assessment aspects of the application with the applicant.',
  'I confirm that the applicant has not provided me with any information which contradicts the information provided in this declaration of financial circumstances and has given me no indication that information declared is incomplete or untrue.',
];

// Full v7 Applicant's Declaration — structured blocks (online criminal legal aid).
var CRM14_APPLICANT_BLOCKS = [
  { type: 'p', text: 'I apply for the right to representation for the purposes of criminal proceedings under the Legal Aid, Sentencing and Punishment of Offenders Act 2012.' },
  { type: 'p', text: 'I declare that my application will be made electronically by my legal representative.' },
  {
    type: 'p_bullets',
    text: 'I understand that if I have declared anything that is not true, or left anything out that:',
    bullets: [
      'I may be prosecuted for fraud. I understand that if I am convicted, I may be sent to prison or pay a fine.',
      'My legal aid may be stopped and I may be asked to pay back my costs in full to the Legal Aid Agency (LAA).',
      'If my case is in the Crown Court, the LAA may change the amount of the contribution which I must pay.',
    ],
  },
  {
    type: 'p',
    text: 'I agree to tell the LAA or HM Courts & Tribunals Service (HMCTS) immediately if my income or capital or those of my partner, change. These changes include the sale of property, change of address, change in employment and change in capital.',
  },
  {
    type: 'labelled',
    label: 'Evidence',
    text: 'I agree to provide, when asked, further details and evidence of my finances and those of my partner, to the LAA, its agents, or HMCTS, to help them decide whether an Order should be made and its terms.',
  },
  {
    type: 'labelled',
    label: 'Ending legal aid',
    text: 'I understand that I must tell my solicitor and write to the court if I no longer want public representation. I understand that if I decline representation I may be liable for costs incurred to the date when my solicitor and the court receive my letter.',
  },
  {
    type: 'p',
    text: 'I authorise such enquiries as are considered necessary to enable the LAA, its agents, HMCTS, or my solicitor to find out my income and capital, and those of my partner. This includes my consent for parties such as my bank, building society, the Department for Work and Pensions, the Driver and Vehicle Licensing Agency or HM Revenue and Customs to provide information to assist the LAA, its agents or HMCTS with their enquiries.',
  },
  {
    type: 'p',
    text: 'I consent to the LAA or my solicitor contacting my partner for information and evidence about my partner\u2019s means. This includes circumstances where my partner is unable to sign or complete the form.',
  },
  {
    type: 'p',
    text: 'I understand that if the information which my partner provides is incorrect, or if my partner refuses to provide information, then: if my case is in the magistrates\u2019 court, my legal aid may be withdrawn or, if my case is in the Crown Court, I may be liable to sanctions. I understand that the sanctions may result in me paying, or paying more towards my legal costs, or paying my legal aid costs in full.',
  },
  {
    type: 'p',
    text: 'I understand that in Crown Court proceedings the information I have given in this form will be used to determine whether I am eligible for legal aid and, if so, whether I am liable to contribute to the costs of my defence under an Income Contribution Order during my case or, if I am convicted, under a Final Contribution Order at the end of my case, or both.',
  },
  {
    type: 'p',
    text: 'I understand that if I am ordered to pay towards my legal aid under an Income Contribution Order, or if I am convicted and ordered to pay under a Final Contribution Order but fail to pay as the Order instructs me, interest may be charged or enforcement proceedings may be brought against me or both.',
  },
  {
    type: 'p',
    text: 'I understand that I may have to pay the costs of the enforcement proceedings in addition to the payments required under the Contribution Order, and the enforcement proceedings could result in a charge being placed on my home.',
  },
  {
    type: 'labelled',
    label: 'Data Sharing',
    text: 'I agree that, if I am convicted, the information in this form will be used by HMCTS or a designated officer to determine the appropriate level of any financial penalty ordered against me, and for its collection and enforcement. I have read the Fraud Notice.',
  },
];

var LAA_PRIVACY_NOTICE = _flattenPrivacySections();

function _esc(esc) {
  return esc || function (s) { return String(s == null ? '' : s); };
}

function _trim(v) {
  return (v == null ? '' : String(v)).trim();
}

function _privacyText(refData) {
  return (refData && refData.privacyNoticeText && _trim(refData.privacyNoticeText)) || LAA_PRIVACY_NOTICE;
}

function _adviceDeclarationText(refData) {
  return (refData && refData.laaDeclarationText && _trim(refData.laaDeclarationText)) || LAA_APPLICANT_DECLARATION;
}

function _renderPrivacySectionsHtml(esc, forPdf) {
  esc = _esc(esc);
  var sections = _privacySections();
  var headingCls = forPdf ? 'laa-decl-heading' : 'privacy-text';
  var textCls = forPdf ? '' : 'privacy-text';
  var html = '';
  sections.forEach(function (sec) {
    if (sec.heading) {
      html += '<p class="' + headingCls + '"><strong>' + esc(sec.heading) + '</strong></p>';
    }
    (sec.paragraphs || []).forEach(function (p) {
      html += '<p' + (textCls ? ' class="' + textCls + '"' : '') + '>' + esc(p) + '</p>';
    });
    if (sec.bullets && sec.bullets.length) {
      html += '<ul class="laa-decl-bullets">';
      sec.bullets.forEach(function (b) {
        html += '<li>' + esc(b) + '</li>';
      });
      html += '</ul>';
    }
  });
  return html;
}

function _renderApplicantBlocksHtml(blocks, esc, forPdf) {
  esc = _esc(esc);
  var cls = forPdf ? '' : ' class="declaration-text"';
  var html = '';
  (blocks || []).forEach(function (block) {
    if (block.type === 'p') {
      html += '<p' + cls + '>' + esc(block.text) + '</p>';
    } else if (block.type === 'p_bullets') {
      html += '<p' + cls + '>' + esc(block.text) + '</p>';
      html += '<ul class="laa-decl-bullets">';
      (block.bullets || []).forEach(function (b) { html += '<li>' + esc(b) + '</li>'; });
      html += '</ul>';
    } else if (block.type === 'labelled') {
      html += '<p' + cls + '><strong>' + esc(block.label) + '</strong> ' + esc(block.text) + '</p>';
    }
  });
  return html;
}

function _crm14ApplicantHtml(esc, forPdf) {
  esc = _esc(esc);
  var parts = _renderApplicantBlocksHtml(CRM14_APPLICANT_BLOCKS, esc, forPdf);
  if (forPdf) {
    return '<div class="decl-box"><p class="laa-decl-applicant">Declaration by the applicant (Apply for criminal legal aid \u2014 v7 Feb 2025)</p>' + parts + '</div>';
  }
  return '<h3>Applicant\u2019s Declaration</h3>' + parts;
}

function buildLaaDeclarationPdfCss() {
  return '.laa-privacy-box{font-size:9.5px;background:#fffbeb;border:1px solid #f59e0b;border-radius:5px;padding:8px 10px;margin:8px 0;line-height:1.5;white-space:normal;word-break:break-word;print-color-adjust:exact;}' +
    '.laa-decl-heading{font-size:10px;font-weight:700;margin:0.5rem 0 0.25rem;color:#92400e;}' +
    '.laa-decl-applicant{font-size:10px;font-weight:700;margin:0 0 6px;color:#92400e;}' +
    '.laa-static-note{font-size:9px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:6px 9px;margin:6px 0;line-height:1.45;white-space:pre-wrap;word-break:break-word;print-color-adjust:exact;}' +
    '.laa-fraud-warning{font-size:9px;background:#fef2f2;border:1px solid #fecaca;border-radius:5px;padding:6px 9px;margin:0 0 8px;line-height:1.45;word-break:break-word;print-color-adjust:exact;}' +
    '.laa-decl-bullets{margin:0.25rem 0 0.5rem 1.1rem;padding:0;font-size:inherit;line-height:1.45;}' +
    '.laa-decl-bullets li{margin-bottom:0.25rem;}';
}

function buildLaaPrivacyNoticeHtml(refData, esc) {
  esc = _esc(esc);
  var body = _renderPrivacySectionsHtml(esc, true);
  if (!body) body = '<p>' + esc(_privacyText(refData)) + '</p>';
  return '<div class="laa-privacy-box"><p class="laa-decl-heading">Legal Aid Agency Privacy Notice</p>' + body + '</div>';
}

function buildLaaApplicantDeclarationHtml(refData, esc) {
  esc = _esc(esc);
  return '<div class="decl-box"><p class="laa-decl-applicant">Client\u2019s Declaration (Advice &amp; Assistance \u2014 CRM1/CRM2)</p><p>' + esc(_adviceDeclarationText(refData)) + '</p></div>';
}

function buildLaaPartnerDeclarationNoteHtml(esc) {
  esc = _esc(esc);
  return '<p class="laa-static-note"><em>' + esc(LAA_PARTNER_DECLARATION_NOTE) + '</em></p>';
}

function buildCrm14ApplicantDeclarationNoteHtml(esc) {
  return _crm14ApplicantHtml(esc, true);
}

function buildCrm14FraudWarningHtml(esc) {
  esc = _esc(esc);
  return '<p class="laa-fraud-warning"><strong>PLEASE NOTE</strong> ' + esc(CRM14_FRAUD_WARNING) + '</p>';
}

function buildCrm14FairProcessingNoticeHtml(esc) {
  esc = _esc(esc);
  return '<p class="laa-static-note"><strong>Fraud Notice.</strong> ' + esc(CRM14_FAIR_PROCESSING_NOTICE) + '</p>';
}

function buildCrm14PartnerDeclarationNoteHtml(esc) {
  esc = _esc(esc);
  var parts = CRM14_PARTNER_DECLARATION_PARAGRAPHS.map(function (p) {
    return '<p class="laa-static-note"><em>' + esc(p) + '</em></p>';
  }).join('');
  return '<p class="laa-static-note"><strong>Declaration by your (the applicant\u2019s) partner.</strong></p>' + parts;
}

function buildCrm14RepDeclarationNoteHtml(esc) {
  esc = _esc(esc);
  var html = '<p class="laa-static-note"><strong>Declaration by the legal representative.</strong></p>';
  CRM14_REP_DECLARATION_PARAGRAPHS.forEach(function (p) {
    html += '<p class="laa-static-note"><em>' + esc(p) + '</em></p>';
  });
  html += '<ul class="laa-decl-bullets">';
  CRM14_REP_INSTRUCTION_BULLETS.forEach(function (b) { html += '<li><em>' + esc(b) + '</em></li>'; });
  html += '</ul>';
  CRM14_REP_DECLARATION_CLOSING.forEach(function (p) {
    html += '<p class="laa-static-note"><em>' + esc(p) + '</em></p>';
  });
  return html;
}

/**
 * In-app declaration blocks — shown immediately before signature fields.
 * @param {string} variant - adviceAssistance | crm14Applicant | partnerAdvice | partnerCrm14 | representative
 */
function buildLaaDeclarationFormHtml(variant, refData, esc) {
  esc = _esc(esc);
  var html = '<div class="declaration-box laa-decl-block" data-laa-decl-variant="' + esc(variant) + '">';
  if (variant === 'adviceAssistance') {
    html += '<p class="privacy-text"><strong>Legal Aid Agency Privacy Notice</strong></p>';
    html += _renderPrivacySectionsHtml(esc, false) || ('<p class="privacy-text">' + esc(_privacyText(refData)) + '</p>');
    html += '<h3>Client\u2019s Declaration (Advice &amp; Assistance \u2014 CRM1/CRM2)</h3>';
    html += '<p class="declaration-text">' + esc(_adviceDeclarationText(refData)) + '</p>';
  } else if (variant === 'crm14Applicant') {
    html += '<p class="privacy-text"><strong>Legal Aid Agency Privacy Notice</strong></p>';
    html += _renderPrivacySectionsHtml(esc, false) || ('<p class="privacy-text">' + esc(_privacyText(refData)) + '</p>');
    html += '<p class="laa-fraud-warning"><strong>PLEASE NOTE</strong> ' + esc(CRM14_FRAUD_WARNING) + '</p>';
    html += _crm14ApplicantHtml(esc, false);
    html += '<p class="declaration-text"><strong>Fraud Notice.</strong> <em>' + esc(CRM14_FAIR_PROCESSING_NOTICE) + '</em></p>';
  } else if (variant === 'partnerAdvice') {
    html += '<p class="declaration-text"><em>' + esc(LAA_PARTNER_DECLARATION_NOTE) + '</em></p>';
  } else if (variant === 'partnerCrm14') {
    html += '<p class="declaration-text"><strong>Declaration by your (the applicant\u2019s) partner.</strong></p>';
    CRM14_PARTNER_DECLARATION_PARAGRAPHS.forEach(function (p) {
      html += '<p class="declaration-text"><em>' + esc(p) + '</em></p>';
    });
  } else if (variant === 'representative') {
    html += '<p class="declaration-text"><strong>Declaration by the legal representative.</strong></p>';
    CRM14_REP_DECLARATION_PARAGRAPHS.forEach(function (p) {
      html += '<p class="declaration-text"><em>' + esc(p) + '</em></p>';
    });
    html += '<ul class="laa-decl-bullets">';
    CRM14_REP_INSTRUCTION_BULLETS.forEach(function (b) { html += '<li><em>' + esc(b) + '</em></li>'; });
    html += '</ul>';
    CRM14_REP_DECLARATION_CLOSING.forEach(function (p) {
      html += '<p class="declaration-text"><em>' + esc(p) + '</em></p>';
    });
  }
  html += '</div>';
  return html;
}

function resolveLaaClientName(d) {
  d = d || {};
  var explicit = _trim(d.laaClientFullName);
  if (explicit) return explicit;
  var derived = [d.forename, d.middleName, d.surname].map(_trim).filter(Boolean).join(' ');
  return derived ? derived.toUpperCase() : '';
}

function resolveLaaFeeEarnerName(d) {
  d = d || {};
  return _trim(d.laaFeeEarnerFullName) || _trim(d.feeEarnerName);
}

function _blocksToPlainText(blocks) {
  return (blocks || []).map(function (block) {
    var parts = [];
    if (block.label) parts.push(block.label);
    if (block.text) parts.push(block.text);
    (block.bullets || []).forEach(function (b) { parts.push(b); });
    return parts.join(' ');
  }).join(' ');
}

var CRM14_APPLICANT_DECLARATION = _blocksToPlainText(CRM14_APPLICANT_BLOCKS);
var CRM14_APPLICANT_PARAGRAPHS = CRM14_APPLICANT_BLOCKS.filter(function (b) { return b.type === 'p' || b.type === 'labelled'; }).map(function (b) {
  return b.label ? (b.label + ' ' + b.text) : b.text;
});
var CRM14_PARTNER_DECLARATION_NOTE = CRM14_PARTNER_DECLARATION_PARAGRAPHS.join(' ');
var CRM14_REP_DECLARATION_NOTE = CRM14_REP_DECLARATION_PARAGRAPHS.concat(CRM14_REP_INSTRUCTION_BULLETS).concat(CRM14_REP_DECLARATION_CLOSING).join(' ');

var LaaDeclarationPdf = {
  PRIVACY_ACK_LABEL: PRIVACY_ACK_LABEL,
  LAA_APPLICANT_DECLARATION: LAA_APPLICANT_DECLARATION,
  LAA_PARTNER_DECLARATION_NOTE: LAA_PARTNER_DECLARATION_NOTE,
  LAA_PRIVACY_NOTICE: LAA_PRIVACY_NOTICE,
  CRM14_APPLICANT_DECLARATION: CRM14_APPLICANT_DECLARATION,
  CRM14_APPLICANT_BLOCKS: CRM14_APPLICANT_BLOCKS,
  CRM14_APPLICANT_PARAGRAPHS: CRM14_APPLICANT_PARAGRAPHS,
  CRM14_FRAUD_WARNING: CRM14_FRAUD_WARNING,
  CRM14_FAIR_PROCESSING_NOTICE: CRM14_FAIR_PROCESSING_NOTICE,
  CRM14_PARTNER_DECLARATION_NOTE: CRM14_PARTNER_DECLARATION_NOTE,
  CRM14_REP_DECLARATION_NOTE: CRM14_REP_DECLARATION_NOTE,
  buildLaaDeclarationPdfCss: buildLaaDeclarationPdfCss,
  buildLaaPrivacyNoticeHtml: buildLaaPrivacyNoticeHtml,
  buildLaaApplicantDeclarationHtml: buildLaaApplicantDeclarationHtml,
  buildLaaPartnerDeclarationNoteHtml: buildLaaPartnerDeclarationNoteHtml,
  buildLaaDeclarationFormHtml: buildLaaDeclarationFormHtml,
  buildCrm14ApplicantDeclarationNoteHtml: buildCrm14ApplicantDeclarationNoteHtml,
  buildCrm14FraudWarningHtml: buildCrm14FraudWarningHtml,
  buildCrm14FairProcessingNoticeHtml: buildCrm14FairProcessingNoticeHtml,
  buildCrm14PartnerDeclarationNoteHtml: buildCrm14PartnerDeclarationNoteHtml,
  buildCrm14RepDeclarationNoteHtml: buildCrm14RepDeclarationNoteHtml,
  resolveLaaClientName: resolveLaaClientName,
  resolveLaaFeeEarnerName: resolveLaaFeeEarnerName,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LaaDeclarationPdf;
}
if (typeof window !== 'undefined') {
  window.LaaDeclarationPdf = LaaDeclarationPdf;
}

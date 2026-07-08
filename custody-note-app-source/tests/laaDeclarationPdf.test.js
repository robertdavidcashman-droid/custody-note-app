'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const laaPdf = require('../lib/laaDeclarationPdf');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refData = JSON.parse(fs.readFileSync(path.join(root, 'data', 'laa-reference-data.json'), 'utf8'));
const id = function (s) { return s; };

describe('laaDeclarationPdf helpers — official LAA wording', () => {
  it('privacy notice carries the official LAA purpose + lawful basis', () => {
    const html = laaPdf.buildLaaPrivacyNoticeHtml(refData, id);
    assert.match(html, /Legal Aid Agency Privacy Notice<\/p>/);
    assert.match(html, /Executive Agency of the Ministry of Justice/);
    assert.match(html, /Article 6\(1\)\(e\) of UK GDPR/);
    assert.match(html, /Types of personal data we process/);
    assert.match(html, /Information Commissioner/);
  });

  it('privacy notice falls back to the built-in official text when refData missing', () => {
    const html = laaPdf.buildLaaPrivacyNoticeHtml({}, id);
    assert.match(html, /Executive Agency of the Ministry of Justice/);
    assert.ok(html.length > 500, 'fallback privacy notice should be substantial');
  });

  it('client declaration uses the official CRM2 wording', () => {
    const html = laaPdf.buildLaaApplicantDeclarationHtml(refData, id);
    assert.match(html, /Client\u2019s Declaration \(Advice/);
    assert.match(html, /all the information I have given is true and I have not withheld any relevant information/);
    assert.match(html, /the services provided to me may be cancelled and I may be prosecuted/);
  });

  it('client declaration falls back to the built-in CRM2 text when refData missing', () => {
    const html = laaPdf.buildLaaApplicantDeclarationHtml({}, id);
    assert.match(html, /all the information I have given is true/);
  });

  it('CRM14 applicant declaration reflects the official applicant declaration form', () => {
    const html = laaPdf.buildCrm14ApplicantDeclarationNoteHtml(id);
    assert.match(html, /right to representation for the purposes of criminal proceedings/);
    assert.match(html, /left anything out that:/);
    assert.match(html, /<ul class="laa-decl-bullets">/);
    assert.match(html, /My legal aid may be stopped and I may be asked to pay back my costs in full/);
    assert.match(html, /Data Sharing/);
    assert.match(html, /I have read the Fraud Notice/);
  });

  it('CRM14 fair processing notice matches the official v7 fraud notice page', () => {
    const html = laaPdf.buildCrm14FairProcessingNoticeHtml(id);
    assert.match(html, /Fair Processing Notice/);
    assert.match(html, /www\.justice\.gov\.uk\/legal-aid\/make-an-application/);
  });

  it('CRM14 fraud warning matches the official zero-tolerance notice', () => {
    const html = laaPdf.buildCrm14FraudWarningHtml(id);
    assert.match(html, /PLEASE NOTE/);
    assert.match(html, /Making a false declaration is an offence/);
    assert.match(html, /zero tolerance approach to fraud/);
  });

  it('CRM14 partner declaration matches the official wording', () => {
    const html = laaPdf.buildCrm14PartnerDeclarationNoteHtml(id);
    assert.match(html, /Declaration by your \(the applicant\u2019s\) partner/);
    assert.match(html, /true statement of all my financial circumstances/);
    assert.match(html, /Department for Work and Pensions, HM Revenue and Customs or other people and organisations/);
    assert.match(html, /made electronically by the legal representative/);
  });

  it('CRM14 representative declaration includes instruction bullets', () => {
    const html = laaPdf.buildCrm14RepDeclarationNoteHtml(id);
    assert.match(html, /authorised to provide representation under a contract issued by the LAA/);
    assert.match(html, /Interests of Justice and financial assessment/);
    assert.match(html, /a firm which holds a contract issued by the LAA/);
    assert.match(html, /Public Defender Service/);
  });

  it('uses Privacy Notice acknowledged? label constant', () => {
    assert.strictEqual(laaPdf.PRIVACY_ACK_LABEL, 'Privacy Notice acknowledged?');
  });

  it('buildLaaDeclarationFormHtml renders advice variant with privacy first', () => {
    const html = laaPdf.buildLaaDeclarationFormHtml('adviceAssistance', {}, id);
    assert.match(html, /laa-decl-block/);
    assert.match(html, /Legal Aid Agency Privacy Notice/);
    assert.match(html, /Client\u2019s Declaration \(Advice/);
    assert.match(html, /all the information I have given is true/);
    const privacyIdx = html.indexOf('Legal Aid Agency Privacy Notice');
    const declIdx = html.indexOf('Client\u2019s Declaration');
    assert.ok(privacyIdx < declIdx, 'privacy notice should precede declaration');
  });

  it('buildLaaDeclarationFormHtml renders full CRM14 applicant variant', () => {
    const html = laaPdf.buildLaaDeclarationFormHtml('crm14Applicant', {}, id);
    assert.match(html, /PLEASE NOTE/);
    assert.match(html, /Applicant\u2019s Declaration/);
    assert.match(html, /right to representation for the purposes of criminal proceedings/);
    assert.match(html, /left anything out that:/);
    assert.match(html, /Fair Processing Notice/);
    assert.match(html, /I have read the Fraud Notice/);
    assert.ok(laaPdf.CRM14_APPLICANT_BLOCKS.length >= 12, 'v7 applicant declaration should be multi-block');
  });

  it('buildLaaDeclarationFormHtml renders partner and representative variants', () => {
    const partnerAdvice = laaPdf.buildLaaDeclarationFormHtml('partnerAdvice', {}, id);
    assert.match(partnerAdvice, /Partner\u2019s declaration/);
    const partnerCrm14 = laaPdf.buildLaaDeclarationFormHtml('partnerCrm14', {}, id);
    assert.match(partnerCrm14, /Declaration by your \(the applicant\u2019s\) partner/);
    const rep = laaPdf.buildLaaDeclarationFormHtml('representative', {}, id);
    assert.match(rep, /Declaration by the legal representative/);
  });
});

describe('laaDeclarationPdf — client / fee-earner name fallback (regression)', () => {
  it('uses laaClientFullName when present', () => {
    assert.strictEqual(laaPdf.resolveLaaClientName({ laaClientFullName: 'JANE DOE' }), 'JANE DOE');
  });

  it('falls back to forename/middle/surname (block capitals) when laaClientFullName blank', () => {
    assert.strictEqual(
      laaPdf.resolveLaaClientName({ forename: 'Jane', middleName: 'A', surname: 'Doe' }),
      'JANE A DOE'
    );
  });

  it('returns empty string only when there is no name at all', () => {
    assert.strictEqual(laaPdf.resolveLaaClientName({}), '');
  });

  it('fee earner name falls back to feeEarnerName', () => {
    assert.strictEqual(laaPdf.resolveLaaFeeEarnerName({ feeEarnerName: 'A Solicitor' }), 'A Solicitor');
    assert.strictEqual(
      laaPdf.resolveLaaFeeEarnerName({ laaFeeEarnerFullName: 'B Solicitor', feeEarnerName: 'A' }),
      'B Solicitor'
    );
  });
});

describe('data/laa-reference-data.json carries official wording', () => {
  it('laaDeclarationText is the CRM2 client declaration', () => {
    assert.match(refData.laaDeclarationText, /all the information I have given is true and I have not withheld any relevant information/);
  });
  it('privacyNoticeText is the official LAA privacy notice', () => {
    assert.match(refData.privacyNoticeText, /Executive Agency of the Ministry of Justice/);
    assert.match(refData.privacyNoticeText, /Article 6\(1\)\(e\) of UK GDPR/);
    assert.match(refData.privacyNoticeText, /Types of personal data we process/);
  });
});

describe('laaDeclarationPdf app wiring', () => {
  it('loads lib/laaDeclarationPdf.js before app.js', () => {
    const privacyIdx = indexHtml.indexOf('src="lib/laaPrivacyNoticeV7.js"');
    const libIdx = indexHtml.indexOf('src="lib/laaDeclarationPdf.js"');
    const appIdx = indexHtml.indexOf('src="app.js"');
    assert.ok(privacyIdx !== -1);
    assert.ok(libIdx !== -1);
    assert.ok(appIdx !== -1);
    assert.ok(privacyIdx < libIdx);
    assert.ok(libIdx < appIdx);
  });

  it('app.js prints privacy notice and renamed acknowledgment row in LAA Declaration', () => {
    assert.match(appJs, /laaPrivacyNoticePdfHtml/);
    assert.match(appJs, /laaApplicantDeclarationPdfHtml/);
    assert.match(appJs, /laaPrivacyAckLabel\(\)/);
    assert.doesNotMatch(appJs, /row\('Privacy Notice', d\.privacyNoticeAccepted\)/);
  });

  it('all three builders use the client-name fallback helper in section 11', () => {
    const occurrences = (appJs.match(/row\('Client [Nn]ame', laaClientNameForPdf\(d\)\)/g) || []).length;
    assert.ok(occurrences >= 3, 'expected client-name fallback in custody, telephone and voluntary builders, found ' + occurrences);
    assert.doesNotMatch(appJs, /row\('Client [Nn]ame', d\.laaClientFullName\)/);
  });

  it('fee earner row uses the fallback helper', () => {
    assert.match(appJs, /row\('Fee Earner', laaFeeEarnerNameForPdf\(d\)\)/);
    assert.doesNotMatch(appJs, /row\('Fee Earner', d\.laaFeeEarnerFullName\)/);
  });

  it('section 14 renders the CRM14 applicant declaration and fair processing notice', () => {
    assert.match(appJs, /crm14ApplicantDeclarationNotePdfHtml\(h\)/);
    assert.match(appJs, /crm14FairProcessingNoticePdfHtml\(h\)/);
  });

  it('does not default privacyNoticeAccepted to No on new records', () => {
    assert.doesNotMatch(appJs, /formData\.privacyNoticeAccepted = 'No'/);
  });

  it('form field offers blank default before Yes/No', () => {
    assert.match(appJs, /privacyNoticeAccepted.*options: \['','Yes','No'\]/);
  });

  it('uses laaDeclarationBlock field type wired to buildLaaDeclarationFormHtml', () => {
    assert.match(appJs, /type: 'laaDeclarationBlock'/);
    assert.match(appJs, /buildLaaDeclarationFormHtmlForUi/);
    assert.match(appJs, /variant: 'crm14Applicant'/);
    assert.doesNotMatch(appJs, /hasDeclarationText/);
    assert.doesNotMatch(appJs, /inlineDeclaration/);
  });

  it('lib/laaDeclarationPdf.js uses browser-safe export', () => {
    const src = fs.readFileSync(path.join(root, 'lib', 'laaDeclarationPdf.js'), 'utf8');
    assert.match(src, /typeof module !== 'undefined' && module\.exports/);
    assert.match(src, /window\.LaaDeclarationPdf = LaaDeclarationPdf/);
  });

  it('PDF surfaces a visible notice (never silent empty) when wording module is unavailable', () => {
    assert.match(appJs, /laaDeclUnavailableNoticeHtml/);
    assert.match(appJs, /Legal Aid declaration text could not be loaded/);
    // The privacy-notice entry point must not silently return '' anymore.
    assert.doesNotMatch(appJs, /return L \? L\.buildLaaPrivacyNoticeHtml\(refData, escFn\) : '';/);
  });

  it('PDF applicant declaration never silently returns empty when wording module is unavailable', () => {
    const fnStart = appJs.indexOf('function laaApplicantDeclarationPdfHtml(escFn)');
    const fnEnd = appJs.indexOf('function laaPartnerDeclarationNotePdfHtml(escFn)', fnStart);
    assert.ok(fnStart !== -1 && fnEnd !== -1, 'expected laaApplicantDeclarationPdfHtml in app.js');
    const body = appJs.slice(fnStart, fnEnd);
    assert.doesNotMatch(body, /return L \? L\.buildLaaApplicantDeclarationHtml\(refData, escFn\) : '';/);
    assert.match(body, /_laaFallbackAdviceDeclarationText\(refData\)/);
    assert.match(body, /Client\\u2019s Declaration \(Advice &amp; Assistance \\u2014 CRM1\/CRM2\)/);
  });

  it('PDF LAA declaration CSS renders even when wording module is unavailable', () => {
    assert.match(appJs, /_LAA_DECL_PDF_CSS/);
    assert.match(appJs, /return L \? L\.buildLaaDeclarationPdfCss\(\) : _LAA_DECL_PDF_CSS/);
  });

  it('logs a traceable error when window.LaaDeclarationPdf is missing', () => {
    assert.match(appJs, /\[LAA-DECL\] window\.LaaDeclarationPdf unavailable/);
  });

  it('exposes the in-app declaration builder for runtime verification', () => {
    assert.match(appJs, /window\.buildLaaDeclarationFormHtmlForUi = buildLaaDeclarationFormHtmlForUi/);
  });

  it('custody PDF always renders LAA Declaration section with online applicant declaration', () => {
    assert.match(appJs, /11\. LAA Declaration/);
    assert.match(appJs, /laaOnlineApplicantDeclarationPdfHtml\(h\)/);
    assert.match(appJs, /crm14PartnerDeclarationNotePdfHtml\(h\)/);
    assert.doesNotMatch(
      appJs,
      /if \(!laaRows && !hasSig && !laaPrivacyNoticePdfHtml\(h\) && !laaApplicantDeclarationPdfHtml\(h\)\) return '';/,
    );
    assert.match(appJs, /laaPrivacyNoticePdfHtml\(h\)/);
    assert.match(appJs, /Counsel instructed\? \(CRM3\)/);
    assert.match(appJs, /crm14FraudWarningPdfHtml\(h\)/);
  });

  it('LAA sign-off sections use the online applicant declaration variant', () => {
    const matches = appJs.match(/type: 'laaDeclarationBlock', variant: 'crm14Applicant'/g) || [];
    assert.ok(matches.length >= 4, 'expected online declaration at section 11, attend inline, tel and voluntary inline, found ' + matches.length);
    assert.match(appJs, /variant: 'partnerCrm14'/);
    assert.doesNotMatch(appJs, /type: 'laaDeclarationBlock', variant: 'adviceAssistance'/);
  });
});

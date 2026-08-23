/* ═══════════════════════════════════════════════
   LAA FORM GENERATION — CRM1, CRM2, CRM3, CRM14
   Replicates official LAA PDF form layouts.
   CRM1 v16 (Feb 2025), CRM2 v15 (Oct 2025),
   CRM3 v17 (Feb 2025), CRM14 v18.
   ═══════════════════════════════════════════════ */

(function (exports) {
  'use strict';

  var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  function addr(d) {
    return [d.address1, d.address2, d.address3, d.city, d.county].filter(Boolean).join(', ');
  }

  function fullName(d) {
    return [d.title, d.forename, d.middleName, d.surname].filter(Boolean).join(' ');
  }

  function fmtDate(val) {
    if (!val) return '';
    var s = String(val).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return s;
  }

  function tick(condition) {
    return condition ? '\u2611' : '\u2610';
  }

  /** Checkbox span that prints as a square box (empty or ticked) to match official forms */
  function box(condition) {
    return '<span class="laa-cb' + (condition ? ' laa-cb-ticked' : '') + '" aria-hidden="true">' + (condition ? '\u2713' : '') + '</span>';
  }

  /** Single field row: label left, value in bordered box (matches official paper form layout) */
  function frow(label, value) {
    var v = value ? esc(String(value)) : '';
    return '<div class="laa-frow">' +
      '<span class="laa-flabel">' + esc(label) + '</span>' +
      '<span class="laa-fbox">' + (v || '') + '</span>' +
    '</div>';
  }

  function frowAlways(label, value) {
    var v = value ? esc(String(value)) : '';
    return '<div class="laa-frow">' +
      '<span class="laa-flabel">' + esc(label) + '</span>' +
      '<span class="laa-fbox">' + (v || '') + '</span>' +
    '</div>';
  }

  /** Two fields side by side (e.g. NI no | Date of birth) */
  function frow2(label1, value1, label2, value2) {
    var v1 = value1 ? esc(String(value1)) : '';
    var v2 = value2 ? esc(String(value2)) : '';
    return '<div class="laa-frow laa-frow-two">' +
      '<span class="laa-flabel">' + esc(label1) + '</span><span class="laa-fbox">' + (v1 || '') + '</span>' +
      '<span class="laa-flabel">' + esc(label2) + '</span><span class="laa-fbox">' + (v2 || '') + '</span>' +
    '</div>';
  }

  /** Page wrapper for print: use with laa-pg-footer for "-- 1 of 8 --" style */
  function pgWrap(content, pageNum, totalPages, formCode, version) {
    return '<div class="laa-pg" style="page-break-after:always;">' + content +
      '<div class="laa-pg-footer">' +
        '<span>' + esc(formCode + ' ' + version) + '</span>' +
        '<span class="laa-crown">\u00A9 Crown Copyright</span>' +
        '<span class="laa-pg-num">\u2014 ' + pageNum + ' of ' + totalPages + ' \u2014</span>' +
      '</div></div>';
  }

  /* ─── Shared CSS: print-identical to official LAA forms ─── */
  var CSS = '<style>' +
    '@page{size:A4;margin:15mm;}' +
    'body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;margin:0;padding:0;line-height:1.25;}' +
    '.laa-page{padding:0 12mm 10mm;position:relative;min-height:270mm;box-sizing:border-box;}' +
    '.laa-official{position:absolute;top:6px;right:12px;font-size:8pt;font-weight:700;color:#000;letter-spacing:0.5px;}' +
    '.laa-hdr{background:#1d70b8;color:#fff;padding:6px 12px;margin:0 -12mm 0 -12mm;margin-bottom:0;}' +
    '.laa-hdr-title{font-size:18pt;font-weight:700;letter-spacing:0;}' +
    '.laa-hdr-sub{font-size:10pt;margin-top:1px;font-weight:400;}' +
    '.laa-form-ref{background:#f3f2f1;border:1px solid #0b0c0c;padding:3px 10px;font-size:9pt;font-weight:700;color:#0b0c0c;display:flex;justify-content:space-between;margin:6px 0 8px;}' +
    '.laa-instruction{font-size:9pt;color:#0b0c0c;background:#f3f2f1;border-left:4px solid #1d70b8;padding:5px 10px;margin:0 0 8px;}' +
    '.laa-note{font-size:9pt;color:#0b0c0c;margin:4px 0;font-style:italic;}' +
    '.laa-section{margin:10px 0 4px;background:#1d70b8;color:#fff;padding:4px 10px;font-size:11pt;font-weight:700;}' +
    '.laa-section-grey{margin:8px 0 2px;background:#f3f2f1;border:1px solid #0b0c0c;padding:4px 8px;font-size:10pt;font-weight:700;color:#0b0c0c;}' +
    '.laa-frow{display:flex;align-items:stretch;margin-bottom:2px;}' +
    '.laa-flabel{width:180px;flex-shrink:0;font-size:10pt;padding:4px 8px 4px 0;border:0;}' +
    '.laa-fbox{flex:1;border:1px solid #0b0c0c;min-height:22px;padding:3px 6px;font-size:10pt;background:#fff;}' +
    '.laa-frow-two{display:flex;flex-wrap:wrap;}' +
    '.laa-frow-two .laa-flabel{width:140px;}.laa-frow-two .laa-fbox{width:calc(50% - 150px);min-width:100px;}' +
    '.laa-cb{display:inline-block;width:11px;height:11px;border:1.5px solid #0b0c0c;vertical-align:middle;margin-right:4px;text-align:center;line-height:10px;font-size:9pt;font-weight:700;}' +
    '.laa-cb-ticked{background:#0b0c0c;color:#fff;}' +
    'table.lf{width:100%;border-collapse:collapse;margin-bottom:6px;border:1px solid #0b0c0c;font-size:10pt;}' +
    'table.lf td,table.lf th{padding:3px 6px;border:1px solid #0b0c0c;vertical-align:top;}' +
    'table.lf .lf-label{width:32%;font-weight:700;background:#f3f2f1;}' +
    'table.lf .lf-value{width:68%;min-height:20px;}' +
    'table.lf .lf-full{font-weight:700;background:#f3f2f1;}' +
    '.lf-row2{display:flex;gap:8px;}' +
    '.lf-row2 table.lf{flex:1;}' +
    '.lf-tick{font-size:11pt;vertical-align:middle;margin-right:2px;}' +
    '.lf-tick-row{margin:2px 0;font-size:10pt;}' +
    '.lf-decl{border:1px solid #0b0c0c;padding:8px;margin:8px 0;font-size:9pt;line-height:1.4;}' +
    '.lf-decl p{margin:3px 0;}' +
    '.lf-sig-row{display:flex;gap:12px;margin:10px 0;}' +
    '.lf-sig-box{flex:1;border:1px solid #0b0c0c;padding:4px 8px;min-height:40px;}' +
    '.lf-sig-label{font-size:8pt;color:#0b0c0c;font-weight:700;margin-bottom:2px;text-transform:uppercase;}' +
    '.lf-sig-img{max-width:180px;max-height:40px;display:block;}' +
    '.lf-footer,.laa-pg-footer{display:flex;justify-content:space-between;align-items:center;font-size:8pt;color:#0b0c0c;border-top:1px solid #0b0c0c;padding-top:4px;margin-top:10px;}' +
    '.laa-pg-num{font-weight:700;}' +
    '.lf-crown,.laa-crown{font-size:8pt;}' +
    '.lf-privacy{font-size:8pt;line-height:1.35;margin-top:10px;page-break-before:always;}' +
    '.lf-privacy h3{font-size:10pt;font-weight:700;margin:8px 0 2px;}' +
    '.lf-privacy h4{font-size:9pt;font-weight:700;margin:6px 0 2px;}' +
    '.lf-privacy p,.lf-privacy li{margin:2px 0;}' +
    '.lf-privacy ul{margin:2px 0 2px 14px;padding:0;}' +
    '.lf-empty{color:#666;font-style:italic;}' +
    '@media print{body{font-size:10pt;}.laa-pg{page-break-after:always;}.laa-pg:last-of-type{page-break-after:auto;}.lf-section-copy,.lf-copy-all,.laa-noprint{display:none !important;}.lf-privacy{page-break-before:always;} .laa-cb{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
    '.lf-section-copy{display:inline-block;margin-left:8px;font-size:9px;background:#e0e7ff;color:#3730a3;padding:1px 6px;border-radius:3px;cursor:pointer;border:1px solid #c7d2fe;font-weight:600;}' +
    '.lf-section-copy:hover{background:#c7d2fe;}' +
    '.lf-copy-all{display:inline-block;margin:8px 0;padding:4px 12px;background:#1d70b8;color:#fff;border-radius:4px;cursor:pointer;font-size:10px;font-weight:700;border:none;}' +
    '.lf-copy-all:hover{background:#003078;}' +
    '</style>';

  function pageHeader(formCode, formTitle, version) {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>' + esc(formCode + ' — ' + formTitle) + '</title>' + CSS + '</head><body>' +
      '<div class="laa-page">' +
      '<div class="laa-official">OFFICIAL</div>' +
      '<div class="laa-hdr"><div class="laa-hdr-title">' + esc(formCode) + '</div><div class="laa-hdr-sub">' + esc(formTitle) + '</div></div>' +
      '<div class="laa-form-ref"><span>Page 1</span><span>' + esc(formCode + ' ' + version) + '</span></div>';
  }

  function pageFooter(formCode, version) {
    return '<div class="lf-footer"><span>' + esc(formCode + ' ' + version) + '</span><span class="lf-crown">\u00A9 Crown Copyright</span><span>Generated by Custody Note \u2014 ' + new Date().toLocaleDateString('en-GB') + '</span></div>';
  }

  function formEnd(formCode, version) {
    return pageFooter(formCode, version) + '</div></body></html>';
  }

  function row(label, value) {
    var v = value ? esc(String(value)) : '';
    return '<tr><td class="lf-label">' + esc(label) + '</td><td class="lf-value">' + (v || '<span class="lf-empty"></span>') + '</td></tr>';
  }

  function rowAlways(label, value) {
    var v = value ? esc(String(value)) : '<span class="lf-empty">(not provided)</span>';
    return '<tr><td class="lf-label">' + esc(label) + '</td><td class="lf-value">' + v + '</td></tr>';
  }

  function headerRow(text) {
    return '<tr><td class="lf-full" colspan="2">' + esc(text) + '</td></tr>';
  }

  function sigBlock(label, sigKey, d) {
    var img = d[sigKey] ? '<img class="lf-sig-img" src="' + d[sigKey] + '">' : '';
    return '<div class="lf-sig-box"><div class="lf-sig-label">' + esc(label) + '</div>' + img + '</div>';
  }

  function privacyNotice() {
    return '<div class="lf-privacy">' +
      '<h3>LEGAL AID AGENCY &mdash; PRIVACY NOTICE</h3>' +
      '<h4>Purpose</h4>' +
      '<p>This privacy notice sets out the standards that you can expect from the Legal Aid Agency (LAA) when we request or hold personal information (\u2018personal data\u2019) about you.</p>' +
      '<p>The LAA is an Executive Agency of the Ministry of Justice (MoJ). The MoJ is the data controller for the personal information we hold. The LAA collects and processes personal data for the exercise of its own and associated public functions. Our public function is to provide legal aid.</p>' +
      '<h4>Purpose of processing</h4>' +
      '<p>The purpose of collecting and processing your personal data is for providing legal aid. Our lawful basis is \u2018the performance of a task carried out in the public interest\u2019 as set out in Article 6(1)(e) of UK GDPR. We will use this data for:</p>' +
      '<ul>' +
      '<li>Deciding whether you are eligible for legal aid and assessing contributions.</li>' +
      '<li>Assessing claims from your legal aid Provider(s) for payment.</li>' +
      '<li>Conducting periodic assurance audits on legal aid files.</li>' +
      '<li>Producing statistics to improve our processes.</li>' +
      '</ul>' +
      '<h4>Who information may be shared with</h4>' +
      '<p>Your instructed legal aid Provider(s); public authorities (HMCTS, HMRC, DWP, Home Office, HM Land Registry); credit reference agencies (Equifax, TransUnion); debt collection partners (Advantis Credit Ltd); fraud prevention agencies where appropriate.</p>' +
      '<h4>Your rights</h4>' +
      '<p>You can withdraw consent; lodge a complaint with the supervisory authority; request access to, correction of, or erasure of your personal data.</p>' +
      '<p>Contact: The Data Protection Officer, Ministry of Justice, 102 Petty France, London SW1H 9AJ. dataprotection@justice.gov.uk</p>' +
      '<p>Complaints: Information Commissioner\u2019s Office, Wycliffe House, Water Lane, Wilmslow, Cheshire SK9 5AF. Tel: 0303 123 1113. www.ico.org.uk</p>' +
      '</div>';
  }

  /* ═══════════════════════════════════════════════
     CRM1: CLIENT'S DETAILS FORM (v16, Feb 2025)
     Official layout: 8 pages
     ═══════════════════════════════════════════════ */
  function buildCRM1(d, settings) {
    return buildCRM1Strict(d, settings);
  }

  function buildCRM1Strict(d, settings) {
    function cb(on, label) {
      return '<span class="laa-cb' + (on ? ' laa-cb-ticked' : '') + '">' + (on ? '&#10003;' : '') + '</span>' + esc(label);
    }

    function money(v) {
      return (v === 0 || v) ? String(v) : '';
    }

    var ms = d.maritalStatus || '';
    var g = d.gender || '';
    var eth = d.ethnicOriginCode || '';
    var dis = d.disabilityCode || '';
    var under18 = d.juvenileVulnerable === 'Juvenile';
    var onBenefit = d.passportedBenefit === 'Yes' || d.benefits === 'Yes';

    var css = '<style>' +
      '@page{size:A4;margin:15mm;}' +
      'body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;margin:0;padding:0;line-height:1.25;}' +
      '.crm1-page{padding:0 10mm 10mm;position:relative;min-height:270mm;box-sizing:border-box;}' +
      '.crm1-official{position:absolute;top:0;right:0;font-size:8pt;font-weight:700;}' +
      '.crm1-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:6px;}' +
      '.crm1-code{font-size:20pt;font-weight:700;letter-spacing:0.5px;}' +
      '.crm1-title{font-size:12pt;font-weight:700;}' +
      '.crm1-sub{font-size:9pt;margin-top:1px;}' +
      '.crm1-rule{border-top:1px solid #000;margin:6px 0;}' +
      '.crm1-grid{width:100%;border-collapse:collapse;font-size:10pt;}' +
      '.crm1-grid td,.crm1-grid th{border:1px solid #000;padding:4px 6px;vertical-align:top;}' +
      '.crm1-lbl{background:#f3f2f1;font-weight:700;width:34%;}' +
      '.crm1-box{min-height:18px;}' +
      '.crm1-row{margin:3px 0;}' +
      '.crm1-sec{font-size:11pt;font-weight:700;margin:10px 0 4px;}' +
      '.crm1-note{font-size:9pt;margin:4px 0;}' +
      '.crm1-tickline{line-height:1.7;margin:2px 0;}' +
      '.crm1-footer{display:flex;justify-content:space-between;align-items:center;font-size:8pt;border-top:1px solid #000;padding-top:4px;margin-top:10px;}' +
      '.crm1-pg{font-weight:700;}' +
      '.laa-cb{display:inline-block;width:11px;height:11px;border:1.5px solid #0b0c0c;vertical-align:middle;margin-right:4px;text-align:center;line-height:10px;font-size:9pt;font-weight:700;}' +
      '.laa-cb-ticked{background:#0b0c0c;color:#fff;}' +
      '.crm1-privacy h3{font-size:10pt;margin:8px 0 3px;}' +
      '.crm1-privacy p,.crm1-privacy li{font-size:9pt;line-height:1.35;margin:2px 0;}' +
      '.crm1-privacy ul{margin:3px 0 3px 15px;padding:0;}' +
      '@media print{.crm1-page{page-break-after:always;}.crm1-page:last-of-type{page-break-after:auto;}.laa-cb{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
      '</style>';

    function header(pageNum) {
      return '<div class="crm1-page">' +
        '<div class="crm1-official">OFFICIAL</div>' +
        '<div class="crm1-head">' +
          '<div><div class="crm1-code">CRM1</div><div class="crm1-title">Client\'s Details Form</div></div>' +
          '<div class="crm1-sub">Please complete in block capitals</div>' +
        '</div>' +
        '<div class="crm1-rule"></div>' +
        '<div class="crm1-row"><strong>UFN:</strong> ' + esc(d.ufn || '') + '</div>';
    }

    function footer(pageNum) {
      return '<div class="crm1-footer">' +
        '<span>CRM1 Version 16 February 2025</span>' +
        '<span>&copy; Crown Copyright</span>' +
        '<span class="crm1-pg">&mdash; ' + pageNum + ' of 8 &mdash;</span>' +
      '</div></div>';
    }

    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>CRM1 Version 16 February 2025</title>' + css + '</head><body>';

    html += header(1);
    html += '<div class="crm1-sec">Client\'s details</div>';
    html += '<table class="crm1-grid">' +
      '<tr><td class="crm1-lbl">Surname</td><td class="crm1-box">' + esc(d.surname || '') + '</td></tr>' +
      '<tr><td class="crm1-lbl">First name</td><td class="crm1-box">' + esc(d.forename || '') + '</td></tr>' +
      '<tr><td class="crm1-lbl">National Insurance no</td><td class="crm1-box">' + esc(d.niNumber || '') + ' &nbsp;&nbsp;&nbsp; <strong>Date of birth:</strong> ' + esc(fmtDate(d.dob) || '') + '</td></tr>' +
      '<tr><td class="crm1-lbl">Current address</td><td class="crm1-box">' + esc(addr(d) || '') + '</td></tr>' +
      '<tr><td class="crm1-lbl">Postcode</td><td class="crm1-box">' + esc(d.postCode || '') + '</td></tr>' +
    '</table>';
    html += '<div class="crm1-sec">Marital status</div>' +
      '<div class="crm1-tickline">' +
      cb(ms === 'Married' || ms === 'Civil Partner' || ms === 'Married/Civil Partner', 'Married/Civil Partner') + ' &nbsp; ' +
      cb(ms === 'Single', 'Single') + ' &nbsp; ' +
      cb(ms === 'Separated', 'Separated') + ' &nbsp; ' +
      cb(ms === 'Divorced' || ms === 'Divorced/dissolved CP', 'Divorced/dissolved CP') + ' &nbsp; ' +
      cb(ms === 'Cohabiting', 'Cohabiting') + ' &nbsp; ' +
      cb(ms === 'Widowed', 'Widowed') +
      '</div>';
    html += '<div class="crm1-sec">Gender</div>' +
      '<div class="crm1-tickline">' +
      cb(g === 'Male', 'Male') + ' &nbsp; ' +
      cb(g === 'Female', 'Female') + ' &nbsp; ' +
      cb(g === 'Prefer not to say', 'Prefer not to say') +
      '</div>';
    html += footer(1);

    html += header(2);
    html += '<div class="crm1-privacy">' +
      '<h3>LEGAL AID AGENCY PRIVACY NOTICE</h3>' +
      '<h3>Purpose</h3>' +
      '<p>This privacy notice sets out the standards that you can expect from the Legal Aid Agency (LAA) when we request or hold personal information (&ldquo;personal data&rdquo;) about you; how you can get access to a copy of your personal data; and what you can do if you think the standards are not being met.</p>' +
      '<p>The LAA is an Executive Agency of the Ministry of Justice (MoJ). The MoJ is the data controller for the personal information we hold. The LAA collects and processes personal data for the exercise of its own and associated public functions. Our public function is to provide legal aid.</p>' +
      '<h3>About personal information</h3>' +
      '<p>Personal data is information about you as an individual. It can be your name, address or telephone number. It can also include the information that you have provided in a legal aid application such as your financial circumstances and information relating to any current or previous legal proceedings concerning you.</p>' +
      '<p>We know how important it is to protect customers&rsquo; privacy and to comply with data protection laws. We will safeguard your personal data and will only disclose it where it is lawful to do so, or with your consent.</p>' +
      '<h3>Types of personal data we process</h3>' +
      '<p>We only process personal data that is relevant for the services we are providing to you. The personal data which you have provided in your legal aid application will only be used for the purposes set out below.</p>' +
      '<h3>Purpose of processing and the lawful basis for the process</h3>' +
      '<p>The purpose of collecting and processing the personal data which you have provided in a legal aid application is for the purposes of providing legal aid. Our lawful basis is Article 6(1)(e) UK GDPR &mdash; the performance of a task carried out in the public interest or in the exercise of official authority.</p>' +
    '</div>';
    html += footer(2);

    html += header(3);
    html += '<div class="crm1-privacy">' +
      '<p>Specifically, we will use this personal data in the following ways:</p>' +
      '<ul>' +
      '<li>Deciding whether you are eligible for legal aid and whether you are required to make a contribution.</li>' +
      '<li>Assessing claims from your legal aid Provider(s) for payment from the legal aid fund.</li>' +
      '<li>Conducting periodic assurance audits on legal aid files.</li>' +
      '<li>Producing statistics and information on our processes.</li>' +
      '</ul>' +
      '<p>Were the LAA unable to collect this personal information, we would not be able to conduct the activities above, which would prevent us from providing legal aid.</p>' +
      '<p>We collect special categories of personal data where necessary for these purposes and for equality monitoring obligations.</p>' +
      '<h3>Who the information may be shared with</h3>' +
      '<p>We sometimes need to share personal information with other organisations and will comply with data protection law when doing so, including legal aid providers, HMCTS, HMRC, DWP, Home Office, HM Land Registry, credit reference agencies, and debt collection partners where lawful.</p>' +
      '<h3>Data processors</h3>' +
      '<p>We may contract with third party data processors to provide email, system administration, document management and IT storage services.</p>' +
    '</div>';
    html += footer(3);

    html += header(4);
    html += '<div class="crm1-privacy">' +
      '<h3>Automated decision making</h3>' +
      '<p>We do not use solely automated decision making within the meaning of Article 22(1) UK GDPR. A human decision maker always makes the final legal aid decision.</p>' +
      '<h3>Retention period</h3>' +
      '<p>Your personal information will not be retained for any longer than necessary for the lawful purposes for which it has been collected and processed.</p>' +
      '<h3>Access to personal information</h3>' +
      '<p>You can find out if we hold personal data about you by making a subject access request to the Ministry of Justice Disclosure Team.</p>' +
      '<h3>When we ask you for personal data</h3>' +
      '<p>We will explain why we need your personal data and ask only for relevant information. You have rights including requesting correction, restriction or erasure (where lawful), and lodging a complaint with the supervisory authority.</p>' +
      '<h3>Complaints</h3>' +
      '<p>If you consider your information has been handled incorrectly, you can contact the Information Commissioner&rsquo;s Office (ICO).</p>' +
    '</div>';
    html += footer(4);

    html += header(5);
    html += '<div class="crm1-privacy">' +
      '<p><strong>Data Protection Officer:</strong> Ministry of Justice, 102 Petty France, London, SW1H 9AJ.</p>' +
      '<p><strong>Email:</strong> dataprotection@justice.gov.uk</p>' +
      '<p><strong>ICO:</strong> Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF. Tel: 0303 123 1113. www.ico.org.uk</p>' +
      '<p>This page intentionally mirrors the official privacy notice continuation page.</p>' +
    '</div>';
    html += footer(5);

    html += header(6);
    html += '<div class="crm1-sec">Equal Opportunities Monitoring</div>' +
      '<div class="crm1-note">Completion of this section is voluntary. This will be treated in the strictest confidence and used purely for statistical monitoring and research.</div>' +
      '<div class="crm1-sec">Ethnicity</div>' +
      '<div class="crm1-tickline">' +
      '<strong>White</strong>: ' + cb(eth === 'British' || eth === 'W1', 'British') + ' ' + cb(eth === 'Irish' || eth === 'W2', 'Irish') + ' ' + cb(eth === 'White Other' || eth === 'W9', 'White Other') + ' ' + cb(eth === 'Gypsy/Traveller', 'Gypsy/Traveller') +
      '</div>' +
      '<div class="crm1-tickline"><strong>Mixed</strong>: ' +
      cb(eth === 'White and Black Caribbean' || eth === 'M1', 'White and Black Caribbean') + ' ' +
      cb(eth === 'White and Black African' || eth === 'M2', 'White and Black African') + ' ' +
      cb(eth === 'White and Asian' || eth === 'M3', 'White and Asian') + ' ' +
      cb(eth === 'Mixed Other' || eth === 'M9', 'Mixed Other') +
      '</div>' +
      '<div class="crm1-tickline"><strong>Asian or Asian British</strong>: ' +
      cb(eth === 'Indian' || eth === 'A1', 'Indian') + ' ' +
      cb(eth === 'Pakistani' || eth === 'A2', 'Pakistani') + ' ' +
      cb(eth === 'Bangladeshi' || eth === 'A3', 'Bangladeshi') + ' ' +
      cb(eth === 'Asian Other' || eth === 'A9', 'Asian Other') +
      '</div>' +
      '<div class="crm1-tickline"><strong>Black or Black British</strong>: ' +
      cb(eth === 'Black Caribbean' || eth === 'B1', 'Black Caribbean') + ' ' +
      cb(eth === 'Black African' || eth === 'B2', 'Black African') + ' ' +
      cb(eth === 'Black Other' || eth === 'B9', 'Black Other') + ' ' +
      cb(eth === 'Prefer not to say', 'Prefer not to say') +
      '</div>' +
      '<div class="crm1-sec">Disability</div>' +
      '<div class="crm1-note">The Equality Act 2010 defines disability as a physical or mental impairment with substantial and long-term adverse effect on day-to-day activities.</div>' +
      '<div class="crm1-tickline">' +
      cb(dis === 'Not Considered Disabled' || dis === 'NCD', 'Not considered disabled') + ' ' +
      cb(dis === 'Visually impaired' || dis === 'VIS', 'Visually impaired') + ' ' +
      cb(dis === 'Long-standing physical illness' || dis === 'PHY', 'Long-standing physical illness') + ' ' +
      cb(dis === 'Other', 'Other') +
      '</div>' +
      '<div class="crm1-tickline">' +
      cb(dis === 'Unknown', 'Unknown') + ' ' +
      cb(dis === 'Prefer not to say', 'Prefer not to say') + ' ' +
      cb(dis === 'Mental health condition' || dis === 'MHC', 'Mental health condition') + ' ' +
      cb(dis === 'Learning disability/difficulty' || dis === 'LDD', 'Learning disability/difficulty') + ' ' +
      cb(dis === 'Mobility impairment' || dis === 'MOB', 'Mobility impairment') + ' ' +
      cb(dis === 'Deaf' || dis === 'DEA', 'Deaf') + ' ' +
      cb(dis === 'Hearing impaired' || dis === 'HEA', 'Hearing impaired') + ' ' +
      cb(dis === 'Blind' || dis === 'BLI', 'Blind') +
      '</div>';
    html += footer(6);

    html += header(7);
    html += '<div class="crm1-sec">Income details</div>' +
      '<div class="crm1-note">This page must be completed in full where freestanding Advice and Assistance is sought in any Class of Work (except Police Station Advice and Assistance / warrants / armed forces custody hearings / Duty Solicitor advice) or where Advocacy Assistance is sought in Prison Law only.</div>' +
      '<div class="crm1-tickline"><strong>1. Is your client aged under 18 at the time of completing this form?</strong> ' +
      cb(under18, 'Yes. Ignore the rest of this page') + ' ' +
      cb(!under18, 'No. Move to question 2') +
      '</div>' +
      '<div class="crm1-tickline"><strong>2. Does your client or partner get Income Support / Income-based JSA / Income-related ESA / Guarantee State Pension Credit / Universal Credit?</strong> ' +
      cb(onBenefit, 'Yes. Ignore the rest of this section') + ' ' +
      cb(!onBenefit, 'No. Complete weekly income') +
      '</div>' +
      '<table class="crm1-grid">' +
      '<tr><td class="crm1-lbl">The client (£)</td><td class="crm1-box">' + esc(money(d.grossIncome)) + '</td></tr>' +
      '<tr><td class="crm1-lbl">The client\'s partner (£)</td><td class="crm1-box">' + esc(money(d.partnerIncome)) + '</td></tr>' +
      '<tr><td class="crm1-lbl">Total (£)</td><td class="crm1-box"></td></tr>' +
      '<tr><td class="crm1-lbl">Income tax deductions (£)</td><td class="crm1-box"></td></tr>' +
      '<tr><td class="crm1-lbl">National Insurance contributions (£)</td><td class="crm1-box"></td></tr>' +
      '<tr><td class="crm1-lbl">Other allowable deductions (£)</td><td class="crm1-box"></td></tr>' +
      '<tr><td class="crm1-lbl">Total weekly disposable income (£)</td><td class="crm1-box"></td></tr>' +
    '</table>';
    html += footer(7);

    html += header(8);
    html += '<div class="crm1-sec">Capital details</div>' +
      '<table class="crm1-grid">' +
      '<tr><td class="crm1-lbl">How many dependants does your client have?</td><td class="crm1-box">' + esc(d.dependants || '') + '</td></tr>' +
      '<tr><td class="crm1-lbl">The client: £</td><td class="crm1-box">' + esc(money(d.capitalClient)) + '</td></tr>' +
      '<tr><td class="crm1-lbl">Partner: £</td><td class="crm1-box">' + esc(money(d.capitalPartner)) + '</td></tr>' +
      '<tr><td class="crm1-lbl">Total: £</td><td class="crm1-box">' + esc(money(d.capitalTotal)) + '</td></tr>' +
    '</table>' +
      '<div class="crm1-sec">Dependants</div>' +
      '<table class="crm1-grid">' +
      '<tr><th>Name</th><th>Dependent children and other dependants</th><th>Age</th></tr>' +
      '<tr><td class="crm1-box">&nbsp;</td><td class="crm1-box">15 or under</td><td class="crm1-box">&nbsp;</td></tr>' +
      '<tr><td class="crm1-box">&nbsp;</td><td class="crm1-box">16 or over</td><td class="crm1-box">&nbsp;</td></tr>' +
    '</table>' +
      '<div class="crm1-note">CRM1 Page 8 Version 16 February 2025 &copy; Crown Copyright</div>';
    html += footer(8);

    html += '</body></html>';
    return html;
  }

  /* ═══════════════════════════════════════════════
     CRM2: ADVICE & ASSISTANCE (v15, Oct 2025)
     Official layout: 6 pages
     ═══════════════════════════════════════════════ */
  function buildCRM2(d, settings) {
    return buildCRM2Strict(d, settings);
  }

  function buildCRM2Strict(d, settings) {
    function cb(on, label) {
      return '<span class="laa-cb' + (on ? ' laa-cb-ticked' : '') + '">' + (on ? '&#10003;' : '') + '</span>' + esc(label);
    }

    var previousAdvice = d.previousAdvice === 'Yes';
    var wt = d.workType || '';
    var justified = [];
    if (d.travelledToClient === 'Yes') justified.push('Travelled out of office to visit client.');
    if (d.childOrPatient === 'Yes' || d.juvenileVulnerable === 'Juvenile') justified.push('Application accepted from child/patient or representative.');
    if (previousAdvice) justified.push('Advice/assistance provided within 6 months on same matter.');
    if (d.telephoneAdviceGiven === 'Yes') justified.push('Telephone advice before signature.');
    if (d.postalApplication === 'Yes') justified.push('Postal application accepted.');
    if (d.crm2JustificationNotes) justified.push(d.crm2JustificationNotes);

    var css = '<style>' +
      '@page{size:A4;margin:15mm;}' +
      'body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;margin:0;padding:0;line-height:1.25;}' +
      '.crm2-page{padding:0 10mm 10mm;position:relative;min-height:270mm;box-sizing:border-box;}' +
      '.crm2-official{position:absolute;top:0;right:0;font-size:8pt;font-weight:700;}' +
      '.crm2-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:6px;}' +
      '.crm2-code{font-size:20pt;font-weight:700;letter-spacing:0.5px;}' +
      '.crm2-title{font-size:12pt;font-weight:700;}' +
      '.crm2-sub{font-size:9pt;margin-top:1px;}' +
      '.crm2-rule{border-top:1px solid #000;margin:6px 0;}' +
      '.crm2-grid{width:100%;border-collapse:collapse;font-size:10pt;}' +
      '.crm2-grid td,.crm2-grid th{border:1px solid #000;padding:4px 6px;vertical-align:top;}' +
      '.crm2-lbl{background:#f3f2f1;font-weight:700;width:36%;}' +
      '.crm2-box{min-height:18px;}' +
      '.crm2-row{margin:3px 0;}' +
      '.crm2-sec{font-size:11pt;font-weight:700;margin:10px 0 4px;}' +
      '.crm2-note{font-size:9pt;margin:4px 0;}' +
      '.crm2-tickline{line-height:1.7;margin:2px 0;}' +
      '.crm2-footer{display:flex;justify-content:space-between;align-items:center;font-size:8pt;border-top:1px solid #000;padding-top:4px;margin-top:10px;}' +
      '.crm2-pg{font-weight:700;}' +
      '.laa-cb{display:inline-block;width:11px;height:11px;border:1.5px solid #0b0c0c;vertical-align:middle;margin-right:4px;text-align:center;line-height:10px;font-size:9pt;font-weight:700;}' +
      '.laa-cb-ticked{background:#0b0c0c;color:#fff;}' +
      '.crm2-privacy h3{font-size:10pt;margin:8px 0 3px;}' +
      '.crm2-privacy p,.crm2-privacy li{font-size:9pt;line-height:1.35;margin:2px 0;}' +
      '.crm2-privacy ul{margin:3px 0 3px 15px;padding:0;}' +
      '@media print{.crm2-page{page-break-after:always;}.crm2-page:last-of-type{page-break-after:auto;}.laa-cb{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
      '</style>';

    function header(pageNum) {
      return '<div class="crm2-page">' +
        '<div class="crm2-official">OFFICIAL</div>' +
        '<div class="crm2-head">' +
          '<div><div class="crm2-code">CRM2</div><div class="crm2-title">Application for Advice and Assistance</div></div>' +
          '<div class="crm2-sub">Page ' + pageNum + ' &nbsp; CRM2 Version 15 October 2025</div>' +
        '</div>' +
        '<div class="crm2-rule"></div>';
    }

    function footer(pageNum) {
      return '<div class="crm2-footer">' +
        '<span>CRM2 Version 15 October 2025</span>' +
        '<span>&copy; Crown Copyright</span>' +
        '<span class="crm2-pg">&mdash; ' + pageNum + ' of 6 &mdash;</span>' +
      '</div></div>';
    }

    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>CRM2 Version 15 October 2025</title>' + css + '</head><body>';

    /* Page 1: Client declaration */
    html += header(1);
    html += '<div class="crm2-note">Please complete in block capitals and ensure that form CRM1 is also completed</div>';
    html += '<div class="crm2-sec">Client\'s Declaration</div>';
    html += '<div class="crm2-note">Please tick the box below which applies to you:</div>';
    html += '<div class="crm2-tickline">' + cb(!previousAdvice, 'I have not already received advice and assistance from a solicitor or contracted provider on this matter.') + '</div>';
    html += '<div class="crm2-tickline">' + cb(previousAdvice, 'I have already received advice and assistance from a solicitor or contracted provider on this matter. If so, please state when:') + ' ' + esc(d.previousAdviceDate || '') + '</div>';
    html += '<div class="crm2-note">As far as I know all the information I have given is true and I have not withheld any relevant information.</div>';
    html += '<div class="crm2-note">I understand that if I give false information the services provided to me may be cancelled and I may be prosecuted.</div>';
    html += '<table class="crm2-grid">' +
      '<tr><td class="crm2-lbl">Signed</td><td class="crm2-box">' + (d.clientSig ? '<img class="lf-sig-img" src="' + d.clientSig + '">' : '') + '</td><td class="crm2-lbl">Date</td><td class="crm2-box">' + esc(fmtDate(d.laaSignatureDate) || fmtDate(d.date) || '') + '</td></tr>' +
      '<tr><td class="crm2-lbl">I confirm that form CRM1 has been completed and the information contained therein is correct.</td><td class="crm2-box" colspan="3">' + cb(true, '') + '</td></tr>' +
      '<tr><td class="crm2-lbl">And name of previous firm if known</td><td class="crm2-box" colspan="3">' + esc(d.previousFirmName || '') + '</td></tr>' +
    '</table>';
    html += footer(1);

    /* Page 2: privacy notice start */
    html += header(2);
    html += '<div class="crm2-privacy">' +
      '<h3>LEGAL AID AGENCY PRIVACY NOTICE</h3>' +
      '<h3>Purpose</h3>' +
      '<p>This privacy notice sets out the standards that you can expect from the Legal Aid Agency (LAA) when we request or hold personal information (&ldquo;personal data&rdquo;) about you; how you can get access to a copy of your personal data; and what you can do if you think the standards are not being met.</p>' +
      '<p>The LAA is an Executive Agency of the Ministry of Justice (MoJ). The MoJ is the data controller for the personal information we hold. The LAA collects and processes personal data for the exercise of its own and associated public functions. Our public function is to provide legal aid.</p>' +
      '<h3>About personal information</h3>' +
      '<p>Personal data is information about you as an individual. It can be your name, address or telephone number. It can also include the information that you have provided in a legal aid application such as your financial circumstances and information relating to any current or previous legal proceedings concerning you.</p>' +
      '<h3>Types of personal data we process</h3>' +
      '<p>We only process personal data that is relevant for the services we are providing to you. The personal data which you have provided in your legal aid application will only be used for the purposes set out below.</p>' +
    '</div>';
    html += footer(2);

    /* Page 3: privacy continuation */
    html += header(3);
    html += '<div class="crm2-privacy">' +
      '<h3>Purpose of processing and lawful basis</h3>' +
      '<p>The purpose of collecting and processing your personal data is for providing legal aid. Our lawful basis is Article 6(1)(e) UK GDPR.</p>' +
      '<ul>' +
      '<li>Deciding legal aid eligibility and contributions.</li>' +
      '<li>Assessing provider payment claims.</li>' +
      '<li>Conducting assurance audits.</li>' +
      '<li>Producing operational statistics.</li>' +
      '</ul>' +
      '<h3>Who the information may be shared with</h3>' +
      '<p>Where necessary and lawful, we may share data with legal aid providers, HMCTS, HMRC, DWP, Home Office, HM Land Registry, credit reference agencies, fraud prevention agencies, and debt collection partners.</p>' +
      '<h3>Data processors</h3>' +
      '<p>We may contract with third-party processors for email, system administration, document management and secure IT storage.</p>' +
    '</div>';
    html += footer(3);

    /* Page 4: privacy continuation */
    html += header(4);
    html += '<div class="crm2-privacy">' +
      '<h3>Automated decision making</h3>' +
      '<p>We do not use solely automated decision making under Article 22(1) UK GDPR for legal aid decisions.</p>' +
      '<h3>Retention period</h3>' +
      '<p>Your personal data is retained only as long as necessary for lawful purposes, then securely deleted.</p>' +
      '<h3>Access to personal information</h3>' +
      '<p>You can make a subject access request to the Ministry of Justice Disclosure Team.</p>' +
      '<h3>When we ask you for personal data</h3>' +
      '<p>We ask only for relevant information and protect it from unauthorised access, misuse or disclosure.</p>' +
      '<h3>Complaints</h3>' +
      '<p>You can contact the Information Commissioner&rsquo;s Office for independent advice about data protection.</p>' +
    '</div>';
    html += footer(4);

    /* Page 5: privacy close */
    html += header(5);
    html += '<div class="crm2-privacy">' +
      '<p><strong>Data Protection Officer:</strong> Ministry of Justice, 102 Petty France, London, SW1H 9AJ.</p>' +
      '<p><strong>Email:</strong> dataprotection@justice.gov.uk</p>' +
      '<p><strong>ICO:</strong> Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF. Tel: 0303 123 1113. www.ico.org.uk</p>' +
    '</div>';
    html += footer(5);

    /* Page 6: Advice and Assistance */
    html += header(6);
    html += '<div class="crm2-sec">Advice and Assistance</div>';
    html += '<div class="crm2-sec">What is the current class of work?</div>';
    html += '<div class="crm2-tickline">' +
      cb(wt.indexOf('Criminal') >= 0 || wt.indexOf('Attendance') >= 0, 'Criminal Investigations') + ' &nbsp; ' +
      cb(wt.indexOf('CCRC') >= 0, 'CCRC') + ' &nbsp; ' +
      cb(wt.indexOf('Appeals') >= 0 || wt.indexOf('Review') >= 0, 'Appeals and Reviews') + ' &nbsp; ' +
      cb(wt.indexOf('Prison') >= 0, 'Prison Law') +
      '</div>';
    html += '<div class="crm2-sec">Tick the relevant box below if you have:</div>';
    html += '<div class="crm2-tickline">' + cb(d.travelledToClient === 'Yes', 'Travelled out of the office to visit the client, other than at court or in detention.') + '</div>';
    html += '<div class="crm2-tickline">' + cb(d.childOrPatient === 'Yes' || d.juvenileVulnerable === 'Juvenile', 'Accepted an application from a child or patient or someone on their behalf.') + '</div>';
    html += '<div class="crm2-tickline">' + cb(previousAdvice, 'Provided Advice and Assistance to a client who has already received it on the same matter within the last 6 months.') + '</div>';
    html += '<div class="crm2-tickline">' + cb(d.telephoneAdviceGiven === 'Yes', 'Given telephone advice before the signature of the form.') + '</div>';
    html += '<div class="crm2-tickline">' + cb(d.claimedOutwardTravelBeforeSignature === 'Yes', 'Claimed for outward travel before the signature of the form.') + '</div>';
    html += '<div class="crm2-tickline">' + cb(d.postalApplication === 'Yes', 'Accepted a postal application.') + '</div>';
    html += '<div class="crm2-note">If you have ticked any of the above boxes, please provide details of the circumstances justifying this in accordance with the relevant Rule in the Contract Specification:</div>';
    html += '<table class="crm2-grid"><tr><td class="crm2-box">' + esc(justified.join(' ') || '') + '</td></tr></table>';
    html += '<div class="crm2-tickline"><strong>Was an application for a Representation Order made in this matter?</strong> ' +
      cb(d.repOrderApplied === 'Yes', 'Yes') + ' ' + cb(d.repOrderApplied !== 'Yes', 'No') +
      '</div>';
    html += footer(6);

    html += '</body></html>';
    return html;
  }

  /* ═══════════════════════════════════════════════
     CRM3: ADVOCACY ASSISTANCE (v17, Feb 2025)
     Official layout: 7 pages
     ═══════════════════════════════════════════════ */
  function buildCRM3(d, settings) {
    return buildCRM3Strict(d, settings);
  }

  function buildCRM3Strict(d, settings) {
    var s = settings || {};
    function cb(on, label) {
      return '<span class="laa-cb' + (on ? ' laa-cb-ticked' : '') + '">' + (on ? '&#10003;' : '') + '</span>' + esc(label);
    }

    var reason = d.advocacyReason || '';
    var isDefending = d.outcomeDecision ? (d.outcomeDecision.indexOf('Charged') >= 0 || d.outcomeDecision.indexOf('Bail') >= 0) : true;

    var css = '<style>' +
      '@page{size:A4;margin:15mm;}' +
      'body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;margin:0;padding:0;line-height:1.25;}' +
      '.crm3-page{padding:0 10mm 10mm;position:relative;min-height:270mm;box-sizing:border-box;}' +
      '.crm3-official{position:absolute;top:0;right:0;font-size:8pt;font-weight:700;}' +
      '.crm3-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:6px;}' +
      '.crm3-code{font-size:20pt;font-weight:700;letter-spacing:0.5px;}' +
      '.crm3-title{font-size:12pt;font-weight:700;}' +
      '.crm3-sub{font-size:9pt;margin-top:1px;}' +
      '.crm3-rule{border-top:1px solid #000;margin:6px 0;}' +
      '.crm3-grid{width:100%;border-collapse:collapse;font-size:10pt;}' +
      '.crm3-grid td,.crm3-grid th{border:1px solid #000;padding:4px 6px;vertical-align:top;}' +
      '.crm3-lbl{background:#f3f2f1;font-weight:700;width:36%;}' +
      '.crm3-box{min-height:18px;}' +
      '.crm3-sec{font-size:11pt;font-weight:700;margin:10px 0 4px;}' +
      '.crm3-note{font-size:9pt;margin:4px 0;}' +
      '.crm3-tickline{line-height:1.7;margin:2px 0;}' +
      '.crm3-footer{display:flex;justify-content:space-between;align-items:center;font-size:8pt;border-top:1px solid #000;padding-top:4px;margin-top:10px;}' +
      '.crm3-pg{font-weight:700;}' +
      '.laa-cb{display:inline-block;width:11px;height:11px;border:1.5px solid #0b0c0c;vertical-align:middle;margin-right:4px;text-align:center;line-height:10px;font-size:9pt;font-weight:700;}' +
      '.laa-cb-ticked{background:#0b0c0c;color:#fff;}' +
      '.crm3-privacy h3{font-size:10pt;margin:8px 0 3px;}' +
      '.crm3-privacy p,.crm3-privacy li{font-size:9pt;line-height:1.35;margin:2px 0;}' +
      '.crm3-privacy ul{margin:3px 0 3px 15px;padding:0;}' +
      '@media print{.crm3-page{page-break-after:always;}.crm3-page:last-of-type{page-break-after:auto;}.laa-cb{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
      '</style>';

    function header(pageNum) {
      return '<div class="crm3-page">' +
        '<div class="crm3-official">OFFICIAL</div>' +
        '<div class="crm3-head">' +
          '<div><div class="crm3-code">CRM3</div><div class="crm3-title">Application for Advocacy Assistance</div></div>' +
          '<div class="crm3-sub">Page ' + pageNum + ' &nbsp; CRM3 Version 17 February 2025</div>' +
        '</div>' +
        '<div class="crm3-rule"></div>';
    }

    function footer(pageNum) {
      return '<div class="crm3-footer">' +
        '<span>CRM3 Version 17 February 2025</span>' +
        '<span>&copy; Crown Copyright</span>' +
        '<span class="crm3-pg">&mdash; ' + pageNum + ' of 7 &mdash;</span>' +
      '</div></div>';
    }

    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>CRM3 Version 17 February 2025</title>' + css + '</head><body>';

    /* Page 1 */
    html += header(1);
    html += '<div class="crm3-note">Please complete in block capitals and ensure that form CRM1 is also completed.</div>';
    html += '<div class="crm3-sec">Client\'s involvement</div>';
    html += '<div class="crm3-tickline"><strong>Is your client:</strong> ' +
      cb(isDefending, 'defending the case?') + ' ' +
      cb(!isDefending, 'bringing the case?') + ' ' +
      cb(d.clientInvolvedAnotherWay === 'Yes', 'involved in another way?') +
      '</div>';
    html += '<table class="crm3-grid">' +
      '<tr><td class="crm3-lbl">If involved in another way, give details</td><td class="crm3-box">' + esc(d.clientInvolvedDetails || '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Date first instructed by your client</td><td class="crm3-box">' + esc(fmtDate(d.date) || '') + '</td></tr>' +
    '</table>';

    html += '<div class="crm3-sec">Type of Proceedings</div>';
    html += '<div class="crm3-note">What is Advocacy Assistance for? Only Advocacy Assistance is available for the following proceedings:</div>';
    html += '<div class="crm3-tickline">' + cb(reason.indexOf('Disciplinary') >= 0, 'Representation at Disciplinary proceedings before the prison governor or Independent Adjudicator.') + '</div>';
    html += '<div class="crm3-tickline">' + cb(reason.indexOf('Parole') >= 0, 'Representation before the Parole Board.') + '</div>';
    html += '<div class="crm3-tickline">' + cb(reason.indexOf('Category A') >= 0, 'Representation at Category A Reviews.') + '</div>';
    html += '<div class="crm3-tickline">' + cb(reason.indexOf('Minimum Term') >= 0, 'Representation at Minimum Term Reviews.') + '</div>';
    html += '<div class="crm3-tickline">' + cb(reason.indexOf('Armed Forces') >= 0, 'Armed Forces Custody Hearings.') + '</div>';
    html += '<div class="crm3-note">For the following proceedings, please state on page 2 why Advocacy Assistance should be granted and why the duty solicitor scheme is not sufficient:</div>';
    html += '<div class="crm3-tickline">' + cb(reason.indexOf('bail') >= 0 || reason.indexOf('Bail') >= 0, 'Variation of Pre-charge bail conditions') + '</div>';
    html += '<div class="crm3-tickline">' + cb(reason.indexOf('Warrant') >= 0 || reason.indexOf('detention') >= 0 || reason.indexOf('Detention') >= 0, 'Warrant of Further Detention (Pre-charge)') + '</div>';

    html += '<div class="crm3-sec">Details of proceedings</div>';
    html += '<table class="crm3-grid">' +
      '<tr><td class="crm3-lbl">Name of court or venue</td><td class="crm3-box">' + esc(d.courtName || d.policeStationName || '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Date of next hearing</td><td class="crm3-box">' + esc(fmtDate(d.courtDate || d.bailDate) || '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Date action started</td><td class="crm3-box">' + esc(fmtDate(d.date) || '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Has any action started or is any about to start?</td><td class="crm3-box">' + cb(d.date, 'Yes') + ' ' + cb(!d.date, 'No') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Has counsel been instructed?</td><td class="crm3-box">' + cb(d.counselInstructed === 'Yes', 'Yes') + ' ' + cb(d.counselInstructed !== 'Yes', 'No') + '</td></tr>' +
    '</table>';
    html += footer(1);

    /* Page 2 */
    html += header(2);
    html += '<div class="crm3-sec">Statement of case</div>';
    html += '<div class="crm3-note">If you need more space, please attach a separate sheet to this form.</div>';
    html += '<div class="crm3-note">Give a brief description of the case and the issues involved and explain how the case satisfies the appropriate merits test set out in the Contract Specification.</div>';
    html += '<table class="crm3-grid"><tr><td class="crm3-box" style="min-height:180px;">' +
      esc((reason || '') + (d.caseSummary ? '\n\n' + d.caseSummary : '')) +
      '</td></tr></table>';
    html += footer(2);

    /* Pages 3-6 privacy */
    html += header(3);
    html += '<div class="crm3-privacy">' +
      '<h3>LEGAL AID AGENCY PRIVACY NOTICE</h3>' +
      '<h3>Purpose</h3>' +
      '<p>This privacy notice sets out the standards that you can expect from the Legal Aid Agency (LAA) when we request or hold personal information (&ldquo;personal data&rdquo;) about you; how you can get access to a copy of your personal data; and what you can do if you think the standards are not being met.</p>' +
      '<p>The LAA is an Executive Agency of the Ministry of Justice (MoJ). The MoJ is the data controller for the personal information we hold. The LAA collects and processes personal data for the exercise of its own and associated public functions. Our public function is to provide legal aid.</p>' +
      '<h3>About personal information</h3>' +
      '<p>Personal data is information about you as an individual. It can be your name, address or telephone number. It can also include information provided in a legal aid application including financial circumstances and legal proceedings details.</p>' +
      '<h3>Purpose of processing and lawful basis</h3>' +
      '<p>We process data for legal aid under Article 6(1)(e) UK GDPR.</p>' +
    '</div>';
    html += footer(3);

    html += header(4);
    html += '<div class="crm3-privacy">' +
      '<p>We may use data to determine legal aid eligibility, assess provider claims, perform audits, and improve operational processes.</p>' +
      '<h3>Who information may be shared with</h3>' +
      '<p>Where lawful, information may be shared with legal aid providers, public authorities, credit reference agencies, fraud prevention agencies and debt recovery partners.</p>' +
      '<h3>Data processors</h3>' +
      '<p>Third-party processors may be used for IT hosting, administration, document management and secure storage services.</p>' +
    '</div>';
    html += footer(4);

    html += header(5);
    html += '<div class="crm3-privacy">' +
      '<h3>Automated decision making</h3><p>Legal aid decisions are not solely automated.</p>' +
      '<h3>Retention period</h3><p>Personal data is retained only for lawful periods and then securely destroyed.</p>' +
      '<h3>Access requests</h3><p>Subject access requests can be made to the Ministry of Justice Disclosure Team.</p>' +
    '</div>';
    html += footer(5);

    html += header(6);
    html += '<div class="crm3-privacy">' +
      '<h3>When we ask you for personal data</h3>' +
      '<p>We collect only relevant data and protect it from unauthorised access or misuse.</p>' +
      '<h3>Complaints</h3>' +
      '<p>Data protection complaints can be made to the Information Commissioner&rsquo;s Office (ICO).</p>' +
      '<p><strong>Data Protection Officer:</strong> Ministry of Justice, 102 Petty France, London, SW1H 9AJ. dataprotection@justice.gov.uk</p>' +
    '</div>';
    html += footer(6);

    /* Page 7 Declaration and determination */
    html += header(7);
    html += '<div class="crm3-sec">Declaration and Determination</div>';
    html += '<div class="crm3-note">I confirm that the circumstances of this case justify the grant of Advocacy Assistance in accordance with the Contract Specification.</div>';
    html += '<table class="crm3-grid">' +
      '<tr><td class="crm3-lbl">Signed (Solicitor or Category Supervisor)</td><td class="crm3-box">' + (d.feeEarnerSig ? '<img class="lf-sig-img" src="' + d.feeEarnerSig + '">' : '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Dated</td><td class="crm3-box">' + esc(fmtDate(d.date) || '') + '</td></tr>' +
    '</table>';
    html += '<div class="crm3-sec">Solicitor\'s details</div>';
    html += '<table class="crm3-grid">' +
      '<tr><td class="crm3-lbl">Name of Solicitor or Fellow of the Institute of Legal Executives instructed</td><td class="crm3-box">' + esc(d.feeEarnerName || d.laaFeeEarnerFullName || s.feeEarnerName || '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Address</td><td class="crm3-box">' + esc(d.firmAddress || '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Postcode</td><td class="crm3-box">' + esc(d.firmPostcode || '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Telephone number</td><td class="crm3-box">' + esc(d.firmContactPhone || '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Solicitor\'s reference</td><td class="crm3-box">' + esc(d.ourFileNumber || d.fileReference || '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Provider number</td><td class="crm3-box">' + esc(s.firmLaaAccount || d.firmLaaAccount || '') + '</td></tr>' +
    '</table>';
    html += '<div class="crm3-sec">For Prison Law cases ONLY: Client\'s Declaration</div>' +
      '<div class="crm3-note">I confirm that form CRM1 has been completed with details of my means and the information I have given is correct.</div>' +
      '<div class="crm3-note">I understand that if I give false information the services provided to me may be cancelled and I may be prosecuted.</div>' +
      '<div class="crm3-note">As far as I know, all the information I have given is true and I have not withheld any relevant information.</div>' +
      '<div class="crm3-note">The information contained on this form is true to the best of my knowledge and belief.</div>' +
      '<table class="crm3-grid">' +
      '<tr><td class="crm3-lbl">Client signature</td><td class="crm3-box">' + (d.clientSig ? '<img class="lf-sig-img" src="' + d.clientSig + '">' : '') + '</td></tr>' +
      '<tr><td class="crm3-lbl">Dated</td><td class="crm3-box">' + esc(fmtDate(d.laaSignatureDate) || fmtDate(d.date) || '') + '</td></tr>' +
    '</table>';
    html += footer(7);

    html += '</body></html>';
    return html;
  }

  /* ═══════════════════════════════════════════════
     CRM14: ONLINE APPLICATION DATA (Version 7 February 2025)
     Structured summary matching the LAA "Apply for
     Criminal Legal Aid" portal sections
     ═══════════════════════════════════════════════ */
  function buildCRM14Summary(d, settings) {
    return buildCrimeApplyDeclarationStrict(d, settings);
  }

  function buildCrimeApplyDeclarationStrict(d, settings) {
    var s = settings || {};
    function cb(on, label) {
      return '<span class="laa-cb' + (on ? ' laa-cb-ticked' : '') + '">' + (on ? '&#10003;' : '') + '</span>' + esc(label);
    }

    var css = '<style>' +
      '@page{size:A4;margin:15mm;}' +
      'body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#000;margin:0;padding:0;line-height:1.25;}' +
      '.cad-page{padding:0 10mm 10mm;position:relative;min-height:270mm;box-sizing:border-box;}' +
      '.cad-official{position:absolute;top:0;right:0;font-size:8pt;font-weight:700;}' +
      '.cad-head{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:6px;}' +
      '.cad-title{font-size:16pt;font-weight:700;line-height:1.1;}' +
      '.cad-sub{font-size:10pt;font-weight:700;}' +
      '.cad-rule{border-top:1px solid #000;margin:6px 0;}' +
      '.cad-grid{width:100%;border-collapse:collapse;font-size:10pt;}' +
      '.cad-grid td,.cad-grid th{border:1px solid #000;padding:4px 6px;vertical-align:top;}' +
      '.cad-lbl{background:#f3f2f1;font-weight:700;width:36%;}' +
      '.cad-box{min-height:18px;}' +
      '.cad-sec{font-size:11pt;font-weight:700;margin:10px 0 4px;}' +
      '.cad-note{font-size:9pt;margin:4px 0;}' +
      '.cad-tickline{line-height:1.7;margin:2px 0;}' +
      '.cad-footer{display:flex;justify-content:space-between;align-items:center;font-size:8pt;border-top:1px solid #000;padding-top:4px;margin-top:10px;}' +
      '.cad-pg{font-weight:700;}' +
      '.laa-cb{display:inline-block;width:11px;height:11px;border:1.5px solid #0b0c0c;vertical-align:middle;margin-right:4px;text-align:center;line-height:10px;font-size:9pt;font-weight:700;}' +
      '.laa-cb-ticked{background:#0b0c0c;color:#fff;}' +
      '.cad-privacy h3{font-size:10pt;margin:8px 0 3px;}' +
      '.cad-privacy p,.cad-privacy li{font-size:9pt;line-height:1.35;margin:2px 0;}' +
      '.cad-privacy ul{margin:3px 0 3px 15px;padding:0;}' +
      '@media print{.cad-page{page-break-after:always;}.cad-page:last-of-type{page-break-after:auto;}.laa-cb{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
      '</style>';

    function header(pageNum) {
      return '<div class="cad-page">' +
        '<div class="cad-official">OFFICIAL</div>' +
        '<div class="cad-head">' +
          '<div><div class="cad-title">Criminal legal aid - Applicant\'s declaration</div><div class="cad-sub">for online submissions</div></div>' +
          '<div class="cad-sub">Page ' + pageNum + ' &nbsp; Version 7 February 2025</div>' +
        '</div>' +
        '<div class="cad-rule"></div>';
    }

    function footer(pageNum) {
      return '<div class="cad-footer">' +
        '<span>Version 7 February 2025</span>' +
        '<span>&copy; Crown Copyright</span>' +
        '<span class="cad-pg">&mdash; ' + pageNum + ' of 6 &mdash;</span>' +
      '</div></div>';
    }

    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Criminal legal aid - Applicant declaration (Version 7 February 2025)</title>' + css + '</head><body>';

    /* Page 1 */
    html += header(1);
    html += '<div class="cad-note">Use this form where you are making an application using LAA Online.</div>';
    html += '<div class="cad-sec">Declaration by Applicant</div>';
    html += '<table class="cad-grid">' +
      '<tr><td class="cad-lbl">USN</td><td class="cad-box">' + esc(d.usn || '') + '</td><td class="cad-lbl">Full name</td><td class="cad-box">' + esc(fullName(d) || '') + '</td></tr>' +
      '<tr><td class="cad-lbl">National Insurance Number</td><td class="cad-box">' + esc(d.niNumber || '') + '</td><td class="cad-lbl">Date of birth</td><td class="cad-box">' + esc(fmtDate(d.dob) || '') + '</td></tr>' +
    '</table>';
    html += '<div class="cad-note">I apply for the right to representation for the purposes of criminal proceedings under the Legal Aid, Sentencing and Punishment of Offenders Act 2012.</div>';
    html += '<div class="cad-note">I declare that my application will be made electronically by my legal representative.</div>';
    html += '<div class="cad-note">I understand that if I have declared anything that is not true, or left anything out that I may be prosecuted for fraud, my legal aid may be stopped, and contribution liabilities may change.</div>';
    html += '<div class="cad-note">I agree to notify the LAA or HMCTS immediately if my income/capital or my partner\'s means change.</div>';
    html += '<div class="cad-note">I authorise relevant enquiries by the LAA, its agents, HMCTS and my solicitor into my and my partner\'s means.</div>';
    html += '<div class="cad-note"><strong>PLEASE NOTE:</strong> Making a false declaration is an offence and may lead to prosecution.</div>';
    html += footer(1);

    /* Page 2 */
    html += header(2);
    html += '<div class="cad-sec">Declaration by Applicant continued</div>';
    html += '<div class="cad-note">Data Sharing: if convicted, information in this form may be used by HMCTS or a designated officer to determine and enforce financial penalties.</div>';
    html += '<table class="cad-grid">' +
      '<tr><td class="cad-lbl">Signed</td><td class="cad-box">' + (d.clientSig ? '<img class="lf-sig-img" src="' + d.clientSig + '">' : '') + '</td><td class="cad-lbl">Dated</td><td class="cad-box">' + esc(fmtDate(d.laaSignatureDate) || fmtDate(d.date) || '') + '</td></tr>' +
      '<tr><td class="cad-lbl">Full name (in block capitals)</td><td class="cad-box" colspan="3">' + esc(fullName(d) || '') + '</td></tr>' +
    '</table>';
    html += '<div class="cad-sec">Declaration by your (the applicant\'s) partner</div>';
    html += '<div class="cad-note">I declare that the information included in this application is true to the best of my knowledge and belief.</div>';
    html += '<table class="cad-grid">' +
      '<tr><td class="cad-lbl">Signed</td><td class="cad-box">' + (d.partnerSig ? '<img class="lf-sig-img" src="' + d.partnerSig + '">' : '') + '</td><td class="cad-lbl">Dated</td><td class="cad-box">' + esc(fmtDate(d.partnerSignatureDate) || '') + '</td></tr>' +
      '<tr><td class="cad-lbl">Full name (in block capitals)</td><td class="cad-box" colspan="3">' + esc(d.partnerName || '') + '</td></tr>' +
      '<tr><td class="cad-lbl">If partner has not signed, explain why</td><td class="cad-box" colspan="3">' + esc(d.partnerNoSignatureReason || '') + '</td></tr>' +
    '</table>';
    html += '<div class="cad-sec">Declaration by the legal representative</div>';
    html += '<table class="cad-grid">' +
      '<tr><td class="cad-lbl">Signed</td><td class="cad-box">' + (d.feeEarnerSig ? '<img class="lf-sig-img" src="' + d.feeEarnerSig + '">' : '') + '</td></tr>' +
      '<tr><td class="cad-lbl">Full name (in block capitals)</td><td class="cad-box">' + esc(d.feeEarnerName || d.laaFeeEarnerFullName || '') + '</td></tr>' +
      '<tr><td class="cad-lbl">Provider\'s LAA Account Number</td><td class="cad-box">' + esc(s.firmLaaAccount || d.firmLaaAccount || '') + '</td></tr>' +
    '</table>';
    html += '<div class="cad-note"><strong>Fraud Notice:</strong> If false or inaccurate information is provided and fraud is identified, details may be passed to fraud prevention agencies.</div>';
    html += footer(2);

    /* Pages 3-6 privacy */
    html += header(3);
    html += '<div class="cad-privacy">' +
      '<h3>LEGAL AID AGENCY PRIVACY NOTICE</h3>' +
      '<h3>Purpose</h3>' +
      '<p>This privacy notice sets out the standards that you can expect from the Legal Aid Agency (LAA) when we request or hold personal information (&ldquo;personal data&rdquo;) about you; how you can get access to a copy of your personal data; and what you can do if you think the standards are not being met.</p>' +
      '<p>The LAA is an Executive Agency of the Ministry of Justice (MoJ). The MoJ is the data controller for the personal information we hold. The LAA collects and processes personal data for the exercise of its own and associated public functions. Our public function is to provide legal aid.</p>' +
      '<h3>About personal information</h3>' +
      '<p>Personal data is information about you as an individual. It can include your name, address, telephone number, financial circumstances and legal proceedings information.</p>' +
      '<h3>Purpose of processing</h3>' +
      '<p>Data is processed for legal aid under Article 6(1)(e) UK GDPR and LASPO 2012 functions.</p>' +
    '</div>';
    html += footer(3);

    html += header(4);
    html += '<div class="cad-privacy">' +
      '<p>We may use your data to decide legal aid eligibility, assess contributions, process provider claims, conduct assurance audits, and improve public services.</p>' +
      '<h3>Who information may be shared with</h3>' +
      '<p>Where lawful, information may be shared with instructed providers, HMCTS, HMRC, DWP, Home Office, HM Land Registry, credit reference agencies, and fraud/debt enforcement partners.</p>' +
      '<h3>Data Processors</h3>' +
      '<p>Third-party processors may provide hosting, administration, document management and secure IT storage.</p>' +
    '</div>';
    html += footer(4);

    html += header(5);
    html += '<div class="cad-privacy">' +
      '<h3>Automated decision making</h3><p>We do not make solely automated legal aid decisions under Article 22(1) UK GDPR.</p>' +
      '<h3>Retention period</h3><p>Personal data is retained only as long as required for lawful purposes and then securely destroyed.</p>' +
      '<h3>Access requests</h3><p>You can make subject access requests to the Ministry of Justice Disclosure Team.</p>' +
    '</div>';
    html += footer(5);

    html += header(6);
    html += '<div class="cad-privacy">' +
      '<h3>When we ask you for personal data</h3>' +
      '<p>We ask only for necessary data, keep it secure, and share it only for legitimate purposes.</p>' +
      '<h3>Complaints</h3>' +
      '<p>For data protection complaints, contact the Information Commissioner&rsquo;s Office (ICO).</p>' +
      '<p><strong>Data Protection Officer:</strong> Ministry of Justice, 102 Petty France, London, SW1H 9AJ. dataprotection@justice.gov.uk</p>' +
    '</div>';
    html += footer(6);

    html += '</body></html>';
    return html;
  }

  exports.buildCRM1 = buildCRM1;
  exports.buildCRM2 = buildCRM2;
  exports.buildCRM3 = buildCRM3;
  exports.buildCRM14Summary = buildCRM14Summary;

})(typeof window !== 'undefined' ? (window.laaForms = {}) : module.exports);

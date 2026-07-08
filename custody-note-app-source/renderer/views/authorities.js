/* ═══════════════════════════════════════════════════════
   AUTHORITIES VIEW
   Auto-fill authority templates from record data and generate PDF.
   ═══════════════════════════════════════════════════════ */

var _AUTHORITY_TEMPLATES = [
  {
    id: 'medical',
    title: 'Medical Authority',
    hint: 'Authorises release of medical records (GP, hospital, mental health) to your firm for the purpose of the client\u2019s defence.',
    requiredFields: [
      { key: 'clientFullName', label: 'Client full name', fromRecord: function(d) { return [d.forename, d.surname].filter(Boolean).join(' ').trim(); } },
      { key: 'address', label: 'Client address', fromRecord: function(d) { return [d.address1, d.address2, d.address3, d.city, d.county, d.postCode].filter(Boolean).join(', ').trim(); } },
      { key: 'firmName', label: 'Firm name', fromRecord: function(d) { return d.firmName || ''; } }
    ],
    body: function(v) {
      return '<p><strong>MEDICAL AUTHORITY</strong></p>' +
        '<p>I, <strong>' + _authEsc(v.clientFullName) + '</strong>, of <strong>' + _authEsc(v.address) + '</strong>, hereby authorise and request:</p>' +
        '<p>1. My General Practitioner and any medical practice holding my records;</p>' +
        '<p>2. Any hospital or NHS Trust that has treated me;</p>' +
        '<p>3. Any mental health service or professional that has assessed or treated me;</p>' +
        '<p>to release and disclose to <strong>' + _authEsc(v.firmName) + '</strong>, my solicitors, all medical records, reports, notes and information relating to my physical and/or mental health that they hold, for the purpose of my legal proceedings and my defence.</p>' +
        '<p>I understand that this information will be treated in confidence and used only for that purpose. I consent to copies of this authority being sent to the above in support of a request for disclosure.</p>';
    }
  },
  {
    id: 'legal_aid',
    title: 'Legal Aid Declaration',
    hint: 'Client declaration as to financial circumstances and consent for legal aid application (adapt for CRM2 / means assessment).',
    requiredFields: [
      { key: 'clientFullName', label: 'Client full name', fromRecord: function(d) { return [d.forename, d.surname].filter(Boolean).join(' ').trim(); } },
      { key: 'firmName', label: 'Firm name', fromRecord: function(d) { return d.firmName || ''; } }
    ],
    body: function(v) {
      return '<p><strong>LEGAL AID DECLARATION</strong></p>' +
        '<p>I, <strong>' + _authEsc(v.clientFullName) + '</strong>, declare that the information I have given to <strong>' + _authEsc(v.firmName) + '</strong> about my income, capital and outgoings for the purpose of my application for criminal legal aid is true and complete to the best of my knowledge and belief.</p>' +
        '<p>I understand that I must tell the Legal Aid Agency (or my solicitors) immediately if my financial circumstances change. I consent to my solicitors passing my details and this declaration to the Legal Aid Agency and to the use of my information for the assessment of my eligibility for legal aid.</p>';
    }
  },
  {
    id: 'transfer',
    title: 'Authority to Transfer Papers',
    hint: 'Client authorises transfer of the case file to another firm or solicitor (e.g. on change of solicitor or transfer of matter).',
    requiredFields: [
      { key: 'clientFullName', label: 'Client full name', fromRecord: function(d) { return [d.forename, d.surname].filter(Boolean).join(' ').trim(); } },
      { key: 'firmName', label: 'Current firm name', fromRecord: function(d) { return d.firmName || ''; } },
      { key: 'newFirm', label: 'New firm / solicitor name and address', fromRecord: function() { return ''; } },
      { key: 'caseDescription', label: 'Brief case description', fromRecord: function(d) { return d.offenceSummary || d.offence1Details || ''; } }
    ],
    body: function(v) {
      return '<p><strong>AUTHORITY TO TRANSFER PAPERS</strong></p>' +
        '<p>I, <strong>' + _authEsc(v.clientFullName) + '</strong>, hereby authorise <strong>' + _authEsc(v.firmName) + '</strong> to send to <strong>' + _authEsc(v.newFirm) + '</strong> all papers, documents, correspondence and other material held in connection with my matter (including <strong>' + _authEsc(v.caseDescription) + '</strong>).</p>' +
        '<p>I understand that my file will be transferred in its entirety and that my current solicitors will retain no copies unless required by law or professional rules. I consent to the disclosure of such information as is necessary to effect the transfer and to enable the new firm to act for me.</p>';
    }
  },
  {
    id: 'obtain_docs',
    title: 'Authority to Obtain Documents',
    hint: 'General authority to request documents from police, CPS, court, previous solicitors or other third parties.',
    requiredFields: [
      { key: 'clientFullName', label: 'Client full name', fromRecord: function(d) { return [d.forename, d.surname].filter(Boolean).join(' ').trim(); } },
      { key: 'firmName', label: 'Firm name', fromRecord: function(d) { return d.firmName || ''; } }
    ],
    body: function(v) {
      return '<p><strong>AUTHORITY TO OBTAIN DOCUMENTS</strong></p>' +
        '<p>I, <strong>' + _authEsc(v.clientFullName) + '</strong>, hereby authorise <strong>' + _authEsc(v.firmName) + '</strong>, my solicitors, to request and receive from:</p>' +
        '<p>\u2022 The police (including the investigating force and any custody/evidence holder);<br>' +
        '\u2022 The Crown Prosecution Service;<br>' +
        '\u2022 Any court or tribunal;<br>' +
        '\u2022 Any previous solicitors or legal representatives who have acted for me;</p>' +
        '<p>all documents, statements, exhibits, unused material, disclosure, and any other papers or information relating to my matter/case. I consent to my solicitors providing a copy of this authority where necessary to support such requests.</p>';
    }
  },
  {
    id: 'instruct_expert',
    title: 'Authority to Instruct Expert',
    hint: 'Client authorises the firm to instruct a named expert (e.g. medical, forensic, psychiatrist) and to disclose relevant papers.',
    requiredFields: [
      { key: 'clientFullName', label: 'Client full name', fromRecord: function(d) { return [d.forename, d.surname].filter(Boolean).join(' ').trim(); } },
      { key: 'firmName', label: 'Firm name', fromRecord: function(d) { return d.firmName || ''; } },
      { key: 'expertName', label: 'Expert name or type (e.g. consultant psychiatrist)', fromRecord: function() { return ''; } }
    ],
    body: function(v) {
      return '<p><strong>AUTHORITY TO INSTRUCT EXPERT</strong></p>' +
        '<p>I, <strong>' + _authEsc(v.clientFullName) + '</strong>, authorise <strong>' + _authEsc(v.firmName) + '</strong>, my solicitors, to instruct <strong>' + _authEsc(v.expertName) + '</strong> to prepare a report and, if required, to give evidence in connection with my case.</p>' +
        '<p>I consent to my solicitors disclosing to the expert such of my papers, medical records and other information as they consider necessary for the expert to carry out their instructions. I understand that the expert may need to examine me or discuss my case and I agree to cooperate. I consent to the report and any related correspondence being shared with the court, prosecution and legal aid authority as appropriate.</p>';
    }
  },
  {
    id: 'disclosure',
    title: 'Consent to Disclosure (Third Parties)',
    hint: 'Client consents to disclosure of information to specified third parties (e.g. court, counsel, expert, family) where needed for the conduct of the case.',
    requiredFields: [
      { key: 'clientFullName', label: 'Client full name', fromRecord: function(d) { return [d.forename, d.surname].filter(Boolean).join(' ').trim(); } },
      { key: 'firmName', label: 'Firm name', fromRecord: function(d) { return d.firmName || ''; } },
      { key: 'otherParty', label: 'Other named party (e.g. family member, interpreter)', fromRecord: function() { return ''; } }
    ],
    body: function(v) {
      return '<p><strong>CONSENT TO DISCLOSURE</strong></p>' +
        '<p>I, <strong>' + _authEsc(v.clientFullName) + '</strong>, consent to <strong>' + _authEsc(v.firmName) + '</strong>, my solicitors, disclosing such information and documents relating to my case as they consider necessary to:</p>' +
        '<p>\u2022 The court and any tribunal;<br>' +
        '\u2022 Counsel and other advocates instructed on my behalf;<br>' +
        '\u2022 Experts instructed on my behalf;<br>' +
        '\u2022 <strong>' + _authEsc(v.otherParty) + '</strong> where relevant to my defence or to the conduct of my case.</p>' +
        '<p>I understand that such disclosure will be limited to what is necessary and that confidentiality will be maintained so far as possible. This consent may be withdrawn in writing at any time.</p>';
    }
  },
  {
    id: 'authority_act',
    title: 'Authority to Act',
    hint: 'Client confirms instruction of the firm and authority to act (useful for court, LAA or third-party confirmation).',
    requiredFields: [
      { key: 'clientFullName', label: 'Client full name', fromRecord: function(d) { return [d.forename, d.surname].filter(Boolean).join(' ').trim(); } },
      { key: 'firmName', label: 'Firm name', fromRecord: function(d) { return d.firmName || ''; } },
      { key: 'caseDescription', label: 'Brief description of matter', fromRecord: function(d) { return d.offenceSummary || d.offence1Details || ''; } }
    ],
    body: function(v) {
      return '<p><strong>AUTHORITY TO ACT</strong></p>' +
        '<p>I, <strong>' + _authEsc(v.clientFullName) + '</strong>, confirm that I have instructed <strong>' + _authEsc(v.firmName) + '</strong> to act for me in connection with <strong>' + _authEsc(v.caseDescription) + '</strong>. I authorise them to conduct my case, to correspond and communicate with the court, prosecution, Legal Aid Agency and any other body or person as they consider necessary, and to sign documents on my behalf where I have given them specific authority to do so.</p>';
    }
  },
  {
    id: 'dwp',
    title: 'DWP / Benefits Records Authority',
    hint: 'Authorises release of DWP, Jobcentre Plus or benefits records \u2014 often needed for means assessment, mitigation, or benefit fraud cases.',
    requiredFields: [
      { key: 'clientFullName', label: 'Client full name', fromRecord: function(d) { return [d.forename, d.surname].filter(Boolean).join(' ').trim(); } },
      { key: 'address', label: 'Client address', fromRecord: function(d) { return [d.address1, d.address2, d.address3, d.city, d.county, d.postCode].filter(Boolean).join(', ').trim(); } },
      { key: 'niNumber', label: 'National Insurance number', fromRecord: function(d) { return d.niNumber || ''; } },
      { key: 'firmName', label: 'Firm name', fromRecord: function(d) { return d.firmName || ''; } }
    ],
    body: function(v) {
      return '<p><strong>AUTHORITY TO OBTAIN DWP / BENEFITS RECORDS</strong></p>' +
        '<p>I, <strong>' + _authEsc(v.clientFullName) + '</strong>, of <strong>' + _authEsc(v.address) + '</strong>, National Insurance number <strong>' + _authEsc(v.niNumber) + '</strong>, hereby authorise <strong>' + _authEsc(v.firmName) + '</strong>, my solicitors, to request and obtain from the Department for Work and Pensions, Jobcentre Plus, or any other benefits authority, all records, claim histories, assessments, correspondence and information relating to my benefits and financial circumstances that may be relevant to my legal proceedings and my defence.</p>' +
        '<p>I consent to such records being disclosed to my solicitors. This request is made under the UK GDPR and the Data Protection Act 2018 and the information will be used only for the purpose of my case.</p>';
    }
  }
];

function _authEsc(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function _authFmtDate(iso) {
  if (!iso) return new Date().toLocaleDateString('en-GB');
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : iso;
}

/* ─── Extract field values from record, identify missing ones ─── */
function _authExtractFields(template, recordData) {
  var values = {};
  var missing = [];
  template.requiredFields.forEach(function(f) {
    var val = f.fromRecord(recordData || {});
    if (val && String(val).trim()) {
      values[f.key] = String(val).trim();
    } else {
      values[f.key] = '';
      missing.push(f);
    }
  });
  return { values: values, missing: missing };
}

/* ─── Build authority PDF HTML ─── */
function _buildAuthorityPdfHtml(template, fieldValues) {
  var today = new Date().toLocaleDateString('en-GB');
  var bodyHtml = template.body(fieldValues);
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + _authEsc(template.title) + '</title>' +
    '<style>' +
    'body { font-family: Arial, sans-serif; font-size: 12pt; color: #111; margin: 2.5cm 2cm; line-height: 1.6; }' +
    'p { margin: 0 0 0.7em 0; }' +
    'strong { color: #0f172a; }' +
    '.sig-line { display: inline-block; min-width: 220px; border-bottom: 1px solid #333; margin: 0 6px; }' +
    '.sig-section { margin-top: 2em; }' +
    '.footer { font-size: 8pt; color: #555; margin-top: 3cm; border-top: 1px solid #ccc; padding-top: 6px; }' +
    '@media print { @page { margin: 2cm; } }' +
    '</style></head><body>' +
    bodyHtml +
    '<div class="sig-section">' +
    '<p>Signed: <span class="sig-line"></span> Date: ' + _authEsc(today) + '</p>' +
    '</div>' +
    '<div class="footer">\u00A9 Defence Legal Services Ltd &nbsp;|&nbsp; Generated: ' + new Date().toLocaleString('en-GB') + '</div>' +
    '</body></html>';
}

/* ─── Record picker for Authorities view ─── */
function _showAuthorityRecordPicker(templateId) {
  var template = _AUTHORITY_TEMPLATES.find(function(t) { return t.id === templateId; });
  if (!template) return;

  var overlay = document.getElementById('authority-record-picker');
  var listEl = document.getElementById('authority-record-list');
  var titleEl = document.getElementById('authority-record-picker-title');
  if (!overlay || !listEl) return;

  titleEl.textContent = 'Select record for: ' + template.title;
  listEl.innerHTML = '<li class="home-recent-empty">Loading\u2026</li>';
  overlay.classList.remove('hidden');

  var listFn = window.api.attendanceListFull || window.api.attendanceList;
  listFn().then(function(rows) {
    if (!rows || !rows.length) {
      listEl.innerHTML = '<li class="home-recent-empty">No records found. Create one first.</li>';
      return;
    }
    var sorted = rows.slice().sort(function(a, b) {
      return (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '');
    });
    listEl.innerHTML = sorted.map(function(r) {
      var name = (r.client_name && String(r.client_name).trim()) || 'Draft (no name)';
      var station = r.station_name || '';
      var date = r.attendance_date || '';
      if (date) {
        var dm = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (dm) date = dm[3] + '/' + dm[2] + '/' + dm[1];
      }
      var meta = [station, date].filter(Boolean).join(' \u00B7 ');
      return '<li class="attendance-picker-item authority-record-item" data-id="' + r.id + '">' +
        '<span class="picker-item-name">' + _authEsc(name) + '</span>' +
        '<span class="picker-item-meta">' + _authEsc(meta) + '</span></li>';
    }).join('');

    listEl.querySelectorAll('.authority-record-item').forEach(function(li) {
      var id = parseInt(li.dataset.id, 10);
      if (isNaN(id)) return;
      li.addEventListener('click', function() {
        overlay.classList.add('hidden');
        window.api.attendanceGet(id).then(function(row) {
          if (!row || !row.data) {
            if (typeof showToast === 'function') showToast('Could not load record', 'error');
            return;
          }
          var data = {};
          try { data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {}); } catch (_) {}
          _authorityFillFlow(template, data);
        }).catch(function(err) {
          if (typeof showToast === 'function') showToast('Failed to load record: ' + (err && err.message), 'error');
        });
      });
    });
  }).catch(function() {
    listEl.innerHTML = '<li class="home-recent-empty">Failed to load records.</li>';
  });
}

function _closeAuthorityRecordPicker() {
  var el = document.getElementById('authority-record-picker');
  if (el) el.classList.add('hidden');
}

/* ─── Missing-fields prompt then generate PDF ─── */
function _authorityFillFlow(template, recordData) {
  var result = _authExtractFields(template, recordData);

  if (result.missing.length === 0) {
    _authorityGeneratePdf(template, result.values);
    return;
  }

  var overlay = document.getElementById('authority-fill-modal');
  var titleEl = document.getElementById('authority-fill-title');
  var formEl = document.getElementById('authority-fill-form');
  var genBtn = document.getElementById('authority-fill-generate');
  if (!overlay || !formEl) return;

  titleEl.textContent = template.title + ' \u2013 missing fields';
  formEl.innerHTML = '';

  result.missing.forEach(function(f) {
    var wrap = document.createElement('div');
    wrap.className = 'authority-fill-field';
    var lbl = document.createElement('label');
    lbl.textContent = f.label;
    lbl.setAttribute('for', 'auth-fill-' + f.key);
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.id = 'auth-fill-' + f.key;
    inp.className = 'form-input';
    inp.dataset.key = f.key;
    inp.placeholder = f.label;
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    formEl.appendChild(wrap);
  });

  overlay.classList.remove('hidden');
  var firstInput = formEl.querySelector('input');
  if (firstInput) firstInput.focus();

  var newBtn = genBtn.cloneNode(true);
  genBtn.parentNode.replaceChild(newBtn, genBtn);
  newBtn.id = 'authority-fill-generate';

  newBtn.addEventListener('click', function() {
    formEl.querySelectorAll('input[data-key]').forEach(function(inp) {
      var k = inp.dataset.key;
      var v = inp.value.trim();
      if (v) result.values[k] = v;
    });

    var stillEmpty = result.missing.filter(function(f) { return !result.values[f.key]; });
    if (stillEmpty.length > 0) {
      if (typeof showToast === 'function') showToast('Please fill in: ' + stillEmpty.map(function(f) { return f.label; }).join(', '), 'error');
      return;
    }

    overlay.classList.add('hidden');
    _authorityGeneratePdf(template, result.values);
  });
}

function _closeAuthorityFillModal() {
  var el = document.getElementById('authority-fill-modal');
  if (el) el.classList.add('hidden');
}

function _authorityGeneratePdf(template, fieldValues) {
  var html = _buildAuthorityPdfHtml(template, fieldValues);
  if (typeof printGeneratedDoc === 'function') {
    printGeneratedDoc(html);
  } else {
    var w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { if (typeof showToast === 'function') showToast('Please allow pop-ups', 'error'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(function() { w.print(); }, 400);
  }
  if (typeof showToast === 'function') showToast(template.title + ' PDF opened', 'success');
}

/* ─── Generate from within an open record ─── */
function generateAuthorityFromRecord(templateId) {
  var template = _AUTHORITY_TEMPLATES.find(function(t) { return t.id === templateId; });
  if (!template) return;
  var data = typeof getFormData === 'function' ? getFormData() : (typeof formData === 'object' ? formData : {});
  _authorityFillFlow(template, data);
}

/* ─── Render authority cards into the view ─── */
function loadAuthorities() {
  var container = document.getElementById('authorities-dynamic-list');
  if (!container) return;

  container.innerHTML = '';
  _AUTHORITY_TEMPLATES.forEach(function(tpl) {
    var card = document.createElement('div');
    card.className = 'settings-card authority-card';
    card.innerHTML =
      '<div class="authority-card-header">' +
        '<div>' +
          '<h3 class="authority-title">' + _authEsc(tpl.title) + '</h3>' +
          '<p class="settings-hint">' + _authEsc(tpl.hint) + '</p>' +
        '</div>' +
        '<button type="button" class="btn btn-primary authority-fill-btn" data-auth-id="' + tpl.id + '">Fill from record</button>' +
      '</div>' +
      '<details class="authority-details">' +
        '<summary>Proposed wording</summary>' +
        '<div class="authority-wording">' + tpl.body(_authPlaceholderValues(tpl)) + '</div>' +
      '</details>';
    container.appendChild(card);
  });

  container.addEventListener('click', function(e) {
    var btn = e.target.closest('.authority-fill-btn');
    if (!btn) return;
    e.preventDefault();
    var authId = btn.dataset.authId;

    if (typeof currentAttendanceId !== 'undefined' && currentAttendanceId &&
        document.getElementById('view-form') && document.getElementById('view-form').classList.contains('active')) {
      var template = _AUTHORITY_TEMPLATES.find(function(t) { return t.id === authId; });
      if (template) {
        var data = typeof getFormData === 'function' ? getFormData() : (typeof formData === 'object' ? formData : {});
        _authorityFillFlow(template, data);
      }
    } else {
      _showAuthorityRecordPicker(authId);
    }
  });
}

function _authPlaceholderValues(tpl) {
  var v = {};
  tpl.requiredFields.forEach(function(f) {
    v[f.key] = '[' + f.label + ']';
  });
  return v;
}

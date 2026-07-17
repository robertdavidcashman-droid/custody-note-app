/*
 * CRM1 (Legal Aid Client Details) pre-submit validation.
 *
 * The CRM1 PDF is filled from the attendance record. Previously the app would
 * generate the PDF from whatever was present, so missing client details (no DOB,
 * no address, no gender) produced a near-blank or wrong-looking official form
 * with no warning — the "CRM1 keeps erroring / fills boxes wrong" complaint.
 *
 * This module returns SPECIFIC, field-level messages so the UI can show a
 * pre-submit summary and inline guidance, rather than failing silently.
 *
 * Pure + dual-export: required by Node tests and loaded as a renderer <script>.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Crm1Validation = api;
})(this, function () {
  'use strict';

  function isBlank(v) {
    return v === undefined || v === null || String(v).trim() === '';
  }

  /**
   * Parse a YYYY-MM-DD (or D/M/YYYY) date string into a Date, or null if invalid.
   */
  function parseDateLoose(value) {
    if (isBlank(value)) return null;
    var s = String(value).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      var dt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      if (dt.getFullYear() === Number(iso[1]) && dt.getMonth() === Number(iso[2]) - 1 && dt.getDate() === Number(iso[3])) {
        return dt;
      }
      return null;
    }
    var dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) {
      var d2 = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
      if (d2.getFullYear() === Number(dmy[3]) && d2.getMonth() === Number(dmy[2]) - 1 && d2.getDate() === Number(dmy[1])) {
        return d2;
      }
      return null;
    }
    return null;
  }

  // UK NI number format: 2 letters, 6 digits, 1 letter (spaces optional).
  var NI_RE = /^[A-Za-z]{2}\s*\d{2}\s*\d{2}\s*\d{2}\s*[A-Za-z]$/;

  /**
   * Validate a record for CRM1 generation.
   * @param {object} data attendance record (formData)
   * @param {object} [opts] { now: Date } for deterministic tests
   * @returns {{ ok:boolean, errors:Array<{field,label,message}>, warnings:Array<{field,label,message}> }}
   */
  function validateCrm1Data(data, opts) {
    var d = data || {};
    var now = (opts && opts.now) ? opts.now : new Date();
    var errors = [];
    var warnings = [];

    function err(field, label, message) { errors.push({ field: field, label: label, message: message }); }
    function warn(field, label, message) { warnings.push({ field: field, label: label, message: message }); }

    // --- Client identity (required for a valid CRM1) ---
    if (isBlank(d.surname)) err('surname', 'Surname', 'Enter the client\u2019s surname.');
    if (isBlank(d.forename)) err('forename', 'First name', 'Enter the client\u2019s first name.');

    if (isBlank(d.dob)) {
      err('dob', 'Date of birth', 'Enter the client\u2019s date of birth.');
    } else {
      var dob = parseDateLoose(d.dob);
      if (!dob) {
        err('dob', 'Date of birth', 'Date of birth is not a valid date (use the date picker).');
      } else if (dob.getTime() > now.getTime()) {
        err('dob', 'Date of birth', 'Date of birth is in the future.');
      } else {
        var age = (now.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
        if (age > 120) err('dob', 'Date of birth', 'Date of birth looks too long ago \u2014 please check.');
      }
    }

    if (isBlank(d.gender)) {
      warn('gender', 'Gender', 'Gender is blank \u2014 no box will be ticked in the Equal Opportunities section.');
    }

    // --- Address (CRM1 client address block) ---
    if (isBlank(d.address1)) err('address1', 'Address', 'Enter the client\u2019s address (first line).');
    if (isBlank(d.postCode)) {
      err('postCode', 'Postcode', 'Enter the client\u2019s postcode.');
    }

    // --- NI / ARC (one identifier expected for means assessment) ---
    var hasNi = !isBlank(d.niNumber) || !isBlank(d.crm14NiNumber);
    var hasArc = !isBlank(d.arcNumber) || !isBlank(d.crm14ArcNumber);
    if (!hasNi && !hasArc) {
      warn('niNumber', 'NI / ARC number', 'No National Insurance or ARC number \u2014 the means section will be incomplete.');
    } else if (!isBlank(d.niNumber) && !NI_RE.test(String(d.niNumber).trim())) {
      err('niNumber', 'NI number', 'National Insurance number format looks wrong (expected like AB123456C).');
    }

    // --- Matter reference (UFN / file ref) ---
    if (isBlank(d.ufn) && isBlank(d.ourFileNumber) && isBlank(d.fileReference)) {
      warn('ufn', 'File / UFN reference', 'No UFN or file reference \u2014 the reference boxes will be blank.');
    }

    // --- Means / benefits consistency ---
    var onBenefit = d.passportedBenefit === 'Yes' || d.benefits === 'Yes';
    if (onBenefit && isBlank(d.benefitType) && isBlank(d.benefitOther)) {
      warn('benefitType', 'Benefit type', 'Client marked as on benefits but no benefit type is recorded.');
    }
    if (!onBenefit && d.benefits !== 'No' && isBlank(d.grossIncome)) {
      warn('grossIncome', 'Income', 'Not passported and no income recorded \u2014 the income boxes will be blank.');
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,
    };
  }

  return {
    validateCrm1Data: validateCrm1Data,
    parseDateLoose: parseDateLoose,
    NI_RE: NI_RE,
  };
});

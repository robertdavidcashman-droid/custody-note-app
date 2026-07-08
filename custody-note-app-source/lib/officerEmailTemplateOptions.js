'use strict';

/** Single source for officer email template dropdown labels (lib + renderer). */
const OFFICER_EMAIL_TEMPLATE_OPTIONS = Object.freeze([
  { value: 'disclosure_confirm_attendance', label: 'Confirm attendance and request disclosure' },
  { value: 'confirm_matter_effective', label: 'Confirm matter effective' },
  { value: 'voluntary_interview_confirmation', label: 'Voluntary interview — confirm and disclosure' },
  { value: 'confirm_outcome_after_attendance', label: 'Confirm outcome after attendance' },
  { value: 'chase_disclosure', label: 'Request disclosure urgently' },
  { value: 'chase_disclosure_follow_up', label: 'Chase disclosure — follow-up' },
  { value: 'request_officer_contact_details', label: 'OIC / officer contact details' },
  { value: 'custody_log_request', label: 'Request custody record' },
  { value: 'custody_record_detention_log_request', label: 'Request custody record and detention log' },
  { value: 'chase_custody_log_follow_up', label: 'Chase custody record — follow-up' },
  { value: 'request_update_after_delay', label: 'Update following delay' },
  { value: 'bail_details_request', label: 'Police bail — confirm details' },
  { value: 'chase_bail_details_follow_up', label: 'Chase police bail details — follow-up' },
  { value: 'rui_details_request', label: 'Released under investigation — confirm details' },
  { value: 'matter_stood_down', label: 'Matter stood down — no longer attending' },
  { value: 'free_text_email', label: 'Custom message (blank)' },
]);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OFFICER_EMAIL_TEMPLATE_OPTIONS;
}
if (typeof window !== 'undefined') {
  window.OFFICER_EMAIL_TEMPLATE_OPTIONS = OFFICER_EMAIL_TEMPLATE_OPTIONS;
}

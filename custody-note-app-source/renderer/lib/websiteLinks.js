/**
 * UTM-tagged custodynote.com URLs for in-app links and share actions.
 * Same query shape as custody-note-website/lib/utm.ts (source=app, medium=referral|help).
 */
(function (root) {
  function appendWebsiteUtm(url, params) {
    params = params || {};
    try {
      var u = new URL(url);
      u.searchParams.set('utm_source', params.source || 'app');
      u.searchParams.set('utm_medium', params.medium || 'referral');
      u.searchParams.set('utm_campaign', params.campaign || 'desktop');
      if (params.content) u.searchParams.set('utm_content', params.content);
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  var BASE = 'https://custodynote.com';

  var WEBSITE_LINKS = {
    download: function () {
      return appendWebsiteUtm(BASE + '/download', { campaign: 'share', content: 'copy-link' });
    },
    trial: function () {
      return appendWebsiteUtm(BASE + '/download', { campaign: 'share', content: 'in-app' });
    },
    referral: function (code) {
      var path = code ? '/r/' + encodeURIComponent(String(code)) : '/download';
      return appendWebsiteUtm(BASE + path, { campaign: 'referral', content: 'invite' });
    },
    pricing: function () {
      return appendWebsiteUtm(BASE + '/pricing', { campaign: 'upgrade', content: 'in-app' });
    },
    support: function () {
      return appendWebsiteUtm(BASE + '/support', { campaign: 'help', content: 'settings' });
    },
    faq: function () {
      return appendWebsiteUtm(BASE + '/faq', { campaign: 'help', content: 'settings-faq' });
    },
    contact: function () {
      return appendWebsiteUtm(BASE + '/contact', { campaign: 'help', content: 'settings-contact' });
    },
    attendanceNotesGuide: function () {
      return appendWebsiteUtm(BASE + '/how-to-write-attendance-notes', {
        campaign: 'help',
        content: 'form-attendance-notes',
      });
    },
    paceInterviewNotes: function () {
      return appendWebsiteUtm(BASE + '/police-station-interview-notes', {
        campaign: 'help',
        content: 'form-interview',
      });
    },
    dsccWorkflow: function () {
      return appendWebsiteUtm(BASE + '/dscc-attendance-note-workflow', {
        campaign: 'help',
        content: 'form-dscc',
      });
    },
    bailChecklist: function () {
      return appendWebsiteUtm(BASE + '/bail-rui-follow-up-checklist', {
        campaign: 'help',
        content: 'form-bail',
      });
    },
  };

  root.appendWebsiteUtm = appendWebsiteUtm;
  root.WEBSITE_LINKS = WEBSITE_LINKS;
})(typeof window !== 'undefined' ? window : globalThis);

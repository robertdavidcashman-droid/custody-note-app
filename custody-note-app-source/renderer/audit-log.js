/* ═══════════════════════════════════════════════════════
   AUDIT LOG VIEWER
   Depends on: currentAttendanceId, esc, showToast (app.js globals)
   ═══════════════════════════════════════════════════════ */

var ACTION_LABELS = {
  created:            { label: 'Record created',            icon: '✦', cls: 'al-created' },
  updated:            { label: 'Record updated',            icon: '✎', cls: 'al-updated' },
  finalised:          { label: 'Record finalised',          icon: '✔', cls: 'al-finalised' },
  unlocked:           { label: 'Finalisation removed',      icon: '🔓', cls: 'al-unlocked' },
  soft_deleted:       { label: 'Record archived',           icon: '🗄', cls: 'al-deleted' },
  supervisor_approved:{ label: 'Supervisor approved',       icon: '⭐', cls: 'al-approved' },
};

function _formatTimestamp(ts) {
  if (!ts) return '—';
  try {
    var d = new Date(ts.replace(' ', 'T') + (ts.indexOf('T') === -1 ? 'Z' : ''));
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ts; }
}

function _renderChangedFields(json) {
  if (!json) return '';
  try {
    var fields = JSON.parse(json);
    if (!Array.isArray(fields) || !fields.length) return '';
    /* Pretty-print field names */
    var readable = fields.map(function(f) {
      return f.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, function(c){ return c.toUpperCase(); });
    });
    return '<div class="al-fields">Fields changed: ' + esc(readable.join(', ')) + '</div>';
  } catch (_) { return ''; }
}

function showAuditLog(attendanceId) {
  if (!attendanceId) {
    showToast('Save the record first to view its audit trail', 'info');
    return;
  }
  if (!window.api || !window.api.auditLogGet) {
    showToast('Audit log not available', 'error');
    return;
  }

  window.api.auditLogGet(attendanceId).then(function(entries) {
    var html;
    if (!entries || !entries.length) {
      html = '<p class="al-empty">No audit entries yet for this record. Entries are created when the record is saved, finalised, or approved.</p>';
    } else {
      html = '<ol class="al-timeline">';
      entries.forEach(function(e) {
        var meta = ACTION_LABELS[e.action] || { label: e.action, icon: '•', cls: 'al-other' };
        html +=
          '<li class="al-entry ' + meta.cls + '">' +
            '<span class="al-icon" aria-hidden="true">' + meta.icon + '</span>' +
            '<div class="al-body">' +
              '<span class="al-action">' + esc(meta.label) + '</span>' +
              '<span class="al-time">' + _formatTimestamp(e.timestamp) + '</span>' +
              (e.user_note ? '<div class="al-note">' + esc(e.user_note) + '</div>' : '') +
              _renderChangedFields(e.changed_fields) +
            '</div>' +
          '</li>';
      });
      html += '</ol>';
    }

    showModal('Audit Trail', html);
  }).catch(function(err) {
    showToast('Could not load audit trail: ' + (err && err.message), 'error');
  });
}

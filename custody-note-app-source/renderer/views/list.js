/* ═══════════════════════════════════════════════════════
   LIST VIEW helpers (extracted from app.js)
   refreshList() lives in app.js — the authoritative path for showView('list').
   Depends on: listPage, LIST_PER_PAGE, formData, currentAttendanceId, currentSectionIdx,
               safeJson, esc, showToast, showConfirm, renderForm, showView,
               prefillDefaults, window.refreshList (app.js)
   ═══════════════════════════════════════════════════════ */

function _listRefresh() {
  if (typeof window.refreshList === 'function') window.refreshList();
}

function _renderListBillButtonHtml(rec) {
  var enabled = (typeof window.isListBillEnabled === 'function')
    ? window.isListBillEnabled(rec)
    : false;
  var title = enabled
    ? 'Open Finish matter billing for this record'
    : (rec.archived_at
      ? 'Archived records cannot be billed from the list'
      : 'Finalise the attendance note before billing');
  var disabled = enabled ? '' : ' disabled';
  var cls = 'btn-list-action bill-btn' + (enabled ? '' : ' bill-btn--disabled');
  return '<button type="button" class="' + cls + '" data-action="bill" data-id="' + esc(String(rec.id)) + '"' + disabled + ' title="' + esc(title) + '">Bill</button>';
}
window._renderListBillButtonHtml = _renderListBillButtonHtml;

function archiveAttendance(id, title) {
  var label = title || 'this record';
  showConfirm(
    'Archive "' + label + '"?\n\nThe record will be hidden from the main Records list. Open the Archived filter to find it again, or use Unarchive to restore it to the main list.',
    'Archive record'
  ).then(function (ok) {
    if (!ok) return;
    /* Delay the actual archive call by 5 seconds to allow undo */
    var undone = false;
    var toast = document.createElement('div');
    toast.className = 'cn-toast cn-toast-visible cn-toast-info cn-undo-toast';
    toast.innerHTML = 'Archiving in 5s&hellip; <button class="cn-undo-btn" type="button">Undo</button>';
    document.body.appendChild(toast);
    toast.querySelector('.cn-undo-btn').addEventListener('click', function () {
      undone = true;
      toast.remove();
      showToast('Archive cancelled', 'success');
    });
    var timer = setTimeout(function () {
      toast.remove();
      if (undone) return;
      window.api.attendanceArchive(id).then(function () {
        _listRefresh();
      }).catch(function () {
        showToast('Failed to archive record', 'error');
      });
    }, 5000);
    void timer;
  });
}

function unarchiveAttendance(id) {
  window.api.attendanceUnarchive(id).then(function() {
    showToast('Record restored from archive', 'info');
    _listRefresh();
  }).catch(function() {
    showToast('Failed to unarchive record', 'error');
  });
}

function deleteAttendance(id, title) {
  showConfirm('Delete "' + title + '"?\n\nThis soft-deletes the record: it leaves the main list and appears under the Deleted filter. You can restore it from there while it remains in your database.', 'Confirm delete').then(function(ok) {
    if (!ok) return;
    window.api.attendanceDelete({ id: id, reason: 'User deleted from list' }).then(function(result) {
      if (result && result.soft) showToast('Record moved to Deleted list', 'info');
      else showToast('Record deleted', 'info');
      _listRefresh();
    }).catch(function() {
      showToast('Failed to delete record', 'error');
    });
  });
}

function restoreDeletedAttendance(id, title) {
  if (!window.api || !window.api.attendanceUndelete) {
    showToast('Restore not available in this version', 'error');
    return;
  }
  window.api.attendanceUndelete(id).then(function(ok) {
    if (ok) {
      showToast('"' + title + '" restored', 'success');
      _listRefresh();
    } else {
      showToast('Failed to restore record', 'error');
    }
  }).catch(function() {
    showToast('Failed to restore record', 'error');
  });
}

function duplicateAttendance(id) {
  if (!window.api || !window.api.attendanceGet || !window.api.attendanceSave) return;
  if (typeof duplicateAttendanceData !== 'function') {
    showToast('Duplicate is not available. Please refresh the app.', 'error');
    return;
  }
  window.api.attendanceGet(id).then(function(row) {
    if (!row || !row.data) { showToast('Could not load record to duplicate', 'error'); return; }
    var src = safeJson(row.data);
    if (src._formType === 'telephone') {
      showToast('Duplicate is for station attendance notes. Use New attendance for telephone advice.', 'info', 6000);
      return;
    }
    var newData = duplicateAttendanceData(src, id);
    window.api.attendanceSave({ id: null, data: newData, status: 'draft' }).then(function(result) {
      if (result && typeof result === 'object' && result.error) {
        showToast((result.message || result.error) ? String(result.message || result.error) : 'Could not save duplicate', 'error');
        return;
      }
      if (result == null) {
        showToast('Could not create duplicate record', 'error');
        return;
      }
      var numericId = typeof result === 'number' ? result : parseInt(result, 10);
      if (isNaN(numericId)) {
        showToast('Could not create duplicate record', 'error');
        return;
      }
      try {
        if (typeof window._recordCache !== 'undefined' && window._recordCache && window._recordCache.delete) {
          window._recordCache.delete(numericId);
        }
      } catch (e) { /* ignore */ }
      openAttendance(numericId);
      showToast('Attendance duplicated – please complete client details.', 'success');
      _listRefresh();
    }).catch(function() {
      showToast('Failed to duplicate record', 'error');
    });
  }).catch(function() {
    showToast('Failed to load record to duplicate', 'error');
  });
}

function openAttendance(id) {
  currentAttendanceId = id;
  window.api.attendanceGet(id).then(function(row) {
    currentRecordStatus = row ? row.status : null;
    currentRecordArchived = !!(row && row.archived_at);
    formData = row && row.data ? safeJson(row.data) : {};
    currentSectionIdx = 0;
    renderForm(formData);
    if (typeof navigateTo === 'function') navigateTo('new'); else showView('new');
    if (typeof window.syncFormDuplicateButtonVisibility === 'function') window.syncFormDuplicateButtonVisibility();
  }).catch(function() {
    showToast('Failed to open record', 'error');
  });
}

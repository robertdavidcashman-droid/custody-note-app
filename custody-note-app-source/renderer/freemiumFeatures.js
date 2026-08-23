/**
 * Freemium UI: firm workspace settings, Anywhere bridge import.
 * Single-path IPC via window.api — no privileged work in renderer.
 */
(function () {
  'use strict';

  function toast(msg, type, ms) {
    if (typeof showToast === 'function') showToast(msg, type || 'info', ms);
  }

  function renderFirmWorkspace(ws) {
    if (!ws) return;
    var nameEl = document.getElementById('firm-ws-name');
    var brandEl = document.getElementById('firm-ws-branding');
    var shareEl = document.getElementById('firm-ws-share-templates');
    var countEl = document.getElementById('firm-ws-seat-count');
    var listEl = document.getElementById('firm-ws-seats-list');
    var tplList = document.getElementById('firm-ws-tpl-list');
    if (nameEl) nameEl.value = ws.firmName || '';
    if (brandEl) brandEl.value = ws.brandingFooter || '';
    if (shareEl) shareEl.checked = ws.shareTemplatesAcrossSeats !== false;
    if (countEl) countEl.textContent = '(' + (ws.seats || []).length + ' / ' + (ws.seatLimit || 5) + ')';
    if (listEl) {
      listEl.innerHTML = '';
      (ws.seats || []).forEach(function (s) {
        var li = document.createElement('li');
        li.style.marginBottom = '0.35rem';
        li.textContent = s.email + ' (' + s.role + ') ';
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn btn-secondary btn-small';
        rm.textContent = 'Remove';
        rm.addEventListener('click', function () {
          window.api.firmWorkspaceRemoveSeat({ email: s.email }).then(function (res) {
            if (res && res.ok) renderFirmWorkspace(res.workspace);
            else toast((res && res.error) || 'Could not remove seat', 'error');
          });
        });
        li.appendChild(rm);
        listEl.appendChild(li);
      });
    }
    if (tplList) {
      tplList.innerHTML = '';
      (ws.sharedTemplates || []).forEach(function (t) {
        var li = document.createElement('li');
        li.style.marginBottom = '0.35rem';
        li.textContent = t.name + ' ';
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn btn-secondary btn-small';
        rm.textContent = 'Remove';
        rm.addEventListener('click', function () {
          window.api.firmWorkspaceRemoveTemplate({ id: t.id }).then(function (res) {
            if (res && res.ok) renderFirmWorkspace(res.workspace);
            else toast((res && res.error) || 'Could not remove template', 'error');
          });
        });
        li.appendChild(rm);
        tplList.appendChild(li);
      });
    }
  }

  function loadFirmWorkspace() {
    if (!window.api || typeof window.api.firmWorkspaceGet !== 'function') return;
    window.api.firmWorkspaceGet().then(function (res) {
      if (res && res.ok) renderFirmWorkspace(res.workspace);
    });
  }

  function wireUi() {
    var saveFirm = document.getElementById('btn-firm-ws-save');
    if (saveFirm) {
      saveFirm.addEventListener('click', function () {
        window.api
          .firmWorkspaceSave({
            firmName: (document.getElementById('firm-ws-name') || {}).value,
            brandingFooter: (document.getElementById('firm-ws-branding') || {}).value,
            shareTemplatesAcrossSeats: !!(document.getElementById('firm-ws-share-templates') || {}).checked,
          })
          .then(function (res) {
            var msg = document.getElementById('firm-ws-save-msg');
            if (res && res.ok) {
              renderFirmWorkspace(res.workspace);
              if (msg) {
                msg.style.display = '';
                msg.textContent = 'Firm details saved on this device.';
              }
              toast('Firm workspace saved', 'success');
              if (window.api.quickfileSettingsPush) {
                window.api.quickfileSettingsPush().catch(function () {});
              }
            } else toast('Could not save firm workspace', 'error');
          });
      });
    }
    var addSeat = document.getElementById('btn-firm-ws-add-seat');
    if (addSeat) {
      addSeat.addEventListener('click', function () {
        var email = (document.getElementById('firm-ws-seat-email') || {}).value;
        var role = (document.getElementById('firm-ws-seat-role') || {}).value;
        window.api.firmWorkspaceAddSeat({ email: email, role: role }).then(function (res) {
          if (res && res.ok) {
            renderFirmWorkspace(res.workspace);
            var inp = document.getElementById('firm-ws-seat-email');
            if (inp) inp.value = '';
            if (window.api.quickfileSettingsPush) window.api.quickfileSettingsPush().catch(function () {});
          } else toast((res && res.error) || 'Could not add seat', 'error');
        });
      });
    }
    var addTpl = document.getElementById('btn-firm-ws-add-tpl');
    if (addTpl) {
      addTpl.addEventListener('click', function () {
        window.api
          .firmWorkspaceAddTemplate({
            name: (document.getElementById('firm-ws-tpl-name') || {}).value,
            body: (document.getElementById('firm-ws-tpl-body') || {}).value,
          })
          .then(function (res) {
            if (res && res.ok) {
              renderFirmWorkspace(res.workspace);
              var n = document.getElementById('firm-ws-tpl-name');
              var b = document.getElementById('firm-ws-tpl-body');
              if (n) n.value = '';
              if (b) b.value = '';
              if (window.api.quickfileSettingsPush) window.api.quickfileSettingsPush().catch(function () {});
            } else toast((res && res.error) || 'Could not add template', 'error');
          });
      });
    }

    var anywhereBtn = document.getElementById('btn-anywhere-bridge-import');
    if (anywhereBtn) {
      anywhereBtn.addEventListener('click', function () {
        var status = document.getElementById('anywhere-bridge-status');
        if (status) status.textContent = 'Opening file picker\u2026';
        window.api.anywhereBridgeChooseAndImport().then(function (res) {
          if (res && res.cancelled) {
            if (status) status.textContent = '';
            return;
          }
          if (!res || !res.ok) {
            if (status) status.textContent = (res && res.error) || 'Import failed';
            toast((res && res.error) || 'Anywhere import failed', 'error', 6000);
            return;
          }
          var msg =
            'Imported ' +
            (res.imported || 0) +
            ' of ' +
            (res.total || 0) +
            ' Anywhere record(s) as drafts.';
          if (status) status.textContent = msg;
          toast(msg, 'success', 6000);
          try {
            if (typeof loadList === 'function') loadList();
          } catch (_) {}
        });
      });
    }

    loadFirmWorkspace();
  }

  window.FreemiumFeatures = {
    loadFirmWorkspace: loadFirmWorkspace,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUi);
  } else {
    wireUi();
  }
})();

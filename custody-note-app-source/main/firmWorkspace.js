/**
 * Firm workspace local MVP — seats, branding, shared templates.
 * Persisted via settings JSON (desktop). Server seats come later.
 */
function normaliseTemplate(t) {
  if (!t || typeof t !== 'object') return null;
  const name = String(t.name || '').trim();
  const body = String(t.body || '').trim();
  if (!name) return null;
  return {
    id: String(t.id || ('tpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7))),
    name: name.slice(0, 120),
    body: body.slice(0, 20000),
  };
}

function normaliseFirmWorkspace(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const seats = Array.isArray(src.seats) ? src.seats : [];
  const templates = Array.isArray(src.sharedTemplates) ? src.sharedTemplates : [];
  return {
    firmName: String(src.firmName || '').trim(),
    seatLimit: Math.max(1, Math.min(50, parseInt(src.seatLimit, 10) || 5)),
    brandingFooter: String(src.brandingFooter || '').trim(),
    shareTemplatesAcrossSeats: src.shareTemplatesAcrossSeats !== false,
    seats: seats
      .map((s) => ({
        email: String((s && s.email) || '')
          .trim()
          .toLowerCase(),
        role: (s && s.role) === 'admin' ? 'admin' : 'member',
        invitedAt: String((s && s.invitedAt) || new Date().toISOString()),
      }))
      .filter((s) => s.email && s.email.indexOf('@') > 0),
    sharedTemplates: templates.map(normaliseTemplate).filter(Boolean).slice(0, 40),
    updatedAt: String(src.updatedAt || new Date().toISOString()),
  };
}

function addSharedTemplate(workspace, name, body) {
  const ws = normaliseFirmWorkspace(workspace);
  const tpl = normaliseTemplate({ name, body });
  if (!tpl) return { ok: false, error: 'Enter a template name' };
  ws.sharedTemplates.push(tpl);
  ws.updatedAt = new Date().toISOString();
  return { ok: true, workspace: ws, template: tpl };
}

function removeSharedTemplate(workspace, id) {
  const ws = normaliseFirmWorkspace(workspace);
  const tid = String(id || '');
  ws.sharedTemplates = ws.sharedTemplates.filter((t) => t.id !== tid);
  ws.updatedAt = new Date().toISOString();
  return { ok: true, workspace: ws };
}

function canAddSeat(workspace, email) {
  const ws = normaliseFirmWorkspace(workspace);
  const em = String(email || '')
    .trim()
    .toLowerCase();
  if (!em || em.indexOf('@') < 1) return { ok: false, error: 'Enter a valid email address' };
  if (ws.seats.some((s) => s.email === em)) return { ok: false, error: 'That email is already invited' };
  if (ws.seats.length >= ws.seatLimit) {
    return { ok: false, error: 'Seat limit reached (' + ws.seatLimit + '). Contact sales for more seats.' };
  }
  return { ok: true };
}

function addSeat(workspace, email, role) {
  const check = canAddSeat(workspace, email);
  if (!check.ok) return check;
  const ws = normaliseFirmWorkspace(workspace);
  ws.seats.push({
    email: String(email).trim().toLowerCase(),
    role: role === 'admin' ? 'admin' : 'member',
    invitedAt: new Date().toISOString(),
  });
  ws.updatedAt = new Date().toISOString();
  return { ok: true, workspace: ws };
}

function removeSeat(workspace, email) {
  const ws = normaliseFirmWorkspace(workspace);
  const em = String(email || '')
    .trim()
    .toLowerCase();
  ws.seats = ws.seats.filter((s) => s.email !== em);
  ws.updatedAt = new Date().toISOString();
  return { ok: true, workspace: ws };
}

module.exports = {
  normaliseFirmWorkspace,
  canAddSeat,
  addSeat,
  removeSeat,
  addSharedTemplate,
  removeSharedTemplate,
};

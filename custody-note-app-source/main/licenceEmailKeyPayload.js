/**
 * Build POST body for /api/licence/email-key.
 * Licence key and account email from licence.dat are authoritative;
 * renderer practice-email must not override an activated licence key.
 */
function buildLicenceEmailKeyPayload(licenceData, rendererParams) {
  const payload = {};
  const data = licenceData || {};
  const params = rendererParams || {};

  if (data.key && String(data.key).trim()) {
    payload.key = String(data.key).trim();
    return payload;
  }

  if (data.email && String(data.email).trim()) {
    payload.email = String(data.email).trim().toLowerCase();
    return payload;
  }

  if (params.email && String(params.email).trim()) {
    payload.email = String(params.email).trim().toLowerCase();
    return payload;
  }

  return payload;
}

module.exports = { buildLicenceEmailKeyPayload };

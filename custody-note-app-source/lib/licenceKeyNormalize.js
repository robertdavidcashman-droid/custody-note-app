'use strict';

/**
 * Licence keys used for custodynote.com sync must match escrow + mock server
 * hashing (trim + uppercase). Sending mixed-case keys risks a different
 * cloud namespace than the Mac that pushed (Windows Full re-sync → received:0).
 */
function normalizeLicenceKeyForSync(key) {
  if (key == null) return '';
  return String(key).trim().toUpperCase();
}

module.exports = {
  normalizeLicenceKeyForSync,
};

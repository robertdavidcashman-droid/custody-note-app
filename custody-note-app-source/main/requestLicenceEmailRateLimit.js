/**
 * Rate limit: requestLicenceEmail — 5 per minute per machine.
 */
const RATE_LIMIT = 5;
const WINDOW_MS = 60 * 1000;

const _requests = [];
const MAX_ENTRIES = 100;

function cleanup(now) {
  const cutoff = now - WINDOW_MS;
  while (_requests.length && _requests[0] < cutoff) {
    _requests.shift();
  }
  if (_requests.length > MAX_ENTRIES) {
    _requests.splice(0, _requests.length - MAX_ENTRIES);
  }
}

function checkRateLimit() {
  const now = Date.now();
  cleanup(now);
  if (_requests.length >= RATE_LIMIT) {
    return false;
  }
  _requests.push(now);
  return true;
}

function resetForTest() {
  _requests.length = 0;
}

module.exports = { checkRateLimit, resetForTest };

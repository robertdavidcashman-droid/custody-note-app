'use strict';

var NFA_VALUE = 'No Fixed Abode';
var ADDRESS_KEYS = ['address1', 'address2', 'address3', 'city', 'county', 'postCode'];

function isTruthyNfaFlag(value) {
  return value === true || value === 'Yes' || value === 'yes' || value === '1';
}

function isAddressNfa(data) {
  data = data || {};
  if (isTruthyNfaFlag(data.addressNfa)) return true;
  return String(data.address1 || '').trim().toLowerCase() === NFA_VALUE.toLowerCase();
}

function formatClientAddress(data, separator) {
  data = data || {};
  separator = separator == null ? ', ' : separator;
  if (isAddressNfa(data)) return NFA_VALUE;
  return ADDRESS_KEYS.map(function (k) { return String(data[k] || '').trim(); }).filter(Boolean).join(separator);
}

var ClientAddress = {
  NFA_VALUE: NFA_VALUE,
  ADDRESS_KEYS: ADDRESS_KEYS,
  isAddressNfa: isAddressNfa,
  formatClientAddress: formatClientAddress,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClientAddress;
}
if (typeof window !== 'undefined') {
  window.ClientAddress = ClientAddress;
}

/*
 * QuickFile API client core — pure, dependency-injected helpers so the network
 * behaviour can be unit-tested with MOCK responses (never hitting the live API).
 *
 * QuickFile auth model (important, do not replace with OAuth): every request is
 * authenticated with Account Number + API Key + a per-request Submission Number,
 * hashed together with MD5. There is no bearer token, refresh token, cookie or
 * redirect URI. A fresh Submission Number + MD5 is built for every call, so
 * there is nothing to "expire" or refresh — this module guarantees that.
 */
'use strict';

const crypto = require('crypto');

/**
 * Build the QuickFile authentication block for one request.
 * @param {object} creds { accountNumber, apiKey, applicationId }
 * @param {object} [opts] { submissionNumber, md5 } injectable for deterministic tests
 * @returns {{accountNumber,submissionNumber,md5Value,applicationId}}
 * @throws {Error} with a clear, user-facing message if any credential is missing.
 */
function buildQuickFileAuth(creds, opts) {
  const c = creds || {};
  const accountNumber = String(c.accountNumber || '').trim();
  const apiKey = String(c.apiKey || '').trim();
  const applicationId = String(c.applicationId || '').trim();

  const missing = [];
  if (!accountNumber) missing.push('Account number');
  if (!apiKey) missing.push('API key');
  if (!applicationId) missing.push('Application ID');
  if (missing.length) {
    throw new Error('QuickFile not configured \u2014 missing in Settings: ' + missing.join(', ') + '.');
  }

  const submissionNumber = (opts && opts.submissionNumber)
    || ('cn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
  const md5fn = (opts && opts.md5) || function (input) {
    return crypto.createHash('md5').update(input, 'utf8').digest('hex').toLowerCase();
  };
  const md5Value = md5fn(accountNumber + apiKey + submissionNumber);

  return { accountNumber, submissionNumber, md5Value, applicationId };
}

/**
 * Parse a raw QuickFile HTTP response into the message Body, or throw a clear Error.
 * Mirrors the live response shapes (Errors array, Header.Status === 'Error', non-2xx,
 * empty/invalid JSON). Pure: feed it mock strings in tests.
 * @param {number} statusCode
 * @param {string} raw response body text
 * @returns {object} the message Body
 * @throws {Error} with a specific, human-readable reason on any failure.
 */
function parseQuickFileResponse(statusCode, raw) {
  const text = String(raw || '');
  if (!text.trim()) {
    throw new Error('QuickFile returned empty response (HTTP ' + statusCode + ')');
  }
  let json;
  try { json = JSON.parse(text); } catch (_) { json = null; }

  if (json && json.Errors) {
    const errs = json.Errors.Error || json.Errors;
    const errArr = Array.isArray(errs) ? errs : [errs];
    const msgs = errArr.map((e) => (typeof e === 'object' && e !== null)
      ? (e.Message || e.Detail || JSON.stringify(e))
      : String(e));
    throw new Error(msgs.join('; '));
  }
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('QuickFile HTTP ' + statusCode + ': ' + text.slice(0, 300));
  }
  if (!json) {
    throw new Error('QuickFile response parse error (HTTP ' + statusCode + ')');
  }
  const rootKey = Object.keys(json).find((k) => typeof json[k] === 'object' && json[k] && json[k].Header);
  const msg = rootKey ? json[rootKey] : ((json.payload && json.payload.Message) || json.Message || json);
  const header = msg && msg.Header;
  if (header && header.Status === 'Error') {
    const errMsg = (header && (header.StatusMessage || header.ErrorMessage))
      || (msg && msg.Body && msg.Body.ErrorMessage)
      || 'Unknown QuickFile error';
    throw new Error(String(errMsg));
  }
  return (msg && msg.Body) || {};
}

/**
 * Build Body for Client_Create. Schema only allows CompanyName (and optional
 * address/prefs) under ClientDetails — not ClientType or top-level Email.
 * Email belongs under ClientContacts.DefaultContact (separate namespace); we omit
 * contacts here so create stays CompanyName-only and never invents a Password.
 * @param {string} firmName
 * @param {string} [_contactEmail] ignored (kept for call-site compatibility)
 * @returns {{ClientDetails:{CompanyName:string}}}
 * @throws {Error} if firm name is empty after trim
 */
function buildQuickFileClientCreateBody(firmName, _contactEmail) {
  const companyName = String(firmName || '').trim().slice(0, 100);
  if (!companyName) {
    throw new Error('Firm name is required to create a QuickFile client');
  }
  return {
    ClientDetails: {
      CompanyName: companyName,
    },
  };
}

/**
 * Join non-empty address parts with commas.
 * @param {unknown[]} parts
 * @returns {string}
 */
function joinQuickFileAddress(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Extract a single-line postal address from a QuickFile client/search or get payload.
 * @param {object|null|undefined} client
 * @returns {string}
 */
function extractQuickFileAddress(client) {
  if (!client || typeof client !== 'object') return '';
  const candidates = [
    client.Address,
    client.InvoiceAddress,
    client.DeliveryAddress,
    client.PostalAddress,
    client.PrimaryAddress,
    client.AddressDetails,
  ];
  for (const address of candidates) {
    if (!address) continue;
    if (typeof address === 'string') {
      const text = address.trim();
      if (text) return text;
      continue;
    }
    if (typeof address === 'object') {
      const joined = joinQuickFileAddress([
        address.Line1,
        address.Line2,
        address.Line3,
        address.Line4,
        address.Line5,
        address.AddressLine1,
        address.AddressLine2,
        address.AddressLine3,
        address.AddressLine4,
        address.AddressLine5,
        address.City,
        address.Town,
        address.County,
        address.Postcode,
        address.PostCode,
        address.Zip,
        address.Country,
      ]);
      if (joined) return joined;
    }
  }
  return joinQuickFileAddress([
    client.AddressLine1,
    client.AddressLine2,
    client.AddressLine3,
    client.AddressLine4,
    client.AddressLine5,
    client.City,
    client.Town,
    client.County,
    client.Postcode,
    client.PostCode,
    client.Zip,
    client.Country,
  ]);
}

/**
 * Pick the best contact from a Client_Get ClientContacts list.
 * Prefers DefaultContact / IsDefault / Primary, else first entry.
 * @param {object|null|undefined} getBody Client_Get Body (or nested client)
 * @returns {{contactName:string,email:string,telephone:string}}
 */
function pickQuickFileContact(getBody) {
  const empty = { contactName: '', email: '', telephone: '' };
  if (!getBody || typeof getBody !== 'object') return empty;

  let list = getBody.ClientContacts;
  if (list && typeof list === 'object' && !Array.isArray(list)) {
    list = list.Contact || list.Contacts || list.ClientContact || list;
  }
  if (!Array.isArray(list)) {
    list = list ? [list] : [];
  }
  list = list.filter((c) => c && typeof c === 'object');
  if (!list.length) return empty;

  const preferred = list.find((c) => c.DefaultContact === true || c.DefaultContact === 'true'
    || c.IsDefault === true || c.IsDefault === 'true'
    || c.Primary === true || c.Primary === 'true') || list[0];

  const contactName = String(
    preferred.ContactName
    || preferred.Name
    || [preferred.FirstName || '', preferred.Surname || preferred.LastName || ''].filter(Boolean).join(' ')
  ).trim();
  const email = String(preferred.Email || preferred.EmailAddress || '').trim();
  const telephone = String(
    preferred.Telephone || preferred.Phone || preferred.Mobile || preferred.TelephoneNumber || ''
  ).trim();

  return { contactName, email, telephone };
}

/**
 * Normalise a Client_Search row into the firm-import shape (no Client_Get yet).
 * @param {object|null|undefined} client
 * @returns {{clientId:string,companyName:string,contactName:string,email:string,telephone:string,address:string}}
 */
function normaliseQuickFileSearchClient(client) {
  const c = client && typeof client === 'object' ? client : {};
  const primary = c.PrimaryContact || c.Contact || {};
  return {
    clientId: String(c.ClientID || c.ClientId || '').trim(),
    companyName: String(c.ClientName || c.CompanyName || c.Name || '').trim(),
    contactName: String(
      c.ContactName
      || [primary.FirstName || c.ContactFirstName || '', primary.Surname || c.ContactLastName || ''].filter(Boolean).join(' ')
    ).trim(),
    email: String(c.Email || primary.Email || '').trim(),
    telephone: String(c.Telephone || primary.Telephone || primary.Phone || '').trim(),
    address: extractQuickFileAddress(c),
  };
}

/**
 * Merge a search-row normalisation with an optional Client_Get Body.
 * Get wins for address and contact fields when present; company name / id fall back to search.
 * @param {object} searchNorm from normaliseQuickFileSearchClient
 * @param {object|null|undefined} getBody Client_Get Body (null/undefined = search-only)
 * @returns {{clientId:string,companyName:string,contactName:string,email:string,telephone:string,address:string}}
 */
function mergeQuickFileClientDetails(searchNorm, getBody) {
  const base = searchNorm && typeof searchNorm === 'object' ? searchNorm : normaliseQuickFileSearchClient(null);
  const out = {
    clientId: String(base.clientId || '').trim(),
    companyName: String(base.companyName || '').trim(),
    contactName: String(base.contactName || '').trim(),
    email: String(base.email || '').trim(),
    telephone: String(base.telephone || '').trim(),
    address: String(base.address || '').trim(),
  };
  if (!getBody || typeof getBody !== 'object') return out;

  const getCompany = String(
    getBody.ClientName || getBody.CompanyName || getBody.Name
    || (getBody.ClientDetails && (getBody.ClientDetails.CompanyName || getBody.ClientDetails.ClientName))
    || ''
  ).trim();
  if (getCompany) out.companyName = getCompany;

  const getId = String(getBody.ClientID || getBody.ClientId || '').trim();
  if (getId) out.clientId = getId;

  const getAddress = extractQuickFileAddress(getBody);
  if (getAddress) out.address = getAddress;

  const contact = pickQuickFileContact(getBody);
  if (contact.contactName) out.contactName = contact.contactName;
  if (contact.email) out.email = contact.email;
  if (contact.telephone) out.telephone = contact.telephone;

  /* Some Client_Get payloads put email/phone on the root when contacts are absent. */
  if (!out.email && getBody.Email) out.email = String(getBody.Email).trim();
  if (!out.telephone && (getBody.Telephone || getBody.Phone)) {
    out.telephone = String(getBody.Telephone || getBody.Phone).trim();
  }

  return out;
}

/**
 * Run async work over items with a fixed concurrency limit.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  const results = new Array(list.length);
  let next = 0;

  async function runOne() {
    while (next < list.length) {
      const i = next;
      next += 1;
      results[i] = await worker(list[i], i);
    }
  }

  const runners = [];
  for (let r = 0; r < limit; r += 1) runners.push(runOne());
  await Promise.all(runners);
  return results;
}

module.exports = {
  buildQuickFileAuth,
  parseQuickFileResponse,
  buildQuickFileClientCreateBody,
  joinQuickFileAddress,
  extractQuickFileAddress,
  pickQuickFileContact,
  normaliseQuickFileSearchClient,
  mergeQuickFileClientDetails,
  mapWithConcurrency,
};

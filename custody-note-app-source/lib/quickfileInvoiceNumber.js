'use strict';

/**
 * QuickFile invoice-number helpers — pure / injectable so sequential allocation
 * and duplicate recovery can be unit-tested without hitting the live API or
 * Electron main process.
 *
 * Contract (going forward):
 * - next number = last successfully issued (or confirmed occupied) + 1
 * - allocate is peek-only — never burn a number before create succeeds
 * - on "already used": bump past the attempted number only (smallest free ≥ next)
 * - same-attendance reuse does not consume a new sequence number
 */

const MAX_INVOICE_NUMBER_ATTEMPTS = 35;
const PURCHASE_REF_MAX = 25;
const DEFAULT_START = 6066;

/**
 * Largest numeric segment from an invoice reference (handles "006069", "INV-6069").
 * @param {unknown} raw
 * @returns {number}
 */
function parseInvoiceNumberNumericPart(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return NaN;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Format a positive integer as a zero-padded QuickFile-style invoice number.
 * @param {number} n
 * @param {number} [width=6]
 * @returns {string}
 */
function formatInvoiceNumber(n, width) {
  const w = Number.isFinite(width) && width > 0 ? width : 6;
  return String(n).padStart(w, '0');
}

/**
 * Pure sequential counter: peeks without burning; advances only on markOccupied /
 * markIssued (both mean "N is taken, next create must use ≥ N+1").
 *
 * @param {object} [opts]
 * @param {number} [opts.initialNext]
 * @param {number} [opts.width]
 * @returns {{
 *   peek: () => number,
 *   peekFormatted: () => string,
 *   markOccupied: (raw: unknown) => number,
 *   markIssued: (raw: unknown) => number,
 *   getNext: () => number,
 * }}
 */
function createSequentialInvoiceCounter(opts) {
  const o = opts || {};
  const width = Number.isFinite(o.width) && o.width > 0 ? o.width : 6;
  let next = Number(o.initialNext);
  if (!Number.isFinite(next) || next < 1) next = DEFAULT_START;

  function ensurePast(raw) {
    const n = parseInvoiceNumberNumericPart(raw);
    if (!Number.isFinite(n) || n < 1) return next;
    const required = n + 1;
    if (next < required) next = required;
    return next;
  }

  return {
    peek() {
      return next;
    },
    peekFormatted() {
      return formatInvoiceNumber(next, width);
    },
    /** Confirmed occupied (duplicate conflict or ledger sync). */
    markOccupied(raw) {
      return ensurePast(raw);
    },
    /** Successfully created/issued — persist so the following create is previous+1. */
    markIssued(raw) {
      return ensurePast(raw);
    },
    getNext() {
      return next;
    },
  };
}

/**
 * Stable PurchaseReference for an attendance (QuickFile max length 25).
 * @param {unknown} attendanceId
 * @returns {string}
 */
function attendancePurchaseReference(attendanceId) {
  const id = String(attendanceId == null ? '' : attendanceId).trim();
  if (!id) return '';
  return ('CN-ATT-' + id).slice(0, PURCHASE_REF_MAX);
}

/**
 * Marker embedded in Notes so older/partial invoices can still be matched.
 * @param {unknown} attendanceId
 * @returns {string}
 */
function attendanceNotesMarker(attendanceId) {
  const id = String(attendanceId == null ? '' : attendanceId).trim();
  if (!id) return '';
  return '[CN-ATT:' + id + ']';
}

/**
 * Append the attendance marker to Notes without inventing narrative content.
 * @param {string} notes
 * @param {unknown} attendanceId
 * @returns {string}
 */
function appendAttendanceNotesMarker(notes, attendanceId) {
  const marker = attendanceNotesMarker(attendanceId);
  if (!marker) return String(notes || '');
  const base = String(notes || '');
  if (base.toLowerCase().includes(marker.toLowerCase())) return base;
  const joined = base ? (base.replace(/\s+$/, '') + '\n' + marker) : marker;
  return joined.slice(0, 4000);
}

/**
 * True when a QuickFile invoice search/get row clearly belongs to this attendance.
 * @param {object|null|undefined} record
 * @param {unknown} attendanceId
 * @returns {boolean}
 */
function invoiceBelongsToAttendance(record, attendanceId) {
  if (!record || typeof record !== 'object' || attendanceId == null || attendanceId === '') {
    return false;
  }
  const ref = attendancePurchaseReference(attendanceId);
  const purchaseRef = String(
    record.PurchaseReference || record.PurchaseRef || record.purchaseReference || ''
  ).trim();
  if (ref && purchaseRef && purchaseRef === ref) return true;

  const marker = attendanceNotesMarker(attendanceId).toLowerCase();
  if (!marker) return false;
  const notes = String(
    record.Notes || record.InvoiceNotes || record.Note || record.Description || ''
  ).toLowerCase();
  return notes.includes(marker);
}

/**
 * Detect QuickFile "invoice number already used/exists" errors across known variants.
 * @param {unknown} err
 * @returns {boolean}
 */
function isQuickFileInvoiceNumberDuplicateError(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  if (!msg) return false;

  /* Explicit phrases seen in UI / community / API-ish responses */
  const phrases = [
    'already exists',
    'already exist',
    'already used',
    'already in use',
    'already been used',
    'already there',
    'already taken',
    'has already been allocated',
    'number is in use',
    'number in use',
    'invoice number is not unique',
    'invoice number not unique',
    'duplicate invoice number',
    'invoice number duplicate',
  ];
  for (let i = 0; i < phrases.length; i++) {
    if (msg.includes(phrases[i])) return true;
  }

  if (msg.includes('duplicate') && msg.includes('invoice')) return true;

  /* "invoice number … already …" with filler words (is/has/been) */
  if (/invoice\s*(?:#|no\.?|number)?\s*[\w-]*\s+(?:is\s+|has\s+)?(?:already|in use)/.test(msg)) {
    return true;
  }
  if (/invoicenumber\s+(?:is\s+|has\s+)?(?:already|in use)/.test(msg)) return true;

  /* "006066 already exists" / "Invoice #006066 already…" */
  if (/\b\d{3,}\b/.test(msg) && /already\s+(exists|exist|used|taken|there|in use)/.test(msg)) {
    return true;
  }

  return false;
}

/**
 * Best-effort extract of the conflicting invoice number from an error message.
 * Kept for diagnostics; recovery must not jump to a mis-parsed larger number.
 * @param {unknown} err
 * @returns {string}
 */
function extractConflictingInvoiceNumber(err) {
  const msg = String((err && err.message) || err || '');
  if (!msg) return '';
  const patterns = [
    /invoice\s*(?:#|no\.?|number)?\s*[:=]?\s*([A-Za-z0-9-]{1,20})/i,
    /invoicenumber\s*[:=]?\s*([A-Za-z0-9-]{1,20})/i,
    /\b(\d{4,20})\b/,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = msg.match(patterns[i]);
    if (m && m[1] && /[0-9]/.test(m[1])) return String(m[1]).trim();
  }
  return '';
}

/**
 * Normalise Invoice_Search body into a record array.
 * @param {object|null|undefined} body
 * @returns {object[]}
 */
function quickFileExtractInvoiceSearchRecords(body) {
  if (!body || typeof body !== 'object') return [];
  const list =
    body.Record ||
    body.Records ||
    body.InvoiceDetails ||
    body.Invoices ||
    body.InvoiceList ||
    [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.filter(Boolean);
}

/**
 * Pick InvoiceID / InvoiceNumber from a create body or search row.
 * @param {object|null|undefined} body
 * @param {string} [fallbackNumber]
 * @returns {{invoiceId:string,invoiceNumber:string}}
 */
function pickInvoiceIdentity(body, fallbackNumber) {
  const b = body && typeof body === 'object' ? body : {};
  const invoiceId = String(
    b.InvoiceID || b.InvoiceId || b.RecordID || b.invoiceId || ''
  ).trim();
  const invoiceNumber = String(
    b.InvoiceNumber || b.Invoice_No || b.InvoiceNo || b.InvoiceNum || fallbackNumber || ''
  ).trim();
  return { invoiceId, invoiceNumber };
}

/**
 * Persist helper: ensure next candidate is strictly above an occupied/issued number.
 * Used by both conflict bumps and successful-issue persistence.
 * @param {(raw: string) => void} [persistPast]
 * @param {string} raw
 */
function persistPastNumber(persistPast, raw) {
  if (typeof persistPast !== 'function' || !raw) return;
  try {
    persistPast(raw);
  } catch (_) {
    /* ignore persistence failures during recovery */
  }
}

/**
 * Create an invoice with bounded duplicate-number recovery and strict sequencing.
 *
 * Prefer reuse when an existing QuickFile invoice clearly belongs to this
 * attendance (does not consume a new sequence number) — unless allowDuplicate
 * is set (user confirmed a second invoice). Otherwise peek the next candidate,
 * create, and on conflict bump only past the attempted number (smallest free ≥
 * expected next) — never jump ahead from a mis-parsed error.
 *
 * @param {object} opts
 * @param {() => string} opts.allocateNextNumber  Peek-only: must NOT advance the counter
 * @param {(invNum: string) => Promise<object>} opts.createWithNumber
 * @param {(raw: string) => void} [opts.bumpPastNumber]  Persist next ≥ raw+1 (conflict + success)
 * @param {() => Promise<object|null|undefined>} [opts.findByAttendanceRef]
 * @param {(invNum: string) => Promise<object|null|undefined>} [opts.findByInvoiceNumber]
 * @param {unknown} [opts.attendanceId]
 * @param {boolean} [opts.allowDuplicate]  When true, never reuse a same-attendance invoice;
 *   allocate a new sequential number and create a genuine second QuickFile invoice.
 * @param {number} [opts.maxAttempts]
 * @param {(err: unknown, invNum: string) => void} [opts.onConflictWarn]
 * @returns {Promise<{reused:boolean,invoiceBody:object,invoiceNumber:string,invoiceId:string}>}
 */
async function createInvoiceWithDuplicateRecovery(opts) {
  const o = opts || {};
  const maxAttempts = Math.max(1, Number(o.maxAttempts) || MAX_INVOICE_NUMBER_ATTEMPTS);
  const attendanceId = o.attendanceId;
  const allowDuplicate = !!o.allowDuplicate;

  if (typeof o.allocateNextNumber !== 'function') {
    throw new Error('allocateNextNumber is required');
  }
  if (typeof o.createWithNumber !== 'function') {
    throw new Error('createWithNumber is required');
  }

  /* Accidental double-send recovery: reuse tagged invoice for this attendance.
     Explicit second invoice (allowDuplicate) must skip reuse and create anew. */
  if (
    !allowDuplicate
    && attendanceId != null && attendanceId !== ''
    && typeof o.findByAttendanceRef === 'function'
  ) {
    const existing = await o.findByAttendanceRef();
    if (existing && invoiceBelongsToAttendance(existing, attendanceId)) {
      const id = pickInvoiceIdentity(existing);
      /* Reuse does not burn a new sequence number — counter unchanged. */
      return {
        reused: true,
        invoiceBody: existing,
        invoiceId: id.invoiceId,
        invoiceNumber: id.invoiceNumber,
      };
    }
  }

  let lastCreateErr;
  let lastAttempted = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const invNum = String(o.allocateNextNumber() || '').trim();
    if (!invNum) {
      throw new Error('allocateNextNumber returned an empty invoice number');
    }
    /* Guard against a non-peek allocator that fails to advance after bump:
       if we see the same candidate twice in a row after a conflict, abort. */
    if (attempt > 0 && invNum === lastAttempted) {
      throw new Error(
        'Invoice number allocator did not advance after conflict on #' + invNum
        + ' (allocateNextNumber must be peek-only; bumpPastNumber must persist next)'
      );
    }
    lastAttempted = invNum;

    try {
      const invoiceBody = await o.createWithNumber(invNum);
      const id = pickInvoiceIdentity(invoiceBody, invNum);
      const issued = id.invoiceNumber || invNum;
      /* Persist last issued so the following create is always previous+1. */
      persistPastNumber(o.bumpPastNumber, issued);
      return {
        reused: false,
        invoiceBody: invoiceBody || {},
        invoiceId: id.invoiceId,
        invoiceNumber: issued,
      };
    } catch (e) {
      lastCreateErr = e;
      if (!isQuickFileInvoiceNumberDuplicateError(e)) throw e;

      /* Same-attendance attach on number conflict is accidental-double recovery.
         When allowDuplicate, that invoice is intentionally a prior one — bump past
         and keep creating a new invoice instead of linking the old. */
      if (
        !allowDuplicate
        && attendanceId != null && attendanceId !== ''
        && typeof o.findByInvoiceNumber === 'function'
      ) {
        try {
          const found = await o.findByInvoiceNumber(invNum);
          if (found && invoiceBelongsToAttendance(found, attendanceId)) {
            const id = pickInvoiceIdentity(found, invNum);
            /* Number is occupied (ours) — ensure next create uses ≥ invNum+1,
               but this link is not a new issue so we only mark occupied. */
            persistPastNumber(o.bumpPastNumber, id.invoiceNumber || invNum);
            return {
              reused: true,
              invoiceBody: found,
              invoiceId: id.invoiceId,
              invoiceNumber: id.invoiceNumber || invNum,
            };
          }
        } catch (_) {
          /* search failure must not block retrying the next free number */
        }
      }

      /*
       * Strict sequence: bump past the number we actually submitted only.
       * Do NOT jump to a larger number extracted from error text — that caused
       * non-contiguous skips after the v1.9.87 recovery work.
       */
      persistPastNumber(o.bumpPastNumber, invNum);
      if (typeof o.onConflictWarn === 'function') {
        try { o.onConflictWarn(e, invNum); } catch (_) { /* ignore */ }
      }
      if (attempt === maxAttempts - 1) throw e;
    }
  }
  throw lastCreateErr || new Error('QuickFile invoice/create failed');
}

module.exports = {
  MAX_INVOICE_NUMBER_ATTEMPTS,
  DEFAULT_START,
  parseInvoiceNumberNumericPart,
  formatInvoiceNumber,
  createSequentialInvoiceCounter,
  attendancePurchaseReference,
  attendanceNotesMarker,
  appendAttendanceNotesMarker,
  invoiceBelongsToAttendance,
  isQuickFileInvoiceNumberDuplicateError,
  extractConflictingInvoiceNumber,
  quickFileExtractInvoiceSearchRecords,
  pickInvoiceIdentity,
  createInvoiceWithDuplicateRecovery,
};

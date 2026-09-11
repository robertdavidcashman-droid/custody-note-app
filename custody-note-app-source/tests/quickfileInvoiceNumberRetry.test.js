/**
 * QuickFile invoice-number sequential allocation + duplicate recovery.
 * Unit tests with MOCK create/search — never hits the live QuickFile API.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  isQuickFileInvoiceNumberDuplicateError,
  extractConflictingInvoiceNumber,
  parseInvoiceNumberNumericPart,
  formatInvoiceNumber,
  createSequentialInvoiceCounter,
  attendancePurchaseReference,
  attendanceNotesMarker,
  appendAttendanceNotesMarker,
  invoiceBelongsToAttendance,
  pickInvoiceIdentity,
  createInvoiceWithDuplicateRecovery,
  quickFileExtractInvoiceSearchRecords,
  MAX_INVOICE_NUMBER_ATTEMPTS,
} = require('../lib/quickfileInvoiceNumber');

describe('isQuickFileInvoiceNumberDuplicateError', () => {
  const positives = [
    'Invoice number already exists',
    'The invoice number is already used',
    'Invoice number is already there',
    'Invoice #006066 already exists',
    '006070 already in use',
    'This InvoiceNumber has already been used',
    'Duplicate invoice number',
    'Invoice number already taken',
    'The Invoice Number you have specified is already in use',
    'Invoice number has already been allocated',
  ];
  for (const msg of positives) {
    it('matches: ' + msg, () => {
      assert.strictEqual(isQuickFileInvoiceNumberDuplicateError(new Error(msg)), true);
      assert.strictEqual(isQuickFileInvoiceNumberDuplicateError(msg), true);
    });
  }

  const negatives = [
    'Invalid MD5 signature',
    'ClientID is required',
    'QuickFile HTTP 500: Internal',
    'No billable items to invoice',
    'Account suspended',
  ];
  for (const msg of negatives) {
    it('does not match non-duplicate: ' + msg, () => {
      assert.strictEqual(isQuickFileInvoiceNumberDuplicateError(new Error(msg)), false);
    });
  }
});

describe('extractConflictingInvoiceNumber / parseInvoiceNumberNumericPart', () => {
  it('extracts padded numbers from error text', () => {
    assert.strictEqual(extractConflictingInvoiceNumber('Invoice #006066 already exists'), '006066');
    assert.strictEqual(parseInvoiceNumberNumericPart('006066'), 6066);
    assert.strictEqual(parseInvoiceNumberNumericPart('INV-6069'), 6069);
  });
});

describe('createSequentialInvoiceCounter', () => {
  it('successive issues get N, N+1, N+2 with no skips', () => {
    const counter = createSequentialInvoiceCounter({ initialNext: 7000 });
    const issued = [];
    for (let i = 0; i < 3; i++) {
      const n = counter.peekFormatted();
      issued.push(n);
      counter.markIssued(n);
    }
    assert.deepStrictEqual(issued, ['007000', '007001', '007002']);
    assert.strictEqual(counter.peekFormatted(), '007003');
  });

  it('conflict on N advances only to N+1 (smallest free), not a large jump', () => {
    const counter = createSequentialInvoiceCounter({ initialNext: 6066 });
    assert.strictEqual(counter.peekFormatted(), '006066');
    counter.markOccupied('006066');
    assert.strictEqual(counter.peekFormatted(), '006067');
    /* Marking a lower/equal occupied again is a no-op for further jumps */
    counter.markOccupied('006066');
    assert.strictEqual(counter.peekFormatted(), '006067');
  });

  it('markIssued persists so the following peek is previous+1', () => {
    const counter = createSequentialInvoiceCounter({ initialNext: 6100 });
    counter.markIssued('006100');
    assert.strictEqual(counter.getNext(), 6101);
    assert.strictEqual(formatInvoiceNumber(counter.peek()), '006101');
  });
});

describe('attendance markers and belonging', () => {
  it('builds a PurchaseReference within QuickFile length limit', () => {
    const ref = attendancePurchaseReference(12345);
    assert.strictEqual(ref, 'CN-ATT-12345');
    assert.ok(ref.length <= 25);
  });

  it('matches by PurchaseReference or Notes marker', () => {
    const id = 99;
    assert.strictEqual(
      invoiceBelongsToAttendance({ PurchaseReference: attendancePurchaseReference(id) }, id),
      true
    );
    assert.strictEqual(
      invoiceBelongsToAttendance({ Notes: 'Fees\n' + attendanceNotesMarker(id) }, id),
      true
    );
    assert.strictEqual(
      invoiceBelongsToAttendance({ PurchaseReference: 'OTHER', Notes: 'unrelated' }, id),
      false
    );
  });

  it('appendAttendanceNotesMarker is idempotent and preserves narrative', () => {
    const once = appendAttendanceNotesMarker('Police station fee', 7);
    assert.ok(once.startsWith('Police station fee'));
    assert.ok(once.includes(attendanceNotesMarker(7)));
    const twice = appendAttendanceNotesMarker(once, 7);
    assert.strictEqual(twice, once);
  });
});

describe('pickInvoiceIdentity', () => {
  it('falls back to submitted invoice number when response omits it', () => {
    const id = pickInvoiceIdentity({ InvoiceID: 555 }, '006100');
    assert.strictEqual(id.invoiceId, '555');
    assert.strictEqual(id.invoiceNumber, '006100');
  });
});

describe('quickFileExtractInvoiceSearchRecords', () => {
  it('normalises Record arrays', () => {
    const rows = quickFileExtractInvoiceSearchRecords({
      Record: [{ InvoiceNumber: '1' }, { InvoiceNumber: '2' }],
    });
    assert.strictEqual(rows.length, 2);
  });
});

/**
 * Wire recovery to a peek-only counter — mirrors main.js (peek + bumpPast).
 */
function wireSequentialAllocator(initialNext) {
  const counter = createSequentialInvoiceCounter({ initialNext });
  return {
    counter,
    allocateNextNumber: () => counter.peekFormatted(),
    bumpPastNumber: (raw) => { counter.markOccupied(raw); },
  };
}

describe('createInvoiceWithDuplicateRecovery — sequential discipline', () => {
  it('successive creates get N, N+1, N+2', async () => {
    const wire = wireSequentialAllocator(8000);
    const issued = [];
    for (let i = 0; i < 3; i++) {
      const result = await createInvoiceWithDuplicateRecovery({
        allocateNextNumber: wire.allocateNextNumber,
        bumpPastNumber: wire.bumpPastNumber,
        createWithNumber: async (invNum) => ({ InvoiceID: 100 + i, InvoiceNumber: invNum }),
      });
      issued.push(result.invoiceNumber);
    }
    assert.deepStrictEqual(issued, ['008000', '008001', '008002']);
    assert.strictEqual(wire.counter.peekFormatted(), '008003');
  });

  it('conflict on N → next attempt uses N+1 (smallest free), not N+10', async () => {
    const wire = wireSequentialAllocator(6066);
    const attempted = [];
    const result = await createInvoiceWithDuplicateRecovery({
      maxAttempts: 5,
      allocateNextNumber: wire.allocateNextNumber,
      bumpPastNumber: wire.bumpPastNumber,
      createWithNumber: async (invNum) => {
        attempted.push(invNum);
        if (invNum === '006066') throw new Error('Invoice number is already there');
        if (invNum === '006067') throw new Error('The invoice number is already used');
        return { InvoiceID: 9001, InvoiceNumber: invNum };
      },
      findByInvoiceNumber: async () => null,
      findByAttendanceRef: async () => null,
    });
    assert.strictEqual(result.reused, false);
    assert.strictEqual(result.invoiceNumber, '006068');
    assert.deepStrictEqual(attempted, ['006066', '006067', '006068']);
    assert.strictEqual(wire.counter.peekFormatted(), '006069');
  });

  it('does not skip ahead when error text mentions a larger unrelated number', async () => {
    const wire = wireSequentialAllocator(6066);
    const attempted = [];
    const result = await createInvoiceWithDuplicateRecovery({
      maxAttempts: 4,
      allocateNextNumber: wire.allocateNextNumber,
      bumpPastNumber: wire.bumpPastNumber,
      createWithNumber: async (invNum) => {
        attempted.push(invNum);
        /* Error mentions 006079 — recovery must still only bump past attempted 006066 */
        if (invNum === '006066') {
          throw new Error('Invoice number 006079 already exists');
        }
        return { InvoiceID: 1, InvoiceNumber: invNum };
      },
      findByInvoiceNumber: async () => null,
    });
    assert.strictEqual(result.invoiceNumber, '006067');
    assert.deepStrictEqual(attempted, ['006066', '006067']);
    assert.strictEqual(wire.counter.peekFormatted(), '006068');
  });

  it('same-attendance reuse before create does not consume the next sequence number', async () => {
    const attendanceId = 55;
    const wire = wireSequentialAllocator(6300);
    let created = 0;
    const result = await createInvoiceWithDuplicateRecovery({
      attendanceId,
      allocateNextNumber: wire.allocateNextNumber,
      bumpPastNumber: wire.bumpPastNumber,
      createWithNumber: async () => {
        created += 1;
        throw new Error('should not create');
      },
      findByAttendanceRef: async () => ({
        InvoiceID: 888,
        InvoiceNumber: '006300',
        PurchaseReference: attendancePurchaseReference(attendanceId),
      }),
    });
    assert.strictEqual(result.reused, true);
    assert.strictEqual(result.invoiceId, '888');
    assert.strictEqual(result.invoiceNumber, '006300');
    assert.strictEqual(created, 0);
    /* Counter unchanged — reuse must not burn a number */
    assert.strictEqual(wire.counter.peekFormatted(), '006300');
  });

  it('allowDuplicate skips findByAttendanceRef reuse and creates a new sequential invoice', async () => {
    const attendanceId = 55;
    const wire = wireSequentialAllocator(6300);
    let createdWith = null;
    let findByRefCalls = 0;
    const result = await createInvoiceWithDuplicateRecovery({
      attendanceId,
      allowDuplicate: true,
      allocateNextNumber: wire.allocateNextNumber,
      bumpPastNumber: wire.bumpPastNumber,
      createWithNumber: async (invNum) => {
        createdWith = invNum;
        return { InvoiceID: 999, InvoiceNumber: invNum };
      },
      findByAttendanceRef: async () => {
        findByRefCalls += 1;
        return {
          InvoiceID: 888,
          InvoiceNumber: '006299',
          PurchaseReference: attendancePurchaseReference(attendanceId),
        };
      },
    });
    assert.strictEqual(result.reused, false);
    assert.strictEqual(result.invoiceId, '999');
    assert.strictEqual(result.invoiceNumber, '006300');
    assert.strictEqual(createdWith, '006300');
    /* findByAttendanceRef must not be consulted when allowDuplicate is set */
    assert.strictEqual(findByRefCalls, 0);
    assert.strictEqual(wire.counter.peekFormatted(), '006301');
  });

  it('allowDuplicate does not attach same-attendance invoice on number conflict', async () => {
    const attendanceId = 42;
    const wire = wireSequentialAllocator(6200);
    const attempted = [];
    const result = await createInvoiceWithDuplicateRecovery({
      attendanceId,
      allowDuplicate: true,
      maxAttempts: 5,
      allocateNextNumber: wire.allocateNextNumber,
      bumpPastNumber: wire.bumpPastNumber,
      createWithNumber: async (invNum) => {
        attempted.push(invNum);
        if (invNum === '006200') {
          throw new Error('Invoice number already exists');
        }
        return { InvoiceID: 1001, InvoiceNumber: invNum };
      },
      findByInvoiceNumber: async (invNum) => ({
        InvoiceID: 777,
        InvoiceNumber: invNum,
        PurchaseReference: attendancePurchaseReference(attendanceId),
      }),
      findByAttendanceRef: async () => ({
        InvoiceID: 777,
        InvoiceNumber: '006200',
        PurchaseReference: attendancePurchaseReference(attendanceId),
      }),
    });
    assert.strictEqual(result.reused, false);
    assert.strictEqual(result.invoiceId, '1001');
    assert.strictEqual(result.invoiceNumber, '006201');
    assert.deepStrictEqual(attempted, ['006200', '006201']);
    assert.strictEqual(wire.counter.peekFormatted(), '006202');
  });

  it('success persists last number so the following create is previous+1', async () => {
    const wire = wireSequentialAllocator(6500);
    const first = await createInvoiceWithDuplicateRecovery({
      allocateNextNumber: wire.allocateNextNumber,
      bumpPastNumber: wire.bumpPastNumber,
      createWithNumber: async (invNum) => ({ InvoiceID: 42, InvoiceNumber: invNum }),
    });
    assert.strictEqual(first.invoiceNumber, '006500');
    assert.strictEqual(wire.counter.peekFormatted(), '006501');

    const second = await createInvoiceWithDuplicateRecovery({
      allocateNextNumber: wire.allocateNextNumber,
      bumpPastNumber: wire.bumpPastNumber,
      createWithNumber: async (invNum) => ({ InvoiceID: 43, InvoiceNumber: invNum }),
    });
    assert.strictEqual(second.invoiceNumber, '006501');
    assert.strictEqual(wire.counter.peekFormatted(), '006502');
  });

  it('failed non-duplicate create does not burn the peeked number', async () => {
    const wire = wireSequentialAllocator(6400);
    await assert.rejects(
      () => createInvoiceWithDuplicateRecovery({
        allocateNextNumber: wire.allocateNextNumber,
        bumpPastNumber: wire.bumpPastNumber,
        createWithNumber: async () => {
          throw new Error('Invalid MD5 signature');
        },
      }),
      /Invalid MD5 signature/
    );
    /* Peek-only allocate: counter still at 6400 for the next attempt */
    assert.strictEqual(wire.counter.peekFormatted(), '006400');
  });

  it('attaches existing invoice when conflict is for the same attendance', async () => {
    const attendanceId = 42;
    const wire = wireSequentialAllocator(6200);
    const result = await createInvoiceWithDuplicateRecovery({
      attendanceId,
      maxAttempts: 5,
      allocateNextNumber: wire.allocateNextNumber,
      bumpPastNumber: wire.bumpPastNumber,
      createWithNumber: async () => {
        throw new Error('Invoice number already exists');
      },
      findByInvoiceNumber: async (invNum) => ({
        InvoiceID: 777,
        InvoiceNumber: invNum,
        PurchaseReference: attendancePurchaseReference(attendanceId),
      }),
      findByAttendanceRef: async () => null,
    });
    assert.strictEqual(result.reused, true);
    assert.strictEqual(result.invoiceId, '777');
    assert.strictEqual(result.invoiceNumber, '006200');
    /* Occupied number marked so following create uses 6201 */
    assert.strictEqual(wire.counter.peekFormatted(), '006201');
  });

  it('non-duplicate QuickFile errors still fail clearly without retrying', async () => {
    let attempts = 0;
    await assert.rejects(
      () => createInvoiceWithDuplicateRecovery({
        allocateNextNumber: () => {
          attempts += 1;
          return '006400';
        },
        createWithNumber: async () => {
          throw new Error('Invalid MD5 signature');
        },
      }),
      /Invalid MD5 signature/
    );
    assert.strictEqual(attempts, 1);
  });

  it('persists submitted invoice number when create body omits InvoiceNumber', async () => {
    const wire = wireSequentialAllocator(6500);
    const result = await createInvoiceWithDuplicateRecovery({
      allocateNextNumber: wire.allocateNextNumber,
      bumpPastNumber: wire.bumpPastNumber,
      createWithNumber: async () => ({ InvoiceID: 42 }),
    });
    assert.strictEqual(result.invoiceId, '42');
    assert.strictEqual(result.invoiceNumber, '006500');
    assert.strictEqual(wire.counter.peekFormatted(), '006501');
  });

  it('stops after maxAttempts on persistent duplicates', async () => {
    const wire = wireSequentialAllocator(7000);
    let attempts = 0;
    await assert.rejects(
      () => createInvoiceWithDuplicateRecovery({
        maxAttempts: 3,
        allocateNextNumber: () => {
          attempts += 1;
          return wire.allocateNextNumber();
        },
        bumpPastNumber: wire.bumpPastNumber,
        createWithNumber: async () => {
          throw new Error('invoice number already exists');
        },
        findByInvoiceNumber: async () => null,
      }),
      /already exists/
    );
    assert.strictEqual(attempts, 3);
    assert.ok(MAX_INVOICE_NUMBER_ATTEMPTS >= 3);
    /* After 3 conflicts on 7000,7001,7002 — next peek is 7003 */
    assert.strictEqual(wire.counter.peekFormatted(), '007003');
  });
});

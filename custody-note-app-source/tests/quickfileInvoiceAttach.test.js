/**
 * QuickFile invoice + sales attachment (Document_Upload) — static source checks.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const billingJs = fs.readFileSync(path.join(root, 'renderer', 'views', 'billing.js'), 'utf8');

describe('QuickFile Document_Upload wiring — main.js', () => {
  it('calls document upload endpoint', () => {
    assert.ok(mainJs.includes('/1_2/document/upload'));
  });
  it('defines quickFileUploadSalesAttachment helper', () => {
    assert.ok(mainJs.includes('function quickFileUploadSalesAttachment'));
    assert.ok(mainJs.includes('SalesAttachment'));
    assert.ok(mainJs.includes('EmbeddedFileBinaryObject'));
  });
  it('create-invoice accepts HTML for same PDF as preview', () => {
    assert.ok(mainJs.includes('attachAttendanceHtml'));
    assert.ok(mainJs.includes('renderHtmlToPdfBuffer'));
  });
});

describe('Renderer passes attendance HTML for attach', () => {
  it('billing quickfileCreateInvoice includes attachAttendanceHtml', () => {
    assert.ok(billingJs.includes('attachAttendanceHtml'));
    assert.ok(billingJs.includes('attachPdfFileName'));
  });
});

describe('Type wrapper regression — Document_Upload', () => {
  it('SalesAttachment is nested inside Type, not a direct child of DocumentDetails', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    assert.ok(fnMatch, 'quickFileUploadSalesAttachment must exist');
    const body = fnMatch[0];
    const docStart = body.indexOf('DocumentDetails: {');
    const typeIdx = body.indexOf('Type: {', docStart);
    const salesIdx = body.indexOf('SalesAttachment: {', docStart);
    assert.ok(docStart > -1, 'DocumentDetails must exist');
    assert.ok(typeIdx > -1, 'Type wrapper must exist inside DocumentDetails');
    assert.ok(salesIdx > -1, 'SalesAttachment must exist');
    assert.ok(salesIdx > typeIdx, 'SalesAttachment must be nested inside Type (not a sibling)');
    const betweenDocAndSales = body.slice(docStart, salesIdx);
    assert.ok(betweenDocAndSales.includes('Type: {'), 'Type must appear between DocumentDetails opening and SalesAttachment');
  });

  it('Type wrapper contains InvoiceId and Notes fields', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    const body = fnMatch[0];
    const salesStart = body.indexOf('SalesAttachment: {');
    const salesBlock = body.slice(salesStart, salesStart + 200);
    assert.ok(salesBlock.includes('InvoiceId:'), 'SalesAttachment must contain InvoiceId');
    assert.ok(salesBlock.includes('Notes:'), 'SalesAttachment must contain Notes');
  });

  it('does NOT place SalesAttachment as direct child of DocumentDetails', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    const body = fnMatch[0];
    const docIdx = body.indexOf('DocumentDetails: {');
    const typeIdx = body.indexOf('Type: {', docIdx);
    const between = body.slice(docIdx + 'DocumentDetails: {'.length, typeIdx);
    assert.ok(!between.includes('SalesAttachment'), 'SalesAttachment must not appear between DocumentDetails and Type');
  });
});

describe('Document_Upload field completeness', () => {
  it('all required Document_Upload fields are present in the upload function', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    assert.ok(fnMatch);
    const body = fnMatch[0];
    const requiredFields = ['FileName', 'EmbeddedFileBinaryObject', 'Type', 'SalesAttachment', 'InvoiceId', 'Notes'];
    for (const field of requiredFields) {
      assert.ok(body.includes(field + ':'), 'Missing required field: ' + field);
    }
  });

  it('InvoiceId is parsed as integer (not passed as string)', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    const body = fnMatch[0];
    assert.ok(body.includes('parseInt(String(invoiceId), 10)'), 'InvoiceId must be parsed as base-10 integer');
    assert.ok(body.includes('InvoiceId: invId'), 'InvoiceId field uses the parsed integer variable');
  });

  it('Notes are truncated to 600 characters', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    const body = fnMatch[0];
    assert.ok(body.includes('.slice(0, 600)'), 'Notes must be truncated to 600 chars');
  });

  it('EmbeddedFileBinaryObject is derived from Buffer.toString base64', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    const body = fnMatch[0];
    assert.ok(body.includes("Buffer.from(pdfBuffer).toString('base64')"), 'Must convert pdfBuffer to base64');
  });
});

describe('QuickFile error parsing for attachment failures', () => {
  // Response parsing now lives in the shared, unit-tested lib/quickfileClient.js
  // (see tests/quickfileClient.test.js). main.js delegates to it.
  const clientJs = fs.readFileSync(path.join(root, 'lib', 'quickfileClient.js'), 'utf8');

  it('main.js delegates response parsing to the shared quickfile client', () => {
    assert.ok(mainJs.includes('quickfileClient.parseQuickFileResponse'), 'main must use the shared parser');
  });

  it('parseQuickFileResponse extracts Errors.Error array from response JSON', () => {
    assert.ok(clientJs.includes('json.Errors.Error || json.Errors'), 'Must extract Errors.Error array');
    assert.ok(clientJs.includes('Array.isArray(errs)'), 'Must handle both array and single error');
  });

  it('error messages are joined with semicolons for multi-error responses', () => {
    assert.ok(clientJs.includes("msgs.join('; ')"), 'Must join multiple errors with semicolons');
  });

  it('attachment error is captured and logged in create-invoice handler', () => {
    const handlerMatch = mainJs.match(/ipcMain\.handle\('quickfile-create-invoice'[\s\S]*?^\}\);/m);
    assert.ok(handlerMatch, 'Handler must exist');
    const handler = handlerMatch[0];
    assert.ok(handler.includes("'invoice_attachment_failed'"), 'Must log attachment failure to audit log');
    assert.ok(handler.includes('attErr'), 'Must reference the caught attachment error');
  });

  it('validateDocumentUploadPayload is called before sending document upload', () => {
    const fnMatch = mainJs.match(/async function quickFileUploadSalesAttachment[\s\S]*?^\}/m);
    assert.ok(fnMatch, 'Function must exist');
    const body = fnMatch[0];
    assert.ok(body.includes('validateDocumentUploadPayload('), 'Must call validateDocumentUploadPayload');
  });
});

describe('QuickFile invoice number — ledger sync and duplicate retry', () => {
  it('calls invoice/search ordered by InvoiceNumber DESC before create', () => {
    assert.ok(mainJs.includes('/1_2/invoice/search'));
    assert.ok(mainJs.includes('syncNextInvoiceNumberFromQuickFileLedger'));
    assert.ok(mainJs.includes('OrderResultsBy'));
    assert.ok(mainJs.includes("'DESC'"));
  });

  it('retries invoice/create when QuickFile reports an existing invoice number', () => {
    assert.ok(mainJs.includes('isQuickFileInvoiceNumberDuplicateError'));
    assert.ok(mainJs.includes('Invoice number conflict, trying next'));
    assert.ok(mainJs.includes('MAX_INVOICE_NUMBER_ATTEMPTS'));
  });

  it('extracts invoice rows and numeric parts for max-number sync', () => {
    assert.ok(mainJs.includes('quickFileExtractInvoiceSearchRecords'));
    assert.ok(mainJs.includes('parseInvoiceNumberNumericPart'));
  });
});

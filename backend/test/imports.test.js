import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecimal, parseImportRow, parseStatementDate } from '../src/imports.js';

const mapping = { date: 'Date', amount: 'Amount', description: 'Details', reference: 'Reference' };

test('parses statement money with exact cents and rejects malformed grouping', () => {
  assert.equal(parseDecimal('1,234.56'), 123456);
  assert.equal(parseDecimal('-0.05'), -5);
  assert.equal(parseDecimal('1,2.00'), null);
  assert.equal(parseDecimal('1.001'), null);
});

test('accepts ISO dates and Excel serial dates', () => {
  assert.equal(parseStatementDate('2026-10-11').toISOString(), '2026-10-11T00:00:00.000Z');
  assert.equal(parseStatementDate('2').toISOString(), '1900-01-01T00:00:00.000Z');
  assert.equal(parseStatementDate('not-a-date'), null);
});

test('maps statement rows and reports unusable or duplicate-suspect entries without merging them', () => {
  const valid = parseImportRow({ Date: '2026-10-11', Amount: '-12.35', Details: 'Market', Reference: 'ref-1' }, 1, mapping, 'account-id');
  assert.equal(valid.valid, true);
  assert.equal(valid.amountPesewas, 1235);
  assert.equal(valid.type, 'expense');
  assert.equal(valid.externalReference, 'ref-1');

  const invalid = parseImportRow({ Date: '2026-10-11', Amount: '1.234', Details: 'Bad' }, 2, mapping, 'account-id');
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length > 0);
});

test('requires a user to resolve rows with both debit and credit values', () => {
  const row = parseImportRow(
    { Date: '2026-10-11', Debit: '10.00', Credit: '10.00' },
    1,
    { date: 'Date', debit: 'Debit', credit: 'Credit' },
    'account-id',
  );
  assert.equal(row.valid, false);
  assert.match(row.errors.join(' '), /Both debit and credit/);
});

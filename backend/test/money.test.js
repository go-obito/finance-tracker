import test from 'node:test';
import assert from 'node:assert/strict';
import { accountEffect, calculateBalance, parsePesewas, transactionCashFlow } from '../src/domain/money.js';

test('parses GHS to exact pesewas without floating point rounding', () => {
  assert.equal(parsePesewas('12.35'), 1235);
  assert.equal(parsePesewas('0.01'), 1);
  assert.equal(parsePesewas('-0.05'), -5);
});

test('rejects ambiguous or over-precise decimal amounts', () => {
  for (const value of ['1.001', '1,20', '  ', 'NaN', 1.25, 1235]) {
    assert.throws(() => parsePesewas(value));
  }
});

test('calculates account effects and balance, with refunds reducing net spending', () => {
  const records = [
    { type: 'income', amountPesewas: 10000 },
    { type: 'expense', amountPesewas: 1250 },
    { type: 'fee', amountPesewas: 25 },
    { type: 'refund', amountPesewas: 100 },
    { type: 'interest', amountPesewas: 5 },
  ];

  assert.deepEqual(records.map(accountEffect), [10000, -1250, -25, 100, 5]);
  assert.equal(calculateBalance(500, records), 9330);
  assert.equal(transactionCashFlow({ type: 'refund', amountPesewas: 100 }), 100);
  assert.equal(transactionCashFlow({ type: 'expense', amountPesewas: 1250 }), -1250);
});
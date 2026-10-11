export function parsePesewas(value) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new TypeError('Amount must be a decimal GHS value with at most two fraction digits.');
  }

  const normalized = value.trim();
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [cedis, pesewas = ''] = unsigned.split('.');
  const amount = Number(cedis) * 100 + Number(pesewas.padEnd(2, '0'));
  const result = negative ? -amount : amount;

  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Amount exceeds the supported integer range.');
  }

  return result;
}

export function requirePositivePesewas(value, field = 'amountPesewas') {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer number of pesewas.`);
  }

  return value;
}

export function accountEffect(transaction) {
  const amount = requirePositivePesewas(transaction.amountPesewas);

  switch (transaction.type) {
    case 'income':
    case 'interest':
    case 'refund':
      return amount;
    case 'expense':
    case 'fee':
      return -amount;
    case 'adjustment':
      if (!Number.isSafeInteger(transaction.signedAmountPesewas)) {
        throw new TypeError('Adjustments require a signed integer pesewa amount.');
      }
      return transaction.signedAmountPesewas;
    default:
      throw new TypeError('Unsupported transaction type.');
  }
}

export function calculateBalance(openingBalancePesewas, transactions) {
  if (!Number.isSafeInteger(openingBalancePesewas)) {
    throw new TypeError('Opening balance must be an integer number of pesewas.');
  }

  const balance = transactions.reduce((total, transaction) => total + accountEffect(transaction), openingBalancePesewas);
  if (!Number.isSafeInteger(balance)) {
    throw new RangeError('Calculated balance exceeds the supported integer range.');
  }

  return balance;
}

export function transactionCashFlow(transaction) {
  if (transaction.type === 'adjustment') return transaction.signedAmountPesewas;
  if (transaction.type === 'income' || transaction.type === 'interest' || transaction.type === 'refund') return transaction.amountPesewas;
  if (transaction.type === 'expense' || transaction.type === 'fee') return -transaction.amountPesewas;
  return 0;
}
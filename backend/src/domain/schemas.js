import { z } from 'zod';

const id = z.string().uuid();
const date = z.coerce.date();
const nonNegativePesewas = z.number().int().safe().nonnegative();
const positivePesewas = z.number().int().safe().positive();

export const accountInput = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['cash', 'bank', 'mobile_money', 'savings', 'other']),
  currency: z.literal('GHS').default('GHS'),
  openingBalancePesewas: z.number().int().safe(),
}).strict();

export const transactionInput = z.object({
  id,
  accountId: id,
  amountPesewas: positivePesewas,
  type: z.enum(['income', 'expense', 'fee', 'interest', 'refund', 'adjustment']),
  signedAmountPesewas: z.number().int().safe().optional(),
  occurredAt: date,
  categoryId: id.nullable().optional(),
  description: z.string().trim().max(500).default(''),
  source: z.enum(['manual', 'import']).default('manual'),
  externalReference: z.string().trim().min(1).max(160).nullable().optional(),
  importId: id.optional(),
}).strict().superRefine((value, context) => {
  if (value.type === 'adjustment' && (!Number.isSafeInteger(value.signedAmountPesewas) || value.signedAmountPesewas === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['signedAmountPesewas'], message: 'Adjustments require a non-zero signed pesewa amount.' });
  }
  if (value.type !== 'adjustment' && value.signedAmountPesewas !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['signedAmountPesewas'], message: 'Only adjustments may include a signed amount.' });
  }
});

export const transactionUpdate = z.object({
  accountId: id.optional(),
  amountPesewas: positivePesewas.optional(),
  type: z.enum(['income', 'expense', 'fee', 'interest', 'refund', 'adjustment']).optional(),
  signedAmountPesewas: z.number().int().safe().optional(),
  occurredAt: date.optional(),
  categoryId: id.nullable().optional(),
  description: z.string().trim().max(500).optional(),
  externalReference: z.string().trim().min(1).max(160).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const transferInput = z.object({
  id,
  fromAccountId: id,
  toAccountId: id,
  amountPesewas: positivePesewas,
  feePesewas: nonNegativePesewas.default(0),
  occurredAt: date,
  description: z.string().trim().max(500).default(''),
}).strict().refine((value) => value.fromAccountId !== value.toAccountId, 'Transfer accounts must be different.');

export const transferUpdate = z.object({
  fromAccountId: id.optional(),
  toAccountId: id.optional(),
  amountPesewas: positivePesewas.optional(),
  feePesewas: nonNegativePesewas.optional(),
  occurredAt: date.optional(),
  description: z.string().trim().max(500).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: id.nullable().optional(),
  kind: z.enum(['income', 'expense', 'both']).default('both'),
}).strict();

export const goalInput = z.object({
  id,
  accountId: id.optional(),
  name: z.string().trim().min(1).max(100),
  targetPesewas: positivePesewas,
  targetDate: date.nullable().optional(),
  startDate: date,
  frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']),
  intervalDays: z.number().int().min(1).max(365).optional(),
  contributionFormula: z.discriminatedUnion('type', [
    z.object({ type: z.literal('fixed'), amountPesewas: positivePesewas }).strict(),
    z.object({ type: z.literal('step_up'), initialPesewas: positivePesewas, incrementPesewas: nonNegativePesewas, everyPeriods: z.number().int().positive() }).strict(),
  ]),
  missedPeriodPolicy: z.enum(['carry_forward', 'skip', 'pause']).default('skip'),
}).strict().superRefine((value, context) => {
  if (value.frequency === 'custom' && value.intervalDays === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['intervalDays'], message: 'Custom schedules require intervalDays.' });
  }
});
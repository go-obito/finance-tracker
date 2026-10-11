import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannedContributions, dueDateForPeriod, markPlannedContributions, plannedAmountForPeriod, summarizeContributions } from '../src/domain/savings.js';

const goal = {
  startDate: new Date('2024-01-31T00:00:00.000Z'),
  targetDate: new Date('2024-04-30T00:00:00.000Z'),
  frequency: 'monthly',
  contributionFormula: { type: 'step_up', initialPesewas: 1000, incrementPesewas: 250, everyPeriods: 2 },
};

test('monthly schedules preserve month-end dates and step-up amounts use integer pesewas', () => {
  assert.equal(dueDateForPeriod(goal, 1).toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal(dueDateForPeriod(goal, 2).toISOString(), '2024-03-31T00:00:00.000Z');
  assert.deepEqual([0, 1, 2, 3].map((period) => plannedAmountForPeriod(goal, period)), [1000, 1000, 1250, 1250]);
});

test('planned and actual contributions remain distinct and shortfall is explicit', () => {
  const planned = buildPlannedContributions(goal, new Date('2024-03-31T00:00:00.000Z'));
  assert.equal(planned.length, 3);
  const summary = summarizeContributions({ ...goal, targetPesewas: 10000 }, planned, [{ amountPesewas: 1500 }]);
  assert.equal(summary.plannedPesewas, 3250);
  assert.equal(summary.actualPesewas, 1500);
  assert.equal(summary.shortfallPesewas, 1750);
  assert.equal(summary.remainingTargetPesewas, 8500);
  assert.equal(summary.progressBasisPoints, 1500);
});

test('missed-period rules expose shortfalls, carry forward, and pause future periods', () => {
  const planned = buildPlannedContributions({ ...goal, missedPeriodPolicy: 'carry_forward' }, new Date('2024-03-31T00:00:00.000Z'));
  const carried = markPlannedContributions(planned, [{ amountPesewas: 500, occurredAt: new Date('2024-02-01T00:00:00.000Z') }], 'carry_forward', new Date('2024-03-31T00:00:00.000Z'));
  assert.equal(carried[0].status, 'partial');
  assert.equal(carried[1].plannedPesewas, 1500);
  assert.equal(carried[1].status, 'missed');

  const paused = markPlannedContributions(planned, [], 'pause', new Date('2024-03-31T00:00:00.000Z'));
  assert.equal(paused[0].status, 'missed');
  assert.equal(paused[1].status, 'paused');
});

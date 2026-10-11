const DAY_MS = 86_400_000;

export function dueDateForPeriod(goal, period) {
  if (!Number.isSafeInteger(period) || period < 0) throw new TypeError('Period must be a non-negative integer.');
  const start = new Date(goal.startDate);
  if (goal.frequency === 'daily') return new Date(start.getTime() + period * DAY_MS);
  if (goal.frequency === 'weekly') return new Date(start.getTime() + period * 7 * DAY_MS);
  if (goal.frequency === 'custom') return new Date(start.getTime() + period * goal.intervalDays * DAY_MS);

  const due = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + period, start.getUTCDate()));
  if (due.getUTCDate() !== start.getUTCDate()) due.setUTCDate(0);
  return due;
}

export function plannedAmountForPeriod(goal, period) {
  const formula = goal.contributionFormula;
  if (formula.type === 'fixed') return formula.amountPesewas;
  return formula.initialPesewas + Math.floor(period / formula.everyPeriods) * formula.incrementPesewas;
}

export function buildPlannedContributions(goal, throughDate) {
  const through = new Date(throughDate);
  const end = goal.targetDate ? new Date(goal.targetDate) : through;
  const limit = through < end ? through : end;
  const results = [];
  for (let period = 0; period < 10_000; period += 1) {
    const dueAt = dueDateForPeriod(goal, period);
    if (dueAt > limit) break;
    results.push({ period, dueAt, plannedPesewas: plannedAmountForPeriod(goal, period) });
  }
  if (results.length === 10_000) throw new RangeError('Schedule exceeds the supported planning horizon.');
  return results;
}

export function summarizeContributions(goal, planned, transactions) {
  const actualPesewas = transactions.reduce((total, item) => total + item.amountPesewas, 0);
  const plannedPesewas = planned.reduce((total, item) => total + item.plannedPesewas, 0);
  return {
    plannedPesewas,
    actualPesewas,
    shortfallPesewas: Math.max(plannedPesewas - actualPesewas, 0),
    remainingTargetPesewas: Math.max(goal.targetPesewas - actualPesewas, 0),
    progressBasisPoints: Math.min(10_000, Math.floor((actualPesewas * 10_000) / goal.targetPesewas)),
  };
}

export function buildGoalPlan(goal, throughDate) {
  const versions = goal.scheduleVersions?.length ? goal.scheduleVersions : [{
    version: 1,
    effectiveFrom: goal.startDate,
    frequency: goal.frequency,
    intervalDays: goal.intervalDays,
    contributionFormula: goal.contributionFormula,
    missedPeriodPolicy: goal.missedPeriodPolicy,
    targetDate: goal.targetDate,
  }];
  return versions.flatMap((version, index) => {
    const nextVersion = versions[index + 1];
    const versionEnd = nextVersion ? new Date(new Date(nextVersion.effectiveFrom).getTime() - 1) : new Date(throughDate);
    const end = version.targetDate && new Date(version.targetDate) < versionEnd ? new Date(version.targetDate) : versionEnd;
    if (end < new Date(version.effectiveFrom)) return [];
    const schedule = { ...version, startDate: version.effectiveFrom };
    return buildPlannedContributions(schedule, end).map((item) => ({ ...item, scheduleVersion: version.version }));
  });
}

export function nextScheduleDate(schedule, after) {
  const start = { ...schedule, startDate: schedule.effectiveFrom ?? schedule.startDate };
  for (let period = 0; period < 10_000; period += 1) {
    const dueAt = dueDateForPeriod(start, period);
    if (dueAt > after) return dueAt;
  }
  throw new RangeError('Could not determine the next schedule date.');
}

export function markPlannedContributions(planned, actuals, missedPeriodPolicy, asOf = new Date()) {
  const sortedActuals = [...actuals].sort((left, right) => new Date(left.occurredAt) - new Date(right.occurredAt));
  let actualIndex = 0;
  let actualSincePreviousDue = 0;
  let carriedShortfall = 0;
  let paused = false;
  return planned.map((item) => {
    const basePlan = item.plannedPesewas;
    const wasPaused = paused;
    const plannedPesewas = wasPaused ? 0 : basePlan + (missedPeriodPolicy === 'carry_forward' ? carriedShortfall : 0);
    const dueDayEnd = new Date(item.dueAt);
    dueDayEnd.setUTCHours(23, 59, 59, 999);
    while (actualIndex < sortedActuals.length && new Date(sortedActuals[actualIndex].occurredAt) <= dueDayEnd) {
      actualSincePreviousDue += sortedActuals[actualIndex].amountPesewas;
      actualIndex += 1;
    }
    const due = item.dueAt <= asOf;
    const actualPesewas = due ? actualSincePreviousDue : 0;
    if (due) actualSincePreviousDue = 0;
    const shortfallPesewas = due ? Math.max(plannedPesewas - actualPesewas, 0) : 0;
    let status = wasPaused ? 'paused' : due ? (shortfallPesewas === 0 ? 'met' : actualPesewas > 0 ? 'partial' : 'missed') : 'upcoming';
    if (missedPeriodPolicy === 'carry_forward') carriedShortfall = shortfallPesewas;
    if (missedPeriodPolicy === 'pause' && due && shortfallPesewas > 0) paused = true;
    return { ...item, plannedPesewas, actualPesewas, shortfallPesewas, status };
  });
}
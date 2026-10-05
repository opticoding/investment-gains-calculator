const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/calculator.js'), 'utf8'), context);
const calculator = context.window.InvestmentCalculator;
const defaults = {
  initial: 100000, deposit: 2500, depositInterval: 30, depositOffset: 30,
  withdrawal: 0, withdrawalInterval: 30, withdrawalOffset: 365,
  duration: 20, goal: 2000000
};

function close(actual, expected, tolerance = .001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);
}

test('effective annual return matches the analytical compound formula', () => {
  const settings = { ...defaults, initial: 1000, deposit: 0, duration: 5 };
  const projection = calculator.simulate(settings, 7);
  close(projection.balance, 1000 * 1.07 ** (projection.days / calculator.DAYS_PER_YEAR));
  close(projection.gain, projection.balance - 1000);
});

test('zero return counts scheduled deposits including the final day', () => {
  const settings = { ...defaults, initial: 100, deposit: 10, depositOffset: 0, depositInterval: 1, duration: .1 };
  const projection = calculator.simulate(settings, 0);
  close(projection.balance, 100 + (projection.days + 1) * 10);
  close(projection.gain, 0);
  close(projection.balances[0], 110);
});

test('deposits occur before withdrawals on the same day', () => {
  const settings = { ...defaults, initial: 0, deposit: 100, depositOffset: 0, depositInterval: 36525, withdrawal: 80, withdrawalOffset: 0, withdrawalInterval: 36525, duration: .1 };
  const projection = calculator.simulate(settings, 0);
  close(projection.balances[0], 20);
  close(projection.withdrawn, 80);
  close(projection.unpaid, 0);
});

test('withdrawals never overdraw and unpaid requests are tracked', () => {
  const settings = { ...defaults, initial: 100, deposit: 0, withdrawal: 200, withdrawalOffset: 0, withdrawalInterval: 10, duration: .1 };
  const projection = calculator.simulate(settings, 7);
  close(projection.balance, 0);
  close(projection.withdrawn, 100);
  close(projection.unpaid, 700);
  assert.ok([...projection.balances].every(balance => balance >= 0));
  close(projection.gain, 0);
});

test('payments beyond the duration have no effect', () => {
  const settings = { ...defaults, duration: 1, depositOffset: 500, withdrawal: 10000, withdrawalOffset: 500 };
  const projection = calculator.simulate(settings, 0);
  close(projection.balance, settings.initial);
  close(projection.withdrawn, 0);
  close(projection.invested, settings.initial);
});

test('gain includes withdrawals as well as the remaining balance', () => {
  const settings = { ...defaults, deposit: 0, withdrawal: 100, withdrawalOffset: 0, duration: 1 };
  const projection = calculator.simulate(settings, 8);
  close(projection.gain, projection.balance + projection.withdrawn - projection.invested);
  close(projection.withdrawn, 1300);
});

test('goal solver recovers a known annual return with both kinds of payments', () => {
  const settings = { ...defaults, withdrawal: 500, withdrawalOffset: 400 };
  settings.goal = calculator.simulate(settings, 12.345).balance;
  const solution = calculator.solveGoal(settings);
  close(solution.rate, 12.345, 1e-7);
  close(calculator.simulate(settings, solution.rate).balance, settings.goal, .01);
});

test('goal solver handles negative returns and returns outside the UI range', () => {
  for (const rate of [-10, 45]) {
    const settings = { ...defaults, deposit: 0, duration: 2 };
    settings.goal = calculator.simulate(settings, rate).balance;
    close(calculator.solveGoal(settings).rate, rate, 1e-7);
  }
});

test('goals without invested capital are reported as unreachable', () => {
  const solution = calculator.solveGoal({ ...defaults, initial: 0, deposit: 0, goal: 1000 });
  assert.equal(solution.rate, null);
  assert.equal(solution.reason, 'above');
});

test('a final-day deposit cannot grow into a higher goal', () => {
  const settings = { ...defaults, initial: 0, duration: 1, deposit: 100, depositOffset: 365, goal: 200 };
  assert.equal(calculator.solveGoal(settings).reason, 'above');
});

test('below-limit goals are reported instead of returning an incorrect rate', () => {
  const settings = { ...defaults, initial: 0, duration: 1, deposit: 100, depositOffset: 365, goal: 50 };
  assert.equal(calculator.solveGoal(settings).reason, 'below');
});

test('daily series agree with summary totals and non-collecting simulation', () => {
  const settings = { ...defaults, withdrawal: 2000, withdrawalOffset: 0 };
  const full = calculator.simulate(settings, 4);
  const compact = calculator.simulate(settings, 4, false);
  close(full.balances[full.days], full.balance);
  close(full.investedSeries[full.days], full.invested);
  close(full.withdrawnSeries[full.days], full.withdrawn);
  close(full.balance, compact.balance);
  assert.equal(compact.balances, null);
});

test('extreme projections stay finite and expose the overflow flag', () => {
  const projection = calculator.simulate({ ...defaults, duration: 100 }, 10000);
  assert.ok(Number.isFinite(projection.balance));
  assert.equal(projection.overflow, true);
});

test('event-based totals match daily simulation across schedules and return rates', () => {
  for (const rate of [-80, 0, 5, 80, 500]) {
    for (const offset of [0, 13, 200]) {
      const settings = { ...defaults, initial: 1000, deposit: 200, depositOffset: offset, depositInterval: 17, withdrawal: 350, withdrawalOffset: 0, withdrawalInterval: 29, duration: 1.2 };
      const daily = calculator.simulate(settings, rate);
      const eventBased = calculator.simulate(settings, rate, false);
      for (const key of ['balance', 'invested', 'withdrawn', 'unpaid', 'gain']) close(daily[key], eventBased[key], .00001);
    }
  }
});

test('an empty event-based projection stays zero at extreme rates', () => {
  const projection = calculator.simulate({ ...defaults, initial: 0, deposit: 0, duration: 100 }, 10000, false);
  close(projection.balance, 0);
  assert.equal(projection.overflow, false);
});

test('monthly payments keep the original calendar date through shorter months', () => {
  for (const [year, dates] of [[2024, [0, 29, 60, 90]], [2026, [0, 28, 59, 89]]]) {
    const settings = { ...defaults, initial: 0, deposit: 100, depositOffset: 0, depositInterval: 1, intervalUnit: 'months', duration: .3, today: new Date(year, 0, 31, 12) };
    const prepared = calculator.prepareSettings(settings);
    assert.deepEqual(Array.from(prepared.depositDays), dates);
    const daily = calculator.simulate(prepared, 7);
    const summary = calculator.simulate(prepared, 7, false);
    close(daily.invested, 400);
    close(daily.balance, summary.balance);
    close(daily.balances[dates[1] - 1], 100 * 1.07 ** ((dates[1] - 1) / calculator.DAYS_PER_YEAR));
  }
});

test('quarterly and annual deposits use calendar months and include the final day', () => {
  const today = new Date(2026, 0, 1, 12);
  for (const [interval, count] of [[3, 5], [12, 2], [120, 1]]) {
    const settings = { ...defaults, initial: 0, deposit: 100, depositOffset: 0, depositInterval: interval, intervalUnit: 'months', duration: 1, today };
    close(calculator.simulate(settings, 0).invested, count * 100);
  }
});

test('calendar withdrawals still follow deposits and never overdraw', () => {
  const settings = { ...defaults, initial: 0, deposit: 100, depositOffset: 0, depositInterval: 1, withdrawal: 80, withdrawalOffset: 0, withdrawalInterval: 1, intervalUnit: 'months', duration: .3, today: new Date(2026, 0, 31, 12) };
  const projection = calculator.simulate(settings, 0);
  close(projection.balance, 80);
  close(projection.withdrawn, 320);
  close(projection.unpaid, 0);
});

test('goal solver recovers annual returns with calendar-based cash flows', () => {
  const settings = { ...defaults, intervalUnit: 'months', depositInterval: 1, withdrawalInterval: 3, withdrawal: 400, today: new Date(2026, 0, 31, 12) };
  settings.goal = calculator.simulate(settings, 12.345).balance;
  close(calculator.solveGoal(settings).rate, 12.345, 1e-7);
});

test('year offsets keep monthly withdrawals aligned with deposits after depletion', () => {
  const settings = {
    ...defaults, today: new Date(2026, 9, 5, 12), intervalUnit: 'months',
    deposit: 3600, depositInterval: 1, depositOffsetYears: 0,
    withdrawal: 22000, withdrawalInterval: 1, withdrawalOffsetYears: 10
  };
  const prepared = calculator.prepareSettings(settings);
  assert.equal(prepared.withdrawalOffset, 3653);
  assert.ok(prepared.withdrawalDays.every(day => prepared.depositDays.includes(day)));
  const lower = calculator.simulate(prepared, 5);
  const firstZero = lower.balances.findIndex((balance, day) => day >= prepared.withdrawalOffset && balance === 0);
  assert.ok(firstZero > prepared.withdrawalOffset);
  assert.ok(lower.balances.slice(firstZero).every(balance => balance === 0));
  assert.ok(calculator.simulate(prepared, 15).balance > 0);
  close(lower.balance, calculator.simulate(prepared, 5, false).balance);
  close(lower.withdrawn, calculator.simulate(prepared, 5, false).withdrawn);
});

test('leap-day year offsets preserve the monthly anchor after a shorter anniversary month', () => {
  const today = new Date(2024, 1, 29, 12);
  const settings = {
    ...defaults, today, duration: 2, intervalUnit: 'months',
    depositInterval: 1, depositOffsetYears: 0,
    withdrawal: 100, withdrawalInterval: 1, withdrawalOffsetYears: 1
  };
  const prepared = calculator.prepareSettings(settings);
  assert.equal(prepared.withdrawalDays[0], 365);
  assert.equal(prepared.withdrawalDays[1], 394);
  assert.ok(prepared.withdrawalDays.every(day => prepared.depositDays.includes(day)));
  for (const rate of [-10, 5, 15]) {
    const daily = calculator.simulate(prepared, rate);
    const summary = calculator.simulate(prepared, rate, false);
    close(daily.balance, summary.balance);
    close(daily.withdrawn, summary.withdrawn);
  }
  settings.goal = calculator.simulate(settings, 12.345).balance;
  close(calculator.solveGoal(settings).rate, 12.345, 1e-7);
});

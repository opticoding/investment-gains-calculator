const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModule(file, window = {}) {
  if (['preferences.js', 'controls.js'].includes(file)) loadModule('calculator.js', window);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), { window });
  return window;
}

test('preferences round-trip modes, ranges, schedules, and display choices', () => {
  const storage = new Map();
  const { CompoundPreferences: preferences } = loadModule('preferences.js', { localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  const state = { mode: 'goal', currency: 'USD', chart: 'breakdown', showBounds: true, expanded: true };
  const controls = { initial: { value: 200000, min: 100, max: 2000000 }, annual: { value: 8, min: 0, max: 40 } };
  const schedules = { deposit: true, withdrawal: true };
  preferences.save(state, controls, schedules);
  const restored = JSON.parse(JSON.stringify(preferences.load()));
  assert.deepEqual(restored, { state, controls, schedules });
});

test('malformed, unsupported, or blocked storage falls back to defaults', () => {
  for (const data of ['invalid JSON', 'null', '{"version":4}']) {
    const { CompoundPreferences: preferences } = loadModule('preferences.js', { localStorage: { getItem: () => data } });
    const loaded = preferences.load();
    assert.equal(loaded.state.mode, 'gain');
    assert.equal(loaded.schedules.deposit, false);
    assert.equal(loaded.schedules.withdrawal, false);
  }
  const { CompoundPreferences: blocked } = loadModule('preferences.js', {
    get localStorage() { throw new Error('Storage blocked'); }
  });
  assert.equal(blocked.load().state.currency, 'SEK');
  assert.doesNotThrow(() => blocked.save({}, {}, {}));
});

test('invalid stored display choices cannot replace known options', () => {
  const data = { version: 1, state: { mode: 'invalid', currency: 'ABC', chart: 'invalid', showBounds: 'yes', expanded: 'yes' }, schedules: { deposit: 'yes' } };
  const { CompoundPreferences: preferences } = loadModule('preferences.js', { localStorage: { getItem: () => JSON.stringify(data) } });
  const restored = preferences.load();
  assert.equal(restored.state.currency, 'SEK');
  assert.equal(restored.state.chart, 'area');
  assert.equal(restored.state.expanded, false);
  assert.equal(restored.state.showBounds, true);
  assert.equal(restored.schedules.deposit, false);
});

test('legacy day offsets and custom ranges migrate to years without changing payment days', () => {
  const data = { version: 1, controls: {
    depositOffset: { value: 730, min: 365, max: 1826 },
    withdrawalOffset: { value: 4000, min: 2000, max: 10000 }
  } };
  const window = loadModule('preferences.js', { localStorage: { getItem: () => JSON.stringify(data) } });
  const restored = window.CompoundPreferences.load();
  for (const key of ['depositOffset', 'withdrawalOffset']) {
    for (const field of ['value', 'min', 'max']) {
      assert.equal(window.InvestmentCalculator.offsetDays(restored.controls[key][field]), data.controls[key][field]);
    }
  }
});

test('legacy default offset ranges use the new 0 to 50 year limits', () => {
  const data = { version: 1, controls: {
    depositOffset: { value: 0, min: 0, max: 365 },
    withdrawalOffset: { value: 3650, min: 0, max: 3650 }
  } };
  const { CompoundPreferences: preferences } = loadModule('preferences.js', { localStorage: { getItem: () => JSON.stringify(data) } });
  const restored = JSON.parse(JSON.stringify(preferences.load()));
  assert.deepEqual(restored.controls.depositOffset, { value: 0, min: 0, max: 50 });
  assert.deepEqual(restored.controls.withdrawalOffset, { value: 10, min: 0, max: 50 });
});

test('year offsets are converted once at the control boundary, including zero and fractions', () => {
  const window = loadModule('controls.js');
  const raw = { initial: 0, deposit: 10, depositInterval: 1, depositOffset: 1, withdrawal: 0, withdrawalInterval: 1, withdrawalOffset: 10, duration: 1.1, goal: 1000 };
  const controlState = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, { value }]));
  const settings = window.NumericControls.prototype.settings.call({ state: controlState });
  assert.equal(settings.depositOffset, 365);
  assert.equal(settings.withdrawalOffset, 3652);
  assert.equal(controlState.depositOffset.value, 1);
  assert.equal(settings.intervalUnit, 'months');
  settings.today = new Date(2026, 0, 1, 12);
  const projection = window.InvestmentCalculator.simulate(settings, 0);
  assert.equal(projection.balances[364], 0);
  assert.equal(projection.balances[365], 10);
  assert.equal(projection.balance, 20);
  assert.equal(window.InvestmentCalculator.offsetDays(0), 0);
  assert.equal(window.InvestmentCalculator.offsetDays(.5), 183);
});

test('new saved offsets stay in years through successive loads', () => {
  const storage = new Map();
  const { CompoundPreferences: preferences } = loadModule('preferences.js', { localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  const controls = { depositOffset: { value: .5, min: 0, max: 50 }, withdrawalOffset: { value: 10, min: 0, max: 50 } };
  preferences.save({}, controls, {});
  assert.equal(preferences.load().controls.depositOffset.value, .5);
  assert.equal(preferences.load().controls.withdrawalOffset.value, 10);
  assert.equal(JSON.parse(storage.get('compound.preferences.v1')).version, 3);
});

test('legacy day intervals migrate to whole months with the new limits', () => {
  const data = { version: 2, controls: {
    depositInterval: { value: 30, min: 1, max: 365 },
    withdrawalInterval: { value: 90, min: 30, max: 600 },
    annual: { value: 15, min: 5, max: 20 }
  } };
  const { CompoundPreferences: preferences } = loadModule('preferences.js', { localStorage: { getItem: () => JSON.stringify(data) } });
  const restored = JSON.parse(JSON.stringify(preferences.load()));
  assert.deepEqual(restored.controls.depositInterval, { value: 1, min: 1, max: 12 });
  assert.deepEqual(restored.controls.withdrawalInterval, { value: 3, min: 1, max: 20 });
  assert.deepEqual(restored.controls.annual, data.controls.annual);
});

test('month interval migrations stay valid when old ranges round to one value or exceed 120', () => {
  const data = { version: 1, controls: {
    depositInterval: { value: 10, min: 1, max: 20 },
    withdrawalInterval: { value: 36525, min: 36500, max: 36525 }
  } };
  const { CompoundPreferences: preferences } = loadModule('preferences.js', { localStorage: { getItem: () => JSON.stringify(data) } });
  const restored = preferences.load();
  for (const entry of Object.values(restored.controls)) {
    assert.ok(entry.min >= 1 && entry.max <= 120 && entry.min < entry.max);
    assert.ok(Number.isInteger(entry.value));
  }
});

test('new month intervals survive repeated preference loads without conversion', () => {
  const storage = new Map();
  const { CompoundPreferences: preferences } = loadModule('preferences.js', { localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  const controls = { depositInterval: { value: 3, min: 1, max: 12 }, withdrawalInterval: { value: 120, min: 1, max: 120 } };
  preferences.save({}, controls, {});
  assert.deepEqual(JSON.parse(JSON.stringify(preferences.load().controls)), controls);
});

test('saved custom goals preserve the configured zero minimum', () => {
  const { NumericControls } = loadModule('controls.js');
  const controls = { state: {}, sync() {} };
  NumericControls.prototype.restore.call(controls, { goal: { value: 5000000, min: 0, max: 20000000 } });
  assert.equal(controls.state.goal.value, 5000000);
  assert.equal(controls.state.goal.min, 0);
});

const curves = loadModule('curves.js').ProjectionCurves;
const schedule = { deposit: 2500, depositInterval: 30, depositOffset: 30, withdrawal: 0, withdrawalInterval: 30, withdrawalOffset: 365 };

test('curve samples align regular payments and preserve both endpoints', () => {
  for (const days of [37, 365, 7305, 36524]) {
    const samples = curves.sampleDays(days, schedule);
    assert.equal(samples[0], 0);
    assert.equal(samples[samples.length - 1], days);
    assert.ok(samples.length <= 65);
    assert.ok(samples.slice(0, -1).every(day => day % 30 === 0));
    assert.ok(samples.every((day, index) => index === 0 || day > samples[index - 1]));
  }
});

test('calendar withdrawal curves do not invent rises in the reported declining scenario', () => {
  const { InvestmentCalculator: calculator } = loadModule('calculator.js');
  const settings = calculator.prepareSettings({
    initial: 100000, deposit: 0, depositInterval: 1, depositOffsetYears: 0,
    withdrawal: 5631, withdrawalInterval: 1, withdrawalOffsetYears: 10,
    duration: 20, intervalUnit: 'months', today: new Date(2026, 9, 5, 12)
  });
  const projection = calculator.simulate(settings, 15);
  assert.ok(Math.abs(projection.balance - 150119.54597298824) < .001);
  assert.equal(projection.withdrawn, 681351);
  const samples = curves.sampleDays(projection.days, settings);
  const declining = samples.filter(day => day >= settings.withdrawalDays[0]);
  assert.ok(declining.length > 20);
  assert.ok(declining.slice(0, -1).every(day => settings.withdrawalDays.includes(day)));
  const segments = curves.segments(declining.map(day => ({ x: day, y: projection.balances[day] })));
  for (const segment of segments) {
    let previous = segment.start.y;
    for (let step = 1; step <= 100; step += 1) {
      const value = curves.valueAt(segment, step / 100);
      assert.ok(value <= previous + 1e-9, `False rise at day ${segment.start.x}`);
      previous = value;
    }
  }
});

test('calendar samples stay on payment dates across leap years, offsets, and different intervals', () => {
  const { InvestmentCalculator: calculator } = loadModule('calculator.js');
  for (const today of [new Date(2024, 1, 29, 12), new Date(2026, 0, 31, 12), new Date(2026, 9, 5, 12)]) {
    for (const interval of [1, 3, 12, 120]) {
      const settings = calculator.prepareSettings({
        initial: 100000, deposit: 2500, depositInterval: interval, depositOffsetYears: 1,
        withdrawal: 0, duration: 20, intervalUnit: 'months', today
      });
      const days = calculator.durationDays(settings.duration);
      const samples = curves.sampleDays(days, settings);
      assert.equal(samples[0], 0);
      assert.equal(samples[samples.length - 1], days);
      assert.ok(samples.length <= 66);
      assert.ok(samples.every((day, index) => index === 0 || day > samples[index - 1]));
      assert.ok(samples.filter(day => day >= settings.depositDays[0] && day <= settings.depositDays.at(-1) && day !== days).every(day => settings.depositDays.includes(day)));
    }
  }
});

test('calendar sampling handles combined schedules, disabled payments, and payments beyond the duration', () => {
  const schedule = {
    deposit: 100, depositOffset: 0, depositIntervalDays: 61, depositDays: [0, 59, 120, 181, 243, 304],
    withdrawal: 50, withdrawalOffset: 0, withdrawalIntervalDays: 91, withdrawalDays: [0, 90, 181, 273]
  };
  const calendar = new Set([...schedule.depositDays, ...schedule.withdrawalDays]);
  const samples = curves.sampleDays(365, schedule);
  assert.ok(samples.filter(day => day <= 304).every(day => calendar.has(day)));
  const disabled = curves.sampleDays(365, { ...schedule, deposit: 0, withdrawal: 0 });
  assert.ok(disabled.length > samples.length);
  const future = curves.sampleDays(365, { ...schedule, depositOffset: 500, depositDays: [], withdrawal: 0 });
  assert.deepEqual(Array.from(future), Array.from(disabled));
});

test('withdrawal starts have a full curve transition for every month interval', () => {
  const { InvestmentCalculator: calculator } = loadModule('calculator.js');
  for (const today of [new Date(2026, 9, 5, 12), new Date(2026, 0, 31, 12), new Date(2024, 1, 29, 12)]) {
    for (let interval = 1; interval <= 12; interval += 1) {
      const settings = calculator.prepareSettings({
        initial: 194500, deposit: 0, depositInterval: 1, depositOffsetYears: 0,
        withdrawal: 34642, withdrawalInterval: interval, withdrawalOffsetYears: 10,
        duration: 15, intervalUnit: 'months', today
      });
      const projection = calculator.simulate(settings, 13.8);
      const samples = curves.sampleDays(projection.days, settings);
      const firstPayment = settings.withdrawalDays[0];
      assert.ok(samples.includes(firstPayment), `Missing start for ${interval} months`);
      const previousSample = samples.filter(day => day < firstPayment).at(-1);
      assert.ok(firstPayment - previousSample >= settings.withdrawalIntervalDays, `Compressed incoming transition for ${interval} months`);
      const nextSample = samples.find(day => day > firstPayment);
      assert.ok(nextSample >= settings.withdrawalDays[1], `Compressed transition for ${interval} months`);
      assert.equal(samples[0], 0);
      assert.equal(samples.at(-1), projection.days);
      assert.ok(samples.every((day, index) => index === 0 || day > samples[index - 1]));
      if (interval === 3 && today.getMonth() === 9) {
        assert.equal(Math.round(projection.balance), 327969);
        assert.equal(projection.withdrawn, 727482);
        const points = samples.map(day => ({ x: day, y: projection.balances[day] }));
        const rendered = curves.segments(points);
        const turn = rendered.find(segment => segment.start.x === firstPayment);
        assert.equal(turn.start.y, projection.balances[firstPayment]);
        let previous = turn.start.y;
        for (let step = 1; step <= 100; step += 1) {
          const value = curves.valueAt(turn, step / 100);
          assert.ok(value <= previous + 1e-9);
          previous = value;
        }
      }
    }
  }
});

test('a later withdrawal schedule keeps its transition when deposits are already running', () => {
  const { InvestmentCalculator: calculator } = loadModule('calculator.js');
  const settings = calculator.prepareSettings({
    initial: 194500, deposit: 1000, depositInterval: 1, depositOffsetYears: 0,
    withdrawal: 34642, withdrawalInterval: 3, withdrawalOffsetYears: 10,
    duration: 15, intervalUnit: 'months', today: new Date(2026, 9, 5, 12)
  });
  const samples = curves.sampleDays(calculator.durationDays(15), settings);
  const firstPayment = settings.withdrawalDays[0];
  assert.ok(samples.includes(firstPayment));
  const previousSample = samples.filter(day => day < firstPayment).at(-1);
  assert.ok(firstPayment - previousSample >= settings.withdrawalIntervalDays);
});

test('partial final payment cycles keep a smooth declining tail and the exact end balance', () => {
  const { InvestmentCalculator: calculator } = loadModule('calculator.js');
  for (const duration of [28, 29, 30, 31, 32]) {
    const settings = calculator.prepareSettings({
      initial: 200000, deposit: 1000, depositInterval: 1, depositOffsetYears: 0,
      withdrawal: 7096, withdrawalInterval: 1, withdrawalOffsetYears: 10,
      duration, intervalUnit: 'months', today: new Date(2026, 9, 5, 12)
    });
    const projection = calculator.simulate(settings, 10);
    const samples = curves.sampleDays(projection.days, settings, projection.balances);
    const tail = samples.slice(-3);
    const slope = (from, to) => (projection.balances[to] - projection.balances[from]) / (to - from);
    assert.ok(slope(tail[1], tail[2]) <= slope(tail[0], tail[1]), `Tail flattens at ${duration} years`);
    const rendered = curves.segments(samples.map(day => ({ x: day, y: projection.balances[day] })));
    assert.equal(curves.valueAt(rendered.at(-1), 1), projection.balance);
    if (duration === 29) assert.equal(Math.round(projection.balance), 456685);
    if (duration === 30) assert.equal(Math.round(projection.balance), 431984);
  }
});

test('endpoint smoothing preserves schedule starts, endpoints, and valid curves across durations', () => {
  const { InvestmentCalculator: calculator } = loadModule('calculator.js');
  for (let duration = 1; duration <= 50; duration += 1) {
    for (const interval of [1, 3, 5, 7, 12]) {
      const settings = calculator.prepareSettings({
        initial: 200000, deposit: 1000, depositInterval: 1, depositOffsetYears: 0,
        withdrawal: 7096, withdrawalInterval: interval, withdrawalOffsetYears: 10,
        duration, intervalUnit: 'months', today: new Date(2026, 9, 5, 12)
      });
      const projection = calculator.simulate(settings, 10);
      const samples = curves.sampleDays(projection.days, settings, projection.balances);
      assert.equal(samples[0], 0);
      assert.equal(samples.at(-1), projection.days);
      assert.ok(samples.every((day, index) => index === 0 || day > samples[index - 1]));
      if (settings.withdrawalDays.length) assert.ok(samples.includes(settings.withdrawalDays[0]));
      for (const segment of curves.segments(samples.map(day => ({ x: day, y: projection.balances[day] })))) {
        for (const fraction of [.25, .5, .75]) {
          const value = curves.valueAt(segment, fraction);
          assert.ok(Number.isFinite(value));
          assert.ok(value >= Math.min(segment.start.y, segment.end.y) - 1e-8);
          assert.ok(value <= Math.max(segment.start.y, segment.end.y) + 1e-8);
        }
      }
    }
  }
});

test('smooth curves preserve endpoints without overshoot at rises, falls, or plateaus', () => {
  const values = [100, 125, 125, 400, 0, 0, 50];
  const points = values.map((y, index) => ({ x: index * 30, y }));
  const segments = curves.segments(points);
  for (const segment of segments) {
    assert.equal(curves.valueAt(segment, 0), segment.start.y);
    assert.equal(curves.valueAt(segment, 1), segment.end.y);
    const lower = Math.min(segment.start.y, segment.end.y);
    const upper = Math.max(segment.start.y, segment.end.y);
    for (let step = 0; step <= 100; step += 1) {
      const value = curves.valueAt(segment, step / 100);
      assert.ok(value >= lower - 1e-9 && value <= upper + 1e-9);
    }
  }
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    const incomingSlope = 3 * (previous.end.y - previous.control2.y) / (previous.end.x - previous.start.x);
    const outgoingSlope = 3 * (current.control1.y - current.start.y) / (current.end.x - current.start.x);
    assert.ok(Math.abs(incomingSlope - outgoingSlope) < 1e-9);
  }
});

test('a regular contribution series becomes a continuous straight trend', () => {
  const segments = curves.segments([{ x: 0, y: 100 }, { x: 30, y: 125 }, { x: 60, y: 150 }, { x: 90, y: 175 }]);
  for (const segment of segments) {
    assert.ok(Math.abs(curves.valueAt(segment, .5) - (segment.start.y + segment.end.y) / 2) < 1e-9);
  }
});

const chartWindow = loadModule('chart.js', { ProjectionCurves: curves, matchMedia: () => ({ matches: true }) });
const chartPrototype = chartWindow.ProjectionChart.prototype;

test('tooltip position follows the displayed curve while its amounts remain daily values', () => {
  const tooltip = { offsetWidth: 225, offsetHeight: 150, style: {} };
  const chart = {
    hoverDay: 0, width: 1000, height: 600, tooltip,
    data: { main: { balances: [700000, 665358], investedSeries: [194500, 194500], withdrawnSeries: [0, 34642], rate: 13.8 }, currency: 'SEK' },
    format: { money: (value, currency) => `${value} ${currency}`, date: () => 'Test date', percent: value => `${value}%` },
    dateAt() {}, geometry: () => ({}), x: () => 300,
    curveY: day => 200 + day * .5
  };
  chartPrototype.showTooltip.call(chart);
  assert.equal(tooltip.style.top, '150px');
  assert.match(tooltip.innerHTML, /700000 SEK/);
  chart.hoverDay = 1;
  chartPrototype.showTooltip.call(chart);
  assert.equal(tooltip.style.top, '150.5px');
  assert.match(tooltip.innerHTML, /665358 SEK/);
  assert.match(tooltip.innerHTML, /34642 SEK/);
});

test('the y-axis uses the main line extrema without zero baseline or headroom', () => {
  const data = { mode: 'gain', main: { balances: [100000, 150000, 300000] }, minimum: { balances: [0, 10000] }, maximum: { balances: [1e9, 1e12] } };
  const range = chartPrototype.axisRange.call({ data });
  assert.equal(range.minimum, 100000);
  assert.equal(range.maximum, 300000);
  const geometry = { top: 24, bottom: 324, height: 300 };
  assert.equal(chartPrototype.y(100000, geometry, range), geometry.bottom);
  assert.equal(chartPrototype.y(300000, geometry, range), geometry.top);
});

test('goal mode preserves the target as the top while fitting the lower balance', () => {
  const range = chartPrototype.axisRange.call({ data: { mode: 'goal', goal: 500000, main: { balances: [100000, 300000, 500000] } } });
  assert.equal(range.minimum, 100000);
  assert.equal(range.maximum, 500000);
});

test('falling, variable, flat, and empty projections have valid visible scales', () => {
  for (const balances of [[300000, 200000, 100000], [200000, 50000, 300000, 100000], [100000, 100000], [0, 0]]) {
    const range = chartPrototype.axisRange.call({ data: { mode: 'gain', main: { balances } } });
    assert.ok(Number.isFinite(range.minimum) && Number.isFinite(range.maximum));
    assert.ok(range.maximum > range.minimum);
    assert.ok(balances.every(value => value >= range.minimum && value <= range.maximum));
  }
});

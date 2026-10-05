/* Application orchestration: settings, projections, and presentation. */
(function () {
  'use strict';

  const calculator = window.InvestmentCalculator;
  const preferences = window.CompoundPreferences;
  const saved = preferences.load();
  const state = saved.state;
  const depositSchedule = document.querySelector('.schedule-details');
  const withdrawalSchedule = document.querySelector('.withdrawal-section .schedule-details');
  const stackedLayout = window.matchMedia('(max-width: 850px)');
  let restoring = true;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const compactFormat = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
  const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const yearFormat = new Intl.DateTimeFormat('en-GB', { year: 'numeric' });
  const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' });
  const shortDateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  const scientific = value => value.toExponential(1);
  const format = {
    number: value => Math.abs(value) >= 1e15 ? scientific(value) : numberFormat.format(value),
    money: (value, currency) => `${Math.abs(value) >= 1e15 ? scientific(value) : numberFormat.format(value)} ${currency}`,
    compact: value => Math.abs(value) >= 1e15 ? scientific(value) : compactFormat.format(value),
    axisValue: (value, step) => {
      if (Math.abs(value) >= 1e15) return scientific(value);
      const digits = Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(step))));
      if (step < 1000) return new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value);
      return compactFormat.format(value);
    },
    percent: value => `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: Math.abs(value) < 1 ? 3 : 2 }).format(value)}%`,
    date: date => dateFormat.format(date),
    axisDate: (date, days) => days < 120 ? shortDateFormat.format(date) : days < 1461 ? monthFormat.format(date) : yearFormat.format(date)
  };
  let updateFrame = 0;
  let lastProjection = null;
  const controls = new window.NumericControls(document.getElementById('controls-form'), requestUpdate);
  const chart = new window.ProjectionChart(document.getElementById('projection-chart'), document.getElementById('chart-tooltip'), format);

  function requestUpdate() {
    savePreferences();
    cancelAnimationFrame(updateFrame);
    updateFrame = requestAnimationFrame(update);
  }

  function savePreferences() {
    if (restoring) return;
    preferences.save(state, controls.state, { deposit: depositSchedule.open, withdrawal: withdrawalSchedule.open });
  }

  function pressedButtons(selector, attribute, value) {
    document.querySelectorAll(selector).forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset[attribute] === value));
    });
  }

  function setMode(mode) {
    state.mode = mode;
    controls.setGoalMode(mode === 'goal');
    if (mode === 'gain') controls.sync('annual');
    pressedButtons('[data-mode]', 'mode', mode);
    requestUpdate();
  }

  function update() {
    const settings = calculator.prepareSettings({ ...controls.settings(), today });
    const messages = [];
    let rate = settings.annual;
    let solution = null;
    if (state.mode === 'goal') {
      solution = calculator.solveGoal(settings);
      controls.setComputedRate(solution.rate);
      if (solution.rate !== null) rate = solution.rate;
      else {
        rate = solution.reason === 'below' ? calculator.RATE_LIMITS.min : calculator.RATE_LIMITS.max;
        if (settings.initial === 0 && settings.deposit === 0) messages.push('This goal needs an investment. Add an initial amount or repeated deposit.');
        else if (solution.reason === 'below') messages.push('The goal is below the balance possible at -99.9% annual return. The chart shows that lowest return. Adjust your goal or payments.');
        else messages.push('This goal needs more than 10,000% annual return, or payments arrive too late to grow. The chart shows the highest supported return. Adjust your goal, timing, or duration.');
      }
    }
    const main = calculator.simulate(settings, rate);
    const { min, max } = controls.state.annual;
    const minimum = state.showBounds ? calculator.simulate(settings, min) : null;
    const maximum = state.showBounds ? calculator.simulate(settings, max) : null;
    if (main.unpaid > .005) messages.push(`${format.money(main.unpaid, state.currency)} in scheduled withdrawals could not be paid because the balance was too low.`);
    if (main.overflow) messages.push('This scenario exceeds the calculation limit. Reduce the annual return or duration to see an accurate projection.');
    if (state.chart === 'breakdown' && (main.gain < -.005 || main.invested - main.withdrawn < -.005)) messages.push('A negative component cannot be stacked. Net invested is shown as a dashed line and may fall outside the balance scale.');

    lastProjection = main;
    document.getElementById('final-balance').textContent = format.number(main.balance);
    document.getElementById('balance-currency').textContent = state.currency;
    document.getElementById('total-invested').textContent = format.money(main.invested, state.currency);
    document.getElementById('total-gain').textContent = `${main.gain > .005 ? '+' : ''}${format.money(main.gain, state.currency)}`;
    document.getElementById('total-gain').classList.toggle('negative', main.gain < 0);
    document.getElementById('total-withdrawn').textContent = format.money(main.withdrawn, state.currency);
    document.getElementById('annual-return').textContent = solution && solution.rate === null ? 'Unavailable' : format.percent(rate);
    document.getElementById('return-label').textContent = state.mode === 'goal' ? 'Required annual return' : 'Annual return';
    document.getElementById('projection-subtitle').textContent = state.mode === 'goal' ? `Goal: ${format.money(settings.goal, state.currency)} in ${settings.duration} ${settings.duration === 1 ? 'year' : 'years'}` : `Projected balance in ${settings.duration} ${settings.duration === 1 ? 'year' : 'years'}`;
    const end = new Date(today); end.setDate(end.getDate() + main.days);
    document.getElementById('chart-summary').textContent = `From ${format.date(today)} to ${format.date(end)}, the portfolio reaches ${format.money(main.balance, state.currency)}. Total invested: ${format.money(main.invested, state.currency)}. Investment gain: ${format.money(main.gain, state.currency)}. Total withdrawn: ${format.money(main.withdrawn, state.currency)}. Annual return: ${format.percent(rate)}.`;
    const message = document.getElementById('projection-message');
    message.textContent = messages.join(' ');
    message.hidden = !messages.length;
    document.getElementById('chart-empty').hidden = settings.initial !== 0 || settings.deposit !== 0;
    document.getElementById('principal-legend').hidden = state.chart !== 'breakdown';
    document.getElementById('gain-legend').hidden = state.chart !== 'breakdown';
    document.getElementById('min-legend').hidden = !state.showBounds;
    document.getElementById('max-legend').hidden = !state.showBounds;
    document.getElementById('min-legend-text').textContent = `${format.percent(min)} return`;
    document.getElementById('max-legend-text').textContent = `${format.percent(max)} return`;
    chart.update({ main, minimum, maximum, currency: state.currency, today, goal: settings.goal, type: state.chart, mode: state.mode, showBounds: state.showBounds, schedule: settings });
  }

  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  document.querySelectorAll('[data-currency]').forEach(button => button.addEventListener('click', () => {
    state.currency = button.dataset.currency;
    controls.setCurrency(state.currency);
    pressedButtons('[data-currency]', 'currency', state.currency);
    requestUpdate();
  }));
  document.querySelectorAll('[data-chart]').forEach(button => button.addEventListener('click', () => {
    state.chart = button.dataset.chart;
    pressedButtons('[data-chart]', 'chart', state.chart);
    requestUpdate();
  }));
  document.getElementById('bounds-toggle').addEventListener('change', event => {
    state.showBounds = event.target.checked;
    requestUpdate();
  });

  function expandChart(expanded) {
    state.expanded = expanded;
    applyExpansion();
    savePreferences();
  }

  function applyExpansion() {
    const expanded = state.expanded && !stackedLayout.matches;
    document.body.classList.toggle('chart-expanded', expanded);
    document.querySelector('.app-header').inert = expanded;
    document.getElementById('workspace').classList.toggle('is-expanded', expanded);
    document.getElementById('controls-panel').inert = expanded;
    const button = document.getElementById('expand-button');
    button.setAttribute('aria-expanded', String(expanded));
    button.title = expanded ? 'Show controls' : 'Expand chart';
    button.setAttribute('aria-label', button.title);
    document.getElementById('expand-label').textContent = expanded ? 'Show controls' : 'Expand chart';
    // ResizeObserver resizes the chart after the grid layout changes.
  }
  document.getElementById('expand-button').addEventListener('click', () => expandChart(!state.expanded));
  stackedLayout.addEventListener('change', applyExpansion);
  depositSchedule.addEventListener('toggle', savePreferences);
  withdrawalSchedule.addEventListener('toggle', savePreferences);
  window.addEventListener('pagehide', savePreferences);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.expanded) expandChart(false);
  });

  document.getElementById('reset-button').addEventListener('click', () => {
    controls.reset();
    state.currency = 'SEK';
    state.chart = 'area';
    state.showBounds = true;
    state.expanded = false;
    applyExpansion();
    controls.setCurrency('SEK');
    document.getElementById('bounds-toggle').checked = true;
    pressedButtons('[data-currency]', 'currency', 'SEK');
    pressedButtons('[data-chart]', 'chart', 'area');
    depositSchedule.open = false;
    withdrawalSchedule.open = false;
    setMode('gain');
  });

  const dialog = document.getElementById('about-dialog');
  document.getElementById('about-button').addEventListener('click', () => dialog.showModal());
  document.getElementById('close-about').addEventListener('click', () => dialog.close());
  document.getElementById('done-about').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });

  // Read-only snapshot useful for inspection without coupling the UI to the engine.
  window.Compound = Object.freeze({ getProjection: () => lastProjection });
  controls.restore(saved.controls);
  controls.setCurrency(state.currency);
  controls.setGoalMode(state.mode === 'goal');
  controls.sync('annual');
  pressedButtons('[data-mode]', 'mode', state.mode);
  pressedButtons('[data-currency]', 'currency', state.currency);
  pressedButtons('[data-chart]', 'chart', state.chart);
  document.getElementById('bounds-toggle').checked = state.showBounds;
  depositSchedule.open = saved.schedules.deposit;
  withdrawalSchedule.open = saved.schedules.withdrawal;
  applyExpansion();
  restoring = false;
  savePreferences();
  update();
})();

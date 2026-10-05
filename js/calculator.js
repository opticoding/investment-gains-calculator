/* Pure calculation functions. No DOM or external dependencies. */
(function (global) {
  'use strict';

  const DAYS_PER_YEAR = 365.2425;
  const BALANCE_LIMIT = 1e100;
  const RATE_LIMITS = Object.freeze({ min: -99.9, max: 10000 });

  function offsetDays(years) {
    return Math.round(years * DAYS_PER_YEAR);
  }

  function durationDays(years) {
    return Math.max(1, offsetDays(years));
  }

  function calendarOffsetDays(years, today) {
    const start = new Date(today);
    const wholeYears = Math.floor(years);
    const anniversary = new Date(start.getFullYear() + wholeYears, start.getMonth(), 1, 12);
    const monthEnd = new Date(anniversary.getFullYear(), anniversary.getMonth() + 1, 0).getDate();
    anniversary.setDate(Math.min(start.getDate(), monthEnd));
    const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const anniversaryDay = Date.UTC(anniversary.getFullYear(), anniversary.getMonth(), anniversary.getDate());
    return (anniversaryDay - startDay) / 86400000 + offsetDays(years - wholeYears);
  }

  function calendarPaymentDays(offset, interval, lastDay, today, anchorDay) {
    if (offset > lastDay) return [];
    const start = new Date(today);
    start.setHours(12, 0, 0, 0);
    const serialDay = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
    const firstDay = serialDay(start);
    start.setDate(start.getDate() + offset);
    const dates = [];
    for (let index = 0; ; index += 1) {
      // Anchor every payment to the original day. January 31 becomes
      // February 28/29, then March 31 rather than drifting to March 28.
      const date = new Date(start.getFullYear(), start.getMonth() + index * interval, 1, 12);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      date.setDate(Math.min(anchorDay ?? start.getDate(), monthEnd));
      const day = serialDay(date) - firstDay;
      if (day > lastDay) break;
      dates.push(day);
    }
    return dates;
  }

  function prepareSettings(settings) {
    if (settings.intervalUnit !== 'months' || settings.monthlyPrepared) return settings;
    const days = durationDays(settings.duration);
    const today = settings.today ? new Date(settings.today) : new Date();
    const depositOffset = settings.depositOffsetYears === undefined ? settings.depositOffset : calendarOffsetDays(settings.depositOffsetYears, today);
    const withdrawalOffset = settings.withdrawalOffsetYears === undefined ? settings.withdrawalOffset : calendarOffsetDays(settings.withdrawalOffsetYears, today);
    const depositAnchor = Number.isInteger(settings.depositOffsetYears) ? today.getDate() : undefined;
    const withdrawalAnchor = Number.isInteger(settings.withdrawalOffsetYears) ? today.getDate() : undefined;
    return {
      ...settings,
      monthlyPrepared: true,
      depositOffset,
      withdrawalOffset,
      depositDays: settings.deposit > 0 ? calendarPaymentDays(depositOffset, settings.depositInterval, days, today, depositAnchor) : [],
      withdrawalDays: settings.withdrawal > 0 ? calendarPaymentDays(withdrawalOffset, settings.withdrawalInterval, days, today, withdrawalAnchor) : [],
      depositIntervalDays: Math.round(settings.depositInterval * DAYS_PER_YEAR / 12),
      withdrawalIntervalDays: Math.round(settings.withdrawalInterval * DAYS_PER_YEAR / 12)
    };
  }

  function paymentDay(settings, kind, index) {
    const dates = settings[`${kind}Days`];
    return dates ? (dates[index] ?? Infinity) : settings[`${kind}Offset`] + index * settings[`${kind}Interval`];
  }

  // Goal solving only needs totals. Jump between payments instead of visiting
  // every day, so long durations remain responsive while moving a slider.
  function simulateSummary(settings, rate) {
    const days = durationDays(settings.duration);
    const dailyLogReturn = Math.log1p(rate / 100) / DAYS_PER_YEAR;
    let balance = settings.initial;
    let invested = settings.initial;
    let withdrawn = 0;
    let unpaid = 0;
    let overflow = false;
    let previousDay = 0;
    let depositIndex = 0;
    let withdrawalIndex = 0;
    let depositDay = settings.deposit > 0 ? paymentDay(settings, 'deposit', depositIndex) : Infinity;
    let withdrawalDay = settings.withdrawal > 0 ? paymentDay(settings, 'withdrawal', withdrawalIndex) : Infinity;
    const accrue = elapsed => {
      // Avoid 0 * Infinity in long, high-return scenarios without any capital.
      if (balance > 0) balance *= Math.exp(dailyLogReturn * elapsed);
      if (!Number.isFinite(balance) || balance > BALANCE_LIMIT) {
        balance = BALANCE_LIMIT;
        overflow = true;
      }
    };
    for (let day = Math.min(depositDay, withdrawalDay); day <= days; day = Math.min(depositDay, withdrawalDay)) {
      accrue(day - previousDay);
      if (day === depositDay) {
        balance += settings.deposit;
        invested += settings.deposit;
        depositDay = paymentDay(settings, 'deposit', ++depositIndex);
      }
      if (day === withdrawalDay) {
        const paid = Math.min(balance, settings.withdrawal);
        balance -= paid;
        withdrawn += paid;
        unpaid += settings.withdrawal - paid;
        withdrawalDay = paymentDay(settings, 'withdrawal', ++withdrawalIndex);
      }
      previousDay = day;
    }
    accrue(days - previousDay);
    return { days, rate, balances: null, investedSeries: null, withdrawnSeries: null, balance, invested, withdrawn, unpaid, overflow, gain: balance + withdrawn - invested };
  }

  /** Day 0 payments follow the initial investment; later payments follow growth. */
  function simulate(settings, rate, collect = true) {
    settings = prepareSettings(settings);
    if (!collect) return simulateSummary(settings, rate);
    const days = durationDays(settings.duration);
    const factor = Math.exp(Math.log1p(rate / 100) / DAYS_PER_YEAR);
    const balances = collect ? new Float64Array(days + 1) : null;
    const investedSeries = collect ? new Float64Array(days + 1) : null;
    const withdrawnSeries = collect ? new Float64Array(days + 1) : null;
    let balance = settings.initial;
    let invested = settings.initial;
    let withdrawn = 0;
    let unpaid = 0;
    let overflow = false;
    let depositIndex = 0;
    let withdrawalIndex = 0;
    let depositDay = settings.deposit > 0 ? paymentDay(settings, 'deposit', depositIndex) : Infinity;
    let withdrawalDay = settings.withdrawal > 0 ? paymentDay(settings, 'withdrawal', withdrawalIndex) : Infinity;

    for (let day = 0; day <= days; day += 1) {
      if (day > 0) balance *= factor;
      if (!Number.isFinite(balance) || balance > BALANCE_LIMIT) {
        balance = BALANCE_LIMIT;
        overflow = true;
      }
      if (day === depositDay) {
        balance += settings.deposit;
        invested += settings.deposit;
        depositDay = paymentDay(settings, 'deposit', ++depositIndex);
      }
      if (day === withdrawalDay) {
        const paid = Math.min(balance, settings.withdrawal);
        balance -= paid;
        withdrawn += paid;
        unpaid += settings.withdrawal - paid;
        withdrawalDay = paymentDay(settings, 'withdrawal', ++withdrawalIndex);
      }
      if (collect) {
        balances[day] = balance;
        investedSeries[day] = invested;
        withdrawnSeries[day] = withdrawn;
      }
    }
    return {
      days, rate, balances, investedSeries, withdrawnSeries,
      balance, invested, withdrawn, unpaid, overflow,
      gain: balance + withdrawn - invested
    };
  }

  /** Final balances are monotonic in rate, including capped withdrawals. */
  function solveGoal(settings) {
    settings = prepareSettings(settings);
    let low = RATE_LIMITS.min;
    let high = RATE_LIMITS.max;
    const lowerBalance = simulate(settings, low, false).balance;
    const upperBalance = simulate(settings, high, false).balance;
    if (settings.goal < lowerBalance - .005) return { rate: null, reason: 'below' };
    if (settings.goal > upperBalance + .005) return { rate: null, reason: 'above' };
    for (let iteration = 0; iteration < 70; iteration += 1) {
      const middle = (low + high) / 2;
      if (simulate(settings, middle, false).balance < settings.goal) low = middle;
      else high = middle;
    }
    return { rate: (low + high) / 2, reason: null };
  }

  global.InvestmentCalculator = Object.freeze({ DAYS_PER_YEAR, RATE_LIMITS, offsetDays, calendarOffsetDays, durationDays, prepareSettings, simulate, solveGoal });
})(window);

/* Versioned browser preferences. Storage can be unavailable for local files. */
(function (global) {
  'use strict';

  // Keep the existing key; the payload version determines schedule units.
  const STORAGE_KEY = 'compound.preferences.v1';
  const defaultState = () => ({ mode: 'gain', currency: 'SEK', chart: 'area', showBounds: true, expanded: false });

  function load() {
    const result = { state: defaultState(), controls: {}, schedules: { deposit: false, withdrawal: false } };
    try {
      const saved = JSON.parse(global.localStorage.getItem(STORAGE_KEY));
      if (!saved || ![1, 2, 3].includes(saved.version)) return result;
      const state = saved.state || {};
      for (const [key, choices] of Object.entries({ mode: ['gain', 'goal'], currency: ['SEK', 'EUR', 'USD'], chart: ['area', 'breakdown'] })) {
        if (choices.includes(state[key])) result.state[key] = state[key];
      }
      if (state.chart === 'line') result.state.chart = 'area';
      for (const key of ['showBounds', 'expanded']) {
        if (typeof state[key] === 'boolean') result.state[key] = state[key];
      }
      if (saved.controls && typeof saved.controls === 'object') {
        result.controls = saved.controls;
        if (saved.version === 1) {
          for (const key of ['depositOffset', 'withdrawalOffset']) {
            const entry = result.controls[key];
            if (!entry || ![entry.value, entry.min, entry.max].every(value => typeof value === 'number' && Number.isFinite(value))) continue;
            const inYears = value => Number((value / global.InvestmentCalculator.DAYS_PER_YEAR).toFixed(6));
            const defaultBounds = entry.min === 0 && entry.max === (key === 'depositOffset' ? 365 : 3650);
            result.controls[key] = {
              value: key === 'withdrawalOffset' && entry.value === 3650 && defaultBounds ? 10 : inYears(entry.value),
              min: defaultBounds ? 0 : inYears(entry.min),
              max: defaultBounds ? 50 : inYears(entry.max)
            };
          }
        }
        if (saved.version < 3) {
          for (const key of ['depositInterval', 'withdrawalInterval']) {
            const entry = result.controls[key];
            if (!entry || ![entry.value, entry.min, entry.max].every(value => typeof value === 'number' && Number.isFinite(value))) continue;
            const inMonths = value => Math.max(1, Math.min(120, Math.round(value * 12 / global.InvestmentCalculator.DAYS_PER_YEAR)));
            const defaultBounds = entry.min === 1 && entry.max === 365;
            let min = defaultBounds ? 1 : inMonths(entry.min);
            let max = defaultBounds ? 12 : inMonths(entry.max);
            if (min >= max) {
              if (min < 120) max = min + 1;
              else min = 119;
            }
            result.controls[key] = { value: inMonths(entry.value), min, max };
          }
        }
      }
      for (const key of ['deposit', 'withdrawal']) {
        if (typeof saved.schedules?.[key] === 'boolean') result.schedules[key] = saved.schedules[key];
      }
    } catch {
      // Malformed or inaccessible storage should not prevent calculation.
    }
    return result;
  }

  function save(state, controls, schedules) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, state, controls, schedules }));
    } catch {
      // Keep the calculator usable when storage is blocked or full.
    }
  }

  global.CompoundPreferences = Object.freeze({ load, save });
})(window);

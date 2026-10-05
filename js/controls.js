/* Reusable, labelled numeric inputs with editable slider bounds. */
(function (global) {
  'use strict';

  const DEFINITIONS = Object.freeze({
    initial: { label: 'Initial investment', value: 100000, min: 0, max: 1000000, step: 100, unit: 'currency', floor: 0, ceiling: 1e12 },
    annual: { label: 'Annual gain', value: 15, min: 5, max: 20, step: .1, unit: '%', floor: -99.9, ceiling: 10000 },
    goal: { label: 'Goal amount', value: 1000000, min: 0, max: 10000000, step: 100, unit: 'currency', floor: 1, ceiling: 1e15 },
    duration: { label: 'Duration', value: 20, min: 1, max: 50, step: 1, unit: 'years', floor: 1, ceiling: 1000 },
    deposit: { label: 'Amount', value: 0, min: 0, max: 50000, step: 1, unit: 'currency', floor: 0, ceiling: 1e12 },
    depositInterval: { label: 'Interval', value: 1, min: 1, max: 12, step: 1, unit: 'months', floor: 1, ceiling: 120 },
    depositOffset: { label: 'Start offset', value: 0, min: 0, max: 50, step: 1, unit: 'years', floor: 0, ceiling: 1000 },
    withdrawal: { label: 'Amount', value: 0, min: 0, max: 50000, step: 1, unit: 'currency', floor: 0, ceiling: 1e12 },
    withdrawalInterval: { label: 'Interval', value: 1, min: 1, max: 12, step: 1, unit: 'months', floor: 1, ceiling: 120 },
    withdrawalOffset: { label: 'Start offset', value: 10, min: 0, max: 50, step: 1, unit: 'years', floor: 0, ceiling: 1000 }
  });

  class NumericControls {
    constructor(form, onChange) {
      this.form = form;
      this.onChange = onChange;
      this.currency = 'SEK';
      this.state = {};
      this.elements = {};
      for (const [key, definition] of Object.entries(DEFINITIONS)) {
        this.state[key] = { value: definition.value, min: definition.min, max: definition.max };
        this.mount(key, definition);
      }
      form.addEventListener('submit', event => event.preventDefault());
    }

    mount(key, definition) {
      const container = this.form.querySelector(`[data-control="${key}"]`);
      const context = key.startsWith('withdrawal') ? 'Repeated withdrawal' : key.startsWith('deposit') ? 'Repeated deposit' : '';
      const accessibleLabel = `${context} ${definition.label}`.trim();
      const unit = this.unit(key);
      container.classList.add('control');
      container.innerHTML = `
        <div class="control-top"><label for="${key}-value">${definition.label}</label><div class="value-field"><input id="${key}-value" type="number" inputmode="decimal" step="${definition.step}" aria-label="${accessibleLabel}" aria-describedby="${key}-error ${key}-help"><span class="unit" data-unit="${definition.unit}">${unit}</span></div></div>
        <input id="${key}-slider" type="range" step="${definition.step}" aria-label="${accessibleLabel} slider">
        <div class="range-bounds"><label for="${key}-min">Min <input id="${key}-min" type="number" inputmode="decimal" step="${definition.step}" aria-label="${accessibleLabel} minimum" aria-describedby="${key}-error"></label><label for="${key}-max">Max <input id="${key}-max" type="number" inputmode="decimal" step="${definition.step}" aria-label="${accessibleLabel} maximum" aria-describedby="${key}-error"></label></div>
        <p id="${key}-help" class="control-help" hidden></p><p id="${key}-error" class="control-error" role="status" hidden></p>`;
      const elements = {
        container,
        value: container.querySelector(`#${key}-value`),
        slider: container.querySelector(`#${key}-slider`),
        min: container.querySelector(`#${key}-min`),
        max: container.querySelector(`#${key}-max`),
        error: container.querySelector('.control-error'),
        help: container.querySelector('.control-help')
      };
      this.elements[key] = elements;
      for (const field of ['value', 'min', 'max']) {
        elements[field].addEventListener('input', () => this.commit(key, field, false));
        elements[field].addEventListener('change', () => this.commit(key, field, true));
        elements[field].addEventListener('blur', () => this.commit(key, field, true));
      }
      elements.slider.addEventListener('input', () => {
        this.state[key].value = Number(elements.slider.value);
        this.clearError(key);
        this.sync(key);
        this.onChange();
      });
      this.sync(key);
    }

    clearError(key) {
      this.elements[key].error.hidden = true;
      for (const field of ['value', 'min', 'max']) this.elements[key][field].removeAttribute('aria-invalid');
    }

    commit(key, field, finalize) {
      const elements = this.elements[key];
      if (field === 'value' && elements.value.disabled) return;
      const definition = DEFINITIONS[key];
      const number = Number(elements[field].value);
      const state = this.state[key];
      const lowerBound = field === 'min' ? Math.min(definition.floor, definition.min) : definition.floor;
      let error = '';
      if (elements[field].value === '' || !Number.isFinite(number)) error = 'Enter a number.';
      else if (number < lowerBound || number > definition.ceiling) error = `Use a value from ${lowerBound.toLocaleString('en')} to ${definition.ceiling.toLocaleString('en')}.`;
      else if (definition.step === 1 && !Number.isInteger(number)) error = ['days', 'months', 'years'].includes(definition.unit) ? `Use a whole number of ${definition.unit}.` : 'Use a whole number.';
      else if (field === 'min' && number >= state.max) error = 'Min must be smaller than max.';
      else if (field === 'max' && number <= state.min) error = 'Max must be larger than min.';
      if (error) {
        if (finalize) {
          elements.error.textContent = `${error} Previous value restored.`;
          elements.error.hidden = false;
          elements[field].value = state[field];
          elements[field].removeAttribute('aria-invalid');
        } else elements[field].setAttribute('aria-invalid', 'true');
        return;
      }
      // A restored invalid edit emits both change and blur. Keep its message
      // visible until the next edit, and avoid recomputing unchanged settings.
      if (number === state[field]) {
        if (!finalize) this.clearError(key);
        return;
      }
      this.clearError(key);
      state[field] = number;
      if (field === 'value') {
        // Typed values extend the range rather than being silently truncated.
        state.min = Math.min(state.min, number);
        state.max = Math.max(state.max, number);
      } else if (!elements.value.disabled) state.value = Math.min(state.max, Math.max(state.min, state.value));
      this.sync(key, finalize ? null : field);
      this.onChange();
    }

    sync(key, activeField = null) {
      const state = this.state[key];
      const elements = this.elements[key];
      for (const field of ['value', 'min', 'max']) {
        if (field !== activeField) elements[field].value = state[field];
      }
      elements.slider.min = state.min;
      elements.slider.max = state.max;
      elements.slider.value = state.value;
      const percentage = Math.max(0, Math.min(100, (state.value - state.min) / (state.max - state.min) * 100));
      elements.slider.style.setProperty('--fill', `${percentage}%`);
      const unit = this.unit(key);
      elements.container.querySelector('.unit').textContent = unit;
      elements.slider.setAttribute('aria-valuetext', `${state.value} ${unit}`);
    }

    unit(key) {
      const unit = DEFINITIONS[key].unit;
      if (unit === 'currency') return this.currency;
      return this.state[key].value === 1 && ['days', 'months', 'years'].includes(unit) ? unit.slice(0, -1) : unit;
    }

    setCurrency(currency) {
      this.currency = currency;
      this.form.querySelectorAll('[data-unit="currency"]').forEach(unit => { unit.textContent = currency; });
      Object.keys(this.state).forEach(key => this.sync(key));
    }

    setGoalMode(enabled) {
      const annual = this.elements.annual;
      annual.value.disabled = enabled;
      annual.slider.disabled = enabled;
      annual.container.classList.toggle('is-disabled', enabled);
      annual.help.textContent = enabled ? 'Calculated from your goal. Min and max sets the dotted lines.' : '';
      annual.help.hidden = !enabled;
      document.getElementById('goal-control').hidden = !enabled;
      if (!enabled) {
        const state = this.state.annual;
        state.value = Math.min(state.max, Math.max(state.min, state.value));
        annual.value.placeholder = '';
      }
      this.clearError('annual');
    }

    setComputedRate(rate) {
      const elements = this.elements.annual;
      if (rate === null) {
        elements.value.value = '';
        elements.value.placeholder = 'Unavailable';
        elements.help.textContent = 'No annual return can reach this goal within the calculation limits.';
        return;
      }
      elements.value.placeholder = '';
      elements.value.value = Number(rate.toFixed(4));
      elements.slider.value = rate;
      const { min, max } = this.state.annual;
      elements.slider.style.setProperty('--fill', `${Math.max(0, Math.min(100, (rate - min) / (max - min) * 100))}%`);
      elements.help.textContent = rate < min || rate > max ? 'Required return is outside your slider range.' : 'Calculated from your goal. Min and max sets the dotted lines.';
    }

    settings() {
      const settings = Object.fromEntries(Object.entries(this.state).map(([key, value]) => [key, value.value]));
      // Controls and saved preferences use years. The engine and chart sample
      // daily data, so normalize the offsets once at this boundary.
      settings.depositOffsetYears = settings.depositOffset;
      settings.withdrawalOffsetYears = settings.withdrawalOffset;
      settings.depositOffset = global.InvestmentCalculator.offsetDays(settings.depositOffset);
      settings.withdrawalOffset = global.InvestmentCalculator.offsetDays(settings.withdrawalOffset);
      settings.intervalUnit = 'months';
      return settings;
    }

    restore(saved) {
      for (const [key, definition] of Object.entries(DEFINITIONS)) {
        const entry = saved[key];
        if (!entry || typeof entry !== 'object') continue;
        const values = [entry.value, entry.min, entry.max];
        if (!values.every((value, index) => typeof value === 'number' && Number.isFinite(value) && value >= (index === 1 ? Math.min(definition.floor, definition.min) : definition.floor) && value <= definition.ceiling)) continue;
        if (definition.step === 1 && !values.every(Number.isInteger)) continue;
        if (entry.min >= entry.max) continue;
        this.state[key] = { min: entry.min, max: entry.max, value: Math.max(entry.min, Math.min(entry.max, entry.value)) };
        this.sync(key);
      }
    }

    reset() {
      for (const [key, definition] of Object.entries(DEFINITIONS)) {
        this.state[key] = { value: definition.value, min: definition.min, max: definition.max };
        this.clearError(key);
        this.sync(key);
      }
    }
  }

  global.NumericControls = NumericControls;
})(window);

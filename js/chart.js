/* Responsive canvas chart with daily pointer and keyboard inspection. */
(function (global) {
  'use strict';

  const COLORS = Object.freeze({ grid: '#263144', text: '#a0adc1', blue: '#82aaff', teal: '#7ed9c4', purple: '#c1a3f5', principal: '#526c9b' });
  const curves = global.ProjectionCurves;

  class ProjectionChart {
    constructor(canvas, tooltip, formatters) {
      this.canvas = canvas;
      this.container = canvas.parentElement;
      this.context = canvas.getContext('2d');
      this.tooltip = tooltip;
      this.format = formatters;
      this.data = null;
      this.hoverDay = null;
      this.dragging = false;
      this.width = 0;
      this.height = 0;
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
      canvas.addEventListener('pointermove', event => {
        if (event.pointerType === 'mouse' || event.pointerType === 'pen' || this.dragging) this.inspectPointer(event);
      });
      canvas.addEventListener('pointerdown', event => {
        this.dragging = true;
        canvas.setPointerCapture(event.pointerId);
        this.inspectPointer(event);
      });
      canvas.addEventListener('pointerup', () => { this.dragging = false; });
      canvas.addEventListener('pointercancel', () => { this.dragging = false; this.hideTooltip(); });
      canvas.addEventListener('pointerleave', event => {
        // Touch emits pointerleave on release. Keep the last inspected date.
        if (!this.dragging && event.pointerType !== 'touch') this.hideTooltip();
      });
      canvas.addEventListener('keydown', event => this.inspectKeyboard(event));
      canvas.addEventListener('blur', () => this.hideTooltip());
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const rect = this.container.getBoundingClientRect();
      this.width = rect.width;
      this.height = rect.height;
      if (!this.width || !this.height) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
      this.canvas.width = Math.round(this.width * pixelRatio);
      this.canvas.height = Math.round(this.height * pixelRatio);
      this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      this.draw();
      if (this.hoverDay !== null) this.showTooltip();
    }

    update(data) {
      this.data = data;
      this.samples = curves.sampleDays(data.main.days, data.schedule, data.main.balances);
      this.range = this.axisRange();
      this.hoverDay = null;
      this.tooltip.hidden = true;
      this.draw();
    }

    geometry() {
      const left = this.width < 450 ? 56 : 72;
      return { left, right: this.width - 12, top: 24, bottom: this.height - 34, width: this.width - left - 12, height: this.height - 58 };
    }

    axisRange() {
      let minimum = Infinity;
      let maximum = -Infinity;
      for (const balance of this.data.main.balances) {
        minimum = Math.min(minimum, balance);
        maximum = Math.max(maximum, balance);
      }
      if (this.data.mode === 'goal') {
        maximum = this.data.goal;
        minimum = Math.min(minimum, maximum);
      }
      // A flat projection needs a finite span. Otherwise fit the main line
      // exactly, ignoring the optional minimum and maximum return scenarios.
      if (maximum - minimum < Math.max(1, Math.abs(maximum)) * Number.EPSILON * 16) {
        const padding = Math.max(1, Math.abs(maximum) * .01);
        if (this.data.mode === 'goal') minimum = Math.max(0, maximum - padding);
        else {
          minimum = Math.max(0, minimum - padding / 2);
          maximum = minimum + padding;
        }
      }
      return { minimum, maximum };
    }

    dateAt(day) {
      const date = new Date(this.data.today);
      date.setDate(date.getDate() + day);
      return date;
    }

    x(day, geometry) { return geometry.left + day / this.data.main.days * geometry.width; }
    y(value, geometry, range) { return Math.max(geometry.top - geometry.height * 2, Math.min(geometry.bottom + geometry.height * 2, geometry.bottom - (value - range.minimum) / (range.maximum - range.minimum) * geometry.height)); }

    path(values, geometry, range, main = false) {
      const ctx = this.context;
      const points = this.samples.map(day => ({
        x: this.x(day, geometry),
        y: this.y(values[day], geometry, range)
      }));
      const segments = curves.segments(points);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const segment of segments) {
        ctx.bezierCurveTo(segment.control1.x, segment.control1.y, segment.control2.x, segment.control2.y, segment.end.x, segment.end.y);
      }
      if (main) this.mainSegments = segments;
    }

    curveY(day, geometry) {
      const x = this.x(day, geometry);
      const segment = this.mainSegments.find(part => x <= part.end.x) || this.mainSegments[this.mainSegments.length - 1];
      return curves.valueAt(segment, (x - segment.start.x) / (segment.end.x - segment.start.x));
    }

    draw() {
      if (!this.data || !this.width || !this.height) return;
      const ctx = this.context;
      const geometry = this.geometry();
      const range = this.range;
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.font = '11px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'left';
      ctx.fillText(this.data.currency, 0, 11);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let tick = 0; tick <= 4; tick += 1) {
        const step = (range.maximum - range.minimum) / 4;
        const value = range.minimum + step * tick;
        const y = this.y(value, geometry, range);
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        ctx.setLineDash(tick === 0 ? [] : [2, 5]);
        ctx.beginPath(); ctx.moveTo(geometry.left, y); ctx.lineTo(geometry.right, y); ctx.stroke();
        ctx.fillStyle = COLORS.text;
        ctx.fillText(this.format.axisValue(value, step), geometry.left - 14, y);
      }
      ctx.setLineDash([]);
      const xTicks = this.width < 500 ? 3 : this.width < 800 ? 4 : 5;
      ctx.textBaseline = 'top';
      for (let tick = 0; tick <= xTicks; tick += 1) {
        const day = Math.round(this.data.main.days * tick / xTicks);
        ctx.textAlign = tick === 0 ? 'left' : tick === xTicks ? 'right' : 'center';
        ctx.fillText(this.format.axisDate(this.dateAt(day), this.data.main.days), this.x(day, geometry), geometry.bottom + 16);
      }

      ctx.save();
      ctx.beginPath(); ctx.rect(geometry.left, geometry.top - 1, geometry.width, geometry.height + 2); ctx.clip();

      if (this.data.type === 'area' || this.data.type === 'breakdown') {
        this.path(this.data.main.balances, geometry, range, true);
        ctx.lineTo(geometry.right, geometry.bottom); ctx.lineTo(geometry.left, geometry.bottom); ctx.closePath();
        const gradient = ctx.createLinearGradient(0, geometry.top, 0, geometry.bottom);
        gradient.addColorStop(0, this.data.type === 'area' ? '#82aaff55' : '#7ed9c477');
        gradient.addColorStop(1, this.data.type === 'area' ? '#82aaff03' : '#7ed9c41a');
        ctx.fillStyle = gradient; ctx.fill();
      }

      if (this.data.type === 'breakdown') {
        const { main } = this.data;
        const principal = new Float64Array(main.days + 1);
        let hasNegativeComponent = false;
        for (let day = 0; day <= main.days; day += 1) {
          const net = main.investedSeries[day] - main.withdrawnSeries[day];
          principal[day] = Math.max(0, Math.min(net, main.balances[day]));
          if (net < 0 || net > main.balances[day]) hasNegativeComponent = true;
        }
        // Keep independently smoothed stacked components within the balance.
        ctx.save();
        this.path(main.balances, geometry, range, true);
        ctx.lineTo(geometry.right, geometry.bottom); ctx.lineTo(geometry.left, geometry.bottom); ctx.closePath(); ctx.clip();
        this.path(principal, geometry, range);
        ctx.lineTo(geometry.right, geometry.bottom); ctx.lineTo(geometry.left, geometry.bottom); ctx.closePath();
        ctx.fillStyle = '#526c9b8c'; ctx.fill();
        ctx.restore();
        if (hasNegativeComponent) {
          const netSeries = main.investedSeries.map((amount, day) => amount - main.withdrawnSeries[day]);
          this.path(netSeries, geometry, range);
          ctx.strokeStyle = COLORS.principal; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
        }
      }

      if (this.data.showBounds) {
        for (const [series, color] of [[this.data.minimum, COLORS.purple], [this.data.maximum, COLORS.teal]]) {
          this.path(series.balances, geometry, range);
          ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.setLineDash([3, 6]); ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      if (this.data.mode === 'goal') {
        ctx.beginPath(); ctx.moveTo(geometry.left, geometry.top); ctx.lineTo(geometry.right, geometry.top);
        ctx.strokeStyle = '#82aaff70'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      }
      this.path(this.data.main.balances, geometry, range, true);
      ctx.strokeStyle = COLORS.blue; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.shadowColor = '#82aaff60'; ctx.shadowBlur = 9; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.restore();

      const y = this.y(this.data.main.balance, geometry, range);
      if (y >= geometry.top - 1 && y <= geometry.bottom) {
        ctx.fillStyle = '#82aaff18'; ctx.beginPath(); ctx.arc(geometry.right, y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = COLORS.blue; ctx.beginPath(); ctx.arc(geometry.right, y, 3, 0, Math.PI * 2); ctx.fill();
      }
      if (this.hoverDay !== null) this.drawCrosshair(geometry);
    }

    drawCrosshair(geometry) {
      const ctx = this.context;
      const x = this.x(this.hoverDay, geometry);
      const y = this.curveY(this.hoverDay, geometry);
      ctx.beginPath(); ctx.moveTo(x, geometry.top); ctx.lineTo(x, geometry.bottom);
      ctx.strokeStyle = '#9daecb80'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
      if (y >= geometry.top && y <= geometry.bottom) {
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = COLORS.blue; ctx.fill();
        ctx.strokeStyle = '#101620'; ctx.lineWidth = 2; ctx.stroke();
      }
    }

    inspectPointer(event) {
      if (!this.data) return;
      const geometry = this.geometry();
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.min(geometry.right, Math.max(geometry.left, event.clientX - rect.left));
      this.hoverDay = Math.round((x - geometry.left) / geometry.width * this.data.main.days);
      this.showTooltip(); this.draw();
    }

    inspectKeyboard(event) {
      if (!this.data) return;
      if (event.key === 'Escape') { this.hideTooltip(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 30 : 1;
      let day = this.hoverDay ?? 0;
      if (event.key === 'ArrowLeft') day -= step;
      if (event.key === 'ArrowRight') day += step;
      if (event.key === 'Home') day = 0;
      if (event.key === 'End') day = this.data.main.days;
      this.hoverDay = Math.max(0, Math.min(this.data.main.days, day));
      this.showTooltip(); this.draw();
      document.getElementById('chart-summary').textContent = this.tooltip.innerText.replace(/\n/g, '. ');
    }

    showTooltip() {
      if (this.hoverDay === null || !this.data) return;
      const day = this.hoverDay;
      const { main, currency } = this.data;
      const invested = main.investedSeries[day];
      const withdrawn = main.withdrawnSeries[day];
      const balance = main.balances[day];
      const money = value => this.format.money(value, currency);
      this.tooltip.innerHTML = `<div class="tooltip-date">${this.format.date(this.dateAt(day))}</div><div class="tooltip-row"><span>Balance</span><strong>${money(balance)}</strong></div><div class="tooltip-row"><span>Total invested</span><strong>${money(invested)}</strong></div><div class="tooltip-row"><span>Investment gain</span><strong>${money(balance + withdrawn - invested)}</strong></div><div class="tooltip-row"><span>Withdrawn</span><strong>${money(withdrawn)}</strong></div><div class="tooltip-rate">${this.format.percent(main.rate)} annual return</div>`;
      if (this.data.showBounds) {
        const rows = document.createElement('div');
        rows.innerHTML = `<div class="tooltip-row"><span>${this.format.percent(this.data.minimum.rate)} return</span><strong>${money(this.data.minimum.balances[day])}</strong></div><div class="tooltip-row"><span>${this.format.percent(this.data.maximum.rate)} return</span><strong>${money(this.data.maximum.balances[day])}</strong></div>`;
        this.tooltip.append(rows);
      }
      this.tooltip.hidden = false;
      const geometry = this.geometry();
      const x = this.x(day, geometry);
      const tooltipWidth = this.tooltip.offsetWidth;
      let left = x + 16;
      if (left + tooltipWidth > this.width - 4) left = x - tooltipWidth - 16;
      this.tooltip.style.left = `${Math.max(4, left)}px`;
      const y = this.curveY(day, geometry);
      this.tooltip.style.top = `${Math.max(4, Math.min(this.height - this.tooltip.offsetHeight - 4, y - 50))}px`;
    }

    hideTooltip() { this.hoverDay = null; this.tooltip.hidden = true; this.draw(); }
  }

  global.ProjectionChart = ProjectionChart;
})(window);

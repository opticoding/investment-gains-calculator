/* Shape-preserving cubic curves for the visual projection, not calculations. */
(function (global) {
  'use strict';

  function sampleDays(days, schedule, balances) {
    const intervals = [];
    const paymentDays = new Set();
    const starts = new Map();
    if (schedule.deposit > 0 && schedule.depositOffset <= days) intervals.push(schedule.depositIntervalDays ?? schedule.depositInterval);
    if (schedule.withdrawal > 0 && schedule.withdrawalOffset <= days) intervals.push(schedule.withdrawalIntervalDays ?? schedule.withdrawalInterval);
    for (const kind of ['deposit', 'withdrawal']) {
      if (schedule[kind] > 0) {
        const dates = schedule[`${kind}Days`] || [];
        for (const day of dates) paymentDays.add(day);
        if (dates[0] > 0) {
          const interval = schedule[`${kind}IntervalDays`] ?? schedule[`${kind}Interval`];
          starts.set(dates[0], Math.max(starts.get(dates[0]) || 0, interval));
        }
      }
    }
    const interval = intervals.length ? Math.min(...intervals) : 1;
    const stride = interval * Math.max(1, Math.ceil(days / (64 * interval)));
    const calendar = [...paymentDays].sort((a, b) => a - b);
    const samples = new Set([0, days, ...starts.keys()]);
    let paymentIndex = 0;
    for (let day = 0; day < days; day += stride) {
      let sample = day;
      if (calendar.length && day >= calendar[0] && day <= calendar[calendar.length - 1]) {
        // Calendar months vary in length. Sample after actual payments rather
        // than drifting between before- and after-payment balances.
        while (calendar[paymentIndex] < day) paymentIndex += 1;
        sample = calendar[paymentIndex];
      }
      if (sample < days) samples.add(sample);
    }
    // Give the first after-payment point the same space as later payments.
    // A nearby before-payment point otherwise exaggerates the first withdrawal
    // into a spike. This only smooths the drawing; daily values remain intact.
    const result = [...samples].filter(day => day === 0 || day === days || starts.has(day) ||
      ((!calendar.length || days - day >= stride) &&
      ![...starts].some(([start, interval]) => day < start && start - day < Math.max(stride, interval))))
      .sort((a, b) => a - b);

    // A partial final payment cycle can bend the tail against the established
    // trend. Widen that transition using earlier anchors, keeping the exact end
    // value. Limit this to the last four sampling intervals and preserve starts.
    if (balances && calendar.length && !paymentDays.has(days)) {
      const slope = (from, to) => (balances[to] - balances[from]) / (to - from);
      while (result.length >= 4) {
        const [previous, before, last, end] = result.slice(-4);
        if (before < days - stride * 4 || starts.has(last)) break;
        const earlierSlope = slope(previous, before);
        const recentSlope = slope(before, last);
        const endSlope = slope(last, end);
        const reversesDirection = recentSlope * endSlope <= 0;
        const reversesCurvature = (recentSlope - earlierSlope) * (endSlope - recentSlope) < 0;
        if (earlierSlope * recentSlope <= 0 || (!reversesDirection && !reversesCurvature)) break;
        result.splice(-2, 1);
      }
    }
    return result;
  }

  function segments(points) {
    if (points.length < 2) return [];
    const slopes = points.slice(1).map((point, index) => (point.y - points[index].y) / (point.x - points[index].x));
    const tangents = points.map((point, index) => {
      if (index === 0) return slopes[0];
      if (index === points.length - 1) return slopes[index - 1];
      return slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2;
    });
    // Fritsch-Carlson limiting prevents curves from overshooting their values.
    slopes.forEach((slope, index) => {
      if (slope === 0) {
        tangents[index] = 0;
        tangents[index + 1] = 0;
      } else {
        const magnitude = Math.hypot(tangents[index] / slope, tangents[index + 1] / slope);
        if (magnitude > 3) {
          const scale = 3 / magnitude;
          tangents[index] *= scale;
          tangents[index + 1] *= scale;
        }
      }
    });
    return points.slice(1).map((end, index) => {
      const start = points[index];
      const third = (end.x - start.x) / 3;
      return {
        start, end,
        control1: { x: start.x + third, y: start.y + tangents[index] * third },
        control2: { x: end.x - third, y: end.y - tangents[index + 1] * third }
      };
    });
  }

  function valueAt(segment, fraction) {
    const t = Math.max(0, Math.min(1, fraction));
    const rest = 1 - t;
    return rest ** 3 * segment.start.y + 3 * rest ** 2 * t * segment.control1.y + 3 * rest * t ** 2 * segment.control2.y + t ** 3 * segment.end.y;
  }

  global.ProjectionCurves = Object.freeze({ sampleDays, segments, valueAt });
})(window);

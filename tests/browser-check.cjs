/* Run with Node and Playwright installed, or set PLAYWRIGHT_MODULE to its path.
 * Set BROWSER_CHANNEL=msedge to use an installed Microsoft Edge browser.
 * Opens index.html directly. Screenshots go to .artifacts/ (gitignored).
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let activeBrowser;

async function run() {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  activeBrowser = browser;
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const artifactDirectory = path.join(__dirname, '../.artifacts');
  fs.mkdirSync(artifactDirectory, { recursive: true });
  await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
  await page.waitForFunction(() => window.Compound?.getProjection());
  await page.screenshot({ path: path.join(artifactDirectory, 'desktop.png'), fullPage: true });

  const baseline = await page.evaluate(() => window.Compound.getProjection().balance);
  const defaultAnnual = await page.locator('#annual-value').inputValue();
  const defaultAnnualMin = await page.locator('#annual-min').inputValue();
  const defaultAnnualMax = await page.locator('#annual-max').inputValue();
  const defaultGoal = Number(await page.locator('#goal-value').inputValue());
  assert.equal(await page.locator('#deposit-value').inputValue(), '0');
  assert.equal(await page.locator('[data-chart="line"]').count(), 0);
  assert.equal(await page.locator('[data-chart="area"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.schedule-details[open]').count(), 0);
  assert.equal(await page.locator('.projection-footer, #date-range').count(), 0);
  assert.equal(await page.locator('#deposit-heading').innerText(), 'Repeated deposits');
  assert.equal(await page.locator('#depositOffset-value').inputValue(), '0');
  assert.equal(await page.locator('#withdrawalOffset-value').inputValue(), '10');
  for (const key of ['depositOffset', 'withdrawalOffset']) {
    assert.equal(await page.locator(`#${key}-min`).inputValue(), '0');
    assert.equal(await page.locator(`#${key}-max`).inputValue(), '50');
    assert.equal(await page.locator(`[data-control="${key}"] .unit`).textContent(), 'years');
  }
  for (const key of ['depositInterval', 'withdrawalInterval']) {
    assert.equal(await page.locator(`#${key}-value`).inputValue(), '1');
    assert.equal(await page.locator(`#${key}-min`).inputValue(), '1');
    assert.equal(await page.locator(`#${key}-max`).inputValue(), '12');
    assert.equal(await page.locator(`#${key}-slider`).getAttribute('step'), '1');
    assert.equal(await page.locator(`[data-control="${key}"] .unit`).textContent(), 'month');
  }
  assert.ok(baseline > 100000);
  await page.locator('#initial-value').fill('200000');
  await page.locator('#initial-value').blur();
  await page.waitForFunction(previous => window.Compound.getProjection().balance > previous, baseline);
  assert.equal(await page.locator('#initial-slider').inputValue(), '200000');
  await page.locator('#initial-slider').evaluate(element => { element.value = '150000'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.locator('#initial-value').inputValue(), '150000');

  await page.locator('#initial-max').fill('2000000');
  await page.locator('#initial-max').blur();
  assert.equal(await page.locator('#initial-slider').getAttribute('max'), '2000000');
  await page.locator('#initial-value').fill('2500000');
  await page.locator('#initial-value').blur();
  assert.equal(await page.locator('#initial-max').inputValue(), '2500000');
  await page.locator('.schedule-details summary').first().click();
  await page.locator('#depositInterval-value').fill('0');
  await page.locator('#depositInterval-value').blur();
  assert.equal(await page.locator('#depositInterval-value').inputValue(), '1');
  assert.equal(await page.locator('#depositInterval-error').isVisible(), true);
  await page.locator('#depositInterval-value').fill('120');
  await page.locator('#depositInterval-value').blur();
  assert.equal(await page.locator('#depositInterval-max').inputValue(), '120');
  await page.locator('#depositInterval-value').fill('121');
  await page.locator('#depositInterval-value').blur();
  assert.equal(await page.locator('#depositInterval-value').inputValue(), '120');
  await page.locator('#depositInterval-value').fill('1.5');
  await page.locator('#depositInterval-value').blur();
  assert.equal(await page.locator('#depositInterval-value').inputValue(), '120');

  // Units follow the current value after typing, moving sliders, and restoring.
  for (const [key, singular, plural] of [
    ['depositInterval', 'month', 'months'], ['withdrawalInterval', 'month', 'months'],
    ['depositOffset', 'year', 'years'], ['withdrawalOffset', 'year', 'years'],
    ['duration', 'year', 'years']
  ]) {
    const slider = page.locator(`#${key}-slider`);
    for (const [value, unit] of [[1, singular], [2, plural]]) {
      await slider.evaluate((element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
      assert.equal(await page.locator(`[data-control="${key}"] .unit`).textContent(), unit);
      assert.equal(await slider.getAttribute('aria-valuetext'), `${value} ${unit}`);
    }
  }
  await page.locator('#depositInterval-value').fill('1');
  await page.locator('#depositInterval-value').blur();
  assert.equal(await page.locator('[data-control="depositInterval"] .unit').textContent(), 'month');

  await page.locator('[data-currency="EUR"]').click();
  await page.waitForFunction(() => document.getElementById('balance-currency').textContent === 'EUR');
  assert.equal(await page.locator('#balance-currency').innerText(), 'EUR');
  assert.equal(await page.locator('[data-unit="currency"]').first().innerText(), 'EUR');
  await page.locator('#reset-button').click();
  await page.waitForFunction(previous => Math.abs(window.Compound.getProjection().balance - previous) < .01, baseline);

  await page.locator('[data-mode="goal"]').click();
  assert.equal(await page.locator('#annual-value').isDisabled(), true);
  assert.equal(await page.locator('#annual-slider').isDisabled(), true);
  assert.equal(await page.locator('#goal-control').isVisible(), true);
  await page.waitForFunction(goal => Math.abs(window.Compound.getProjection().balance - goal) < .01, defaultGoal);
  assert.ok(Number(await page.locator('#annual-value').inputValue()) > 0);
  await page.locator('#goal-value').fill('3000000');
  await page.locator('#goal-value').blur();
  await page.waitForFunction(() => Math.abs(window.Compound.getProjection().balance - 3000000) < .01);

  await page.locator('#bounds-toggle').check();
  await page.locator('#min-legend').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#min-legend').isVisible(), true);
  for (const type of ['area', 'breakdown']) {
    await page.locator(`[data-chart="${type}"]`).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator(`[data-chart="${type}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('#projection-chart').focus();
  await page.keyboard.press('End');
  assert.equal(await page.locator('#chart-tooltip').isVisible(), true);
  assert.match(await page.locator('#chart-tooltip').innerText(), /3,000,000 EUR|3,000,000 SEK/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#chart-tooltip').isVisible(), false);

  // Range edits in goal mode must not overwrite the computed rate. Returning
  // to gain mode restores an editable rate inside the updated slider range.
  const computedRate = Number(await page.locator('#annual-value').inputValue());
  await page.locator('#annual-max').fill('40');
  await page.locator('#annual-max').blur();
  await page.locator('#annual-min').fill('20');
  await page.locator('#annual-min').blur();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(Number(await page.locator('#annual-value').inputValue()), computedRate);
  await page.locator('[data-mode="gain"]').click();
  assert.equal(await page.locator('#annual-value').inputValue(), '20');
  assert.equal(await page.locator('#annual-slider').inputValue(), '20');
  await page.waitForFunction(() => window.Compound.getProjection().rate === 20);
  await page.locator('#reset-button').click();
  await page.waitForFunction(previous => Math.abs(window.Compound.getProjection().balance - previous) < .01, baseline);

  await page.locator('#expand-button').click();
  assert.equal(await page.locator('#expand-button').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#controls-panel').evaluate(element => element.inert), true);
  assert.equal(await page.locator('#controls-panel').isVisible(), false);
  assert.equal(await page.locator('.app-header').evaluate(element => element.inert), true);
  for (const [width, height] of [[1440, 960], [2560, 1440], [900, 500]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const workspace = await page.locator('#workspace').boundingBox();
    assert.deepEqual(workspace, { x: 0, y: 0, width, height });
    const canvas = await page.locator('#projection-chart').boundingBox();
    assert.ok(canvas.width >= width - 40, `Expanded chart uses the width at ${width}`);
    assert.ok(canvas.height >= height * .75, `Expanded chart uses the height at ${height}`);
    assert.ok(canvas.y + canvas.height <= height);
    assert.equal(await page.locator('.metrics').isVisible(), false);
    const toolbar = await page.locator('.switch-label').boundingBox();
    const exit = await page.locator('#expand-button').boundingBox();
    assert.ok(toolbar.x + toolbar.width <= exit.x, 'Return range and exit button do not overlap');
    await page.screenshot({ path: path.join(artifactDirectory, `expanded-${width}.png`), fullPage: true });
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#expand-button').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#controls-panel').isVisible(), true);
  assert.equal(await page.locator('.app-header').evaluate(element => element.inert), false);
  assert.equal(await page.locator('.metrics').isVisible(), true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('#expand-button').click();
  await page.setViewportSize({ width: 768, height: 1024 });
  assert.equal(await page.locator('#expand-button').isVisible(), false);
  assert.equal(await page.locator('#controls-panel').evaluate(element => element.inert), false);
  assert.equal(await page.locator('#controls-panel').isVisible(), true);
  assert.equal(await page.locator('.app-header').evaluate(element => element.inert), false);
  assert.equal(await page.locator('body').evaluate(element => element.classList.contains('chart-expanded')), false);

  for (const [width, height] of [[375, 900], [540, 900], [768, 900], [812, 375], [1024, 900], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(80);
    const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert.ok(layout.scroll <= layout.width, `No overflow at ${width}: ${layout.scroll}`);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('#reset-button').click();
  await page.screenshot({ path: path.join(artifactDirectory, 'mobile.png'), fullPage: true });
  await page.locator('#about-button').click();
  assert.equal(await page.locator('#about-dialog').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#about-dialog').isVisible(), false);

  await page.locator('[data-mode="goal"]').click();
  await page.locator('#initial-value').fill('0');
  await page.locator('#initial-value').blur();
  await page.locator('#deposit-value').fill('0');
  await page.locator('#deposit-value').blur();
  await page.waitForFunction(() => document.getElementById('annual-return').textContent === 'Unavailable');
  assert.match(await page.locator('#projection-message').innerText(), /needs an investment/);
  await page.locator('#reset-button').click();
  await page.waitForFunction(previous => Math.abs(window.Compound.getProjection().balance - previous) < .01, baseline);
  assert.equal(await page.locator('#annual-value').isDisabled(), false);
  assert.equal(await page.locator('#balance-currency').innerText(), 'SEK');
  assert.equal(await page.locator('#bounds-toggle').isChecked(), true);
  console.log('Desktop controls, goals, chart types, keyboard, and responsive layouts passed.');

  // Verify touch inspection in a real touch-enabled browser context.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const touchPage = await mobile.newPage();
  touchPage.on('pageerror', error => errors.push(error.message));
  await touchPage.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
  console.log('Touch page loaded.');
  await touchPage.locator('#projection-chart').scrollIntoViewIfNeeded();
  await touchPage.locator('#projection-chart').tap({ position: { x: 150, y: 120 } });
  assert.equal(await touchPage.locator('#chart-tooltip').isVisible(), true);
  console.log('Touch tap inspection passed.');
  const touchSession = await mobile.newCDPSession(touchPage);
  const chartBox = await touchPage.locator('#projection-chart').boundingBox();
  const touchY = chartBox.y + 120;
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: chartBox.x + 90, y: touchY }] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: chartBox.x + 220, y: touchY }] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await touchPage.locator('#chart-tooltip').isVisible(), true);
  console.log('Touch drag inspection passed.');

  const normalMotion = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' });
  normalMotion.on('pageerror', error => errors.push(error.message));
  await normalMotion.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
  await normalMotion.locator('[data-chart="area"]').click();
  await normalMotion.locator('#initial-value').fill('250000');
  await normalMotion.locator('#initial-value').blur();
  await normalMotion.waitForFunction(() => window.Compound.getProjection().invested === 250000);
  await normalMotion.screenshot({ path: path.join(artifactDirectory, 'area.png'), fullPage: true });
  console.log('Immediate chart updates passed with normal motion settings.');

  // Reproduce the stepped deposit example, now with smooth curves.
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('#deposit-value').fill('2500');
  await page.locator('#deposit-value').blur();
  await page.locator('#annual-value').fill('1');
  await page.locator('#annual-value').blur();
  await page.locator('[data-chart="breakdown"]').click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(artifactDirectory, 'smooth-breakdown.png'), fullPage: true });

  // Persist every choice, including range bounds and the expanded chart.
  await page.locator('#initial-value').fill('190000');
  await page.locator('#initial-value').blur();
  await page.locator('#initial-min').fill('50');
  await page.locator('#initial-max').fill('2000000');
  await page.locator('#initial-max').blur();
  await page.locator('#annual-min').fill('0.5');
  await page.locator('#annual-max').fill('40');
  await page.locator('#annual-max').blur();
  await page.locator('#annual-value').fill('5.5');
  await page.locator('#annual-value').blur();
  await page.locator('#duration-max').fill('60');
  await page.locator('#duration-value').fill('25');
  await page.locator('#duration-value').blur();
  await page.locator('.schedule-details summary').first().click();
  await page.locator('#depositInterval-value').fill('2');
  await page.locator('#depositInterval-value').blur();
  await page.locator('#depositOffset-value').fill('1');
  await page.locator('#depositOffset-value').blur();
  await page.locator('#withdrawal-value').fill('100');
  await page.locator('#withdrawal-value').blur();
  await page.locator('.withdrawal-section summary').click();
  await page.locator('#withdrawalInterval-value').fill('3');
  await page.locator('#withdrawalInterval-value').blur();
  await page.locator('#withdrawalOffset-value').fill('11');
  await page.locator('#withdrawalOffset-value').blur();
  await page.locator('[data-mode="goal"]').click();
  await page.locator('#goal-max').fill('20000000');
  await page.locator('#goal-value').fill('5000000');
  await page.locator('#goal-value').blur();
  await page.locator('[data-currency="USD"]').click();
  await page.locator('#bounds-toggle').check();
  await page.waitForFunction(() => Math.abs(window.Compound.getProjection().balance - 5000000) < .01);
  await page.locator('#expand-button').click();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('compound.preferences.v1')));
  assert.equal(persisted.state.mode, 'goal');
  assert.equal(persisted.state.currency, 'USD');
  assert.equal(persisted.state.chart, 'breakdown');
  assert.equal(persisted.state.showBounds, true);
  assert.equal(persisted.state.expanded, true);
  assert.deepEqual(persisted.schedules, { deposit: true, withdrawal: true });
  await page.reload();
  await page.waitForFunction(() => Math.abs(window.Compound?.getProjection()?.balance - 5000000) < .01);
  assert.equal(await page.locator('[data-mode="goal"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-currency="USD"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-chart="breakdown"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#bounds-toggle').isChecked(), true);
  assert.equal(await page.locator('#annual-value').isDisabled(), true);
  assert.equal(await page.locator('#expand-button').getAttribute('aria-expanded'), 'true');
  for (const [key, values] of Object.entries(persisted.controls)) {
    for (const field of ['value', 'min', 'max']) {
      if (key === 'annual' && field === 'value') continue;
      assert.equal(Number(await page.locator(`#${key}-${field}`).inputValue()), values[field], `Restored ${key} ${field}`);
    }
  }
  assert.equal(await page.locator('.schedule-details[open]').count(), 2);
  assert.equal(await page.locator('[data-control="depositOffset"] .unit').textContent(), 'year');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await page.waitForFunction(() => window.Compound?.getProjection());
  assert.equal(await page.locator('#controls-panel').evaluate(element => element.inert), false);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForFunction(() => document.getElementById('controls-panel').inert);
  await page.locator('#expand-button').click();
  await page.locator('#reset-button').click();
  await page.reload();
  await page.waitForFunction(() => window.Compound?.getProjection());
  assert.equal(await page.locator('#deposit-value').inputValue(), '0');
  assert.equal(await page.locator('.schedule-details[open]').count(), 0);
  assert.equal(await page.locator('#initial-value').inputValue(), '100000');
  assert.equal(await page.locator('#annual-value').inputValue(), defaultAnnual);
  assert.equal(await page.locator('#annual-max').inputValue(), defaultAnnualMax);
  assert.equal(await page.locator('#depositOffset-value').inputValue(), '0');
  assert.equal(await page.locator('#withdrawalOffset-value').inputValue(), '10');
  assert.equal(await page.locator('#balance-currency').innerText(), 'SEK');
  assert.equal(await page.locator('#expand-button').getAttribute('aria-expanded'), 'false');

  await page.evaluate(() => localStorage.setItem('compound.preferences.v1', '{broken json'));
  await page.reload();
  await page.waitForFunction(() => window.Compound?.getProjection());
  assert.equal(await page.locator('#initial-value').inputValue(), '100000');
  console.log('All settings survive refresh; reset and malformed storage recovery passed.');

  // The low-return tooltip must stay at zero on adjacent days after depletion.
  await page.locator('#deposit-value').fill('3600');
  await page.locator('#deposit-value').blur();
  await page.locator('#withdrawal-value').fill('22000');
  await page.locator('#withdrawal-value').blur();
  await page.waitForFunction(() => window.Compound.getProjection().unpaid === 0 && window.Compound.getProjection().withdrawn > 2000000);
  await page.locator('#projection-chart').focus();
  await page.keyboard.press('End');
  const lowerTooltip = page.locator('#chart-tooltip .tooltip-row').filter({ has: page.getByText(`${defaultAnnualMin}% return`, { exact: true }) }).locator('strong');
  for (let day = 0; day < 45; day += 1) {
    assert.equal(await lowerTooltip.innerText(), '0 SEK');
    await page.keyboard.press('ArrowLeft');
  }
  console.log('Depleted comparison tooltip stays at zero; singular and plural units passed.');

  // Reproduce the reported withdrawal curve in every chart style.
  await page.setViewportSize({ width: 1924, height: 1147 });
  await page.locator('#deposit-value').fill('0');
  await page.locator('#deposit-value').blur();
  await page.locator('#withdrawal-value').fill('5631');
  await page.locator('#withdrawal-value').blur();
  const expectedWithdrawalBalance = await page.evaluate(() => window.InvestmentCalculator.simulate({
    initial: 100000, deposit: 0, depositInterval: 1, depositOffsetYears: 0,
    withdrawal: 5631, withdrawalInterval: 1, withdrawalOffsetYears: 10,
    duration: 20, intervalUnit: 'months', today: new Date()
  }, 15).balance);
  await page.waitForFunction(expected => Math.abs(window.Compound.getProjection().balance - expected) < .001, expectedWithdrawalBalance);
  for (const type of ['area', 'breakdown']) {
    await page.locator(`[data-chart="${type}"]`).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(artifactDirectory, `withdrawal-${type}.png`), fullPage: true });
  }
  console.log('Reported withdrawal values verified in area and breakdown charts.');

  // Check the start transition and tooltip movement with odd month intervals.
  for (const [key, value] of [['initial', '194500'], ['annual', '13.8'], ['duration', '15'], ['withdrawal', '34642']]) {
    await page.locator(`#${key}-value`).fill(value);
    await page.locator(`#${key}-value`).blur();
  }
  await page.locator('.withdrawal-section summary').click();
  await page.locator('[data-chart="area"]').click();
  for (const interval of [3, 5, 7]) {
    await page.locator('#withdrawalInterval-value').fill(String(interval));
    await page.locator('#withdrawalInterval-value').blur();
    const expected = await page.evaluate(interval => {
      const settings = window.InvestmentCalculator.prepareSettings({
        initial: 194500, deposit: 0, depositInterval: 1, depositOffsetYears: 0,
        withdrawal: 34642, withdrawalInterval: interval, withdrawalOffsetYears: 10,
        duration: 15, intervalUnit: 'months', today: new Date()
      });
      const projection = window.InvestmentCalculator.simulate(settings, 13.8);
      return { balance: projection.balance, payment: settings.withdrawalDays[3], days: projection.days };
    }, interval);
    await page.waitForFunction(expected => Math.abs(window.Compound.getProjection().balance - expected) < .001, expected.balance);
    await page.screenshot({ path: path.join(artifactDirectory, `withdrawal-start-${interval}.png`), fullPage: true });
    const box = await page.locator('#projection-chart').boundingBox();
    let previousTop;
    for (let offset = -12; offset <= 12; offset += 1) {
      const x = box.x + 72 + (expected.payment + offset) / expected.days * (box.width - 84);
      await page.mouse.move(x, box.y + box.height / 2);
      const top = await page.locator('#chart-tooltip').evaluate(element => parseFloat(element.style.top));
      if (previousTop !== undefined) assert.ok(Math.abs(top - previousTop) < 3, `Tooltip jumps at a ${interval}-month withdrawal`);
      previousTop = top;
    }
  }
  console.log('Odd month intervals and smooth tooltip movement across withdrawals passed.');

  for (const [key, value] of [['initial', '200000'], ['annual', '10'], ['deposit', '1000'], ['withdrawal', '7096'], ['withdrawalInterval', '1']]) {
    await page.locator(`#${key}-value`).fill(value);
    await page.locator(`#${key}-value`).blur();
  }
  for (const duration of [29, 30]) {
    await page.locator('#duration-value').fill(String(duration));
    await page.locator('#duration-value').blur();
    const expectedBalance = await page.evaluate(duration => window.InvestmentCalculator.simulate({
      initial: 200000, deposit: 1000, depositInterval: 1, depositOffsetYears: 0,
      withdrawal: 7096, withdrawalInterval: 1, withdrawalOffsetYears: 10,
      duration, intervalUnit: 'months', today: new Date()
    }, 10).balance, duration);
    await page.waitForFunction(expected => Math.abs(window.Compound.getProjection().balance - expected) < .001, expectedBalance);
    for (const type of ['area', 'breakdown']) {
      await page.locator(`[data-chart="${type}"]`).click();
      await page.screenshot({ path: path.join(artifactDirectory, `end-${duration}-${type}.png`), fullPage: true });
      await page.locator('#projection-chart').focus();
      await page.keyboard.press('End');
      const displayedBalance = await page.locator('#chart-tooltip .tooltip-row').first().locator('strong').innerText();
      assert.equal(displayedBalance, `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(expectedBalance)} SEK`);
      await page.keyboard.press('Escape');
    }
  }
  console.log('29- and 30-year chart endpoints and exact final tooltip amounts passed.');

  assert.deepEqual(errors, []);
  await mobile.close();
  console.log('No runtime errors. Closing browser.');
  await browser.close();
  console.log('Browser checks passed: direct file loading, controls, goal solving, chart types, keyboard, touch, layout, reset, and no runtime errors.');
}

run().catch(async error => { console.error(error); if (activeBrowser) await activeBrowser.close(); process.exitCode = 1; });

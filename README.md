# Compound

A responsive investment gains calculator with interactive charts. Gain or goal based.

- Project growth from an annual return %, or calculate the return % needed to reach a goal.
- Set initial investments, recurring deposits, and withdrawals with custom schedules.
- Adjust each input with a slider and editable minimum and maximum values.
- Choose area or contribution breakdown charts, with optional return range lines.
- Use SEK, EUR, or USD labels. Currency selection does not convert amounts.
- Settings, slider ranges, chart choices, and open schedules are remembered in your browser.

## Run locally

Open `index.html` in a modern browser. No installation, server, or internet connection is required.

## Calculation

Annual return is an effective rate, compounded daily using 365.2425 days per year. Start offsets use calendar years from today. Payment intervals are in calendar months. Payments keep the same day of the month when possible, or use the last day of shorter months. Deposits are applied before withdrawals, which are capped at the available balance. Gain includes money already withdrawn.

Projections assume constant returns and exclude taxes, fees, and inflation.

## Tests

```bash
npm install
npx playwright install chromium
npm test
npm run test:browser
```

Unit tests run with Node’s built-in test runner. Browser checks in `tests/browser-check.cjs` use Playwright and open `index.html` as a local file. On Windows you can use an installed Edge build with `set BROWSER_CHANNEL=msedge` before `npm run test:browser`.

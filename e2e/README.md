# E2E Regression Tests (Playwright)

End-to-end regression suite for **Eval System V2** covering backend API health
and the React SPA's key navigation flows.

## Layout

```
e2e/
├── fixtures/app.js        Custom Playwright fixtures (app helpers, console error tracker, backend probe, capture())
├── api/health.spec.js     Backend contract: /api/health, /api/system/health, core list endpoints, OpenAPI
├── smoke.spec.js          SPA boot + error-boundary checks
├── navigation.spec.js     Sidebar navigation across all 8 pages
├── pages/                 Per-page regression specs (dashboard, jobs, boards, history, …)
└── ux/                    Interaction specs that click/type and capture multiple screenshots per test
```

## Prerequisites

```bash
# Install deps + Chromium (first time only)
npm install
npm run test:e2e:install
```

## Running

Start the backend separately (API tests skip automatically if it's not up):

```bash
# In one terminal
cd backend && uvicorn main:app --reload
# …or the full stack with Docker
docker compose up -d
```

Then run the suite — Playwright will launch the Vite dev server on port 5173
automatically:

```bash
npm run test:e2e              # headless run (all specs)
npm run test:e2e:ui           # interactive mode
npm run test:e2e:headed       # visible browser
npm run test:e2e:report       # open last HTML report
```

Run a subset:

```bash
npx playwright test e2e/smoke.spec.js
npx playwright test -g "Jobs Manager"
```

## Environment variables

| Var                   | Default                 | Purpose                                              |
| --------------------- | ----------------------- | ---------------------------------------------------- |
| `BASE_URL`            | `http://localhost:5173` | Frontend under test                                  |
| `BACKEND_URL`         | `http://localhost:8000` | Backend origin for API specs                         |
| `PW_REUSE_DEV`        | _(unset)_               | Set to `1` to skip auto-launching `npm run dev`      |
| `CI`                  | _(unset)_               | Enables retries, GitHub reporter, and 2 workers      |
| `E2E_SCREENSHOTS`     | `1`                     | Set to `0` to disable the auto per-test screenshots  |
| `E2E_SCREENSHOT_DIR`  | `./e2e/screenshots/`    | Folder where per-test PNGs are written               |

Example — hit the Dockerized full-stack at `http://localhost:8001`:

```bash
PW_REUSE_DEV=1 BASE_URL=http://localhost:8001 BACKEND_URL=http://localhost:8001 \
  npm run test:e2e
```

## Per-test screenshots

Every browser test automatically saves a final full-page PNG at the end of
its run. Tests that exercise multiple UI states (clicks, typing, dropdowns)
can also take **stepped screenshots** mid-test via `app.capture('label')`.

Layout:

```
e2e/screenshots/<spec-path>/<test-title>/
  01_<label>.png         ← app.capture('label')        (first call)
  02_<label>.png         ← app.capture('another')      (second call)
  …
  99_final__passed.png   ← auto, end-of-test full page
```

- Filenames are auto-numbered in call order so they sort naturally.
- Each PNG is also attached to the HTML report, so `npm run test:e2e:report`
  shows the whole storyboard inline next to the test.
- Retries get a `__retryN` suffix on the final image so earlier attempts
  aren't overwritten.
- API-only specs (`e2e/api/*.spec.js`) intentionally use the vanilla
  `@playwright/test` import so they don't spin up a browser — no PNGs.

Use `app.capture` inside a browser test:

```js
test('search flow', async ({ app, page }) => {
  await app.goto();
  await app.navigateTo('Jobs Manager');
  await app.capture('initial');

  await page.getByPlaceholder(/Search/i).fill('demo');
  await app.capture('after-search');

  await page.locator('select[title="Column / Status"]').selectOption('running');
  await app.capture('running-filter');
});
```

To disable on a single run:

```bash
E2E_SCREENSHOTS=0 npm run test:e2e
```

To redirect to another folder (e.g. for sharing with a PR):

```bash
E2E_SCREENSHOT_DIR=/tmp/eval-screens npm run test:e2e
```

## Adding a new regression

1. Drop a new spec under `e2e/pages/<feature>.spec.js`.
2. Import helpers from `../fixtures/app.js` (`test`, `expect`, `PAGES`).
3. Prefer semantic locators (`getByRole`, `getByText`) over CSS classes so
   tests survive Tailwind refactors.
4. Keep specs **idempotent** — do not depend on pre-existing DB state. If you
   need data, create it through the API in `test.beforeAll` and delete it in
   `test.afterAll`.

## Troubleshooting

- **"Backend not reachable"** — API specs are skipped automatically. Start
  uvicorn or docker compose to enable them.
- **Vite refuses to start on 5173** — another process is using the port. Stop
  it or set `PW_REUSE_DEV=1` and start Vite on a custom port + `BASE_URL`.
- **Flaky sidebar click** — the SPA starts with the sidebar expanded; if you
  changed that default, update `fixtures/app.js::navigateTo` to open it first.

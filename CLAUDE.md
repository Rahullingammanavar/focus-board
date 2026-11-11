# Focus Board: context for Claude Code

## What this is

Focus Board is a personal, ADHD-friendly daily planner for one user (Rahul). It is a static web app (no framework, no build step) that signs in with Google and syncs through Firebase. It works on phone and laptop browsers.

- Firebase project: `my-list-179f0` (Spark / free plan)
- GitHub repo: `https://github.com/Rahullingammanavar/focus-board`
- Target live URL: `https://my-list-179f0.web.app`
- An earlier copy runs as a private claude.ai artifact; the user moves data from it with Backup → Copy / Import.

## Features (all already built and tested)

- **Today**: 3–5 tasks (limit 3/4/5), picked from *Weekly goals* or *All tasks*. Tiny steps, "Not today", 5-minute timer, done list, progress bar.
- **Scheduled tasks**: a task can have a date (quick chips Today / Tomorrow / This weekend (Sat) / Next week (Mon), or a native date picker) from the add row in All tasks / Weekly goals, sheet rows (Set date / Change date) and the ⋯ options on Today. Tags: Today, Tomorrow, weekday within 6 days, else "14 Nov"; past dates show "Overdue" in muted red. A date of today (or earlier) puts the task straight into Today. Each day `rollover()` moves unfinished tasks dated today or earlier into Today, even past the daily limit (the limit still blocks manual adds); "Not today" tasks still go back to All tasks first. Today shows "Coming up" (next 7 days, max 5 rows, "+ Today" to pull one in early); All tasks lists "Scheduled" (by date) then "No date".
- **Daily tasks**: habits that repeat on chosen weekdays; ticked per day.
- **Capture**: Realizations, Ideas (status New → Started → Done → Dropped), Learn (Want → Learning → Learned). A note can become a task.
- **Goals**: grouped by life area (Health, Money, Study, Career, Personal + custom). Each goal has a detail page: regular steps (daily or 1–5× a week, ticked per day), one-time steps, stats, a 30-day chart, "Mark as achieved". A Goal history page shows achieved goals and steps per week.
- **History**: last 7 days, 30-day stacked chart (tasks vs daily tasks), daily-task consistency, day-by-day list (keeps 90 days).
- **Backup and settings** sheet (Today tab, bottom): account + sign out, export all data as JSON text, import JSON.

## Stack and layout

| Path | Purpose |
|---|---|
| `public/index.html` | Page shell, loads `css/styles.css` and `js/app.js` (ES module) |
| `public/css/styles.css` | All styles. Light theme only, white background, blue accent `#2F5BEA` |
| `public/js/config.js` | Firebase config (not secret), constants, `LOCAL_ONLY` flag |
| `public/js/logic.js` | Pure functions (dates, scheduling: `quickDate`/`dateLabel`/`upcoming`, normalize/migrate, rollover, goals, history). No DOM. |
| `public/js/firebase-sync.js` | Google sign-in + Firestore sync via the Firebase JS SDK 10.12.2 from gstatic CDN |
| `public/js/app.js` | State, rendering (template strings), event delegation via `data-act` / `data-tab` / `data-sheet` / `data-goal` |
| `tests/unit/logic.test.js` | 28 unit tests, `node:test` |
| `tests/e2e/app.test.js` | 19 browser tests, Playwright (Chromium) + `node:test`, run against `?local` mode |
| `scripts/serve.mjs` | Zero-dependency static server (port 4173) |
| `firestore.rules` | Each signed-in user may only read/write `users/{their uid}` |
| `firebase.json`, `.firebaserc` | Hosting serves `public/`; rules file; default project |
| `.github/workflows/ci-cd.yml` | Tests on every push/PR; deploys `main` to Firebase Hosting after tests pass |

## Data model

One Firestore document per user: `users/{uid}` = `{ savedAt: number, state: string }`, where `state` is JSON of:

```
{ v: 1, savedAt, todayLimit, lastRollover, areas: string[],
  tasks:    [{ id, title, size, list: 'today'|'master'|'nottoday'|'done', week: bool, steps: [{id,t,done}], created, doneAt, doneDay,
               date: 'YYYY-MM-DD' | null /* scheduled day; normalize() sets null on older tasks */ }],
  routines: [{ id, title, days: number[] /* 0=Mon..6=Sun */, created }],
  routineDone: { 'YYYY-MM-DD': [routineId] },
  notes:    [{ id, kind: 'realization'|'idea'|'learn', text, status, created }],
  goals:    [{ id, area, scope: 'year'|'month', text, done, doneAt, created,
               actions: [{ id, title, freq: 'daily'|'w1'..'w5'|'once', done, doneAt }],
               logs: { 'YYYY-MM-DD': [actionId] } }] }
```

`normalize()` in `logic.js` migrates older data; keep it backward compatible. The browser also caches state in `localStorage` (`focus-board-fb-v1`, or `focus-board-local-v1` in `?local` mode).

## Commands

```bash
npm install
npx playwright install chromium   # first time
npm start                         # http://localhost:4173/?local   (?local = no sign-in, browser-only data)
npm test                          # unit tests
npm run test:e2e                  # browser tests
npm run test:all
```

## Rules for changes

- Run `npm run test:all` before every commit; all tests must pass. Add tests for new behaviour: pure logic goes in `logic.js` with unit tests, and user flows get an e2e test.
- Keep it dependency-free at runtime: no frameworks, no bundler. Only dev dependency is `playwright`.
- Always escape user text with `esc()` when building HTML.
- Keep the look: white, calm, grouped lists with hairlines, one blue accent, phone-first (390px wide, no sideways scroll).
- Never commit secrets (service-account JSON, tokens). The Firebase web config in `config.js` is public by design.
- Stay backward compatible with saved data (`v: 1`); migrate in `normalize()`.

## Setup tasks (do these in order, check with the user between steps)

1. **Check tools**: Node ≥ 20, git, and `gh` (GitHub CLI) if available. Then `npm install`, `npx playwright install chromium`, `npm run test:all`, which must show 47 passing (28 unit + 19 browser).
2. **Push to GitHub**: `git init`, commit everything, `git branch -M main`, add remote `https://github.com/Rahullingammanavar/focus-board.git`, push. If the remote already has a README commit, `git pull --rebase origin main` first (or ask the user before force-pushing). Make sure `node_modules/` is not committed.
3. **Firebase CLI**: `npm install -g firebase-tools`, `firebase login` (the user signs in in the browser), `firebase use my-list-179f0`.
4. **Ask the user to confirm in the Firebase console** (CLI cannot do these):
   - Authentication → Sign-in method → **Google** is enabled.
   - **Firestore Database** is created (production mode, region asia-south1).
5. **Deploy rules and site**: `firebase deploy --only firestore:rules,hosting`. Then open `https://my-list-179f0.web.app`, check it loads and Google sign-in works.
6. **Auto-deploy from GitHub**: run `firebase init hosting:github` for repo `Rahullingammanavar/focus-board`. Answer: no build script, yes deploy on merge to `main`. It creates a GitHub secret named like `FIREBASE_SERVICE_ACCOUNT_MY_LIST_179F0` and two workflow files `.github/workflows/firebase-hosting-*.yml`. **Delete those two generated workflow files** (our `ci-cd.yml` already tests and deploys) and change `ci-cd.yml` to use `secrets.FIREBASE_SERVICE_ACCOUNT_MY_LIST_179F0`. Do not let the init overwrite `firebase.json` or `public/index.html`.
7. **Verify the pipeline**: commit and push, then `gh run watch` (or check the Actions tab). Both jobs must be green.
8. **Data move**: tell the user to open the old claude.ai app → Today → Backup and settings → Copy, then in the new app sign in → Backup and settings → paste into Import → Import → confirm.

## Known gaps / not yet verified

- Real Google sign-in and Firestore sync have not been tested live yet (they were built without network access to Google). Check them at step 5 and fix anything that fails.
- If sign-in fails on a custom domain, add that domain under Authentication → Settings → Authorized domains (`web.app` and `firebaseapp.com` are allowed by default).

## Ideas the user may ask for next

- Show goal steps (daily/weekly) on the Today screen so they can be ticked there.
- Reminders / notifications.
- An installable app icon (manifest is in place; a PNG icon set and service worker would make it fully installable offline).

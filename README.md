# Focus Board

A simple, ADHD-friendly daily planner. Pick a few things for today, keep weekly goals and a master list, tick off daily habits, track goals by area of life, and see your history.

**Live app:** https://my-list-179f0.web.app

## Features

- **Today**: 3 to 5 tasks at a time, picked from *Weekly goals* or *All tasks*. Tiny steps, a "Not today" option and a 5-minute timer for when you feel stuck.
- **Daily tasks**: habits that repeat on the days you choose (for example Mon, Wed, Fri).
- **Capture**: realizations, ideas (New → Started → Done → Dropped) and things to learn.
- **Goals**: grouped by area (Health, Money, Study, Career, Personal, plus your own). Each goal has its own page with regular steps (daily or N× a week), one-time steps, a streak and a 30-day chart. Goal history shows what you achieved.
- **History**: everything you finished, a 30-day chart and how consistent each daily task is.
- **Sync**: sign in with Google; data syncs between phone and laptop through Firestore and works offline.
- **Backup**: export all data as text and import it anywhere.

## Tech stack

No framework and no build step: the files in `public/` are served as they are.

| Part | Tech |
|---|---|
| UI | HTML, CSS, JavaScript ES modules |
| Charts and icons | Hand-written SVG |
| Login | Firebase Authentication (Google) |
| Database | Cloud Firestore, one document per user |
| Hosting | Firebase Hosting |
| Tests | Node's built-in test runner + Playwright (Chromium) |
| CI/CD | GitHub Actions: test on every push, deploy `main` after tests pass |

## Project structure

```
public/                  ← everything that gets deployed
  index.html             page shell
  css/styles.css         all styles
  js/config.js           Firebase config and app constants
  js/logic.js            pure logic (dates, rollover, goals, history); unit tested
  js/firebase-sync.js    Google sign-in and Firestore sync
  js/app.js              state, screens and event handling
  favicon.svg, manifest.webmanifest
tests/unit/              logic tests (node:test)
tests/e2e/               browser tests that click through the app (Playwright)
scripts/serve.mjs        tiny local web server, no dependencies
firestore.rules          database security rules: each user can only read and write their own data
firebase.json, .firebaserc   Firebase Hosting setup
.github/workflows/ci-cd.yml  test + deploy pipeline
```

## Run it on your computer

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:4173/?local. The `?local` part skips sign-in and keeps data in that browser only, which is handy for trying changes. Without `?local` you get the real Google sign-in (add `localhost` under Firebase → Authentication → Settings → Authorized domains if it is not there).

## Tests

```bash
npx playwright install chromium   # first time only
npm test            # unit tests
npm run test:e2e    # browser tests
npm run test:all    # both
```

## One-time setup for auto-deploy

Every push to `main` runs the tests and, if they pass, publishes to https://my-list-179f0.web.app. GitHub needs permission to publish to your Firebase project:

1. Open [Google Cloud console → IAM & Admin → Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=my-list-179f0) for project **my-list-179f0**.
2. Click **Create service account**, name it `github-deploy`, and click **Create and continue**.
3. Give it these roles: **Firebase Hosting Admin**, **API Keys Viewer**, **Firebase Authentication Admin** and **Cloud Run Viewer**. Click **Done**.
4. Open the new account → **Keys** → **Add key** → **Create new key** → **JSON**. A file downloads.
5. In GitHub, open this repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
   Name: `FIREBASE_SERVICE_ACCOUNT`. Value: paste the whole contents of the JSON file. Save.
6. Delete the downloaded JSON file from your computer. Never commit it.
7. Go to the **Actions** tab and re-run the latest workflow (or push any change).

Also make sure these are done in the [Firebase console](https://console.firebase.google.com/project/my-list-179f0):

- **Authentication → Sign-in method → Google**: enabled.
- **Firestore Database**: created, with the rules from `firestore.rules` pasted under **Rules** and published.

## Moving data from the claude.ai version

1. In the old app: **Today → Backup and settings → Copy**.
2. In the new app: sign in, open **Backup and settings**, paste into **Import**, tap **Import**, then confirm.

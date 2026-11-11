// End-to-end tests: open the real app in Chromium and click through it like a user.
// Runs in ?local mode (no sign-in, data kept in the browser). Run with: npm run test:e2e
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';

let server, browser, base, context, page, errors;

before(async () => {
  server = await startServer(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Tests never depend on the network: stub the web font, block anything else external.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  page = await context.newPage();
  errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await open();
});
afterEach(async () => {
  await context.close();
  assert.deepEqual(errors, [], 'the page logged errors');
});

const open = async (hash = '') => { await page.goto(`${base}/?local${hash}`); await page.waitForSelector('#tabs button'); };
const text = sel => page.locator(sel).innerText();
const typeEnter = async (sel, value) => { await page.fill(sel, value); await page.press(sel, 'Enter'); };
const tab = name => page.click(`[data-tab="${name}"]`);
const closeSheet = () => page.click('.sheet .done-btn');

async function addToAll(...titles) {
  await page.click('[data-sheet="all"]');
  for (const t of titles) await typeEnter('#add-all', t);
}

describe('Today', () => {
  test('opens on an empty Today screen with all four tabs', async () => {
    assert.match(await text('h1'), /Today/);
    assert.match(await text('#view'), /Nothing planned yet/);
    assert.deepEqual(await page.locator('#tabs button span').allInnerTexts(), ['Today', 'Capture', 'Goals', 'History']);
  });

  test('add tasks to All tasks, plan one for the week and pick one for today', async () => {
    await addToAll('Update resume', 'Call the bank');
    await page.locator('.row', { hasText: 'Update resume' }).locator('[data-act="to-week"]').click();
    await page.locator('.row', { hasText: 'Call the bank' }).locator('[data-act="pick"]').click();
    assert.match(await text('.sheet'), /In Today/);
    await closeSheet();
    assert.match(await text('[data-sheet="week"]'), /1/);
    assert.match(await text('#view'), /To do[\s\S]*Call the bank/);
    assert.match(await text('.progress'), /0 of 1 done/);
  });

  test('add a task straight to Today and finish it', async () => {
    await typeEnter('#add-today', 'Reply to one email');
    await page.click('[data-act="finish"]');
    assert.match(await text('#view'), /1 of 1 done/);
    assert.match(await text('#view'), /Done/);
    await page.click('[data-act="undone"]');
    assert.match(await text('#view'), /0 of 1 done/);
  });

  test('the daily limit stops Today from getting too full', async () => {
    await page.click('[data-limit="3"]');
    for (const t of ['A', 'B', 'C']) await typeEnter('#add-today', t);
    assert.equal(await page.locator('#add-today').count(), 0, 'add box hides when Today is full');
    await addToAll('D');
    await page.locator('.row', { hasText: 'D' }).locator('[data-act="pick"]').click();
    assert.match(await text('#toast-slot'), /Today is full/);
  });

  test('Not today moves a task out, and tiny steps can be added', async () => {
    await typeEnter('#add-today', 'Clean room');
    await page.click('[data-act="toggle"]');
    await typeEnter('[id^="step-"]', 'Pick up clothes');
    assert.match(await text('#view'), /Pick up clothes/);
    await page.click('[data-act="not-today"]');
    assert.match(await text('#view'), /Not today/);
    assert.match(await text('#view'), /Nothing planned yet/);
  });

  test('data survives a page reload', async () => {
    await typeEnter('#add-today', 'Persist me');
    await open();
    assert.match(await text('#view'), /Persist me/);
  });

  test('user text is shown as text, never run as HTML', async () => {
    await typeEnter('#add-today', '<img src=x onerror="window.__hacked=1">');
    assert.equal(await page.evaluate(() => window.__hacked), undefined);
    assert.match(await text('#view'), /<img src=x/);
  });
});

describe('Scheduled tasks', () => {
  test('a task for Tomorrow waits in Coming up, then moves into Today the next day', async () => {
    // Wednesday 11 Nov 2026, 10:00 local time. setFixedTime fakes Date only; timers keep running.
    await page.clock.setFixedTime(new Date(2026, 10, 11, 10, 0));
    await open();
    await page.click('[data-sheet="all"]');
    await page.fill('#add-all', 'Book dentist');
    await page.click('form[data-where="all"] [data-act="date-open"]');
    await page.click('.add-pick [data-q="tomorrow"]');
    assert.equal(await page.inputValue('#add-all'), 'Book dentist', 'typed text is kept');
    await page.press('#add-all', 'Enter');
    assert.match(await text('.sheet'), /Scheduled[\s\S]*Book dentist[\s\S]*Tomorrow/);
    await closeSheet();
    assert.match(await text('#view'), /Nothing planned yet/);
    assert.match(await text('#view'), /Coming up[\s\S]*Tomorrow[\s\S]*Book dentist/);

    await page.clock.setFixedTime(new Date(2026, 10, 12, 9, 0));
    await open();
    assert.match(await text('#view'), /To do[\s\S]*Book dentist/);
    assert.doesNotMatch(await text('#view'), /Coming up/);
    assert.equal(await page.locator('[data-act="finish"]').count(), 1);
  });

  test('a date of today puts the task straight into Today, even when Today is full', async () => {
    await page.click('[data-limit="3"]');
    for (const t of ['A', 'B', 'C']) await typeEnter('#add-today', t);
    await addToAll('Pay rent');
    await page.locator('.row', { hasText: 'Pay rent' }).locator('[data-act="date-open"]').click();
    await page.click('.sheet .date-pick [data-q="today"]');
    assert.match(await text('.sheet'), /Pay rent[\s\S]*In Today/);
    await closeSheet();
    assert.match(await text('#view'), /To do[\s\S]*Pay rent/);
    assert.match(await text('.progress'), /4\/3 spots/);
  });

  test('change a date from Today, pull it back early, and remove the date', async () => {
    await typeEnter('#add-today', 'Water plants');
    await page.click('[data-act="toggle"]');
    await page.click('.expand [data-act="date-open"]');
    // the native picker: any day 3 days from now
    const later = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); });
    await page.fill('.expand input[type="date"]', later);
    assert.match(await text('#view'), /Nothing planned yet/);
    assert.match(await text('#view'), /Coming up[\s\S]*Water plants/);
    await page.locator('.coming [data-act="pick"]').click();
    assert.match(await text('#view'), /To do[\s\S]*Water plants/);
    assert.doesNotMatch(await text('#view'), /Coming up/);

    await page.click('[data-sheet="all"]');
    assert.match(await text('.sheet'), /Scheduled/);
    await page.locator('.sheet .row', { hasText: 'Water plants' }).locator('[data-act="date-open"]').click();
    await page.click('.sheet .date-pick [data-act="date-clear"]');
    const sheet = await text('.sheet');
    assert.doesNotMatch(sheet, /Scheduled/);
    assert.match(sheet, /Set date/);
    assert.equal(await page.locator('.sheet .tag').count(), 0);
  });

  test('overdue tasks get an Overdue tag', async () => {
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('focus-board-local-v1'));
      s.tasks.push({ id: 'od', title: 'Old plan', list: 'nottoday', week: false, steps: [], created: 1, doneAt: null, date: '2020-01-01' });
      localStorage.setItem('focus-board-local-v1', JSON.stringify(s));
    });
    await open();
    await page.click('[data-sheet="all"]');
    assert.equal(await text('.sheet .tag.overdue'), 'Overdue');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `sheet scrolls sideways by ${overflow}px`);
  });
});

describe('Daily tasks', () => {
  test('a daily task shows on its days and can be ticked', async () => {
    await page.click('[data-sheet="routine"]');
    await typeEnter('#add-routine', 'Drink water');
    // second habit only on a day that is NOT today
    const todayIdx = await page.evaluate(() => (new Date().getDay() + 6) % 7);
    await page.fill('#add-routine', 'Not today habit');
    for (let d = 0; d < 7; d++) if (d !== (todayIdx + 1) % 7) await page.click(`[data-act="new-day"][data-day="${d}"]`);
    await page.click('.routine-add .btn');
    assert.match(await text('.sheet'), /Every day/);
    await closeSheet();
    const daily = await text('#view');
    assert.match(daily, /Drink water/);
    assert.doesNotMatch(daily, /Not today habit/);
    await page.click('[data-act="routine-check"]');
    assert.match(await text('#view'), /Daily tasks · 1\/1/);
  });
});

describe('Capture', () => {
  test('ideas get a status that cycles, and can become a task', async () => {
    await tab('capture');
    await page.click('[data-cseg="idea"]');
    await page.fill('#add-note-idea', 'Habit tracker app');
    await page.click('.composer .btn');
    const status = page.locator('[data-act="cycle"]');
    assert.match(await status.innerText(), /New/);
    await status.click(); assert.match(await page.locator('[data-act="cycle"]').innerText(), /Started/);
    await page.locator('[data-act="cycle"]').click(); assert.match(await page.locator('[data-act="cycle"]').innerText(), /Done/);
    await page.locator('[data-act="cycle"]').click(); assert.match(await page.locator('[data-act="cycle"]').innerText(), /Dropped/);
    await page.click('[data-act="to-task"]');
    await tab('home');
    assert.match(await text('[data-sheet="all"]'), /1/);
  });
});

describe('Goals', () => {
  test('goal page: add steps, tick one, mark achieved, see it in goal history', async () => {
    await tab('goals');
    await typeEnter('#add-goal-0', 'Lose 5 kg'); // Health
    assert.match(await text('#view'), /Lose 5 kg/);
    await page.click('[data-goal]');
    assert.match(await text('h1'), /Lose 5 kg/);
    await page.fill('#ga-repeat', 'Walk 30 minutes');
    await page.selectOption('form[data-kind="repeat"] select', 'daily');
    await page.press('#ga-repeat', 'Enter');
    await typeEnter('#ga-once', 'Join a gym');
    await page.click('[data-act="ga-log"]');
    assert.match(await text('#view'), /1\/7 this week/);
    assert.match(await text('.stats'), /1\s*this week/);
    assert.equal(await page.locator('#goal-card svg').count(), 1, 'progress chart is drawn');
    await page.click('[data-act="ga-step"]');
    assert.match(await text('#view'), /1 of 1/);
    await page.click('[data-act="goal"]');
    assert.match(await text('#view'), /Achieved/);
    await page.click('[data-act="goal-back"]');
    await page.click('[data-act="goal-history"]');
    assert.match(await text('#view'), /Goal history/);
    assert.match(await text('#view'), /Lose 5 kg/);
  });

  test('custom areas can be added and empty ones removed', async () => {
    await tab('goals');
    await typeEnter('#add-area', 'Family');
    assert.match(await text('#view'), /Family/);
    await page.click('[data-act="del-area"][data-area="Family"]');
    assert.doesNotMatch(await text('#view'), /Family/);
  });
});

describe('History', () => {
  test('finished items show in History with the charts', async () => {
    await typeEnter('#add-today', 'Ship it');
    await page.click('[data-act="finish"]');
    await tab('history');
    assert.match(await text('#view'), /1 thing done in the last 7 days/);
    assert.match(await text('#view'), /Ship it/);
    assert.equal(await page.locator('#month-card svg').count(), 1);
    await page.hover('#month-card .hit[data-tip="29"]');
    assert.match(await text('#month-card .tip'), /Today/);
  });
});

describe('Backup', () => {
  test('export then import restores everything', async () => {
    await typeEnter('#add-today', 'Backed up task');
    await page.click('[data-sheet="settings"]');
    await page.click('[data-act="export"]');
    const data = await page.inputValue('#export-text');
    assert.match(data, /Backed up task/);
    await closeSheet();

    await page.evaluate(() => localStorage.clear());
    await open();
    assert.doesNotMatch(await text('#view'), /Backed up task/);

    await page.click('[data-sheet="settings"]');
    await page.fill('#import-text', data);
    await page.click('[data-act="import"]');
    await page.click('[data-act="import-yes"]');
    assert.match(await text('#view'), /Backed up task/);
  });

  test('import rejects text that is not Focus Board data', async () => {
    await page.click('[data-sheet="settings"]');
    await page.fill('#import-text', 'hello');
    await page.click('[data-act="import"]');
    assert.match(await text('#toast-slot'), /doesn't look like Focus Board data/);
  });
});

describe('Layout', () => {
  test('no sideways scrolling on a phone screen, on any tab', async () => {
    await typeEnter('#add-today', 'A very long task title that keeps going and going without any breaks at all');
    await page.click('[data-sheet="all"]');
    await page.fill('#add-all', 'Another very long scheduled task title that keeps going and going');
    await page.click('form[data-where="all"] [data-act="date-open"]');
    await page.click('.add-pick [data-q="tomorrow"]');
    await page.press('#add-all', 'Enter');
    await closeSheet();
    assert.match(await text('#view'), /Coming up/);
    for (const t of ['home', 'capture', 'goals', 'history']) {
      await tab(t);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${t} tab scrolls sideways by ${overflow}px`);
    }
  });
});

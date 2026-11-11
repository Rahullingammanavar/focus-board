// Unit tests for the pure logic. Run with: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayStr, mondayStr, weekdayIndex, esc, blank, normalize, rollover, daysLabel, nextNoteStatus,
  weekTarget, countSince, goalStreak, toggleLog, historyByDay, routineConsistency,
  addDays, quickDate, dateLabel, upcoming
} from '../../public/js/logic.js';

// Fixed local "now": Wednesday 11 Nov 2026, noon.
const NOW = new Date(2026, 10, 11, 12, 0, 0);
const daysAgo = n => { const d = new Date(NOW); d.setDate(d.getDate() - n); return d; };
const k = n => dayStr(daysAgo(n));

describe('dates', () => {
  test('dayStr gives the local calendar date', () => {
    assert.equal(dayStr(NOW), '2026-11-11');
    assert.equal(dayStr(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
  });
  test('mondayStr finds the Monday of the week', () => {
    assert.equal(mondayStr(NOW), '2026-11-09');
    assert.equal(mondayStr(new Date(2026, 10, 15, 9)), '2026-11-09'); // Sunday
    assert.equal(mondayStr(new Date(2026, 10, 16, 9)), '2026-11-16'); // Monday
  });
  test('weekdayIndex counts Monday as 0 and Sunday as 6', () => {
    assert.equal(weekdayIndex(new Date(2026, 10, 9)), 0);
    assert.equal(weekdayIndex(new Date(2026, 10, 15)), 6);
  });
});

describe('esc', () => {
  test('escapes HTML so user text cannot inject markup', () => {
    assert.equal(esc('<b>"Tom" & \'Jerry\'</b>'), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
    assert.equal(esc(null), '');
  });
});

describe('normalize', () => {
  test('fills a missing state with defaults', () => {
    const s = normalize(undefined);
    assert.deepEqual(s.tasks, []);
    assert.equal(s.todayLimit, 5);
    assert.deepEqual(s.areas, ['Health', 'Money', 'Study', 'Career', 'Personal']);
  });
  test('migrates the old Weekly list into a weekly flag', () => {
    const s = normalize({ tasks: [{ id: 'a', title: 'x', list: 'week' }] });
    assert.equal(s.tasks[0].list, 'master');
    assert.equal(s.tasks[0].week, true);
    assert.deepEqual(s.tasks[0].steps, []);
  });
  test('fixes idea, learn and goal fields saved by older versions', () => {
    const s = normalize({
      notes: [{ id: 'i', kind: 'idea', status: 'want' }, { id: 'l', kind: 'learn' }],
      goals: [{ id: 'g', text: 'Run' }]
    });
    assert.equal(s.notes[0].status, 'new');
    assert.equal(s.notes[1].status, 'want');
    assert.equal(s.goals[0].area, 'Personal');
  });
  test('adds date: null to old tasks and keeps valid dates', () => {
    const s = normalize({ tasks: [{ id: 'a', title: 'old', list: 'master' }, { id: 'b', list: 'master', date: '2026-11-20' }, { id: 'c', list: 'master', date: 'soon' }] });
    assert.equal(s.tasks[0].date, null);
    assert.equal(s.tasks[1].date, '2026-11-20');
    assert.equal(s.tasks[2].date, null);
    assert.equal(s.v, 1);
  });
  test('blank() returns independent copies', () => {
    const a = blank(), b = blank();
    a.areas.push('X');
    assert.equal(b.areas.includes('X'), false);
  });
});

describe('rollover', () => {
  test('runs once per day', () => {
    const s = blank();
    assert.equal(rollover(s, NOW), true);
    assert.equal(rollover(s, NOW), false);
    assert.equal(s.lastRollover, '2026-11-11');
  });
  test('returns Not today tasks to All tasks and keeps Today tasks', () => {
    const s = blank();
    s.tasks = [{ id: 'a', list: 'nottoday' }, { id: 'b', list: 'today' }];
    rollover(s, NOW);
    assert.equal(s.tasks[0].list, 'master');
    assert.equal(s.tasks[1].list, 'today');
  });
  test('clears finished tasks and daily ticks older than 90 days', () => {
    const s = blank();
    s.tasks = [
      { id: 'old', list: 'done', doneAt: daysAgo(91).getTime() },
      { id: 'new', list: 'done', doneAt: daysAgo(89).getTime() }
    ];
    s.routineDone = { [k(95)]: ['r'], [k(10)]: ['r'] };
    rollover(s, NOW);
    assert.deepEqual(s.tasks.map(t => t.id), ['new']);
    assert.deepEqual(Object.keys(s.routineDone), [k(10)]);
  });
});

describe('scheduled dates', () => {
  const t = (id, list, date, extra) => Object.assign({ id, title: id, list, date, steps: [], created: 0 }, extra);

  test('rollover moves tasks dated today or earlier into Today, even past the limit', () => {
    const s = blank();
    s.todayLimit = 3;
    s.tasks = [t('a', 'today', null), t('b', 'today', null), t('c', 'today', null),
      t('due', 'master', k(0)), t('late', 'master', k(3), { week: true })];
    rollover(s, NOW);
    assert.equal(s.tasks.find(x => x.id === 'due').list, 'today');
    assert.equal(s.tasks.find(x => x.id === 'late').list, 'today');
    assert.equal(s.tasks.filter(x => x.list === 'today').length, 5);
  });
  test('rollover leaves future-dated and finished tasks where they are', () => {
    const s = blank();
    s.tasks = [t('future', 'master', '2026-11-12'), t('done', 'done', k(0), { doneAt: NOW.getTime() })];
    rollover(s, NOW);
    assert.equal(s.tasks[0].list, 'master');
    assert.equal(s.tasks[1].list, 'done');
  });
  test('rollover sends a dated Not today task back to All tasks, not into Today', () => {
    const s = blank();
    s.tasks = [t('skip', 'nottoday', k(1))];
    rollover(s, NOW);
    assert.equal(s.tasks[0].list, 'master');
  });
  test('addDays crosses months and years', () => {
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });
  test('quick dates: today, tomorrow, this weekend (Sat) and next week (Mon)', () => {
    assert.equal(quickDate('today', NOW), '2026-11-11');
    assert.equal(quickDate('tomorrow', NOW), '2026-11-12');
    assert.equal(quickDate('weekend', NOW), '2026-11-14');
    assert.equal(quickDate('nextweek', NOW), '2026-11-16');
    const sat = new Date(2026, 10, 14, 9), sun = new Date(2026, 10, 15, 9);
    assert.equal(quickDate('weekend', sat), '2026-11-14');
    assert.equal(quickDate('nextweek', sun), '2026-11-16');
  });
  test('dateLabel: Overdue, Today, Tomorrow, weekday within 6 days, else "14 Nov"', () => {
    assert.equal(dateLabel('2026-11-10', NOW), 'Overdue');
    assert.equal(dateLabel('2026-11-11', NOW), 'Today');
    assert.equal(dateLabel('2026-11-12', NOW), 'Tomorrow');
    assert.equal(dateLabel('2026-11-13', NOW), 'Fri');
    assert.equal(dateLabel('2026-11-17', NOW), 'Tue');
    assert.equal(dateLabel('2026-11-18', NOW), '18 Nov');
    assert.equal(dateLabel('2026-12-14', NOW), '14 Dec');
  });
  test('upcoming lists open tasks dated in the next 7 days, sorted by date', () => {
    const s = blank();
    s.tasks = [t('sat', 'master', '2026-11-14'), t('tom', 'master', '2026-11-12'), t('far', 'master', '2026-11-19'),
      t('wk7', 'master', '2026-11-18'), t('in', 'today', '2026-11-13'), t('fin', 'done', '2026-11-13'), t('now', 'master', k(0))];
    assert.deepEqual(upcoming(s, NOW).map(x => x.id), ['tom', 'sat', 'wk7']);
  });
});

describe('labels and statuses', () => {
  test('daysLabel names common patterns', () => {
    assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), 'Every day');
    assert.equal(daysLabel([4, 0, 1, 2, 3]), 'Weekdays');
    assert.equal(daysLabel([6, 5]), 'Weekends');
    assert.equal(daysLabel([2, 0]), 'Mon, Wed');
  });
  test('idea status cycles New → Started → Done → Dropped → New', () => {
    const n = { kind: 'idea', status: 'new' };
    const seen = [];
    for (let i = 0; i < 4; i++) { n.status = nextNoteStatus(n); seen.push(n.status); }
    assert.deepEqual(seen, ['started', 'done', 'dropped', 'new']);
  });
  test('learn status cycles Want → Learning → Learned → Want', () => {
    assert.equal(nextNoteStatus({ kind: 'learn', status: 'want' }), 'learning');
    assert.equal(nextNoteStatus({ kind: 'learn', status: 'learned' }), 'want');
  });
});

describe('goals', () => {
  test('weekTarget reads the step frequency', () => {
    assert.equal(weekTarget({ freq: 'daily' }), 7);
    assert.equal(weekTarget({ freq: 'w3' }), 3);
    assert.equal(weekTarget({ freq: 'once' }), 1);
  });
  test('toggleLog adds and removes a check-in, and cleans empty days', () => {
    const g = {};
    assert.equal(toggleLog(g, 'a1', '2026-11-11'), true);
    assert.deepEqual(g.logs, { '2026-11-11': ['a1'] });
    assert.equal(toggleLog(g, 'a1', '2026-11-11'), false);
    assert.deepEqual(g.logs, {});
  });
  test('countSince counts per step and in total', () => {
    const g = { logs: { [k(0)]: ['a', 'b'], [k(1)]: ['a'], [k(10)]: ['a'] } };
    assert.equal(countSince(g, 'a', k(6)), 2);
    assert.equal(countSince(g, null, k(6)), 3);
    assert.equal(countSince(g, null, '0'), 4);
  });
  test('goalStreak counts back from today, or from yesterday if today is empty', () => {
    assert.equal(goalStreak({ logs: { [k(0)]: ['a'], [k(1)]: ['a'], [k(2)]: ['a'], [k(4)]: ['a'] } }, NOW), 3);
    assert.equal(goalStreak({ logs: { [k(1)]: ['a'], [k(2)]: ['a'] } }, NOW), 2);
    assert.equal(goalStreak({ logs: { [k(3)]: ['a'] } }, NOW), 0);
  });
});

describe('history', () => {
  test('groups finished tasks and daily tasks by day', () => {
    const s = blank();
    s.tasks = [
      { id: 't1', title: 'Call bank', list: 'done', doneAt: daysAgo(0).getTime(), doneDay: k(0) },
      { id: 't2', title: 'Still open', list: 'today' }
    ];
    s.routines = [{ id: 'r1', title: 'Water', days: [0, 1, 2, 3, 4, 5, 6] }];
    s.routineDone = { [k(0)]: ['r1'], [k(1)]: ['gone'] };
    const map = historyByDay(s);
    assert.deepEqual(map[k(0)].map(x => [x.title, x.kind]).sort(), [['Call bank', 'Task'], ['Water', 'Daily']]);
    assert.equal(map[k(1)][0].title, 'Daily task (deleted)');
  });
  test('routineConsistency only counts scheduled days since the habit was created', () => {
    const s = blank();
    const r = { id: 'gym', days: [0, 2, 4], created: daysAgo(13).getTime() }; // Mon/Wed/Fri, created 2 weeks ago
    s.routineDone = { [k(0)]: ['gym'], [k(2)]: ['gym'] }; // Wed 11 and Mon 9 Nov
    const c = routineConsistency(s, r, NOW);
    assert.equal(c.due, 6);
    assert.equal(c.done, 2);
    assert.equal(c.pct, 33);
  });
});

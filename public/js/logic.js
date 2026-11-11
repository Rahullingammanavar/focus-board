// Pure functions: no DOM, no storage, no clock unless passed in.
// Everything here is covered by tests/unit/logic.test.js.
import { DEFAULT_AREAS, DEFAULT_TODAY_LIMIT, KEEP_HISTORY_DAYS, DAY_NAMES, IDEA_NEXT, LEARN_NEXT } from './config.js';

const DAY_MS = 864e5;

/** Local calendar date as YYYY-MM-DD. */
export const dayStr = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

/** Monday of the week containing `d`, as YYYY-MM-DD. */
export function mondayStr(d = new Date()) {
  const m = new Date(d);
  m.setDate(m.getDate() - (m.getDay() + 6) % 7);
  return dayStr(m);
}

/** 0 = Monday … 6 = Sunday */
export const weekdayIndex = (d = new Date()) => (d.getDay() + 6) % 7;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A fresh, empty app state. */
export const blank = () => ({
  v: 1, savedAt: 0, tasks: [], notes: [], goals: [], routines: [], routineDone: {},
  areas: DEFAULT_AREAS.slice(), todayLimit: DEFAULT_TODAY_LIMIT, lastRollover: null
});

/** Fill missing fields and migrate data saved by older versions. */
export function normalize(o) {
  const s = Object.assign(blank(), o || {});
  s.tasks.forEach(t => {
    if (t.list === 'week') { t.list = 'master'; t.week = true; } // v1 had a separate Weekly list
    t.steps = t.steps || [];
    if (!isDay(t.date)) t.date = null; // scheduled day, added later: old tasks have none
  });
  s.notes.forEach(n => {
    if (n.kind === 'idea' && !IDEA_NEXT[n.status]) n.status = 'new';
    if (n.kind === 'learn' && !LEARN_NEXT[n.status]) n.status = 'want';
  });
  s.goals.forEach(g => { if (!g.area) g.area = 'Personal'; });
  return s;
}

/**
 * Start-of-day housekeeping. Mutates `s`, returns true if anything ran.
 * - "Not today" tasks go back to All tasks
 * - unfinished tasks scheduled for today or earlier move into Today (even past the limit)
 * - finished tasks and daily-task ticks older than KEEP_HISTORY_DAYS are removed
 * Unfinished Today tasks stay in Today.
 */
export function rollover(s, now = new Date()) {
  const t = dayStr(now);
  if (s.lastRollover === t) return false;
  const skipped = s.tasks.filter(x => x.list === 'nottoday');
  skipped.forEach(x => { x.list = 'master'; });
  // Planned on purpose, so this may go over the daily limit. Tasks skipped with
  // "Not today" go back to All tasks first, like any other skipped task.
  s.tasks.forEach(x => { if (x.list === 'master' && isDay(x.date) && x.date <= t && !skipped.includes(x)) x.list = 'today'; });
  const cutoff = now.getTime() - KEEP_HISTORY_DAYS * DAY_MS;
  s.tasks = s.tasks.filter(x => !(x.list === 'done' && x.doneAt < cutoff));
  const oldest = dayStr(new Date(cutoff));
  Object.keys(s.routineDone).forEach(k => { if (k < oldest) delete s.routineDone[k]; });
  s.lastRollover = t;
  return true;
}

/* ---------- scheduled dates ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** True for a 'YYYY-MM-DD' string. */
export const isDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

const utc = k => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));

/** 'YYYY-MM-DD' plus `n` days (timezone safe). */
export const addDays = (k, n) => new Date(utc(k) + n * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `a` to `b` (both 'YYYY-MM-DD'). */
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY_MS);

/** Date for a quick chip: 'today' | 'tomorrow' | 'weekend' (Saturday) | 'nextweek' (next Monday). */
export function quickDate(kind, now = new Date()) {
  const t = dayStr(now), wd = weekdayIndex(now);
  if (kind === 'tomorrow') return addDays(t, 1);
  if (kind === 'weekend') return wd >= 5 ? t : addDays(t, 5 - wd); // on Sat/Sun it is already the weekend
  if (kind === 'nextweek') return addDays(t, 7 - wd);
  return t;
}

/** Short tag for a scheduled day: Overdue, Today, Tomorrow, a weekday within 6 days, else '14 Nov'. */
export function dateLabel(d, now = new Date()) {
  const n = daysBetween(dayStr(now), d);
  if (n < 0) return 'Overdue';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n <= 6) return DAY_NAMES[(utc(d) / DAY_MS + 3) % 7]; // 1 Jan 1970 was a Thursday (index 3)
  return `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;
}

/** Unfinished tasks scheduled after today and within `days` days, not already in Today. Sorted by date. */
export function upcoming(s, now = new Date(), days = 7) {
  const t = dayStr(now), end = addDays(t, days);
  return s.tasks
    .filter(x => x.list !== 'done' && x.list !== 'today' && isDay(x.date) && x.date > t && x.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
}

/** Human label for a set of weekday indexes. */
export function daysLabel(days) {
  if (days.length === 7) return 'Every day';
  const k = days.slice().sort().join('');
  if (k === '01234') return 'Weekdays';
  if (k === '56') return 'Weekends';
  return days.slice().sort().map(d => DAY_NAMES[d]).join(', ');
}

export const nextNoteStatus = n =>
  n.kind === 'idea' ? (IDEA_NEXT[n.status] || 'started') : (LEARN_NEXT[n.status] || 'want');

/* ---------- goals ---------- */

/** Target check-ins per week for a goal step. */
export const weekTarget = a => a.freq === 'daily' ? 7 : a.freq.startsWith('w') ? +a.freq.slice(1) : 1;

export const goalLogs = g => (g.logs = g.logs || {});

/** Check-ins since `from` (YYYY-MM-DD). With `aid`, counts days that step was done; without, all ticks. */
export const countSince = (g, aid, from) =>
  Object.entries(goalLogs(g))
    .filter(([k, ids]) => k >= from && (!aid || ids.includes(aid)))
    .reduce((n, [, ids]) => n + (aid ? 1 : ids.length), 0);

/** Consecutive days with at least one check-in, ending today (or yesterday if today is empty). */
export function goalStreak(g, now = new Date()) {
  const L = goalLogs(g);
  const d = new Date(now);
  let n = 0;
  if (!(L[dayStr(d)] || []).length) d.setDate(d.getDate() - 1);
  while ((L[dayStr(d)] || []).length) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/** Toggle a check-in for step `aid` on day `k`. Returns true if it is now logged. */
export function toggleLog(g, aid, k) {
  const L = goalLogs(g), arr = L[k] = L[k] || [];
  const i = arr.indexOf(aid);
  if (i >= 0) arr.splice(i, 1); else arr.push(aid);
  if (!arr.length) delete L[k];
  return i < 0;
}

/* ---------- history ---------- */

/** Everything finished, grouped by day: { 'YYYY-MM-DD': [{title, kind, t}] } */
export function historyByDay(s) {
  const map = {};
  const add = (day, item) => { (map[day] = map[day] || []).push(item); };
  s.tasks.filter(x => x.list === 'done' && x.doneAt)
    .forEach(x => add(x.doneDay || dayStr(new Date(x.doneAt)), { title: x.title, kind: 'Task', t: x.doneAt }));
  Object.entries(s.routineDone).forEach(([day, ids]) => ids.forEach(id => {
    const r = s.routines.find(r => r.id === id);
    add(day, { title: r ? r.title : 'Daily task (deleted)', kind: 'Daily', t: 0 });
  }));
  return map;
}

/** How often a daily task was done on its scheduled days over the last `n` days. */
export function routineConsistency(s, r, now = new Date(), n = 30) {
  const createdDay = dayStr(new Date(r.created || 0));
  let due = 0, done = 0;
  for (let i = 0; i < n; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const k = dayStr(d);
    if (k < createdDay || !r.days.includes(weekdayIndex(d))) continue;
    due++;
    if ((s.routineDone[k] || []).includes(r.id)) done++;
  }
  return { due, done, pct: due ? Math.round(done / due * 100) : 0 };
}

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
 * - finished tasks and daily-task ticks older than KEEP_HISTORY_DAYS are removed
 * Unfinished Today tasks stay in Today.
 */
export function rollover(s, now = new Date()) {
  const t = dayStr(now);
  if (s.lastRollover === t) return false;
  s.tasks.forEach(x => { if (x.list === 'nottoday') x.list = 'master'; });
  const cutoff = now.getTime() - KEEP_HISTORY_DAYS * DAY_MS;
  s.tasks = s.tasks.filter(x => !(x.list === 'done' && x.doneAt < cutoff));
  const oldest = dayStr(new Date(cutoff));
  Object.keys(s.routineDone).forEach(k => { if (k < oldest) delete s.routineDone[k]; });
  s.lastRollover = t;
  return true;
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

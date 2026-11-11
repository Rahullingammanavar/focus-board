// Focus Board UI: state, rendering and event handling.
// Pure logic lives in logic.js (unit tested), settings in config.js, sync in firebase-sync.js.
import {
  LOCAL_ONLY, LS_KEY, DAY_LETTERS, DAY_NAMES, AREA_COLORS, FREQ, IDEA_STATUS, LEARN_STATUS
} from './config.js';
import {
  dayStr, mondayStr, weekdayIndex, uid, esc, blank, normalize, rollover, daysLabel, nextNoteStatus,
  weekTarget, goalLogs, countSince, goalStreak, toggleLog, historyByDay, routineConsistency,
  isDay, quickDate, dateLabel, upcoming
} from './logic.js';
const $ = s => document.querySelector(s);
const today = () => dayStr();
const niceDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

let S = blank();
try { const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (c && c.v === 1) S = normalize(c); } catch (e) {}

const ui = { newDays: [0,1,2,3,4,5,6], tab: 'home', sheet: null, capSeg: 'realization', open: {}, sync: 'local', loaded: false };
try { const h = location.hash.slice(1); if (['home','capture','goals','history'].includes(h)) ui.tab = h; } catch (e) {}

/* ---------- saving ---------- */
let ref = null, saveTimer = null, saving = false, pending = false;
function save() {
  S.savedAt = Date.now();
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
  if (!ref) return;
  clearTimeout(saveTimer); setSync('saving');
  saveTimer = setTimeout(flush, 700);
}
async function flush() {
  if (!ref) return;
  if (saving) { pending = true; return; }
  saving = true;
  try { await ref.set({ savedAt: S.savedAt, state: JSON.stringify(S) }); setSync('cloud'); }
  catch (e) { setSync(e && e.code === 'quota_exceeded' ? 'full' : 'error'); }
  saving = false;
  if (pending) { pending = false; flush(); }
}
const SYNC = { cloud: 'Synced', saving: 'Saving…', local: 'On this device', loading: 'Loading…', error: 'Not synced yet', full: 'Storage full', stale: 'Offline' };
function setSync(s) { ui.sync = s; const el = $('#sync'); if (el) el.textContent = SYNC[s] || ''; }

let slowTimer = null;
function handleSnap(snap) {
  if (snap.metadata && snap.metadata.hasPendingWrites) return;
  if (!snap.metadata || !snap.metadata.fromCache) clearTimeout(slowTimer);
  if (snap.exists) {
    const d = snap.data();
    if (d && d.savedAt > S.savedAt) {
      try { const r = JSON.parse(d.state); if (r && r.v === 1) S = normalize(r); } catch (e) {}
      try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
    } else if (d && d.savedAt < S.savedAt) flush();
  } else if (S.savedAt) flush();
  if (ui.sync !== 'saving') setSync('cloud');
  const first = !ui.loaded; ui.loaded = true;
  if (first) afterLoad(); else render();
}
function snapError() { clearTimeout(slowTimer); setSync('error'); if (!ui.loaded) { ui.loaded = true; afterLoad(); } }
function startSlowTimer() { clearTimeout(slowTimer); slowTimer = setTimeout(() => { if (!ui.loaded) { setSync('stale'); ui.loaded = true; afterLoad(); } }, 10000); }

async function connect() {
  if (LOCAL_ONLY) { setSync('local'); ui.loaded = true; afterLoad(); return; }
  setSync('loading');
  try {
    const { startFirebase } = await import('./firebase-sync.js');
    const auth = await startFirebase({
      onSignedOut() { ref = null; ui.user = null; ui.needLogin = true; ui.loaded = true; setSync('local'); render(); },
      onSignedIn(user, store) {
        ui.user = user; ui.needLogin = false;
        try {
          const owner = localStorage.getItem(LS_KEY + '-uid');
          if (owner && owner !== user.uid) { S = blank(); localStorage.removeItem(LS_KEY); }
          localStorage.setItem(LS_KEY + '-uid', user.uid);
        } catch (e) {}
        ref = store; ui.loaded = false; setSync('loading'); startSlowTimer(); render();
      },
      onSnapshot: handleSnap,
      onError(err) { console.error(err); snapError(); toast('Sync error: ' + (err.code || err.message)); }
    });
    ui.signIn = () => auth.signIn().catch(e => toast('Sign-in failed: ' + (e.code || e.message)));
    ui.signOut = async () => { await auth.signOut(); ui.sheet = null; render(); };
  } catch (e) {
    console.error(e);
    setSync('stale'); ui.loaded = true; afterLoad();
    toast('Offline. Changes are saved on this device.');
  }
}

function afterLoad() { if (rollover(S)) save(); render(); }


/* ---------- actions ---------- */
let undoState = null, toastTimer = null;
function toast(msg, undo) {
  $('#toast-slot').innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${undo ? '<button data-act="undo">Undo</button>' : ''}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast-slot').innerHTML = ''; undoState = null; }, undo ? 5000 : 2200);
}
const task = id => S.tasks.find(x => x.id === id);
const open = () => S.tasks.filter(x => x.list !== 'done');
const inToday = () => S.tasks.filter(x => x.list === 'today');
const todayFull = () => inToday().length >= S.todayLimit;
function addTask(title, where, date = null) {
  title = title.trim(); if (!title) return;
  if (!isDay(date)) date = null;
  let list = where === 'today' ? 'today' : 'master';
  if (date) { list = date <= today() ? 'today' : 'master'; toast(list === 'today' ? 'Added to Today' : `Scheduled for ${dateLabel(date)}`); }
  else if (list === 'today' && todayFull()) { toast(`Today is full. Saved to All tasks.`); list = 'master'; }
  S.tasks.push({ id: uid(), title, size: 'M', list, week: where === 'week', steps: [], created: Date.now(), doneAt: null, date });
}
/* Scheduling. id '' means the task being typed in the sheet's add row. */
function setTaskDate(id, d) {
  if (!isDay(d)) return;
  ui.dateOpen = null;
  if (!id) { ui.newDate = d; renderKeep(); return; }
  const x = task(id); if (!x) return;
  x.date = d;
  let msg = `Scheduled for ${dateLabel(d)}`;
  if (x.list !== 'done') {
    // A date of today (or earlier) is a plan for today, so it goes in even past the limit.
    if (d <= today() && x.list !== 'today') { x.list = 'today'; msg = 'Added to Today'; }
    else if (d > today() && (x.list === 'today' || x.list === 'nottoday')) { x.list = 'master'; ui.open[id] = false; msg = `Moved to ${dateLabel(d)}`; }
  }
  save(); render(); toast(msg);
}
function clearTaskDate(id) {
  ui.dateOpen = null;
  if (!id) { ui.newDate = null; renderKeep(); return; }
  const x = task(id); if (!x) return;
  x.date = null; save(); render(); toast('Date removed');
}
/** Re-render without losing what is typed in the sheet's add box. */
function renderKeep() {
  const inp = ui.sheet && $(`#add-${ui.sheet}`), v = inp ? inp.value : '';
  render();
  const again = ui.sheet && $(`#add-${ui.sheet}`);
  if (again) { again.value = v; if (!ui.dateOpen) again.focus(); }
}
function pickToday(id) {
  const x = task(id); if (!x || x.list === 'today') return;
  if (todayFull()) { toast(`Today is full (${S.todayLimit}). Finish one first.`); return; }
  x.list = 'today'; save(); render(); toast('Added to Today');
}
function finish(id) {
  const x = task(id); if (!x || x.list === 'done') return;
  x.list = 'done'; x.doneAt = Date.now(); x.doneDay = today();
  const left = inToday().length;
  save(); render();
  toast(left ? `Done. ${left} left today.` : 'All done for today. Nice work!');
}
const routinesToday = () => S.routines.filter(r => r.days.includes(weekdayIndex()));
const routineDoneToday = id => (S.routineDone[today()] || []).includes(id);
const remember = () => { undoState = JSON.stringify(S); };

/* ---------- 5 minute timer ---------- */
let timer = null;
function openTimer(taskId) {
  timer = { end: Date.now() + 5 * 60e3, taskId, iv: setInterval(drawTimer, 500) };
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then(l => { if (timer) timer.lock = l; }).catch(() => {}); } catch (e) {}
  drawTimer();
}
function drawTimer() {
  if (!timer) return;
  const left = Math.max(0, timer.end - Date.now()), done = left === 0;
  if (done && timer.iv) { clearInterval(timer.iv); timer.iv = null; }
  const m = Math.floor(left / 60e3), s = Math.floor(left / 1000) % 60, x = timer.taskId ? task(timer.taskId) : null;
  $('#overlay-slot').innerHTML = `<div class="overlay" role="dialog" aria-label="Five minute timer"><div class="timer">
    <div class="eyebrow">${done ? 'You did it' : 'Just 5 minutes'}</div>
    <div class="clock">${m}:${String(s).padStart(2, '0')}</div>
    <p>${done ? 'Five minutes done. Stop here or keep going, both are fine.' : x ? esc(x.title) : 'Pick anything small and start. You can stop when the timer ends.'}</p>
    <div class="row-btns">${done
      ? `<button class="btn" data-act="timer-again">5 more minutes</button>${x && x.list !== 'done' ? '<button class="btn ghost" data-act="timer-finish">Mark done</button>' : ''}<button class="btn ghost" data-act="timer-close">Close</button>`
      : '<button class="btn ghost" data-act="timer-close">Stop</button>'}</div></div></div>`;
}
function closeTimer() { if (timer) { clearInterval(timer.iv); try { timer.lock && timer.lock.release(); } catch (e) {} } timer = null; $('#overlay-slot').innerHTML = ''; }

/* ---------- render ---------- */
const ICONS = {
  home: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.5L16 9.5"/></svg>',
  capture: '<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z"/><path d="M9.5 20.5h5"/></svg>',
  goals: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>'
};
const TAB_NAMES = { home: 'Today', capture: 'Capture', goals: 'Goals', history: 'History' };
const head = (eyebrow, title, sub) => `<div class="eyebrow"><span>${esc(eyebrow)}</span><span class="sync" id="sync">${SYNC[ui.sync] || ''}</span></div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}`;

function loginView() {
  return `<div style="min-height:70vh;display:grid;place-items:center;text-align:center"><div style="display:grid;gap:14px;justify-items:center;max-width:320px">
    <div style="width:56px;height:56px;border-radius:16px;background:var(--accent);display:grid;place-items:center"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12.5l3.2 3L17 8.5"/></svg></div>
    <h1 style="margin:0">Focus Board</h1>
    <p class="sub" style="margin:0">Your private daily planner. Sign in so your tasks sync across your phone and laptop.</p>
    <button class="btn" data-act="sign-in" style="padding:12px 20px;margin-top:6px">Continue with Google</button>
    <p class="meta">Only you can see your data.</p></div></div>`;
}
function render() {
  if (!LOCAL_ONLY && ui.needLogin) { $('#tabs').innerHTML = ''; $('#view').innerHTML = loginView(); $('#sheet-slot').innerHTML = ''; return; }
  $('#tabs').innerHTML = Object.keys(TAB_NAMES).map(k => `<button data-tab="${k}" ${ui.tab === k ? 'aria-current="page"' : ''}>${ICONS[k]}<span>${TAB_NAMES[k]}</span></button>`).join('');
  $('#view').innerHTML = ({ home: viewHome, capture: viewCapture, goals: viewGoals, history: viewHistory })[ui.tab]();
  renderSheet();
}

const CAL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
/** Small date tag. `hideToday` skips the tag when it would only say "Today". */
function dateTag(d, hideToday) {
  if (!isDay(d)) return '';
  const l = dateLabel(d);
  if (hideToday && l === 'Today') return '';
  return `<span class="tag${l === 'Overdue' ? ' overdue' : ''}" title="${esc(d)}">${esc(l)}</span>`;
}
/** Quick date chips. id '' = the new task in the add row. */
function datePicker(id) {
  const cur = id ? (task(id) || {}).date : ui.newDate;
  const chips = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['weekend', 'This weekend'], ['nextweek', 'Next week']];
  return `<div class="date-pick" role="group" aria-label="Choose a date">
    ${chips.map(([k, l]) => { const d = quickDate(k); return `<button type="button" class="chip" data-act="set-date" data-id="${id}" data-q="${k}" aria-pressed="${cur === d}" title="${esc(d)}">${l}</button>`; }).join('')}
    <label class="chip date-chip">Pick a date<input type="date" data-date-for="${id}" value="${isDay(cur) ? cur : ''}" aria-label="Pick a date"></label>
    ${cur ? `<button type="button" class="chip muted" data-act="date-clear" data-id="${id}">Remove date</button>` : ''}
  </div>`;
}

function todayRow(x) {
  const o = ui.open[x.id], sd = x.steps.filter(s => s.done).length;
  const meta = [dateTag(x.date, true), x.week ? 'Weekly goal' : '', x.steps.length ? `${sd} of ${x.steps.length} steps` : ''].filter(Boolean).join(' · ');
  return `<div class="row-wrap">
    <div class="row">
      <button class="check" data-act="finish" data-id="${x.id}" aria-label="Mark done: ${esc(x.title)}"></button>
      <div class="row-body"><div class="title">${esc(x.title)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
      <button class="icon-btn" data-act="toggle" data-id="${x.id}" aria-expanded="${!!o}" aria-label="Options">${o ? '⌃' : '⋯'}</button>
    </div>
    ${o ? `<div class="expand">
      ${x.steps.length ? `<div class="steps">${x.steps.map(s => `<div class="step ${s.done ? 'done' : ''}"><button class="check ${s.done ? 'on' : ''}" data-act="step" data-id="${x.id}" data-step="${s.id}" aria-label="Step: ${esc(s.t)}"></button><span>${esc(s.t)}</span></div>`).join('')}</div>` : ''}
      <form data-form="step" data-id="${x.id}" style="display:flex"><input class="inline-input" id="step-${x.id}" name="t" type="text" placeholder="+ Add a small step" autocomplete="off" style="font-size:14px"></form>
      <div class="textlinks">
        <button class="tl" data-act="five" data-id="${x.id}">5 min timer</button>
        <button class="tl" data-act="date-open" data-id="${x.id}" aria-expanded="${ui.dateOpen === x.id}">${x.date ? 'Change date' : 'Set date'}</button>
        ${x.date && ui.dateOpen !== x.id ? `<button class="tl muted" data-act="date-clear" data-id="${x.id}">Remove date</button>` : ''}
        <button class="tl muted" data-act="not-today" data-id="${x.id}">Not today</button>
        <button class="tl muted" data-act="unpick" data-id="${x.id}">Remove</button>
      </div>
      ${ui.dateOpen === x.id ? datePicker(x.id) : ''}</div>` : ''}
  </div>`;
}

function viewHome() {
  const list = inToday(), t = today();
  const done = S.tasks.filter(x => x.list === 'done' && x.doneDay === t).sort((a, b) => b.doneAt - a.doneAt);
  const skipped = S.tasks.filter(x => x.list === 'nottoday');
  const total = list.length + done.length;
  const weekCount = open().filter(x => x.week && x.list !== 'today').length;
  const allCount = open().filter(x => x.list !== 'today').length;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const rows = list.map(todayRow).join('');
  const addRow = todayFull() ? '' : `<form class="row add-row" data-form="task" data-where="today"><span class="plus" aria-hidden="true">+</span><input class="inline-input" id="add-today" name="t" type="text" placeholder="Add a task for today" autocomplete="off" aria-label="Add a task for today"></form>`;
  return `${head(date, 'Today')}
    ${total ? `<div class="progress"><div class="progress-top"><span><b class="num">${done.length}</b> of <span class="num">${total}</span> done</span><span class="num">${list.length}/${S.todayLimit} spots</span></div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done.length}" aria-label="Done today"><i style="width:${done.length / total * 100}%"></i></div></div>` : ''}
    <div class="pickers">
      <button class="picker" data-sheet="week">Weekly goals <span class="n num">${weekCount}</span></button>
      <button class="picker" data-sheet="all">All tasks <span class="n num">${allCount}</span></button>
    </div>
    ${routineSection()}
    <h2><span>To do</span></h2>
    <div class="group">
      ${list.length ? rows : `<div class="empty"><b>Nothing planned yet</b>Pick 3 to 5 tasks from Weekly goals or All tasks.</div>`}
      ${addRow}
    </div>
    <button class="stuck" data-act="five">Feeling stuck? <b>Start a 5 minute timer</b></button>
    ${comingUp()}
    ${done.length ? `<h2><span>Done</span><span class="num">${done.length}</span></h2><div class="group">${done.map(x => `<div class="row done"><button class="check on" data-act="undone" data-id="${x.id}" aria-label="Undo: ${esc(x.title)}"></button><div class="row-body"><div class="title">${esc(x.title)}</div></div></div>`).join('')}</div>` : ''}
    ${skipped.length ? `<h2><span>Not today</span><span>Back in All tasks tomorrow</span></h2><div class="group">${skipped.map(x => `<div class="row"><div class="row-body"><div class="title">${esc(x.title)}</div></div><button class="pill plain" data-act="pick" data-id="${x.id}">Do today</button></div>`).join('')}</div>` : ''}
    <div class="limit"><span>Backup and settings</span><button class="pill plain" data-sheet="settings">Open</button></div>
    <div class="limit" style="margin-top:14px"><span>Max tasks per day</span><div class="seg" role="group" aria-label="Max tasks per day">${[3, 4, 5].map(n => `<button data-limit="${n}" aria-pressed="${S.todayLimit === n}">${n}</button>`).join('')}</div></div>`;
}

/* Unfinished dated tasks for the next 7 days, grouped by day label. Hidden when empty. */
function comingUp() {
  const all = upcoming(S), MAX = 5;
  if (!all.length) return '';
  let last = null;
  const rows = all.slice(0, MAX).map(x => {
    const l = dateLabel(x.date), headRow = l !== last ? `<div class="day-head">${esc(l)}</div>` : '';
    last = l;
    return `${headRow}<div class="row"><div class="row-body"><div class="title">${esc(x.title)}</div>${x.week ? '<div class="meta">Weekly goal</div>' : ''}</div><button class="pill" data-act="pick" data-id="${x.id}">+ Today</button></div>`;
  }).join('');
  const more = all.length - MAX;
  return `<h2><span>Coming up</span><span>Next 7 days</span></h2>
    <div class="group coming">${rows}${more > 0 ? `<button class="row more" data-sheet="all">${more} more in All tasks ›</button>` : ''}</div>`;
}

function routineSection() {
  const rs = routinesToday();
  if (!S.routines.length) return `<h2><span>Daily tasks</span></h2><div class="group"><button class="row add-row" data-sheet="routine" style="width:100%;border:0;background:none;text-align:left"><span class="plus" aria-hidden="true">+</span><span style="color:var(--faint)">Set up tasks that repeat on certain days</span></button></div>`;
  const doneN = rs.filter(r => routineDoneToday(r.id)).length;
  return `<h2><span>Daily tasks${rs.length ? ` · <span class="num">${doneN}/${rs.length}</span>` : ''}</span><button class="h2-link" data-sheet="routine">Edit</button></h2>
    <div class="group">${rs.length ? rs.map(r => { const d = routineDoneToday(r.id); return `<div class="row ${d ? 'done' : ''}"><button class="check ${d ? 'on' : ''}" data-act="routine-check" data-id="${r.id}" aria-label="${d ? 'Undo' : 'Mark done'}: ${esc(r.title)}"></button><div class="row-body"><div class="title">${esc(r.title)}</div></div></div>`; }).join('')
      : '<div class="empty">No daily tasks set for today.</div>'}</div>`;
}
function renderRoutineSheet(slot, scroll) {
  const chips = (days, id) => `<div class="days" role="group" aria-label="Days">${DAY_LETTERS.map((l, i) => `<button type="button" class="day ${id ? 'sm' : ''}" data-act="${id ? 'day-toggle' : 'new-day'}" ${id ? `data-id="${id}"` : ''} data-day="${i}" aria-pressed="${days.includes(i)}" aria-label="${DAY_NAMES[i]}">${l}</button>`).join('')}</div>`;
  slot.innerHTML = `<div class="sheet-wrap" data-act="close-sheet"><div class="sheet${ui.sheetAnim ? ' anim' : ''}" role="dialog" aria-modal="true" aria-label="Daily tasks">
    <div class="grab"></div>
    <div class="sheet-head"><h1>Daily tasks</h1><button class="done-btn" data-act="close-sheet">Done</button></div>
    <p class="sub" style="margin:0 0 16px">Tasks that repeat. Tap the days each one should show up on Today. They stay out of All tasks.</p>
    <div class="group">
      ${S.routines.map(r => `<div class="row" style="flex-wrap:wrap;row-gap:10px">
        <div class="row-body" style="flex-basis:60%"><div class="title">${esc(r.title)}</div><div class="meta">${daysLabel(r.days)}</div></div>
        <button class="icon-btn" data-act="del-routine" data-id="${r.id}" aria-label="Delete daily task">×</button>
        <div style="flex-basis:100%">${chips(r.days, r.id)}</div></div>`).join('')}
      <form class="routine-add" data-form="routine">
        <div class="top"><span class="plus" style="color:var(--accent);font-size:20px" aria-hidden="true">+</span><input class="inline-input" id="add-routine" name="t" type="text" placeholder="New daily task, e.g. Drink water" autocomplete="off"></div>
        ${chips(ui.newDays)}
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="meta">${ui.newDays.length ? daysLabel(ui.newDays) : 'Pick at least one day'}</span><button class="btn">Add</button></div>
      </form>
    </div>
  </div></div>`;
  slot.querySelector('.sheet').scrollTop = scroll;
  ui.sheetAnim = false;
}
function renderSettingsSheet(slot) {
  const n = S.tasks.length + S.notes.length + S.goals.length + S.routines.length;
  const size = Math.round(JSON.stringify(S).length / 1024);
  slot.innerHTML = `<div class="sheet-wrap" data-act="close-sheet"><div class="sheet${ui.sheetAnim ? ' anim' : ''}" role="dialog" aria-modal="true" aria-label="Backup and settings">
    <div class="grab"></div>
    <div class="sheet-head"><h1>Backup and settings</h1><button class="done-btn" data-act="close-sheet">Done</button></div>
    ${!LOCAL_ONLY && ui.user ? `<h2><span>Account</span></h2><div class="group"><div class="row"><div class="row-body"><div class="title">${esc(ui.user.name || 'Signed in')}</div><div class="meta">${esc(ui.user.email)}</div></div><button class="pill plain" data-act="sign-out">Sign out</button></div></div>` : ''}
    <h2><span>Export</span><span class="num">${n} items · ${size} KB</span></h2>
    <div class="group"><div class="row"><div class="row-body"><div class="title">Copy all my data</div><div class="meta">Copies everything as text. Paste it into Import on another version to move your data.</div></div><button class="pill" data-act="export">Copy</button></div>
      ${ui.exportShown ? `<div style="padding:0 14px 14px"><textarea id="export-text" readonly style="width:100%;min-height:90px;border:1px solid var(--line);border-radius:10px;padding:8px;font-size:12px">${esc(JSON.stringify(S))}</textarea></div>` : ''}</div>
    <h2><span>Import</span></h2>
    <div class="group"><div style="padding:14px;display:grid;gap:10px">
      <textarea id="import-text" placeholder="Paste copied data here" style="width:100%;min-height:90px;border:1px solid var(--line);border-radius:10px;padding:8px;font-size:12px"></textarea>
      <div class="meta">Importing replaces everything in this app with the pasted data.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">${ui.importConfirm ? '<button class="pill plain" data-act="import-cancel">Cancel</button><button class="btn" data-act="import-yes">Yes, replace my data</button>' : '<button class="btn" data-act="import">Import</button>'}</div>
    </div></div>
  </div></div>`;
  ui.sheetAnim = false;
}
function renderSheet() {
  const slot = $('#sheet-slot');
  if (!ui.sheet) { slot.innerHTML = ''; return; }
  const scroll = slot.querySelector('.sheet')?.scrollTop || 0;
  if (ui.sheet === 'routine') return renderRoutineSheet(slot, scroll);
  if (ui.sheet === 'settings') return renderSettingsSheet(slot);
  const isWeek = ui.sheet === 'week';
  const rows = open().filter(x => isWeek ? x.week : true).sort((a, b) => (a.list === 'today') - (b.list === 'today') || a.created - b.created);
  const row = x => `<div class="row-wrap"><div class="row">
      <div class="row-body"><div class="title">${esc(x.title)}</div><div class="meta meta-line">${dateTag(x.date)}${!isWeek && x.week ? '<span>Weekly goal</span>' : ''}<button class="tl sm" data-act="date-open" data-id="${x.id}" aria-expanded="${ui.dateOpen === x.id}">${x.date ? 'Change date' : 'Set date'}</button></div></div>
      ${x.list === 'today' ? '<span class="in-today">In Today ✓</span>' : `<button class="pill" data-act="pick" data-id="${x.id}">+ Today</button>`}
      ${isWeek ? `<button class="icon-btn" data-act="off-week" data-id="${x.id}" aria-label="Remove from weekly goals" title="Remove from week">−</button>`
               : `${x.week ? '' : `<button class="pill plain" data-act="to-week" data-id="${x.id}">+ Week</button>`}<button class="icon-btn" data-act="del-task" data-id="${x.id}" aria-label="Delete task" title="Delete">×</button>`}
    </div>${ui.dateOpen === x.id ? datePicker(x.id) : ''}</div>`;
  const empty = `<div class="empty"><b>${isWeek ? 'No weekly goals yet' : 'No tasks yet'}</b>${isWeek ? 'Add one below, or tap + Week in All tasks.' : 'Add everything on your mind below.'}</div>`;
  const addRow = `<form class="row add-row" data-form="task" data-where="${isWeek ? 'week' : 'all'}"><span class="plus" aria-hidden="true">+</span><input class="inline-input" id="add-${ui.sheet}" name="t" type="text" placeholder="${isWeek ? 'Add a weekly goal' : 'Add a task'}" autocomplete="off">${dateTag(ui.newDate)}<button type="button" class="icon-btn cal${ui.newDate ? ' on' : ''}" data-act="date-open" data-id="" aria-expanded="${ui.dateOpen === 'new'}" aria-label="${ui.newDate ? 'Change date' : 'Set a date'}" title="Set a date">${CAL}</button></form>${ui.dateOpen === 'new' ? `<div class="add-pick">${datePicker('')}</div>` : ''}`;
  // All tasks: dated tasks first (by date), then the rest. Weekly goals keep one list.
  const dated = isWeek ? [] : rows.filter(x => x.date).sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  const undated = isWeek ? rows : rows.filter(x => !x.date);
  const body = dated.length
    ? `<h2 style="margin-top:4px"><span>Scheduled</span><span class="num">${dated.length}</span></h2><div class="group">${dated.map(row).join('')}</div>
       <h2><span>No date</span><span class="num">${undated.length}</span></h2><div class="group">${undated.map(row).join('')}${addRow}</div>`
    : `<div class="group">${undated.map(row).join('') || empty}${addRow}</div>`;
  slot.innerHTML = `<div class="sheet-wrap" data-act="close-sheet"><div class="sheet${ui.sheetAnim ? ' anim' : ''}" role="dialog" aria-modal="true" aria-label="${isWeek ? 'Weekly goals' : 'All tasks'}">
    <div class="grab"></div>
    <div class="sheet-head"><h1>${isWeek ? 'Weekly goals' : 'All tasks'}</h1><button class="done-btn" data-act="close-sheet">Done</button></div>
    <p class="sub" style="margin:0 0 16px">${isWeek ? 'What you want to finish this week.' : 'Everything on your plate.'} Today: ${inToday().length} of ${S.todayLimit} picked.</p>
    ${body}
  </div></div>`;
  slot.querySelector('.sheet').scrollTop = scroll;
  ui.sheetAnim = false;
}

const CAP = {
  realization: ['Realizations', 'What did you realize?'],
  idea: ['Ideas', 'Write your idea'],
  learn: ['Learn', 'What do you want to learn?']
};
function viewCapture() {
  const seg = ui.capSeg, c = CAP[seg];
  const rows = S.notes.filter(n => n.kind === seg).sort((a, b) => b.created - a.created);
  const status = seg === 'idea' ? IDEA_STATUS : LEARN_STATUS;
  return `${head('Write it down', 'Capture', 'Get thoughts out of your head before they slip away.')}
    <div class="seg" role="group" aria-label="Capture type" style="margin-top:20px">${Object.keys(CAP).map(k => `<button data-cseg="${k}" aria-pressed="${seg === k}">${CAP[k][0]}</button>`).join('')}</div>
    <form class="composer" data-form="note"><textarea id="add-note-${seg}" name="t" placeholder="${c[1]}" aria-label="${c[1]}"></textarea><div class="bar-row"><button class="btn">Save</button></div></form>
    ${rows.length ? `<h2><span>${c[0]}</span><span class="num">${rows.length}</span></h2><div class="group">${rows.map(n => `<div class="row" style="align-items:flex-start">
      <div class="row-body"><div class="note-text">${esc(n.text)}</div>
        <div class="meta" style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px"><span>${niceDate(n.created)}</span>
          ${seg !== 'realization' ? `<button class="tl" data-act="cycle" data-id="${n.id}" title="Tap to change status">${status[n.status] || (seg === 'idea' ? 'New' : 'Want to learn')} ›</button>` : ''}
          <button class="tl" data-act="to-task" data-id="${n.id}">Make task</button>
          <button class="tl muted" data-act="del-note" data-id="${n.id}">Delete</button></div></div></div>`).join('')}</div>`
      : `<div class="empty" style="margin-top:12px">Your ${c[0].toLowerCase()} will show up here.</div>`}`;
}
function monthChart(map) {
  const N = 30, rows = Array.from({ length: N }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (N - 1) + i);
    const k = dayStr(d), items = map[k] || [];
    return { k, d, tasks: items.filter(x => x.kind === 'Task').length, daily: items.filter(x => x.kind === 'Daily').length };
  });
  const totals = rows.map(r => r.tasks + r.daily), total = totals.reduce((a, b) => a + b, 0);
  const best = Math.max(0, ...totals), active = totals.filter(n => n > 0).length;
  const stats = `<div class="stats"><div class="stat"><b>${total}</b><span>done in 30 days</span></div><div class="stat"><b>${active}</b><span>active days</span></div><div class="stat"><b>${best}</b><span>best day</span></div></div>`;
  if (!total) return stats + `<div class="card"><div class="card-title">Last 30 days</div><div class="empty" style="padding:20px 8px">Finish a task or a daily task and your chart will start here.</div></div>`;
  const W = 340, H = 150, L = 22, R = 4, T = 8, B = 20, pw = W - L - R, ph = H - T - B;
  const step = Math.max(1, Math.ceil(best / 3)), top = step * 3, y = v => T + ph - v / top * ph;
  const slot = pw / N, bw = Math.max(3, slot - 3);
  const roundTop = (x, y0, w, h) => { const r = Math.min(3, w / 2, h); return `M${x},${y0 + h}V${y0 + r}Q${x},${y0} ${x + r},${y0}H${x + w - r}Q${x + w},${y0} ${x + w},${y0 + r}V${y0 + h}Z`; };
  const grid = [0, 1, 2, 3].map(i => { const v = i * step, yy = y(v); return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-width="1"${i ? ' stroke-dasharray="2 3"' : ''}/><text x="${L - 6}" y="${yy + 3}" text-anchor="end">${v}</text>`; }).join('');
  const bars = rows.map((r, i) => {
    const x = L + i * slot + (slot - bw) / 2, tot = r.tasks + r.daily;
    let out = `<rect class="hl" x="${L + i * slot}" y="${T}" width="${slot}" height="${ph}" rx="3" data-i="${i}"/>`;
    if (tot) {
      const hT = r.tasks / top * ph, hD = r.daily / top * ph, base = T + ph;
      const gap = r.tasks && r.daily ? 2 : 0;
      if (r.tasks) out += r.daily ? `<rect x="${x}" y="${base - hT}" width="${bw}" height="${hT}" fill="var(--accent)"/>` : `<path d="${roundTop(x, base - hT, bw, hT)}" fill="var(--accent)"/>`;
      if (r.daily) out += `<path d="${roundTop(x, base - hT - hD, bw, Math.max(1, hD - gap))}" fill="var(--daily)"/>`;
    }
    const lbl = r.d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    return out;
  }).join('');
  const hits = rows.map((r, i) => `<rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${ph + B}" data-tip="${i}"/>`).join('');
  const xl = [0, 14, 29].map(i => `<text x="${L + i * slot + slot / 2}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === 29 ? 'end' : 'middle'}">${i === 29 ? 'Today' : rows[i].d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>`).join('');
  ui.charts = ui.charts || {};
  ui.charts['month-card'] = rows.map((r, i) => ({ tip: `<b>${i === N - 1 ? 'Today' : r.d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b><br>${r.tasks} ${r.tasks === 1 ? 'task' : 'tasks'} · ${r.daily} daily` }));
  return stats + `<div class="card" id="month-card"><div class="card-head"><div class="card-title">Last 30 days</div>
      <div class="legend"><span><i style="background:var(--accent)"></i>Tasks</span><span><i style="background:var(--daily)"></i>Daily tasks</span></div></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Things done per day over the last 30 days, ${total} in total, best day ${best}">${grid}${bars}${xl}${hits}</svg></div>`;
}
function routineChart() {
  if (!S.routines.length) return '';
  const rows = S.routines.map(r => Object.assign({ r }, routineConsistency(S, r)))
.sort((a, b) => b.pct - a.pct);
  return `<div class="card"><div class="card-head"><div class="card-title">Daily task consistency</div><div class="legend">last 30 days</div></div>
    <div style="margin-top:8px">${rows.map(x => `<div class="hbar"><div class="title">${esc(x.r.title)}</div><div class="val">${x.pct}% <span>· ${x.done}/${x.due} days</span></div><div class="track" role="img" aria-label="${x.pct} percent"><i style="width:${x.pct}%"></i></div></div>`).join('')}</div></div>`;
}
function showTip(card, i) {
  const rows = (ui.charts || {})[card.id]; if (!rows || !rows[i]) return;
  card.querySelectorAll('.hl').forEach(h => h.classList.toggle('on', h.dataset.i === String(i)));
  const hit = card.querySelector(`.hit[data-tip="${i}"]`), cr = card.getBoundingClientRect(), hr = hit.getBoundingClientRect();
  let tip = card.querySelector('.tip'); if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; card.appendChild(tip); }
  tip.innerHTML = rows[i].tip;
  const x = Math.min(Math.max(hr.left - cr.left + hr.width / 2, 60), cr.width - 60);
  tip.style.left = x + 'px'; tip.style.top = (hr.top - cr.top - 6) + 'px';
}
function hideTip() { document.querySelectorAll('.card .tip').forEach(t => t.remove()); document.querySelectorAll('.hl.on').forEach(h => h.classList.remove('on')); }
document.addEventListener('pointerover', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t.closest('.card'), +t.dataset.tip); });
document.addEventListener('pointerout', e => { if (e.target.closest && e.target.closest('[data-tip]') && e.pointerType === 'mouse') hideTip(); });
document.addEventListener('pointerdown', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t) { hideTip(); showTip(t.closest('.card'), +t.dataset.tip); } else hideTip(); });

/* Single-series bar chart. rows: [{v, tip, tick?}] */
function barChart(id, title, sub, rows, ariaLabel) {
  const N = rows.length, max = Math.max(0, ...rows.map(r => r.v));
  const W = 340, H = 140, L = 22, R = 4, T = 8, B = 20, pw = W - L - R, ph = H - T - B;
  const step = Math.max(1, Math.ceil(max / 3)), top = step * 3, y = v => T + ph - v / top * ph;
  const slot = pw / N, bw = Math.max(3, Math.min(22, slot - 3));
  const roundTop = (x, y0, w, h) => { const r = Math.min(3, w / 2, h); return `M${x},${y0 + h}V${y0 + r}Q${x},${y0} ${x + r},${y0}H${x + w - r}Q${x + w},${y0} ${x + w},${y0 + r}V${y0 + h}Z`; };
  const grid = [0, 1, 2, 3].map(i => { const v = i * step, yy = y(v); return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="var(--line)"${i ? ' stroke-dasharray="2 3"' : ''}/><text x="${L - 6}" y="${yy + 3}" text-anchor="end">${v}</text>`; }).join('');
  const bars = rows.map((r, i) => { const x = L + i * slot + (slot - bw) / 2, h = r.v / top * ph;
    return `<rect class="hl" x="${L + i * slot}" y="${T}" width="${slot}" height="${ph}" rx="3" data-i="${i}"/>${r.v ? `<path d="${roundTop(x, T + ph - h, bw, h)}" fill="var(--accent)"/>` : ''}`; }).join('');
  const ticks = rows.map((r, i) => r.tick ? `<text x="${L + i * slot + slot / 2}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === N - 1 ? 'end' : 'middle'}">${esc(r.tick)}</text>` : '').join('');
  const hits = rows.map((r, i) => `<rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${ph + B}" data-tip="${i}"/>`).join('');
  ui.charts = ui.charts || {}; ui.charts[id] = rows;
  return `<div class="card" id="${id}"><div class="card-head"><div class="card-title">${title}</div><div class="legend">${sub}</div></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">${grid}${bars}${ticks}${hits}</svg></div>`;
}

function viewHistory() {
  const map = historyByDay(S), t = today();
  const strip = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; }).map(d => {
    const k = dayStr(d), n = (map[k] || []).length;
    return `<div class="wd ${n ? 'has' : ''} ${k === t ? 'today' : ''}"><span>${d.toLocaleDateString(undefined, { weekday: 'narrow' })}</span><b>${n}</b></div>`;
  }).join('');
  const days = Object.keys(map).sort().reverse();
  const weekTotal = Array.from({ length: 7 }, (_, i) => (map[dayStr(new Date(Date.now() - i * 864e5))] || []).length).reduce((a, b) => a + b, 0);
  const label = k => k === t ? 'Today' : k === dayStr(new Date(Date.now() - 864e5)) ? 'Yesterday' : new Date(k + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  return `${head('What you got done', 'History', `<span class="num">${weekTotal}</span> ${weekTotal === 1 ? 'thing' : 'things'} done in the last 7 days.`)}
    <div class="week" aria-label="Things done each day, last 7 days">${strip}</div>
    ${monthChart(map)}
    ${routineChart()}
    ${days.length ? days.map(k => `<h2><span>${label(k)}</span><span class="num">${map[k].length} done</span></h2><div class="group">${map[k].sort((a, b) => b.t - a.t).map(it => `<div class="row"><span class="check on" aria-hidden="true" style="width:20px;height:20px"></span><div class="row-body"><div class="title">${esc(it.title)}</div></div><span class="kind">${it.kind}</span></div>`).join('')}</div>`).join('')
      : '<div class="empty" style="margin-top:20px"><b>Nothing here yet</b>Tasks and daily tasks you finish will show up here, day by day.</div>'}
    <p class="sub" style="margin-top:24px;font-size:12px">History keeps the last 90 days.</p>`;
}
const goalById = id => S.goals.find(g => g.id === id);
const loggedOn = (g, aid, k) => (goalLogs(g)[k] || []).includes(aid);
function areaColor(a) { const i = S.areas.indexOf(a); return AREA_COLORS[(i < 0 ? S.areas.length : i) % AREA_COLORS.length]; }
function tfLabel(g) { const d = new Date(g.created || Date.now()); return g.scope === 'month' ? d.toLocaleDateString(undefined, { month: 'long' }) : String(d.getFullYear()); }

function viewGoals() {
  if (ui.goalView === 'history') return viewGoalHistory();
  if (ui.goalId && goalById(ui.goalId)) return viewGoalDetail(goalById(ui.goalId));
  S.goals.forEach(g => { if (!g.area) g.area = 'Personal'; });
  const areas = S.areas.slice();
  S.goals.forEach(g => { if (!areas.includes(g.area)) areas.push(g.area); });
  const groups = areas.map((a, i) => {
    const rows = S.goals.filter(g => g.area === a).sort((x, y) => (x.done - y.done) || (x.scope === 'year' ? -1 : 1) || x.created - y.created);
    const done = rows.filter(g => g.done).length;
    return `<div class="area-head"><div class="area-name"><span class="area-dot" style="background:${areaColor(a)}"></span>${esc(a)}</div>
        <div style="display:flex;align-items:center;gap:6px">${rows.length ? `<span class="area-count">${done} of ${rows.length} done</span>` : `<button class="icon-btn" data-act="del-area" data-area="${esc(a)}" aria-label="Remove ${esc(a)}" title="Remove area">×</button>`}</div></div>
      <div class="group">
        ${rows.map(g => { const acts = (g.actions || []).length, wk = countSince(g, null, mondayStr());
          return `<div class="row ${g.done ? 'done' : ''}"><button class="check ${g.done ? 'on' : ''}" data-act="goal" data-id="${g.id}" aria-label="Mark goal achieved"></button>
          <button class="row-body goal-open" data-goal="${g.id}"><div class="title">${esc(g.text)}</div><div class="meta">${g.done ? `Achieved${g.doneAt ? ' ' + niceDate(g.doneAt) : ''}` : acts ? `${acts} ${acts === 1 ? 'step' : 'steps'} · ${wk} done this week` : 'Tap to plan the steps'}</div></button>
          <span class="tf">${tfLabel(g)}</span><span class="chev" aria-hidden="true">›</span></div>`; }).join('')}
        <form class="row add-row" data-form="goal" data-area="${esc(a)}"><span class="plus" aria-hidden="true">+</span><input class="inline-input" id="add-goal-${i}" name="t" type="text" placeholder="Add a ${esc(a.toLowerCase())} goal" autocomplete="off"><select class="scope" name="scope" aria-label="Timeframe"><option value="year">This year</option><option value="month">This month</option></select></form>
      </div>`;
  }).join('');
  return `<div class="eyebrow"><span>The big picture</span><span class="sync" id="sync">${SYNC[ui.sync] || ''}</span></div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h1>Goals</h1><button class="pill plain" data-act="goal-history">History</button></div>
    <p class="sub">Your goals by area of life. Tap a goal to plan what to do and track it.</p>` + groups +
    `<div class="group" style="margin-top:28px"><form class="row add-row" data-form="area"><span class="plus" aria-hidden="true">+</span><input class="inline-input" id="add-area" name="t" type="text" placeholder="Add an area, e.g. Family or Skills" autocomplete="off" maxlength="30"></form></div>`;
}

function viewGoalDetail(g) {
  const acts = g.actions = g.actions || [];
  const mon = mondayStr(), t = today();
  const thirty = dayStr(new Date(Date.now() - 29 * 864e5));
  const wk = countSince(g, null, mon), month = countSince(g, null, thirty), total = countSince(g, null, '0');
  const rows = Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 29 + i); const k = dayStr(d), n = (goalLogs(g)[k] || []).length;
    const ids = goalLogs(g)[k] || [], names = acts.filter(a => ids.includes(a.id)).map(a => esc(a.title));
    return { v: n, tick: i === 0 || i === 14 ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : i === 29 ? 'Today' : '', tip: `<b>${i === 29 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b><br>${n ? names.join(', ') || n + ' done' : 'Nothing logged'}` }; });
  const repeat = acts.filter(a => a.freq !== 'once'), once = acts.filter(a => a.freq === 'once');
  const onceDone = once.filter(a => a.done).length;
  const actRow = a => {
    const tgt = weekTarget(a), n = countSince(g, a.id, mon), on = loggedOn(g, a.id, t), pct = Math.min(100, Math.round(n / tgt * 100));
    return `<div class="row" style="flex-wrap:wrap;row-gap:8px">
      <button class="check ${on ? 'on' : ''}" data-act="ga-log" data-id="${a.id}" aria-label="${on ? 'Undo today' : 'Did it today'}: ${esc(a.title)}"></button>
      <div class="row-body"><div class="title">${esc(a.title)}</div><div class="meta">${FREQ[a.freq]} · <span class="num">${n}/${tgt}</span> this week · <span class="num">${countSince(g, a.id, '0')}</span> total</div></div>
      <button class="icon-btn" data-act="ga-del" data-id="${a.id}" aria-label="Delete step">×</button>
      <div class="track" style="flex-basis:100%;margin-left:36px"><i style="width:${pct}%;${n >= tgt ? 'background:#16A34A' : ''}"></i></div></div>`;
  };
  const freqSel = `<select class="scope" name="freq" aria-label="How often">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`;
  return `<button class="tl" data-act="goal-back" style="margin-bottom:14px">‹ All goals</button>
    <div class="eyebrow"><span style="display:flex;align-items:center;gap:6px"><span class="area-dot" style="background:${areaColor(g.area)}"></span>${esc(g.area)} · ${g.scope === 'month' ? 'This month' : 'This year'}</span><span class="sync" id="sync">${SYNC[ui.sync] || ''}</span></div>
    <h1>${esc(g.text)}</h1>
    <div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap">
      <button class="pill ${g.done ? '' : 'plain'}" data-act="goal" data-id="${g.id}">${g.done ? '✓ Achieved' : 'Mark as achieved'}</button>
      ${g.done && g.doneAt ? `<span class="meta">on ${niceDate(g.doneAt)}</span>` : ''}
    </div>
    <div class="stats"><div class="stat"><b>${wk}</b><span>this week</span></div><div class="stat"><b>${month}</b><span>last 30 days</span></div><div class="stat"><b>${goalStreak(g)}</b><span>day streak</span></div></div>
    <h2><span>Do regularly</span><span>Tick when you do it today</span></h2>
    <div class="group">
      ${repeat.map(actRow).join('') || '<div class="empty" style="padding:18px">What will you do daily or weekly to reach this goal? Add it below.</div>'}
      <form class="row add-row" data-form="gaction" data-kind="repeat" style="flex-wrap:wrap"><span class="plus" aria-hidden="true">+</span><input class="inline-input" id="ga-repeat" name="t" type="text" placeholder="e.g. Walk 30 minutes" autocomplete="off"><select class="scope" name="freq" aria-label="How often">${['daily','w1','w2','w3','w4','w5'].map(k => `<option value="${k}">${FREQ[k]}</option>`).join('')}</select></form>
    </div>
    <h2><span>Steps to finish</span>${once.length ? `<span class="num">${onceDone} of ${once.length}</span>` : ''}</h2>
    <div class="group">
      ${once.map(a => `<div class="row ${a.done ? 'done' : ''}"><button class="check ${a.done ? 'on' : ''}" data-act="ga-step" data-id="${a.id}" aria-label="Step done: ${esc(a.title)}"></button><div class="row-body"><div class="title">${esc(a.title)}</div>${a.done && a.doneAt ? `<div class="meta">Done ${niceDate(a.doneAt)}</div>` : ''}</div><button class="icon-btn" data-act="ga-del" data-id="${a.id}" aria-label="Delete step">×</button></div>`).join('')}
      <form class="row add-row" data-form="gaction" data-kind="once"><span class="plus" aria-hidden="true">+</span><input class="inline-input" id="ga-once" name="t" type="text" placeholder="One-time step, e.g. Join a gym" autocomplete="off"></form>
    </div>
    <h2><span>Progress</span></h2>
    ${total ? barChart('goal-card', 'Last 30 days', `${total} done in total`, rows, `Things done for this goal per day, last 30 days, ${month} in total`) : '<div class="empty" style="border:1px solid var(--line);border-radius:16px">Tick your regular steps and a chart of your progress will show up here.</div>'}
    <div style="text-align:center;margin-top:28px"><button class="tl muted" data-act="goal-del" data-id="${g.id}">Delete this goal</button></div>`;
}

function viewGoalHistory() {
  const achieved = S.goals.filter(g => g.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const yr = String(new Date().getFullYear());
  const thisYear = achieved.filter(g => g.doneAt && dayStr(new Date(g.doneAt)).startsWith(yr)).length;
  const thirty = dayStr(new Date(Date.now() - 29 * 864e5));
  const checkins = S.goals.reduce((n, g) => n + countSince(g, null, thirty), 0);
  const weeks = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7 - (11 - i) * 7); const from = dayStr(d), e = new Date(d); e.setDate(e.getDate() + 6); const to = dayStr(e);
    const v = S.goals.reduce((n, g) => n + Object.entries(goalLogs(g)).filter(([k]) => k >= from && k <= to).reduce((m, [, ids]) => m + ids.length, 0), 0);
    return { v, tick: i === 0 || i === 6 ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : i === 11 ? 'This week' : '', tip: `<b>Week of ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</b><br>${v} ${v === 1 ? 'step' : 'steps'} done` }; });
  const active = S.goals.filter(g => !g.done).map(g => ({ g, n: countSince(g, null, thirty) })).sort((a, b) => b.n - a.n);
  const maxN = Math.max(1, ...active.map(x => x.n));
  const byMonth = {};
  achieved.forEach(g => { const k = g.doneAt ? new Date(g.doneAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Earlier'; (byMonth[k] = byMonth[k] || []).push(g); });
  return `<button class="tl" data-act="goal-back" style="margin-bottom:14px">‹ All goals</button>
    ${head('Your progress', 'Goal history', 'Goals you achieved and the work you put in.')}
    <div class="stats"><div class="stat"><b>${achieved.length}</b><span>achieved</span></div><div class="stat"><b>${thisYear}</b><span>in ${yr}</span></div><div class="stat"><b>${checkins}</b><span>steps in 30 days</span></div></div>
    ${weeks.some(w => w.v) ? barChart('goalhist-card', 'Steps done per week', 'last 12 weeks', weeks, 'Goal steps done per week, last 12 weeks') : ''}
    ${active.length ? `<div class="card"><div class="card-head"><div class="card-title">Goals in progress</div><div class="legend">steps, last 30 days</div></div><div style="margin-top:8px">${active.map(x => `<div class="hbar"><button class="title goal-open" data-goal="${x.g.id}" style="text-align:left;display:flex;align-items:center;gap:8px"><span class="area-dot" style="background:${areaColor(x.g.area)}"></span>${esc(x.g.text)}</button><div class="val">${x.n}</div><div class="track"><i style="width:${x.n / maxN * 100}%"></i></div></div>`).join('')}</div></div>` : ''}
    <h2><span>Achieved</span></h2>
    ${achieved.length ? Object.entries(byMonth).map(([m, gs]) => `<h2 style="margin-top:16px"><span>${m}</span><span class="num">${gs.length}</span></h2><div class="group">${gs.map(g => `<div class="row done"><span class="check on" aria-hidden="true" style="width:20px;height:20px"></span><button class="row-body goal-open" data-goal="${g.id}"><div class="title" style="text-decoration:none;color:var(--ink)">${esc(g.text)}</div><div class="meta">${esc(g.area)}${g.doneAt ? ' · ' + niceDate(g.doneAt) : ''} · ${countSince(g, null, '0')} steps done</div></button></div>`).join('')}</div>`).join('')
      : '<div class="empty" style="border:1px dashed var(--line);border-radius:16px">Goals you mark as achieved will be listed here.</div>'}`;
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  if (e.target.classList && e.target.classList.contains('sheet-wrap')) { ui.sheet = null; ui.dateOpen = null; ui.newDate = null; render(); return; }
  // Opens the native date picker on desktop too (phones open it on tap anyway).
  if (e.target.matches && e.target.matches('input[type="date"]')) { try { e.target.showPicker(); } catch (er) {} return; }
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.goal) { ui.tab = 'goals'; ui.goalView = null; ui.goalId = b.dataset.goal; render(); window.scrollTo(0, 0); return; }
  if (b.dataset.tab) { ui.goalId = null; ui.goalView = null; ui.tab = b.dataset.tab; try { history.replaceState(null, '', '#' + ui.tab); } catch (er) {} render(); window.scrollTo(0, 0); return; }
  if (b.dataset.sheet) { ui.sheet = b.dataset.sheet; ui.sheetAnim = true; ui.dateOpen = null; ui.newDate = null; render(); return; }
  if (b.dataset.cseg) { ui.capSeg = b.dataset.cseg; render(); return; }
  if (b.dataset.limit) { S.todayLimit = +b.dataset.limit; save(); render(); return; }
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'routine-check': { const t = today(), arr = S.routineDone[t] = S.routineDone[t] || []; const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); else arr.push(id); save(); render(); if (i < 0) { const rs = routinesToday(); if (rs.every(r => routineDoneToday(r.id))) toast('All daily tasks done!'); } break; }
    case 'new-day': { const d = +b.dataset.day, i = ui.newDays.indexOf(d); if (i >= 0) ui.newDays.splice(i, 1); else ui.newDays.push(d); const v = $('#add-routine')?.value || ''; render(); const inp = $('#add-routine'); if (inp) inp.value = v; break; }
    case 'day-toggle': { const r = S.routines.find(r => r.id === id); if (!r) break; const d = +b.dataset.day, i = r.days.indexOf(d); if (i >= 0) { if (r.days.length === 1) { toast('Keep at least one day'); break; } r.days.splice(i, 1); } else r.days.push(d); save(); render(); break; }
    case 'del-routine': remember(); S.routines = S.routines.filter(r => r.id !== id); save(); render(); toast('Daily task deleted', true); break;
    case 'sign-in': ui.signIn && ui.signIn(); break;
    case 'sign-out': ui.signOut && ui.signOut(); break;
    case 'export': { const txt = JSON.stringify(S); ui.exportShown = true; render(); const ta = $('#export-text');
      const fallback = () => { if (ta) { ta.focus(); ta.select(); } toast('Select all the text and copy it'); };
      try { navigator.clipboard.writeText(txt).then(() => toast('Copied. Paste it into Import in the new app.'), fallback); } catch (er) { fallback(); } break; }
    case 'import': { const v = ($('#import-text') || {}).value || ''; try { const r = JSON.parse(v); if (!r || r.v !== 1) throw 0; ui.importData = v; ui.importConfirm = true; render(); $('#import-text').value = v; } catch (er) { toast("That doesn't look like Focus Board data"); } break; }
    case 'import-cancel': ui.importConfirm = false; ui.importData = null; render(); break;
    case 'import-yes': { try { const r = normalize(JSON.parse(ui.importData)); S = r; ui.importConfirm = false; ui.importData = null; ui.sheet = null; save(); render(); toast('Data imported'); } catch (er) { toast('Import failed'); } break; }
    case 'date-open': { const k = id || 'new'; ui.dateOpen = ui.dateOpen === k ? null : k; renderKeep(); break; }
    case 'set-date': setTaskDate(id, quickDate(b.dataset.q)); break;
    case 'date-clear': clearTaskDate(id); break;
    case 'close-sheet': ui.exportShown = false; ui.dateOpen = null; ui.newDate = null; ui.importConfirm = false; ui.sheet = null; render(); break;
    case 'finish': finish(id); break;
    case 'undone': { const x = task(id); if (x) { x.list = 'today'; x.doneAt = null; x.doneDay = null; save(); render(); } break; }
    case 'toggle': ui.open[id] = !ui.open[id]; render(); break;
    case 'step': { const x = task(id), s = x && x.steps.find(s => s.id === b.dataset.step); if (s) { s.done = !s.done; save(); render(); } break; }
    case 'pick': pickToday(id); break;
    case 'unpick': { const x = task(id); if (x) { x.list = 'master'; save(); render(); toast('Moved back to All tasks'); } break; }
    case 'not-today': { const x = task(id); if (x) { x.list = 'nottoday'; save(); render(); toast('Skipped for today'); } break; }
    case 'to-week': { const x = task(id); if (x) { x.week = true; save(); render(); toast('Added to Weekly goals'); } break; }
    case 'off-week': { const x = task(id); if (x) { x.week = false; save(); render(); toast('Removed from this week'); } break; }
    case 'del-task': remember(); S.tasks = S.tasks.filter(x => x.id !== id); save(); render(); toast('Task deleted', true); break;
    case 'five': ui.sheet = null; render(); openTimer(id || null); break;
    case 'timer-again': timer.end = Date.now() + 5 * 60e3; clearInterval(timer.iv); timer.iv = setInterval(drawTimer, 500); drawTimer(); break;
    case 'timer-finish': { const tid = timer.taskId; closeTimer(); finish(tid); break; }
    case 'timer-close': closeTimer(); break;
    case 'cycle': { const n = S.notes.find(n => n.id === id); if (n) { n.status = nextNoteStatus(n); save(); render(); } break; }
    case 'to-task': { const n = S.notes.find(n => n.id === id); if (n) { addTask(n.text.split('\n')[0].slice(0, 120), 'all'); save(); render(); toast('Added to All tasks'); } break; }
    case 'del-note': remember(); S.notes = S.notes.filter(n => n.id !== id); save(); render(); toast('Deleted', true); break;
    case 'goal': { const g = S.goals.find(g => g.id === id); if (g) { g.done = !g.done; g.doneAt = g.done ? Date.now() : null; save(); render(); if (g.done) toast('Goal achieved. Well done!'); } break; }
    case 'goal-back': ui.goalId = null; ui.goalView = null; render(); window.scrollTo(0, 0); break;
    case 'goal-history': ui.goalId = null; ui.goalView = 'history'; render(); window.scrollTo(0, 0); break;
    case 'ga-log': { const g = goalById(ui.goalId); if (!g) break; const on = toggleLog(g, id, today()); save(); render(); if (on) toast('Nice. Logged for today.'); break; }
    case 'ga-step': { const g = goalById(ui.goalId), a = g && g.actions.find(a => a.id === id); if (a) { a.done = !a.done; a.doneAt = a.done ? Date.now() : null; save(); render(); } break; }
    case 'ga-del': { const g = goalById(ui.goalId); if (!g) break; remember(); g.actions = g.actions.filter(a => a.id !== id); Object.keys(goalLogs(g)).forEach(k => { g.logs[k] = g.logs[k].filter(x => x !== id); if (!g.logs[k].length) delete g.logs[k]; }); save(); render(); toast('Step deleted', true); break; }
    case 'goal-del': remember(); S.goals = S.goals.filter(g => g.id !== id); ui.goalId = null; save(); render(); window.scrollTo(0, 0); toast('Goal deleted', true); break;
    case 'del-area': { const a = b.dataset.area; if (S.goals.some(g => g.area === a)) break; S.areas = S.areas.filter(x => x !== a); save(); render(); toast(`Removed ${a}`); break; }
    case 'del-goal': remember(); S.goals = S.goals.filter(g => g.id !== id); save(); render(); toast('Goal deleted', true); break;
    case 'undo': if (undoState) { S = normalize(JSON.parse(undoState)); undoState = null; save(); render(); $('#toast-slot').innerHTML = ''; } break;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; ui.dateOpen = null; ui.newDate = null; render(); } });
document.addEventListener('change', e => { const el = e.target; if (el.matches && el.matches('input[data-date-for]') && el.value) setTaskDate(el.dataset.dateFor, el.value); });
document.addEventListener('submit', e => {
  const f = e.target.closest('form'); if (!f) return;
  e.preventDefault();
  const fd = new FormData(f), t = String(fd.get('t') || '').trim(), kind = f.dataset.form;
  if (!t) return;
  const refocus = f.querySelector('[name=t]').id;
  if (kind === 'task') { addTask(t, f.dataset.where, f.dataset.where === 'today' ? null : ui.newDate); ui.newDate = null; ui.dateOpen = null; }
  else if (kind === 'step') { const x = task(f.dataset.id); if (x) x.steps.push({ id: uid(), t, done: false }); }
  else if (kind === 'note') S.notes.push({ id: uid(), kind: ui.capSeg, text: t, created: Date.now(), status: ui.capSeg === 'idea' ? 'new' : 'want' });
  else if (kind === 'routine') { if (!ui.newDays.length) { toast('Pick at least one day'); return; } S.routines.push({ id: uid(), title: t, days: ui.newDays.slice().sort(), created: Date.now() }); ui.newDays = [0,1,2,3,4,5,6]; }
  else if (kind === 'goal') S.goals.push({ id: uid(), area: f.dataset.area, scope: fd.get('scope') || 'year', text: t, done: false, created: Date.now() });
  else if (kind === 'gaction') { const g = goalById(ui.goalId); if (g) { g.actions = g.actions || []; g.actions.push({ id: uid(), title: t, freq: f.dataset.kind === 'once' ? 'once' : (fd.get('freq') || 'daily'), done: false, created: Date.now() }); } }
  else if (kind === 'area') { const name = t.slice(0, 30); if (S.areas.some(a => a.toLowerCase() === name.toLowerCase())) { toast('That area already exists'); return; } S.areas.push(name); }
  save(); render();
  const again = document.getElementById(refocus); if (again) again.focus();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.loaded && rollover(S)) { save(); render(); } });
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TAB_NAMES[h]) { ui.tab = h; render(); } });

render();
connect();

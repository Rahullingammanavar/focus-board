// App-wide settings. The Firebase config is not secret: it only identifies the project.
// Access to data is controlled by Firebase Auth + the rules in firestore.rules.

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB57dCCJ_YvmuE594vSxCZZbNy4Vcb8ySs',
  authDomain: 'my-list-179f0.firebaseapp.com',
  projectId: 'my-list-179f0',
  storageBucket: 'my-list-179f0.firebasestorage.app',
  messagingSenderId: '763107790632',
  appId: '1:763107790632:web:b7ee08452a242f3f684a1d'
};

export const FIREBASE_SDK_URL = 'https://www.gstatic.com/firebasejs/10.12.2/';

// Open the app with ?local to skip sign-in and keep data only in this browser
// (used by the automated tests and handy for offline development).
export const LOCAL_ONLY = typeof location !== 'undefined' && new URLSearchParams(location.search).has('local');

// Local mode keeps its own copy so test data never mixes with your real (synced) data.
export const LS_KEY = LOCAL_ONLY ? 'focus-board-local-v1' : 'focus-board-fb-v1';

export const DEFAULT_AREAS = ['Health', 'Money', 'Study', 'Career', 'Personal'];
export const DEFAULT_TODAY_LIMIT = 5;
export const KEEP_HISTORY_DAYS = 90;

export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const AREA_COLORS = ['#2F5BEA', '#16A34A', '#E8A33D', '#DB2777', '#0891B2', '#7C3AED', '#EA580C', '#475569'];

export const FREQ = {
  daily: 'Daily', w1: '1× a week', w2: '2× a week', w3: '3× a week',
  w4: '4× a week', w5: '5× a week', once: 'One-time step'
};

export const IDEA_STATUS = { new: 'New', started: 'Started', done: 'Done', dropped: 'Dropped' };
export const IDEA_NEXT = { new: 'started', started: 'done', done: 'dropped', dropped: 'new' };
export const LEARN_STATUS = { want: 'Want to learn', learning: 'Learning', learned: 'Learned' };
export const LEARN_NEXT = { want: 'learning', learning: 'learned', learned: 'want' };

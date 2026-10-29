import { api, runWithoutAuthRedirect } from './api.js';

const state = {
  health: null,
  healthError: false,
  groups: [],
  sets: {},
  contacts: {},
  chats: [],
  schedules: [],
  activity: [],
  aiAvailable: false,
  // Whether /groups and /sets have answered at least once, so screens can tell
  // "still loading" apart from "there are none". loadError: why they couldn't.
  groupsLoaded: false,
  setsLoaded: false,
  loadError: '',
};

// Last good groups/sets/contacts/schedules, drawn at once on the next visit
// while the Pi answers (/groups and /chats can take many seconds there). The
// vjn_rc: prefix is the admin read cache's, so logging out wipes it too.
const CORE_CACHE_KEY = 'vjn_rc:sandesha-core';

function loadCoreCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CORE_CACHE_KEY) || 'null');
    if (!cached) return;
    if (Array.isArray(cached.groups)) {
      state.groups = cached.groups;
      state.groupsLoaded = true;
    }
    if (cached.sets && typeof cached.sets === 'object') {
      state.sets = cached.sets;
      state.setsLoaded = true;
    }
    if (cached.contacts && typeof cached.contacts === 'object') state.contacts = cached.contacts;
    if (Array.isArray(cached.schedules)) state.schedules = cached.schedules;
  } catch {
    /* no cache: first visit, private window, or storage blocked */
  }
}

function saveCoreCache() {
  try {
    localStorage.setItem(CORE_CACHE_KEY, JSON.stringify({
      groups: state.groups,
      sets: state.sets,
      contacts: state.contacts,
      schedules: state.schedules,
    }));
  } catch {
    /* over quota or blocked: the next visit just loads from the Pi */
  }
}

loadCoreCache();

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn(state));
}

export function getState() {
  return state;
}

// The page boots from two places and both call this: share one run, because each
// is several slow WhatsApp calls on the Pi.
let coreInFlight = null;

export function refreshCore(forceGroups = false) {
  if (coreInFlight && !forceGroups) return coreInFlight;
  const run = loadCore(forceGroups).finally(() => {
    if (coreInFlight === run) coreInFlight = null;
  });
  coreInFlight = run;
  return run;
}

async function loadCore(forceGroups) {
  return runWithoutAuthRedirect(async () => {
  // Activity is admin-only; the promotions shell would just 403 on it.
  const wantActivity = typeof window === 'undefined'
    || window.SANDESHA_EMBEDDED_MODE !== 'promotions';
  // Publish health as soon as it lands: /groups, /chats and /contacts can take a
  // long time on a Raspberry Pi, and the status row should not wait on them.
  const healthPromise = api('/health');
  healthPromise.then((h) => { state.health = h; state.healthError = false; notify(); }).catch(() => {});
  // Each answer is shown the moment it lands: /sets is a quick file read and
  // must not wait behind /groups and /chats, which can take many seconds.
  const land = (promise, apply) => {
    promise.then((value) => { apply(value); notify(); }).catch(() => {});
    return promise;
  };
  const settled = await Promise.allSettled([
    healthPromise,
    land(api(`/groups${forceGroups ? '?refresh=1' : ''}`), (value) => {
      state.groups = (Array.isArray(value) ? value : []).sort((a, b) => a.name.localeCompare(b.name));
      state.groupsLoaded = true;
    }),
    land(api('/sets'), (value) => {
      if (value) state.sets = value.sets || value || {};
      state.setsLoaded = true;
    }),
    land(api('/contacts'), (value) => {
      if (value) state.contacts = value.contacts || value || {};
    }),
    land(api('/schedules'), (value) => {
      if (value) state.schedules = value.schedules || value || [];
    }),
    wantActivity
      ? land(api('/activity?limit=150'), (value) => {
        if (value && Array.isArray(value.activity)) state.activity = value.activity;
      })
      : Promise.resolve(null),
  ]);

  const firstFail = settled.slice(0, 3).find((r) => r.status === 'rejected');
  state.loadError = firstFail ? String(firstFail.reason?.message || 'Could not reach Sandesha') : '';
  if (settled.slice(1, 5).some((r) => r.status === 'fulfilled')) saveCoreCache();
  notify();

  const health = settled[0].status === 'fulfilled' ? settled[0].value : null;
  if (!health) {
    const reason = settled[0].status === 'rejected' ? settled[0].reason : new Error('No health');
    throw reason instanceof Error ? reason : new Error(String(reason));
  }

  state.health = health;

  // Only the WhatsApp-dependent calls (groups…chats) count toward "load failed".
  const waCalls = settled.slice(1, 5);
  const softFails = waCalls.filter((r) => r.status === 'rejected');
  notify();
  if (softFails.length && softFails.length === waCalls.length) {
    // WhatsApp linking — dashboard should still load with pairing UI
    if (health.whatsapp && health.whatsapp.connected === false) {
      return state;
    }
    const msg = softFails[0].reason?.message || 'WhatsApp data unavailable';
    throw new Error(msg);
  }
  // Session blip: keep cached groups/contacts if some WhatsApp calls failed while reconnecting
  if (softFails.length && state.groups.length) {
    const reconnecting = softFails.some((r) =>
      /reconnecting|detached Frame|Session closed|WhatsApp session/i.test(String(r.reason?.message || ''))
    );
    if (reconnecting) return state;
  }
  return state;
  });
}

/**
 * Your one-to-one WhatsApp chats, for the "people" in the audience picker. Only
 * Compose uses them, and asking WhatsApp Web for every chat is slow on a Pi, so
 * this is not part of the page's start-up: Compose asks once, quietly, and the
 * picker uses whatever has arrived when it is opened.
 */
let chatsPromise = null;

export function loadChats() {
  if (chatsPromise) return chatsPromise;
  chatsPromise = api('/chats?limit=200')
    .then((value) => {
      state.chats = Array.isArray(value?.chats) ? value.chats : [];
      notify();
      return state.chats;
    })
    .catch(() => {
      chatsPromise = null; // try again next time Compose opens
      return state.chats;
    });
  return chatsPromise;
}

/**
 * Just what the Schedule panel needs: health and the queue. /groups and /chats
 * ask WhatsApp Web for everything and can take minutes (or fail) on a Pi, so
 * the schedule must not wait behind them. Throws if the queue cannot be read.
 */
export async function refreshSchedules() {
  return runWithoutAuthRedirect(async () => {
    const [health, schedules] = await Promise.allSettled([api('/health'), api('/schedules')]);
    if (health.status === 'fulfilled') {
      state.health = health.value;
      state.healthError = false;
    }
    if (schedules.status === 'fulfilled' && schedules.value) {
      state.schedules = schedules.value.schedules || schedules.value || [];
      saveCoreCache();
    }
    notify();
    if (schedules.status === 'rejected') throw schedules.reason;
    return state;
  });
}

/**
 * Group names for pickers. /groups?brief=1 skips the last-message scan.
 * One flight at a time; a cached list is already in state from the last visit.
 */
let groupsFlight = null;
export function ensureGroups() {
  if (groupsFlight) return groupsFlight;
  groupsFlight = runWithoutAuthRedirect(async () => {
    const value = await api('/groups?brief=1');
    state.groups = (Array.isArray(value) ? value : []).sort((a, b) =>
      (a.name || '').localeCompare(b.name || ''));
    state.groupsLoaded = true;
    state.loadError = '';
    saveCoreCache();
    notify();
    return state.groups;
  }).finally(() => {
    groupsFlight = null;
  });
  return groupsFlight;
}

let setsFlight = null;
export function ensureSets() {
  if (setsFlight) return setsFlight;
  setsFlight = runWithoutAuthRedirect(async () => {
    const value = await api('/sets');
    if (value) state.sets = value.sets || value || {};
    state.setsLoaded = true;
    saveCoreCache();
    notify();
    return state.sets;
  }).finally(() => {
    setsFlight = null;
  });
  return setsFlight;
}

/** Health only — cheap enough to poll. Marks the server unreachable on failure. */
export async function refreshHealth() {
  try {
    state.health = await api('/health');
    state.healthError = false;
  } catch {
    state.healthError = true;
  }
  notify();
  return state.health;
}

export async function refreshAiStatus() {
  try {
    const status = await api('/ai/status');
    state.aiAvailable = !!status.available;
  } catch {
    state.aiAvailable = false;
  }
  notify();
  return state.aiAvailable;
}

export async function saveSets(sets) {
  await api('/sets', { method: 'POST', body: JSON.stringify({ sets }) });
  state.sets = sets;
  notify();
}

/** Add a group to the in-memory list without a full refresh. */
export function rememberGroup(group) {
  const jid = String(group?.jid || '');
  const name = String(group?.name || '').trim();
  if (!jid || !name) return;
  if (state.groups.some((g) => g.jid === jid)) return;
  state.groups.push({ name, jid, participants: group.participants ?? 1 });
  state.groups.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export function jidToName(jid) {
  const g = state.groups.find((x) => x.jid === jid);
  return g?.name || jid;
}

export function getTargetOptions() {
  const options = [];
  const seen = new Set();

  // Saved contacts (contacts.json) first
  Object.entries(state.contacts).forEach(([name, number]) => {
    const value = String(name);
    seen.add(value.toLowerCase());
    options.push({ type: 'contact', label: name, value, sub: String(number) });
  });

  // WhatsApp 1:1 chats (people) — shown under Contacts
  (state.chats || [])
    .filter((c) => c && !c.isGroup && c.name && c.jid && !String(c.jid).endsWith('@g.us'))
    .forEach((c) => {
      const key = (c.name || '').toLowerCase();
      if (seen.has(key) || seen.has(c.jid)) return;
      seen.add(key);
      seen.add(c.jid);
      options.push({ type: 'contact', label: c.name, value: c.jid, sub: 'chat' });
    });

  Object.keys(state.sets).forEach((name) => {
    options.push({ type: 'set', label: name, value: name, sub: `${(state.sets[name] || []).length} groups` });
  });

  state.groups.forEach((g) => {
    const kind = g.type === 'community' ? 'community' : g.announcement ? 'announcement' : 'group';
    options.push({
      type: kind,
      label: g.name,
      value: g.jid,
      sub: `${g.participants ?? '?'} members`,
    });
  });

  options.push({ type: 'broadcast', label: 'All groups', value: '__broadcast__', sub: `${state.groups.length} groups` });
  if (typeof window !== 'undefined' && window.SANDESHA_EMBEDDED_MODE === 'promotions') {
    return options.filter((o) => o.type !== 'broadcast' && o.value !== '__broadcast__');
  }
  return options;
}

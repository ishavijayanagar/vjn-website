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

export async function refreshCore(forceGroups = false) {
  return runWithoutAuthRedirect(async () => {
  // Activity is admin-only; the promotions shell would just 403 on it.
  const wantActivity = typeof window === 'undefined'
    || window.SANDESHA_EMBEDDED_MODE !== 'promotions';
  // Publish health as soon as it lands: /groups, /chats and /contacts can take a
  // long time on a Raspberry Pi, and the status row should not wait on them.
  const healthPromise = api('/health');
  healthPromise.then((h) => { state.health = h; state.healthError = false; notify(); }).catch(() => {});
  const settled = await Promise.allSettled([
    healthPromise,
    api(`/groups${forceGroups ? '?refresh=1' : ''}`),
    api('/sets'),
    api('/contacts'),
    api('/schedules'),
    api('/chats?limit=200'),
    wantActivity ? api('/activity?limit=150') : Promise.resolve(null),
  ]);

  if (settled[1].status === 'fulfilled') state.groupsLoaded = true;
  if (settled[2].status === 'fulfilled') state.setsLoaded = true;
  const firstFail = settled.slice(0, 3).find((r) => r.status === 'rejected');
  state.loadError = firstFail ? String(firstFail.reason?.message || 'Could not reach Sandesha') : '';
  notify();

  const health = settled[0].status === 'fulfilled' ? settled[0].value : null;
  if (!health) {
    const reason = settled[0].status === 'rejected' ? settled[0].reason : new Error('No health');
    throw reason instanceof Error ? reason : new Error(String(reason));
  }

  state.health = health;
  state.groups = settled[1].status === 'fulfilled'
    ? (Array.isArray(settled[1].value) ? settled[1].value : []).sort((a, b) => a.name.localeCompare(b.name))
    : state.groups;
  const setsData = settled[2].status === 'fulfilled' ? settled[2].value : null;
  if (setsData) state.sets = setsData.sets || setsData || {};
  const contactsData = settled[3].status === 'fulfilled' ? settled[3].value : null;
  if (contactsData) state.contacts = contactsData.contacts || contactsData || {};
  const schedulesData = settled[4].status === 'fulfilled' ? settled[4].value : null;
  if (schedulesData) state.schedules = schedulesData.schedules || schedulesData || [];
  const chatsData = settled[5].status === 'fulfilled' ? settled[5].value : null;
  if (chatsData) state.chats = Array.isArray(chatsData?.chats) ? chatsData.chats : [];
  // Activity is optional and admin-only — never let it affect load success.
  const activityData = settled[6]?.status === 'fulfilled' ? settled[6].value : null;
  if (activityData && Array.isArray(activityData.activity)) state.activity = activityData.activity;

  // Only the WhatsApp-dependent calls (groups…chats) count toward "load failed".
  const waCalls = settled.slice(1, 6);
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

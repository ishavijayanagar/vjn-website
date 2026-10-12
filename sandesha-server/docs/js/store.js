import { api } from './api.js';

const state = {
  health: null,
  groups: [],
  sets: {},
  contacts: {},
  chats: [],
  schedules: [],
  aiAvailable: false,
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
  const settled = await Promise.allSettled([
    api('/health'),
    api(`/groups${forceGroups ? '?refresh=1' : ''}`),
    api('/sets'),
    api('/contacts'),
    api('/schedules'),
    api('/chats?limit=200'),
  ]);

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

  const softFails = settled.slice(1).filter((r) => r.status === 'rejected');
  notify();
  if (softFails.length && softFails.length === settled.length - 1) {
    // WhatsApp linking — dashboard should still load with pairing UI
    if (health.whatsapp && health.whatsapp.connected === false) {
      return state;
    }
    const msg = softFails[0].reason?.message || 'WhatsApp data unavailable';
    throw new Error(msg);
  }
  return state;
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
  return options;
}

/**
 * Promotions → Settings → Sets.
 *
 * A set is a named list of WhatsApp groups / announcement groups that
 * Compose and Schedule can post to in one go (Sandesha paces the fan-out).
 * Sets live on the Sandesha server (`/sets`), keyed by a lowercase name.
 */
import { getState, saveSets, subscribe, ensureGroups, ensureSets } from '../store.js?v=34';
import { escapeHtml, escapeAttr } from '../api.js';
import { toast } from '../toast.js';

let host = null;
let editing = null; // { original: string|null, name: string, jids: Set<string>, pinned: Set<string> }
let query = '';
let saving = false;
let deleting = false;

/** "seva_team" → "seva team" for display; keys stay underscored like the console's. */
function label(key) {
  return String(key || '').replace(/_/g, ' ');
}

function toKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function postable(groups) {
  // A community's parent can't be posted to; its announcement group can.
  return (groups || []).filter((g) => g && g.jid && g.type !== 'community');
}

export function renderPromoSets(el) {
  if (el) host = el;
  if (!host) return;
  renderList();
}

const SPINNER = '<span class="set-spin" aria-hidden="true"></span>';

let open = false; // the Sets section's own open/closed state, kept across re-renders
let drawer = null;
let lastKey = '';

function listKey() {
  const st = getState();
  return JSON.stringify([st.sets, st.setsLoaded, st.loadError, (st.groups || []).length]);
}

function bindToggle() {
  host.querySelector('details')?.addEventListener('toggle', (e) => { open = e.target.open; });
}

function renderList() {
  const { sets = {}, groups = [], loadError } = getState();
  lastKey = listKey();
  const names = Object.keys(sets || {}).sort();
  // An older cached store.js has no setsLoaded flag: fall back to "health answered".
  const setsLoaded = getState().setsLoaded !== undefined ? getState().setsLoaded : !!getState().health;
  // Sets we already have (cache or earlier answer) always show; the spinner is for an empty first load.
  if (!names.length && !setsLoaded) {
    host.innerHTML = `
      <details class="ios-block set-sec promo-sets" ${open ? 'open' : ''}>
        <summary class="ios-caption"><span>Sets</span></summary>
        <div class="ios-group">
          ${loadError
            ? `<div class="ios-row set-row set-state"><span class="set-row-text"><b>Couldn't load sets</b><small>${escapeHtml(loadError)}</small></span></div>
               <button type="button" class="ios-row-btn set-save" data-set-retry>Try again</button>`
            : `<div class="ios-row set-row set-state">${SPINNER}<span class="set-row-text"><b>Loading sets…</b></span></div>`}
        </div>
      </details>`;
    bindToggle();
    host.querySelector('[data-set-retry]')?.addEventListener('click', retry);
    return;
  }
  const byJid = new Map(groups.map((g) => [g.jid, g]));
  host.innerHTML = `
    <details class="ios-block set-sec promo-sets" ${open ? 'open' : ''}>
      <summary class="ios-caption"><span>Sets</span><em>${names.length}</em></summary>
      <div class="ios-group">
        ${names.map((name) => {
          const jids = sets[name] || [];
          const ann = jids.filter((j) => byJid.get(j)?.announcement).length;
          const sub = `${jids.length} ${jids.length === 1 ? 'chat' : 'chats'}${ann ? ` · ${ann} announcement` : ''}`;
          return `
            <button type="button" class="ios-row set-row" data-set-edit="${escapeAttr(name)}">
              <span class="set-row-text"><b>${escapeHtml(label(name))}</b><small>${escapeHtml(sub)}</small></span>
              <svg class="set-row-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
            </button>`;
        }).join('')}
        <button type="button" class="ios-row set-row set-row-new" data-set-new>
          <span class="set-row-text"><b>New set</b></span>
          <span class="set-row-plus" aria-hidden="true">+</span>
        </button>
      </div>
    </details>`;
  bindToggle();
  host.querySelectorAll('[data-set-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditor(btn.dataset.setEdit));
  });
  host.querySelector('[data-set-new]')?.addEventListener('click', () => openEditor(null));
}

async function retry() {
  const btn = host.querySelector('[data-set-retry]');
  if (btn) { btn.disabled = true; btn.textContent = 'Trying…'; }
  getState().loadError = '';
  renderList();
  try {
    await Promise.all([ensureSets(), ensureGroups()]);
  } catch {
    /* refreshCore records loadError; the subscriber re-renders */
  }
  renderPromoSets();
}

function openEditor(name) {
  const sets = getState().sets || {};
  editing = {
    original: name,
    name: name ? label(name) : '',
    jids: new Set(name ? sets[name] || [] : []),
  };
  // What's in the set when it opens goes to the top. Fixed until the next
  // search, so ticking a box never makes rows jump under your finger.
  editing.pinned = new Set(editing.jids);
  query = '';
  mountDrawer();
  // Groups can still be loading: the subscriber fills the picker when they land.
  if (getState().groupsLoaded === false) ensureGroups().catch(() => {});
}

function closeEditor() {
  editing = null;
  if (drawer) {
    const el = drawer;
    drawer = null;
    el.classList.remove('on');
    document.body.classList.remove('set-drawer-lock');
    setTimeout(() => el.remove(), 260);
  }
  if (host) renderList();
}

function pickerHtml(groups) {
  const q = query.trim().toLowerCase();
  const shown = groups.filter((g) => !q || String(g.name || '').toLowerCase().includes(q));
  const section = (title, list) => (list.length ? `
    <p class="set-pick-title">${title}</p>
    <div class="ios-group set-pick">
      ${list.map((g) => `
        <label class="set-pick-row">
          <input type="checkbox" value="${escapeAttr(g.jid)}" ${editing.jids.has(g.jid) ? 'checked' : ''}/>
          <span>${escapeHtml(g.name || g.jid)}</span>
          ${g.participants ? `<small>${escapeHtml(String(g.participants))}</small>` : ''}
        </label>`).join('')}
    </div>` : '');
  if (!groups.length && getState().groupsLoaded === false) {
    return `<div class="ios-group"><div class="ios-row set-row set-state">${SPINNER}<span class="set-row-text"><b>Loading groups…</b></span></div></div>`;
  }
  if (!shown.length) {
    return `<p class="ios-foot">${groups.length ? 'No groups match.' : 'No groups yet.'}</p>`;
  }
  const pinned = shown.filter((g) => editing.pinned.has(g.jid));
  const rest = shown.filter((g) => !editing.pinned.has(g.jid));
  return section(`Selected (${pinned.length})`, pinned) +
    section('Announcements', rest.filter((g) => g.announcement)) +
    section('Groups', rest.filter((g) => !g.announcement));
}

function sortedGroups() {
  return postable(getState().groups).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function countLabel() {
  const n = editing.jids.size;
  return n ? `${n} selected` : '';
}

/** New / edit set: a bottom drawer over the page, so the list behind it stays put. */
function mountDrawer() {
  drawer?.remove();
  drawer = document.createElement('div');
  drawer.className = 'set-drawer';
  drawer.innerHTML = `
    <div class="set-drawer-scrim" data-set-cancel></div>
    <div class="set-drawer-sheet" role="dialog" aria-modal="true" aria-label="${editing.original ? 'Edit set' : 'New set'}">
      <div class="set-drawer-head">
        <h3>${editing.original ? 'Edit set' : 'New set'}</h3>
        <span class="set-drawer-count" id="setCount">${countLabel()}</span>
        <button type="button" class="set-drawer-x" data-set-cancel aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="set-drawer-body">
        <div class="ios-group set-fields">
          <label class="set-field">
            <span>Name</span>
            <input type="text" id="setName" value="${escapeAttr(editing.name)}" placeholder="e.g. Volunteers Bangalore" maxlength="40" autocomplete="off"/>
          </label>
          <label class="set-field">
            <span>Search</span>
            <input type="search" id="setSearch" placeholder="Search groups" autocomplete="off"/>
          </label>
        </div>
        <div id="setPicker">${pickerHtml(sortedGroups())}</div>
      </div>
      <div class="set-drawer-foot">
        ${editing.original ? '<button type="button" class="set-drawer-del" id="setDelete">Delete</button>' : ''}
        <button type="button" class="set-drawer-save" id="setSave">Save set</button>
      </div>
    </div>`;
  document.body.appendChild(drawer);
  document.body.classList.add('set-drawer-lock');
  requestAnimationFrame(() => drawer?.classList.add('on'));

  drawer.querySelectorAll('[data-set-cancel]').forEach((el) => el.addEventListener('click', closeEditor));
  drawer.querySelector('#setName').addEventListener('input', (e) => { editing.name = e.target.value; });
  drawer.querySelector('#setSearch').addEventListener('input', (e) => {
    query = e.target.value;
    editing.pinned = new Set(editing.jids); // re-sort on search: newly ticked ones join the top
    drawer.querySelector('#setPicker').innerHTML = pickerHtml(sortedGroups());
  });
  drawer.querySelector('#setPicker').addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    if (cb.checked) editing.jids.add(cb.value);
    else editing.jids.delete(cb.value);
    drawer.querySelector('#setCount').textContent = countLabel();
  });
  drawer.querySelector('#setSave').addEventListener('click', save);
  drawer.querySelector('#setDelete')?.addEventListener('click', remove);
  if (!editing.original) drawer.querySelector('#setName').focus({ preventScroll: true });
}

function setBusy(on, deletingNow = false) {
  saving = on;
  deleting = deletingNow;
  const saveBtn = drawer?.querySelector('#setSave');
  const delBtn = drawer?.querySelector('#setDelete');
  if (saveBtn) { saveBtn.disabled = on; saveBtn.textContent = on && !deletingNow ? 'Saving…' : 'Save set'; }
  if (delBtn) { delBtn.disabled = on; delBtn.textContent = deletingNow ? 'Deleting…' : 'Delete'; }
}

async function save() {
  if (saving) return;
  const key = toKey(editing.name);
  if (!key || !/^[a-z0-9_-]+$/.test(key)) {
    toast('Name the set with letters, numbers or spaces', 'err');
    return;
  }
  if (!editing.jids.size) {
    toast('Tick at least one group', 'err');
    return;
  }
  const sets = { ...(getState().sets || {}) };
  if (key !== editing.original && sets[key]) {
    toast(`A set called "${label(key)}" already exists`, 'err');
    return;
  }
  if (editing.original && editing.original !== key) delete sets[editing.original];
  sets[key] = [...editing.jids];
  setBusy(true);
  try {
    await saveSets(sets);
    toast(`Saved "${label(key)}"`, 'ok');
    setBusy(false);
    closeEditor();
  } catch (err) {
    toast(err?.message || 'Could not save the set', 'err');
    setBusy(false);
  }
}

async function remove() {
  const name = editing.original;
  if (!name || !confirm(`Delete the set "${label(name)}"? Scheduled posts to it will have nothing to send to.`)) return;
  const sets = { ...(getState().sets || {}) };
  delete sets[name];
  setBusy(true, true);
  try {
    await saveSets(sets);
    toast(`Deleted "${label(name)}"`, 'ok');
    setBusy(false);
    closeEditor();
  } catch (err) {
    toast(err?.message || 'Could not delete the set', 'err');
    setBusy(false);
  }
}

// Sets and groups can arrive after the panel is already open: refresh the list,
// and the drawer's picker only while it is still waiting for groups.
subscribe(() => {
  const picker = drawer?.querySelector('#setPicker');
  if (picker && (picker.querySelector('.set-spin') || !picker.querySelector('input'))) {
    picker.innerHTML = pickerHtml(sortedGroups());
  }
  if (!host || !host.isConnected || !host.closest('.is-active')) return;
  if (listKey() !== lastKey) renderList();
});

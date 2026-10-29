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
  if (editing) renderEditor();
  else renderList();
}

const SPINNER = '<span class="set-spin" aria-hidden="true"></span>';

function renderList() {
  const { sets = {}, groups = [], loadError } = getState();
  // An older cached store.js has no setsLoaded flag: fall back to "health answered".
  const setsLoaded = getState().setsLoaded !== undefined ? getState().setsLoaded : !!getState().health;
  if (!setsLoaded) {
    host.innerHTML = `
      <section class="ios-block promo-sets" aria-busy="${loadError ? 'false' : 'true'}">
        <h2 class="ios-caption">Sets</h2>
        <div class="ios-group">
          ${loadError
            ? `<div class="ios-row set-row set-state"><span class="set-row-text"><b>Couldn't load sets</b><small>${escapeHtml(loadError)}</small></span></div>
               <button type="button" class="ios-row-btn set-save" data-set-retry>Try again</button>`
            : `<div class="ios-row set-row set-state">${SPINNER}<span class="set-row-text"><b>Loading sets…</b></span></div>
               <div class="ios-row set-row set-skel" aria-hidden="true"><span class="set-skel-bar"></span></div>`}
        </div>
      </section>`;
    host.querySelector('[data-set-retry]')?.addEventListener('click', retry);
    return;
  }
  const names = Object.keys(sets).sort();
  const byJid = new Map(groups.map((g) => [g.jid, g]));
  host.innerHTML = `
    <section class="ios-block promo-sets">
      <h2 class="ios-caption">Sets</h2>
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
      <p class="ios-foot">A set sends one post to several groups or announcement groups. Pick it as the target in Compose or Schedule.</p>
    </section>`;
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
  renderEditor();
  host.querySelector('#setName')?.focus();
}

function closeEditor() {
  editing = null;
  renderList();
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
    return `<p class="ios-foot">${groups.length ? 'No groups match.' : 'No groups found. They appear once WhatsApp is connected.'}</p>`;
  }
  const pinned = shown.filter((g) => editing.pinned.has(g.jid));
  const rest = shown.filter((g) => !editing.pinned.has(g.jid));
  return section(`Selected (${pinned.length})`, pinned) +
    section('Announcements', rest.filter((g) => g.announcement)) +
    section('Groups', rest.filter((g) => !g.announcement));
}

function renderEditor() {
  const groups = postable(getState().groups).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const count = editing.jids.size;
  host.innerHTML = `
    <section class="ios-block promo-sets">
      <div class="set-edit-head">
        <button type="button" class="set-back" data-set-cancel aria-label="Back to sets">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>
          Sets
        </button>
        <h2 class="ios-caption">${editing.original ? 'Edit set' : 'New set'}</h2>
      </div>
      <div class="ios-group set-fields">
        <label class="set-field">
          <span>Name</span>
          <input type="text" id="setName" value="${escapeAttr(editing.name)}" placeholder="e.g. Volunteers Bangalore" maxlength="40" autocomplete="off"/>
        </label>
        <label class="set-field">
          <span>Search</span>
          <input type="search" id="setSearch" value="${escapeAttr(query)}" placeholder="Search groups" autocomplete="off"/>
        </label>
      </div>
      <p class="ios-foot" id="setCount">${count ? `${count} selected` : 'Tick the groups and announcement groups to include.'}</p>
      <div id="setPicker">${pickerHtml(groups)}</div>
      <div class="ios-group">
        <button type="button" class="ios-row-btn set-save" id="setSave" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save set'}</button>
      </div>
      ${editing.original ? `
      <div class="ios-group">
        <button type="button" class="ios-row-btn danger" id="setDelete" ${saving ? 'disabled' : ''}>${deleting ? 'Deleting…' : 'Delete set'}</button>
      </div>` : ''}
    </section>`;

  host.querySelector('[data-set-cancel]')?.addEventListener('click', closeEditor);
  host.querySelector('#setName')?.addEventListener('input', (e) => { editing.name = e.target.value; });
  host.querySelector('#setSearch')?.addEventListener('input', (e) => {
    query = e.target.value;
    editing.pinned = new Set(editing.jids); // re-sort on search: newly ticked ones join the top
    host.querySelector('#setPicker').innerHTML = pickerHtml(groups);
  });
  host.querySelector('#setPicker')?.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    if (cb.checked) editing.jids.add(cb.value);
    else editing.jids.delete(cb.value);
    const n = editing.jids.size;
    host.querySelector('#setCount').textContent = n ? `${n} selected` : 'Tick the groups and announcement groups to include.';
  });
  host.querySelector('#setSave')?.addEventListener('click', save);
  host.querySelector('#setDelete')?.addEventListener('click', remove);
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
  saving = true;
  renderEditor();
  try {
    await saveSets(sets);
    toast(`Saved "${label(key)}"`, 'ok');
    editing = null;
  } catch (err) {
    toast(err?.message || 'Could not save the set', 'err');
  } finally {
    saving = false;
    renderPromoSets();
  }
}

async function remove() {
  const name = editing.original;
  if (!name || !confirm(`Delete the set "${label(name)}"? Scheduled posts to it will have nothing to send to.`)) return;
  const sets = { ...(getState().sets || {}) };
  delete sets[name];
  saving = true;
  deleting = true;
  renderEditor();
  try {
    await saveSets(sets);
    toast(`Deleted "${label(name)}"`, 'ok');
    saving = false;
    deleting = false;
    closeEditor();
  } catch (err) {
    toast(err?.message || 'Could not delete the set', 'err');
    saving = false;
    deleting = false;
    renderEditor();
  }
}

// Sets and groups can arrive after the panel is already open: refresh the list,
// or just the editor's picker (never the whole editor, which would lose typing).
subscribe(() => {
  if (!host || !host.isConnected || !host.closest('.is-active')) return;
  if (!editing) {
    renderList();
    return;
  }
  const picker = host.querySelector('#setPicker');
  if (picker && picker.querySelector('.set-spin')) {
    const groups = postable(getState().groups).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    picker.innerHTML = pickerHtml(groups);
  }
});

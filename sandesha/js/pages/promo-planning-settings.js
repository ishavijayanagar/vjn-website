/**
 * Promotions → Settings → Planning group (@sandesha send wizard).
 */
import { api, escapeHtml, escapeAttr } from '../api.js';
import { getState, ensureGroups, subscribe } from '../store.js?v=34';
import { toast } from '../toast.js';

let host = null;
let config = null;
let pickingGroup = false;
let groupQuery = '';
let saving = false;
let unsub = null;
let open = false;

function normalizePhones(text) {
  return String(text || '')
    .split(/[\n,;]+/)
    .map((s) => s.replace(/\D/g, '').trim())
    .filter((d) => d.length >= 10);
}

function render() {
  if (!host) return;
  if (pickingGroup) {
    renderGroupPicker();
    return;
  }
  const loaded = config !== null;
  if (!loaded) {
    host.innerHTML = `
      <details class="ios-block set-sec promo-planning" aria-busy="true" ${open ? 'open' : ''}>
        <summary class="ios-caption"><span>Planning group</span></summary>
        <div class="ios-group">
          <div class="ios-row set-row set-state"><span class="set-spin" aria-hidden="true"></span><span class="set-row-text"><b>Loading…</b></span></div>
        </div>
      </details>`;
    bindToggle();
    return;
  }

  const groupLabel = config.groupName || config.groupJid || 'Not set';
  const opLines = (config.operators || []).join('\n');

  host.innerHTML = `
    <details class="ios-block set-sec promo-planning" ${open ? 'open' : ''}>
      <summary class="ios-caption"><span>Planning group</span></summary>
      <div class="ios-group set-fields">
        <div class="set-field">
          <span>WhatsApp group</span>
          <button type="button" class="ios-row-btn plan-group-pick" id="planGroupPick">
            <span class="set-row-text"><b>${escapeHtml(groupLabel)}</b><small>${escapeHtml(config.groupJid || '')}</small></span>
            <svg class="set-row-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
          </button>
        </div>
        <label class="set-field">
          <span>Operators</span>
          <textarea id="planOperators" rows="3" placeholder="One phone per line&#10;919876543210" autocomplete="off">${escapeHtml(opLines)}</textarea>
        </label>
      </div>
      <div class="ios-group">
        <button type="button" class="ios-row-btn set-save" id="planSave" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save planning group'}</button>
      </div>
    </details>`;
  bindToggle();

  host.querySelector('#planGroupPick')?.addEventListener('click', () => {
    groupQuery = '';
    pickingGroup = true;
    ensureGroups().finally(render);
  });
  host.querySelector('#planSave')?.addEventListener('click', save);
}

function pickerGroups() {
  const q = groupQuery.trim().toLowerCase();
  return (getState().groups || [])
    .filter((g) => g?.jid && g.jid.endsWith('@g.us'))
    .filter((g) => !q || String(g.name || '').toLowerCase().includes(q))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function pickerListHtml() {
  const shown = pickerGroups();
  return shown.length
    ? shown.map((g) => `
          <button type="button" class="ios-row-btn set-pick-row plan-group-opt" data-jid="${escapeAttr(g.jid)}" data-name="${escapeAttr(g.name || g.jid)}">
            <span>${escapeHtml(g.name || g.jid)}</span>
            ${g.participants ? `<small>${escapeHtml(String(g.participants))}</small>` : ''}
          </button>`).join('')
    : '<p class="ios-foot">No groups match.</p>';
}

function renderGroupPicker() {
  host.innerHTML = `
    <details class="ios-block set-sec promo-planning" open>
      <summary class="ios-caption"><span>Planning group</span></summary>
      <div class="set-edit-head">
        <button type="button" class="set-back" id="planGroupBack" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>
          Back
        </button>
      </div>
      <div class="ios-group set-fields">
        <label class="set-field">
          <span>Search</span>
          <input type="search" id="planGroupSearch" value="${escapeAttr(groupQuery)}" placeholder="Search groups" autocomplete="off"/>
        </label>
      </div>
      <div class="ios-group set-pick" id="planGroupList">${pickerListHtml()}</div>
    </details>`;

  host.querySelector('#planGroupBack')?.addEventListener('click', () => {
    pickingGroup = false;
    render();
  });
  // Only the list is swapped as you type, so the field keeps focus.
  host.querySelector('#planGroupSearch')?.addEventListener('input', (e) => {
    groupQuery = e.target.value;
    host.querySelector('#planGroupList').innerHTML = pickerListHtml();
  });
  host.querySelector('#planGroupList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.plan-group-opt');
    if (!btn) return;
    config = { ...config, groupJid: btn.dataset.jid, groupName: btn.dataset.name };
    pickingGroup = false;
    render();
  });
}

function bindToggle() {
  host.querySelector('details')?.addEventListener('toggle', (e) => { open = e.target.open; });
}

async function loadConfig() {
  try {
    config = await api('/planning-config');
  } catch (err) {
    config = { groupJid: '', groupName: '', operators: [], enabled: false, source: 'env' };
    toast(err?.message || 'Could not load planning settings', 'err');
  }
  render();
}

async function save() {
  if (saving || !config) return;
  const operators = normalizePhones(host.querySelector('#planOperators')?.value || '');
  if (!config.groupJid) {
    toast('Choose a WhatsApp group', 'err');
    return;
  }
  if (!operators.length) {
    toast('Add at least one operator phone', 'err');
    return;
  }
  saving = true;
  render();
  try {
    config = await api('/planning-config', {
      method: 'POST',
      body: JSON.stringify({
        groupJid: config.groupJid,
        groupName: config.groupName,
        operators,
      }),
    });
    toast('Planning group saved — wizard updated on server', 'ok');
  } catch (err) {
    toast(err?.message || 'Save failed', 'err');
  } finally {
    saving = false;
    render();
  }
}

export function renderPromoPlanningSettings(el) {
  if (el) host = el;
  if (!host) return;
  if (!unsub) {
    unsub = subscribe(() => {
      const list = host && pickingGroup ? host.querySelector('#planGroupList') : null;
      if (list) list.innerHTML = pickerListHtml();
    });
  }
  loadConfig();
}

export function unmountPromoPlanningSettings() {
  if (unsub) {
    unsub();
    unsub = null;
  }
  host = null;
  pickingGroup = false;
}

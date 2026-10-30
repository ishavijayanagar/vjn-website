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
      <section class="ios-block promo-planning" aria-busy="true">
        <h2 class="ios-caption">Planning group</h2>
        <div class="ios-group">
          <div class="ios-row set-row set-state"><span class="set-row-text"><b>Loading…</b></span></div>
        </div>
      </section>`;
    return;
  }

  const groupLabel = config.groupName || config.groupJid || 'Not set';
  const opLines = (config.operators || []).join('\n');

  host.innerHTML = `
    <section class="ios-block promo-planning">
      <h2 class="ios-caption">Planning group</h2>
      <p class="ios-foot plan-intro">In this group, allowed operators reply to a draft with <strong>@sandesha send</strong> or <strong>@sv send</strong>, pick a set, then send now or schedule.</p>
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
          <small class="plan-hint">Country code required (10-digit Indian OK). Up to 8 numbers.</small>
        </label>
      </div>
      <div class="ios-group">
        <button type="button" class="ios-row-btn set-save" id="planSave" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save planning group'}</button>
      </div>
      <p class="ios-foot">${config.source === 'file' ? 'Saved on the Sandesha server.' : 'Using .env until you save here.'}</p>
    </section>`;

  host.querySelector('#planGroupPick')?.addEventListener('click', () => {
    groupQuery = '';
    pickingGroup = true;
    ensureGroups().finally(render);
  });
  host.querySelector('#planSave')?.addEventListener('click', save);
}

function renderGroupPicker() {
  const groups = (getState().groups || [])
    .filter((g) => g?.jid && g.jid.endsWith('@g.us'))
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const q = groupQuery.trim().toLowerCase();
  const shown = groups.filter((g) => !q || String(g.name || '').toLowerCase().includes(q));

  host.innerHTML = `
    <section class="ios-block promo-planning">
      <div class="set-edit-head">
        <button type="button" class="set-back" id="planGroupBack" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="15 6 9 12 15 18"/></svg>
          Planning
        </button>
        <h2 class="ios-caption">Choose group</h2>
      </div>
      <div class="ios-group set-fields">
        <label class="set-field">
          <span>Search</span>
          <input type="search" id="planGroupSearch" value="${escapeAttr(groupQuery)}" placeholder="Search groups" autocomplete="off"/>
        </label>
      </div>
      <div class="ios-group set-pick">
        ${shown.length
    ? shown.map((g) => `
          <button type="button" class="ios-row-btn set-pick-row plan-group-opt" data-jid="${escapeAttr(g.jid)}" data-name="${escapeAttr(g.name || g.jid)}">
            <span>${escapeHtml(g.name || g.jid)}</span>
            ${g.participants ? `<small>${escapeHtml(String(g.participants))}</small>` : ''}
          </button>`).join('')
    : '<p class="ios-foot">No groups match.</p>'}
      </div>
    </section>`;

  host.querySelector('#planGroupBack')?.addEventListener('click', () => {
    pickingGroup = false;
    render();
  });
  host.querySelector('#planGroupSearch')?.addEventListener('input', (e) => {
    groupQuery = e.target.value;
    renderGroupPicker();
  });
  host.querySelectorAll('.plan-group-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      config = {
        ...config,
        groupJid: btn.dataset.jid,
        groupName: btn.dataset.name,
      };
      pickingGroup = false;
      render();
    });
  });
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
      if (host && pickingGroup) renderGroupPicker();
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

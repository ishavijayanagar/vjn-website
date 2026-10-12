/**
 * Audience — one home for everyone Sandesha can message.
 *
 * A segmented control over the existing Groups / Sets / Contacts / Numbers
 * screens, plus the "New group" and "Add people" actions that used to be a
 * separate tool. The individual page modules still own their rendering; this
 * page just points them at its own segment container.
 */
import { renderGroups, mountGroups } from './groups.js';
import { renderSets, mountSets } from './sets.js';
import { renderContacts, mountContacts } from './contacts.js';
import { renderBulk, mountBulk } from './bulk.js';
import { openAddMembers } from './add-members.js';
import { getState } from '../store.js';

const SEGMENTS = [
  { id: 'groups', label: 'Groups' },
  { id: 'sets', label: 'Sets' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'numbers', label: 'Numbers' },
];
const STORE_KEY = 'sandesha_audience_seg';

function currentSeg() {
  try {
    const v = sessionStorage.getItem(STORE_KEY);
    if (SEGMENTS.some((s) => s.id === v)) return v;
  } catch { /* ignore */ }
  return 'groups';
}

function setSeg(id) {
  try { sessionStorage.setItem(STORE_KEY, id); } catch { /* ignore */ }
}

export function renderAudience() {
  const host = document.getElementById('page-audience');
  if (!host) return;
  const seg = currentSeg();
  const groupCount = (getState().groups || []).length;

  host.innerHTML = `
    <div class="aud-head">
      <div class="segmented" role="tablist" aria-label="Audience type">
        ${SEGMENTS.map((s) => `
          <button type="button" class="segmented-btn ${seg === s.id ? 'active' : ''}" data-seg="${s.id}" role="tab" aria-selected="${seg === s.id}">${s.label}</button>
        `).join('')}
      </div>
      <div class="aud-actions" id="aud-actions"></div>
    </div>
    <div class="aud-segment" id="audience-segment"></div>
  `;

  const segEl = host.querySelector('#audience-segment');
  const actionsEl = host.querySelector('#aud-actions');

  if (seg === 'groups') {
    actionsEl.innerHTML = `
      <button type="button" class="btn btn-sm secondary" data-act="new-group">＋ New group</button>
      <button type="button" class="btn btn-sm" data-act="add-people">Add people</button>`;
    actionsEl.querySelector('[data-act="new-group"]')?.addEventListener('click', () => openAddMembers({ focus: 'create' }));
    actionsEl.querySelector('[data-act="add-people"]')?.addEventListener('click', () => openAddMembers());
    mountGroups(segEl);
    renderGroups();
  } else if (seg === 'sets') {
    actionsEl.innerHTML = `<span class="aud-hint">${groupCount} groups available</span>`;
    mountSets(segEl);
    renderSets();
  } else if (seg === 'contacts') {
    actionsEl.innerHTML = '';
    mountContacts(segEl);
    renderContacts();
  } else {
    actionsEl.innerHTML = `<span class="aud-hint">One-to-one — paced widely</span>`;
    mountBulk(segEl);
    renderBulk();
  }

  host.querySelectorAll('[data-seg]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.seg === currentSeg()) return;
      setSeg(btn.dataset.seg);
      renderAudience();
    });
  });
}

/** Entry point for code that used to call openGroups/openSets/etc. */
export function openAudience(seg) {
  if (seg && SEGMENTS.some((s) => s.id === seg)) setSeg(seg);
  renderAudience();
}

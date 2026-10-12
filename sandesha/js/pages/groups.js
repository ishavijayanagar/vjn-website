import { api } from '../api.js';
import { getState, jidToName } from '../store.js';
import { pushSub, getSubPage } from '../router.js';
import { escapeHtml } from '../api.js';
import { toast } from '../toast.js';
import { openSend, prefillTarget } from './send.js';
import { openAddMembers } from './add-members.js';

let container = document.getElementById('sub-groups');
const detailContainer = document.getElementById('sub-group-detail');

/** Let a host page (e.g. Audience) redirect the groups list into its own element. */
export function mountGroups(el) {
  container = el || document.getElementById('sub-groups');
}

let filter = 'all';
let searchQ = '';
let findQ = '';
let detailJid = null;

function badgeClass(status) {
  if (status === 'active') return 'active';
  if (status === 'week') return 'week';
  if (status === 'inactive') return 'inactive';
  return 'unknown';
}

export function renderGroups() {
  if (!container) return;
  const { groups } = getState();
  let list = groups;

  if (filter === 'active') list = list.filter((g) => g.status === 'active' || g.status === 'week');
  else if (filter === 'inactive') list = list.filter((g) => g.status === 'inactive' || (g.daysInactive || 0) >= 30);

  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter((g) => g.name.toLowerCase().includes(q));
  }

  container.innerHTML = `
    <div class="card">
      <input type="search" id="groups-search" class="search-field" placeholder="Search groups…" value="${escapeHtml(searchQ)}">
      <div class="chip-row">
        <button type="button" class="chip ${filter === 'all' ? 'active' : ''}" data-f="all">All</button>
        <button type="button" class="chip ${filter === 'active' ? 'active' : ''}" data-f="active">Active</button>
        <button type="button" class="chip ${filter === 'inactive' ? 'active' : ''}" data-f="inactive">Inactive 30d+</button>
      </div>
      <div class="field mb-0">
        <label>Find member</label>
        <div class="field-row">
          <input type="search" id="find-member" placeholder="Name across groups…" value="${escapeHtml(findQ)}">
          <button type="button" class="btn btn-sm secondary" id="find-btn">Find</button>
        </div>
        <div id="find-results"></div>
      </div>
    </div>
    <div class="list-group" id="groups-list">
      ${list.length ? list.slice(0, 300).map((g) => `
        <div class="list-row" data-jid="${escapeHtml(g.jid)}" data-name="${escapeHtml(g.name)}">
          <div class="row-main">
            <div class="row-title">${escapeHtml(g.name)}</div>
            <div class="row-sub">${g.participants ?? '?'} members · ${escapeHtml(g.lastActive || 'Unknown')}</div>
          </div>
          <span class="badge ${badgeClass(g.status)}">${escapeHtml(g.status || '?')}</span>
          <span class="chevron">›</span>
        </div>`).join('') : '<p class="empty">No groups match</p>'}
    </div>`;

  container.querySelector('#groups-search')?.addEventListener('input', (e) => {
    searchQ = e.target.value;
    renderGroups();
  });
  container.querySelectorAll('[data-f]').forEach((chip) => {
    chip.addEventListener('click', () => { filter = chip.dataset.f; renderGroups(); });
  });
  container.querySelector('#find-btn')?.addEventListener('click', doFindMember);
  container.querySelector('#find-member')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doFindMember();
  });
  container.querySelectorAll('[data-jid]').forEach((row) => {
    row.addEventListener('click', () => openDetail(row.dataset.jid, row.dataset.name));
  });
}

async function doFindMember() {
  findQ = container.querySelector('#find-member')?.value || '';
  const resultsEl = container.querySelector('#find-results');
  if (!findQ.trim()) return;
  if (resultsEl) resultsEl.innerHTML = '<p class="hint">Searching…</p>';
  try {
    const data = await api(`/groups/find-member?q=${encodeURIComponent(findQ.trim())}`);
    const results = data.results || [];
    if (!results.length) {
      resultsEl.innerHTML = '<p class="hint">No members found</p>';
      return;
    }
    resultsEl.innerHTML = `<div class="list-group mt-sm">${results.map((r) => `
      <div class="list-row static">
        <div class="row-main">
          <div class="row-title">${escapeHtml(r.name)}</div>
          <div class="row-sub">${escapeHtml(r.group)}</div>
        </div>
      </div>`).join('')}</div>`;
  } catch (err) {
    if (resultsEl) resultsEl.innerHTML = `<p class="hint err">${escapeHtml(err.message)}</p>`;
  }
}

function openDetail(jid, name) {
  detailJid = jid;
  pushSub('group-detail', name || 'Group');
  renderGroupDetail();
}

export function renderGroupDetail() {
  if (!detailContainer || getSubPage() !== 'group-detail') return;
  detailContainer.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  loadDetail();
}

let memberFilter = '';

async function loadDetail() {
  if (!detailJid || !detailContainer) return;
  try {
    const data = await api(`/groups/${encodeURIComponent(detailJid)}/members`);
    const gName = data.group || jidToName(detailJid) || 'Group';
    const members = data.members || [];
    detailContainer.dataset.members = JSON.stringify(members);
    detailContainer.innerHTML = `
      <div class="card">
        <h2>${escapeHtml(gName)}</h2>
        <p class="hint">${data.total ?? members.length ?? 0} members</p>
        <div class="btn-row">
          <button type="button" class="btn" id="detail-send">Message group</button>
          <button type="button" class="btn secondary" id="detail-add">Add people</button>
        </div>
        <div class="am-sub-actions"><button type="button" class="linkbtn" id="detail-invite">Copy join link</button></div>
      </div>
      <div class="card">
        <input type="search" id="member-filter" class="search-field" placeholder="Filter members…" value="${escapeHtml(memberFilter)}">
        <div class="list-group mt-sm" id="member-list"></div>
      </div>`;

    renderMemberList();
    detailContainer.querySelector('#member-filter')?.addEventListener('input', (e) => {
      memberFilter = e.target.value;
      renderMemberList();
    });
    detailContainer.querySelector('#detail-send')?.addEventListener('click', () => {
      const g = getState().groups.find((x) => x.jid === detailJid);
      prefillTarget({ value: detailJid, type: 'group', label: g?.name || gName });
      openSend();
    });
    detailContainer.querySelector('#detail-add')?.addEventListener('click', () => {
      openAddMembers({ groupJid: detailJid });
    });
    detailContainer.querySelector('#detail-invite')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = 'Fetching…';
      try {
        const { link } = await api(`/groups/${encodeURIComponent(detailJid)}/invite`);
        let copied = false;
        try { await navigator.clipboard.writeText(link); copied = true; } catch { /* blocked */ }
        toast(copied ? 'Join link copied' : link, copied ? 'ok' : 'info', copied ? 3000 : 8000);
      } catch (err) {
        toast(err.message || 'Could not get the join link', 'err');
      } finally {
        b.disabled = false;
        b.textContent = 'Copy join link';
      }
    });
  } catch (err) {
    detailContainer.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  }
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0] || '').join('').toUpperCase() || '?';
}

function renderMemberList() {
  const listEl = detailContainer?.querySelector('#member-list');
  if (!listEl) return;
  let members = [];
  try { members = JSON.parse(detailContainer.dataset.members || '[]'); } catch { /* ignore */ }
  const q = memberFilter.trim().toLowerCase();
  const shown = q
    ? members.filter((m) => (m.name || '').toLowerCase().includes(q) || (m.phone || '').includes(q))
    : members;
  listEl.innerHTML = shown.length
    ? shown.map((m) => `
      <div class="list-row static">
        <span class="member-avatar" aria-hidden="true">${escapeHtml(initials(m.name))}</span>
        <div class="row-main">
          <div class="row-title">${escapeHtml(m.name || 'Unknown')}</div>
          <div class="row-sub">${escapeHtml(m.phone || '')}</div>
        </div>
      </div>`).join('')
    : '<p class="empty">No members match</p>';
}

export function openGroups() {
  pushSub('groups', 'Groups');
  renderGroups();
}

export function onSubBack(id) {
  if (id === 'group-detail') renderGroupDetail();
  if (id === 'groups') renderGroups();
}

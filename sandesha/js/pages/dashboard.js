import { escapeHtml } from '../api.js';
import { getState } from '../store.js';
import { jidToName } from '../store.js';
import { getActivities, getActivityStats, clearActivities } from '../activity-log.js';

const CATEGORY_LABEL = {
  send: 'Send', schedule: 'Schedule', members: 'Members',
  group: 'Group', set: 'Set', contact: 'Contact', system: 'System', auth: 'Auth',
};

const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'send', label: 'Sends', match: (e) => e.category === 'send' },
  { id: 'schedule', label: 'Schedule', match: (e) => e.category === 'schedule' },
  { id: 'members', label: 'Members', match: (e) => e.category === 'members' },
  { id: 'system', label: 'System', match: (e) => !['send', 'schedule', 'members'].includes(e.category) },
];

let activityFilter = 'all';

function serverActivity() {
  return getState().activity || [];
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yst = new Date(today);
  yst.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yst)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
import { getActiveProgress } from '../progress-bus.js';
import { pushSub } from '../router.js';
import { renderSchedule } from './schedule.js';
import { toast } from '../toast.js';

const CATEGORY_ICON = {
  send:     `<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  schedule: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  system:   `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  auth:     `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
};

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatCountdown(iso) {
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return 'Due now';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `in ${Math.floor(h / 24)}d`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function renderProgressCard(progress) {
  if (!progress) return '';
  const isDone  = progress.status === 'done';
  const isError = progress.status === 'error';
  const statusClass = isDone ? 'done' : isError ? 'error' : 'running';
  return `
  <div class="dash-live-card ${statusClass}" id="dash-live-card">
    <div class="dash-live-header">
      <div class="dash-live-icon ${statusClass}">
        ${isDone
          ? `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`
          : isError
            ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
            : `<span class="dash-live-spinner"></span>`}
      </div>
      <div class="dash-live-info">
        <div class="dash-live-label">${escapeHtml(progress.label)}</div>
        ${progress.eta ? `<div class="dash-live-eta">${escapeHtml(progress.eta)}</div>` : ''}
        ${(isDone || isError) && progress.result ? `<div class="dash-live-result ${statusClass}">${escapeHtml(progress.result)}</div>` : ''}
      </div>
      ${(isDone || isError) ? `<div class="dash-live-badge ${statusClass}">${isDone ? '✓' : '✕'}</div>` : ''}
    </div>
    ${progress.status === 'running' ? `
    <div class="dash-progress-track">
      <div class="dash-progress-fill-bar" style="width:${progress.pct}%"></div>
    </div>
    <div class="dash-progress-foot">
      <span>${progress.done} of ${progress.total}</span>
      <span>${progress.pct}%</span>
    </div>` : ''}
  </div>`;
}

function renderUpcoming(schedules, sets) {
  const upcoming = [...(schedules || [])]
    .filter((s) => new Date(s.runAt) > Date.now())
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt))
    .slice(0, 4);

  if (!upcoming.length) {
    return `<div class="dash-empty-mini">No upcoming schedules</div>`;
  }

  return upcoming.map((s) => {
    const diff = new Date(s.runAt) - Date.now();
    const isSoon = diff < 3600000;
    const setMembers = s.isSet ? (sets[String(s.target).toLowerCase()] || []) : null;
    const resolvedName = s.isSet ? s.target : jidToName(s.target);
    const targetLabel = setMembers ? `${resolvedName} · ${setMembers.length} groups` : resolvedName;
    const dateStr = new Date(s.runAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    return `
    <div class="dash-sched-row">
      <div class="dash-sched-dot ${isSoon ? 'soon' : ''}"></div>
      <div class="dash-sched-main">
        <div class="dash-sched-target">${escapeHtml(targetLabel)}</div>
        <div class="dash-sched-meta">${escapeHtml(formatCountdown(s.runAt))} · ${escapeHtml(dateStr)}</div>
        ${s.message ? `<div class="dash-sched-preview">${escapeHtml(s.message.slice(0, 60))}${s.message.length > 60 ? '…' : ''}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderFeedFilters() {
  return `
  <div class="dash-feed-filters" role="tablist">
    ${FILTERS.map((f) => `
      <button type="button" class="dash-feed-filter ${activityFilter === f.id ? 'active' : ''}" data-filter="${f.id}" role="tab" aria-selected="${activityFilter === f.id}">${f.label}</button>
    `).join('')}
  </div>`;
}

function renderActivityRow(entry) {
  const isOk  = entry.type === 'ok';
  const isErr = entry.type === 'err';
  const icon  = CATEGORY_ICON[entry.category] || CATEGORY_ICON.system;
  const timeStr = new Date(entry.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const targetName = entry.target ? (jidToName(entry.target) || entry.target) : '';
  return `
  <div class="dash-feed-item ${isOk ? 'ok' : isErr ? 'err' : 'warn'}" data-id="${escapeHtml(entry.id)}">
    <div class="dash-feed-icon ${entry.category}">${icon}</div>
    <div class="dash-feed-body">
      <div class="dash-feed-title">${escapeHtml(entry.title)}${entry._group ? ` <span class="dash-feed-chip">×${entry._group}</span>` : ''}</div>
      ${targetName ? `<div class="dash-feed-target">${escapeHtml(targetName)}</div>` : ''}
      ${entry.detail ? `<div class="dash-feed-detail">${escapeHtml(entry.detail)}</div>` : ''}
      <div class="dash-feed-meta">
        <span class="dash-feed-cat">${escapeHtml(CATEGORY_LABEL[entry.category] || entry.category)}</span>
        <span>·</span>
        <span>${escapeHtml(relativeTime(entry.ts))}</span>
        <span>·</span>
        <span>${escapeHtml(timeStr)}</span>
      </div>
    </div>
    <div class="dash-feed-badge ${isOk ? 'ok' : isErr ? 'err' : 'neutral'}">
      ${isOk ? `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`
              : isErr ? `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
              : `<svg viewBox="0 0 24 24"><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>`}
    </div>
  </div>`;
}

function renderActivityFeed(activities) {
  const filter = FILTERS.find((f) => f.id === activityFilter) || FILTERS[0];
  const rows = activities.filter(filter.match);

  if (!rows.length) {
    return `
    <div class="dash-feed-empty">
      <div class="dash-feed-empty-icon">
        <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      </div>
      <div class="dash-feed-empty-text">${activities.length ? 'Nothing in this view' : 'No activity yet'}</div>
      <div class="dash-feed-empty-sub">${activities.length ? 'Try another filter' : 'Sends, schedules and member changes will appear here'}</div>
    </div>`;
  }

  const parts = [];
  let lastDay = '';
  for (const entry of rows) {
    const day = dayLabel(entry.ts);
    if (day !== lastDay) {
      parts.push(`<div class="dash-feed-day">${escapeHtml(day)}</div>`);
      lastDay = day;
    }
    parts.push(renderActivityRow(entry));
  }
  return parts.join('');
}

export function renderDashboard() {
  const container = document.getElementById('page-dashboard');
  if (!container) return;

  const { groups, schedules, sets } = getState();
  const srv = serverActivity();
  const stats = getActivityStats(24, srv);
  const activities = getActivities(srv);
  const progress = getActiveProgress();

  const upcoming = [...(schedules || [])].filter((s) => new Date(s.runAt) > Date.now());
  const overdue  = [...(schedules || [])].filter((s) => new Date(s.runAt) <= Date.now());

  container.innerHTML = `

    ${renderProgressCard(progress)}

    <!-- Stats strip -->
    <div class="dash-stats-strip">
      <div class="dash-stat-card">
        <div class="dash-stat-val">${groups.length}</div>
        <div class="dash-stat-lbl">Groups</div>
      </div>
      <div class="dash-stat-card accent">
        <div class="dash-stat-val">${upcoming.length}</div>
        <div class="dash-stat-lbl">Scheduled</div>
      </div>
      <div class="dash-stat-card ${stats.err > 0 ? 'warn' : ''}">
        <div class="dash-stat-val">${stats.sends}</div>
        <div class="dash-stat-lbl">Sends today</div>
      </div>
      <div class="dash-stat-card ${stats.err > 0 ? 'err' : ''}">
        <div class="dash-stat-val">${stats.err}</div>
        <div class="dash-stat-lbl">Errors</div>
      </div>
    </div>

    <!-- Upcoming schedules -->
    <div class="dash-section">
      <div class="dash-section-header">
        <span class="dash-section-title">Upcoming</span>
        ${upcoming.length ? `<button type="button" class="dash-section-link" data-nav="schedule">See all ›</button>` : ''}
      </div>
      <div class="dash-sched-list">
        ${renderUpcoming(schedules, sets)}
      </div>
    </div>

    ${overdue.length ? `
    <div class="dash-section">
      <div class="dash-section-header">
        <span class="dash-section-title dash-overdue-title">⚠ Overdue (${overdue.length})</span>
      </div>
      <div class="dash-sched-list">
        ${overdue.map((s) => {
          const name = s.isSet ? s.target : jidToName(s.target);
          return `<div class="dash-sched-row overdue">
            <div class="dash-sched-dot overdue"></div>
            <div class="dash-sched-main">
              <div class="dash-sched-target">${escapeHtml(name)}</div>
              <div class="dash-sched-meta">Was due ${escapeHtml(new Date(s.runAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }))}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    <!-- Activity feed -->
    <div class="dash-section">
      <div class="dash-section-header">
        <span class="dash-section-title">Activity log</span>
        ${activities.length ? `<button type="button" class="dash-section-link dash-clear-btn" id="dash-clear-log">Clear local</button>` : ''}
      </div>
      ${renderFeedFilters()}
      <div class="dash-feed" id="dash-feed">
        ${renderActivityFeed(activities)}
      </div>
    </div>

    <div style="height: 32px"></div>
  `;

  // Navigation links — schedule is a Tools sub-page now, not a tab
  container.querySelectorAll('[data-nav="schedule"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pushSub('schedule', 'Schedule');
      renderSchedule();
    });
  });

  // Feed filters
  container.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activityFilter = btn.dataset.filter;
      container.querySelectorAll('[data-filter]').forEach((b) => {
        const on = b.dataset.filter === activityFilter;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      patchFeed();
    });
  });

  // Clear log (local optimistic layer only — server history is kept)
  container.querySelector('#dash-clear-log')?.addEventListener('click', () => {
    clearActivities();
    toast('Local activity cleared', 'ok');
    renderDashboard();
  });
}

// Live refresh: update just the progress card + feed when events fire
function patchProgressCard() {
  const container = document.getElementById('page-dashboard');
  if (!container?.classList.contains('active')) return;
  // Re-render progress section only
  const old = container.querySelector('#dash-live-card');
  const progress = getActiveProgress();
  if (progress) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderProgressCard(progress);
    const newCard = tmp.firstElementChild;
    if (old) old.replaceWith(newCard);
    else container.prepend(newCard);
  } else {
    old?.remove();
  }
}

function patchFeed() {
  const feed = document.getElementById('dash-feed');
  if (!feed) return;
  feed.innerHTML = renderActivityFeed(getActivities(serverActivity()));
}

/**
 * Show shimmer placeholders immediately while data loads.
 * Call this once before refreshCore(), replaced by renderDashboard() after.
 */
export function renderDashboardSkeleton() {
  const container = document.getElementById('page-dashboard');
  if (!container) return;
  container.innerHTML = `
    <div class="dash-skeleton-strip">
      ${Array(4).fill('<div class="skeleton dash-skeleton-card"></div>').join('')}
    </div>
    <div class="skeleton" style="height:72px;border-radius:22px;margin-bottom:16px"></div>
    <div class="dash-skeleton-strip" style="margin-bottom:8px">
      ${Array(3).fill('<div class="skeleton dash-skeleton-row"></div>').join('')}
    </div>
    ${Array(4).fill('<div class="skeleton" style="height:56px;border-radius:16px;margin-bottom:8px"></div>').join('')}
  `;
}

// Subscribe to live events
window.addEventListener('sandesha:progress', patchProgressCard);
window.addEventListener('sandesha:activity', () => {
  const container = document.getElementById('page-dashboard');
  if (!container?.classList.contains('active')) return;
  patchFeed();
  // refresh stat strip
  const { schedules, groups } = getState();
  const stats = getActivityStats(24, serverActivity());
  const upcoming = (schedules || []).filter((s) => new Date(s.runAt) > Date.now());
  const valEls = container.querySelectorAll('.dash-stat-val');
  if (valEls[0]) valEls[0].textContent = groups.length;
  if (valEls[1]) valEls[1].textContent = upcoming.length;
  if (valEls[2]) valEls[2].textContent = stats.sends;
  if (valEls[3]) valEls[3].textContent = stats.err;
});

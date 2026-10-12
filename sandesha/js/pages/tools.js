/**
 * Tools — every Sandesha feature in one list, each opened as a sub-page.
 * Compose, Audience (groups/sets/contacts/numbers) and Schedule used to be
 * separate bottom-nav tabs; now they're entries here, alongside Dashboard.
 */
import { pushSub } from '../router.js';
import { renderSend } from './send.js';
import { renderAudience } from './audience.js';
import { renderSchedule } from './schedule.js';

const TOOLS = [
  {
    id: 'compose',
    title: 'Compose',
    sub: 'Send a message to a group, set, or number',
    icon: `<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
    open: () => { pushSub('compose', 'Compose'); renderSend(); },
  },
  {
    id: 'audience',
    title: 'Audience',
    sub: 'Groups, sets, contacts & numbers',
    icon: `<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    open: () => { pushSub('audience', 'Audience'); renderAudience(); },
  },
  {
    id: 'schedule',
    title: 'Schedule',
    sub: 'Upcoming and automated sends',
    icon: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="16" r="1.5" fill="currentColor"/></svg>`,
    open: () => { pushSub('schedule', 'Schedule'); renderSchedule(); },
  },
];

export function renderTools() {
  const container = document.getElementById('page-tools');
  if (!container) return;

  container.innerHTML = `
    <div class="list-group">
      ${TOOLS.map((t) => `
        <button type="button" class="list-row" data-tool="${t.id}">
          <div class="tool-tile-icon" data-item="${t.id}" aria-hidden="true">${t.icon}</div>
          <div class="row-main">
            <div class="row-title">${t.title}</div>
            <div class="row-sub">${t.sub}</div>
          </div>
          <span class="chevron">›</span>
        </button>`).join('')}
    </div>`;

  container.querySelectorAll('[data-tool]').forEach((btn) => {
    const tool = TOOLS.find((t) => t.id === btn.dataset.tool);
    btn.addEventListener('click', () => tool?.open());
  });
}

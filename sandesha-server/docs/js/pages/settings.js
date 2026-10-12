import { escapeHtml } from '../api.js';
import { getState } from '../store.js';
import { doLogout } from '../auth.js';
import { openSend } from './send.js';
import { openGroups } from './groups.js';
import { openSets } from './sets.js';
import { openContacts } from './contacts.js';
import { openBulk } from './bulk.js';
import { openAddMembers } from './add-members.js';
import { openAi } from './ai.js';
import { openStatus } from './home.js';
import { openHelp } from './help.js';
import { canPromptInstall, promptInstall } from '../pwa.js';
import { describeWhatsAppStatus } from '../wa-status.js';

const container = document.getElementById('page-settings');

const TOOL_MARK = {
  send: 'SN',
  groups: 'GR',
  sets: 'ST',
  contacts: 'CT',
  bulk: 'BK',
  'add-members': 'AM',
  ai: 'AI',
  status: 'OK',
  help: '?',
};

export function renderSettings() {
  if (!container) return;
  const { health, groups, aiAvailable } = getState();
  const st = describeWhatsAppStatus(health, { groups: groups.length });

  const items = [
    { id: 'send', label: 'Send', sub: 'Message sets, groups, or contacts' },
    { id: 'groups', label: 'Groups', sub: 'Search, activity, members' },
    { id: 'sets', label: 'Sets', sub: 'Group collections for bulk send' },
    { id: 'contacts', label: 'Contacts', sub: 'Saved phone numbers' },
    { id: 'bulk', label: 'Bulk send', sub: 'Message many numbers' },
    { id: 'add-members', label: 'Add members', sub: 'Add numbers to a group' },
    ...(aiAvailable ? [{ id: 'ai', label: 'AI chat', sub: 'ZeroClaw assistant' }] : []),
    { id: 'status', label: 'Status', sub: 'Connection and recent activity' },
    { id: 'help', label: 'Help', sub: 'Command reference' },
  ];

  container.innerHTML = `
    <div class="card">
      <div class="row-center">
        <span class="status-dot ${st.dot}"></span>
        <div>
          <div class="status-line">${escapeHtml(st.line)}</div>
          <div class="status-sub">${escapeHtml(st.sub)}</div>
        </div>
      </div>
      ${health?.commandsGroupName ? `<p class="hint mt-sm mb-0">Commands: ${escapeHtml(health.commandsGroupName)}</p>` : ''}
      ${st.showPairHelp && st.pairHelp ? `<p class="hint mt-sm mb-0">${escapeHtml(st.pairHelp)}</p>` : ''}
      ${st.showPairHelp && health?.whatsapp?.pairingCode ? `<p class="pairing-code mt-sm mb-0" style="font-size:1.35rem">${escapeHtml(health.whatsapp.pairingCode)}</p>` : ''}
    </div>

    <h2 class="section-label">Tools</h2>
    <div class="list-group">
      ${items.map((item) => `
        <div class="list-row" data-item="${escapeHtml(item.id)}" tabindex="0" role="button">
          <span class="row-icon" aria-hidden="true">${TOOL_MARK[item.id] || '·'}</span>
          <div class="row-main">
            <div class="row-title">${escapeHtml(item.label)}</div>
            <div class="row-sub">${escapeHtml(item.sub)}</div>
          </div>
          <span class="chevron">›</span>
        </div>`).join('')}
    </div>

    <div class="card mt-lg">
      <h2>App</h2>
      ${canPromptInstall() ? `
        <p class="hint">Install Sandesha on your home screen for full-screen use.</p>
        <button type="button" class="btn" id="settings-install">Install app</button>
      ` : `
        <p class="hint mb-0">You're using the installed app, or install isn't available in this browser.</p>
      `}
    </div>

    <div class="card mt-lg">
      <h2>Account</h2>
      <button type="button" class="btn danger" id="settings-logout">Logout</button>
    </div>`;

  const handlers = {
    send: openSend,
    groups: openGroups,
    sets: openSets,
    contacts: openContacts,
    bulk: openBulk,
    'add-members': openAddMembers,
    ai: openAi,
    status: openStatus,
    help: openHelp,
  };

  container.querySelectorAll('[data-item]').forEach((row) => {
    const go = () => {
      const fn = handlers[row.dataset.item];
      if (fn) fn();
    };
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  container.querySelector('#settings-install')?.addEventListener('click', async () => {
    await promptInstall();
  });
  container.querySelector('#settings-logout')?.addEventListener('click', () => doLogout());
}

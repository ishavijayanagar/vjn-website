import { escapeHtml } from '../api.js';
import { getState, refreshCore, refreshAiStatus } from '../store.js';
import { doLogout } from '../auth.js';
import { openAi } from './ai.js';
import { openStatus } from './home.js';
import { openHelp } from './help.js';
import { canPromptInstall, promptInstall } from '../pwa.js';
import { describeWhatsAppStatus } from '../wa-status.js';
import { renderApiSettings } from '../api-settings.js';
import { clearSandeshaSession } from '../auth-bridge.js';
import { toast } from '../toast.js';
import { supported as pushSupported, state as pushState, enable as pushEnable, disable as pushDisable, sendTest as pushTest } from '../push.js';

function host() {
  return document.getElementById('sub-settings') || document.getElementById('page-settings');
}

const TOOL_ICONS = {
  ai: `<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/></svg>`,
  status: `<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  help: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

export function renderSettings() {
  const container = host();
  if (!container) return;
  const { health, groups, aiAvailable } = getState();
  const st = describeWhatsAppStatus(health, { groups: groups.length });

  const items = [
    ...(aiAvailable ? [{ id: 'ai', label: 'AI chat', sub: 'ZeroClaw assistant' }] : []),
    { id: 'status', label: 'Connection status', sub: 'Link state and diagnostics' },
    { id: 'help', label: 'Help', sub: 'Command reference' },
  ];

  const isOnline = st.dot === 'online';
  const isOffline = st.dot === 'offline';
  const waIconClass = isOnline ? 'online' : isOffline ? 'offline' : 'unknown';

  container.innerHTML = `
    <div class="wa-status-card">
      <div class="wa-status-icon ${waIconClass}">
        <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        ${isOnline ? '<span class="wa-pulse"></span>' : ''}
      </div>
      <div class="wa-status-info">
        <div class="wa-status-line">${escapeHtml(st.line)}</div>
        <div class="wa-status-sub">${escapeHtml(st.sub)}</div>
        ${health?.commandsGroupName ? `<div class="wa-status-sub" style="margin-top:4px">Commands: ${escapeHtml(health.commandsGroupName)}</div>` : ''}
      </div>
    </div>
    ${st.showPairHelp && st.pairHelp ? `<p class="hint" style="margin:0 0 12px">${escapeHtml(st.pairHelp)}</p>` : ''}
    ${st.showPairHelp && health?.whatsapp?.pairingCode ? `<div class="wa-pairing-code">${escapeHtml(health.whatsapp.pairingCode)}</div>` : ''}

    <div class="list-group" style="margin-top:14px">
      ${items.map((item) => `
        <button type="button" class="list-row" data-item="${escapeHtml(item.id)}">
          <div class="tool-tile-icon" aria-hidden="true">${TOOL_ICONS[item.id] || ''}</div>
          <div class="row-main">
            <div class="row-title">${escapeHtml(item.label)}</div>
            <div class="row-sub">${escapeHtml(item.sub)}</div>
          </div>
          <span class="chevron">›</span>
        </button>`).join('')}
    </div>

    <div class="settings-footer-card" id="notif-card">
      <h3>Notifications</h3>
      <p class="hint" style="margin:0 0 12px">Get a heads-up ~15 min before scheduled sends, and the result after any job runs — even with the app closed.</p>
      <div class="btn-row">
        <button type="button" class="btn" id="notif-toggle">Loading…</button>
        <button type="button" class="btn secondary" id="notif-test" hidden>Send test</button>
      </div>
      <p class="hint" id="notif-note" style="margin:8px 0 0"></p>
    </div>

    <div id="settings-api-host"></div>

    ${canPromptInstall() ? `
    <div class="settings-footer-card">
      <h3>App</h3>
      <p class="hint" style="margin:0 0 12px">Install on your home screen for full-screen use.</p>
      <button type="button" class="btn secondary" id="settings-install">Install app</button>
    </div>` : ''}
    <div class="settings-footer-card">
      <h3>Account</h3>
      <button type="button" class="btn danger" id="settings-logout">Log out</button>
    </div>`;

  const handlers = { ai: openAi, status: openStatus, help: openHelp };
  container.querySelectorAll('[data-item]').forEach((tile) => {
    tile.addEventListener('click', () => {
      const fn = handlers[tile.dataset.item];
      if (fn) fn();
    });
  });

  container.querySelector('.wa-status-card')?.addEventListener('click', () => openStatus());
  wireNotifications(container);
  container.querySelector('#settings-install')?.addEventListener('click', async () => {
    await promptInstall();
  });
  container.querySelector('#settings-logout')?.addEventListener('click', () => doLogout());

  const apiHost = container.querySelector('#settings-api-host');
  if (apiHost) {
    renderApiSettings(apiHost, {
      onSaved: async () => {
        clearSandeshaSession();
        await refreshCore(false);
        await refreshAiStatus();
        renderSettings();
      },
    });
  }
}

async function wireNotifications(container) {
  const card = container.querySelector('#notif-card');
  const toggle = container.querySelector('#notif-toggle');
  const testBtn = container.querySelector('#notif-test');
  const note = container.querySelector('#notif-note');
  if (!card || !toggle) return;

  if (!pushSupported()) {
    card.hidden = true;
    return;
  }

  async function paint() {
    const s = await pushState();
    toggle.disabled = false;
    testBtn.hidden = s !== 'on';
    if (s === 'denied') {
      toggle.textContent = 'Notifications blocked';
      toggle.disabled = true;
      note.textContent = 'Allow notifications for this site in your browser settings, then reopen this page.';
    } else if (s === 'on') {
      toggle.textContent = 'Turn off notifications';
      toggle.classList.add('secondary');
      note.textContent = 'On — this device will get job results and scheduled-send heads-ups.';
    } else {
      toggle.textContent = 'Turn on notifications';
      toggle.classList.remove('secondary');
      note.textContent = '';
    }
  }

  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    const s = await pushState();
    try {
      if (s === 'on') { await pushDisable(); toast('Notifications off', 'ok'); }
      else { await pushEnable(); toast('Notifications on', 'ok'); }
    } catch (err) {
      toast(err.message || 'Could not change notifications', 'err');
    }
    await paint();
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    try {
      const r = await pushTest();
      toast(r?.sent ? 'Test sent — check your notifications' : 'No device to notify', r?.sent ? 'ok' : 'info');
    } catch (err) {
      toast(err.message || 'Test failed', 'err');
    }
    testBtn.disabled = false;
  });

  paint();
}

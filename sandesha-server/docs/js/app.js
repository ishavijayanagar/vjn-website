import { setUnauthorizedHandler, getApiBase, api } from './api.js';
import { tryRestoreSession, setLoginSuccessHandler, handleUnauthorized } from './auth.js';
import { initRouter, getCurrentTab, getSubPage } from './router.js';
import { refreshCore, refreshAiStatus, subscribe, getState } from './store.js';
import { toast } from './toast.js';
import { renderSchedule } from './pages/schedule.js';
import { renderSettings } from './pages/settings.js';
import { renderSend, openSend } from './pages/send.js';
import { renderGroups, renderGroupDetail, onSubBack } from './pages/groups.js';
import { renderHome } from './pages/home.js';
import { renderSets } from './pages/sets.js';
import { renderContacts } from './pages/contacts.js';
import { renderBulk } from './pages/bulk.js';
import { renderAddMembers } from './pages/add-members.js';
import { renderAi } from './pages/ai.js';
import { renderHelp } from './pages/help.js';
import { initPwa } from './pwa.js';
import { initPullToRefresh } from './pull-refresh.js';
import { updatePairingBanner } from './pairing-banner.js';

const offlineBanner = document.getElementById('offline-banner');

function renderTab(tab) {
  switch (tab) {
    case 'schedule': renderSchedule(); break;
    case 'settings': renderSettings(); break;
    default: break;
  }
}

function renderSub(id) {
  switch (id) {
    case 'send': renderSend(); break;
    case 'groups': renderGroups(); break;
    case 'group-detail': renderGroupDetail(); break;
    case 'sets': renderSets(); break;
    case 'contacts': renderContacts(); break;
    case 'bulk': renderBulk(); break;
    case 'add-members': renderAddMembers(); break;
    case 'ai': renderAi(); break;
    case 'status': renderHome(); break;
    case 'help': renderHelp(); break;
    default: break;
  }
}

async function loadApp(forceGroups = false) {
  try {
    await refreshCore(forceGroups);
    await refreshAiStatus();
    offlineBanner?.classList.add('hidden');
    updatePairingBanner(getState().health);
    renderTab(getCurrentTab());
    const sub = getSubPage();
    if (sub) renderSub(sub);
  } catch (err) {
    const msg = err?.message || 'Failed to load';
    // Health reachable but WhatsApp session broken — not a tunnel outage
    if (/detached Frame|Protocol error|Target closed|Session closed|Evaluation failed/i.test(msg)) {
      offlineBanner?.classList.add('hidden');
      toast('WhatsApp session reconnecting — enter the pairing code if shown above', 'err');
      try {
        const health = await api('/health');
        updatePairingBanner(health);
      } catch { /* ignore */ }
    } else {
      offlineBanner?.classList.remove('hidden');
      toast(msg, 'err');
    }
  }
}

setUnauthorizedHandler(handleUnauthorized);
setLoginSuccessHandler(() => loadApp());

initRouter({
  onTab: (tab) => renderTab(tab),
  onSubBack: (id) => {
    if (id) renderSub(id);
    else onSubBack(id);
    if (!id) renderTab(getCurrentTab());
  },
  onSend: () => openSend(),
});

subscribe(() => {
  updatePairingBanner(getState().health);
  renderTab(getCurrentTab());
  const sub = getSubPage();
  if (sub) renderSub(sub);
});

window.addEventListener('sandesha:refresh', () => loadApp(false)); // groups are re-checked only on pull-to-refresh

initPullToRefresh({
  onRefresh: async () => {
    await loadApp(true);
    toast('Updated', 'ok');
  },
});

async function checkHealth() {
  try {
    const r = await fetch(`${getApiBase()}/health`);
    if (r.ok) {
      offlineBanner?.classList.add('hidden');
      try {
        const data = await r.json();
        // Public health has limited whatsapp; refresh via API when logged in
        if (getState().health || getTokenSafe()) {
          const full = await api('/health').catch(() => data);
          updatePairingBanner(full);
          if (full?.whatsapp && getState().health) {
            getState().health.whatsapp = full.whatsapp;
            if (full.whatsapp.connected && full.info) getState().health.info = full.info;
          }
        } else {
          updatePairingBanner(data);
        }
      } catch { /* ignore parse */ }
    } else offlineBanner?.classList.remove('hidden');
  } catch {
    offlineBanner?.classList.remove('hidden');
  }
}

function getTokenSafe() {
  try {
    return localStorage.getItem('sandesha_token') || sessionStorage.getItem('sandesha_token');
  } catch {
    return '';
  }
}

setInterval(checkHealth, 8000);

initPwa();
tryRestoreSession();

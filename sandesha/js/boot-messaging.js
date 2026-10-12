/**
 * Boot full Sandesha messaging UI inside admin-messaging.html (admin only).
 */
import {
  ensureSandeshaAuth,
  installUnauthorizedRedirect,
  clearSandeshaSession,
} from './auth-bridge.js';
import { refreshCore, refreshAiStatus, subscribe, getState } from './store.js';
import { initRouter, navigate, getCurrentTab, getSubPage, pushSub } from './router.js';
import { renderDashboard, renderDashboardSkeleton } from './pages/dashboard.js';
import { renderTools } from './pages/tools.js';
import { renderSchedule } from './pages/schedule.js';
import { renderSettings } from './pages/settings.js';
import { renderSend } from './pages/send.js';
import { renderGroups, renderGroupDetail, onSubBack } from './pages/groups.js';
import { unmountAddMembers } from './pages/add-members.js';
import { renderHome } from './pages/home.js';
import { renderSets } from './pages/sets.js';
import { renderContacts } from './pages/contacts.js';
import { renderBulk } from './pages/bulk.js';
import { renderAddMembers } from './pages/add-members.js';
import { renderAudience } from './pages/audience.js';
import { renderAi } from './pages/ai.js';
import { renderHelp } from './pages/help.js';
import { updatePairingBanner } from './pairing-banner.js';
import { describeWhatsAppStatus } from './wa-status.js';
import { toast } from './toast.js';
import { initPullToRefresh } from './pull-refresh.js';
import { syncOnLoad as syncPush } from './push.js';

function renderTab(tab) {
  switch (tab) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'tools':
      renderTools();
      break;
    default:
      break;
  }
}

function updateHeaderStatusDot(health) {
  const dot = document.getElementById('header-status-dot');
  if (!dot) return;
  const state = health ? describeWhatsAppStatus(health).dot : 'unknown';
  dot.classList.remove('online', 'offline', 'unknown');
  dot.classList.add(state);
}

function renderSub(id) {
  switch (id) {
    case 'send':
    case 'compose':
      renderSend();
      break;
    case 'audience':
      renderAudience();
      break;
    case 'schedule':
      renderSchedule();
      break;
    case 'settings':
      renderSettings();
      break;
    case 'groups':
      renderGroups();
      break;
    case 'group-detail':
      renderGroupDetail();
      break;
    case 'sets':
      renderSets();
      break;
    case 'contacts':
      renderContacts();
      break;
    case 'bulk':
      renderBulk();
      break;
    case 'add-members':
      renderAddMembers();
      break;
    case 'ai':
      renderAi();
      break;
    case 'status':
      renderHome();
      break;
    case 'help':
      renderHelp();
      break;
    default:
      break;
  }
}

async function loadApp(forceGroups = false) {
  await refreshCore(forceGroups);
  await refreshAiStatus();
  updatePairingBanner(getState().health);
  updateHeaderStatusDot(getState().health);
  renderTab(getCurrentTab());
  const sub = getSubPage();
  if (sub) renderSub(sub);
}

export async function bootAdminMessaging() {
  window.SANDESHA_EMBEDDED = true;
  window.SANDESHA_EMBEDDED_MODE = 'admin';
  installUnauthorizedRedirect();

  // This page never registers sw.js itself — it inherits whatever worker
  // index.html registered, since the worker's scope covers the whole site.
  // Without this, a worker that takes over mid-load leaves this page running
  // stale JS (old tabs/behavior) with no way to notice or recover.
  if ('serviceWorker' in navigator) {
    let swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swRefreshing) return;
      swRefreshing = true;
      window.location.reload();
    });
  }

  const session = await ensureSandeshaAuth();
  if (session.role !== 'admin') {
    toast('Admin login required for messaging settings', 'err');
    window.location.replace('admin-promotions.html');
    return;
  }

  // Hide Sandesha login chrome if present
  document.getElementById('login-view')?.classList.add('hidden');
  document.getElementById('app-view')?.classList.remove('hidden');
  document.getElementById('bottom-nav')?.classList.remove('hidden');

  initRouter({
    onTab: (tab) => renderTab(tab),
    onSubBack: (id, prevId) => {
      // Clean up sub-pages that have background jobs
      if (prevId === 'add-members') unmountAddMembers();
      if (id) renderSub(id);
      else onSubBack(id);
      if (!id) renderTab(getCurrentTab());
    },
  });
  // Sync header title / nav active state to the default tab — nothing else
  // drives this chrome on first paint, only a later navigate()/pushSub().
  // Immediately superseded by the skeleton below, so this never flashes
  // empty content.
  navigate(getCurrentTab());

  // Header gear → Settings sub-page
  document.getElementById('header-settings')?.addEventListener('click', () => {
    if (getSubPage() === 'settings') return;
    pushSub('settings', 'Settings');
    renderSettings();
  });

  subscribe(() => {
    updatePairingBanner(getState().health);
    updateHeaderStatusDot(getState().health);
    // Sub-pages (e.g. add-members) keep their DOM while typing — don't re-render on background refresh.
    if (!getSubPage()) renderTab(getCurrentTab());
  });

  initPullToRefresh({
    onRefresh: async () => {
      await loadApp(true);
      toast('Updated', 'ok');
    },
  });

  // Settings "Logout" should return to VJN admin hub
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#settings-logout');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    clearSandeshaSession();
    window.location.replace('admin.html');
  }, true);

  // Re-render current tab (and refresh server data) whenever any module dispatches sandesha:refresh
  window.addEventListener('sandesha:refresh', () => {
    loadApp(false).catch(() => {});
  });

  // Show shimmer placeholders immediately while API data loads
  renderDashboardSkeleton();

  // Keep the push subscription fresh if the user turned notifications on.
  syncPush().catch(() => {});

  try {
    await loadApp(false);
  } catch (err) {
    toast(err.message || 'Could not load messaging', 'err');
    const banner = document.getElementById('offline-banner');
    banner?.classList.remove('hidden');
  }
}

// Auto-boot when this module is the page entry
if (document.body?.dataset?.sandeshaBoot === 'admin') {
  bootAdminMessaging().catch((err) => {
    console.error(err);
  });
}

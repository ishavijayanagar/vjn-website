/**
 * Mode switcher for admin-promotions.html (Board | Schedule | Send | Banner | Reach).
 */
import {
  showSchedulePanel,
  showSendPanel,
  refreshMessagingData,
  bootPromotionsMessaging,
  resetPromotionsBoot,
} from './boot-promotions.js';
import { installUnauthorizedRedirect, getVjnToken, ensureSandeshaAuth } from './auth-bridge.js';
import { renderApiSettings, updateApiStatus } from './api-settings.js';
import { renderPromoSets } from './pages/promo-sets.js?v=3';
import { toast } from './toast.js';

import { setComposeMode, watchQueueJobs } from './pages/promo-compose.js';
import { renderPromoSchedule } from './pages/promo-schedule.js';
import { renderPromoReach } from './pages/promo-reach.js';
import { bindPromoActivity, closePromoActivity } from './promo-activity.js';
// Registers window.SandeshaPromo for admin-promotions.js (a classic script).
import './promo-relay.js';
import { subscribe, getState, refreshCore, refreshHealth } from './store.js';
import {
  supported as pushSupported, state as pushState, enable as pushEnable,
  disable as pushDisable, syncOnLoad as syncPush, ensureServiceWorker,
} from './push.js';

const MODES = ['board', 'schedule', 'send', 'banner', 'reach', 'server'];
const MODE_KEY = 'promo_sandesha_mode';
let currentMode = 'board';
let bannerUi = null;
/** Where the settings icon returns to when tapped a second time. */
let lastTabMode = 'board';
/** The board owns #dayTitle, so remember its text before borrowing it. */
let boardKicker = '';

function $(id) {
  return document.getElementById(id);
}

function panelHost(mode) {
  if (mode === 'schedule') return $('sandeshaSchedule');
  if (mode === 'send') return $('sandeshaSend');
  if (mode === 'server') return $('sandeshaServer');
  if (mode === 'banner') return $('promoBanner');
  if (mode === 'reach') return $('sandeshaReach');
  return null;
}

function showPanelError(mode, message) {
  const host = panelHost(mode);
  if (!host) return;
  host.innerHTML = `<div class="sandesha-auth-err" role="alert"><p>${message}</p><p class="hint">Try signing out and back in from Settings (gear icon).</p></div>`;
}

function clearPanelError(mode) {
  const host = panelHost(mode);
  if (host?.querySelector('.sandesha-auth-err')) host.innerHTML = '';
}

function persistMode(mode) {
  try {
    if (mode === 'board') sessionStorage.removeItem(MODE_KEY);
    else sessionStorage.setItem(MODE_KEY, mode);
  } catch { /* ignore */ }
}

function panelSkeleton(kind) {
  if (kind === 'compose') {
    return `<div class="skel-panel skel-compose" aria-busy="true" aria-label="Loading compose">
      <div class="sk"></div>
      <div class="sk md"></div>
      <div class="sk lg"></div>
      <div class="sk"></div>
      <div class="sk lg"></div>
    </div>`;
  }
  const cells = Array.from({ length: 7 }, () => '<div class="sk"></div>').join('');
  const rows = Array.from({ length: 3 }, () =>
    `<div class="skel-listrow"><div class="sk sk-time"></div><div class="sk sk-body"></div></div>`
  ).join('');
  return `<div class="skel-panel" aria-busy="true" aria-label="Loading schedule">
    <div class="skel-week">${cells}</div>
    ${rows}
  </div>`;
}

function signedInUser() {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem('vjn_admin_user');
      if (raw) return JSON.parse(raw) || {};
    } catch { /* ignore */ }
  }
  return {};
}

/**
 * WhatsApp link as the header shows it. `tone` picks the dot colour:
 * live (connected), warn (starting / waiting for a scan), down (offline or
 * server unreachable), wait (first check still running).
 */
function linkStatus() {
  const { health, healthError } = getState();
  const known = linkSettled || health != null || healthError;
  const wa = health?.whatsapp;
  const on = !!wa?.connected;
  if (!known) return { known, on, tone: 'wait', text: 'Checking WhatsApp…' };
  if (healthError && !health) return { known, on: false, tone: 'down', text: 'Server unreachable' };
  if (on) {
    const who = String(health?.info?.pushname || '').trim();
    return { known, on, tone: 'live', text: who ? `WhatsApp connected · ${who}` : 'WhatsApp connected' };
  }
  const st = String(wa?.state || '').toLowerCase();
  if (wa?.needsPairing || st === 'pairing') {
    return { known, on, tone: 'warn', text: 'Waiting for WhatsApp link — scan QR' };
  }
  if (st === 'connecting') return { known, on, tone: 'warn', text: 'WhatsApp starting…' };
  return { known, on, tone: 'down', text: 'WhatsApp not connected' };
}

/** Second header line for the Sandesha tabs. Schedule writes its own month range. */
function paintKicker() {
  const el = $('dayTitle');
  if (!el) return;
  if (currentMode === 'send') {
    const { tone, text } = linkStatus();
    el.innerHTML = `<span class="kicker-dot ${tone}" aria-hidden="true"></span>`;
    el.appendChild(document.createTextNode(text));
  } else if (currentMode === 'banner') {
    el.textContent = 'Homepage banner';
  } else if (currentMode === 'reach') {
    el.textContent = 'How far your posts went';
  } else if (currentMode === 'server') {
    const user = signedInUser();
    const name = String(user.name || '').trim();
    const role = String(user.role || '').trim();
    const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : '';
    el.textContent = [name, roleLabel].filter(Boolean).join(' · ') || 'Signed in';
  }
}

function setMode(mode) {
  if (!MODES.includes(mode)) mode = 'board';
  const prev = currentMode;
  currentMode = mode;
  if (mode !== 'server') lastTabMode = mode;
  persistMode(mode);
  const phone = $('app');
  const isSandesha = mode !== 'board';

  phone?.classList.toggle('is-sandesha-mode', isSandesha);

  document.querySelectorAll('[data-promo-mode]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.promoMode === mode);
  });
  const profileBtn = $('serverUrlBtn');
  profileBtn?.classList.toggle('on', mode === 'server');
  profileBtn?.setAttribute('aria-pressed', mode === 'server' ? 'true' : 'false');

  $('sandeshaSchedule')?.classList.toggle('is-active', mode === 'schedule');
  $('sandeshaSend')?.classList.toggle('is-active', mode === 'send');
  $('sandeshaServer')?.classList.toggle('is-active', mode === 'server');
  $('promoBanner')?.classList.toggle('is-active', mode === 'banner');
  $('sandeshaReach')?.classList.toggle('is-active', mode === 'reach');

  const dayTitle = $('dayTitle');
  if (dayTitle) {
    if (isSandesha) {
      if (!boardKicker) boardKicker = dayTitle.textContent || '';
      // Schedule sets its own kicker to the month range it is showing.
      paintKicker();
    } else if (boardKicker) {
      dayTitle.textContent = boardKicker;
      boardKicker = '';
    }
  }

  if (mode === 'schedule') {
    clearPanelError('schedule');
    const host = $('sandeshaSchedule');
    if (host && !host.querySelector('.listrow, .empty, .sandesha-auth-err')) {
      host.innerHTML = panelSkeleton('schedule');
    }
    showSchedulePanel().catch((err) => {
      showPanelError('schedule', err?.message || 'Could not load schedule');
    });
  } else if (mode === 'send') {
    clearPanelError('send');
    const host = $('sandeshaSend');
    if (host && !host.querySelector('.toggle, .sandesha-auth-err')) {
      host.innerHTML = panelSkeleton('compose');
    }
    showSendPanel().catch((err) => {
      showPanelError('send', err?.message || 'Could not load send');
    });
  } else if (mode === 'banner') {
    const host = $('promoBanner');
    if (host && !bannerUi) bannerUi = window.VjnBanner.mount(host, { token: getVjnToken });
    else bannerUi?.reload();
  } else if (mode === 'reach') {
    const host = $('sandeshaReach');
    if (host) renderPromoReach(host);
  } else if (mode === 'server') {
    bindPromoActivity();
    renderPromoSets($('promoSetsHost'));
    const host = $('sandeshaApiHost') || $('sandeshaServer');
    if (host) {
      renderApiSettings(host, {
        variant: 'ios',
        showServer: false,
        getHealth: () => getState().health,
        onSaved: async () => {
          resetPromotionsBoot();
          await bootPromotionsMessaging();
          if (currentMode === 'schedule') showSchedulePanel().catch(() => {});
          if (currentMode === 'send') showSendPanel().catch(() => {});
        },
      });
    }
  } else if (mode === 'board' && prev !== 'board') {
    closePromoActivity();
    window.dispatchEvent(new CustomEvent('promo:board-show'));
  } else if (mode !== 'server') {
    closePromoActivity();
  }
}

function bindModeBar() {
  document.querySelectorAll('[data-promo-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.promoMode || 'board'));
  });
  // A second tap on the settings icon goes back to the tab it was opened from.
  $('serverUrlBtn')?.addEventListener('click', () => {
    setMode(currentMode === 'server' ? lastTabMode : 'server');
  });
}

function initialMode() {
  try {
    const saved = sessionStorage.getItem(MODE_KEY);
    if (saved && MODES.includes(saved)) return saved;
  } catch { /* ignore */ }
  return 'board';
}

let linkSettled = false;

function syncSandeshaDot() {
  const health = getState().health;
  const { known, on } = linkStatus();
  // Only a broken link earns a badge; a healthy one needs no attention.
  const dot = $('sandeshaDot');
  if (dot) dot.hidden = !(known && !on);
  const composeTab = document.querySelector('.tabbar [data-promo-mode="send"]');
  if (composeTab) {
    composeTab.setAttribute('aria-label', known && !on ? 'Compose — WhatsApp not connected' : 'Compose');
  }
  paintKicker();
  updateApiStatus($('sandeshaApiHost'), health);
}

async function watchSandeshaLink() {
  try {
    await ensureSandeshaAuth();
    // Schedules handed to the server before a reload still need their outcome shown.
    watchQueueJobs();
    await refreshCore(false);
    syncPush().catch(() => {});
  } catch {
    /* disconnected — the red dot stays */
  }
  linkSettled = true;
  syncSandeshaDot();
  startHealthPolling();
}

/** Keep the status honest after a Pi reboot or a dropped link — health only, visible tab only. */
let healthTimer = null;
function startHealthPolling() {
  if (healthTimer) return;
  const tick = () => { if (!document.hidden) refreshHealth().catch(() => {}); };
  healthTimer = setInterval(tick, 15000);
  document.addEventListener('visibilitychange', tick);
}

async function wirePromoNotifications() {
  const btn = $('notifyBtn');
  if (!btn) return;
  btn.onclick = null;
  btn.hidden = false;

  if (!pushSupported()) {
    btn.classList.add('is-off');
    btn.title = 'Push alerts need Chrome or an installed app';
    btn.addEventListener('click', () => {
      toast('Use Chrome and install Promotions as an app for alerts before scheduled sends', 'info', 4500);
    });
    return;
  }

  async function paint() {
    const s = await pushState();
    btn.classList.remove('is-busy');
    btn.classList.toggle('is-on', s === 'on');
    btn.classList.toggle('is-off', s !== 'on');
    btn.setAttribute('aria-pressed', s === 'on' ? 'true' : 'false');
    btn.title = s === 'denied'
      ? 'Notifications blocked in browser settings'
      : s === 'on' ? 'Notifications on — tap to turn off' : 'Turn on notifications';
    btn.disabled = s === 'denied';
  }
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('is-busy')) return;
    btn.classList.add('is-busy');
    btn.disabled = true;
    const s = await pushState();
    try {
      if (s === 'on') {
        await pushDisable();
        toast('Notifications turned off', 'ok', 3500);
      } else {
        toast('Turning notifications on…', 'info', 2000);
        await pushEnable();
        toast('Notifications on — you’ll get a heads-up ~15 min before each scheduled send', 'ok', 4500);
      }
    } catch (err) {
      toast(err.message || 'Could not change notifications', 'err', 4500);
    }
    await paint();
  });
  paint();
}

installUnauthorizedRedirect();
ensureServiceWorker().catch(() => {});
bindModeBar();
setMode(initialMode());
subscribe(syncSandeshaDot);
syncSandeshaDot();
watchSandeshaLink();
startLiveRefresh();
bindPromoActivity();
// After admin-promotions.js bindChrome() so we win the notify button.
if (document.readyState === 'complete') wirePromoNotifications();
else window.addEventListener('load', wirePromoNotifications, { once: true });

window.addEventListener('sandesha:refresh', async () => {
  if (currentMode === 'board') {
    window.dispatchEvent(new CustomEvent('promo:board-show'));
    return;
  }
  await refreshMessagingData();
  if (currentMode === 'schedule') showSchedulePanel().catch(() => {});
});

/** Keep Schedule / Reach in step with the server while the tab stays open. */
let liveRefreshTimer = null;
function startLiveRefresh() {
  if (liveRefreshTimer) return;
  const tick = async () => {
    if (document.hidden || !getVjnToken()) return;
    if (currentMode === 'schedule') {
      try {
        await refreshMessagingData();
        renderPromoSchedule();
      } catch { /* toast inside refresh */ }
    } else if (currentMode === 'reach') {
      const host = $('sandeshaReach');
      if (host?.classList.contains('is-active')) renderPromoReach(host);
    }
  };
  liveRefreshTimer = setInterval(tick, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
}

window.addEventListener('promo:goto', (ev) => {
  const mode = ev.detail?.mode;
  if (mode) setMode(mode);
});

window.addEventListener('promo:compose', (ev) => {
  setComposeMode(!!ev.detail?.later);
  setMode('send');
});

// The board editor lives on the Board tab, so switch there before it opens.
window.addEventListener('promo:edit-post', () => setMode('board'));

window.addEventListener('sandesha:reauth', () => {
  if (currentMode === 'schedule') showSchedulePanel().catch(() => {});
  else if (currentMode === 'send') showSendPanel().catch(() => {});
});

window.addEventListener('sandesha:auth-failed', (ev) => {
  const msg = ev.detail?.message || 'Messaging session expired';
  toast(msg, 'err');
  if (currentMode === 'schedule' || currentMode === 'send') {
    showPanelError(currentMode, msg);
  } else if (!getVjnToken()) {
    window.location.replace('admin.html?next=admin-promotions.html');
  }
});

export { setMode };

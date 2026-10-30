/**
 * Boot Sandesha Schedule + Send panels inside admin-promotions.html.
 * The board does not call this. Schedule and Send load their own screens.
 */
import {
  ensureSandeshaAuth,
  installUnauthorizedRedirect,
} from './auth-bridge.js';
import { refreshSchedules, refreshHealth, getState, ensureGroups, ensureSets } from './store.js?v=34';
import { updatePairingBanner } from './pairing-banner.js';
import { toast } from './toast.js';

let booted = false;
let bootPromise = null;

export function resetPromotionsBoot() {
  booted = false;
  bootPromise = null;
}

/** Auth and health only. Groups are loaded by the tab that needs names. */
export async function bootPromotionsMessaging() {
  if (booted) return;
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    installUnauthorizedRedirect();
    window.SANDESHA_EMBEDDED = true;
    window.SANDESHA_EMBEDDED_MODE = 'promotions';

    await ensureSandeshaAuth();
    await refreshHealth();

    updatePairingBanner(getState().health);
    booted = true;
  })();

  try {
    await bootPromise;
  } catch (err) {
    bootPromise = null;
    toast(err.message || 'Could not connect messaging', 'err');
    throw err;
  }
}

export async function showSchedulePanel() {
  await ensureSandeshaAuth();
  const { renderPromoSchedule } = await import('./pages/promo-schedule.js?v=36');
  if (getState().schedules.length) renderPromoSchedule();
  await refreshSchedules();
  updatePairingBanner(getState().health);
  renderPromoSchedule();
  // Names for the rows. The queue is already on screen.
  Promise.all([ensureGroups(), ensureSets()])
    .then(() => renderPromoSchedule())
    .catch(() => {});
}

export async function showSendPanel() {
  await ensureSandeshaAuth();
  const { renderPromoCompose } = await import('./pages/promo-compose.js?v=36');
  renderPromoCompose();
  refreshHealth().then((health) => updatePairingBanner(health)).catch(() => {});
}

/**
 * After a change to the queue only the queue needs re-reading. A full refresh
 * (every group re-checked) is what /groups costs minutes for on the Pi, so it
 * only happens when asked for.
 */
export async function refreshMessagingData({ full = false } = {}) {
  try {
    if (full) {
      const { refreshCore } = await import('./store.js?v=34');
      await refreshCore(true);
    } else {
      await refreshSchedules();
    }
    updatePairingBanner(getState().health);
  } catch (err) {
    toast(err.message || 'Refresh failed', 'err');
  }
}

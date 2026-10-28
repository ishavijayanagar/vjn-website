/**
 * Boot Sandesha Schedule + Send panels inside admin-promotions.html.
 * Promotions role: Schedule and Send only (no Settings tools).
 */
import {
  ensureSandeshaAuth,
  installUnauthorizedRedirect,
} from './auth-bridge.js';
import { refreshCore, refreshSchedules, getState } from './store.js';
import { renderPromoSchedule } from './pages/promo-schedule.js';
import { renderPromoCompose } from './pages/promo-compose.js';
import { updatePairingBanner } from './pairing-banner.js';
import { toast } from './toast.js';

let booted = false;
let bootPromise = null;

export function resetPromotionsBoot() {
  booted = false;
  bootPromise = null;
}

export async function bootPromotionsMessaging() {
  if (booted) return;
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    installUnauthorizedRedirect();
    window.SANDESHA_EMBEDDED = true;
    window.SANDESHA_EMBEDDED_MODE = 'promotions';

    await ensureSandeshaAuth();
    await refreshCore(false);

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
  if (booted) {
    renderPromoSchedule();
    return;
  }
  // The full boot also waits for /groups and /chats, which can take minutes (or
  // fail) while WhatsApp loads. The schedule only needs the queue, so draw it
  // from the last visit's copy at once, refresh it as soon as /schedules
  // answers, and let the rest finish in the background.
  await ensureSandeshaAuth();
  if (getState().schedules.length) renderPromoSchedule();
  await refreshSchedules();
  updatePairingBanner(getState().health);
  renderPromoSchedule();
  bootPromotionsMessaging().then(() => renderPromoSchedule()).catch(() => {});
}

export async function showSendPanel() {
  if (booted) {
    renderPromoCompose();
    return;
  }
  // The form needs nothing from WhatsApp to draw (the audience list is read when
  // it is opened), and /groups and /chats can take minutes on the Pi. Draw it
  // now and let the rest load in the background.
  await ensureSandeshaAuth();
  renderPromoCompose();
  bootPromotionsMessaging().catch(() => {});
}

/**
 * After a change to the queue only the queue needs re-reading. A full refresh
 * (every group re-checked) is what /groups costs minutes for on the Pi, so it
 * only happens when asked for.
 */
export async function refreshMessagingData({ full = false } = {}) {
  if (!booted && full) return;
  try {
    if (full) await refreshCore(true);
    else await refreshSchedules();
    updatePairingBanner(getState().health);
  } catch (err) {
    toast(err.message || 'Refresh failed', 'err');
  }
}

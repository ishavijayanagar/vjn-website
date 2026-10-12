/**
 * Boot Sandesha Schedule + Send panels inside admin-promotions.html.
 * Promotions role: Schedule and Send only (no Settings tools).
 */
import {
  ensureSandeshaAuth,
  installUnauthorizedRedirect,
} from './auth-bridge.js';
import { refreshCore, getState } from './store.js';
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
  await bootPromotionsMessaging();
  renderPromoSchedule();
}

export async function showSendPanel() {
  await bootPromotionsMessaging();
  renderPromoCompose();
}

export async function refreshMessagingData() {
  if (!booted) return;
  try {
    await refreshCore(true);
    updatePairingBanner(getState().health);
  } catch (err) {
    toast(err.message || 'Refresh failed', 'err');
  }
}

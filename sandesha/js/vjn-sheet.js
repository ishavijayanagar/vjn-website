/**
 * The few writes Sandesha screens make back to the VJN promotions sheet.
 *
 * Kept separate from promo-relay.js so the Schedule screen can reach it
 * without importing the board's bridge, which would close an import cycle.
 */
import { getVjnToken } from './auth-bridge.js';

function appsScriptUrl() {
  if (typeof APPS_SCRIPT_URL === 'string' && APPS_SCRIPT_URL) return APPS_SCRIPT_URL;
  return typeof window !== 'undefined' ? window.APPS_SCRIPT_URL || '' : '';
}

async function postToSheet(payload) {
  const url = appsScriptUrl();
  const token = getVjnToken();
  if (!url || !token) return false;
  try {
    const full = { ...payload, token };
    const piReply = window.PiPromos ? await window.PiPromos.route(full) : undefined;
    if (piReply !== undefined) return !piReply?.error;
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(full) });
    const data = await res.json();
    return !data?.error;
  } catch {
    return false;
  }
}

/**
 * Record that a board post went out by hand, so the Board stops showing it as
 * due and nobody posts it a second time.
 */
export async function markBoardPostSent(promoId) {
  if (!promoId) return false;
  return postToSheet({ formType: 'adminMarkPromotionSent', id: String(promoId) });
}

/**
 * Forget the queue a board post was holding.
 *
 * Cancelling a row from the Schedule tab would otherwise look identical to
 * Sandesha having delivered it, and the board would mark the post Sent. Only
 * the sheet can tell those apart, so the ids are cleared there directly.
 */
export async function releaseBoardPost(promoId) {
  if (!promoId) return false;
  return postToSheet({
    formType: 'adminSavePromotion',
    id: String(promoId),
    wa_schedule_ids: '',
  });
}

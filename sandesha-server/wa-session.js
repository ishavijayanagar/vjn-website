'use strict';

/**
 * Puppeteer / whatsapp-web.js errors when the browser tab or frame is gone, or when
 * WhatsApp Web's page was reloaded under the library: the helpers it injected
 * (window.WWebJS, Store) are then missing, and every call fails with
 * "Cannot read properties of undefined (reading 'getChat')" and the like. Only a
 * reconnect fixes that, so it counts as a session error.
 */
function isWhatsAppSessionError(err) {
  if (err && err.code === 'WA_NOT_READY') return true;
  const msg = String(err?.message || err || '');
  return /detached Frame|Session closed|Target closed|Execution context was destroyed|Protocol error|Evaluation failed|browser has disconnected|Navigation failed|WWebJS|Cannot read properties of (undefined|null) \(reading '(getChat|getChats|getContact|getContactById|getMessageById|getLabels|sendMessage|getNumberId|getChatById)'\)/i.test(msg);
}

/** The page's injected helpers are missing: broken, or simply not loaded yet. */
function isHelperMissingError(err) {
  const msg = String(err?.message || err || '');
  return /WWebJS|Cannot read properties of (undefined|null) \(reading '(getChat|getChats|getContact|getContactById|getMessageById|getLabels|sendMessage|getNumberId|getChatById)'\)/i.test(msg);
}

/**
 * Whether an error should make Sandesha tear the WhatsApp page down and start it
 * again. Not while it is still starting up: the helpers are legitimately missing
 * until WhatsApp Web has finished loading, and restarting then only restarts the
 * wait (and, with the page polling, never lets it finish).
 */
function needsReconnect(err, linkState) {
  if (!isWhatsAppSessionError(err)) return false;
  if (err && err.code === 'WA_NOT_READY') return false;
  if (isHelperMissingError(err) && linkState !== 'connected') return false;
  return true;
}

module.exports = { isWhatsAppSessionError, isHelperMissingError, needsReconnect };

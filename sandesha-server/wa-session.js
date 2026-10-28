'use strict';

/**
 * Puppeteer / whatsapp-web.js errors when the browser tab or frame is gone, or when
 * WhatsApp Web's page was reloaded under the library: the helpers it injected
 * (window.WWebJS, Store) are then missing, and every call fails with
 * "Cannot read properties of undefined (reading 'getChat')" and the like. Only a
 * reconnect fixes that, so it counts as a session error.
 */
function isWhatsAppSessionError(err) {
  const msg = String(err?.message || err || '');
  return /detached Frame|Session closed|Target closed|Execution context was destroyed|Protocol error|Evaluation failed|browser has disconnected|Navigation failed|WWebJS|Cannot read properties of (undefined|null) \(reading '(getChat|getChats|getContact|getContactById|getMessageById|getLabels|sendMessage|getNumberId|getChatById)'\)/i.test(msg);
}

module.exports = { isWhatsAppSessionError };

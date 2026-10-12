'use strict';

/** Puppeteer / whatsapp-web.js errors when the browser tab or frame is gone. */
function isWhatsAppSessionError(err) {
  const msg = String(err?.message || err || '');
  return /detached Frame|Session closed|Target closed|Execution context was destroyed|Protocol error|Evaluation failed|browser has disconnected|Navigation failed/i.test(msg);
}

module.exports = { isWhatsAppSessionError };

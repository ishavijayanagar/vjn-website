'use strict';

/**
 * whatsapp-web.js 1.34 spreads a flyer's MediaData onto the outgoing message.
 * On current WhatsApp Web that model has an enumerable private id (__x_id).
 * It lands beside the real message id, and WhatsApp then refuses the send:
 * "Data passed to getter must include an id property … but got undefined".
 * Text-only sends never touch MediaData, so only flyer sends fail.
 *
 * The library has not shipped the one-line fix yet. Apply it to the injected
 * file before the browser is launched, so a restart picks it up. A later
 * release that already contains the line is left alone.
 */

const fs = require('fs');
const path = require('path');

const ANCHOR = "        // Bot's won't reply if canonicalUrl is set (linking)\n";
const INSERT = "        // MediaData's private id collides with the message id. Drop it.\n        delete message.__x_id;\n\n";

function patchSendSource(text) {
  if (text.includes('delete message.__x_id;')) return text;
  if (!text.includes(ANCHOR)) return null;
  return text.replace(ANCHOR, INSERT + ANCHOR);
}

function patchWwebjsSend(file = path.join(__dirname, 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js')) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const next = patchSendSource(text);
  if (next == null) return false;
  if (next !== text) fs.writeFileSync(file, next);
  return true;
}

module.exports = { patchSendSource, patchWwebjsSend };

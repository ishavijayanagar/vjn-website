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

// The library ends every send with Msg.get(newMsgKey._serialized). When WhatsApp Web files the new message
// under a slightly different key (a LID chat, or a group that has not acked yet) that returns nothing, so the
// caller gets no message id back and Reach has nothing to measure. Look it up by its short id instead, and
// give WhatsApp Web a moment to add it.
const RETURN_OLD = "        return window\n            .require('WAWebCollections')\n            .Msg.get(newMsgKey._serialized);\n    };\n";
const RETURN_NEW = `        // Sandesha: find the sent message even when it is filed under another form of the chat id.
        const sentMsgs = window.require('WAWebCollections').Msg;
        const findSent = () =>
            sentMsgs.get(newMsgKey._serialized) ||
            (sentMsgs.getModelsArray ? sentMsgs.getModelsArray() : sentMsgs.models || []).find(
                (m) => m && m.id && m.id.fromMe && m.id.id === newMsgKey.id,
            );
        let sentMsg = findSent();
        for (let i = 0; !sentMsg && i < 20; i++) {
            await new Promise((r) => setTimeout(r, 250));
            sentMsg = findSent();
        }
        return sentMsg;
    };
`;

function patchSendSource(text) {
  let out = text;
  if (!out.includes('delete message.__x_id;')) {
    if (!out.includes(ANCHOR)) return null;
    out = out.replace(ANCHOR, INSERT + ANCHOR);
  }
  if (!out.includes('findSent') && out.includes(RETURN_OLD)) out = out.replace(RETURN_OLD, RETURN_NEW);
  return out;
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

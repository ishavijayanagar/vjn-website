'use strict';

/**
 * whatsapp-web.js 1.34.7 on WA Web 2.3000.x needs:
 * - mimetype passed to downloadAndMaybeDecrypt (wwebjs #201908)
 * - msg id fallback for @lid ($1 / reconstructed key) (#201830)
 * Sandesha also uses wweb-media-download.js; this patch fixes msg.downloadMedia() fallbacks.
 */

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../node_modules/whatsapp-web.js/src/structures/Message.js');
if (!fs.existsSync(target)) {
  console.log('[patch-wweb] skip — whatsapp-web.js not installed');
  process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');
const marker = 'mimetype: msg.mimetype';
if (src.includes(marker) && src.includes('this.id.$1')) {
  console.log('[patch-wweb] already patched');
  process.exit(0);
}

const beforeEvaluate = `        const result = await this.client.pupPage.evaluate(async (msgId) => {
            const msg =
                window.require('WAWebCollections').Msg.get(msgId) ||
                (
                    await window
                        .require('WAWebCollections')
                        .Msg.getMessagesById([msgId])
                )?.messages?.[0];

            // REUPLOADING mediaStage`;

const withMsgKey = `        const msgKey =
            (this.id && this.id._serialized) ||
            (this.id && this.id.$1) ||
            (this.id && this.id.remote && this.id.id
                ? \`\${this.id.fromMe ? 'true' : 'false'}_\${this.id.remote}_\${this.id.id}\`
                : undefined);

        const result = await this.client.pupPage.evaluate(async (msgId) => {
            const msg =
                window.require('WAWebCollections').Msg.get(msgId) ||
                (
                    await window
                        .require('WAWebCollections')
                        .Msg.getMessagesById([msgId])
                )?.messages?.[0];

            // REUPLOADING mediaStage`;

if (src.includes(beforeEvaluate) && !src.includes('this.id.$1')) {
  src = src.replace(beforeEvaluate, withMsgKey);
}

if (!src.includes('mimetype: msg.mimetype')) {
  src = src.replace(
    'type: msg.type,\n                        signal: new AbortController().signal,',
    'type: msg.type,\n                        mimetype: msg.mimetype,\n                        signal: new AbortController().signal,',
  );
}

src = src.replace('}, this.id._serialized);', '}, msgKey);');

fs.writeFileSync(target, src);
console.log('[patch-wweb] patched Message.downloadMedia');

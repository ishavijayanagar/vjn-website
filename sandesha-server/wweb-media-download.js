'use strict';

const { MessageMedia } = require('whatsapp-web.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** WhatsApp Web now exposes id.$1 when _serialized is missing (wwebjs #201830). */
function serializedMessageId(msg) {
  const id = msg?.id;
  if (!id) return '';
  if (typeof id === 'string') return id;
  const direct = id._serialized || id.$1;
  if (direct) return String(direct);
  const fromMe = id.fromMe === true || id.fromMe === 1 || id.fromMe === 'true';
  const remote = String(id.remote || msg.from || '').trim();
  const mid = id.id || id._serialized;
  if (remote && mid) return `${fromMe ? 'true' : 'false'}_${remote}_${mid}`;
  return '';
}

function idPayloadForEvaluate(msg) {
  const id = msg?.id;
  if (!id || typeof id !== 'object') return null;
  return {
    fromMe: !!(id.fromMe === true || id.fromMe === 1 || id.fromMe === 'true'),
    remote: String(id.remote || msg.from || ''),
    id: id.id ? String(id.id) : '',
    serialized: serializedMessageId(msg),
  };
}

/**
 * Download media via in-page Store lookup (works for @lid chats when id.$1 is set).
 * Based on community fixes for wwebjs downloadMedia "r" / DataError (#201830, #201844).
 */
async function downloadMessageMedia(client, msg, { log, attempts = 4 } = {}) {
  if (!client?.pupPage) throw new Error('WhatsApp browser not ready');
  if (!msg?.hasMedia) return null;

  const serialized = serializedMessageId(msg);
  const idPayload = idPayloadForEvaluate(msg);
  if (!serialized && !idPayload?.id) throw new Error('missing message id');

  let lastErr = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await client.pupPage.evaluate(
        async ({ idPayload, attempt: att }) => {
          const Msg = window.require('WAWebCollections').Msg;
          const candidates = [];
          const push = (s) => {
            const x = String(s || '').trim();
            if (x && !candidates.includes(x)) candidates.push(x);
          };
          push(idPayload?.serialized);
          if (idPayload?.remote && idPayload?.id) {
            push(`${idPayload.fromMe ? 'true' : 'false'}_${idPayload.remote}_${idPayload.id}`);
          }

          let storeMsg = null;
          for (const sid of candidates) {
            storeMsg = Msg.get(sid);
            if (storeMsg) break;
            try {
              const batch = await Msg.getMessagesById([sid]);
              storeMsg = batch?.messages?.[0];
              if (storeMsg) break;
            } catch {
              /* try next candidate */
            }
          }
          if (!storeMsg) return { error: 'msg_not_in_store' };

          if (!storeMsg.mediaData && !storeMsg.directPath) return { error: 'no_media' };

          const stage0 = storeMsg.mediaData?.mediaStage;
          if (stage0 === 'REUPLOADING') return { error: 'reuploading' };

          if (stage0 && stage0 !== 'RESOLVED') {
            try {
              await storeMsg.downloadMedia({
                downloadEvenIfExpensive: true,
                rmrReason: 1,
              });
            } catch {
              /* NEED_POKE / FETCHING — still try decrypt (#2029) */
            }
            await new Promise((r) => setTimeout(r, Math.min(4000, att * 900)));
          }

          const stage = storeMsg.mediaData?.mediaStage || '';
          if (stage.includes('ERROR')) return { error: `media_stage_${stage}` };

          try {
            const mockQpl = {
              addAnnotations() { return this; },
              addPoint() { return this; },
            };
            const decryptedMedia = await window
              .require('WAWebDownloadManager')
              .downloadManager.downloadAndMaybeDecrypt({
                directPath: storeMsg.directPath,
                encFilehash: storeMsg.encFilehash,
                filehash: storeMsg.filehash,
                mediaKey: storeMsg.mediaKey,
                mediaKeyTimestamp: storeMsg.mediaKeyTimestamp,
                type: storeMsg.type,
                // Required on WA Web 2.3000.x — omitting defaults to octet-stream → InvalidMediaFileType (#201908)
                mimetype: storeMsg.mimetype,
                signal: new AbortController().signal,
                downloadQpl: mockQpl,
              });
            const data = await window.WWebJS.arrayBufferToBase64Async(decryptedMedia);
            return {
              data,
              mimetype: storeMsg.mimetype,
              filename: storeMsg.filename,
              filesize: storeMsg.size,
            };
          } catch (e) {
            return { error: e?.message || String(e), status: e?.status };
          }
        },
        { idPayload, attempt },
      );

      if (result?.data) {
        const mime = result.mimetype || 'application/octet-stream';
        return new MessageMedia(mime, result.data, result.filename, result.filesize);
      }

      if (result?.error === 'msg_not_in_store' && serialized) {
        try {
          const fresh = await client.getMessageById(serialized);
          if (fresh?.hasMedia) {
            const legacy = await fresh.downloadMedia().catch(() => null);
            if (legacy?.data) return legacy;
          }
        } catch {
          /* fall through to retry */
        }
      }

      lastErr = new Error(result?.error || 'download returned empty');
      if (attempt < attempts) await sleep(attempt * 1000);
    } catch (err) {
      lastErr = err;
      const msgText = err?.message || String(err);
      if (log) log(`[WWEB-MEDIA] attempt ${attempt}/${attempts}: ${msgText}`);
      if (attempt < attempts) await sleep(attempt * 1000);
    }
  }

  throw lastErr || new Error('download failed');
}

function messageMediaToPayload(media) {
  if (!media?.data) return null;
  return {
    data: media.data,
    mimetype: media.mimetype,
    filename: media.filename,
  };
}

module.exports = {
  serializedMessageId,
  downloadMessageMedia,
  messageMediaToPayload,
};

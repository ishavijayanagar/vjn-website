'use strict';

const path = require('path');
const fs = require('fs');
const { downloadMessageMedia, messageMediaToPayload } = require('./wweb-media-download');

function stanzaId(msg) {
  if (!msg) return '';
  const id = msg.id?.id || msg._data?.id?.id;
  return id ? String(id) : '';
}

function extForMedia(media) {
  const fromName = path.extname(String(media.filename || ''));
  if (fromName && fromName.length <= 6) return fromName;
  const mime = String(media.mimetype || '').toLowerCase();
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
    'video/quicktime': '.mov',
    'application/pdf': '.pdf',
  };
  if (map[mime]) return map[mime];
  const sub = mime.split('/')[1];
  return sub ? `.${sub.replace(/[^a-z0-9]/gi, '')}` : '.bin';
}

function stanzaCacheBasename(stanza) {
  const safe = String(stanza || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return safe ? `planning_sid_${safe}` : '';
}

function findCachedPathForStanza(mediaDir, stanza) {
  const base = stanzaCacheBasename(stanza);
  if (!base) return null;
  try {
    const names = fs.readdirSync(mediaDir);
    const hit = names.find((n) => n.startsWith(base + '.') || n === base);
    return hit ? path.join(mediaDir, hit) : null;
  } catch {
    return null;
  }
}

function createPlanningMedia({ client, mediaDir, log, getPlanningGroupJid }) {
  const inFlight = new Map();

  async function collectCandidates(msg, stanzaHint) {
    const out = [];
    const seen = new Set();
    const push = (m) => {
      if (!m) return;
      const key = m.id?._serialized || m.id?.$1 || stanzaId(m) || '';
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      out.push(m);
    };

    push(msg);
    const ser = msg?.id?._serialized || msg?.id?.$1;
    if (ser) {
      try {
        push(await client.getMessageById(ser));
      } catch { /* best-effort */ }
    }

    const stanza = stanzaHint || stanzaId(msg);
    const groupJid = getPlanningGroupJid?.();
    if (stanza && groupJid) {
      try {
        const chat = await client.getChatById(groupJid);
        const recent = await chat.fetchMessages({ limit: 80 });
        for (const m of recent) {
          if (stanzaId(m) !== stanza) continue;
          push(m);
          const mSer = m.id?._serialized || m.id?.$1;
          if (mSer) {
            try {
              push(await client.getMessageById(mSer));
            } catch { /* best-effort */ }
          }
        }
      } catch (err) {
        log(`[PLANNING-MEDIA] chat scan: ${err.message}`);
      }
    }
    return out;
  }

  async function tryDownloadFromCandidate(m) {
    if (!m?.hasMedia) return null;
    try {
      const robust = await downloadMessageMedia(client, m, { log });
      const payload = messageMediaToPayload(robust);
      if (payload?.data) return { media: payload, source: m };
    } catch (err) {
      log(`[PLANNING-MEDIA] robust download: ${err.message}`);
    }
    try {
      const media = await m.downloadMedia();
      if (media?.data) return { media, source: m };
    } catch (err) {
      log(`[PLANNING-MEDIA] downloadMedia: ${err.message}`);
    }
    return null;
  }

  /** Download image, video, or PDF from a WhatsApp message (multiple hydration attempts). */
  async function downloadMediaFromMessage(msg, stanzaHint) {
    const stanza = stanzaHint || stanzaId(msg);
    const cached = findCachedPathForStanza(mediaDir, stanza);
    if (cached && fs.existsSync(cached)) {
      log(`[PLANNING-MEDIA] using cached file ${path.basename(cached)}`);
      return { cachedPath: cached, source: msg };
    }

    const candidates = await collectCandidates(msg, stanzaHint);
    let lastErr = null;
    for (const m of candidates) {
      try {
        const got = await tryDownloadFromCandidate(m);
        if (got) return got;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    return null;
  }

  function writeMediaToDisk(media, stanzaHint) {
    const ext = extForMedia(media);
    const stanzaBase = stanzaCacheBasename(stanzaHint || '');
    const safeName = stanzaBase
      ? `${stanzaBase}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`
      : `planning_${Date.now()}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`;
    const filePath = path.join(mediaDir, safeName);
    fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
    log(`[PLANNING-MEDIA] saved ${safeName} (${media.mimetype || 'unknown'})`);
    return filePath;
  }

  async function saveDraftMedia(msg, stanzaHint) {
    const stanza = stanzaHint || stanzaId(msg);
    const existing = findCachedPathForStanza(mediaDir, stanza);
    if (existing && fs.existsSync(existing)) return existing;

    const got = await downloadMediaFromMessage(msg, stanzaHint);
    if (got?.cachedPath) return got.cachedPath;
    if (!got?.media?.data) return null;
    return writeMediaToDisk(got.media, stanza);
  }

  /** While the message is still in WA Web's store, cache flyer/video from the planning group. */
  async function warmCacheDraft(msg) {
    if (!msg?.hasMedia) return null;
    const stanza = stanzaId(msg);
    if (!stanza) return null;
    const existing = findCachedPathForStanza(mediaDir, stanza);
    if (existing && fs.existsSync(existing)) return existing;
    if (inFlight.has(stanza)) return inFlight.get(stanza);

    const job = (async () => {
      try {
        return await saveDraftMedia(msg, stanza);
      } catch (err) {
        log(`[PLANNING-MEDIA] warm cache: ${err.message}`);
        return null;
      } finally {
        inFlight.delete(stanza);
      }
    })();
    inFlight.set(stanza, job);
    return job;
  }

  async function findDraftByStanza(stanza) {
    if (!stanza) return null;
    const groupJid = getPlanningGroupJid?.();
    if (!groupJid) return null;
    try {
      const chat = await client.getChatById(groupJid);
      const recent = await chat.fetchMessages({ limit: 80 });
      const hit = recent.find((m) => stanzaId(m) === stanza);
      if (!hit) return null;
      const ser = hit.id?._serialized || hit.id?.$1;
      if (ser) {
        try {
          return await client.getMessageById(ser);
        } catch {
          return hit;
        }
      }
      return hit;
    } catch (err) {
      log(`[PLANNING-MEDIA] findDraftByStanza: ${err.message}`);
      return null;
    }
  }

  return {
    stanzaId,
    saveDraftMedia,
    downloadMediaFromMessage,
    findDraftByStanza,
    warmCacheDraft,
    extForMedia,
    findCachedPathForStanza: (stanza) => findCachedPathForStanza(mediaDir, stanza),
  };
}

module.exports = { createPlanningMedia, stanzaId, extForMedia };

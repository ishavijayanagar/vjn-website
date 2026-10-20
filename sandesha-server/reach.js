/**
 * Message reach — how far each WhatsApp post travelled.
 *
 * Every send through Sandesha is remembered by its WhatsApp message id. A
 * background checker then asks WhatsApp for that message's info (the same
 * "Message info" screen you see on a phone) at fixed points after sending, and
 * keeps the counts: delivered to, read by, and when people read it. Live ticks,
 * quoted replies and reactions are folded in as they arrive.
 *
 * Only counts and times are kept — never who. Reaction senders are stored as a
 * short one-way hash so a changed or removed reaction isn't counted twice.
 *
 * Read counts are a lower bound: people with read receipts off never show up
 * as "read", only as "delivered".
 *
 * State lives in reach.json (rolling 90 days). Never throws into a caller.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_FILE = process.env.REACH_FILE || path.join(__dirname, 'reach.json');
const MEDIA_DIR = process.env.REACH_MEDIA_DIR || path.join(__dirname, 'reach-media');
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/** When to look again after sending. After the last one the numbers are final. */
const CHECKPOINTS_MS = [10 * 60 * 1000, HOUR, 6 * HOUR, 24 * HOUR, 72 * HOUR, 168 * HOUR];
const CURVE_HOURS = 168;
const TICK_MS = 60 * 1000;
const CHECKS_PER_TICK = 8;
const CHECK_GAP_MS = 1500;
const INFO_TIMEOUT_MS = 25000;
const MAX_THUMB_BASE64 = 2.5 * 1024 * 1024;
const REPLY_SAMPLES = 5;
const IST_OFFSET_MS = 330 * 60 * 1000;

let deps = {
  getClient: () => null,
  getContext: () => null,
  isBusy: () => false,
  ignoreChat: () => false,
  myId: () => null,
  log: () => {},
};
let store = null;
let saveTimer = null;
let tickTimer = null;
let tickInFlight = false;
/** stanza id (the last part of a message id) → full id, for replies and reactions. */
let byKey = new Map();

function init(options = {}) {
  deps = { ...deps, ...options };
  load();
}

function load() {
  if (store) return store;
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    store = raw && typeof raw.messages === 'object' ? raw : { version: 1, messages: {} };
  } catch {
    store = { version: 1, messages: {} };
  }
  reindex();
  return store;
}

function reindex() {
  byKey = new Map();
  for (const rec of Object.values(store.messages)) {
    if (rec.key) byKey.set(rec.key, rec.id);
  }
}

function save(now = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const write = () => {
    saveTimer = null;
    try {
      const tmp = `${STORE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(store));
      fs.renameSync(tmp, STORE_FILE);
    } catch (err) {
      deps.log(`[REACH] could not save: ${err.message}`);
    }
  };
  if (now) write();
  else {
    saveTimer = setTimeout(write, 2000);
    saveTimer.unref?.();
  }
}

/** "true_123@g.us_3EB0ABC" → "3EB0ABC". Accepts a MessageId object too. */
function keyOf(id) {
  if (!id) return '';
  if (typeof id === 'object') return String(id.id || keyOf(id._serialized) || '');
  const parts = String(id).split('_');
  return parts.length >= 3 ? parts.slice(2).join('_') : String(id);
}

function serializedOf(id) {
  if (!id) return '';
  return typeof id === 'object' ? String(id._serialized || '') : String(id);
}

function hashOf(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
}

function istDay(ms) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function firstLine(text, max = 300) {
  return String(text || '').replace(/\s+\n/g, '\n').trim().slice(0, max);
}

/**
 * Remember a message Sandesha just sent. Call right after the send resolves.
 * `content` is the string or MessageMedia that was sent; `context` fills in
 * via/actor/corrId for sends made outside withSendContext.
 */
function track(sent, { jid, content, caption, context } = {}) {
  try {
    const id = serializedOf(sent?.id);
    const chat = String(jid || sent?.to || sent?.id?.remote || '');
    if (!id || !chat || deps.ignoreChat(chat)) return;
    load();
    if (store.messages[id]) return;

    // Read the framing now — it changes as soon as the caller moves on.
    const ctx = { ...(deps.getContext() || {}), ...(context || {}) };
    const isMedia = !!(content && typeof content === 'object' && content.mimetype);
    const text = isMedia ? (caption || '') : (typeof content === 'string' ? content : caption || '');
    const sentAt = (Number(sent?.timestamp) * 1000) || Date.now();
    const corr = String(ctx.corrId || '');
    const isGroup = chat.endsWith('@g.us');

    const rec = {
      id,
      key: keyOf(sent.id),
      chat,
      chatName: '',
      isGroup,
      audience: isGroup ? 0 : 1,
      kind: isMedia ? 'media' : 'text',
      mime: isMedia ? String(content.mimetype || '') : '',
      text: firstLine(ctx.message || text),
      thumb: isMedia ? saveThumb(content) : '',
      sentAt,
      via: String(ctx.via || 'api'),
      post: `${corr || `msg-${keyOf(sent.id)}`}|${istDay(sentAt)}`,
      actor: ctx.actor ? { name: String(ctx.actor.name || ''), role: String(ctx.actor.role || '') } : null,
      checksDone: 0,
      nextCheckAt: sentAt + CHECKPOINTS_MS[0],
      status: 'measuring',
      delivered: 0,
      read: 0,
      played: 0,
      notDelivered: null,
      notRead: null,
      readCurve: {},
      firstDeliveredAt: null,
      firstReadAt: null,
      ack: 0,
      replies: 0,
      replySamples: [],
      reactions: {},
    };
    store.messages[id] = rec;
    byKey.set(rec.key, id);
    save();
    fillChatDetails(rec).catch(() => {});
  } catch (err) {
    deps.log(`[REACH] track failed: ${err.message}`);
  }
}

/** Group name and member count at send time. Best effort, off the send path. */
async function fillChatDetails(rec) {
  const client = deps.getClient();
  if (!client) return;
  const chat = await withTimeout(client.getChatById(rec.chat), 15000);
  if (!chat) return;
  rec.chatName = String(chat.name || chat.formattedTitle || '');
  if (rec.isGroup) {
    const n = chat.participants?.length || chat.groupMetadata?.participants?.length || 0;
    // Sandesha's own number is one of the members.
    if (n > 0) rec.audience = Math.max(0, n - 1);
  }
  save();
}

/** Keep a copy of an image post so the Reach page can show what was sent. */
function saveThumb(media) {
  try {
    const mime = String(media.mimetype || '');
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) return '';
    const data = String(media.data || '');
    if (!data || data.length > MAX_THUMB_BASE64) return '';
    const ext = mime.split('/')[1].replace('jpeg', 'jpg');
    const name = `${hashOf(data)}.${ext}`;
    const file = path.join(MEDIA_DIR, name);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    }
    return name;
  } catch {
    return '';
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------- Live events ---------- */

function onAck(msg, ack) {
  try {
    const rec = store?.messages[serializedOf(msg?.id)];
    if (!rec) return;
    const level = Number(ack) || 0;
    if (level <= rec.ack) return;
    rec.ack = level;
    const now = Date.now();
    // ack 2 = delivered, 3 = read. In a group that means "everyone", so it only
    // stamps the first time; the counts come from the info checks.
    if (level >= 2 && !rec.firstDeliveredAt) rec.firstDeliveredAt = now;
    if (level >= 3 && !rec.firstReadAt) rec.firstReadAt = now;
    if (!rec.isGroup) {
      if (level >= 2) rec.delivered = 1;
      if (level >= 3) {
        rec.read = 1;
        bumpCurve(rec, now, 1, true);
      }
    }
    save();
  } catch { /* best effort */ }
}

function onMessage(msg) {
  try {
    if (!store || msg?.fromMe || !msg?.hasQuotedMsg) return;
    const quoted = msg._data?.quotedStanzaID || msg._data?.quotedMsgKey?.id || '';
    const id = byKey.get(String(quoted));
    const rec = id && store.messages[id];
    if (!rec || rec.chat !== msg.from) return;
    rec.replies += 1;
    const body = firstLine(msg.body, 160);
    if (body) {
      rec.replySamples.unshift({ at: (Number(msg.timestamp) * 1000) || Date.now(), text: body });
      rec.replySamples = rec.replySamples.slice(0, REPLY_SAMPLES);
    }
    save();
  } catch { /* best effort */ }
}

function onReaction(reaction) {
  try {
    if (!store) return;
    const parent = reaction?.msgId;
    const id = store.messages[serializedOf(parent)] ? serializedOf(parent) : byKey.get(keyOf(parent));
    const rec = id && store.messages[id];
    if (!rec) return;
    const sender = String(reaction.senderId || '');
    if (!sender || sender === deps.myId()) return;
    const who = hashOf(sender);
    const emoji = String(reaction.reaction || '');
    if (emoji) rec.reactions[who] = emoji;
    else delete rec.reactions[who];
    save();
  } catch { /* best effort */ }
}

/* ---------- Scheduled info checks ---------- */

function start() {
  if (tickTimer) return;
  load();
  prune();
  tickTimer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  setTimeout(() => { tick().catch(() => {}); }, 30000);
}

function stop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

async function tick() {
  if (tickInFlight || !store) return;
  if (deps.isBusy()) return;
  const client = deps.getClient();
  if (!client) return;
  tickInFlight = true;
  try {
    const now = Date.now();
    const due = Object.values(store.messages)
      .filter((r) => r.nextCheckAt && r.nextCheckAt <= now)
      .sort((a, b) => a.nextCheckAt - b.nextCheckAt)
      .slice(0, CHECKS_PER_TICK);
    for (const rec of due) {
      // A send started meanwhile — it has right of way.
      if (deps.isBusy()) break;
      await checkOne(client, rec);
      await delay(CHECK_GAP_MS);
    }
    if (due.length) save();
  } finally {
    tickInFlight = false;
  }
}

async function checkOne(client, rec) {
  const now = Date.now();
  try {
    if (!rec.chatName || (rec.isGroup && !rec.audience)) await fillChatDetails(rec).catch(() => {});
    const msg = await withTimeout(client.getMessageById(rec.id), INFO_TIMEOUT_MS);
    const info = msg ? await withTimeout(msg.getInfo(), INFO_TIMEOUT_MS) : null;
    if (info) applyInfo(rec, info);
    else if (rec.isGroup) rec.infoMissing = (rec.infoMissing || 0) + 1;
    rec.lastCheckedAt = now;
  } catch (err) {
    rec.checkErrors = (rec.checkErrors || 0) + 1;
    deps.log(`[REACH] check ${rec.chatName || rec.chat}: ${err.message}`);
  }
  advance(rec, now);
}

/** Move to the next checkpoint that hasn't already passed (the Pi may have been off). */
function advance(rec, now) {
  let i = rec.checksDone + 1;
  while (i < CHECKPOINTS_MS.length && rec.sentAt + CHECKPOINTS_MS[i] <= now) i += 1;
  rec.checksDone = Math.min(i, CHECKPOINTS_MS.length);
  if (i >= CHECKPOINTS_MS.length) {
    rec.nextCheckAt = null;
    rec.status = 'final';
  } else {
    rec.nextCheckAt = rec.sentAt + CHECKPOINTS_MS[i];
  }
}

function idOf(entry) {
  const id = entry?.id;
  return serializedOf(id) || String(id?.user || entry || '');
}

function applyInfo(rec, info) {
  const me = deps.myId();
  const keep = (list) => (Array.isArray(list) ? list : []).filter((e) => idOf(e) && idOf(e) !== me);
  const delivery = keep(info.delivery);
  const read = keep(info.read);
  const played = keep(info.played);

  // Someone who read it was delivered it, whichever lists WhatsApp put them in.
  const reached = new Set([...delivery, ...read, ...played].map(idOf));
  const readers = new Set([...read, ...played].map(idOf));
  rec.delivered = Math.max(rec.delivered, reached.size);
  rec.read = Math.max(rec.read, readers.size);
  rec.played = Math.max(rec.played, played.length);
  if (Number.isFinite(info.deliveryRemaining)) rec.notDelivered = info.deliveryRemaining;
  if (Number.isFinite(info.readRemaining)) rec.notRead = info.readRemaining;
  if (!rec.audience && Number.isFinite(info.deliveryRemaining)) {
    rec.audience = reached.size + info.deliveryRemaining;
  }
  rec.audience = Math.max(rec.audience, rec.delivered);

  // Each reader comes with a read time, so one check rebuilds the whole curve.
  const curve = {};
  const seen = new Set();
  for (const e of [...read, ...played]) {
    const who = idOf(e);
    if (seen.has(who)) continue;
    seen.add(who);
    const t = Number(e.t) * 1000;
    const h = Number.isFinite(t) && t > 0
      ? Math.min(CURVE_HOURS, Math.max(0, Math.floor((t - rec.sentAt) / HOUR)))
      : CURVE_HOURS;
    curve[h] = (curve[h] || 0) + 1;
  }
  if (seen.size) rec.readCurve = curve;

  const times = (list) => list.map((e) => Number(e.t) * 1000).filter((t) => t > 0);
  const firstDelivered = Math.min(...times([...delivery, ...read]));
  const firstRead = Math.min(...times(read));
  if (Number.isFinite(firstDelivered)) rec.firstDeliveredAt = Math.min(rec.firstDeliveredAt || Infinity, firstDelivered);
  if (Number.isFinite(firstRead)) rec.firstReadAt = Math.min(rec.firstReadAt || Infinity, firstRead);
  rec.infoMissing = 0;
}

function bumpCurve(rec, at, n, replace = false) {
  const h = Math.min(CURVE_HOURS, Math.max(0, Math.floor((at - rec.sentAt) / HOUR)));
  if (replace) rec.readCurve = {};
  rec.readCurve[h] = (rec.readCurve[h] || 0) + n;
}

function prune() {
  const cutoff = Date.now() - KEEP_MS;
  let dropped = 0;
  for (const [id, rec] of Object.entries(store.messages)) {
    if (rec.sentAt < cutoff) {
      delete store.messages[id];
      dropped += 1;
    }
  }
  if (dropped) {
    reindex();
    save(true);
  }
  // Drop pictures no remaining message points at.
  try {
    const used = new Set(Object.values(store.messages).map((r) => r.thumb).filter(Boolean));
    for (const name of fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : []) {
      if (!used.has(name)) fs.unlinkSync(path.join(MEDIA_DIR, name));
    }
  } catch { /* ignore */ }
}

/* ---------- Read side ---------- */

function reactionCounts(recs) {
  const out = {};
  for (const r of recs) {
    for (const e of Object.values(r.reactions || {})) out[e] = (out[e] || 0) + 1;
  }
  return out;
}

function sumValues(obj) {
  return Object.values(obj || {}).reduce((a, b) => a + b, 0);
}

/**
 * One row per group a post went to. A post can be two messages to the same
 * group (long text, then the picture) — the group counts once, at its best.
 */
function groupRows(recs) {
  const byChat = new Map();
  for (const r of recs) {
    const row = byChat.get(r.chat) || {
      chat: r.chat, name: r.chatName || '', isGroup: r.isGroup,
      audience: 0, delivered: 0, read: 0, replies: 0, recs: [],
      firstReadAt: null, status: 'final', infoMissing: false,
    };
    row.name = row.name || r.chatName || '';
    row.audience = Math.max(row.audience, r.audience || 0);
    row.delivered = Math.max(row.delivered, r.delivered || 0);
    row.read = Math.max(row.read, r.read || 0);
    row.replies += r.replies || 0;
    row.recs.push(r);
    if (r.firstReadAt) row.firstReadAt = Math.min(row.firstReadAt || Infinity, r.firstReadAt);
    if (r.status !== 'final') row.status = 'measuring';
    if ((r.infoMissing || 0) >= 2 && !r.delivered) row.infoMissing = true;
    byChat.set(r.chat, row);
  }
  return [...byChat.values()].map((row) => {
    const reactions = reactionCounts(row.recs);
    const { recs, ...rest } = row;
    return { ...rest, reactions: sumValues(reactions) };
  });
}

function summarizePost(postKey, recs) {
  recs.sort((a, b) => a.sentAt - b.sentAt);
  const lead = recs.find((r) => r.thumb) || recs.find((r) => r.text) || recs[0];
  const groups = groupRows(recs);
  const reactions = reactionCounts(recs);
  const total = (k) => groups.reduce((a, g) => a + (g[k] || 0), 0);
  return {
    post: postKey,
    sentAt: recs[0].sentAt,
    text: lead.text || '',
    kind: lead.kind,
    thumb: lead.thumb || '',
    via: recs[0].via,
    actor: recs[0].actor?.name || '',
    groups: groups.length,
    audience: total('audience'),
    delivered: total('delivered'),
    read: total('read'),
    replies: total('replies'),
    reactions: sumValues(reactions),
    reactionTop: Object.entries(reactions).sort((a, b) => b[1] - a[1]).slice(0, 3),
    status: recs.some((r) => r.status !== 'final') ? 'measuring' : 'final',
    noInfo: groups.length > 0 && groups.every((g) => g.infoMissing),
  };
}

function postsIn(fromMs, toMs = Infinity) {
  const map = new Map();
  for (const r of Object.values(load().messages)) {
    if (r.sentAt < fromMs || r.sentAt >= toMs) continue;
    if (!map.has(r.post)) map.set(r.post, []);
    map.get(r.post).push(r);
  }
  return [...map.entries()].map(([k, recs]) => summarizePost(k, recs));
}

function totals(posts) {
  const t = { posts: posts.length, sends: 0, audience: 0, delivered: 0, read: 0, replies: 0, reactions: 0 };
  for (const p of posts) {
    t.sends += p.groups;
    t.audience += p.audience;
    t.delivered += p.delivered;
    t.read += p.read;
    t.replies += p.replies;
    t.reactions += p.reactions;
  }
  return t;
}

function summary(rangeDays = 30) {
  const days = Math.max(1, Math.min(90, Number(rangeDays) || 30));
  const now = Date.now();
  const from = now - days * 24 * HOUR;
  const posts = postsIn(from);
  const prev = postsIn(from - days * 24 * HOUR, from);

  // Day by day, by the day a post was sent.
  const daily = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    daily.push({ day: istDay(now - i * 24 * HOUR), posts: 0, delivered: 0, read: 0 });
  }
  const dayIndex = new Map(daily.map((d, i) => [d.day, i]));
  for (const p of posts) {
    const d = daily[dayIndex.get(istDay(p.sentAt))];
    if (!d) continue;
    d.posts += 1;
    d.delivered += p.delivered;
    d.read += p.read;
  }

  // Which groups listen best.
  const groupMap = new Map();
  for (const r of Object.values(store.messages)) {
    if (r.sentAt < from || !r.isGroup) continue;
    const g = groupMap.get(r.chat) || { chat: r.chat, name: '', posts: new Set(), audience: 0, delivered: 0, read: 0, replies: 0 };
    g.name = r.chatName || g.name;
    g.posts.add(r.post);
    groupMap.set(r.chat, g);
  }
  const perPostGroup = new Map();
  for (const r of Object.values(store.messages)) {
    if (r.sentAt < from || !r.isGroup) continue;
    const k = `${r.post}\u0000${r.chat}`;
    const cur = perPostGroup.get(k) || { chat: r.chat, audience: 0, delivered: 0, read: 0, replies: 0 };
    cur.audience = Math.max(cur.audience, r.audience || 0);
    cur.delivered = Math.max(cur.delivered, r.delivered || 0);
    cur.read = Math.max(cur.read, r.read || 0);
    cur.replies += r.replies || 0;
    perPostGroup.set(k, cur);
  }
  for (const v of perPostGroup.values()) {
    const g = groupMap.get(v.chat);
    g.audience += v.audience;
    g.delivered += v.delivered;
    g.read += v.read;
    g.replies += v.replies;
  }
  const groups = [...groupMap.values()]
    .map((g) => ({
      chat: g.chat,
      name: g.name || 'Unnamed group',
      posts: g.posts.size,
      audience: g.audience,
      delivered: g.delivered,
      read: g.read,
      replies: g.replies,
      readRate: g.audience ? g.read / g.audience : 0,
    }))
    .sort((a, b) => b.readRate - a.readRate || b.read - a.read);

  return {
    rangeDays: days,
    totals: totals(posts),
    previous: totals(prev),
    daily,
    groups,
    measuring: posts.filter((p) => p.status === 'measuring').length,
    trackingSince: Object.values(store.messages).reduce((m, r) => Math.min(m, r.sentAt), Infinity),
  };
}

function listPosts({ rangeDays = 30, limit = 30, before = null } = {}) {
  const days = Math.max(1, Math.min(90, Number(rangeDays) || 30));
  const from = Date.now() - days * 24 * HOUR;
  let posts = postsIn(from).sort((a, b) => b.sentAt - a.sentAt);
  if (before) posts = posts.filter((p) => p.sentAt < Number(before));
  const n = Math.max(1, Math.min(100, Number(limit) || 30));
  return { posts: posts.slice(0, n), more: posts.length > n };
}

function postDetail(postKey) {
  const recs = Object.values(load().messages).filter((r) => r.post === postKey);
  if (!recs.length) return null;
  const summaryRow = summarizePost(postKey, recs);
  const groups = groupRows(recs).sort((a, b) =>
    (b.audience ? b.read / b.audience : 0) - (a.audience ? a.read / a.audience : 0) || b.read - a.read);

  // Cumulative readers by hour since sending, across every group.
  const perHour = new Array(CURVE_HOURS + 1).fill(0);
  const bestPerChat = new Map();
  for (const r of recs) {
    const cur = bestPerChat.get(r.chat);
    if (!cur || sumValues(r.readCurve) > sumValues(cur.readCurve)) bestPerChat.set(r.chat, r);
  }
  for (const r of bestPerChat.values()) {
    for (const [h, n] of Object.entries(r.readCurve || {})) perHour[Number(h)] += n;
  }
  const curve = [];
  let running = 0;
  for (let h = 0; h <= CURVE_HOURS; h += 1) {
    running += perHour[h];
    curve.push(running);
  }

  const replies = recs
    .flatMap((r) => (r.replySamples || []).map((s) => ({ ...s, group: r.chatName || '' })))
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);

  const reactions = Object.entries(reactionCounts(recs)).sort((a, b) => b[1] - a[1]);
  const lastCheckedAt = recs.reduce((m, r) => Math.max(m, r.lastCheckedAt || 0), 0) || null;
  const nextCheckAt = recs.reduce((m, r) => (r.nextCheckAt ? Math.min(m, r.nextCheckAt) : m), Infinity);
  const fullText = (recs.find((r) => r.text) || {}).text || '';

  return {
    ...summaryRow,
    text: fullText,
    groupRows: groups,
    curve,
    replySamples: replies,
    reactionList: reactions,
    lastCheckedAt,
    nextCheckAt: Number.isFinite(nextCheckAt) ? nextCheckAt : null,
  };
}

/* ---------- HTTP ---------- */

const READ_ROLES = ['admin', 'promotions'];

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Returns true when the request was a /reach route. */
function handleRequest(req, res, parsed, requireAuth) {
  const p = parsed.pathname || '';
  if (!p.startsWith('/reach')) return false;
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return true;
  }
  if (!requireAuth(req, res, READ_ROLES)) return true;
  const q = parsed.query || {};
  try {
    if (p === '/reach/summary') {
      json(res, 200, summary(q.range));
      return true;
    }
    if (p === '/reach/posts') {
      json(res, 200, listPosts({ rangeDays: q.range, limit: q.limit, before: q.before }));
      return true;
    }
    if (p === '/reach/post') {
      const detail = postDetail(String(q.key || ''));
      if (!detail) json(res, 404, { error: 'Post not found' });
      else json(res, 200, detail);
      return true;
    }
    const media = p.match(/^\/reach\/media\/([a-f0-9]{12}\.(?:jpg|png|webp|gif))$/);
    if (media) {
      const file = path.join(MEDIA_DIR, media[1]);
      if (!fs.existsSync(file)) {
        json(res, 404, { error: 'Not found' });
        return true;
      }
      const ext = media[1].split('.').pop();
      res.writeHead(200, {
        'Content-Type': ext === 'jpg' ? 'image/jpeg' : `image/${ext}`,
        'Cache-Control': 'private, max-age=604800',
      });
      fs.createReadStream(file).pipe(res);
      return true;
    }
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
  return true;
}

module.exports = {
  init,
  track,
  onAck,
  onMessage,
  onReaction,
  start,
  stop,
  tick,
  summary,
  listPosts,
  postDetail,
  handleRequest,
  // for tests
  _applyInfo: applyInfo,
  _reset: (s) => { store = s || { version: 1, messages: {} }; reindex(); },
  _store: () => store,
  CHECKPOINTS_MS,
};

'use strict';

/**
 * Web Push (VAPID) fan-out for Sandesha.
 *
 * - Keys live in .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT).
 *   Missing keys are generated on first use and appended to .env, the same way
 *   the WhatsApp session persists itself — no manual setup step.
 * - Subscriptions are stored in push-subscriptions.json, keyed by endpoint,
 *   tagged with the subscriber's role. Dead endpoints (404/410) are pruned.
 * - notify() never throws into a caller; a broken push must not break a send.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');

const ENV_FILE = path.join(__dirname, '.env');
const SUBS_FILE = path.join(__dirname, 'push-subscriptions.json');
const NO_PERSIST = process.env.SANDESHA_PUSH_NO_PERSIST === '1';

let vapidReady = false;

function appendEnv(key, value) {
  if (NO_PERSIST) return;
  try {
    const line = `${key}=${value}`;
    let body = '';
    try { body = fs.readFileSync(ENV_FILE, 'utf8'); } catch { /* new file */ }
    if (new RegExp(`^\\s*${key}=`, 'm').test(body)) return; // already there
    fs.appendFileSync(ENV_FILE, `${body && !body.endsWith('\n') ? '\n' : ''}${line}\n`);
  } catch {
    /* .env not writable — keys still live in process.env for this run */
  }
}

function ensureVapid() {
  if (vapidReady) return;
  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    process.env.VAPID_PUBLIC_KEY = pub;
    process.env.VAPID_PRIVATE_KEY = priv;
    appendEnv('VAPID_PUBLIC_KEY', pub);
    appendEnv('VAPID_PRIVATE_KEY', priv);
    console.log(
      NO_PERSIST
        ? '[push] generated a VAPID keypair (not persisted — SANDESHA_PUSH_NO_PERSIST)'
        : '[push] generated a VAPID keypair (saved to .env)',
    );
  }
  let subject = String(process.env.VAPID_SUBJECT || '').trim();
  if (!subject) {
    subject = process.env.SANDESHA_NOTIFY_EMAIL
      ? `mailto:${process.env.SANDESHA_NOTIFY_EMAIL}`
      : 'https://ishaplacevijayanagar.org';
    process.env.VAPID_SUBJECT = subject;
    appendEnv('VAPID_SUBJECT', subject);
  }
  webpush.setVapidDetails(subject, pub, priv);
  vapidReady = true;
}

/** @returns {string} the URL-safe base64 VAPID public key for the browser. */
function getPublicKey() {
  ensureVapid();
  return process.env.VAPID_PUBLIC_KEY;
}

/**
 * Shared secret for trusted server-to-server pushes (Apps Script → here).
 * Auto-generated + saved to .env on first use, like the VAPID keys.
 */
function getInternalToken() {
  let tok = process.env.SANDESHA_INTERNAL_TOKEN;
  if (!tok) {
    tok = crypto.randomBytes(32).toString('hex');
    process.env.SANDESHA_INTERNAL_TOKEN = tok;
    appendEnv('SANDESHA_INTERNAL_TOKEN', tok);
    console.log(
      NO_PERSIST
        ? '[push] generated SANDESHA_INTERNAL_TOKEN (not persisted)'
        : '[push] generated SANDESHA_INTERNAL_TOKEN (saved to .env)',
    );
  }
  return tok;
}

function loadSubs() {
  try {
    const raw = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveSubs(list) {
  try {
    fs.writeFileSync(SUBS_FILE, JSON.stringify(list, null, 2));
  } catch {
    /* best effort */
  }
}

/** Upsert a subscription by endpoint. */
function addSub(subscription, meta = {}) {
  if (!subscription || !subscription.endpoint) return null;
  const list = loadSubs();
  const now = new Date().toISOString();
  const row = {
    endpoint: subscription.endpoint,
    keys: subscription.keys || {},
    role: meta.role || 'unknown',
    userId: meta.userId || '',
    ua: String(meta.ua || '').slice(0, 200),
    createdAt: now,
    lastOkAt: now,
  };
  const i = list.findIndex((s) => s.endpoint === subscription.endpoint);
  if (i >= 0) {
    row.createdAt = list[i].createdAt || now;
    list[i] = row;
  } else {
    list.push(row);
  }
  saveSubs(list);
  return row;
}

function removeSub(endpoint) {
  if (!endpoint) return false;
  const list = loadSubs();
  const next = list.filter((s) => s.endpoint !== endpoint);
  if (next.length === list.length) return false;
  saveSubs(next);
  return true;
}

/** How many subscriptions a given user currently has. */
function countForUser(userId) {
  return loadSubs().filter((s) => s.userId === String(userId || '')).length;
}

/**
 * Send `payload` to everyone in `audience`.
 * @param {'admin'|'promotions'|'all'} audience
 * @param {{title:string, body?:string, tag?:string, url?:string, kind?:string, corrId?:string}} payload
 * @param {(sub:object)=>boolean} [extraFilter] narrow further (e.g. one user)
 * @returns {Promise<{sent:number, pruned:number}>}
 */
async function notify(audience, payload, extraFilter) {
  let sent = 0;
  let pruned = 0;
  try {
    ensureVapid();
  } catch (err) {
    console.log('[push] VAPID not ready:', err.message);
    return { sent, pruned };
  }
  const list = loadSubs();
  if (!list.length) return { sent, pruned };

  const wants = (s) => {
    if (audience && audience !== 'all' && s.role !== audience) return false;
    if (extraFilter && !extraFilter(s)) return false;
    return true;
  };
  const body = JSON.stringify({
    title: payload.title || 'Sandesha',
    body: payload.body || '',
    tag: payload.tag || 'sandesha',
    url: payload.url || 'admin-messaging.html',
    kind: payload.kind || '',
    corrId: payload.corrId || '',
  });

  const dead = [];
  await Promise.all(
    list.filter(wants).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          body,
          { TTL: 600 },
        );
        sent += 1;
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
        else console.log('[push] send failed', code || err.message);
      }
    }),
  );
  if (dead.length) {
    const keep = list.filter((s) => !dead.includes(s.endpoint));
    saveSubs(keep);
    pruned = dead.length;
  }
  return { sent, pruned };
}

module.exports = {
  SUBS_FILE,
  getPublicKey,
  getInternalToken,
  addSub,
  removeSub,
  countForUser,
  loadSubs,
  notify,
};

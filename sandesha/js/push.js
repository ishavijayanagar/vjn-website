/**
 * Web Push subscription helper for the Sandesha messaging + promotions apps.
 *
 * The Sandesha server owns the VAPID keypair and the subscription store; this
 * module registers the service worker, gets the user's permission, subscribes
 * with `pushManager`, and hands the subscription to `POST /push/subscribe`.
 */
import { api } from './api.js';

const LOCAL_ON = 'sandesha_push_on';

export function supported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Make sure sw.js is registered (promotions app doesn't do it elsewhere). */
export async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (err) {
    console.warn('[push] SW register failed', err);
    return null;
  }
}

function wantsOn() {
  try { return localStorage.getItem(LOCAL_ON) === '1'; } catch { return false; }
}
function setWants(on) {
  try {
    if (on) localStorage.setItem(LOCAL_ON, '1');
    else localStorage.removeItem(LOCAL_ON);
  } catch { /* private mode */ }
}

/** 'unsupported' | 'denied' | 'off' | 'on' */
export async function state() {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub && wantsOn() ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

function urlB64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Prompt + subscribe. Returns true once the server has the subscription. */
export async function enable() {
  if (!supported()) throw new Error('Notifications are not supported on this device');
  await ensureServiceWorker();

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    setWants(false);
    throw new Error(perm === 'denied'
      ? 'Notifications are blocked — turn them on in your browser/site settings'
      : 'Notification permission was dismissed');
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api('/push/vapid-public-key');
    if (!key) throw new Error('Server has no push key configured');
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(key),
    });
  }
  await api('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  setWants(true);
  return true;
}

/** Unsubscribe locally and tell the server to drop it. */
export async function disable() {
  setWants(false);
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch { /* ignore */ }
}

export async function sendTest() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return api('/push/test', {
    method: 'POST',
    body: JSON.stringify({ endpoint: sub ? sub.endpoint : '' }),
  });
}

/**
 * Call on app boot. If the user had push on, re-register the (possibly rotated)
 * subscription with the server so the store stays fresh. Silent — never throws.
 */
export async function syncOnLoad() {
  if (!supported() || !wantsOn() || Notification.permission !== 'granted') return;
  try {
    await ensureServiceWorker();
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await api('/push/vapid-public-key');
      if (!key) return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(key),
      });
    }
    await api('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch (err) {
    console.warn('[push] sync failed', err);
  }
}

import { getApiBase, getToken } from './api.js';

const banner = () => document.getElementById('sandesha-pairing-banner') || document.getElementById('pairing-banner');

/**
 * Show reconnect banner when WhatsApp needs a pairing code or QR scan.
 */
export function updatePairingBanner(health) {
  const el = banner();
  if (!el) return;

  const wa = health?.whatsapp;
  const code = wa?.pairingCode;
  const qr = wa?.qrAvailable;
  const show = Boolean(code || qr);

  el.classList.toggle('hidden', !show);
  if (!show) {
    const qrEl = el.querySelector('[data-pairing-qr]');
    if (qrEl) {
      qrEl.removeAttribute('src');
      qrEl.classList.add('hidden');
    }
    return;
  }

  const codeEl = el.querySelector('[data-pairing-code]');
  const helpEl = el.querySelector('[data-pairing-help]');
  const metaEl = el.querySelector('[data-pairing-meta]');
  const qrEl = el.querySelector('[data-pairing-qr]');

  if (code) {
    if (helpEl) {
      helpEl.textContent =
        'WhatsApp logged out. On your phone: Linked devices → Link a device → Link with phone number → enter this code:';
    }
    if (codeEl) {
      codeEl.textContent = code;
      codeEl.classList.remove('hidden');
    }
  } else if (qr) {
    if (helpEl) {
      helpEl.textContent =
        'Scan this QR with WhatsApp on your phone: Linked devices → Link a device → Scan QR code';
    }
    if (codeEl) codeEl.classList.add('hidden');
  }

  if (metaEl) metaEl.textContent = '';

  if (qrEl) {
    if (qr) {
      loadQrInto(qrEl).catch(() => qrEl.classList.add('hidden'));
    } else {
      qrEl.removeAttribute('src');
      qrEl.classList.add('hidden');
    }
  }
}

async function loadQrInto(img) {
  const base = getApiBase().replace(/\/$/, '');
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/pairing/qr.png?t=${Date.now()}`, { headers });
  if (!res.ok) throw new Error('no qr');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (img.dataset.objectUrl) URL.revokeObjectURL(img.dataset.objectUrl);
  img.dataset.objectUrl = url;
  img.src = url;
  img.classList.remove('hidden');
}

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
  ensureEmailButton(el);

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

/** Adds an "Email me the QR code" button to the banner (once). */
function ensureEmailButton(el) {
  if (el.querySelector('[data-pairing-email]')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pairing-email-btn';
  btn.dataset.pairingEmail = '';
  const label = 'Email me the QR code';
  btn.textContent = label;
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const res = await fetch(`${getApiBase().replace(/\/$/, '')}/pairing/email-qr`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      btn.textContent = res.ok ? 'QR sent to email' : data.error || 'Could not send';
    } catch {
      btn.textContent = "Can't reach the server";
    }
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = label;
    }, 4000);
  });
  (el.querySelector('.pairing-banner-inner') || el).appendChild(btn);
}

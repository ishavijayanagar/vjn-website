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
  const unlinked = wa && !wa.connected && (wa.state === 'pairing' || wa.state === 'disconnected');
  const show = Boolean(code || qr || unlinked);

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
      helpEl.textContent = '';
    }
    if (codeEl) {
      codeEl.textContent = code;
      codeEl.classList.remove('hidden');
    }
  } else if (qr) {
    if (helpEl) {
      helpEl.textContent = '';
    }
    if (codeEl) codeEl.classList.add('hidden');
  } else {
    if (helpEl) {
      helpEl.textContent = '';
    }
    if (codeEl) codeEl.classList.add('hidden');
  }
  ensureChooser(el, wa);

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

/** "Show QR" / "Use a code" chooser (built once). Starts a fresh link attempt on the server. */
function ensureChooser(el, wa) {
  let box = el.querySelector('[data-pairing-chooser]');
  if (!box) {
    box = document.createElement('div');
    box.dataset.pairingChooser = '';
    box.style.cssText = 'margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
    box.innerHTML = `
      <button type="button" data-pairing-qr-btn>Show QR</button>
      <button type="button" data-pairing-code-btn>Use a code</button>
      <span data-pairing-phone-row hidden style="gap:6px;align-items:center">
        <input type="tel" inputmode="numeric" placeholder="Phone number" data-pairing-phone aria-label="Phone number with country code" style="width:150px">
        <button type="button" data-pairing-go>Get code</button>
      </span>
      <span data-pairing-msg style="font-size:12px;width:100%"></span>`;
    (el.querySelector('.pairing-banner-inner') || el).appendChild(box);

    const msg = box.querySelector('[data-pairing-msg]');
    const row = box.querySelector('[data-pairing-phone-row]');
    const start = async (payload, btn) => {
      btn.disabled = true;
      msg.textContent = payload.method === 'code' ? 'Requesting a code…' : 'Preparing the QR…';
      try {
        const headers = { 'Content-Type': 'application/json' };
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        const url = `${getApiBase().replace(/\/$/, '')}/pairing/start`;
        let res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
        let data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.needsConfirm) {
          if (!confirm(`${data.error}\n\nSign it out and link again?`)) {
            msg.textContent = 'Cancelled — the saved login was kept.';
            setTimeout(() => { btn.disabled = false; }, 1000);
            return;
          }
          res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...payload, force: true }) });
          data = await res.json().catch(() => ({}));
        }
        msg.textContent = res.ok ? 'Starting… the QR or code will appear here in a few seconds.' : data.error || 'Could not start';
      } catch {
        msg.textContent = "Can't reach the server";
      }
      setTimeout(() => { btn.disabled = false; }, 4000);
    };
    box.querySelector('[data-pairing-qr-btn]').addEventListener('click', (e) => start({ method: 'qr' }, e.currentTarget));
    box.querySelector('[data-pairing-code-btn]').addEventListener('click', () => {
      row.hidden = !row.hidden;
      row.style.display = row.hidden ? '' : 'inline-flex';
    });
    box.querySelector('[data-pairing-go]').addEventListener('click', (e) =>
      start({ method: 'code', phone: box.querySelector('[data-pairing-phone]').value }, e.currentTarget));
  }
  // Pre-fill the saved number once.
  const input = box.querySelector('[data-pairing-phone]');
  if (input && !input.value && wa?.pairingPhone) input.value = wa.pairingPhone;
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

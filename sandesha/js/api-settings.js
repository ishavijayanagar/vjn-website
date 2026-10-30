/**
 * Sandesha server URL — same as old Sandesha Settings "API URL" (localStorage override).
 */
import {
  getApiBase,
  getToken,
  setApiBase,
  getConfigApiUrl,
  hasApiOverride,
  clearApiOverride,
  escapeHtml,
} from './api.js';
import { toast } from './toast.js';
import { clearSandeshaSession } from './auth-bridge.js';

function normalizeUrl(raw) {
  let url = String(raw || '').trim().replace(/\/$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

async function testHealth(base) {
  const url = `${base.replace(/\/$/, '')}/health`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function statusBits(health) {
  const wa = health?.whatsapp;
  if (!health) {
    return { known: false, connected: false, state: '—', label: 'Checking' };
  }
  const connected = !!wa?.connected;
  const st = String(wa?.state || '').toLowerCase();
  const warn = !connected && (wa?.needsPairing || st === 'pairing' || st === 'connecting');
  const label = connected
    ? 'Connected'
    : wa?.needsPairing || st === 'pairing' ? 'Scan QR to link'
    : st === 'connecting' ? 'Starting…'
    : 'Not connected';
  return {
    known: true,
    connected,
    warn,
    state: wa?.state || (connected ? 'open' : 'offline'),
    label,
  };
}

/** Live-update the WhatsApp row without wiping a URL the user is editing. */
export function updateApiStatus(container, health) {
  if (!container) return;
  const bits = statusBits(health);
  const row = container.querySelector('[data-api-status]');
  const dot = container.querySelector('[data-api-dot]');
  if (row) row.textContent = bits.label;
  if (dot) {
    dot.classList.toggle('live', bits.connected);
    dot.classList.toggle('warn', !!bits.warn);
    dot.classList.toggle('down', bits.known && !bits.connected && !bits.warn);
    dot.classList.toggle('wait', !bits.known);
  }
  const qr = container.querySelector('[data-wa-qr]');
  if (qr) {
    qr.hidden = bits.connected;
    if (bits.connected) {
      const panel = qr.querySelector('[data-wa-qr-panel]');
      if (panel) panel.hidden = true;
    }
  }
}

function cardMarkup(defaultUrl, current, overridden) {
  return `
    <div class="card">
      <h2>Sandesha server</h2>
      <p class="hint">Paste the public URL (Tailscale Funnel or tunnel) shown by <code>./sandesha.sh status</code>. Saved on this device only.</p>
      <div class="field">
        <label for="sandesha-api-url">API URL</label>
        <input type="url" id="sandesha-api-url" inputmode="url" autocomplete="off"
               placeholder="https://your-machine.tail1234.ts.net"
               value="${escapeHtml(current)}">
      </div>
      <p class="hint mb-0" id="sandesha-api-meta">
        Default from config.js: <span class="mono">${escapeHtml(defaultUrl)}</span>
        ${overridden ? ' · <strong>using your override</strong>' : ''}
      </p>
      <div class="btn-row mt-md">
        <button type="button" class="btn secondary" id="sandesha-api-test">Test</button>
        <button type="button" class="btn" id="sandesha-api-save" disabled>Save</button>
      </div>
      ${overridden ? `
        <button type="button" class="btn secondary mt-sm" id="sandesha-api-reset" style="width:100%">
          Reset to config.js default
        </button>` : ''}
      <p class="hint mt-sm mb-0" id="sandesha-api-status" hidden></p>
    </div>`;
}

function iosMarkup(defaultUrl, current, overridden, health, showServer = true) {
  const bits = statusBits(health);
  const dotClass = bits.connected ? 'live' : bits.warn ? 'warn' : bits.known ? 'down' : 'wait';
  return `
    <section class="ios-block">
      <h2 class="ios-caption">WhatsApp</h2>
      <div class="ios-group">
        <div class="ios-row wa-status-row">
          <i class="ios-dot ${dotClass}" data-api-dot></i>
          <span class="wa-status-copy">
            <b data-api-status>${escapeHtml(bits.label)}</b>
          </span>
        </div>
        <div class="wa-qr-block" data-wa-qr ${bits.connected ? 'hidden' : ''}>
          <div class="wa-qr-actions">
            <button type="button" class="ios-btn" data-wa-qr-show>Show QR</button>
            <button type="button" class="ios-btn primary" data-wa-qr-send>Send QR</button>
          </div>
          <div class="wa-qr-panel" data-wa-qr-panel hidden>
            <img data-wa-qr-img alt="WhatsApp QR code" width="220" height="220" hidden/>
            <p class="wa-qr-note" data-wa-qr-note></p>
          </div>
        </div>
      </div>
    </section>

    ${showServer ? `    <section class="ios-block">
      <h2 class="ios-caption">Server</h2>
      <div class="ios-group">
        <label class="ios-field" for="sandesha-api-url">
          <span>URL</span>
          <input type="url" id="sandesha-api-url" inputmode="url" autocomplete="url" autocapitalize="off"
                 spellcheck="false" placeholder="https://your-machine.ts.net"
                 value="${escapeHtml(current)}">
        </label>
      </div>
      ${overridden ? `<p class="ios-foot" id="sandesha-api-meta">Saved on this phone. Default is <span class="ios-default">${escapeHtml(defaultUrl)}</span></p>` : ''}
      <div class="ios-actions">
        <button type="button" class="ios-btn" id="sandesha-api-test">Test</button>
        <button type="button" class="ios-btn primary" id="sandesha-api-save" disabled>Save</button>
      </div>
      ${overridden ? `
        <div class="ios-group">
          <button type="button" class="ios-row-btn danger" id="sandesha-api-reset">Reset to Default</button>
        </div>` : ''}
      <p class="ios-status" id="sandesha-api-status" hidden></p>
    </section>` : ''}`;
}

/**
 * @param {HTMLElement} container
 * @param {{ onSaved?: () => void, variant?: 'card' | 'ios', health?: object }} [opts]
 */
export function renderApiSettings(container, opts = {}) {
  if (!container) return;

  const defaultUrl = getConfigApiUrl();
  const current = getApiBase();
  const overridden = hasApiOverride();
  const health = typeof opts.getHealth === 'function' ? opts.getHealth() : opts.health;
  const ios = opts.variant === 'ios';

  container.innerHTML = ios
    ? iosMarkup(defaultUrl, current, overridden, health, opts.showServer !== false)
    : cardMarkup(defaultUrl, current, overridden);

  const input = container.querySelector('#sandesha-api-url');
  const saveBtn = container.querySelector('#sandesha-api-save');
  const statusEl = container.querySelector('#sandesha-api-status');
  const savedUrl = normalizeUrl(current);

  function urlChanged() {
    const next = normalizeUrl(input?.value);
    return !!next && next !== savedUrl;
  }

  function syncSave() {
    if (saveBtn) saveBtn.disabled = !urlChanged();
  }

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('ok', !!ok);
    statusEl.classList.toggle('err', !ok && !!msg);
  }

  input?.addEventListener('input', syncSave);
  input?.addEventListener('change', syncSave);
  syncSave();

  container.querySelector('#sandesha-api-test')?.addEventListener('click', async () => {
    const base = normalizeUrl(input?.value);
    if (!base) {
      toast('Enter a URL first', 'err');
      return;
    }
    setStatus('Testing…', true);
    try {
      const health = await testHealth(base);
      updateApiStatus(container, health);
      const wa = health?.whatsapp || {};
      const waState = wa.state || 'unknown';
      if (wa.connected) {
        setStatus(`Reachable · WhatsApp connected (${waState})`, true);
        toast('Server reachable · WhatsApp connected', 'ok');
      } else {
        setStatus(`Reachable · WhatsApp not connected (${waState})`, true);
        toast(`Server reachable · WhatsApp: ${waState}`, 'ok');
      }
    } catch (err) {
      setStatus(err.message || 'Could not reach server', false);
      toast(err.message || 'Test failed', 'err');
    }
  });

  saveBtn?.addEventListener('click', async () => {
    if (!urlChanged()) return;
    const base = normalizeUrl(input?.value);
    if (!base) {
      toast('Enter a URL', 'err');
      return;
    }
    setStatus('Testing before save…', true);
    try {
      await testHealth(base);
    } catch (err) {
      setStatus(`Save anyway? ${err.message}`, false);
      if (!confirm(`Could not reach ${base}. Save anyway?`)) return;
    }
    setApiBase(base);
    clearSandeshaSession();
    setStatus('Saved. Reconnecting…', true);
    toast('Server URL saved', 'ok');
    if (opts.onSaved) {
      try { await opts.onSaved(); } catch { /* ignore */ }
    }
    renderApiSettings(container, opts);
  });

  wireQrActions(container);

  container.querySelector('#sandesha-api-reset')?.addEventListener('click', async () => {
    clearApiOverride();
    clearSandeshaSession();
    toast('Reset to config.js URL', 'ok');
    if (opts.onSaved) {
      try { await opts.onSaved(); } catch { /* ignore */ }
    }
    renderApiSettings(container, opts);
  });
}

async function loadQrImage(img) {
  const base = getApiBase().replace(/\/$/, '');
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/pairing/qr.png?t=${Date.now()}`, { headers });
  if (!res.ok) {
    let msg = 'No QR yet. Wait a few seconds and try again.';
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch { /* not json */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (img.dataset.objectUrl) URL.revokeObjectURL(img.dataset.objectUrl);
  img.dataset.objectUrl = url;
  img.src = url;
  img.hidden = false;
  if (typeof img.decode === 'function') {
    try { await img.decode(); } catch { /* a broken frame still takes its layout box */ }
  }
}

/** The QR sits under the buttons, past the bottom of a phone screen. */
function scrollQrIntoView(panel) {
  if (!panel) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => {
    panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end', inline: 'nearest' });
  });
}

/** Show QR draws the code in this settings drawer. Send QR emails it. */
function wireQrActions(container) {
  const block = container.querySelector('[data-wa-qr]');
  if (!block) return;
  const showBtn = block.querySelector('[data-wa-qr-show]');
  const sendBtn = block.querySelector('[data-wa-qr-send]');
  const panel = block.querySelector('[data-wa-qr-panel]');
  const img = block.querySelector('[data-wa-qr-img]');
  const note = block.querySelector('[data-wa-qr-note]');

  showBtn?.addEventListener('click', async () => {
    if (!panel || !img || showBtn.disabled) return;
    panel.hidden = false;
    img.hidden = true;
    if (note) note.textContent = 'Loading the QR…';
    showBtn.disabled = true;
    try {
      await loadQrImage(img);
      if (note) note.textContent = 'WhatsApp → Linked devices → Link a device';
      scrollQrIntoView(panel);
    } catch (err) {
      img.hidden = true;
      const msg = err.message || 'No QR yet';
      if (note) note.textContent = msg;
      toast(msg, 'err');
      scrollQrIntoView(panel);
    } finally {
      showBtn.disabled = false;
    }
  });

  sendBtn?.addEventListener('click', async () => {
    if (sendBtn.disabled) return;
    const label = sendBtn.textContent;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
      const res = await fetch(`${getApiBase().replace(/\/$/, '')}/pairing/email-qr`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send');
      toast('QR sent to email', 'ok');
    } catch (err) {
      toast(err.message || "Can't reach the server", 'err');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = label;
    }
  });
}

import { api, uploadFile, escapeHtml } from '../api.js';
import { getState, getTargetOptions } from '../store.js';
import { openTargetPicker, formatTargetSummary } from '../target-picker.js';
import { toast } from '../toast.js';
import { pushSub } from '../router.js';
import { startProgress, updateProgress as busUpdate, endProgress } from '../progress-bus.js';

function getSendContainer() {
  return document.getElementById('page-compose')
    || document.getElementById('sandeshaSend')
    || document.getElementById('sub-send');
}

let selectedTargets = [];
let pendingFile = null;
let draftMessage = '';
let lastFailed = [];

function expandRecipients(selections) {
  const { sets } = getState();
  const recipients = [];
  const seen = new Set();

  for (const t of selections) {
    if (t.type === 'broadcast' || t.value === '__broadcast__') {
      return [{ value: '__broadcast__', label: 'All groups', broadcast: true }];
    }
    if (t.type === 'set') {
      const groups = sets[String(t.value).toLowerCase()] || [];
      for (const g of groups) {
        if (seen.has(g)) continue;
        seen.add(g);
        recipients.push({ value: g, label: `${t.label} → ${g}` });
      }
      continue;
    }
    if (seen.has(t.value)) continue;
    seen.add(t.value);
    recipients.push({ value: t.value, label: t.label || t.value });
  }
  return recipients;
}

function recipientSummary() {
  if (!selectedTargets.length) return '';
  const recipients = expandRecipients(selectedTargets);
  if (recipients.length === 1 && recipients[0].broadcast) {
    const n = (getState().groups || []).length;
    return `Broadcast · ~${n} group${n === 1 ? '' : 's'}`;
  }
  return `${recipients.length} chat${recipients.length === 1 ? '' : 's'} will be messaged`;
}

export function renderSend() {
  const container = getSendContainer();
  if (!container) return;
  const label = formatTargetSummary(selectedTargets);
  const sub = selectedTargets.length
    ? `${selectedTargets.length} selected`
    : 'Sets, groups, contacts, announcements…';
  const recSummary = recipientSummary();

  container.innerHTML = `
    <div class="card">
      <div class="field mb-0">
        <label>Send to</label>
        <button type="button" class="picker-trigger" id="send-target-btn">
          <div class="row-main">
            <div class="row-title">${escapeHtml(label)}</div>
            <div class="row-sub">${escapeHtml(sub)}</div>
          </div>
          <span class="chevron">›</span>
        </button>
        ${recSummary ? `<p class="hint compose-reach">${escapeHtml(recSummary)}</p>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="field mb-0">
        <label>Message</label>
        <textarea id="send-msg" rows="5" placeholder="Type your message…">${escapeHtml(draftMessage)}</textarea>
      </div>
    </div>
    <div class="card">
      <div class="field mb-0">
        <label>Media (optional)</label>
        <input type="file" id="send-media" accept="image/*,video/*">
        <p class="hint" id="send-media-name">${pendingFile ? escapeHtml(pendingFile.name) : 'Attach from gallery or camera'}</p>
      </div>
    </div>
    ${lastFailed.length ? `
    <div class="card compose-retry">
      <div class="row-main">
        <div class="row-title">${lastFailed.length} target${lastFailed.length === 1 ? '' : 's'} failed last time</div>
        <div class="row-sub">${escapeHtml(lastFailed.slice(0, 3).map((t) => t.label || t.value).join(', '))}${lastFailed.length > 3 ? '…' : ''}</div>
      </div>
      <button type="button" class="btn btn-sm secondary" id="send-retry">Retry failed</button>
    </div>` : ''}
    <div id="send-progress" class="dash-progress-wrap hidden">
      <div class="dash-progress-header">
        <span id="send-progress-label">Sending…</span>
        <span id="send-progress-eta" class="dash-progress-eta"></span>
      </div>
      <div class="dash-progress-bar">
        <div class="dash-progress-fill" id="send-progress-fill" style="width:0%"></div>
      </div>
      <div class="dash-progress-sub" id="send-progress-text"></div>
    </div>
    <div class="sticky-compose">
      <button type="button" class="btn" id="send-btn">Send</button>
    </div>`;

  const msgEl = container.querySelector('#send-msg');
  msgEl?.addEventListener('input', () => { draftMessage = msgEl.value; });

  container.querySelector('#send-target-btn')?.addEventListener('click', () => {
    openTargetPicker(getTargetOptions(), (picked) => {
      selectedTargets = Array.isArray(picked) ? picked : [picked];
      renderSend();
    }, { multi: true, selected: selectedTargets });
  });

  container.querySelector('#send-media')?.addEventListener('change', (e) => {
    pendingFile = e.target.files?.[0] || null;
    const hint = container.querySelector('#send-media-name');
    if (hint) hint.textContent = pendingFile ? pendingFile.name : 'Attach from gallery or camera';
  });

  container.querySelector('#send-retry')?.addEventListener('click', () => {
    selectedTargets = lastFailed.slice();
    lastFailed = [];
    renderSend();
  });

  container.querySelector('#send-btn')?.addEventListener('click', doSend);
}

async function doSend() {
  const container = getSendContainer();
  if (!container) return;
  const msg = container.querySelector('#send-msg')?.value?.trim();
  if (!selectedTargets.length) { toast('Choose at least one target', 'err'); return; }
  if (!msg && !pendingFile) { toast('Enter a message or attach media', 'err'); return; }

  const btn = container.querySelector('#send-btn');
  if (btn) btn.disabled = true;

  const recipients = expandRecipients(selectedTargets);
  lastFailed = [];

  try {
    if (recipients.length === 1 && recipients[0].broadcast) {
      if (window.SANDESHA_EMBEDDED_MODE === 'promotions') {
        toast('Broadcast requires admin login', 'err');
        return;
      }
      const opId = startProgress({ label: 'Broadcasting to all groups…', total: 1 });
      await api('/send/broadcast', { method: 'POST', body: JSON.stringify({ message: msg }) });
      endProgress({ id: opId, status: 'done', result: 'Broadcast sent to all groups' });
      // The server records every send in the shared activity log; the
      // sandesha:refresh below pulls it back within a second.
      toast('Broadcast sent', 'ok', 4000);
      draftMessage = '';
      pendingFile = null;
      selectedTargets = [];
      renderSend();
      window.dispatchEvent(new CustomEvent('sandesha:refresh'));
      return;
    }

    const showProgress = recipients.length > 1;
    const opId = showProgress
      ? startProgress({ label: `Sending to ${recipients.length} targets…`, total: recipients.length })
      : null;

    // Show local progress bar too if in send sub-page
    const progressEl    = container.querySelector('#send-progress');
    const progressFill  = container.querySelector('#send-progress-fill');
    const progressLabel = container.querySelector('#send-progress-label');
    const progressEta   = container.querySelector('#send-progress-eta');
    const progressText  = container.querySelector('#send-progress-text');
    if (showProgress) progressEl?.classList.remove('hidden');

    function syncLocalBar(done, total, eta) {
      const pct = Math.round((done / total) * 100);
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressLabel) progressLabel.textContent = `Sending ${done} of ${total}…`;
      if (progressText) progressText.textContent = `${total - done} remaining`;
      if (progressEta) progressEta.textContent = eta || '';
    }

    let filePath = null;
    if (pendingFile) {
      if (opId) busUpdate({ id: opId, done: 0, total: recipients.length, label: 'Uploading media…' });
      if (progressLabel) progressLabel.textContent = 'Uploading media…';
      const up = await uploadFile(pendingFile);
      filePath = up.filePath;
    }

    let ok = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i++) {
      const t = recipients[i];
      if (opId) busUpdate({ id: opId, done: i, total: recipients.length });
      const busState = opId ? (window._sandeshaProgress || {}) : {};
      if (showProgress) syncLocalBar(i, recipients.length, busState.eta || '');
      try {
        if (filePath) {
          await api('/send-media', {
            method: 'POST',
            body: JSON.stringify({ recipient: t.value, filePath, caption: msg || '' }),
          });
        } else {
          await api('/send', {
            method: 'POST',
            body: JSON.stringify({ recipient: t.value, message: msg }),
          });
        }
        ok += 1;
      } catch (err) {
        failed += 1;
        lastFailed.push(t);
        console.warn('Send failed for', t.value, err);
      }
      if (showProgress && i < recipients.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (showProgress) syncLocalBar(ok + failed, recipients.length, '');

    const summary = failed
      ? `Sent ${ok}, failed ${failed} of ${recipients.length}`
      : ok === 1 ? 'Message sent' : `Sent to ${ok} targets`;

    if (opId) endProgress({ id: opId, status: failed ? 'error' : 'done', result: summary });

    if (failed) toast(summary, 'err', 5000);
    else toast(summary, 'ok', 4000);

    // Keep the message on a partial failure so "Retry failed" can resend it.
    if (!failed) {
      draftMessage = '';
      pendingFile = null;
      selectedTargets = [];
    }
    renderSend();
    window.dispatchEvent(new CustomEvent('sandesha:refresh'));
  } catch (err) {
    toast(err.message || 'Send failed', 'err');
  } finally {
    if (btn) btn.disabled = false;
    container.querySelector('#send-progress')?.classList.add('hidden');
  }
}

export function prefillTarget(target) {
  selectedTargets = target ? [target] : [];
}

export function openSend() {
  // Compose lives under the Tools tab now; the header's Instant send button
  // (and anything else calling this) reaches it the same way as tapping the
  // Compose tile — as a sub-page over whatever's currently showing.
  pushSub('compose', 'Instant send');
  renderSend();
}

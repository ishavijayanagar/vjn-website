import { api, uploadFile, escapeHtml } from '../api.js';
import { getState, getTargetOptions } from '../store.js';
import { openTargetPicker, formatTargetSummary } from '../target-picker.js';
import { toast } from '../toast.js';
import { pushSub } from '../router.js';

const container = document.getElementById('sub-send');
let selectedTargets = [];
let pendingFile = null;

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

export function renderSend() {
  if (!container) return;
  const label = formatTargetSummary(selectedTargets);
  const sub = selectedTargets.length
    ? `${selectedTargets.length} selected`
    : 'Sets, groups, contacts, announcements…';

  container.innerHTML = `
    <div class="card">
      <div class="field">
        <label>Targets</label>
        <button type="button" class="picker-trigger" id="send-target-btn">
          <div class="row-main">
            <div class="row-title">${escapeHtml(label)}</div>
            <div class="row-sub">${escapeHtml(sub)}</div>
          </div>
          <span class="chevron">›</span>
        </button>
      </div>
    </div>
    <div class="card">
      <div class="field">
        <label>Message</label>
        <textarea id="send-msg" rows="4" placeholder="Type your message…"></textarea>
      </div>
    </div>
    <div class="card">
      <div class="field mb-0">
        <label>Media (optional)</label>
        <input type="file" id="send-media" accept="image/*,video/*">
        <p class="hint" id="send-media-name">${pendingFile ? escapeHtml(pendingFile.name) : 'Attach from gallery or camera'}</p>
      </div>
    </div>
    <div id="send-progress" class="card hidden">
      <div class="progress-bar"><div class="progress-bar-fill" id="send-progress-fill" style="width:0%"></div></div>
      <p class="hint mb-0" id="send-progress-text"></p>
    </div>
    <div class="sticky-compose">
      <button type="button" class="btn" id="send-btn">Send</button>
    </div>`;

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

  container.querySelector('#send-btn')?.addEventListener('click', doSend);
}

async function doSend() {
  const msg = container.querySelector('#send-msg')?.value?.trim();
  if (!selectedTargets.length) { toast('Choose at least one target', 'err'); return; }
  if (!msg && !pendingFile) { toast('Enter a message or attach media', 'err'); return; }

  const btn = container.querySelector('#send-btn');
  if (btn) btn.disabled = true;

  const recipients = expandRecipients(selectedTargets);

  try {
    if (recipients.length === 1 && recipients[0].broadcast) {
      await api('/send/broadcast', { method: 'POST', body: JSON.stringify({ message: msg }) });
      sessionStorage.setItem('sandesha_last_send', 'Broadcast sent');
      toast('Broadcast sent', 'ok');
      return;
    }

    const progressEl = container.querySelector('#send-progress');
    const progressFill = container.querySelector('#send-progress-fill');
    const progressText = container.querySelector('#send-progress-text');
    if (recipients.length > 1) progressEl?.classList.remove('hidden');

    let filePath = null;
    if (pendingFile) {
      const up = await uploadFile(pendingFile);
      filePath = up.filePath;
    }

    let ok = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i++) {
      const t = recipients[i];
      if (recipients.length > 1) {
        const pct = Math.round(((i + 1) / recipients.length) * 100);
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `Sending ${i + 1} of ${recipients.length}…`;
      }
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
        console.warn('Send failed for', t.value, err);
      }
      if (recipients.length > 1 && i < recipients.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    sessionStorage.setItem('sandesha_last_send', `Sent to ${ok}/${recipients.length} targets`);
    if (failed) toast(`Sent ${ok}, failed ${failed}`, 'err');
    else toast(ok === 1 ? 'Message sent' : `Sent to ${ok} targets`, 'ok');
    container.querySelector('#send-msg').value = '';
    pendingFile = null;
    renderSend();
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
  pushSub('send', 'Send');
  renderSend();
}

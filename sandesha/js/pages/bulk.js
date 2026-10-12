import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../api.js';
import { pushSub } from '../router.js';
import { parseNumbers } from '../phone.js';

let container = document.getElementById('sub-bulk');
export function mountBulk(el) {
  container = el || document.getElementById('sub-bulk');
}

let lastFailedNumbers = [];

export function renderBulk() {
  if (!container) return;
  container.innerHTML = `
    <div class="card">
      <h2>Send to numbers</h2>
      <p class="hint">One-to-one DMs — the riskiest path, so it's paced widely and stops if a cap is hit. Up to 100 per run.</p>
      <div class="field">
        <label>Numbers <span class="count-badge" id="bulk-count">0</span><span class="bulk-bad" id="bulk-bad" hidden></span></label>
        <textarea id="bulk-numbers" class="mono" rows="7" placeholder="+919876543210&#10;9876543210"></textarea>
      </div>
      <div class="field">
        <label>Message</label>
        <textarea id="bulk-msg" rows="4" placeholder="Message to send"></textarea>
      </div>
      ${lastFailedNumbers.length ? `
      <div class="compose-retry" style="margin-bottom:12px">
        <div class="row-main">
          <div class="row-title">${lastFailedNumbers.length} failed last run</div>
          <div class="row-sub">${escapeHtml(lastFailedNumbers.slice(0, 4).join(', '))}${lastFailedNumbers.length > 4 ? '…' : ''}</div>
        </div>
        <button type="button" class="btn btn-sm secondary" id="bulk-retry">Load failed</button>
      </div>` : ''}
      <button type="button" class="btn" id="bulk-send">Send to all numbers</button>
      <div id="bulk-progress" class="dash-progress-wrap hidden">
        <div class="dash-progress-header"><span id="bulk-progress-label">Sending…</span></div>
        <div class="dash-progress-bar"><div class="dash-progress-fill" id="bulk-progress-fill" style="width:0%"></div></div>
      </div>
      <div id="bulk-results" class="results-block"></div>
    </div>`;

  const nums = container.querySelector('#bulk-numbers');
  const countEl = container.querySelector('#bulk-count');
  const badEl = container.querySelector('#bulk-bad');
  function recount() {
    const { valid, invalid } = parseNumbers(nums.value);
    if (countEl) countEl.textContent = String(valid.length);
    if (badEl) {
      badEl.hidden = invalid.length === 0;
      badEl.textContent = invalid.length ? ` · ${invalid.length} unrecognised` : '';
    }
  }
  nums?.addEventListener('input', recount);
  recount();

  container.querySelector('#bulk-retry')?.addEventListener('click', () => {
    nums.value = lastFailedNumbers.join('\n');
    lastFailedNumbers = [];
    renderBulk();
  });

  container.querySelector('#bulk-send')?.addEventListener('click', doBulkSend);
}

async function doBulkSend() {
  const nums = container.querySelector('#bulk-numbers');
  const message = container.querySelector('#bulk-msg')?.value?.trim();
  const { valid } = parseNumbers(nums?.value || '');
  if (!valid.length || !message) { toast('Valid numbers and a message are required', 'err'); return; }

  const btn = container.querySelector('#bulk-send');
  const progressEl = container.querySelector('#bulk-progress');
  const fillEl = container.querySelector('#bulk-progress-fill');
  const resultsEl = container.querySelector('#bulk-results');
  if (btn) btn.disabled = true;
  progressEl?.classList.remove('hidden');
  if (fillEl) fillEl.style.width = '15%';
  if (resultsEl) resultsEl.innerHTML = '<p class="hint">Sending — this is paced, so it can take a while…</p>';

  try {
    const data = await api('/send/bulk', {
      method: 'POST',
      body: JSON.stringify({ numbers: valid.join('\n'), message }),
    });
    const results = data.results || [];
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    lastFailedNumbers = failed.map((r) => r.number);
    if (fillEl) fillEl.style.width = '100%';
    if (resultsEl) {
      resultsEl.innerHTML = `<p class="hint">Sent ${ok} of ${results.length}${failed.length ? ` · ${failed.length} failed` : ''}</p>` +
        failed.slice(0, 12).map((r) => `<p class="hint err">${escapeHtml(r.number)}: ${escapeHtml(r.error || 'failed')}</p>`).join('');
    }
    toast(`Bulk send: ${ok}/${results.length} ok`, ok === results.length ? 'ok' : 'info');
    window.dispatchEvent(new CustomEvent('sandesha:refresh'));
    renderBulk();
  } catch (err) {
    toast(err.message, 'err');
    if (resultsEl) resultsEl.innerHTML = '';
  } finally {
    const b = container.querySelector('#bulk-send');
    if (b) b.disabled = false;
    container.querySelector('#bulk-progress')?.classList.add('hidden');
  }
}

export function openBulk() {
  pushSub('bulk', 'Send to numbers');
  renderBulk();
}

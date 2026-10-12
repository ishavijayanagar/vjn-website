import { api, escapeHtml, escapeAttr } from '../api.js';
import { getState, rememberGroup } from '../store.js';
import { toast } from '../toast.js';
import { pushSub } from '../router.js';
import { openTargetPicker } from '../target-picker.js';
import { digitsFromPhone, parseNumbers, formatNumber } from '../phone.js';

const container = document.getElementById('sub-add-members');
let pollTimer = null;
let pollStartTs = 0;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['done', 'completed', 'cancelled', 'error', 'failed', 'stopped']);

let searchAbort = null;
let searchDebounce = null;

// Screen state
let group = null;      // { jid, name }
let numbers = [];      // de-duped digit strings
let showPaste = false;
let focusCreate = false;

export function renderAddMembers() {
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <h2>Add people to a group</h2>
      <p class="hint">Added one at a time, ~90s apart. Up to 50 per job.</p>

      <div class="field">
        <label>Group</label>
        <button type="button" class="picker-trigger" id="am-group-btn">
          <div class="row-main">
            <div class="row-title">${group ? escapeHtml(group.name) : 'Choose a group'}</div>
            <div class="row-sub">${group ? 'Tap to change' : 'Search your WhatsApp groups'}</div>
          </div>
          <span class="chevron">›</span>
        </button>
        ${group ? `<div class="am-sub-actions"><button type="button" class="linkbtn" id="am-invite-link">Copy join link</button></div>` : ''}
      </div>

      <div class="field">
        <label>People <span class="count-badge" id="am-count">${numbers.length}</span></label>
        <div class="chip-input" id="am-chips">
          ${numbers.map((d) => chipHtml(d)).join('')}
          <input type="text" inputmode="tel" id="am-num-input" class="chip-input-field" placeholder="${numbers.length ? 'Add another…' : 'Type or paste — space or Enter to add'}"/>
        </div>
        <div class="am-sub-actions">
          <button type="button" class="linkbtn" id="am-paste-toggle">${showPaste ? 'Hide list paste' : 'Paste a whole list…'}</button>
          ${numbers.length ? `<button type="button" class="linkbtn danger" id="am-clear-nums">Clear all</button>` : ''}
        </div>
        <div id="am-paste-wrap" ${showPaste ? '' : 'hidden'}>
          <textarea id="am-numbers" class="mono" rows="5" placeholder="One number per line — paste, then Add"></textarea>
          <button type="button" class="btn btn-sm secondary" id="am-paste-add">Add these</button>
        </div>
      </div>

      <div class="field">
        <label for="am-contact-search">Add from contacts</label>
        <input type="search" id="am-contact-search" autocomplete="off" placeholder="Search by name or number…"/>
        <div id="am-contact-list" class="am-picker-list" hidden></div>
      </div>

      <button type="button" class="btn" id="am-start">Start job</button>
      <div id="am-progress" class="dash-progress-wrap hidden">
        <div class="dash-progress-header">
          <span id="am-progress-label">Starting…</span>
          <button type="button" class="linkbtn" id="am-stop-poll">Stop watching</button>
        </div>
        <div class="dash-progress-bar"><div class="dash-progress-fill" id="am-progress-fill" style="width:0%"></div></div>
        <div class="dash-progress-sub" id="am-progress-sub"></div>
      </div>
      <div id="am-errors"></div>
    </div>

    <div class="card mt-lg" id="am-create-card">
      <h2>Create a new group</h2>
      <p class="hint">Makes an empty group you can then add people to above.</p>
      <div class="field">
        <label>Group name</label>
        <input type="text" id="am-new-name" placeholder="Group name…"/>
      </div>
      <button type="button" class="btn secondary" id="am-create">Create group</button>
      <div id="am-create-result"></div>
    </div>`;

  wireGroupPicker();
  wireInviteLink();
  wireNumberInput();
  wireContactSearch();
  container.querySelector('#am-start')?.addEventListener('click', startJob);
  container.querySelector('#am-create')?.addEventListener('click', createGroup);
  container.querySelector('#am-stop-poll')?.addEventListener('click', () => {
    stopPoll(container.querySelector('#am-start'));
    setProgressLabel('Stopped watching — the job may still be running on the server.');
  });

  if (focusCreate) {
    focusCreate = false;
    container.querySelector('#am-create-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    container.querySelector('#am-new-name')?.focus();
  }
}

/* ── chips ─────────────────────────────────────────────────── */

function chipHtml(digits) {
  return `<span class="chip-token" data-d="${escapeAttr(digits)}">${escapeHtml(formatNumber(digits))}<button type="button" class="chip-x" aria-label="Remove">×</button></span>`;
}

/** Add one contact-picked number (single, already a bare number). */
function addNumber(raw) {
  const d = digitsFromPhone(raw);
  if (!d) { toast('That does not look like a phone number', 'err'); return false; }
  if (numbers.includes(d)) { toast('Already in the list', 'ok'); return false; }
  if (numbers.length >= 50) { toast('50 is the max per job', 'err'); return false; }
  numbers.push(d);
  refreshChips();
  return true;
}

/** Pull number(s) out of one segment.
 * "+91 99127 89540"  → ["919912789540"]   (spaces are part of one number)
 * "9912789540 9481381212" → both           (space-separated list)
 */
function numbersInSegment(segment) {
  const whole = digitsFromPhone(segment);
  if (whole) return [whole];
  return segment
    .split(/\s+/)
    .map((p) => digitsFromPhone(p))
    .filter(Boolean);
}

/**
 * Add every number found in a free-text string. Commas / semicolons / newlines
 * always separate numbers; a space only separates when the space-joined text
 * isn't itself a valid number (so "+91 99127 89540" stays one number).
 * @param {boolean} keepTail  keep the still-being-typed trailing fragment in the field
 * @returns {string} leftover text for the caller to put back in the field
 */
function addFromText(raw, keepTail = false) {
  const text = String(raw || '');
  const segments = text.split(/[\n,;]+/);
  let tail = '';
  if (keepTail && segments.length && !/[\n,;]$/.test(text)) {
    const last = segments[segments.length - 1] || '';
    // Only hold back a fragment that isn't a number and has no inner space
    // (i.e. the user is still mid-typing a single number).
    if (!digitsFromPhone(last) && !/\s/.test(last.trim())) tail = segments.pop() || '';
  }

  let added = 0;
  let dupes = 0;
  let bad = 0;
  for (const seg of segments) {
    if (!seg.trim()) continue;
    const found = numbersInSegment(seg);
    if (!found.length) { bad += 1; continue; }
    for (const d of found) {
      if (numbers.includes(d)) { dupes += 1; continue; }
      if (numbers.length >= 50) { bad += 1; continue; }
      numbers.push(d);
      added += 1;
    }
  }
  if (added || dupes || bad) refreshChips();
  if (added || bad || dupes) {
    const parts = [];
    if (added) parts.push(`Added ${added}`);
    if (dupes) parts.push(`${dupes} already in list`);
    if (bad) parts.push(`${bad} not recognised`);
    toast(parts.join(' · '), bad && !added ? 'err' : 'ok');
  }
  return tail;
}

function removeNumber(d) {
  numbers = numbers.filter((x) => x !== d);
  refreshChips();
}

function refreshChips() {
  const wrap = container.querySelector('#am-chips');
  const input = container.querySelector('#am-num-input');
  const countEl = container.querySelector('#am-count');
  if (!wrap || !input) return;
  wrap.querySelectorAll('.chip-token').forEach((el) => el.remove());
  input.insertAdjacentHTML('beforebegin', numbers.map((d) => chipHtml(d)).join(''));
  wrap.querySelectorAll('.chip-x').forEach((btn) => {
    btn.addEventListener('click', () => removeNumber(btn.parentElement.dataset.d));
  });
  if (countEl) countEl.textContent = String(numbers.length);
  input.placeholder = numbers.length ? 'Add another…' : 'Type or paste — space or Enter to add';
  // Show/hide "Clear all"
  const subActions = container.querySelector('.am-sub-actions');
  if (subActions && !subActions.querySelector('#am-clear-nums') && numbers.length) {
    subActions.insertAdjacentHTML('beforeend', '<button type="button" class="linkbtn danger" id="am-clear-nums">Clear all</button>');
    subActions.querySelector('#am-clear-nums').addEventListener('click', clearNumbers);
  } else if (subActions && !numbers.length) {
    subActions.querySelector('#am-clear-nums')?.remove();
  }
}

function clearNumbers() {
  numbers = [];
  refreshChips();
}

function wireNumberInput() {
  const input = container.querySelector('#am-num-input');

  // Commas / semicolons / newlines split numbers as you type (and on paste).
  // A single space does NOT — it's often part of one number ("+91 99127 89540")
  // — so a space-separated list is resolved on Enter / when the field loses focus.
  input?.addEventListener('input', () => {
    if (/[,;\n]/.test(input.value)) {
      input.value = addFromText(input.value, true);
    }
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.value = addFromText(input.value, false);
    } else if (e.key === 'Backspace' && !input.value && numbers.length) {
      removeNumber(numbers[numbers.length - 1]);
    }
  });
  input?.addEventListener('blur', () => {
    if (input.value.trim()) input.value = addFromText(input.value, false);
  });

  container.querySelector('#am-chips')?.querySelectorAll('.chip-x').forEach((btn) => {
    btn.addEventListener('click', () => removeNumber(btn.parentElement.dataset.d));
  });

  container.querySelector('#am-paste-toggle')?.addEventListener('click', () => {
    showPaste = !showPaste;
    const wrap = container.querySelector('#am-paste-wrap');
    if (wrap) wrap.hidden = !showPaste;
    container.querySelector('#am-paste-toggle').textContent = showPaste ? 'Hide list paste' : 'Paste a whole list…';
    if (showPaste) container.querySelector('#am-numbers')?.focus();
  });

  container.querySelector('#am-clear-nums')?.addEventListener('click', clearNumbers);

  container.querySelector('#am-paste-add')?.addEventListener('click', () => {
    const ta = container.querySelector('#am-numbers');
    if (!ta) return;
    const { valid, invalid } = parseNumbers(ta.value);
    let added = 0;
    for (const d of valid) {
      if (numbers.length >= 50) break;
      if (!numbers.includes(d)) { numbers.push(d); added += 1; }
    }
    refreshChips();
    ta.value = '';
    const parts = [`Added ${added}`];
    if (invalid.length) parts.push(`${invalid.length} skipped`);
    toast(parts.join(' · '), invalid.length ? 'info' : 'ok');
  });
}

/* ── group picker ──────────────────────────────────────────── */

function groupOptions() {
  return (getState().groups || []).map((g) => ({
    type: 'group', label: g.name, value: g.jid, sub: `${g.participants ?? '?'} members`,
  }));
}

function wireGroupPicker() {
  container.querySelector('#am-group-btn')?.addEventListener('click', () => {
    openTargetPicker(groupOptions(), (picked) => {
      const p = Array.isArray(picked) ? picked[0] : picked;
      if (!p) return;
      group = { jid: p.value, name: p.label };
      renderAddMembers();
    }, { multi: false });
  });
}

function wireInviteLink() {
  const btn = container.querySelector('#am-invite-link');
  if (!btn || !group?.jid) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Fetching…';
    try {
      const { link } = await api(`/groups/${encodeURIComponent(group.jid)}/invite`);
      let copied = false;
      try { await navigator.clipboard.writeText(link); copied = true; } catch { /* clipboard blocked */ }
      toast(copied ? 'Join link copied' : link, copied ? 'ok' : 'info', copied ? 3000 : 8000);
    } catch (err) {
      toast(err.message || 'Could not get the join link', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Copy join link';
    }
  });
}

/* ── contact search ────────────────────────────────────────── */

function savedContactEntries() {
  const entries = [];
  const seen = new Set();
  Object.entries(getState().contacts || {}).forEach(([name, number]) => {
    const digits = digitsFromPhone(number);
    if (!digits || seen.has(digits)) return;
    seen.add(digits);
    entries.push({ name: String(name || '').trim() || digits, digits, sub: String(number || digits).trim() });
  });
  return entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function wireContactSearch() {
  const searchEl = container.querySelector('#am-contact-search');
  const listEl = container.querySelector('#am-contact-list');
  if (!searchEl || !listEl) return;

  searchAbort?.abort();
  searchAbort = null;
  clearTimeout(searchDebounce);

  const MAX_SHOW = 30;

  function render(matches, emptyMsg) {
    listEl.innerHTML = matches.length
      ? matches.slice(0, MAX_SHOW).map((c) =>
          `<button type="button" class="am-picker-item" data-digits="${escapeAttr(c.digits)}">` +
          `<span class="am-picker-item-title">${escapeHtml(c.name)}</span>` +
          `<span class="am-picker-item-sub">${escapeHtml(c.sub || c.digits)}</span></button>`).join('')
      : `<div class="am-picker-empty">${escapeHtml(emptyMsg)}</div>`;
    listEl.hidden = false;
    listEl.querySelectorAll('.am-picker-item').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (addNumber(btn.dataset.digits)) {
          searchEl.value = '';
          listEl.hidden = true;
        }
      });
    });
  }

  function savedMatches(query) {
    const q = query.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    return savedContactEntries().filter((c) =>
      !q || c.name.toLowerCase().includes(q) || (qd && c.digits.includes(qd)) || c.sub.toLowerCase().includes(q));
  }

  async function runSearch(query) {
    const q = query.trim();
    const instant = savedMatches(q);
    if (!q) { render(instant, 'No saved contacts — type to search your WhatsApp contacts'); return; }
    if (instant.length) render(instant, 'No matches');
    if (q.length < 2) return;

    searchAbort?.abort();
    searchAbort = new AbortController();
    const { signal } = searchAbort;
    if (!instant.length) { listEl.innerHTML = '<div class="am-picker-empty">Searching…</div>'; listEl.hidden = false; }
    try {
      const data = await api(`/contacts/search?q=${encodeURIComponent(q)}`, { signal });
      if (signal.aborted) return;
      const remote = (data.results || [])
        .filter((r) => digitsFromPhone(r.phone)) // drop @lid / non-dialable results
        .map((r) => ({ name: r.name, digits: digitsFromPhone(r.phone), sub: r.phone }));
      render(remote.length ? remote : instant, 'No matches');
    } catch (err) {
      if (err?.name !== 'AbortError') render(instant, 'No matches');
    }
  }

  searchEl.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const instant = savedMatches(searchEl.value);
    if (!searchEl.value.trim() || instant.length) render(instant, 'No matches');
    if (searchEl.value.trim().length >= 2) searchDebounce = setTimeout(() => runSearch(searchEl.value), 380);
  });
  searchEl.addEventListener('focus', () => runSearch(searchEl.value));
  searchEl.addEventListener('blur', () => setTimeout(() => { listEl.hidden = true; }, 150));
}

/* ── the job ───────────────────────────────────────────────── */

function setProgressLabel(text) {
  const el = container?.querySelector('#am-progress-label');
  if (el) el.textContent = text;
}

function stopPoll(btn) {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (btn) btn.disabled = false;
}

async function startJob() {
  // Pull in anything still sitting in the input field, unconfirmed.
  const pending = container.querySelector('#am-num-input');
  if (pending?.value.trim()) pending.value = addFromText(pending.value, false);

  if (!group?.jid) { toast('Choose a group first', 'err'); return; }
  if (!numbers.length) { toast('Add at least one number', 'err'); return; }

  stopPoll(container.querySelector('#am-start'));
  pollStartTs = Date.now();

  const btn = container.querySelector('#am-start');
  const progressEl = container.querySelector('#am-progress');
  const fillEl = container.querySelector('#am-progress-fill');
  const subEl = container.querySelector('#am-progress-sub');
  const errorsEl = container.querySelector('#am-errors');
  if (btn) btn.disabled = true;
  progressEl?.classList.remove('hidden');
  setProgressLabel('Starting…');
  if (fillEl) fillEl.style.width = '0%';

  try {
    const { jobId } = await api('/jobs/add-members', {
      method: 'POST',
      body: JSON.stringify({ groupJid: group.jid, numbers: numbers.join('\n') }),
    });
    toast('Job started', 'ok');

    let stuckCount = 0;
    let lastDone = -1;

    pollTimer = setInterval(async () => {
      if (Date.now() - pollStartTs > POLL_TIMEOUT_MS) {
        stopPoll(btn);
        setProgressLabel('Timed out after 20 min — check the server logs.');
        return;
      }
      try {
        const job = await api(`/jobs/${jobId}`);
        const elapsed = Math.round((Date.now() - pollStartTs) / 1000);
        const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
        const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
        const added = job.added ?? 0;
        const invited = job.invited ?? 0;
        if (fillEl) fillEl.style.width = `${pct}%`;
        setProgressLabel(`${job.status} · ${job.done}/${job.total} (${pct}%)`);
        if (subEl) {
          const bits = [`${elapsedStr} elapsed`];
          if (added) bits.push(`${added} added`);
          if (invited) bits.push(`${invited} link sent`);
          subEl.textContent = bits.join(' · ');
        }

        if (errorsEl && job.errors?.length) {
          errorsEl.innerHTML = `<p class="hint">Details:</p>` +
            job.errors.map((e) => `<p class="hint ${/link sent|join link/i.test(e) ? '' : 'err'}">${escapeHtml(e)}</p>`).join('');
        }

        const isTerminal = TERMINAL_STATUSES.has(job.status);
        const allDone = job.total > 0 && job.done >= job.total;
        if (job.done === lastDone && allDone) stuckCount += 1; else stuckCount = 0;
        lastDone = job.done;

        if (isTerminal || stuckCount >= 3) {
          stopPoll(btn);
          const isErr = job.status === 'error' || job.status === 'failed';
          const stopped = job.status === 'stopped';
          const parts = [`${added} added`];
          if (invited) parts.push(`${invited} sent a join link`);
          setProgressLabel(isErr
            ? `Failed (${job.done}/${job.total})`
            : stopped
              ? `Stopped early — ${parts.join(', ')}`
              : `Done — ${parts.join(', ')}`);
          toast(
            isErr ? 'Job ended with errors' : stopped ? 'Stopped — WhatsApp cooldown' : 'Job finished',
            isErr || stopped ? 'err' : 'ok',
          );
          if (!isErr && !stopped) { numbers = []; refreshChips(); }
          window.dispatchEvent(new CustomEvent('sandesha:refresh'));
        }
      } catch {
        stopPoll(btn);
        setProgressLabel('Lost contact with the server — the job may still be running.');
      }
    }, 3000);
  } catch (err) {
    toast(err.message, 'err');
    if (btn) btn.disabled = false;
    progressEl?.classList.add('hidden');
  }
}

async function createGroup() {
  const nameEl = container.querySelector('#am-new-name');
  const btn = container.querySelector('#am-create');
  const resultEl = container.querySelector('#am-create-result');
  const title = nameEl?.value.trim();
  if (!title) { toast('Enter a group name', 'err'); return; }

  if (btn) btn.disabled = true;
  if (resultEl) resultEl.textContent = '';
  try {
    const res = await api('/groups', { method: 'POST', body: JSON.stringify({ title }) });
    const createdName = res.title || title;
    rememberGroup({ name: createdName, jid: res.jid });
    if (res.jid) group = { jid: res.jid, name: createdName };
    toast('Group created', 'ok');
    if (nameEl) nameEl.value = '';
    // Propagate the new group everywhere (Compose, Audience, store).
    window.dispatchEvent(new CustomEvent('sandesha:refresh'));
    renderAddMembers();
    const rEl = container.querySelector('#am-create-result');
    if (rEl) rEl.innerHTML = `<p class="hint" style="color:var(--isha-sage-dark)">✓ "${escapeHtml(createdName)}" created and selected above.</p>`;
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    const b = container.querySelector('#am-create');
    if (b) b.disabled = false;
  }
}

export function unmountAddMembers() {
  stopPoll(null);
}

export function openAddMembers(opts = {}) {
  if (opts.groupJid) {
    const g = (getState().groups || []).find((x) => x.jid === opts.groupJid);
    group = { jid: opts.groupJid, name: g?.name || 'Group' };
  }
  focusCreate = opts.focus === 'create';
  pushSub('add-members', 'Add people');
  renderAddMembers();
}

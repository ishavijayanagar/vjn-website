/**
 * Compose screen for admin-promotions.html.
 *
 * One screen for both outcomes: "Send now" pushes straight to WhatsApp,
 * "Schedule" writes a row the server sends later. The WhatsApp preview is
 * the point of the screen — you read the bubble, not the form.
 */
import { api, uploadFile, escapeHtml, fetchMedia } from '../api.js';
import { getState, getTargetOptions, loadChats, ensureGroups, ensureSets } from '../store.js?v=34';
import { scheduleTargets } from '../schedule-targets.js?v=34';
import { toast } from '../toast.js';
import { openAudienceSheet, audienceSummary, audienceTotal } from '../promo-audience.js?v=34';

/**
 * Gap between chats on an interactive "Send now", per SENDING_SAFETY.md §5.
 * The server uses 45–90s; this is the document's fallback range for a fan-out
 * that genuinely cannot spread, because someone is sitting watching it finish.
 * Randomised either way — a fixed interval is the fingerprint, not the volume.
 */
const GAP_MIN_MS = 20000;
const GAP_MAX_MS = 40000;

function sendGap() {
  const ms = GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sending in a different order each time removes the fan-out sequence signal. */
function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const MAX_CHARS = 4096;
const WARN_CHARS = 3800;

const TICK_SENT = '<svg width="15" height="11" viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6.5L4.2 10 11 2"/><path d="M7.4 8.6L9 10.2 16.6 2"/></svg>';
const TICK_PENDING = '<svg width="12" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6.5L4.2 10 11 2"/></svg>';
const TICK_CLOCK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const CHEVRON = '<svg class="chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

const draft = {
  later: false,
  targets: [],
  message: '',
  runAt: '',
  file: null,
  fileUrl: '',
  // Editing a queued message: the rows it currently occupies, and the flyer
  // already on the server, so an unchanged attachment is not re-uploaded.
  replacingIds: [],
  keepFilePath: '',
  keepFileName: '',
  keepFileUrl: '',
};
let sending = false;

/*
 * Android Chrome reloads a tab it threw away in the background, which used to
 * lose a half-written post. The draft is kept in this tab's sessionStorage
 * whenever the page is hidden, and picked back up when the module loads.
 * A picked-but-not-uploaded file can't be kept; the person is told to re-add it.
 */
const SAVED_DRAFT_KEY = 'vjn-compose-draft';
// True while a send is running on the server: the draft is no longer "unfinished",
// and saving it again would offer to send the same message twice after a reload.
let handedOver = false;
const SAVED_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
let restoredNotice = '';

function persistDraft() {
  if (handedOver) return;
  try {
    const empty = !draft.message.trim() && !draft.targets.length && !draft.replacingIds.length
      && !draft.keepFilePath && !draft.file;
    if (empty) {
      sessionStorage.removeItem(SAVED_DRAFT_KEY);
      return;
    }
    sessionStorage.setItem(SAVED_DRAFT_KEY, JSON.stringify({
      at: Date.now(),
      later: draft.later,
      targets: draft.targets,
      message: draft.message,
      runAt: draft.runAt,
      replacingIds: draft.replacingIds,
      keepFilePath: draft.keepFilePath,
      keepFileName: draft.keepFileName,
      hadFile: !!draft.file,
    }));
  } catch { /* storage off or full */ }
}

function restoreSavedDraft() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SAVED_DRAFT_KEY) || 'null'); } catch { saved = null; }
  if (!saved || Date.now() - (saved.at || 0) > SAVED_DRAFT_MAX_AGE_MS) return;
  draft.later = !!saved.later;
  draft.targets = Array.isArray(saved.targets) ? saved.targets : [];
  draft.message = String(saved.message || '');
  draft.runAt = String(saved.runAt || '');
  draft.replacingIds = Array.isArray(saved.replacingIds) ? saved.replacingIds.map(String) : [];
  draft.keepFilePath = String(saved.keepFilePath || '');
  draft.keepFileName = String(saved.keepFileName || '');
  if (draft.keepFilePath) {
    const wanted = draft.keepFilePath;
    fetchMedia(wanted)
      .then(({ blob }) => {
        if (draft.keepFilePath !== wanted) return;
        draft.keepFileUrl = URL.createObjectURL(blob);
        sync();
      })
      .catch(() => { /* the name in the field is enough on its own */ });
  }
  if (draft.message.trim() || saved.hadFile) {
    restoredNotice = saved.hadFile
      ? 'We kept your unfinished post. Please add the picture again.'
      : 'We kept your unfinished post.';
  }
}

restoreSavedDraft();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistDraft();
});
window.addEventListener('pagehide', persistDraft);
let delivered = false;

function isEditing() {
  return draft.replacingIds.length > 0;
}

/** Drop the rows this edit replaces. Best-effort: a gone row is not an error. */
async function dropReplacedRows() {
  const ids = draft.replacingIds;
  draft.replacingIds = [];
  for (const id of ids) {
    try {
      await api(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch { /* already sent or cancelled */ }
  }
}

function forgetKeptFile() {
  if (draft.keepFileUrl) URL.revokeObjectURL(draft.keepFileUrl);
  draft.keepFilePath = '';
  draft.keepFileName = '';
  draft.keepFileUrl = '';
}

function clearDraft() {
  draft.message = '';
  draft.targets = [];
  draft.replacingIds = [];
  forgetKeptFile();
  setFileSilently(null);
  persistDraft();
}

/**
 * Reopen a queued message for editing.
 *
 * Rebuilds the audience from the row's own target, keeps the flyer already on
 * the server, and remembers which rows this edit replaces so saving swaps them
 * rather than adding a second copy.
 */
export function loadScheduleIntoCompose(entry, siblingIds) {
  const { sets, groups } = getState();
  draft.later = true;
  draft.message = entry.message || '';
  const when = new Date(entry.runAt);
  draft.runAt = Number.isNaN(when.getTime()) ? defaultRunAt() : toLocalInput(when);
  draft.replacingIds = (siblingIds && siblingIds.length ? siblingIds : [entry.id]).map(String);
  forgetKeptFile();
  draft.keepFilePath = entry.filePath || '';
  draft.keepFileName = entry.filePath ? String(entry.filePath).split(/[\\/]/).pop() : '';
  setFileSilently(null);

  // Pull the queued flyer in so the WhatsApp preview shows what will go out.
  if (draft.keepFilePath) {
    const wanted = draft.keepFilePath;
    fetchMedia(wanted)
      .then(({ blob }) => {
        if (draft.keepFilePath !== wanted) return;
        draft.keepFileUrl = URL.createObjectURL(blob);
        sync();
      })
      .catch(() => { /* the name in the field is enough on its own */ });
  }

  // One row carries one target; sets stay whole, a jid resolves to its group.
  const name = String(entry.target || '');
  if (entry.isSet) {
    const members = sets[name.toLowerCase()] || sets[name] || [];
    draft.targets = [{ type: 'set', label: name, value: name, sub: `${members.length} groups` }];
  } else {
    const g = (groups || []).find(
      (x) => x.jid === name || String(x.name || '').toLowerCase() === name.toLowerCase(),
    );
    draft.targets = [{
      type: g?.announcement ? 'announcement' : 'group',
      label: g?.name || name,
      value: g?.jid || name,
      sub: g ? `${g.participants ?? '?'} members` : '',
    }];
  }
}

function panel() {
  return document.getElementById('sandeshaSend');
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** datetime-local wants a local-time string, not an ISO/UTC one. */
function toLocalInput(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function defaultRunAt() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInput(d);
}

function quickRunAt(kind) {
  const d = new Date();
  if (kind === 'hour') {
    d.setHours(d.getHours() + 1);
    d.setSeconds(0, 0);
  } else if (kind === 'evening') {
    if (d.getHours() >= 19) d.setDate(d.getDate() + 1);
    d.setHours(19, 0, 0, 0);
  } else {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  }
  return toLocalInput(d);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Minute precision: the current minute is still allowed; earlier ones are not. */
function isPastWhen(value) {
  if (!value) return false;
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return false;
  return when.getTime() < Math.floor(Date.now() / 60000) * 60000;
}

function untilText(value) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  if (!value) return zone;
  if (isPastWhen(value)) return 'That time has already passed';
  const diff = new Date(value) - Date.now();
  if (Number.isNaN(diff)) return zone;
  if (diff <= 0) return `${zone} · this minute`;
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${zone} · in ${plural(mins, 'minute')}`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${zone} · in ${plural(hours, 'hour')}`;
  return `${zone} · in ${plural(Math.round(hours / 24), 'day')}`;
}

/** WhatsApp's own markers, rendered the way the recipient will see them. */
function bubbleHtml(raw) {
  return escapeHtml(raw)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

export { scheduleTargets };

/** Sets expand to their groups, because /send takes one recipient at a time. */
function sendRecipients(selections) {
  const { sets } = getState();
  const out = [];
  const seen = new Set();
  for (const t of selections) {
    if (t.type === 'set') {
      const members = sets[String(t.value).toLowerCase()] || [];
      for (const g of members) {
        if (seen.has(g)) continue;
        seen.add(g);
        out.push({ value: g, label: `${t.label} → ${g}` });
      }
      continue;
    }
    if (seen.has(t.value)) continue;
    seen.add(t.value);
    out.push({ value: t.value, label: t.label || t.value });
  }
  return out;
}

function reach() {
  return audienceTotal(draft.targets);
}

export function renderPromoCompose() {
  const host = panel();
  if (!host) return;
  loadChats(); // people for the audience list; not awaited
  ensureGroups().catch(() => {});
  ensureSets().catch(() => {});
  if (!draft.runAt) draft.runAt = defaultRunAt();
  if (restoredNotice) {
    toast(restoredNotice, 'ok');
    restoredNotice = '';
  }

  host.innerHTML = `
    <div class="wa-link-note" data-wa-link hidden>
      <p data-wa-link-text>Sandesha isn’t connected. Link WhatsApp in Settings before a send or a schedule can go out.</p>
      <button type="button" data-wa-link-settings>Open Settings</button>
    </div>
    ${isEditing() ? `
    <div class="pc-editing" role="status">
      <div>
        <b>Editing a queued message</b>
        <span>Saving replaces ${draft.replacingIds.length === 1
          ? 'the queued send'
          : `all ${draft.replacingIds.length} queued sends`}.</span>
      </div>
      <button type="button" class="linkbtn" id="pcCancelEdit">Discard</button>
    </div>` : ''}

    <div class="toggle" id="pcMode">
      <button type="button" data-later="0" aria-pressed="${!draft.later}">Send now</button>
      <button type="button" data-later="1" aria-pressed="${draft.later}">Schedule</button>
    </div>

    <div class="field" id="pcWhenField" ${draft.later ? '' : 'hidden'}>
      <span class="eyebrow">Deliver at</span>
      <label class="picker as-input">
        <div class="body">
          <input type="datetime-local" class="inp" id="pcWhen" step="60" min="${toLocalInput(new Date())}" value="${escapeHtml(draft.runAt)}" aria-label="Delivery time"/>
          <div class="sub" id="pcWhenSub"></div>
        </div>
      </label>
      <div class="quick">
        <button type="button" data-quick="hour">In 1 hour</button>
        <button type="button" data-quick="evening">This evening, 7pm</button>
        <button type="button" data-quick="morning">Tomorrow, 8am</button>
      </div>
    </div>

    <div class="field">
      <span class="eyebrow">Audience</span>
      <button type="button" class="picker" id="pcAud">
        <div class="body">
          <div class="headline" id="pcAudName"></div>
          <div class="sub" id="pcAudSub"></div>
        </div>
        <div class="n"><span id="pcAudCount">0</span><small>Reach</small></div>
        ${CHEVRON}
      </button>
    </div>

    <div class="field">
      <span class="eyebrow">Message</span>
      <div class="editor">
        <textarea id="pcMsg" rows="4" placeholder="Write what you want them to read…">${escapeHtml(draft.message)}</textarea>
        <div class="tools">
          <button type="button" data-wrap="*" title="Bold"><b>B</b></button>
          <button type="button" data-wrap="_" title="Italic"><i>I</i></button>
          <button type="button" data-wrap="~" title="Strikethrough"><s>S</s></button>
          <span class="count" id="pcCount"></span>
        </div>
      </div>
    </div>

    <div class="field" id="pcFileField">
      <span class="eyebrow">Attachment</span>
      <input type="file" id="pcFile" accept="image/*,video/*" class="compose-file"/>
      <label class="drop ${draft.file ? 'has' : ''}" for="pcFile" id="pcDrop">
        <span class="thumb" id="pcThumb">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        </span>
        <span class="body">
          <span class="t" id="pcFileName">Add a photo or video</span>
          <span class="s">Sent above the text</span>
        </span>
      </label>
      <div class="field-foot" ${draft.file || draft.keepFilePath ? '' : 'hidden'} id="pcFileFoot">
        <span></span>
        <button type="button" class="linkbtn" id="pcFileClear">Remove</button>
      </div>
    </div>

    <div class="field">
      <span class="eyebrow">Preview</span>
      <div class="wa-preview">
        <div class="wa-bar">
          <span>Isha Place, Vijayanagar</span>
          <span class="as">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span id="pcPreviewWho">How it lands</span>
          </span>
        </div>
        <div class="wa-canvas">
          <div class="wa-bubble" id="pcBubble"></div>
        </div>
        <div class="wa-note">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>
          <span>WhatsApp reads <span class="mono">*bold*</span>, <span class="mono">_italic_</span> and <span class="mono">~strike~</span>.</span>
        </div>
      </div>
    </div>

    <div class="prog" id="pcProg" hidden>
      <div class="prog-track"><div class="prog-fill" id="pcProgFill"></div></div>
      <div class="prog-txt" id="pcProgTxt"></div>
    </div>

    <div class="sendbar">
      <button type="button" class="b pri" id="pcGo"><span class="lbl" id="pcGoLbl">Send</span></button>
      <div class="fine" id="pcFine"></div>
    </div>`;

  const note = host.querySelector('[data-wa-link]');
  if (note) {
    const { health, healthError } = getState();
    const known = health != null || healthError;
    note.hidden = !(known && !health?.whatsapp?.connected);
  }

  bind(host);
  sync();
}

/** Grow to fit, so nothing you typed is hidden behind a clipped line. */
function fitTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(104, el.scrollHeight)}px`;
}

function bind(host) {
  const msg = host.querySelector('#pcMsg');

  host.querySelectorAll('#pcMode button').forEach((btn) => {
    btn.addEventListener('click', () => {
      draft.later = btn.dataset.later === '1';
      host.querySelectorAll('#pcMode button').forEach((b) => {
        b.setAttribute('aria-pressed', String((b.dataset.later === '1') === draft.later));
      });
      host.querySelector('#pcWhenField').hidden = !draft.later;
      sync();
    });
  });

  host.querySelector('#pcWhen')?.addEventListener('input', (ev) => {
    draft.runAt = ev.target.value;
    sync();
  });
  host.querySelector('#pcWhen')?.addEventListener('focus', (ev) => {
    ev.target.min = toLocalInput(new Date());
  });

  host.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      draft.runAt = quickRunAt(btn.dataset.quick);
      const input = host.querySelector('#pcWhen');
      if (input) input.value = draft.runAt;
      sync();
    });
  });

  host.querySelector('#pcAud')?.addEventListener('click', () => {
    if (!getState().groupsLoaded) toast('Groups are still loading — they will appear in the list in a moment', 'ok');
    openAudienceSheet(getTargetOptions(), draft.targets, (picked) => {
      draft.targets = picked;
      sync();
    });
  });

  msg?.addEventListener('input', () => {
    draft.message = msg.value;
    fitTextarea(msg);
    sync();
  });
  fitTextarea(msg);

  host.querySelectorAll('[data-wrap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mark = btn.dataset.wrap;
      const start = msg.selectionStart;
      const end = msg.selectionEnd;
      const value = msg.value;
      msg.value = value.slice(0, start) + mark + value.slice(start, end) + mark + value.slice(end);
      draft.message = msg.value;
      msg.focus();
      msg.selectionStart = start + 1;
      msg.selectionEnd = end + 1;
      fitTextarea(msg);
      sync();
    });
  });

  host.querySelector('#pcFile')?.addEventListener('change', (ev) => {
    setFile(ev.target.files?.[0] || null);
  });

  host.querySelector('#pcFileClear')?.addEventListener('click', () => {
    const input = host.querySelector('#pcFile');
    if (input) input.value = '';
    // Also forget a flyer that only lives on the server, or a save would
    // silently re-attach the one the editor just removed.
    forgetKeptFile();
    setFile(null);
  });

  host.querySelector('#pcCancelEdit')?.addEventListener('click', () => {
    clearDraft();
    renderPromoCompose();
    window.dispatchEvent(new CustomEvent('promo:goto', { detail: { mode: 'schedule' } }));
  });

  host.querySelector('#pcGo')?.addEventListener('click', submit);
}

function setFile(file) {
  if (draft.fileUrl) URL.revokeObjectURL(draft.fileUrl);
  draft.file = file;
  draft.fileUrl = file && file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
  sync();
}

function sync() {
  const host = panel();
  if (!host) return;
  const $ = (id) => host.querySelector(id);

  const total = reach();
  const lists = draft.targets.length;
  $('#pcAudName').textContent = audienceSummary(draft.targets);
  $('#pcAudName').closest('.picker').classList.toggle('is-empty', !lists);
  $('#pcAudSub').textContent = lists
    ? `${lists} ${lists === 1 ? 'list' : 'lists'} selected`
    : 'Pick at least one list';
  $('#pcAudCount').textContent = total;

  const len = draft.message.length;
  const count = $('#pcCount');
  count.textContent = `${len} / ${MAX_CHARS}`;
  count.classList.toggle('warn', len > WARN_CHARS);

  const whenInput = $('#pcWhen');
  if (whenInput) whenInput.min = toLocalInput(new Date());
  const whenSub = $('#pcWhenSub');
  if (whenSub) {
    whenSub.textContent = untilText(draft.runAt);
    whenSub.classList.toggle('is-past', draft.later && isPastWhen(draft.runAt));
  }

  const drop = $('#pcDrop');
  const thumb = $('#pcThumb');
  const hasAttachment = !!draft.file || !!draft.keepFilePath;
  drop.classList.toggle('has', hasAttachment);
  $('#pcFileFoot').hidden = !hasAttachment;
  $('#pcFileName').textContent = draft.file
    ? draft.file.name
    : draft.keepFilePath
      ? `${draft.keepFileName} · already uploaded`
      : 'Add a photo or video';
  if (draft.fileUrl) {
    thumb.innerHTML = `<img src="${escapeHtml(draft.fileUrl)}" alt=""/>`;
  } else if (draft.file) {
    thumb.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>';
  } else {
    thumb.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
  }

  const stamp = draft.later && draft.runAt
    ? new Date(draft.runAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const body = draft.message.trim()
    ? bubbleHtml(draft.message)
    : '<span class="ph">Your message appears here</span>';
  const previewUrl = draft.fileUrl || draft.keepFileUrl || '';
  const tickIcon = draft.later ? TICK_CLOCK : (sending && !delivered ? TICK_PENDING : TICK_SENT);
  const tickClass = delivered ? ' is-sent' : '';
  $('#pcBubble').innerHTML =
    (previewUrl ? `<img src="${escapeHtml(previewUrl)}" alt=""/>` : '')
    + body
    + `<span class="wa-tick${tickClass}">${escapeHtml(stamp)}${tickIcon}</span>`;
  $('#pcPreviewWho').textContent = delivered
    ? 'Sent'
    : draft.later
      ? 'Scheduled'
      : 'How it lands';

  const ready = (draft.message.trim() || hasAttachment) && lists > 0;
  const go = $('#pcGo');
  go.disabled = !ready || sending;
  $('#pcGoLbl').textContent = !lists
    ? 'Choose an audience'
    : draft.later
      ? (isEditing()
        ? `Save for ${total} ${total === 1 ? 'person' : 'people'}`
        : `Schedule for ${total} ${total === 1 ? 'person' : 'people'}`)
      : `Send to ${total} ${total === 1 ? 'person' : 'people'}`;

  const fine = $('#pcFine');
  if (!lists) {
    fine.textContent = 'Nothing goes out yet.';
  } else if (draft.later) {
    const rows = scheduleTargets(draft.targets).length;
    fine.textContent = `${rows} scheduled ${rows === 1 ? 'row' : 'rows'} · the server sends them for you`;
  } else {
    const n = sendRecipients(draft.targets).length;
    if (n === 1) {
      fine.textContent = 'One list · goes out right away';
    } else {
      const avg = (GAP_MIN_MS + GAP_MAX_MS) / 2;
      const mins = Math.max(1, Math.round(((n - 1) * avg) / 60000));
      fine.textContent = `Spread out, ${GAP_MIN_MS / 1000}–${GAP_MAX_MS / 1000}s apart · about ${mins} ${mins === 1 ? 'minute' : 'minutes'}. Keep this open.`;
    }
  }
}

function busy(on, label) {
  sending = on;
  const host = panel();
  const go = host?.querySelector('#pcGo');
  if (!go) return;
  go.classList.toggle('busy', on);
  go.disabled = on;
  if (label) host.querySelector('#pcGoLbl').textContent = label;
}

async function submit() {
  if (sending) return;
  const text = draft.message.trim();
  if (!draft.targets.length) {
    toast('Choose at least one audience', 'err');
    return;
  }
  if (!text && !draft.file && !draft.keepFilePath) {
    toast('Write a message or attach something', 'err');
    return;
  }
  if (draft.later) await saveSchedule(text);
  else await sendNow(text);
}

/**
 * Hand the schedule to Sandesha whole (see promo-jobs.js "queue" jobs). Only the
 * attachment upload happens from this phone; creating a row per list and
 * dropping the rows it replaces carries on at the server if the phone sleeps
 * or the tab closes. The outcome is picked up by watchQueueJobs().
 */
async function saveSchedule(text) {
  if (!draft.runAt) {
    toast('Pick a delivery time', 'err');
    return;
  }
  if (isPastWhen(draft.runAt)) {
    toast('Pick a time that has not already passed', 'err');
    return;
  }
  const rows = scheduleTargets(draft.targets);
  if (!rows.length) {
    toast('No valid audience', 'err');
    return;
  }

  const editing = isEditing();
  busy(true, editing ? 'Saving…' : 'Scheduling…');
  toast(editing ? 'Saving your changes…' : 'Scheduling…', 'info', 3000);
  const runAt = new Date(draft.runAt).toISOString();
  let filePath = draft.keepFilePath;
  try {
    if (draft.file) {
      busy(true, 'Uploading attachment…');
      const up = await uploadFile(draft.file);
      filePath = up.filePath;
    }
    const title = (text || draft.keepFileName || (draft.file && draft.file.name) || 'Message').trim().slice(0, 60);
    let started;
    try {
      started = await api('/promo-jobs', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'queue',
          title,
          message: text,
          runAt,
          rows: rows.map((r) => ({ target: r.target, isSet: !!r.isSet })),
          filePath,
          previousIds: draft.replacingIds,
        }),
      });
    } catch (err) {
      // A Sandesha that predates queue jobs reads this as a Board post.
      if (/promoId required|sheet\.url|sheet\.token/i.test(err.message || '')) {
        return saveScheduleHere(text, filePath);
      }
      throw err;
    }
    rememberQueueJob(started.job.id, title, {
      message: text,
      targets: draft.targets,
      runAt: draft.runAt,
      replacingIds: draft.replacingIds,
      keepFilePath: filePath || '',
      keepFileName: draft.file ? draft.file.name : draft.keepFileName,
    });
    toast(editing ? 'Saved — finishing on the server' : 'Scheduled — finishing on the server', 'ok');
    clearDraft();
    sending = false;
    renderPromoCompose();
    window.dispatchEvent(new CustomEvent('promo:goto', { detail: { mode: 'schedule' } }));
    watchQueueJobs(1000);
  } catch (err) {
    toast(err.message || 'Could not schedule', 'err');
    sending = false;
    sync();
  }
}

/* ───────── queue jobs handed to the server ─────────
   Kept in localStorage so a reload, or a tab Android discarded, still learns how
   the job ended. If it failed, the message comes back in Compose so nothing
   typed is lost. */
const QUEUE_JOBS_KEY = 'vjn_queue_jobs';
const QUEUE_JOB_MAX_AGE_MS = 15 * 60 * 1000;
let queuePollTimer = 0;

function readQueueJobs() {
  try {
    const list = JSON.parse(localStorage.getItem(QUEUE_JOBS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueueJobs(list) {
  try { localStorage.setItem(QUEUE_JOBS_KEY, JSON.stringify(list)); } catch { /* storage off */ }
}

function rememberQueueJob(id, title, snapshot, kind = 'queue') {
  const list = readQueueJobs().filter((j) => j.id !== id);
  list.push({ id, kind, title, snapshot, at: Date.now() });
  writeQueueJobs(list);
}

/** Remove a job from the list and return it — once, so two watchers cannot both report it. */
function takeQueueJob(id) {
  const list = readQueueJobs();
  const entry = list.find((j) => j.id === id);
  if (!entry) return null;
  writeQueueJobs(list.filter((j) => j.id !== id));
  return entry;
}

// A send this page is following live; the background check leaves those alone.
const followingIds = new Set();

/** Titles of schedules still being created on the server, for the Schedule tab. */
export function pendingQueueTitles() {
  return readQueueJobs().filter((j) => j.kind !== 'send').map((j) => j.title || 'Message');
}

function restoreDraftFrom(snapshot) {
  if (!snapshot) return;
  handedOver = false;
  draft.message = String(snapshot.message || '');
  draft.targets = Array.isArray(snapshot.targets) ? snapshot.targets : [];
  draft.later = snapshot.later === undefined ? true : !!snapshot.later;
  draft.runAt = String(snapshot.runAt || '');
  draft.replacingIds = Array.isArray(snapshot.replacingIds) ? snapshot.replacingIds.map(String) : [];
  draft.keepFilePath = String(snapshot.keepFilePath || '');
  draft.keepFileName = String(snapshot.keepFileName || '');
  persistDraft();
  if (panel()?.isConnected && panel().closest('.is-active')) renderPromoCompose();
}

async function pollQueueJobs() {
  queuePollTimer = 0;
  const pending = readQueueJobs().filter((j) => !followingIds.has(j.id));
  if (!pending.length) return;
  let jobs;
  try {
    jobs = (await api('/promo-jobs')).jobs || [];
  } catch {
    watchQueueJobs(8000);
    return;
  }
  let finished = false;
  let waiting = false;
  for (const entry of pending) {
    const job = jobs.find((j) => j.id === entry.id);
    if (!job) {
      // The server forgot it (restart + 48h) or it never landed: stop waiting.
      if (Date.now() - entry.at >= QUEUE_JOB_MAX_AGE_MS) takeQueueJob(entry.id);
      else waiting = true;
      continue;
    }
    if (job.status === 'running') {
      waiting = true;
      continue;
    }
    if (!takeQueueJob(entry.id)) continue;
    finished = true;
    settleJob(entry, job, false);
  }
  if (finished) window.dispatchEvent(new CustomEvent('sandesha:refresh'));
  if (waiting) watchQueueJobs(2500);
}

/** Report how a handed-over job ended (the entry is already taken off the list). */
function settleJob(entry, job, live) {
  api(`/promo-jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' }).catch(() => {});
  const title = entry.title || 'your message';
  if (entry.kind === 'send') {
    if (job.status === 'done') {
      if (job.failed) toast(`Sent ${job.sent}, failed ${job.failed}`, 'err', 8000);
      else toast(job.sent === 1 ? 'Message sent' : `Sent to ${job.sent} audiences`, 'ok');
    } else {
      toast(`Could not send “${title}”: ${job.error || 'something went wrong'}. Your message is back in Compose.`, 'err', 12000);
      restoreDraftFrom(entry.snapshot);
    }
    return;
  }
  if (job.status === 'done') {
    const n = (job.ids || []).length;
    toast(`${entry.title || 'Message'} scheduled${n > 1 ? ` for ${n} lists` : ''}`, 'ok');
  } else {
    toast(`Could not schedule “${title}”: ${job.error || 'something went wrong'}. Your message is back in Compose.`, 'err', 12000);
    restoreDraftFrom(entry.snapshot);
  }
}

/** Start (or continue) checking on handed-over schedules. Safe to call any time. */
export function watchQueueJobs(delayMs = 0) {
  if (!readQueueJobs().length) return;
  clearTimeout(queuePollTimer);
  queuePollTimer = setTimeout(pollQueueJobs, delayMs);
}

async function saveScheduleHere(text, preUploadedPath = '') {
  if (!draft.runAt) {
    toast('Pick a delivery time', 'err');
    return;
  }
  if (isPastWhen(draft.runAt)) {
    toast('Pick a time that has not already passed', 'err');
    return;
  }
  const rows = scheduleTargets(draft.targets);
  if (!rows.length) {
    toast('No valid audience', 'err');
    return;
  }

  const editing = isEditing();
  busy(true, editing ? 'Saving…' : 'Scheduling…');
  toast(editing ? 'Saving your changes…' : 'Scheduling — this takes a moment', 'info', 4000);
  const runAt = new Date(draft.runAt).toISOString();
  let done = 0;
  try {
    // Uploaded once; every row points at the same file and the server clears
    // it after the last one has gone out. An untouched attachment keeps the
    // path it already has rather than being uploaded a second time.
    let filePath = preUploadedPath || draft.keepFilePath;
    if (draft.file && !preUploadedPath) {
      busy(true, 'Uploading attachment…');
      const up = await uploadFile(draft.file);
      filePath = up.filePath;
    }
    for (const row of rows) {
      await api('/schedules', {
        method: 'POST',
        body: JSON.stringify({
          message: text, runAt, target: row.target, isSet: row.isSet, filePath,
        }),
      });
      done += 1;
      busy(true, `${editing ? 'Saving' : 'Scheduling'} ${done}/${rows.length}…`);
    }
    // Only once the replacements exist, so a failure above cannot leave the
    // message unqueued entirely.
    await dropReplacedRows();
    toast(editing ? 'Schedule updated' : (done === 1 ? 'Scheduled' : `${done} schedules saved`), 'ok');
    clearDraft();
    sending = false;
    renderPromoCompose();
    window.dispatchEvent(new CustomEvent('sandesha:refresh'));
    window.dispatchEvent(new CustomEvent('promo:goto', { detail: { mode: 'schedule' } }));
  } catch (err) {
    toast(err.message || 'Could not schedule', 'err');
    sending = false;
    sync();
  }
}

/**
 * Send now: hand the whole fan-out to Sandesha (see promo-jobs.js "send" jobs).
 * Only the attachment upload happens from this phone. The server delivers to each
 * audience with the safety gap between chats and keeps going if the phone sleeps
 * or the tab closes; while this screen stays open it shows the progress.
 */
async function sendNow(text) {
  const recipients = shuffled(sendRecipients(draft.targets));
  if (!recipients.length) {
    toast('No valid audience', 'err');
    return;
  }

  const host = panel();
  const prog = host.querySelector('#pcProg');
  const fill = host.querySelector('#pcProgFill');
  const label = host.querySelector('#pcProgTxt');

  busy(true, 'Sending…');
  toast(recipients.length === 1 ? 'Sending…' : `Sending to ${recipients.length} audiences — progress below`, 'info', 4000);
  sync();
  if (recipients.length > 1) prog.hidden = false;

  try {
    let filePath = draft.keepFilePath || null;
    if (draft.file) {
      label.textContent = 'Uploading attachment…';
      prog.hidden = false;
      const up = await uploadFile(draft.file);
      filePath = up.filePath;
    }
    const title = (text || draft.keepFileName || (draft.file && draft.file.name) || 'Message').trim().slice(0, 60);
    let started;
    try {
      started = await api('/promo-jobs', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'send',
          title,
          message: text,
          filePath: filePath || '',
          recipients: recipients.map((r) => ({ target: r.value })),
          previousIds: draft.replacingIds,
        }),
      });
    } catch (err) {
      // A Sandesha that predates send jobs reads this as a Board post.
      if (/promoId required|sheet\.url|sheet\.token/i.test(err.message || '')) {
        return await sendNowHere(text, filePath || '');
      }
      throw err;
    }
    const id = started.job.id;
    rememberQueueJob(id, title, {
      message: text,
      targets: draft.targets,
      later: false,
      runAt: draft.runAt,
      replacingIds: draft.replacingIds,
      keepFilePath: filePath || '',
      keepFileName: draft.file ? draft.file.name : draft.keepFileName,
    }, 'send');
    handedOver = true;
    try { sessionStorage.removeItem(SAVED_DRAFT_KEY); } catch { /* storage off */ }
    toast('With Sandesha now — it carries on even if you leave', 'info', 4000);
    await followSendJob(id, recipients.length);
  } catch (err) {
    toast(err.message || 'Send failed', 'err');
  } finally {
    sending = false;
    delivered = false;
    handedOver = false;
    const p = panel();
    const pg = p?.querySelector('#pcProg');
    if (pg) pg.hidden = true;
    const fl = p?.querySelector('#pcProgFill');
    if (fl) fl.style.width = '0%';
    renderPromoCompose();
  }
}

/** Show a running send's progress; report how it ended. */
async function followSendJob(id, total) {
  followingIds.add(id);
  const started = Date.now();
  let misses = 0;
  try {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (Date.now() - started > 20 * 60 * 1000) return; // the background check takes over
      let job;
      try {
        job = ((await api('/promo-jobs')).jobs || []).find((j) => j.id === id);
      } catch {
        continue; // a dropped connection must not end the follow
      }
      if (!job) {
        if (++misses > 5 || !readQueueJobs().some((j) => j.id === id)) return;
        continue;
      }
      const done = (job.sent || 0) + (job.failed || 0);
      const p = panel();
      if (job.status === 'running') {
        const fl = p?.querySelector('#pcProgFill');
        const lb = p?.querySelector('#pcProgTxt');
        if (fl) fl.style.width = `${Math.round((done / total) * 100)}%`;
        if (lb) lb.textContent = `Sending ${Math.min(done + 1, total)} of ${total}…`;
        continue;
      }
      const entry = takeQueueJob(id);
      if (!entry) return;
      settleJob(entry, job, true);
      if (job.status === 'done') {
        delivered = true;
        sync();
        await new Promise((resolve) => setTimeout(resolve, 900));
        handedOver = false;
        draft.replacingIds = [];
        draft.message = '';
        forgetKeptFile();
        setFileSilently(null);
        persistDraft();
        window.dispatchEvent(new CustomEvent('promo:board-show'));
        window.dispatchEvent(new CustomEvent('sandesha:refresh'));
      }
      return;
    }
  } finally {
    followingIds.delete(id);
  }
}

async function sendNowHere(text, preUploadedPath = '') {
  const recipients = shuffled(sendRecipients(draft.targets));
  if (!recipients.length) {
    toast('No valid audience', 'err');
    return;
  }

  const host = panel();
  const prog = host.querySelector('#pcProg');
  const fill = host.querySelector('#pcProgFill');
  const label = host.querySelector('#pcProgTxt');

  busy(true, 'Sending…');
  toast(recipients.length === 1 ? 'Sending…' : `Sending to ${recipients.length} audiences — progress below`, 'info', 4000);
  sync();
  if (recipients.length > 1) prog.hidden = false;

  try {
    let filePath = preUploadedPath || null;
    if (draft.file && !preUploadedPath) {
      label.textContent = 'Uploading attachment…';
      prog.hidden = false;
      const up = await uploadFile(draft.file);
      filePath = up.filePath;
    }

    let ok = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i++) {
      const to = recipients[i];
      fill.style.width = `${Math.round(((i + 1) / recipients.length) * 100)}%`;
      label.textContent = `Sending ${i + 1} of ${recipients.length}…`;
      try {
        if (filePath) {
          await api('/send-media', {
            method: 'POST',
            body: JSON.stringify({ recipient: to.value, filePath, caption: text || '' }),
          });
        } else {
          await api('/send', {
            method: 'POST',
            body: JSON.stringify({ recipient: to.value, message: text }),
          });
        }
        ok += 1;
      } catch (err) {
        failed += 1;
        console.warn('Send failed for', to.value, err);
      }
      if (i < recipients.length - 1) await sendGap();
    }

    if (failed) toast(`Sent ${ok}, failed ${failed}`, 'err');
    else toast(ok === 1 ? 'Message sent' : `Sent to ${ok} audiences`, 'ok');

    if (ok) {
      delivered = true;
      sync();
      // Sending it now supersedes whatever was queued, so those rows go.
      if (isEditing()) await dropReplacedRows();
      await new Promise((resolve) => setTimeout(resolve, 900));
      draft.message = '';
      forgetKeptFile();
      setFileSilently(null);
      persistDraft();
      window.dispatchEvent(new CustomEvent('promo:board-show'));
    }
  } catch (err) {
    toast(err.message || 'Send failed', 'err');
  } finally {
    sending = false;
    delivered = false;
    prog.hidden = true;
    fill.style.width = '0%';
    renderPromoCompose();
  }
}

function setFileSilently(file) {
  if (draft.fileUrl) URL.revokeObjectURL(draft.fileUrl);
  draft.file = file;
  draft.fileUrl = '';
}

/** Preselect the toggle before the panel mounts, so no double render. */
export function setComposeMode(later) {
  draft.later = !!later;
}

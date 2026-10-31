/**
 * Settings → Sandesha activities on the promotions page.
 * The server returns only this team's rows.
 */
import { api, escapeHtml } from './api.js';
import { ensureSandeshaAuth } from './auth-bridge.js';

const STATUS = {
  ok: { label: 'Success', cls: 'ok' },
  info: { label: 'Done', cls: 'ok' },
  warn: { label: 'Partly failed', cls: 'warn' },
  err: { label: 'Failed', cls: 'err' },
};

const CATEGORY = {
  send: 'Send',
  schedule: 'Schedule',
  members: 'Members',
  group: 'Group',
  set: 'Set',
  contact: 'Contact',
  system: 'System',
  auth: 'Sign-in',
};

const VIA = {
  manual: 'Sent by hand',
  scheduled: 'Scheduler',
  broadcast: 'Broadcast',
  bulk: 'Bulk send',
  api: 'From the app',
  'planning-group': 'From planning group',
};

let rows = [];
let filter = 'all';
let openKey = '';
let bound = false;

function $(id) {
  return document.getElementById(id);
}

function who(row) {
  const name = row.actor && row.actor.name ? String(row.actor.name).trim() : '';
  const role = row.actor && row.actor.role ? String(row.actor.role).trim() : '';
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : '';
  if (name && roleLabel) return `${name}, ${roleLabel}`;
  if (name) return name;
  return row.via === 'scheduled' ? 'Scheduler' : 'Sandesha';
}

function dayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yst = new Date();
  yst.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yst.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function timeLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function whenFull(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function shortName(value) {
  const s = String(value || '').trim();
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}

function targetLabel(row) {
  const m = row.meta || {};
  const name = m.group || m.set || m.target || row.target || '';
  if (!name) return '';
  const text = shortName(name);
  return (m.isSet || m.set) && !String(text).includes('·') ? `${text} · set` : text;
}

function messageText(row) {
  const m = row.meta || {};
  return String(m.message || m.caption || '').trim();
}

function outcomeLine(row) {
  const m = row.meta || {};
  const bits = [];
  if (m.sent != null && m.total != null) bits.push(`${m.sent} of ${m.total} sent`);
  else if (m.added != null && !Array.isArray(m.added)) bits.push(`${m.added} added`);
  else if (row.count != null && (row.category === 'send' || row.category === 'schedule')) bits.push(`${row.count} sent`);
  if (m.failed) bits.push(`${m.failed} failed`);
  if (m.invited) bits.push(`${m.invited} invited`);
  if (Array.isArray(m.failures) && m.failures.length && m.sent == null) bits.push(`${m.failures.length} failed`);
  if (m.file) bits.push(String(m.file));
  if (m.runAt) bits.push(`For ${whenFull(m.runAt)}`);
  return bits.filter(Boolean).join(' · ');
}

function fact(label, value) {
  const text = value == null ? '' : String(value).trim();
  if (!text) return '';
  return `<div class="pa-fact"><span>${escapeHtml(label)}</span><b>${escapeHtml(text)}</b></div>`;
}

function nameList(label, items) {
  const names = items.map((item) => shortName(item)).filter(Boolean);
  if (!names.length) return '';
  const shown = names.slice(0, 20);
  const more = names.length - shown.length;
  const lis = shown.map((name) => `<li>${escapeHtml(name)}</li>`).join('');
  const tail = more ? `<li>and ${more} more</li>` : '';
  return `<p class="pa-kicker">${escapeHtml(label)}</p><ul class="pa-list">${lis}${tail}</ul>`;
}

function failList(failures) {
  const rows = failures.map((item) => {
    if (item && typeof item === 'object') {
      const who = shortName(item.target || item.number || item.name || '');
      const why = item.error || item.reason || '';
      return [who, why].filter(Boolean).join(' — ');
    }
    return String(item || '');
  }).filter(Boolean);
  return nameList('Failed', rows);
}

function matches(row) {
  if (filter === 'ok') return row.type !== 'err' && row.type !== 'warn';
  if (filter === 'fail') return row.type === 'err' || row.type === 'warn';
  return true;
}

function detailHtml(row) {
  const m = row.meta || {};
  const message = messageText(row);
  const caption = m.caption && String(m.caption).trim() !== message ? String(m.caption).trim() : '';
  const reason = m.error || m.reason || m.stopped || '';
  const bits = [];
  if (message) bits.push(`<p class="pa-kicker">Message</p><p class="pa-message">${escapeHtml(message)}</p>`);
  if (caption) bits.push(`<p class="pa-kicker">Caption</p><p class="pa-message">${escapeHtml(caption)}</p>`);
  const addedNames = Array.isArray(m.added) ? m.added.join(', ') : '';
  const removedNames = Array.isArray(m.removed) ? m.removed.join(', ') : '';
  const facts = [
    fact('To', targetLabel(row)),
    fact('Scheduled for', m.runAt ? whenFull(m.runAt) : ''),
    fact('Queued', m.createdAt ? whenFull(m.createdAt) : ''),
    fact('Flyer', m.file || ''),
    fact('Sent', m.sent != null && m.total != null ? `${m.sent} of ${m.total}` : ''),
    fact('Added', !Array.isArray(m.added) && m.added != null ? String(m.added) : ''),
    fact('Invited', m.invited ? String(m.invited) : ''),
    fact('Failed', m.failed ? String(m.failed) : ''),
    fact('Sets saved', addedNames),
    fact('Sets removed', removedNames),
    fact('Job', m.status || ''),
    fact('How', VIA[row.via] || ''),
    fact('By', who(row)),
    fact('Kind', CATEGORY[row.category] || ''),
  ].join('');
  if (facts) bits.push(`<div class="pa-facts">${facts}</div>`);
  if (reason) bits.push(`<p class="pa-kicker">What happened</p><p class="pa-reason">${escapeHtml(String(reason))}</p>`);
  if (row.detail && row.detail !== reason && row.detail !== message) {
    bits.push(`<p class="pa-kicker">Note</p><p class="pa-detail">${escapeHtml(row.detail)}</p>`);
  }
  if (Array.isArray(m.sentTo) && m.sentTo.length) bits.push(nameList('Reached', m.sentTo));
  if (Array.isArray(m.failures) && m.failures.length) bits.push(failList(m.failures));
  if (Array.isArray(m.errors) && m.errors.length) bits.push(nameList('Errors', m.errors));
  return bits.join('');
}

function render() {
  const list = $('promoActivityList');
  const meta = $('promoActivityMeta');
  if (!list) return;
  const shown = rows.filter(matches);
  if (meta) {
    meta.textContent = rows.length
      ? `${shown.length} ${shown.length === 1 ? 'activity' : 'activities'}`
      : '';
  }
  if (!shown.length) {
    list.innerHTML = `<p class="pa-empty">${rows.length ? 'Nothing in this view.' : 'No Sandesha activity yet.'}</p>`;
    return;
  }
  let lastDay = '';
  list.innerHTML = shown.map((row) => {
    const st = STATUS[row.type] || STATUS.ok;
    const day = dayLabel(row.at);
    const head = day !== lastDay ? `<div class="pa-day">${escapeHtml(day)}</div>` : '';
    lastDay = day;
    const target = targetLabel(row);
    const preview = messageText(row);
    const outcome = outcomeLine(row);
    const kind = CATEGORY[row.category] || '';
    const open = openKey === row._key;
    const when = [who(row), timeLabel(row.at), kind].filter(Boolean).join(' · ');
    return `${head}<article class="pa-card${open ? ' is-open' : ''}">
      <button type="button" class="pa-row${open ? ' is-open' : ''}" data-pa-key="${escapeHtml(row._key)}">
        <span class="pa-dot ${st.cls}" aria-hidden="true"></span>
        <span class="pa-main">
          <span class="pa-row-title">${escapeHtml(row.title || 'Activity')}</span>
          ${target ? `<span class="pa-target">${escapeHtml(target)}</span>` : ''}
          ${preview ? `<span class="pa-preview">${escapeHtml(preview)}</span>` : ''}
          ${outcome ? `<span class="pa-outcome">${escapeHtml(outcome)}</span>` : ''}
          <span class="pa-when">${escapeHtml(when)}</span>
          <span class="pa-more-hint">${open ? 'Hide details' : 'Details'}</span>
        </span>
        <span class="pa-status ${st.cls}">${escapeHtml(st.label)}</span>
      </button>
      ${open ? `<div class="pa-more">${detailHtml(row)}</div>` : ''}
    </article>`;
  }).join('');
}

async function load() {
  const list = $('promoActivityList');
  if (list) list.innerHTML = '<p class="pa-empty">Loading…</p>';
  try {
    await ensureSandeshaAuth();
    const data = await api('/activity?limit=200');
    const raw = Array.isArray(data?.activity) ? data.activity : [];
    rows = raw.map((row, i) => ({ ...row, _key: row.id || `${row.at}-${i}` }));
    render();
  } catch (err) {
    if (list) list.innerHTML = `<p class="pa-empty">${escapeHtml(err.message || 'Could not load activity.')}</p>`;
  }
}

function setOpen(on) {
  const root = $('sandeshaServer');
  const view = $('promoActivity');
  if (!root || !view) return;
  root.classList.toggle('is-activity', on);
  view.hidden = !on;
  if (on) load();
}

export function closePromoActivity() {
  openKey = '';
  setOpen(false);
}

export function bindPromoActivity() {
  if (bound) return;
  bound = true;
  $('promoActivityOpen')?.addEventListener('click', () => setOpen(true));
  $('promoActivityBack')?.addEventListener('click', () => closePromoActivity());
  document.querySelectorAll('[data-pa-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.getAttribute('data-pa-status') || 'all';
      document.querySelectorAll('[data-pa-status]').forEach((b) => b.classList.toggle('on', b === btn));
      render();
    });
  });
  $('promoActivityList')?.addEventListener('click', (e) => {
    const row = e.target.closest('.pa-row');
    if (!row) return;
    const key = row.getAttribute('data-pa-key');
    openKey = openKey === key ? '' : key;
    render();
  });
}

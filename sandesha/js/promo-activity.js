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

let rows = [];
let filter = 'all';
let openKey = '';
let bound = false;

function $(id) {
  return document.getElementById(id);
}

function who(row) {
  if (row.actor && row.actor.name) return row.actor.name;
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
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function matches(row) {
  if (filter === 'ok') return row.type !== 'err' && row.type !== 'warn';
  if (filter === 'fail') return row.type === 'err' || row.type === 'warn';
  return true;
}

function detailHtml(row) {
  const m = row.meta || {};
  const reason = m.error || m.reason || '';
  const message = m.message || m.caption || '';
  const bits = [];
  if (reason) bits.push(`<p class="pa-reason">${escapeHtml(reason)}</p>`);
  if (message) bits.push(`<p class="pa-message">${escapeHtml(message)}</p>`);
  if (row.detail && row.detail !== reason) bits.push(`<p class="pa-detail">${escapeHtml(row.detail)}</p>`);
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
    const target = (row.meta && (row.meta.group || row.meta.set)) || row.target || '';
    const open = openKey === row._key;
    return `${head}<button type="button" class="pa-row${open ? ' is-open' : ''}" data-pa-key="${escapeHtml(row._key)}">
      <span class="pa-dot ${st.cls}" aria-hidden="true"></span>
      <span class="pa-main">
        <span class="pa-row-title">${escapeHtml(row.title || 'Activity')}</span>
        ${target ? `<span class="pa-target">${escapeHtml(String(target))}</span>` : ''}
        <span class="pa-when">${escapeHtml(who(row))} · ${escapeHtml(timeLabel(row.at))}</span>
        ${open ? detailHtml(row) : ''}
      </span>
      <span class="pa-status ${st.cls}">${escapeHtml(st.label)}</span>
    </button>`;
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
    const row = e.target.closest('[data-pa-key]');
    if (!row) return;
    const key = row.getAttribute('data-pa-key');
    openKey = openKey === key ? '' : key;
    render();
  });
}

/**
 * Reach — how far each WhatsApp post travelled (admin-promotions.html).
 *
 * Reads /reach/* from the Sandesha server. Numbers are counts only: delivered
 * to, read by, replies and reactions. Read is a floor — people who turned off
 * read receipts are never counted as readers.
 */
import { api, getApiBase, getToken, escapeHtml } from '../api.js';
import { ensureSandeshaAuth } from '../auth-bridge.js';

const RANGE_KEY = 'promo_reach_range';
const RANGES = [7, 30, 90];
const VIA_LABEL = {
  scheduled: 'Scheduled',
  manual: 'Sent now',
  bulk: 'Bulk send',
  broadcast: 'Broadcast',
  bot: 'From WhatsApp',
  api: 'Sent',
};
/** Cumulative readers at these points since sending (hours). */
const READ_STEPS = [
  [1, 'Within 1 hour'],
  [6, 'Within 6 hours'],
  [24, 'Within 1 day'],
  [72, 'Within 3 days'],
  [168, 'Within 7 days'],
];

let host = null;
let range = loadRange();
let view = { name: 'list' };
let loadToken = 0;
const thumbCache = new Map();

function loadRange() {
  try {
    const n = Number(localStorage.getItem(RANGE_KEY));
    if (RANGES.includes(n)) return n;
  } catch { /* ignore */ }
  return 30;
}

function saveRange(n) {
  try { localStorage.setItem(RANGE_KEY, String(n)); } catch { /* ignore */ }
}

/* ---------- formatting ---------- */

const nf = new Intl.NumberFormat('en-IN');
const num = (n) => nf.format(Math.round(Number(n) || 0));

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

function pctText(part, whole) {
  const p = pct(part, whole);
  return p == null ? '' : `${p}%`;
}

function dayLabel(ms, withYear = false) {
  return new Date(ms).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'Asia/Kolkata',
  });
}

function timeLabel(ms) {
  return new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function shortDay(isoDay) {
  const d = new Date(`${isoDay}T12:00:00+05:30`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function untilText(ms) {
  const m = Math.max(1, Math.round((ms - Date.now()) / 60000));
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h} hr`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

/** WhatsApp's *bold*, _italic_ and ~strike~, on already-escaped text. */
function waFormat(escaped) {
  return escaped
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?:;)]|$)/g, '$1<strong>$2</strong>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,!?:;)]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s.,!?:;)]|$)/g, '$1<s>$2</s>');
}

function postTitle(p) {
  const line = String(p.text || '').split('\n').map((l) => l.trim()).find(Boolean);
  if (line) return line.replace(/[*_~]/g, '');
  return p.kind === 'media' ? 'Picture post' : 'Message';
}

/** "▲ 12% vs previous 30 days", or nothing when there is nothing to compare. */
function delta(cur, prev) {
  if (!prev) return '';
  const change = Math.round(((cur - prev) / prev) * 100);
  if (change === 0) return `<span class="rc-delta flat">Same as previous ${range} days</span>`;
  const up = change > 0;
  return `<span class="rc-delta ${up ? 'up' : 'down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${Math.abs(change)}% <span class="rc-delta-k">vs previous ${range} days</span></span>`;
}

/* ---------- thumbnails (bearer-protected, so fetched as blobs) ---------- */

async function thumbUrl(name) {
  if (!name) return '';
  if (thumbCache.has(name)) return thumbCache.get(name);
  const p = (async () => {
    const t = getToken();
    const res = await fetch(`${getApiBase()}/reach/media/${encodeURIComponent(name)}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!res.ok) throw new Error(String(res.status));
    return URL.createObjectURL(await res.blob());
  })().catch(() => '');
  thumbCache.set(name, p);
  return p;
}

function hydrateThumbs(root) {
  root.querySelectorAll('[data-thumb]').forEach(async (el) => {
    const url = await thumbUrl(el.dataset.thumb);
    if (url && el.isConnected) {
      el.style.backgroundImage = `url("${url}")`;
      el.classList.add('has-img');
    }
  });
}

/* ---------- pieces ---------- */

function skeleton() {
  return `<div class="rc" aria-busy="true" aria-label="Loading reach">
    <div class="rc-tiles">${'<div class="rc-tile sk-tile"><div class="sk"></div><div class="sk lg"></div></div>'.repeat(4)}</div>
    <div class="rc-card"><div class="sk"></div><div class="sk rc-sk-chart"></div></div>
    <div class="rc-card"><div class="sk"></div><div class="sk md"></div><div class="sk md"></div></div>
  </div>`;
}

function rangeControl() {
  return `<div class="rc-seg" role="radiogroup" aria-label="Time range">
    ${RANGES.map((n) => `<button type="button" role="radio" aria-checked="${n === range}" data-range="${n}" class="${n === range ? 'on' : ''}">${n} days</button>`).join('')}
  </div>`;
}

/**
 * Reached of audience as the bar; read sits inside it, since everyone who read
 * it was reached. Text alongside carries the numbers — colour is never alone.
 */
function reachBar(audience, delivered, read) {
  const whole = Math.max(audience, delivered, 1);
  const d = Math.min(100, (delivered / whole) * 100);
  const r = Math.min(d, (read / whole) * 100);
  return `<div class="rc-bar" aria-hidden="true">
    <span class="rc-bar-reach" style="width:${d.toFixed(1)}%"></span>
    <span class="rc-bar-read" style="width:${r.toFixed(1)}%"></span>
  </div>`;
}

function legend() {
  return `<div class="rc-legend">
    <span><i class="sw sw-read"></i>Read</span>
    <span><i class="sw sw-reach"></i>Reached, not read yet</span>
  </div>`;
}

function tiles(s) {
  const t = s.totals;
  const p = s.previous;
  const responses = t.replies + t.reactions;
  const tile = (label, value, sub, d, extra = '') => `
    <div class="rc-tile ${extra}">
      <span class="rc-tile-k">${label}</span>
      <span class="rc-tile-v">${value}</span>
      ${sub ? `<span class="rc-tile-sub">${sub}</span>` : ''}
      ${d || ''}
    </div>`;
  return `<div class="rc-tiles">
    ${tile('Posts sent', num(t.posts), t.sends ? `${num(t.sends)} group sends` : '', delta(t.posts, p.posts))}
    ${tile('People reached', num(t.delivered), t.audience ? `of ${num(t.audience)} members · ${pctText(t.delivered, t.audience)}` : '', delta(t.delivered, p.delivered))}
    ${tile('Read by', `${num(t.read)}<small>+</small>`, t.audience ? `${pctText(t.read, t.audience)} of members, at least` : 'at least', delta(t.read, p.read))}
    ${tile('Responses', num(responses), `${num(t.replies)} replies · ${num(t.reactions)} reactions`, delta(responses, p.replies + p.reactions))}
  </div>`;
}

/** Daily bars: reached as the bar, read inside it. Tap or hover a day for numbers. */
function dailyChart(daily) {
  const max = Math.max(1, ...daily.map((d) => d.delivered));
  const hasAny = daily.some((d) => d.posts);
  if (!hasAny) {
    return `<div class="rc-card"><h3 class="rc-h">Reach by day</h3><p class="rc-empty-line">No posts in the last ${range} days.</p></div>`;
  }
  const every = daily.length <= 7 ? 1 : daily.length <= 30 ? 7 : 21;
  const bars = daily.map((d, i) => {
    const h = (d.delivered / max) * 100;
    const r = d.delivered ? (d.read / d.delivered) * h : 0;
    const label = `${shortDay(d.day)}: ${d.posts} post${d.posts === 1 ? '' : 's'}, reached ${num(d.delivered)}, read by ${num(d.read)}`;
    return `<button type="button" class="rc-col" data-i="${i}" aria-label="${escapeHtml(label)}">
      <span class="rc-col-bar" style="height:${h.toFixed(1)}%">${d.delivered ? `<span class="rc-col-read" style="height:${h ? ((r / h) * 100).toFixed(1) : 0}%"></span>` : ''}</span>
    </button>`;
  }).join('');
  // Label back from today at a steady interval; the first day too if it has room.
  const last = daily.length - 1;
  const ticks = daily.map((d, i) => {
    const show = (last - i) % every === 0 || (i === 0 && last % every >= every * 0.75);
    return `<span>${show ? shortDay(d.day) : ''}</span>`;
  }).join('');
  const rows = daily.filter((d) => d.posts).map((d) =>
    `<tr><td>${shortDay(d.day)}</td><td>${d.posts}</td><td>${num(d.delivered)}</td><td>${num(d.read)}</td></tr>`).join('');
  return `<div class="rc-card">
    <div class="rc-card-head">
      <h3 class="rc-h">Reach by day</h3>
      ${legend()}
    </div>
    <div class="rc-chart" data-chart>
      <div class="rc-chart-y" aria-hidden="true"><span>${num(max)}</span><span>0</span></div>
      <div class="rc-chart-plot">
        <div class="rc-cols" style="--n:${daily.length}">${bars}</div>
        <div class="rc-ticks" style="--n:${daily.length}" aria-hidden="true">${ticks}</div>
      </div>
      <div class="rc-tip" role="status" hidden></div>
    </div>
    <details class="rc-table">
      <summary>Show as table</summary>
      <table><thead><tr><th>Day</th><th>Posts</th><th>Reached</th><th>Read</th></tr></thead><tbody>${rows}</tbody></table>
    </details>
  </div>`;
}

function postCard(p) {
  const via = VIA_LABEL[p.via] || 'Sent';
  const responses = p.replies + p.reactions;
  const numbers = p.noInfo
    ? `<p class="rc-post-nums muted">WhatsApp didn’t share numbers for ${p.groups === 1 ? 'this group' : 'these groups'}.</p>`
    : `<p class="rc-post-nums"><strong>${num(p.delivered)}</strong> reached${p.audience ? ` of ${num(p.audience)}` : ''} · <strong>${num(p.read)}+</strong> read${p.audience ? ` (${pctText(p.read, p.audience)})` : ''}</p>`;
  const react = p.reactionTop?.length
    ? p.reactionTop.map(([e, n]) => `<span>${escapeHtml(e)} ${num(n)}</span>`).join('')
    : '';
  return `<button type="button" class="rc-post" data-post="${escapeHtml(p.post)}">
    <span class="rc-thumb ${p.thumb ? '' : 'no-img'} ${p.kind === 'media' ? 'is-media' : ''}" ${p.thumb ? `data-thumb="${escapeHtml(p.thumb)}"` : ''} aria-hidden="true"></span>
    <span class="rc-post-body">
      <span class="rc-post-title">${escapeHtml(postTitle(p))}</span>
      <span class="rc-post-meta">${dayLabel(p.sentAt)}, ${timeLabel(p.sentAt)} · ${p.groups} ${p.groups === 1 ? 'chat' : 'chats'} · ${via}${p.status === 'measuring' ? ' · <span class="rc-live">Still counting</span>' : ''}</span>
      ${p.noInfo ? '' : reachBar(p.audience, p.delivered, p.read)}
      ${numbers}
      ${responses ? `<span class="rc-post-resp">${p.replies ? `<span>💬 ${num(p.replies)}</span>` : ''}${react}</span>` : ''}
    </span>
  </button>`;
}

function groupsCard(groups) {
  if (!groups.length) return '';
  const top = groups.filter((g) => g.audience > 0).slice(0, 8);
  if (!top.length) return '';
  return `<div class="rc-card">
    <div class="rc-card-head">
      <h3 class="rc-h">Groups that read the most</h3>
      <span class="rc-card-note">% of members who read each post</span>
    </div>
    <ol class="rc-groups">
      ${top.map((g) => `<li>
        <div class="rc-g-row">
          <span class="rc-g-name">${escapeHtml(g.name)}</span>
          <span class="rc-g-pct">${pctText(g.read, g.audience) || '—'}</span>
        </div>
        ${reachBar(g.audience, g.delivered, g.read)}
        <span class="rc-g-sub">${g.posts} post${g.posts === 1 ? '' : 's'} · ${num(g.read)} reads in total${g.replies ? ` · 💬 ${num(g.replies)}` : ''}</span>
      </li>`).join('')}
    </ol>
  </div>`;
}

function note(s) {
  const since = Number.isFinite(s.trackingSince) ? dayLabel(s.trackingSince, true) : null;
  return `<p class="rc-foot">
    <strong>How to read this.</strong> <em>Reached</em> means WhatsApp delivered it to that person’s phone.
    <em>Read</em> counts people who opened it, but anyone who turned off read receipts is never counted, so the real number is higher.
    Numbers keep updating for 7 days after a post goes out.${since ? ` Counting started ${since}; earlier messages can’t be measured.` : ''}
  </p>`;
}

/* ---------- views ---------- */

async function renderList() {
  const my = ++loadToken;
  host.innerHTML = skeleton();
  let s;
  let list;
  try {
    await ensureSandeshaAuth();
    [s, list] = await Promise.all([
      api(`/reach/summary?range=${range}`),
      api(`/reach/posts?range=${range}&limit=30`),
    ]);
  } catch (err) {
    if (my !== loadToken) return;
    host.innerHTML = errorState(err);
    return;
  }
  if (my !== loadToken) return;

  const header = `<div class="rc-top">
    <div>
      <h2 class="rc-title">Message reach</h2>
      <p class="rc-sub">${s.measuring ? `${s.measuring} post${s.measuring === 1 ? ' is' : 's are'} still being counted` : 'All numbers are final'}</p>
    </div>
    ${rangeControl()}
  </div>`;

  if (!s.totals.posts && !list.posts.length) {
    host.innerHTML = `<div class="rc">${header}
      <div class="rc-empty">
        <div class="rc-empty-ic" aria-hidden="true">📈</div>
        <h3>No posts measured yet</h3>
        <p>Reach is recorded for every WhatsApp message Sandesha sends. Send or schedule a post and its numbers will appear here within about 10 minutes.</p>
      </div>
      ${note(s)}
    </div>`;
    bindTop();
    return;
  }

  host.innerHTML = `<div class="rc">
    ${header}
    ${tiles(s)}
    ${dailyChart(s.daily)}
    <div class="rc-card rc-card-flush">
      <div class="rc-card-head pad">
        <h3 class="rc-h">Posts</h3>
        ${legend()}
      </div>
      <div class="rc-posts">${list.posts.map(postCard).join('')}</div>
      ${list.more ? `<button type="button" class="rc-more" data-more="${list.posts[list.posts.length - 1].sentAt}">Show older posts</button>` : ''}
    </div>
    ${groupsCard(s.groups)}
    ${note(s)}
  </div>`;
  bindTop();
  bindChart(s.daily);
  bindPosts(host);
  hydrateThumbs(host);
  host.querySelector('[data-more]')?.addEventListener('click', loadMore);
}

async function loadMore(ev) {
  const btn = ev.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const list = await api(`/reach/posts?range=${range}&limit=30&before=${btn.dataset.more}`);
    const wrap = host.querySelector('.rc-posts');
    const frag = document.createElement('div');
    frag.innerHTML = list.posts.map(postCard).join('');
    bindPosts(frag);
    hydrateThumbs(frag);
    wrap.append(...frag.children);
    if (list.more && list.posts.length) {
      btn.dataset.more = list.posts[list.posts.length - 1].sentAt;
      btn.disabled = false;
      btn.textContent = 'Show older posts';
    } else {
      btn.remove();
    }
  } catch {
    btn.disabled = false;
    btn.textContent = 'Couldn’t load — try again';
  }
}

function bindTop() {
  host.querySelectorAll('[data-range]').forEach((b) => {
    b.addEventListener('click', () => {
      const n = Number(b.dataset.range);
      if (n === range) return;
      range = n;
      saveRange(n);
      renderList();
    });
  });
}

function bindPosts(root) {
  root.querySelectorAll('[data-post]').forEach((b) => {
    b.addEventListener('click', () => openPost(b.dataset.post));
  });
}

function bindChart(daily) {
  const chart = host.querySelector('[data-chart]');
  if (!chart) return;
  const tip = chart.querySelector('.rc-tip');
  let active = null;
  const show = (col) => {
    const d = daily[Number(col.dataset.i)];
    if (!d) return;
    active?.classList.remove('is-on');
    active = col;
    col.classList.add('is-on');
    tip.innerHTML = d.posts
      ? `<strong>${shortDay(d.day)}</strong><span>${d.posts} post${d.posts === 1 ? '' : 's'}</span><span><i class="sw sw-reach"></i>Reached ${num(d.delivered)}</span><span><i class="sw sw-read"></i>Read ${num(d.read)}${d.delivered ? ` (${pctText(d.read, d.delivered)})` : ''}</span>`
      : `<strong>${shortDay(d.day)}</strong><span>No posts</span>`;
    tip.hidden = false;
    const plot = chart.getBoundingClientRect();
    const c = col.getBoundingClientRect();
    const x = c.left + c.width / 2 - plot.left;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(plot.width - w, x - w / 2))}px`;
  };
  const hide = () => {
    active?.classList.remove('is-on');
    active = null;
    tip.hidden = true;
  };
  chart.querySelectorAll('.rc-col').forEach((col) => {
    col.addEventListener('pointerenter', () => show(col));
    col.addEventListener('focus', () => show(col));
    col.addEventListener('click', () => show(col));
  });
  chart.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  chart.addEventListener('focusout', (e) => { if (!chart.contains(e.relatedTarget)) hide(); });
}

async function openPost(key) {
  view = { name: 'post', key };
  const my = ++loadToken;
  host.innerHTML = `<div class="rc">${backBar()}<div class="rc-card"><div class="sk"></div><div class="sk lg"></div><div class="sk md"></div></div></div>`;
  host.scrollTop = 0;
  bindBack();
  let p;
  try {
    p = await api(`/reach/post?key=${encodeURIComponent(key)}`);
  } catch (err) {
    if (my !== loadToken) return;
    host.innerHTML = `<div class="rc">${backBar()}${errorState(err)}</div>`;
    bindBack();
    return;
  }
  if (my !== loadToken) return;
  host.innerHTML = postDetail(p);
  bindBack();
  hydrateThumbs(host);
}

function backBar() {
  return `<button type="button" class="rc-back" data-back>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
    All posts
  </button>`;
}

function bindBack() {
  host.querySelector('[data-back]')?.addEventListener('click', () => {
    view = { name: 'list' };
    renderList();
  });
}

function postDetail(p) {
  const via = VIA_LABEL[p.via] || 'Sent';
  const text = String(p.text || '').trim();
  const statusLine = p.status === 'measuring'
    ? `Still counting${p.nextCheckAt ? ` · next update ${untilText(p.nextCheckAt)}` : ''}`
    : 'Final numbers';

  const stat = (k, v, sub) => `<div class="rc-stat"><span class="rc-tile-k">${k}</span><span class="rc-stat-v">${v}</span>${sub ? `<span class="rc-tile-sub">${sub}</span>` : ''}</div>`;

  const totalReaders = p.curve?.[p.curve.length - 1] || 0;
  const elapsedH = (Date.now() - p.sentAt) / 3600000;
  const steps = READ_STEPS.map(([h, label]) => {
    // curve[i] = readers within i+1 hours; the last slot also holds late/undated reads.
    const n = p.curve?.[h >= 168 ? p.curve.length - 1 : h - 1] || 0;
    const future = elapsedH < h;
    return { label, n, future };
  });
  const speed = totalReaders ? `<div class="rc-card">
      <div class="rc-card-head"><h3 class="rc-h">How fast people read it</h3><span class="rc-card-note">readers so far</span></div>
      <ul class="rc-steps">
        ${steps.map((s) => `<li class="${s.future ? 'is-future' : ''}">
          <span class="rc-step-k">${s.label}</span>
          <span class="rc-step-bar" aria-hidden="true"><span style="width:${((s.n / totalReaders) * 100).toFixed(1)}%"></span></span>
          <span class="rc-step-v">${s.future && !s.n ? '—' : num(s.n)}</span>
        </li>`).join('')}
      </ul>
      ${(() => {
        const first = steps.find((s) => s.n >= totalReaders / 2);
        return first ? `<p class="rc-card-foot">Half of the readers had opened it <strong>${first.label.toLowerCase()}</strong>.</p>` : '';
      })()}
    </div>` : '';

  const groups = p.groupRows.map((g) => `<li>
      <div class="rc-g-row">
        <span class="rc-g-name">${escapeHtml(g.name || (g.isGroup ? 'Group' : 'Chat'))}</span>
        <span class="rc-g-pct">${g.infoMissing ? '—' : pctText(g.read, g.audience) || '—'}</span>
      </div>
      ${g.infoMissing ? '' : reachBar(g.audience, g.delivered, g.read)}
      <span class="rc-g-sub">${g.infoMissing
        ? 'WhatsApp didn’t share numbers for this chat'
        : `${num(g.delivered)} reached${g.audience ? ` of ${num(g.audience)}` : ''} · ${num(g.read)}+ read${g.replies ? ` · 💬 ${num(g.replies)}` : ''}${g.reactions ? ` · ${num(g.reactions)} reactions` : ''}`}</span>
    </li>`).join('');

  const replies = p.replySamples?.length ? `<div class="rc-card">
      <h3 class="rc-h">Latest replies</h3>
      <ul class="rc-replies">
        ${p.replySamples.map((r) => `<li><p>${escapeHtml(r.text)}</p><span>${escapeHtml(r.group || '')}${r.group ? ' · ' : ''}${ago(r.at)}</span></li>`).join('')}
      </ul>
    </div>` : '';

  const reactions = p.reactionList?.length ? `<div class="rc-reacts" aria-label="Reactions">
      ${p.reactionList.map(([e, n]) => `<span class="rc-react"><span class="rc-react-e">${escapeHtml(e)}</span>${num(n)}</span>`).join('')}
    </div>` : '';

  return `<div class="rc">
    ${backBar()}
    <div class="rc-card rc-hero">
      ${p.thumb ? `<span class="rc-hero-img" data-thumb="${escapeHtml(p.thumb)}" role="img" aria-label="Picture sent with this post"></span>` : ''}
      <p class="rc-post-meta">${dayLabel(p.sentAt, true)}, ${timeLabel(p.sentAt)} · ${via}${p.actor ? ` by ${escapeHtml(p.actor)}` : ''}</p>
      ${text ? `<p class="rc-hero-text">${waFormat(escapeHtml(text))}</p>` : `<p class="rc-hero-text muted">${p.kind === 'media' ? 'Picture with no caption' : 'Message'}</p>`}
      <p class="rc-status ${p.status === 'measuring' ? 'is-live' : ''}">${statusLine}${p.lastCheckedAt ? ` · checked ${ago(p.lastCheckedAt)}` : ''}</p>
    </div>
    <div class="rc-stats">
      ${stat('Sent to', num(p.groups), `${p.groups === 1 ? 'chat' : 'chats'} · ${num(p.audience)} members`)}
      ${stat('Reached', num(p.delivered), p.audience ? `${pctText(p.delivered, p.audience)} of members` : '')}
      ${stat('Read by', `${num(p.read)}+`, p.audience ? `${pctText(p.read, p.audience)}, at least` : 'at least')}
      ${stat('Responses', num(p.replies + p.reactions), `${num(p.replies)} replies · ${num(p.reactions)} reactions`)}
    </div>
    ${reactions}
    ${speed}
    <div class="rc-card">
      <div class="rc-card-head"><h3 class="rc-h">By group</h3>${legend()}</div>
      <ol class="rc-groups">${groups}</ol>
    </div>
    ${replies}
    <p class="rc-foot">Read counts miss people who turned off read receipts, so the real number is higher.</p>
  </div>`;
}

function errorState(err) {
  const msg = String(err?.message || '');
  const offline = /reach server|fetch|network/i.test(msg);
  return `<div class="rc-empty">
    <div class="rc-empty-ic" aria-hidden="true">${offline ? '📡' : '⚠️'}</div>
    <h3>${offline ? 'Can’t reach Sandesha' : 'Couldn’t load reach'}</h3>
    <p>${offline ? 'The Sandesha server isn’t answering. Check that it’s running, then try again.' : escapeHtml(msg || 'Something went wrong.')}</p>
    <button type="button" class="rc-retry" data-retry>Try again</button>
  </div>`;
}

/** Called each time the Reach tab opens. */
export function renderPromoReach(el) {
  if (host !== el) {
    host = el;
    host.addEventListener('click', (e) => {
      if (!e.target.closest('[data-retry]')) return;
      if (view.name === 'post') openPost(view.key);
      else renderList();
    });
  }
  if (view.name === 'post') openPost(view.key);
  else renderList();
}

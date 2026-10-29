/**
 * Audience sheet for admin-promotions.html.
 *
 * The shared target picker mounts into document.body and depends on
 * components.css, which the promotions page does not load. This one mounts
 * inside .phone so the sheet's absolute positioning resolves against the
 * device frame, and it borrows the board's own sheet/scrim classes.
 */
import { escapeHtml, escapeAttr } from './api.js';
import { getState } from './store.js?v=34';

const SECTION_ORDER = ['set', 'group', 'community', 'announcement', 'contact'];
const SECTION_LABELS = {
  set: 'Sets',
  group: 'Groups',
  community: 'Communities',
  announcement: 'Announcements',
  contact: 'Contacts',
};
const SECTION_CAP = 60;

const TICK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

function frame() {
  // Always body. The New post drawer is position:fixed at z-index 41 and has
  // its own transform, so a sheet inside .phone or inside #compose is trapped
  // behind / clipped by that drawer.
  return document.body;
}

function findGroup(nameOrJid) {
  const key = String(nameOrJid || '').toLowerCase();
  return (getState().groups || []).find(
    (x) => String(x.jid).toLowerCase() === key || String(x.name || '').toLowerCase() === key,
  );
}

/** Sets list members by name, direct picks carry a jid — collapse both. */
function leafKey(nameOrJid) {
  return String(findGroup(nameOrJid)?.jid || nameOrJid || '').toLowerCase();
}

/** Falls back to 1 so a chosen list never reads as zero people. */
function leafSize(nameOrJid) {
  return Number(findGroup(nameOrJid)?.participants) || 1;
}

/**
 * People these options reach, counting any group in two lists once — the same
 * way the send loop and the scheduler dedupe.
 */
export function audienceTotal(options) {
  const { sets } = getState();
  const seen = new Set();
  let total = 0;

  const add = (nameOrJid, size) => {
    const key = leafKey(nameOrJid);
    if (!key || seen.has(key)) return;
    seen.add(key);
    total += size;
  };

  for (const option of options || []) {
    if (!option) continue;
    if (option.type === 'set') {
      const members = sets[String(option.value).toLowerCase()] || sets[option.value] || [];
      for (const member of members) add(member, leafSize(member));
      continue;
    }
    add(option.value, option.type === 'contact' ? 1 : leafSize(option.value));
  }
  return total;
}

export function audienceSize(option) {
  return audienceTotal([option]);
}

export function audienceSummary(targets) {
  if (!targets?.length) return 'No list chosen';
  const names = targets.map((t) => t.label || t.value);
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

/**
 * @param {Array} options - from getTargetOptions()
 * @param {Array} preselected
 * @param {(picked: Array) => void} onDone
 */
export function openAudienceSheet(options, preselected, onDone) {
  const host = frame();
  const picked = new Map();
  for (const t of preselected || []) {
    if (t?.value != null) picked.set(String(t.value), t);
  }

  const scrim = document.createElement('div');
  scrim.className = 'scrim promo-aud-scrim';

  const sheet = document.createElement('div');
  sheet.className = 'sheet promo-aud-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Choose audience');
  sheet.innerHTML = `
    <div class="grab"></div>
    <div class="sh-head">
      <h3>Who gets this</h3>
      <p>Pick one or more lists. A contact in two lists is only messaged once.</p>
    </div>
    <input type="search" class="pick-search" placeholder="Search sets, groups, contacts…" aria-label="Search audiences" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search"/>
    <div class="aud-list" id="promoAudList"></div>
    <div class="sh-foot">
      <button type="button" class="b pri" id="promoAudDone">Done</button>
    </div>`;

  const list = sheet.querySelector('#promoAudList');
  const search = sheet.querySelector('.pick-search');
  const done = sheet.querySelector('#promoAudDone');

  function optionHaystack(option) {
    const bits = [option.label, option.sub, option.value, option.type];
    if (option.type === 'set') {
      const sets = getState().sets || {};
      const members = sets[option.value] || sets[String(option.value).toLowerCase()] || [];
      bits.push(...members);
    }
    return bits.join(' ').toLowerCase();
  }

  function matchesQuery(option, q) {
    if (!q) return true;
    const hay = optionHaystack(option);
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  function rowHtml(option) {
    const on = picked.has(String(option.value));
    const size = audienceSize(option);
    return `
      <button type="button" class="aud-row" aria-pressed="${on}" data-value="${escapeAttr(option.value)}">
        <span class="tick" aria-hidden="true">${TICK}</span>
        <span class="nm">${escapeHtml(option.label || option.value)}${
          option.sub ? `<small>${escapeHtml(option.sub)}</small>` : ''
        }</span>
        <span class="ct">${size > 1 ? size : ''}</span>
      </button>`;
  }

  function paint() {
    const q = search.value.trim().toLowerCase();
    const matches = q ? options.filter((o) => matchesQuery(o, q)) : options;

    if (!matches.length) {
      list.innerHTML = '<div class="empty"><h3>No matches</h3>Try a shorter search.</div>';
      return;
    }

    const byType = new Map();
    for (const o of matches) {
      const key = o.type || 'group';
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key).push(o);
    }

    const order = [...SECTION_ORDER, ...[...byType.keys()].filter((k) => !SECTION_ORDER.includes(k))];
    const parts = [];
    for (const type of order) {
      const rows = byType.get(type);
      if (!rows?.length) continue;
      const shown = q ? rows : rows.slice(0, SECTION_CAP);
      parts.push(
        `<div class="aud-sec">${escapeHtml(SECTION_LABELS[type] || type)} · ${rows.length}</div>`,
      );
      parts.push(...shown.map(rowHtml));
      if (shown.length < rows.length) {
        parts.push(
          `<div class="aud-sec">Showing ${shown.length} of ${rows.length} — search to narrow</div>`,
        );
      }
    }
    list.innerHTML = parts.join('');
  }

  function refreshDone() {
    const total = audienceTotal([...picked.values()]);
    done.textContent = picked.size
      ? `Done · ${total} ${total === 1 ? 'person' : 'people'}`
      : 'Done';
  }

  function close() {
    scrim.classList.remove('on');
    sheet.classList.remove('on');
    const drop = () => {
      scrim.remove();
      sheet.remove();
    };
    sheet.addEventListener('transitionend', drop, { once: true });
    setTimeout(drop, 400);
  }

  let settled = false;
  function finish(result) {
    if (settled) return;
    settled = true;
    close();
    onDone(result);
  }

  list.addEventListener('click', (ev) => {
    const row = ev.target.closest('.aud-row');
    if (!row) return;
    const key = row.dataset.value;
    if (picked.has(key)) picked.delete(key);
    else {
      const option = options.find((o) => String(o.value) === key);
      if (option) picked.set(key, option);
    }
    row.setAttribute('aria-pressed', String(picked.has(key)));
    refreshDone();
  });

  search.addEventListener('input', paint);
  search.addEventListener('search', paint);
  scrim.addEventListener('click', () => finish(preselected || []));
  done.addEventListener('click', () => finish([...picked.values()]));

  host.append(scrim, sheet);
  paint();
  refreshDone();
  requestAnimationFrame(() => {
    scrim.classList.add('on');
    sheet.classList.add('on');
  });
}

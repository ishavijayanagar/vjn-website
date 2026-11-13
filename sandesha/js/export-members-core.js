/**
 * Export members — pick WhatsApp groups, pull every member, download one CSV.
 *
 * Host-independent: the Messaging page (admin) and the Nurturing Settings page
 * both mount it. Each host supplies where the groups come from and how the
 * export is requested, so this file never touches the store or a bearer token.
 *
 *   const view = mountExportMembers(el, {
 *     getGroups:     async () => [{ jid, name, participants, type? }],
 *     exportMembers: async (jids) => ({ groups, members }),   // POST /groups/export-members
 *   });
 *   view.render();
 *
 * The CSV is built in the browser; styles live in css/export-members.css.
 */
import { toast } from './toast.js';

const BATCH_SIZE = 10;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function mountExportMembers(container, { getGroups, exportMembers }) {
  const selected = new Set();   // group jids
  let groups = [];
  let loadError = '';
  let loaded = false;
  let loading = false;
  let searchQ = '';
  let dedupe = false;
  let running = false;
  let result = null;            // { groups, members } from the last run

  const $ = (sel) => container.querySelector(sel);

  async function render() {
    if (!container) return;
    if (!loaded && !loading) {
      loading = true;
      container.innerHTML = '<div class="ex-root"><p class="ex-hint">Loading groups…</p></div>';
      try {
        groups = (await getGroups()) || [];
        loadError = '';
      } catch (err) {
        groups = [];
        loadError = err?.message || 'Could not load groups';
      }
      loaded = !loadError; // a failed load is retried next time the page opens
      loading = false;
    } else if (loaded) {
      try { groups = (await getGroups()) || groups; } catch { /* keep the list we have */ }
    }
    paintShell();
  }

  function paintShell() {
    container.innerHTML = `
      <div class="ex-root">
        <div class="ex-card">
          <p class="ex-hint">Pick one or more groups. Every member goes into a single CSV (name, phone, group, admin).</p>
          <input type="search" id="ex-search" class="ex-search" placeholder="Search groups…" autocomplete="off" value="${esc(searchQ)}">
          <div class="ex-toolbar">
            <span class="ex-count" id="ex-count"></span>
            <span class="ex-links">
              <button type="button" class="ex-link" id="ex-select-shown">Select shown</button>
              <button type="button" class="ex-link ex-link-danger" id="ex-clear">Clear</button>
            </span>
          </div>
        </div>
        <div class="ex-list" id="ex-list"></div>
        <div class="ex-card">
          <label class="ex-option">
            <input type="checkbox" id="ex-dedupe" ${dedupe ? 'checked' : ''}>
            <span>One row per person <span class="ex-hint">(people in several groups are merged; the Groups column lists them all)</span></span>
          </label>
          <button type="button" class="ex-btn" id="ex-run"></button>
          <div id="ex-status" class="ex-status" role="status" aria-live="polite"></div>
        </div>
      </div>`;

    $('#ex-search').addEventListener('input', (e) => { searchQ = e.target.value; paintList(); });
    $('#ex-select-shown').addEventListener('click', () => {
      shownGroups().forEach((g) => selected.add(g.jid));
      paintList();
    });
    $('#ex-clear').addEventListener('click', () => { selected.clear(); paintList(); });
    $('#ex-dedupe').addEventListener('change', (e) => {
      dedupe = e.target.checked;
      // The last run can be re-downloaded in the other layout without asking WhatsApp again.
      if (result && !running) paintStatus();
    });
    $('#ex-list').addEventListener('change', (e) => {
      const box = e.target.closest('input[data-jid]');
      if (!box) return;
      if (box.checked) selected.add(box.dataset.jid);
      else selected.delete(box.dataset.jid);
      paintCount();
    });
    $('#ex-run').addEventListener('click', runExport);

    paintList();
    paintStatus(running ? 'Extracting…' : '');
  }

  function shownGroups() {
    const q = searchQ.trim().toLowerCase();
    return q ? groups.filter((g) => (g.name || '').toLowerCase().includes(q)) : groups;
  }

  function paintList() {
    const listEl = $('#ex-list');
    if (!listEl) return;
    const shown = shownGroups();
    if (!shown.length) {
      listEl.innerHTML = `<p class="ex-empty">${groups.length ? 'No groups match' : esc(loadError || 'No groups found — is WhatsApp connected?')}</p>`;
    } else {
      listEl.innerHTML = shown.map((g) => `
        <label class="ex-row">
          <input type="checkbox" data-jid="${esc(g.jid)}" ${selected.has(g.jid) ? 'checked' : ''}>
          <span class="ex-row-main">
            <span class="ex-row-title">${esc(g.name)}</span>
            <span class="ex-row-sub">${g.participants ?? '?'} members${g.type && g.type !== 'group' ? ` · ${esc(g.type)}` : ''}</span>
          </span>
        </label>`).join('');
    }
    paintCount();
  }

  function pickedJids() {
    const known = new Set(groups.map((g) => g.jid));
    return [...selected].filter((j) => known.has(j));
  }

  function paintCount() {
    const picked = pickedJids();
    const members = groups
      .filter((g) => selected.has(g.jid))
      .reduce((n, g) => n + (Number(g.participants) || 0), 0);
    const countEl = $('#ex-count');
    if (countEl) countEl.textContent = picked.length ? `${picked.length} selected · ~${members} members` : 'None selected';
    const runBtn = $('#ex-run');
    if (runBtn) {
      runBtn.disabled = running || !picked.length;
      runBtn.textContent = running ? 'Extracting…' : (picked.length
        ? `Extract & download CSV (${picked.length} group${picked.length === 1 ? '' : 's'})`
        : 'Select groups to extract');
    }
  }

  function paintStatus(progress = '') {
    const el = $('#ex-status');
    if (!el) return;
    if (progress) { el.innerHTML = `<p class="ex-hint">${esc(progress)}</p>`; return; }
    if (!result) { el.innerHTML = ''; return; }

    const rows = buildRows(result.members, dedupe).length;
    const failed = result.groups.filter((g) => g.error);
    const okCount = result.groups.length - failed.length;
    const unresolved = result.groups.reduce((n, g) => n + (g.unresolved || 0), 0);
    el.innerHTML = `
      <p class="ex-hint"><strong>${rows}</strong> row${rows === 1 ? '' : 's'} from ${okCount} group${okCount === 1 ? '' : 's'}.</p>
      ${unresolved ? `<p class="ex-hint">${unresolved} member${unresolved === 1 ? '' : 's'} have no phone number (WhatsApp hides it) — left blank.</p>` : ''}
      ${failed.map((g) => `<p class="ex-hint ex-err">${esc(g.name)}: ${esc(g.error)}</p>`).join('')}
      <button type="button" class="ex-btn ex-btn-secondary" id="ex-again">Download again</button>`;
    el.querySelector('#ex-again')?.addEventListener('click', () => downloadCsv(result, dedupe));
  }

  async function runExport() {
    if (running) return;
    const jids = pickedJids();
    if (!jids.length) return;

    running = true;
    result = null;
    paintCount();

    const outGroups = [];
    const outMembers = [];
    try {
      for (let i = 0; i < jids.length; i += BATCH_SIZE) {
        const batch = jids.slice(i, i + BATCH_SIZE);
        paintStatus(`Reading groups ${i + 1}–${i + batch.length} of ${jids.length}…`);
        const data = await exportMembers(batch);
        outGroups.push(...(data.groups || []));
        outMembers.push(...(data.members || []));
      }
      result = { groups: outGroups, members: outMembers };
      if (!outMembers.length) {
        toast('No members found in the selected groups', 'err');
        return;
      }
      downloadCsv(result, dedupe);
      toast(`Downloaded ${buildRows(outMembers, dedupe).length} rows`, 'ok');
    } catch (err) {
      // Keep what was read so far; it can still be downloaded again.
      if (outMembers.length) result = { groups: outGroups, members: outMembers };
      toast(err?.message || 'Export failed', 'err');
    } finally {
      running = false;
      paintCount();
      paintStatus();
    }
  }

  return { render };
}

/** One CSV row per member, or per person when `merge` is on. */
function buildRows(members, merge) {
  if (!merge) {
    return members.map((m) => ({ name: m.name, phone: m.phone, groups: m.group, admin: m.isAdmin ? 'Yes' : '' }));
  }
  const byPhone = new Map();
  const rows = [];
  for (const m of members) {
    const existing = m.phone ? byPhone.get(m.phone) : null;
    if (existing) {
      if (!existing.groupList.includes(m.group)) existing.groupList.push(m.group);
      if (m.isAdmin && !existing.adminList.includes(m.group)) existing.adminList.push(m.group);
      if (!existing.name && m.name) existing.name = m.name;
      continue;
    }
    const row = { name: m.name, phone: m.phone, groupList: [m.group], adminList: m.isAdmin ? [m.group] : [] };
    if (m.phone) byPhone.set(m.phone, row);
    rows.push(row);
  }
  return rows.map((r) => ({ name: r.name, phone: r.phone, groups: r.groupList.join('; '), admin: r.adminList.join('; ') }));
}

// A cell starting with = + - @ would run as a formula in Excel/Sheets, and
// WhatsApp display names are set by the members themselves.
function csvCell(value, { text = true } = {}) {
  let s = String(value ?? '');
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(res, merge) {
  const rows = buildRows(res.members, merge);
  const head = merge ? ['Name', 'Phone', 'Groups', 'Admin of'] : ['Name', 'Phone', 'Group', 'Admin'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([csvCell(r.name), csvCell(r.phone, { text: false }), csvCell(r.groups), csvCell(r.admin)].join(','));
  }
  // BOM so Excel reads Hindi/Kannada/Tamil names as UTF-8.
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = csvFilename(res);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function csvFilename(res) {
  const date = new Date().toISOString().slice(0, 10);
  const ok = res.groups.filter((g) => !g.error);
  const base = ok.length === 1
    ? ok[0].name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'group'
    : `${ok.length}-groups`;
  return `whatsapp-members-${base}-${date}.csv`;
}

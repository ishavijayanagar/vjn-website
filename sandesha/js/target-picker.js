import { escapeHtml, escapeAttr } from './api.js';

const SECTION_ORDER = ['contact', 'set', 'group', 'announcement', 'community', 'broadcast'];
const SECTION_LABELS = {
  contact: 'Contacts',
  set: 'Sets',
  group: 'Groups',
  announcement: 'Announcements',
  community: 'Communities',
  broadcast: 'Broadcast',
};

/**
 * @param {Array} options
 * @param {(selected: object|object[]) => void} onSelect - array when multi, single object when not
 * @param {{ multi?: boolean, selected?: object[] }} [opts]
 */
export function openTargetPicker(options, onSelect, opts = {}) {
  const multi = opts.multi !== false;
  const selected = new Map();
  for (const t of opts.selected || []) {
    if (t?.value != null) selected.set(String(t.value), t);
  }

  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet sheet-multi" role="dialog" aria-modal="true" aria-label="${multi ? 'Choose targets' : 'Choose target'}">
      <div class="sheet-handle"></div>
      <h3 class="sheet-title">${multi ? 'Choose targets' : 'Choose target'}</h3>
      <p class="hint mt-sm">${multi ? 'Tap to select multiple, then Done' : 'Tap one target'}</p>
      <input type="search" class="sheet-search" placeholder="Search contacts, sets, groups…" autofocus>
      <div class="sheet-list"></div>
      ${multi ? `
        <div class="sheet-footer">
          <button type="button" class="btn secondary" id="sheet-clear">Clear</button>
          <button type="button" class="btn" id="sheet-done">Done (0)</button>
        </div>` : ''}
    </div>`;

  const list = overlay.querySelector('.sheet-list');
  const search = overlay.querySelector('.sheet-search');
  const doneBtn = overlay.querySelector('#sheet-done');
  const clearBtn = overlay.querySelector('#sheet-clear');

  function updateDone() {
    if (doneBtn) doneBtn.textContent = `Done (${selected.size})`;
  }

  function toggleItem(item) {
    const key = String(item.value);
    if (item.type === 'broadcast' || item.value === '__broadcast__') {
      selected.clear();
      selected.set(key, item);
      render(search.value);
      updateDone();
      return;
    }
    if (selected.has('__broadcast__')) selected.delete('__broadcast__');
    if (selected.has(key)) selected.delete(key);
    else selected.set(key, item);
    render(search.value);
    updateDone();
  }

  function render(filter = '') {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.sub || '').toLowerCase().includes(q) || o.type.toLowerCase().includes(q))
      : options;

    if (!filtered.length) {
      list.innerHTML = '<p class="empty">No matches</p>';
      return;
    }

    const byType = new Map();
    for (const o of filtered) {
      const key = o.type || 'group';
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key).push(o);
    }

    const parts = [];
    for (const type of SECTION_ORDER) {
      const items = byType.get(type);
      if (!items?.length) continue;
      const limit = type === 'group' || type === 'community' || type === 'announcement' ? 80 : 200;
      const shown = items.slice(0, limit);
      parts.push(`<div class="sheet-section">${escapeHtml(SECTION_LABELS[type] || type)} (${items.length})</div>`);
      parts.push(...shown.map((o) => {
        const isOn = selected.has(String(o.value));
        return `
        <div class="sheet-item ${isOn ? 'selected' : ''}" data-value="${escapeAttr(o.value)}" data-type="${escapeAttr(o.type)}">
          ${multi ? `<span class="sheet-check" aria-hidden="true">${isOn ? '✓' : ''}</span>` : ''}
          <div class="row-main">
            <div class="row-title">${escapeHtml(o.label)}</div>
            <div class="row-sub">${escapeHtml(o.sub || o.type)}</div>
          </div>
        </div>`;
      }));
      if (items.length > limit) {
        parts.push(`<p class="hint sheet-hint">Showing ${limit} of ${items.length} — type to search</p>`);
      }
    }

    for (const [type, items] of byType) {
      if (SECTION_ORDER.includes(type)) continue;
      parts.push(`<div class="sheet-section">${escapeHtml(type)} (${items.length})</div>`);
      parts.push(...items.slice(0, 50).map((o) => {
        const isOn = selected.has(String(o.value));
        return `
        <div class="sheet-item ${isOn ? 'selected' : ''}" data-value="${escapeAttr(o.value)}" data-type="${escapeAttr(o.type)}">
          ${multi ? `<span class="sheet-check" aria-hidden="true">${isOn ? '✓' : ''}</span>` : ''}
          <div class="row-main">
            <div class="row-title">${escapeHtml(o.label)}</div>
            <div class="row-sub">${escapeHtml(o.sub || o.type)}</div>
          </div>
        </div>`;
      }));
    }

    list.innerHTML = parts.join('');
    list.querySelectorAll('.sheet-item').forEach((el) => {
      el.addEventListener('click', () => {
        const value = el.dataset.value;
        const type = el.dataset.type;
        const label = el.querySelector('.row-title')?.textContent || value;
        const item = options.find((o) => String(o.value) === value) || { value, type, label };
        if (!multi) {
          close();
          onSelect(item);
          return;
        }
        toggleItem({ ...item, label });
      });
    });
  }

  let closing = false;
  function close() {
    if (closing) return;
    closing = true;
    overlay.classList.add('closing');
    const drop = () => overlay.remove();
    overlay.addEventListener('animationend', drop, { once: true });
    setTimeout(drop, 260);
  }

  function finish() {
    const listSel = [...selected.values()];
    if (!listSel.length) {
      return;
    }
    close();
    onSelect(listSel);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  attachDragToDismiss(overlay.querySelector('.sheet'), close);
  search.addEventListener('input', () => render(search.value));
  clearBtn?.addEventListener('click', () => {
    selected.clear();
    render(search.value);
    updateDone();
  });
  doneBtn?.addEventListener('click', finish);

  render();
  updateDone();
  document.body.appendChild(overlay);
  search.focus();
}

/**
 * Drag the sheet down by its handle to dismiss. A quick flick (velocity) or a
 * drag past ~30% of the sheet height closes it; anything less springs back.
 */
function attachDragToDismiss(sheet, onClose) {
  const handle = sheet?.querySelector('.sheet-handle');
  if (!handle) return;
  let startY = 0;
  let startT = 0;
  let dy = 0;
  let dragging = false;

  handle.style.touchAction = 'none';
  handle.style.cursor = 'grab';

  function move(e) {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  }
  function end() {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    const velocity = dy / Math.max(1, Date.now() - startT);
    sheet.style.transition = 'transform 200ms var(--ease-out, ease-out)';
    if (dy > sheet.offsetHeight * 0.3 || velocity > 0.6) {
      sheet.style.transform = `translateY(${sheet.offsetHeight}px)`;
      setTimeout(onClose, 160);
    } else {
      sheet.style.transform = 'translateY(0)';
      setTimeout(() => { sheet.style.transition = ''; }, 220);
    }
  }
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startT = Date.now();
    dy = 0;
    sheet.style.transition = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  });
}

export function formatTargetSummary(targets) {
  if (!targets?.length) return 'Tap to choose targets';
  if (targets.length === 1) return targets[0].label || targets[0].value;
  if (targets.length === 2) return `${targets[0].label}, ${targets[1].label}`;
  return `${targets[0].label} +${targets.length - 1} more`;
}

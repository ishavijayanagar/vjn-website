/**
 * Toast — a small, self-dismissing status message.
 *
 * - Structured layout: status icon + message (+ a ×N badge when the same
 *   message fires again quickly, so repeats collapse instead of stacking).
 * - Enter/exit are CSS transitions (see .toast-item) so they interrupt cleanly.
 * - Tap to dismiss. Stack is capped; the oldest is pushed out.
 */
const MAX_VISIBLE = 3;

const ICONS = {
  ok: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
  err: '<svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

function toastContainer() {
  return (
    document.getElementById('sandeshaToastContainer')
    || document.getElementById('toast-container')
  );
}

let last = null; // { key, el, count, badge, hide, timer }

function scheduleHide(rec, duration) {
  clearTimeout(rec.timer);
  // Give repeats a little longer to be read.
  const ms = Math.max(1600, duration + (rec.count - 1) * 700);
  rec.timer = setTimeout(rec.hide, ms);
}

export function toast(msg, type = 'info', duration = 3000) {
  const container = toastContainer();
  if (!container) return;

  const kind = type === 'ok' || type === 'err' ? type : 'info';
  const text = String(msg == null ? '' : msg);
  const key = `${kind}|${text}`;

  // Same message fired again while it's still up → bump a counter, don't stack.
  if (last && last.key === key && last.el.isConnected) {
    last.count += 1;
    last.badge.textContent = `×${last.count}`;
    last.badge.hidden = false;
    last.el.classList.remove('bump');
    void last.el.offsetWidth; // restart the nudge
    last.el.classList.add('bump');
    scheduleHide(last, duration);
    return;
  }

  const el = document.createElement('div');
  el.className = `toast-item ${kind}`;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  el.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${ICONS[kind]}</span>
    <span class="toast-msg"></span>
    <span class="toast-badge" hidden></span>`;
  el.querySelector('.toast-msg').textContent = text;
  container.appendChild(el);
  // next frame so the enter transition runs from the start state
  requestAnimationFrame(() => el.classList.add('in'));

  const rec = { key, el, count: 1, badge: el.querySelector('.toast-badge'), timer: null };
  rec.hide = () => {
    clearTimeout(rec.timer);
    if (!el.isConnected) return;
    el.classList.remove('in');
    el.classList.add('out');
    const drop = () => el.remove();
    el.addEventListener('transitionend', drop, { once: true });
    setTimeout(drop, 320);
    if (last === rec) last = null;
  };

  el.addEventListener('click', rec.hide);
  scheduleHide(rec, duration);
  last = rec;

  // Cap the stack — quietly retire the oldest.
  const items = container.querySelectorAll('.toast-item:not(.out)');
  for (let i = 0; i < items.length - MAX_VISIBLE; i++) {
    items[i].classList.remove('in');
    items[i].classList.add('out');
    const stale = items[i];
    stale.addEventListener('transitionend', () => stale.remove(), { once: true });
    setTimeout(() => stale.remove(), 320);
  }
}

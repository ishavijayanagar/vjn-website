/**
 * Pull-down to refresh on the main scroll container (.app-main).
 */
export function initPullToRefresh({ onRefresh }) {
  const scroller = document.getElementById('app-main');
  if (!scroller || typeof onRefresh !== 'function') return;

  let indicator = document.getElementById('pull-refresh');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'pull-refresh';
    indicator.className = 'pull-refresh';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.innerHTML = '<span class="pull-refresh-spinner"></span><span class="pull-refresh-label">Pull to refresh</span>';
    scroller.prepend(indicator);
  }

  const THRESHOLD = 72;
  const MAX_PULL = 110;
  let startY = 0;
  let pulling = false;
  let refreshing = false;
  let pull = 0;

  const setPull = (px) => {
    pull = Math.max(0, Math.min(MAX_PULL, px));
    indicator.style.height = `${pull}px`;
    indicator.classList.toggle('ready', pull >= THRESHOLD);
    indicator.querySelector('.pull-refresh-label').textContent =
      pull >= THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
  };

  const reset = () => {
    pulling = false;
    pull = 0;
    indicator.classList.remove('ready', 'refreshing');
    indicator.style.height = '0px';
    indicator.querySelector('.pull-refresh-label').textContent = 'Pull to refresh';
  };

  scroller.addEventListener(
    'touchstart',
    (e) => {
      if (refreshing) return;
      if (scroller.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      pulling = true;
    },
    { passive: true },
  );

  scroller.addEventListener(
    'touchmove',
    (e) => {
      if (!pulling || refreshing) return;
      if (scroller.scrollTop > 0) {
        reset();
        return;
      }
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      // Resist the pull so it feels weighted
      setPull(dy * 0.45);
      if (pull > 8 && e.cancelable) e.preventDefault();
    },
    { passive: false },
  );

  scroller.addEventListener(
    'touchend',
    async () => {
      if (!pulling || refreshing) return;
      if (pull < THRESHOLD) {
        reset();
        return;
      }

      refreshing = true;
      pulling = false;
      indicator.classList.add('refreshing');
      indicator.style.height = '56px';
      indicator.querySelector('.pull-refresh-label').textContent = 'Refreshing…';

      try {
        await onRefresh();
      } finally {
        refreshing = false;
        reset();
      }
    },
    { passive: true },
  );
}

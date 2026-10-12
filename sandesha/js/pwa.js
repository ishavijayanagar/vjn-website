/**
 * PWA install prompt + service worker registration.
 * Chromium: uses beforeinstallprompt.
 * iOS Safari: shows Add to Home Screen instructions.
 */

const DISMISS_KEY = 'sandesha_pwa_dismiss';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

let deferredPrompt = null;
let bannerEl = null;

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function wasDismissed() {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const t = Number(raw);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < DISMISS_MS;
}

function dismiss() {
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
  hideBanner();
}

function hideBanner() {
  bannerEl?.classList.add('hidden');
}

function showBanner(mode) {
  if (!bannerEl || isStandalone() || wasDismissed()) return;
  bannerEl.dataset.mode = mode;
  const title = bannerEl.querySelector('[data-pwa-title]');
  const body = bannerEl.querySelector('[data-pwa-body]');
  const installBtn = bannerEl.querySelector('[data-pwa-install]');
  if (mode === 'ios') {
    if (title) title.textContent = 'Install Sandesha';
    if (body) {
      body.textContent = 'On iPhone/iPad: tap Share in Safari, then “Add to Home Screen”.';
    }
    if (installBtn) installBtn.classList.add('hidden');
  } else {
    if (title) title.textContent = 'Install Sandesha';
    if (body) body.textContent = 'Add to your home screen for faster access and a full-screen app.';
    if (installBtn) installBtn.classList.remove('hidden');
  }
  bannerEl.classList.remove('hidden');
}

async function triggerInstall() {
  if (!deferredPrompt) {
    showBanner(isIos() ? 'ios' : 'manual');
    return false;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  hideBanner();
  if (outcome === 'accepted') dismiss();
  return outcome === 'accepted';
}

export function canPromptInstall() {
  return !isStandalone();
}

export async function promptInstall() {
  if (isStandalone()) return false;
  if (deferredPrompt) return triggerInstall();
  if (isIos()) {
    showBanner('ios');
    return false;
  }
  // Chromium may not have fired beforeinstallprompt yet — still show guidance
  showBanner(deferredPrompt ? 'chromium' : 'manual');
  const body = bannerEl?.querySelector('[data-pwa-body]');
  const installBtn = bannerEl?.querySelector('[data-pwa-install]');
  if (!deferredPrompt && body) {
    body.textContent = 'Use your browser menu → “Install app” or “Add to Home screen”.';
    installBtn?.classList.add('hidden');
  }
  return false;
}

export function initPwa() {
  bannerEl = document.getElementById('pwa-install');
  if (!bannerEl) return;

  bannerEl.querySelector('[data-pwa-install]')?.addEventListener('click', () => {
    triggerInstall();
  });
  bannerEl.querySelector('[data-pwa-dismiss]')?.addEventListener('click', () => {
    dismiss();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showBanner('chromium');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    dismiss();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then((reg) => reg.update())
      .catch((err) => {
        console.warn('[pwa] SW register failed', err);
      });
  }

  // iOS has no beforeinstallprompt — prompt after a short delay if browser tab
  if (!isStandalone() && isIos() && !wasDismissed()) {
    setTimeout(() => showBanner('ios'), 1800);
  }
}

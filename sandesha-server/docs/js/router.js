const headerTitle = document.getElementById('header-title');
const backBtn = document.getElementById('header-back');
const headerSend = document.getElementById('header-send');
const bottomNav = document.getElementById('bottom-nav');

const TABS = ['schedule', 'settings'];
let currentTab = 'schedule';
const subStack = [];
let onTabChange = null;
let onSubPop = null;
let onInstantSend = null;

export function initRouter({ onTab, onSubBack, onSend }) {
  onTabChange = onTab;
  onSubPop = onSubBack;
  onInstantSend = onSend;

  bottomNav?.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.tab));
  });

  backBtn?.addEventListener('click', popSub);
  headerSend?.addEventListener('click', () => {
    if (onInstantSend) onInstantSend();
  });
}

export function getCurrentTab() {
  return currentTab;
}

export function navigate(tab) {
  if (!TABS.includes(tab)) return;
  subStack.length = 0;
  currentTab = tab;
  updateUI();
  if (onTabChange) onTabChange(tab);
}

export function pushSub(id, title) {
  subStack.push({ id, title });
  updateUI();
}

export function popSub() {
  if (subStack.length === 0) return;
  subStack.pop();
  updateUI();
  if (onSubPop) onSubPop(subStack.length ? subStack[subStack.length - 1].id : null);
}

export function getSubPage() {
  return subStack.length ? subStack[subStack.length - 1].id : null;
}

export function isSubPage() {
  return subStack.length > 0;
}

function updateUI() {
  const inSub = subStack.length > 0;
  const sub = inSub ? subStack[subStack.length - 1] : null;
  const showInstantSend = !inSub && currentTab === 'schedule';

  if (headerTitle) {
    headerTitle.textContent = inSub ? sub.title : tabTitle(currentTab);
  }
  if (backBtn) backBtn.classList.toggle('hidden', !inSub);
  if (headerSend) headerSend.classList.toggle('hidden', !showInstantSend);
  if (bottomNav) bottomNav.classList.toggle('hidden', inSub);

  bottomNav?.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', !inSub && btn.dataset.tab === currentTab);
  });

  document.querySelectorAll('.page-panel').forEach((panel) => {
    const tab = panel.dataset.tab;
    panel.classList.toggle('active', !inSub && tab === currentTab);
  });

  document.querySelectorAll('.sub-page').forEach((page) => {
    page.classList.toggle('active', inSub && page.dataset.sub === sub?.id);
  });
}

function tabTitle(tab) {
  const titles = {
    schedule: 'Schedule',
    settings: 'Settings',
  };
  return titles[tab] || 'Sandesha';
}

export function showPanelLoading(container, count = 3) {
  if (!container) return;
  container.innerHTML = Array(count).fill('<div class="skeleton"></div>').join('');
}

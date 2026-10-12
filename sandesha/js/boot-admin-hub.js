/**
 * Sandesha server URL on admin.html hub (gear icon, like promotions page).
 */
import { renderApiSettings } from './api-settings.js';

function $(id) {
  return document.getElementById(id);
}

function canConfigureSandesha() {
  const role = document.body.getAttribute('data-role') || '';
  return role === 'admin';
}

function updateGearVisibility() {
  const btn = $('sandeshaServerBtn');
  if (!btn) return;
  const show = canConfigureSandesha() && $('adminApp') && !$('adminApp').classList.contains('hidden');
  btn.hidden = !show;
  if (!show) setSandeshaPanelOpen(false);
}

let panelOpen = false;

function hubBits() {
  return {
    cards: $('hubStats'),
    lead: $('hubLead'),
    back: document.querySelector('.admin-hub-back'),
    note: $('hubStatsNote'),
    barHub: $('adminBarHub'),
  };
}

function setSandeshaPanelOpen(open) {
  panelOpen = !!open && canConfigureSandesha();
  const panel = $('adminSandeshaPanel');
  const btn = $('sandeshaServerBtn');
  const bits = hubBits();
  const onHub = $('adminApp')?.classList.contains('is-hub');

  panel?.classList.toggle('is-active', panelOpen);
  btn?.classList.toggle('on', panelOpen);
  btn?.setAttribute('aria-pressed', panelOpen ? 'true' : 'false');

  if (!onHub || !panelOpen) {
    bits.cards?.classList.remove('hidden');
    bits.lead?.classList.remove('hidden');
    bits.back?.classList.remove('hidden');
    if (bits.note) bits.note.hidden = !bits.note.textContent;
    if (bits.barHub) bits.barHub.classList.remove('hidden');
    if (!panelOpen && onHub) setAdminHubTitle(false);
    return;
  }

  bits.cards?.classList.add('hidden');
  bits.lead?.classList.add('hidden');
  bits.back?.classList.add('hidden');
  if (bits.note) bits.note.hidden = true;
  if (bits.barHub) bits.barHub.classList.add('hidden');
  setAdminHubTitle(true);

  if (panel) {
    renderApiSettings(panel, {
      onSaved: () => {
        window.dispatchEvent(new CustomEvent('sandesha:api-changed'));
      },
    });
  }
}

function setAdminHubTitle(sandeshaOpen) {
  const title = $('adminPageTitle');
  if (!title) return;
  if (sandeshaOpen) {
    title.textContent = 'Sandesha server';
    document.title = 'Sandesha server – Isha Place, Vijayanagar';
  } else {
    title.textContent = 'Team';
    document.title = 'Team – Isha Place, Vijayanagar';
  }
}

function bind() {
  $('sandeshaServerBtn')?.addEventListener('click', () => {
    if (!canConfigureSandesha()) return;
    setSandeshaPanelOpen(!panelOpen);
  });

  const app = $('adminApp');
  if (app) {
    const appObs = new MutationObserver(() => {
      if (!app.classList.contains('is-hub') && panelOpen) {
        setSandeshaPanelOpen(false);
      }
      updateGearVisibility();
    });
    appObs.observe(app, { attributes: true, attributeFilter: ['class'] });
  }

  const roleObs = new MutationObserver(updateGearVisibility);
  roleObs.observe(document.body, { attributes: true, attributeFilter: ['data-role'] });

  document.addEventListener('DOMContentLoaded', updateGearVisibility);
  window.addEventListener('vjn:admin-hub-show', () => setSandeshaPanelOpen(false));
  updateGearVisibility();
}

bind();

export { setSandeshaPanelOpen };

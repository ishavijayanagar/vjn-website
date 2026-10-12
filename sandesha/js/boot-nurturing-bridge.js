/**
 * Narrow Sandesha bridge for admin.html — the Nurturing event-volunteer flow,
 * plus push-subscription only for Programs (program-starting-soon reminders).
 *
 * admin.js is a classic script, so this ES module exposes a tiny surface on
 * `window.VjnVol`: list WhatsApp groups, fire ONE add-members job, poll it, and
 * manage the push subscription. Nothing else in Sandesha is reachable from here.
 * Programs never calls listGroups/addToGroup (no UI path to them) — it only
 * uses the push methods.
 */
import { ensureSandeshaAuth, getVjnToken } from './auth-bridge.js';
import { api } from './api.js';
import {
  syncOnLoad as syncPush,
  enable as pushEnable,
  disable as pushDisable,
  state as pushState,
  supported as pushSupported,
} from './push.js';

let resolveReady;
const ready = new Promise((r) => { resolveReady = r; });
let authed = false;
let booting = false;

async function boot() {
  if (authed || booting) return;
  const role = document.body.getAttribute('data-role') || '';
  if (role !== 'nurturing' && role !== 'admin' && role !== 'programs') return;
  if (!getVjnToken()) return;
  booting = true;
  try {
    await ensureSandeshaAuth();
    authed = true;
    syncPush().catch(() => {});
    resolveReady(true);
  } catch (err) {
    console.warn('[vjn-vol] Sandesha auth failed', err);
    resolveReady(false);
  } finally {
    booting = false;
  }
}

window.VjnVol = {
  ready,
  isReady: () => authed,

  async listGroups() {
    const data = await api('/groups');
    const rows = Array.isArray(data) ? data : (data && data.groups) || [];
    return rows
      .map((g) => ({ jid: g.jid || (g.id && g.id._serialized) || g.id, name: g.name || g.jid, participants: g.participants }))
      .filter((g) => g.jid);
  },

  /** @returns {Promise<string>} jobId */
  async addToGroup(groupJid, numbers) {
    const res = await api('/volunteers/add-to-group', {
      method: 'POST',
      body: JSON.stringify({ groupJid, numbers }),
    });
    return res.jobId;
  },

  pollJob(jobId) {
    return api(`/volunteers/job/${encodeURIComponent(jobId)}`);
  },

  pushSupported,
  pushState,
  enablePush: pushEnable,
  disablePush: pushDisable,
};

if (document.body.getAttribute('data-role')) boot();
new MutationObserver(boot).observe(document.body, {
  attributes: true,
  attributeFilter: ['data-role'],
});

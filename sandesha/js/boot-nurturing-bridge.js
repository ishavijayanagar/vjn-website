/**
 * Narrow Sandesha bridge for admin.html — the Nurturing event-volunteer flow,
 * plus push-subscription only for Programs (program-starting-soon reminders).
 *
 * admin.js is a classic script, so this ES module exposes a tiny surface on
 * `window.VjnVol`: list WhatsApp groups, fire ONE add-members job, poll it, and
 * manage the push subscription. Nothing else in Sandesha is reachable from here.
 * Programs never calls listGroups/addToGroup (no UI path to them) — it only
 * uses the push methods. Admin also reads the activity log (Settings →
 * Sandesha activities); the server refuses /activity for every other role.
 */
import { ensureSandeshaAuth, getVjnToken } from './auth-bridge.js';
import { api as rawApi, setToken, runWithoutAuthRedirect } from './api.js';

/**
 * Sandesha forgets logins when its session store is reset (e.g. a restart
 * after the file was cleared). Rather than surface "Unauthorized", get a fresh
 * session from the VJN login once and retry the call.
 */
async function api(path, options) {
  try {
    return await runWithoutAuthRedirect(() => rawApi(path, options));
  } catch (err) {
    if (!/unauthori[sz]ed/i.test(String(err && err.message))) throw err;
    setToken('');
    await ensureSandeshaAuth();
    return rawApi(path, options);
  }
}
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

  /** One WhatsApp message to one person (10-digit Indian number), sent from
   *  the Sandesha number. Logged in the activity feed under the sender. */
  async sendMessage(digits, message) {
    return api('/send', {
      method: 'POST',
      body: JSON.stringify({ recipient: `+91${String(digits).replace(/\D/g, '').slice(-10)}`, message }),
    });
  },

  /** One message to many people as a paced background job.
   *  recipients: [{ number, name }]; "{name}" → each first name.
   *  @returns {Promise<{jobId: string, total: number}>} */
  bulkMessage(recipients, message) {
    return api('/messages/bulk', { method: 'POST', body: JSON.stringify({ recipients, message }) });
  },

  pollMessageJob(jobId) {
    return api(`/messages/job/${encodeURIComponent(jobId)}`);
  },

  cancelMessageJob(jobId) {
    return api(`/messages/job/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  },

  /** Admin only: every team's Sandesha activity, newest first. */
  async listActivity(limit = 500) {
    const data = await api(`/activity?limit=${limit}`);
    return Array.isArray(data?.activity) ? data.activity : [];
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

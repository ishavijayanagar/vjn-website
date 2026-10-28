/**
 * Bridge between the promotions board and Sandesha.
 *
 * admin-promotions.js is a classic script and cannot import these modules, so
 * the few things the board needs — pick an audience, hand a scheduled post to
 * Sandesha, take it back — are hung on window.SandeshaPromo.
 *
 * A board post that is scheduled becomes one Sandesha schedule row per list.
 * Sandesha owns the clock and the sending; the sheet stays the record of what
 * the centre meant to post, and learns the send happened on the next load.
 */
import { api, uploadFile, getApiBase } from './api.js';
import { ensureSandeshaAuth } from './auth-bridge.js';
import { toast } from './toast.js';
import { getState, getTargetOptions } from './store.js';
import { openAudienceSheet, audienceSummary, audienceTotal } from './promo-audience.js';
import { scheduleTargets } from './pages/promo-compose.js';
import { bootPromotionsMessaging, refreshMessagingData } from './boot-promotions.js';

const DEFAULT_TARGET_KEY = 'promo_default_audience';

/** Upload one flyer per scheduled post and let every row share the file. */
async function uploadFlyer(blob, filename) {
  if (!blob) return '';
  const file = blob instanceof File
    ? blob
    : new File([blob], filename || 'flyer.jpg', { type: blob.type || 'image/jpeg' });
  const up = await uploadFile(file);
  if (!up?.filePath) throw new Error('Sandesha did not accept the flyer');
  return up.filePath;
}

function readDefaultTargets() {
  try {
    const raw = localStorage.getItem(DEFAULT_TARGET_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberDefaultTargets(targets) {
  try {
    if (targets?.length) localStorage.setItem(DEFAULT_TARGET_KEY, JSON.stringify(targets));
  } catch { /* ignore */ }
}

/**
 * Drop lists that no longer exist on this WhatsApp account, so a stale sheet
 * value cannot silently schedule to nothing.
 */
function stillReal(targets) {
  // Until the groups have loaded nothing can be checked — keep what was saved
  // rather than dropping every group from the audience.
  if (!getState().groupsLoaded) return targets || [];
  const options = getTargetOptions();
  const known = new Set(options.map((o) => String(o.value).toLowerCase()));
  return (targets || []).filter((t) => t && known.has(String(t.value).toLowerCase()));
}

const SandeshaPromo = {
  /**
   * Sign in to Sandesha. The groups and sets load in the background: cancelling
   * a queued row, handing over a job or polling one needs none of them, and
   * /groups can take minutes on the Pi — nothing should wait behind it.
   */
  async ready() {
    await ensureSandeshaAuth();
    bootPromotionsMessaging().catch(() => {});
    return true;
  },

  async refresh() {
    await refreshMessagingData({ full: true });
  },

  apiBase() {
    return getApiBase();
  },

  parse(raw) {
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(String(raw || '') || 'null');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  stringify(targets) {
    return targets?.length ? JSON.stringify(targets) : '';
  },

  /** Saved audience, falling back to whatever was last scheduled. */
  resolveTargets(raw) {
    const saved = stillReal(this.parse(raw));
    if (saved.length) return saved;
    return stillReal(readDefaultTargets());
  },

  summary(targets) {
    return audienceSummary(targets || []);
  },

  reach(targets) {
    return audienceTotal(targets || []);
  },

  pick(preselected) {
    if (!getState().groupsLoaded) toast('Groups are still loading — they will appear in the list in a moment', 'ok');
    return new Promise((resolve) => {
      openAudienceSheet(getTargetOptions(), preselected || [], (picked) => {
        rememberDefaultTargets(picked);
        resolve(picked);
      });
    });
  },

  /**
   * Hand a board post to Sandesha, as one queued row per list.
   *
   * Rows the post held before are deliberately NOT dropped here — the caller
   * cancels them only once the sheet has committed the new ids. Cancelling
   * first would, on a failed save, leave the sheet pointing at rows that no
   * longer exist, which reads exactly like "already delivered".
   * @returns {Promise<string[]>} the new Sandesha schedule ids
   */
  async schedule({ promoId, message, runAtIso, targets, flyer }) {
    await this.ready();
    const rows = scheduleTargets(targets || []);
    if (!rows.length) throw new Error('Choose at least one audience');

    const filePath = flyer ? await uploadFlyer(flyer.blob, flyer.filename) : '';
    const ids = [];
    try {
      for (const row of rows) {
        const res = await api('/schedules', {
          method: 'POST',
          body: JSON.stringify({
            message: message || '',
            runAt: runAtIso,
            target: row.target,
            isSet: row.isSet,
            filePath,
            sourceId: promoId ? String(promoId) : '',
          }),
        });
        if (res?.schedule?.id != null) ids.push(String(res.schedule.id));
      }
    } catch (err) {
      // Never leave half a post queued — the board would show one time and
      // WhatsApp would fire a subset of the lists.
      await this.cancel(ids);
      throw err;
    }
    return ids;
  },

  /**
   * Hand the whole schedule over to Sandesha in one request, so it finishes
   * even if the phone switches apps. Resolves once the server has the job —
   * not when it is done; poll jobs() for that.
   * Rejects with err.unsupported on a server that predates /promo-jobs.
   */
  async startJob({ promoId, title, message, runAtIso, targets, flyer, previousIds, sheet }) {
    await this.ready();
    const rows = runAtIso ? scheduleTargets(targets || []) : [];
    if (runAtIso && !rows.length) throw new Error('Choose at least one audience');
    try {
      const res = await api('/promo-jobs', {
        method: 'POST',
        body: JSON.stringify({
          promoId: String(promoId),
          title: title || '',
          message: message || '',
          runAt: runAtIso || '',
          rows,
          flyer,
          previousIds: previousIds || [],
          sheet,
        }),
      });
      return res.job;
    } catch (err) {
      if (/^(Not found|HTTP 404)$/i.test(err.message)) err.unsupported = true;
      throw err;
    }
  },

  async jobs() {
    const data = await api('/promo-jobs');
    return Array.isArray(data?.jobs) ? data.jobs : [];
  },

  async dismissJob(id) {
    await api(`/promo-jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** Best-effort: a row already fired or already gone is not an error. */
  async cancel(ids) {
    const list = Array.isArray(ids) ? ids : this.parse(ids);
    for (const id of list) {
      const key = String(id).trim();
      if (!key) continue;
      try {
        await api(`/schedules/${encodeURIComponent(key)}`, { method: 'DELETE' });
      } catch { /* already sent or cancelled */ }
    }
  },

  /** Ids Sandesha is still holding — anything missing has already gone out. */
  async liveSchedules() {
    const data = await api('/schedules');
    const rows = data?.schedules || data || [];
    return Array.isArray(rows) ? rows : [];
  },

  async liveIds() {
    const rows = await this.liveSchedules();
    return new Set(rows.map((s) => String(s.id)));
  },

  /**
   * Board posts Sandesha has actually delivered.
   *
   * A sent row leaves schedules.json, so its absence used to be the only hint
   * that it went out — which reads identically to a row that was cancelled, or
   * to a post whose schedule ids were never recorded. This is the server's own
   * record of the send, so the board is told instead of guessing.
   */
  async deliveredSources() {
    const data = await api('/schedules/delivered');
    const rows = data?.delivered || [];
    return new Set(
      (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.sourceId)
        .map((r) => String(r.sourceId)),
    );
  },

  /** True once WhatsApp is linked, so the board can warn before scheduling. */
  isLinked() {
    const health = getState().health;
    return !!health?.whatsapp?.connected;
  },
};

window.SandeshaPromo = SandeshaPromo;
window.dispatchEvent(new CustomEvent('sandesha:promo-relay-ready'));

export default SandeshaPromo;

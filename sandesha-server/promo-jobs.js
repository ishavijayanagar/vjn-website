'use strict';

/**
 * Scheduling, run here instead of in the browser.
 *
 * Three kinds of job. A Board post (default) also saves its slot to the sheet/DB.
 * A "queue" job (the Send tab's Schedule) just creates the schedule rows and
 * drops the ones it replaces; the attachment is already uploaded by then.
 * A "send" job (the Send tab's Send now) delivers to each audience in turn with
 * the safety gap between chats, so it keeps going if the phone sleeps.
 *
 * Scheduling a board post is several slow steps — fetch the flyer, queue one
 * row per list, write the slot back to the sheet, drop the rows it replaced.
 * Run from the page, a phone that switches apps halfway leaves the post in
 * neither place. The page hands the whole job over in one request and returns
 * at once; the job finishes here whatever the phone does, and its outcome is
 * kept so the board can show it — or its failure — the next time it looks.
 */

const fs = require('fs');
const path = require('path');
const { localFile } = require('./site-media');

const KEEP_MS = 48 * 60 * 60 * 1000;
const APPS_SCRIPT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

function createPromoJobs(deps) {
  const {
    file,
    MEDIA_DIR,
    createSchedule,
    cancelSchedule,
    // (target, { message, filePath }, actor) → delivers to one audience (a set fans out inside).
    sendTo = null,
    // Pause between audiences; the server's own safety spacing.
    sendGap = async () => {},
    // (token, fields) → saves the post in this server's own database. Used
    // instead of the Sheet when the person signed in on the Pi.
    savePromoLocal = null,
    // (flyer) → public URL of a photo stored on this Pi, or '' to keep using Drive.
    saveSiteImage = null,
    fetchImpl = (...args) => fetch(...args),
    log = () => {},
    now = () => Date.now(),
  } = deps;

  let jobs = load();

  function load() {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(list)) return [];
      // A job that was running when the server stopped never finished, and
      // nothing will pick it back up — say so rather than spin forever.
      return list.map((j) => (j.status === 'running'
        ? { ...j, status: 'failed', error: 'Sandesha restarted before this finished — schedule it again.' }
        : j));
    } catch {
      return [];
    }
  }

  function save() {
    const cutoff = now() - KEEP_MS;
    jobs = jobs.filter((j) => Date.parse(j.updatedAt) >= cutoff);
    try {
      fs.writeFileSync(file, JSON.stringify(jobs, null, 2));
    } catch (err) {
      log(`[promo-jobs] could not save: ${err.message}`);
    }
  }

  function update(job, fields) {
    Object.assign(job, fields, { updatedAt: new Date(now()).toISOString() });
    save();
  }

  function list() {
    return jobs.slice();
  }

  function dismiss(id) {
    const before = jobs.length;
    jobs = jobs.filter((j) => j.id !== String(id) || j.status === 'running');
    if (jobs.length !== before) save();
  }

  /**
   * Validate and start a job. Throws on bad input (nothing started).
   * @returns the job record, already 'running'
   */
  function start(input, actor) {
    if (input && input.kind === 'queue') return startQueue(input, actor);
    if (input && input.kind === 'send') return startSend(input, actor);
    const promoId = String(input.promoId || '').trim();
    if (!promoId) throw new Error('promoId required');
    const sheet = input.sheet || {};
    if (!APPS_SCRIPT_RE.test(String(sheet.url || ''))) throw new Error('sheet.url must be the Apps Script web app');
    if (!sheet.token) throw new Error('sheet.token required');
    const rows = Array.isArray(input.rows) ? input.rows.filter((r) => r && r.target) : [];
    const runAt = input.runAt ? new Date(input.runAt) : null;
    if (runAt && Number.isNaN(runAt.getTime())) throw new Error('Invalid runAt');
    if (runAt && !rows.length) throw new Error('Choose at least one audience');
    if (jobs.some((j) => j.promoId === promoId && j.status === 'running')) {
      throw new Error('Still saving the last change to this post — one moment.');
    }

    const job = {
      id: `pj-${now()}-${Math.random().toString(36).slice(2, 7)}`,
      promoId,
      title: String(input.title || '').slice(0, 200),
      sendAt: String((sheet.fields && sheet.fields.send_at) || ''),
      status: 'running',
      step: 'starting',
      error: '',
      ids: [],
      createdAt: new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
      createdBy: actor ? { role: actor.role, name: actor.name } : null,
    };
    jobs.push(job);
    save();
    job.done = run(job, { ...input, rows, runAt }, actor).catch(() => {});
    return job;
  }

  /** The Send tab's Schedule: one row per list, replacing rows the message held before. */
  function startQueue(input, actor) {
    const rows = Array.isArray(input.rows) ? input.rows.filter((r) => r && r.target) : [];
    if (!rows.length) throw new Error('Choose at least one audience');
    const runAt = input.runAt ? new Date(input.runAt) : null;
    if (!runAt || Number.isNaN(runAt.getTime())) throw new Error('Invalid runAt');
    if (!String(input.message || '').trim() && !input.filePath) throw new Error('Write a message or attach something');

    const job = {
      id: `pj-${now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: 'queue',
      promoId: `queue-${now()}`,
      title: String(input.title || '').slice(0, 200),
      sendAt: runAt.toISOString(),
      status: 'running',
      step: 'queue',
      error: '',
      ids: [],
      createdAt: new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
      createdBy: actor ? { role: actor.role, name: actor.name } : null,
    };
    jobs.push(job);
    save();
    job.done = runQueue(job, { ...input, rows, runAt }, actor).catch(() => {});
    return job;
  }

  /** The Send tab's Send now: each audience in turn, spaced like the scheduler does. */
  function startSend(input, actor) {
    if (!sendTo) throw new Error('This Sandesha cannot send from a job');
    const recipients = Array.isArray(input.recipients) ? input.recipients.filter((r) => r && r.target) : [];
    if (!recipients.length) throw new Error('Choose at least one audience');
    if (!String(input.message || '').trim() && !input.filePath) throw new Error('Write a message or attach something');

    const job = {
      id: `pj-${now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: 'send',
      promoId: `send-${now()}`,
      title: String(input.title || '').slice(0, 200),
      sendAt: '',
      status: 'running',
      step: 'send',
      error: '',
      ids: [],
      total: recipients.length,
      sent: 0,
      failed: 0,
      createdAt: new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
      createdBy: actor ? { role: actor.role, name: actor.name } : null,
    };
    jobs.push(job);
    save();
    job.done = runSend(job, { ...input, recipients }, actor).catch(() => {});
    return job;
  }

  async function runSend(job, input, actor) {
    const previousIds = (input.previousIds || []).map(String);
    let firstError = '';
    for (let i = 0; i < input.recipients.length; i++) {
      update(job, { step: `send ${i + 1}/${input.recipients.length}` });
      try {
        await sendTo(input.recipients[i].target, { message: input.message, filePath: input.filePath || '' }, actor);
        job.sent += 1;
      } catch (err) {
        job.failed += 1;
        if (!firstError) firstError = err.message || 'Send failed';
        log(`[promo-jobs] ${job.id} → ${input.recipients[i].target}: ${firstError}`);
      }
      update(job, {});
      if (i < input.recipients.length - 1) {
        try { await sendGap(); } catch { /* a gap that fails must not stop the rest */ }
      }
    }
    // Sending it now supersedes whatever was queued for this message.
    if (job.sent > 0) for (const id of previousIds) await cancelQuietly(id, actor);
    update(job, {
      status: job.sent > 0 ? 'done' : 'failed',
      step: 'done',
      error: job.failed ? `${job.failed} of ${job.total} failed: ${firstError}` : '',
    });
  }

  async function runQueue(job, input, actor) {
    const previousIds = (input.previousIds || []).map(String);
    const newIds = [];
    try {
      for (const row of input.rows) {
        const schedule = await createSchedule({
          message: input.message,
          runAt: input.runAt.toISOString(),
          target: row.target,
          isSet: !!row.isSet,
          filePath: input.filePath || '',
        }, actor);
        newIds.push(String(schedule.id));
        update(job, { step: `queue ${newIds.length}/${input.rows.length}` });
      }
      // Only once the replacements exist, so a failure cannot leave the message unqueued.
      for (const id of previousIds.filter((p) => !newIds.includes(p))) await cancelQuietly(id, actor);
      update(job, { status: 'done', step: 'done', ids: newIds });
    } catch (err) {
      // The upload is left on the server, so the page can offer the same message again.
      for (const id of newIds.filter((n) => !previousIds.includes(n))) await cancelQuietly(id, actor);
      log(`[promo-jobs] ${job.id} failed: ${err.message}`);
      update(job, { status: 'failed', error: err.message || 'Something went wrong' });
    }
  }

  async function run(job, input, actor) {
    const { sheet } = input;
    const previousIds = (input.previousIds || []).map(String);
    let newIds = [];
    let mediaPath = '';
    try {
      const flyer = input.flyer || null;
      const payload = { ...sheet.fields, formType: 'adminSavePromotion', token: sheet.token, id: job.promoId };

      if (flyer && flyer.base64) {
        update(job, { step: 'flyer' });
        mediaPath = writeMedia(Buffer.from(flyer.base64, 'base64'), flyer.mimeType);
        let url = '';
        if (saveSiteImage) {
          try { url = await saveSiteImage(flyer) || ''; } catch { url = ''; }
        }
        if (!url) {
          // No Pi address for the photo — keep it on Drive, as before.
          const up = await appsScript(sheet.url, {
            formType: 'adminUploadImage',
            token: sheet.token,
            base64: flyer.base64,
            mimeType: flyer.mimeType,
            filename: flyer.filename,
          });
          if (!up.url) throw new Error('Image upload failed.');
          url = up.url;
        }
        payload.flyer_url = url;
      } else if (flyer && flyer.url && input.runAt) {
        update(job, { step: 'flyer' });
        mediaPath = await downloadFlyer(sheet, flyer.url);
      }

      if (input.runAt) {
        update(job, { step: 'queue' });
        for (const row of input.rows) {
          const schedule = await createSchedule({
            message: input.message,
            runAt: input.runAt.toISOString(),
            target: row.target,
            isSet: !!row.isSet,
            filePath: mediaPath,
            sourceId: job.promoId,
          }, actor);
          newIds.push(String(schedule.id));
        }
        payload.wa_schedule_ids = newIds;
      }

      update(job, { step: 'sheet' });
      if (savePromoLocal && String(sheet.token).startsWith('v1.')) await savePromoLocal(sheet.token, payload);
      else await appsScript(sheet.url, payload);

      // Committed — only now drop the rows the sheet no longer refers to.
      // A re-save inside the dedupe window hands back the row already queued,
      // so never cancel one that is also in the new set.
      for (const id of previousIds.filter((p) => !newIds.includes(p))) await cancelQuietly(id, actor);
      update(job, { status: 'done', step: 'done', ids: newIds });
    } catch (err) {
      // The sheet never learned about these rows, so nothing else would
      // cancel them — leave WhatsApp holding no orphan post.
      for (const id of newIds.filter((n) => !previousIds.includes(n))) await cancelQuietly(id, actor);
      if (mediaPath && !newIds.length) {
        try { fs.unlinkSync(mediaPath); } catch { /* already gone */ }
      }
      log(`[promo-jobs] ${job.id} failed: ${err.message}`);
      update(job, { status: 'failed', error: err.message || 'Something went wrong' });
    }
  }

  async function cancelQuietly(id, actor) {
    try { await cancelSchedule(id, actor); } catch { /* already sent or gone */ }
  }

  function writeMedia(buffer, mimeType) {
    if (!buffer.length) throw new Error('The flyer was empty.');
    const ext = MIME_EXT[String(mimeType || '').toLowerCase()] || '.jpg';
    const abs = path.join(MEDIA_DIR, `upload_${now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);
    fs.writeFileSync(abs, buffer);
    return abs;
  }

  /** A photo stored here is read from disk. Drive flyers come through Apps Script; anything else is fetched as-is. */
  async function downloadFlyer(sheet, url) {
    const local = localFile(url);
    if (local) return writeMedia(fs.readFileSync(local.abs), local.mime);
    try {
      const data = await appsScript(sheet.url, { formType: 'adminGetImage', token: sheet.token, url });
      if (data.base64) return writeMedia(Buffer.from(data.base64, 'base64'), data.mimeType);
    } catch { /* not a Drive file — try it directly */ }
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Could not download flyer (HTTP ${res.status})`);
    const type = String(res.headers.get('content-type') || '').split(';')[0];
    if (!/^image\//.test(type)) throw new Error('Could not download flyer.');
    return writeMedia(Buffer.from(await res.arrayBuffer()), type);
  }

  async function appsScript(url, payload) {
    const res = await fetchImpl(url, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow' });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Could not read the sheet response.');
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  return { start, list, dismiss };
}

module.exports = { createPromoJobs };

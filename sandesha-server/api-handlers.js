'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { parsePhoneNumbers } = require('./bulk-send');
const { addParticipantsFixed, sendGroupInviteLink, getGroupInviteLink } = require('./add-participants');
const crypto = require('crypto');
const safety = require('./send-safety');
const activity = require('./activity');
const push = require('./push');
const auth = require('./auth');
const { isWhatsAppSessionError } = require('./wa-session');

const GROUPS_CACHE_TTL_MS = 5 * 60 * 1000;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
// The hourly send cap is 30, so a bigger list would just stop part-way.
const BULK_MESSAGE_MAX = 30;
// Fill-in fields a bulk message can use, e.g. "Namaskaram {name}, see you in {area}".
const MESSAGE_FIELDS = ['name', 'fullname', 'area', 'program', 'ie'];
const MESSAGE_FIELD_RE = /\{(name|fullname|area|program|ie)\}/gi;

function cleanMessageFields(fields) {
  const out = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const key of MESSAGE_FIELDS) {
    if (fields[key] != null) out[key] = String(fields[key]).trim().slice(0, 120);
  }
  return out;
}

/**
 * Swap each {field} for this recipient's value. A missing value leaves no
 * trace: "Namaskaram {name}," with no name reads "Namaskaram,".
 */
function fillMessageFields(message, recipient) {
  const fullname = String(recipient.name || '').trim();
  const values = {
    ...recipient.fields,
    fullname,
    name: fullname.split(/\s+/)[0] || '',
  };
  return String(message)
    .replace(MESSAGE_FIELD_RE, (_m, key) => values[key.toLowerCase()] || '')
    .replace(/ +([,.!?])/g, '$1')
    .replace(/ {2,}/g, ' ');
}

function createApiHandlers(deps) {
  const {
    client,
    loadSchedules,
    saveSchedules,
    loadDelivered = () => [],
    loadContacts,
    saveContacts,
    loadSets,
    parseScheduleTime,
    validateScheduleTarget,
    resolveAndSend,
    withSendContext = (_ctx, fn) => Promise.resolve().then(fn),
    formatTimeAgo,
    getGroupParticipantCount,
    isAnnouncementGroup,
    getGroupTypeLabel,
    normalizePhoneDigits,
    delay,
    forwardToZeroClaw,
    MEDIA_DIR,
    log,
    resolveGroupByName,
    resolveParticipantWids,
    ZC_WEBHOOK_HOST = '127.0.0.1',
    ZC_WEBHOOK_PORT = 42617,
    budget = null,
    onSessionError = null,
    pushSvc = push,
  } = deps;

  let groupsCache = { at: 0, data: null };
  let waContactsCache = { at: 0, data: null, index: null, loading: null };
  const WA_CONTACTS_CACHE_MS = 10 * 60 * 1000;
  const apiJobs = new Map();

  /**
   * A WhatsApp "LID" is a synthetic id that looks like a phone number but
   * cannot be dialled or added. They're 13+ digits, and the NANP-looking ones
   * start with 1 without being 11 digits. Real numbers here are 10–13.
   */
  function looksLikeLid(digits) {
    const d = String(digits || '').replace(/\D/g, '');
    if (d.length >= 14) return true;
    if (d[0] === '1' && d.length !== 11) return true;
    return false;
  }

  /** Strip a trailing "(1234)" tag and collapse whitespace, for name matching. */
  function normalizeContactName(name) {
    return String(name || '')
      .replace(/\s*\(\d{2,6}\)\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Build a deduplicated search index from WhatsApp contacts.
   * Deduplicates by contact.number (the actual phone number WA reports,
   * present even on @lid entries), so the same person doesn't appear twice.
   * Prefers entries that are saved in the phone book (isMyContact) and have
   * a real name.
   */
  function buildContactSearchIndex(contacts) {
    // byPhone: phone -> { name, phone, score, isMyContact }
    const byPhone = new Map();

    for (const c of contacts || []) {
      if (!c || c.isGroup || c.isMe || c.isBroadcast || !c.isUser) continue;

      // Skip @lid contacts — their contact.number is a LID value, not a phone number
      const jid = String(c.id?._serialized || '');
      if (jid.endsWith('@lid')) continue;

      // Use contact.number (real phone), fall back to digits from JID
      const rawNum = String(c.number || '').replace(/\D/g, '');
      const phone = (rawNum.length >= 10 && rawNum.length <= 13 && !looksLikeLid(rawNum))
        ? normalizePhoneDigits(rawNum)
        : (() => {
            const m = jid.match(/^(\d{10,13})@(c\.us|s\.whatsapp\.net)$/);
            return m && !looksLikeLid(m[1]) ? normalizePhoneDigits(m[1]) : '';
          })();

      if (!phone || phone.length < 10 || looksLikeLid(phone)) continue;

      const name = (c.name || c.pushname || c.shortName || '').trim();
      // Higher score = better entry to keep when deduplicating
      const score = (c.isMyContact ? 4 : 0) + (c.name ? 2 : 0) + (c.pushname ? 1 : 0);

      const existing = byPhone.get(phone);
      if (!existing || score > existing.score) {
        byPhone.set(phone, { name: name || phone, phone, score, isMyContact: !!c.isMyContact });
      }
    }

    return Array.from(byPhone.values()).map((e) => ({
      name: e.name,
      phone: e.phone,
      searchBlob: `${e.name} ${e.phone}`.toLowerCase(),
      source: e.isMyContact ? 'phonebook' : 'whatsapp',
    }));
  }

  async function warmContactIndex() {
    if (waContactsCache.index && Date.now() - waContactsCache.at < WA_CONTACTS_CACHE_MS) {
      return; // already fresh
    }
    if (waContactsCache.loading) return; // already in progress

    waContactsCache.loading = client.getContacts()
      .then((contacts) => {
        const index = buildContactSearchIndex(contacts);
        waContactsCache = { at: Date.now(), data: null, index, loading: null };
        log(`[contacts] indexed ${index.length} WhatsApp contacts (deduped)`);
      })
      .catch((err) => {
        waContactsCache.loading = null;
        log(`[contacts] index build failed: ${err.message}`);
      });

    return waContactsCache.loading;
  }

  function searchContacts(q) {
    const ql = q.trim().toLowerCase();
    const qDigits = ql.replace(/\D/g, '');
    if (ql.length < 2) return [];

    const results = [];
    const seenDigits = new Set();
    // One entry per person: a WhatsApp @lid result is dropped when a real
    // phone result for the same name is already in.
    const byName = new Map(); // normalizedName -> index into results

    const rank = (source) => (source === 'saved' ? 3 : source === 'phonebook' ? 2 : 1);

    const add = (name, phone, source) => {
      const digits = normalizePhoneDigits(String(phone).replace(/\D/g, ''));
      if (!digits || digits.length < 10 || digits.length > 13 || looksLikeLid(digits)) return;
      if (seenDigits.has(digits)) return;

      const cleanName = String(name || '').trim() || digits;
      const nameKey = normalizeContactName(cleanName);
      const existingIx = nameKey ? byName.get(nameKey) : undefined;
      if (existingIx !== undefined) {
        const cur = results[existingIx];
        // Keep the better-sourced / shorter number for this person.
        const better = rank(source) > rank(cur.source)
          || (rank(source) === rank(cur.source) && digits.length < cur.phone.length);
        if (better) {
          seenDigits.delete(cur.phone);
          seenDigits.add(digits);
          results[existingIx] = { name: cleanName, phone: digits, source };
        }
        return;
      }

      seenDigits.add(digits);
      if (nameKey) byName.set(nameKey, results.length);
      results.push({ name: cleanName, phone: digits, source });
    };

    // Saved contacts first (contacts.json)
    for (const [name, number] of Object.entries(loadContacts().contacts || {})) {
      const numDigits = String(number || '').replace(/\D/g, '');
      if (name.toLowerCase().includes(ql) || (qDigits && numDigits.includes(qDigits))) {
        add(name, number, 'saved');
      }
    }

    // WhatsApp contacts from cached index — no Puppeteer call here
    for (const entry of (waContactsCache.index || [])) {
      if (entry.searchBlob.includes(ql) || (qDigits && entry.phone.includes(qDigits))) {
        add(entry.name, entry.phone, entry.source);
      }
      if (results.length >= 40) break;
    }

    return results
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .slice(0, 30);
  }

  function nextScheduleId(existing) {
    let id = Date.now();
    const ids = new Set((existing || []).map((s) => Number(s.id)));
    while (ids.has(id)) id += 1;
    return id;
  }

  /**
   * Accept an upload path only if it points at a real file inside MEDIA_DIR —
   * a schedule is stored on disk, so an unchecked path would be a read
   * primitive that outlives the request.
   */
  function resolveScheduleMedia(filePath) {
    const raw = String(filePath || '').trim();
    if (!raw) return '';
    const abs = path.resolve(MEDIA_DIR, path.basename(raw));
    if (path.dirname(abs) !== path.resolve(MEDIA_DIR)) {
      throw new Error('filePath must be an upload from /upload');
    }
    if (!fs.existsSync(abs)) throw new Error('Uploaded file is no longer on the server');
    return abs;
  }

  /** Remove an attachment once no schedule still points at it. */
  function dropScheduleMedia(filePath, schedules) {
    const abs = String(filePath || '');
    if (!abs || path.dirname(path.resolve(abs)) !== path.resolve(MEDIA_DIR)) return;
    const stillUsed = (schedules || []).some((s) => s.filePath === abs);
    if (stillUsed) return;
    try {
      fs.unlinkSync(abs);
    } catch { /* already gone */ }
  }

  const MEDIA_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
  };

  function mediaContentType(file) {
    return MEDIA_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  }

  function jsonResponse(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  async function enrichGroup(g, allGroups = null) {
    let lastActive = 'Unknown';
    let daysInactive = 999;
    let status = 'unknown';
    try {
      const messages = await Promise.race([
        g.fetchMessages({ limit: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      if (messages.length > 0) {
        lastActive = formatTimeAgo(messages[0].timestamp);
        daysInactive = Math.floor((Math.floor(Date.now() / 1000) - messages[0].timestamp) / 86400);
        if (daysInactive > 30) status = 'inactive';
        else if (daysInactive > 7) status = 'week';
        else status = 'active';
      } else {
        lastActive = 'Never';
        status = 'inactive';
      }
    } catch {
      status = 'unknown';
    }
    return {
      name: g.name,
      jid: g.id._serialized,
      participants: getGroupParticipantCount(g),
      announcement: isAnnouncementGroup(g),
      type: getGroupTypeLabel(g, allGroups),
      lastActive,
      daysInactive,
      status,
    };
  }

  async function getGroupsEnriched(force = false) {
    if (!force && groupsCache.data && Date.now() - groupsCache.at < GROUPS_CACHE_TTL_MS) {
      return groupsCache.data;
    }
    try {
      const chats = await client.getChats();
      const groups = chats.filter((c) => c.isGroup && c.name);
      const enriched = [];
      for (const g of groups) {
        enriched.push(await enrichGroup(g, groups));
      }
      enriched.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      groupsCache = { at: Date.now(), data: enriched };
      return enriched;
    } catch (err) {
      if (isWhatsAppSessionError(err)) {
        onSessionError?.(err, 'getGroupsEnriched');
        if (groupsCache.data) {
          log('[groups] WhatsApp session lost — serving stale cache');
          return groupsCache.data;
        }
      }
      throw err;
    }
  }

  async function probeAiStatus() {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: ZC_WEBHOOK_HOST,
        port: ZC_WEBHOOK_PORT,
        path: '/webhook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 2000,
      }, (res) => {
        resolve({ available: res.statusCode < 500 });
      });
      req.on('error', () => resolve({ available: false }));
      req.on('timeout', () => { req.destroy(); resolve({ available: false }); });
      req.write(JSON.stringify({ message: '__ping__' }));
      req.end();
    });
  }

  function parseMultipart(buffer, boundary) {
    const parts = buffer.toString('binary').split(`--${boundary}`);
    for (const part of parts) {
      if (!part.includes('Content-Disposition')) continue;
      const nameMatch = part.match(/name="([^"]+)"/);
      const filenameMatch = part.match(/filename="([^"]+)"/);
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const body = part.slice(headerEnd + 4).replace(/\r\n$/, '');
      if (filenameMatch) {
        return {
          field: nameMatch?.[1] || 'file',
          filename: filenameMatch[1],
          data: Buffer.from(body, 'binary'),
        };
      }
    }
    return null;
  }

  async function handleUpload(req) {
    const ct = req.headers['content-type'] || '';
    const match = ct.match(/boundary=(.+)$/);
    if (!match) throw new Error('Expected multipart/form-data');
    const boundary = match[1];
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) throw new Error('File too large (max 16MB)');
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const file = parseMultipart(buffer, boundary);
    if (!file?.data?.length) throw new Error('No file in upload');
    const ext = path.extname(file.filename || '') || '.bin';
    const safeName = `upload_${Date.now()}${ext.replace(/[^a-zA-Z0-9.]/g, '')}`;
    const filePath = path.join(MEDIA_DIR, safeName);
    fs.writeFileSync(filePath, file.data);
    return { filePath, filename: safeName };
  }

  /**
   * DMs to a list of numbers — per SENDING_SAFETY.md §11 the riskiest path
   * here, since these are one-to-one sends rather than groups people joined.
   * Paced widely, ordered randomly, and stopped outright when a cap is hit
   * rather than pushed through.
   */
  async function runBulkSend(numbers, message, actor = null) {
    return withSendContext({ via: 'bulk', corrId: `bulk-${Date.now()}`, actor }, () =>
      runBulkSendInner(numbers, message, actor));
  }

  async function runBulkSendInner(numbers, message, actor) {
    const results = [];
    const order = safety.shuffled(numbers);
    for (let i = 0; i < order.length; i++) {
      const num = order[i];
      const verdict = budget ? budget.check() : { ok: true };
      if (!verdict.ok) {
        results.push({ number: num, ok: false, error: `Stopped: ${verdict.reason}` });
        for (const rest of order.slice(i + 1)) {
          results.push({ number: rest, ok: false, error: `Stopped: ${verdict.reason}` });
        }
        log(`[bulk] stopped after ${i} of ${order.length} — ${verdict.reason}`);
        break;
      }
      try {
        await resolveAndSend(num, safety.varyCaption(message));
        results.push({ number: num, ok: true });
      } catch (err) {
        results.push({ number: num, ok: false, error: err.message });
      }
      if (i < order.length - 1) await safety.sendGap();
    }
    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    activity.recordEvent({
      category: 'send',
      type: failed ? 'warn' : 'ok',
      ok: !failed,
      title: `Sent to ${ok} of ${results.length} numbers`,
      detail: failed ? `${failed} failed` : '',
      count: ok,
      via: 'bulk',
      actor,
      meta: { message, total: results.length, sent: ok, failed, results },
      push: true,
    });
    return results;
  }

  /**
   * One message to many people, one chat at a time, as a background job: at
   * 45–90s apart a list takes far longer than any request can stay open.
   * Placeholders ({name} first name, {fullname}, {area}, {program}, {ie})
   * fill from each recipient; a personalised message is already different
   * per person, so caption variation is only added when there are none.
   * Stops (rather than pushes on) at quiet hours or a send cap.
   */
  async function runBulkMessageJob(jobId, recipients, message) {
    const job = apiJobs.get(jobId);
    if (!job) return;
    const personal = MESSAGE_FIELD_RE.test(message);
    MESSAGE_FIELD_RE.lastIndex = 0;
    const rows = [];
    job.status = 'running';
    try {
      await withSendContext({ via: 'bulk', corrId: `dm-${jobId}`, actor: job.actor }, async () => {
        const order = safety.shuffled(recipients);
        for (let i = 0; i < order.length; i++) {
          if (job.cancelled) break;
          const r = order[i];
          const verdict = budget ? budget.check() : { ok: true };
          const quiet = typeof safety.inQuietHours === 'function' && safety.inQuietHours(new Date());
          if (quiet || !verdict.ok) {
            job.status = 'stopped';
            job.stopReason = quiet ? 'quiet hours (no sends 10pm–8am)' : verdict.reason;
            break;
          }
          let text = fillMessageFields(message, r);
          if (!personal) text = safety.varyCaption(text);
          try {
            await resolveAndSend(r.number, text);
            job.sent += 1;
            job.results[r.number] = 'sent';
            rows.push({ number: r.number, name: r.name || '', ok: true });
          } catch (err) {
            job.failed += 1;
            job.results[r.number] = 'failed';
            job.errors.push(`${r.number}: ${err.message}`);
            rows.push({ number: r.number, name: r.name || '', ok: false, error: err.message });
          }
          job.done += 1;
          if (i < order.length - 1 && !job.cancelled) await safety.sendGap();
        }
      });
      if (job.status === 'running') job.status = job.cancelled ? 'cancelled' : 'done';
    } catch (err) {
      job.status = 'error';
      job.errors.push(`Job crashed: ${err.message}`);
    }
    for (const r of recipients) {
      if (!job.results[r.number]) {
        rows.push({ number: r.number, name: r.name || '', ok: false, error: job.stopReason ? `Not sent — ${job.stopReason}` : 'Not sent' });
      }
    }
    try {
      const notSent = job.total - job.sent;
      activity.recordEvent({
        category: 'send',
        type: job.status === 'error' || !job.sent ? 'err' : notSent ? 'warn' : 'ok',
        ok: job.status === 'done' && !job.failed,
        title: `Messaged ${job.sent} of ${job.total} people`,
        detail: [
          job.failed ? `${job.failed} failed` : '',
          job.status === 'stopped' ? `Stopped: ${job.stopReason}` : '',
          job.status === 'cancelled' ? 'Cancelled' : '',
        ].filter(Boolean).join(' · '),
        count: job.sent,
        via: 'bulk',
        corrId: `dm-${jobId}`,
        actor: job.actor,
        meta: {
          jobId,
          message,
          status: job.status,
          total: job.total,
          sent: job.sent,
          failed: job.failed,
          stopped: job.stopReason || '',
          results: rows,
        },
        push: true,
      });
    } catch { /* logging is best-effort */ }
  }

  async function runAddMembersJob(jobId, groupJid, numbers) {
    const job = apiJobs.get(jobId);
    if (!job) return;
    try {
      job.status = 'running';
      const groupChat = await client.getChatById(groupJid);
      job.groupName = groupChat?.name || '';
      const { entries, failed: resolveFailed } = await resolveParticipantWids(numbers);
      job.total = entries.length + resolveFailed.length;
      job.done = resolveFailed.length;
      job.errors = resolveFailed.map((f) => `${f.num}: ${f.error}`);
      job.added = 0;
      job.invited = 0;
      // Per-number outcome so callers can tell exactly who made it in:
      // digits -> 'added' | 'invited' | 'failed'. Numbers never reached
      // (job stopped/cancelled early) simply have no entry.
      job.results = {};
      resolveFailed.forEach((f) => { job.results[f.num] = 'failed'; });

      let bareRejectStreak = 0;
      for (let i = 0; i < entries.length; i++) {
        if (job.cancelled) break;
        const entry = entries[i];
        let bareReject = false;
        try {
          const result = await addParticipantsFixed(client, groupJid, [entry.wid], {
            sleep: 0,
            autoSendInviteV4: true,
          });
          job.done += 1;
          if (typeof result === 'string') {
            // Fatal string error from addParticipantsFixed
            job.errors.push(`${entry.digits}: ${result}`);
            job.results[entry.digits] = 'failed';
          } else if (result && typeof result === 'object') {
            const detail = result[entry.wid];
            if (detail && (detail.code === 200 || detail.code === 409)) {
              job.added += 1;
              job.results[entry.digits] = 'added';
            } else if (detail && detail.inviteLinkNeeded) {
              // Direct add refused for a policy reason — fall back to a
              // shareable join link, which is not rate-limited.
              bareReject = detail.code === 400;
              try {
                await sendGroupInviteLink(client, groupJid, entry.digits, {
                  groupName: groupChat.name,
                });
                job.invited += 1;
                job.results[entry.digits] = 'invited';
                job.errors.push(`${entry.digits}: couldn't add directly — sent a join link instead`);
              } catch (linkErr) {
                job.results[entry.digits] = 'failed';
                job.errors.push(
                  `${entry.digits}: ${detail.message || 'add refused'} (invite link failed: ${linkErr.message})`,
                );
              }
            } else if (detail && detail.code !== 200 && detail.code !== 409) {
              const msg = detail.message || `code ${detail.code}`;
              job.errors.push(`${entry.digits}: ${msg}`);
              job.results[entry.digits] = 'failed';
              bareReject = detail.code === 400 && !detail.rpcName;
            }
          }
        } catch (err) {
          job.done += 1;
          job.errors.push(`${entry.digits}: ${err.message}`);
          job.results[entry.digits] = 'failed';
        }

        // Two bare 400s in a row means WhatsApp is refusing adds outright —
        // usually a short cooldown from too many recent adds. Stop the job
        // rather than keep hammering (which can escalate to a 24h block).
        bareRejectStreak = bareReject ? bareRejectStreak + 1 : 0;
        if (bareRejectStreak >= 2) {
          job.status = 'stopped';
          job.errors.push(
            'Stopped: WhatsApp is refusing adds right now (likely a short cooldown from recent adds). Wait 15–30 minutes, then retry the rest.',
          );
          break;
        }

        // Only pause between entries — never after the last one
        if (i < entries.length - 1 && !job.cancelled) {
          await safety.participantGap();
        }
      }
      if (job.status !== 'stopped') {
        job.status = job.cancelled ? 'cancelled' : 'done';
      }
    } catch (err) {
      // Unhandled crash — mark as error so the UI doesn't poll forever
      job.status = 'error';
      job.errors.push(`Job crashed: ${err.message}`);
    }
    try {
      const added = job.added || 0;
      const invited = job.invited || 0;
      const titleBits = [`Added ${added} of ${job.total} to group`];
      if (invited) titleBits.push(`${invited} sent a join link`);
      activity.recordEvent({
        category: 'members',
        type: job.status === 'error' ? 'err' : (job.status === 'stopped' || job.errors.length) ? 'warn' : 'ok',
        ok: job.status === 'done' && !job.errors.length,
        title: job.status === 'error' ? 'Add members job failed' : titleBits.join(' · '),
        detail: job.status === 'stopped' ? 'Stopped early — WhatsApp cooldown' : '',
        target: groupJid,
        count: added,
        via: 'api',
        actor: job.actor,
        meta: {
          jobId,
          group: job.groupName || groupJid,
          status: job.status,
          total: job.total,
          added,
          invited,
          failed: Object.values(job.results || {}).filter((r) => r === 'failed').length,
          numbers,
          results: job.results || {},
          errors: job.errors,
        },
        push: true,
      });
    } catch { /* logging is best-effort */ }
  }

  function callerRole(req) {
    try { return auth.getRole(req) || 'admin'; } catch { return 'admin'; }
  }
  /** The parts of a schedule row worth showing in the activity detail. */
  function scheduleMeta(s) {
    return {
      scheduleId: s.id,
      message: s.message || '',
      target: s.target,
      isSet: !!s.isSet,
      runAt: s.runAt,
      createdAt: s.createdAt || '',
      file: s.filePath ? path.basename(s.filePath) : '',
    };
  }

  function callerActor(req) {
    try { return auth.getActor(req); } catch { return null; }
  }
  function callerTag(req) {
    try {
      const t = auth.getBearerToken(req) || '';
      return t ? crypto.createHash('sha256').update(t).digest('hex').slice(0, 16) : '';
    } catch { return ''; }
  }

  async function handleRequest(req, res, parsed, requireAuthFn) {
    const pathname = parsed.pathname;

    // ── Web Push ────────────────────────────────────────────────
    if (pathname === '/push/vapid-public-key' && req.method === 'GET') {
      jsonResponse(res, 200, { key: pushSvc.getPublicKey() });
      return true;
    }

    if (pathname === '/push/subscribe' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const sub = body.subscription || body;
        if (!sub || !sub.endpoint) {
          jsonResponse(res, 400, { error: 'subscription with endpoint required' });
          return true;
        }
        const row = pushSvc.addSub(sub, {
          role: callerRole(req),
          userId: callerTag(req),
          ua: req.headers['user-agent'] || '',
        });
        jsonResponse(res, 200, { ok: true, role: row && row.role });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    if (pathname === '/push/unsubscribe' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const endpoint = body.endpoint || (body.subscription && body.subscription.endpoint);
        pushSvc.removeSub(endpoint);
        jsonResponse(res, 200, { ok: true });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    if (pathname === '/push/test' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const endpoint = body.endpoint || (body.subscription && body.subscription.endpoint) || '';
        const result = await pushSvc.notify(
          'all',
          {
            title: 'Sandesha notifications are on',
            body: 'You’ll get a heads-up before scheduled sends, and results after jobs run.',
            tag: 'sandesha-test',
            url: callerRole(req) === 'promotions' ? 'admin-promotions.html' : 'admin-messaging.html',
            kind: 'test',
          },
          endpoint ? (s) => s.endpoint === endpoint : (s) => s.userId === callerTag(req),
        );
        jsonResponse(res, 200, { ok: true, sent: result.sent });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return true;
    }

    // Trusted server-to-server push (Apps Script attendance reminders).
    // Shared-secret auth, no user session.
    if (pathname === '/push/notify-internal' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const expected = pushSvc.getInternalToken ? pushSvc.getInternalToken() : null;
        if (!expected || String(body.token || '') !== expected) {
          jsonResponse(res, 403, { error: 'Forbidden' });
          return true;
        }
        const result = await pushSvc.notify(String(body.audience || 'all'), {
          title: body.title || 'Sandesha',
          body: body.body || '',
          tag: body.tag || 'sandesha-internal',
          url: body.url || 'admin.html',
          kind: body.kind || 'internal',
        });
        jsonResponse(res, 200, { ok: true, sent: result.sent });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    // ── Nurturing: add recruited event volunteers to a WhatsApp group ──
    if (pathname === '/volunteers/add-to-group' && req.method === 'POST') {
      if (!requireAuthFn(req, res, ['admin', 'nurturing'])) return true;
      try {
        const { groupJid, numbers } = JSON.parse(await readBody(req) || '{}');
        const list = Array.isArray(numbers)
          ? numbers
          : parsePhoneNumbers(String(numbers || ''), normalizePhoneDigits);
        if (!groupJid || !list.length) {
          jsonResponse(res, 400, { error: 'groupJid and numbers required' });
          return true;
        }
        const jobId = String(Date.now());
        const job = {
          id: jobId, status: 'queued', done: 0, total: list.length,
          errors: [], cancelled: false, expiresAt: Date.now() + JOB_TTL_MS,
          actor: callerActor(req),
        };
        apiJobs.set(jobId, job);
        setImmediate(() => runAddMembersJob(jobId, groupJid, list.slice(0, 50)).catch((err) => {
          const j = apiJobs.get(jobId);
          if (j && j.status === 'running') {
            j.status = 'error';
            j.errors.push(`Job crashed: ${err.message}`);
          }
        }));
        jsonResponse(res, 200, { jobId });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    // Queries → "Message all": one message to each person in the filtered list.
    if (pathname === '/messages/bulk' && req.method === 'POST') {
      if (!requireAuthFn(req, res, ['admin', 'nurturing'])) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const message = String(body.message || '').trim().slice(0, 2000);
        const seen = new Set();
        const recipients = (Array.isArray(body.recipients) ? body.recipients : [])
          .map((r) => ({
            number: normalizePhoneDigits(String((r && r.number) || '').replace(/\D/g, '')),
            name: String((r && r.name) || '').trim().slice(0, 80),
            fields: cleanMessageFields(r && r.fields),
          }))
          .filter((r) => /^\d{10,13}$/.test(r.number) && !seen.has(r.number) && seen.add(r.number));
        if (!message || !recipients.length) {
          jsonResponse(res, 400, { error: 'message and at least one valid number required' });
          return true;
        }
        if (recipients.length > BULK_MESSAGE_MAX) {
          jsonResponse(res, 400, { error: `At most ${BULK_MESSAGE_MAX} people per bulk message` });
          return true;
        }
        const jobId = `dm-${Date.now()}`;
        apiJobs.set(jobId, {
          id: jobId, kind: 'message', status: 'queued', done: 0, total: recipients.length,
          sent: 0, failed: 0, errors: [], results: {}, cancelled: false,
          expiresAt: Date.now() + JOB_TTL_MS, actor: callerActor(req),
        });
        setImmediate(() => runBulkMessageJob(jobId, recipients, message).catch(() => {}));
        jsonResponse(res, 200, { jobId, total: recipients.length });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    const msgJobMatch = pathname.match(/^\/messages\/job\/([^/]+?)(\/cancel)?$/);
    if (msgJobMatch) {
      if (!requireAuthFn(req, res, ['admin', 'nurturing'])) return true;
      const job = apiJobs.get(msgJobMatch[1]);
      if (!job || job.kind !== 'message') {
        jsonResponse(res, 404, { error: 'Job not found' });
        return true;
      }
      if (msgJobMatch[2] && req.method === 'POST') job.cancelled = true;
      jsonResponse(res, 200, {
        id: job.id, status: job.status, done: job.done, total: job.total,
        sent: job.sent, failed: job.failed, stopReason: job.stopReason || '',
        errors: job.errors.slice(-20), results: job.results,
      });
      return true;
    }

    const volJobMatch = pathname.match(/^\/volunteers\/job\/([^/]+)$/);
    if (volJobMatch && req.method === 'GET') {
      if (!requireAuthFn(req, res, ['admin', 'nurturing'])) return true;
      const job = apiJobs.get(volJobMatch[1]);
      if (!job) {
        jsonResponse(res, 404, { error: 'Job not found' });
        return true;
      }
      jsonResponse(res, 200, {
        id: job.id, status: job.status, done: job.done, total: job.total,
        added: job.added || 0, invited: job.invited || 0, errors: job.errors.slice(-20),
        results: job.results || {},
      });
      return true;
    }

    if (pathname === '/ai/status' && req.method === 'GET') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      const status = await probeAiStatus();
      jsonResponse(res, 200, status);
      return true;
    }

    if (pathname === '/ai/chat' && req.method === 'POST') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const reply = await forwardToZeroClaw(body.message || '');
        jsonResponse(res, 200, { response: reply || 'No response from AI service' });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return true;
    }

    // What Sandesha has already sent. The board marks a post sent off this,
    // rather than inferring it from a schedule row that is no longer there.
    if (pathname === '/schedules/delivered' && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      jsonResponse(res, 200, { delivered: loadDelivered() });
      return true;
    }

    // Shared activity log — every send (bot, API, bulk, broadcast, scheduled)
    // plus member jobs and group/contact edits. Written server-side so events
    // that happen while the admin UI is closed still show up. Older scheduled
    // deliveries (before activity.jsonl existed) are back-filled from
    // delivered.json so the feed isn't empty on first upgrade.
    // Admin sees every team; Nurturing sees only what its own team started.
    if (pathname === '/activity' && req.method === 'GET') {
      if (!requireAuthFn(req, res, ['admin', 'nurturing'])) return true;
      const limit = Math.max(1, Math.min(500, parseInt(parsed.query.limit, 10) || 150));
      const sinceIso = String(parsed.query.since || '');
      const role = callerRole(req);
      if (role !== 'admin') {
        const own = activity.loadActivity({ limit: 500, sinceIso })
          .filter((e) => e.actor && e.actor.role === role)
          .slice(0, limit);
        jsonResponse(res, 200, { activity: own });
        return true;
      }
      const events = activity.loadActivity({ limit, sinceIso });
      const oldestEventTs = events.length
        ? Date.parse(events[events.length - 1].at)
        : Date.now();
      const backfill = (loadDelivered() || [])
        .filter((d) => d.sentAt && Date.parse(d.sentAt) < oldestEventTs
          && (!sinceIso || Date.parse(d.sentAt) >= Date.parse(sinceIso)))
        .map((d) => ({
          at: d.sentAt,
          type: 'ok',
          category: 'schedule',
          title: 'Scheduled message delivered',
          detail: '',
          target: d.target || '',
          count: 1,
          ok: true,
          via: 'scheduled',
          corrId: String(d.sourceId || ''),
        }));
      const merged = [...events, ...backfill]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, limit);
      jsonResponse(res, 200, { activity: merged });
      return true;
    }

    if (pathname === '/schedules' && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      jsonResponse(res, 200, { schedules: loadSchedules() });
      return true;
    }

    if (pathname === '/schedules' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const { message, target, runAt, timeStr, isSet, filePath, sourceId } = body;
        const media = resolveScheduleMedia(filePath);
        if ((!message && !media) || !target) {
          jsonResponse(res, 400, { error: 'message (or filePath) and target required' });
          return true;
        }
        let when = runAt ? new Date(runAt) : (timeStr ? parseScheduleTime(timeStr) : null);
        if (!when || Number.isNaN(when.getTime())) {
          jsonResponse(res, 400, { error: 'Invalid runAt or timeStr' });
          return true;
        }
        await validateScheduleTarget(target);

        const schedules = loadSchedules();
        const runAtIso = when.toISOString();
        const msgNorm = String(message || '').trim();
        const targetNorm = String(target).trim().toLowerCase();

        // Guard against double-submit / duplicate POSTs for the same job
        const dup = schedules.find((s) =>
          String(s.message || '').trim() === msgNorm &&
          String(s.target || '').trim().toLowerCase() === targetNorm &&
          s.runAt === runAtIso &&
          (Date.now() - new Date(s.createdAt || 0).getTime()) < 15000,
        );
        if (dup) {
          jsonResponse(res, 200, { ok: true, schedule: dup, deduped: true });
          return true;
        }

        const schedule = {
          id: nextScheduleId(schedules),
          message: msgNorm,
          target: String(target).trim(),
          isSet: !!isSet,
          runAt: runAtIso,
          createdAt: new Date().toISOString(),
        };
        // A flyer scheduled now must still be on disk at send time, so the
        // upload stays in MEDIA_DIR and the row only carries its path.
        if (media) schedule.filePath = media;
        if (sourceId) schedule.sourceId = String(sourceId);
        // Credit the person who queued it, so the send it turns into later
        // (by the scheduler, with nobody logged in) still shows who started it.
        const actor = callerActor(req);
        if (actor) schedule.createdBy = { role: actor.role, name: actor.name };
        schedules.push(schedule);
        saveSchedules(schedules);
        activity.recordEvent({
          category: 'schedule',
          type: 'info',
          ok: true,
          title: `Scheduled a ${media ? 'flyer' : 'message'}`,
          detail: `For ${new Date(runAtIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}`,
          target: schedule.target,
          via: 'api',
          actor,
          meta: scheduleMeta(schedule),
        });
        jsonResponse(res, 200, { ok: true, schedule });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    const scheduleDelete = pathname.match(/^\/schedules\/(\d+)$/);
    if (scheduleDelete && req.method === 'DELETE') {
      if (!requireAuthFn(req, res)) return true;
      const id = parseInt(scheduleDelete[1], 10);
      const all = loadSchedules();
      const dropped = all.find((s) => s.id === id);
      const schedules = all.filter((s) => s.id !== id);
      saveSchedules(schedules);
      if (dropped?.filePath) dropScheduleMedia(dropped.filePath, schedules);
      if (dropped) {
        activity.recordEvent({
          category: 'schedule',
          type: 'info',
          ok: true,
          title: 'Cancelled a scheduled message',
          target: dropped.target,
          via: 'api',
          actor: callerActor(req),
          meta: scheduleMeta(dropped),
        });
      }
      jsonResponse(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/contacts' && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      jsonResponse(res, 200, loadContacts());
      return true;
    }

    if (pathname === '/contacts/search' && req.method === 'GET') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      const q = (parsed.query.q || '').trim();
      try {
        const results = await searchContacts(q);
        jsonResponse(res, 200, { results });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return true;
    }

    if (pathname === '/contacts' && req.method === 'POST') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        if (!body.name || !body.number) {
          jsonResponse(res, 400, { error: 'name and number required' });
          return true;
        }
        const contacts = loadContacts();
        const isNew = !(body.name in contacts.contacts);
        contacts.contacts[body.name] = body.number;
        saveContacts(contacts);
        activity.recordEvent({
          category: 'contact',
          type: 'ok',
          title: isNew ? `Saved contact "${body.name}"` : `Updated contact "${body.name}"`,
          target: String(body.number),
          via: 'api',
          actor: callerActor(req),
          push: true,
        });
        jsonResponse(res, 200, { ok: true, contacts: contacts.contacts });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    const contactDelete = pathname.match(/^\/contacts\/([^/]+)$/);
    if (contactDelete && req.method === 'DELETE') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      const name = decodeURIComponent(contactDelete[1]);
      const contacts = loadContacts();
      const existed = name in contacts.contacts;
      delete contacts.contacts[name];
      saveContacts(contacts);
      if (existed) {
        activity.recordEvent({
          category: 'contact', type: 'ok', title: `Deleted contact "${name}"`, via: 'api', push: true,
          actor: callerActor(req),
        });
      }
      jsonResponse(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/groups' && req.method === 'POST') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const title = String(body.title || '').trim();
        if (!title) {
          jsonResponse(res, 400, { error: 'title required' });
          return true;
        }
        const result = await client.createGroup(title, [], { announce: true });
        if (typeof result === 'string') {
          jsonResponse(res, 500, { error: result });
          return true;
        }
        groupsCache = { at: 0, data: null };
        activity.recordEvent({
          category: 'group',
          type: 'ok',
          title: `Created group "${result.title || title}"`,
          target: result.gid._serialized,
          via: 'api',
          actor: callerActor(req),
          push: true,
        });
        jsonResponse(res, 200, { ok: true, jid: result.gid._serialized, title: result.title });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return true;
    }

    if (pathname === '/groups/inactive' && req.method === 'GET') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      const days = parseInt(parsed.query.days, 10) || 30;
      const groups = await getGroupsEnriched();
      jsonResponse(res, 200, groups.filter((g) => g.daysInactive >= days));
      return true;
    }

    if (pathname === '/groups/find-member' && req.method === 'GET') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      const q = (parsed.query.q || '').trim();
      if (!q) {
        jsonResponse(res, 400, { error: 'q required' });
        return true;
      }
      const chats = await client.getChats();
      const found = [];
      for (const g of chats.filter((c) => c.isGroup)) {
        try {
          if (!g.participants?.length) await g.fetchParticipants?.().catch(() => {});
          for (const p of g.participants || []) {
            const contact = p.id ? await client.getContactById(p.id._serialized).catch(() => null) : null;
            const name = contact?.pushname || contact?.name || p.name || '';
            if (name.toLowerCase().includes(q.toLowerCase())) {
              found.push({ group: g.name, jid: g.id._serialized, name });
            }
          }
        } catch { /* skip */ }
      }
      jsonResponse(res, 200, { results: found.slice(0, 50) });
      return true;
    }

    const membersMatch = pathname.match(/^\/groups\/([^/]+)\/members$/);
    if (membersMatch && req.method === 'GET') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      const jid = decodeURIComponent(membersMatch[1]);
      try {
        const chat = await client.getChatById(jid);
        if (!chat.participants?.length) await chat.fetchParticipants?.().catch(() => {});
        const members = [];
        for (const p of (chat.participants || []).slice(0, 100)) {
          const contact = p.id ? await client.getContactById(p.id._serialized).catch(() => null) : null;
          members.push({
            name: contact?.pushname || contact?.name || p.name || 'Unknown',
            phone: p.id?.user || '',
          });
        }
        jsonResponse(res, 200, { group: chat.name, jid, members, total: chat.participants?.length || members.length });
      } catch (err) {
        jsonResponse(res, 404, { error: err.message });
      }
      return true;
    }

    // Shareable join link for a group — the safe alternative to a direct add
    // (not rate-limited, no account risk; the person taps it themselves).
    const inviteMatch = pathname.match(/^\/groups\/([^/]+)\/invite$/);
    if (inviteMatch && req.method === 'GET') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      const jid = decodeURIComponent(inviteMatch[1]);
      try {
        const link = await getGroupInviteLink(client, jid);
        jsonResponse(res, 200, { link });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    if (pathname === '/send/broadcast' && req.method === 'POST') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      try {
        const { message } = JSON.parse(await readBody(req) || '{}');
        if (!message) {
          jsonResponse(res, 400, { error: 'message required' });
          return true;
        }
        const chats = await client.getChats();
        const groups = safety.shuffled(chats.filter((c) => c.isGroup));
        const corrId = `broadcast-${Date.now()}`;
        const actor = callerActor(req);
        const failures = [];
        let sent = 0;
        let stopped = null;
        await withSendContext({ via: 'broadcast', corrId, actor }, async () => {
          for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const verdict = budget ? budget.check() : { ok: true };
            if (!verdict.ok) {
              stopped = verdict.reason;
              log(`[broadcast] stopped after ${sent} of ${groups.length} — ${verdict.reason}`);
              break;
            }
            try {
              await resolveAndSend(g.id._serialized, safety.varyCaption(message));
              sent += 1;
            } catch (err) {
              failures.push({ target: g.name || g.id._serialized, error: err.message });
              log(`[broadcast] ${g.name}: ${err.message}`);
            }
            if (i < groups.length - 1) await safety.broadcastGap();
          }
        });
        activity.recordEvent({
          category: 'send',
          type: stopped || failures.length ? 'warn' : 'ok',
          ok: !stopped && !failures.length,
          title: `Broadcast to ${sent} of ${groups.length} groups`,
          detail: [stopped ? `Stopped: ${stopped}` : '', failures.length ? `${failures.length} failed` : '']
            .filter(Boolean).join(' · '),
          count: sent,
          via: 'broadcast',
          corrId,
          actor,
          meta: { message, total: groups.length, sent, failures, stopped: stopped || '' },
          push: true,
        });
        jsonResponse(res, 200, { ok: true, sent, total: groups.length, stopped });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return true;
    }

    if (pathname === '/send/bulk' && req.method === 'POST') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      try {
        const { numbers, message } = JSON.parse(await readBody(req) || '{}');
        const list = Array.isArray(numbers) ? numbers : parsePhoneNumbers(String(numbers || ''), normalizePhoneDigits);
        if (!list.length || !message) {
          jsonResponse(res, 400, { error: 'numbers and message required' });
          return true;
        }
        const results = await runBulkSend(list.slice(0, 100), message, callerActor(req));
        jsonResponse(res, 200, { ok: true, results });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return true;
    }

    // Hand a queued flyer back so it can be saved and posted by hand when
    // Sandesha cannot send it. Confined to MEDIA_DIR by basename, so a path
    // in the URL cannot walk out of the media folder.
    const mediaGet = pathname.match(/^\/media\/([^/]+)$/);
    if (mediaGet && req.method === 'GET') {
      if (!requireAuthFn(req, res)) return true;
      const name = path.basename(decodeURIComponent(mediaGet[1]));
      const abs = path.resolve(MEDIA_DIR, name);
      if (path.dirname(abs) !== path.resolve(MEDIA_DIR) || !fs.existsSync(abs)) {
        jsonResponse(res, 404, { error: 'Not found' });
        return true;
      }
      const stat = fs.statSync(abs);
      if (!stat.isFile()) {
        jsonResponse(res, 404, { error: 'Not found' });
        return true;
      }
      res.writeHead(200, {
        'Content-Type': mediaContentType(abs),
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=300',
      });
      fs.createReadStream(abs).pipe(res);
      return true;
    }

    if (pathname === '/upload' && req.method === 'POST') {
      if (!requireAuthFn(req, res)) return true;
      try {
        const result = await handleUpload(req);
        jsonResponse(res, 200, result);
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    if (pathname === '/jobs/add-members' && req.method === 'POST') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      try {
        const { groupJid, numbers } = JSON.parse(await readBody(req) || '{}');
        const list = Array.isArray(numbers) ? numbers : parsePhoneNumbers(String(numbers || ''), normalizePhoneDigits);
        if (!groupJid || !list.length) {
          jsonResponse(res, 400, { error: 'groupJid and numbers required' });
          return true;
        }
        const jobId = String(Date.now());
        const job = {
          id: jobId,
          status: 'queued',
          done: 0,
          total: list.length,
          errors: [],
          cancelled: false,
          expiresAt: Date.now() + JOB_TTL_MS,
          actor: callerActor(req),
        };
        apiJobs.set(jobId, job);
        setImmediate(() => runAddMembersJob(jobId, groupJid, list.slice(0, 50)).catch((err) => {
          const j = apiJobs.get(jobId);
          if (j && j.status === 'running') {
            j.status = 'error';
            j.errors.push(`Job crashed: ${err.message}`);
          }
        }));
        jsonResponse(res, 200, { jobId });
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === 'GET') {
      if (!requireAuthFn(req, res, ['admin'])) return true;
      const job = apiJobs.get(jobMatch[1]);
      if (!job) {
        jsonResponse(res, 404, { error: 'Job not found' });
        return true;
      }
      jsonResponse(res, 200, {
        id: job.id,
        status: job.status,
        done: job.done,
        total: job.total,
        added: job.added || 0,
        invited: job.invited || 0,
        errors: job.errors.slice(-20),
      });
      return true;
    }

    return false;
  }

  return {
    handleRequest,
    getGroupsEnriched,
    warmContactIndex,
    invalidateGroupsCache: () => { groupsCache = { at: 0, data: null }; },
    invalidateContactIndex: () => { waContactsCache = { at: 0, data: null, index: null, loading: null }; },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

module.exports = { createApiHandlers };

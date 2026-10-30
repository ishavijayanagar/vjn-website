'use strict';

const path = require('path');
const fs = require('fs');

const SESSION_TTL_MS = 15 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function msgSerializedId(msg) {
  if (!msg?.id) return null;
  if (typeof msg.id === 'string') return msg.id;
  return msg.id._serialized || msg.id.$1 || null;
}
const DEFAULT_MENTION_ALIASES = ['sandesha', 'sv'];

const sessions = new Map();

function sessionKey(chatId, operatorId) {
  return `${chatId}:${operatorId || ''}`;
}

function getSession(chatId, operatorId) {
  const key = sessionKey(chatId, operatorId);
  const s = sessions.get(key);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(key);
    return null;
  }
  return s;
}

function touchSession(chatId, operatorId, patch) {
  const key = sessionKey(chatId, operatorId);
  const existing = getSession(chatId, operatorId) || { chatId, operatorId };
  const next = {
    ...existing,
    ...patch,
    chatId,
    operatorId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(key, next);
  return next;
}

function clearSession(chatId, operatorId) {
  sessions.delete(sessionKey(chatId, operatorId));
}

/** Strip @mention tokens (display names or digits) from body. */
function stripMentionTokens(body) {
  return String(body || '')
    .replace(/@[^\s@]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCancel(text) {
  const t = stripMentionTokens(text).trim().toLowerCase();
  if (/^cancel\s+\d+$/.test(t)) return false;
  return t === 'cancel' || t === 'abort' || t === 'stop';
}

/** @returns {{ action: 'list' } | { action: 'cancelSchedule', num: number } | null} */
function parsePlanningQueueCommand(body) {
  const t = stripMentionTokens(body).trim().toLowerCase();
  if (/^(queue|queued|list|schedules)$/.test(t)) return { action: 'list' };
  const m = t.match(/^cancel\s+(\d+)$/);
  if (m) return { action: 'cancelSchedule', num: parseInt(m[1], 10) };
  return null;
}

function listUpcomingSchedules(loadSchedules) {
  const now = Date.now();
  return (loadSchedules() || [])
    .filter((s) => new Date(s.runAt).getTime() > now - 120000)
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
}

function formatQueueMenu(rows) {
  if (!rows.length) {
    return '📋 *Queue is empty* — nothing scheduled in Sandesha.\n\n*cancel* — stop the current send wizard (if any)';
  }
  let text = `📋 *Queued sends* (${rows.length}):\n\n`;
  rows.forEach((s, i) => {
    const when = new Date(s.runAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const preview = String(s.message || '(media)').replace(/\s+/g, ' ').trim();
    const short = preview.length > 55 ? `${preview.slice(0, 55)}…` : preview;
    const setLabel = s.isSet ? `${s.target} (set)` : s.target;
    text += `${i + 1}. "${short}"\n   → *${setLabel}* · ${when}\n`;
  });
  text += '\n*cancel 1* … *cancel N* — remove from queue\n*cancel* — stop the current send wizard';
  return text;
}

/**
 * @returns {{ ok: boolean, command?: string, when?: 'now'|'schedule'|null, timeStr?: string, setHint?: string }}
 */
function parsePlanningCommand(body) {
  let remainder = stripMentionTokens(body).trim();
  const lower = remainder.toLowerCase();

  let setHint = null;
  const mayIncludeSet = /\bsend(?:\s+this)?\s+(?:now|at\b)/i.test(remainder)
    || /^send\s+this\s+to\s+/i.test(remainder);
  if (mayIncludeSet) {
    const toMatch = remainder.match(/\bto\s+([a-z0-9_-]+)\b/i);
    if (toMatch) {
      setHint = toMatch[1];
      remainder = remainder.replace(toMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }
  }
  const rem = remainder.toLowerCase();

  if (/^send(?:\s+this)?\s+now\b/.test(rem) || rem === 'send now') {
    return { ok: true, command: 'send', when: 'now', setHint };
  }

  const atMatch = rem.match(/^send(?:\s+this)?\s+at\s+(.+)$/);
  if (atMatch) {
    return { ok: true, command: 'send', when: 'schedule', timeStr: atMatch[1].trim(), setHint };
  }

  if (rem === 'send' || rem === 'send this') {
    return { ok: true, command: 'send', when: null, setHint };
  }
  if (/^send\s+this\b/.test(rem)) {
    return { ok: true, command: 'send', when: null, setHint };
  }

  return { ok: false };
}

function normalizeAliases(aliases) {
  const list = Array.isArray(aliases) && aliases.length ? aliases : DEFAULT_MENTION_ALIASES;
  return list.map((a) => String(a).replace(/^@/, '').toLowerCase()).filter(Boolean);
}

function jidMatchesMyNumber(jid, myNumber, normalizePhoneDigits) {
  if (!jid || !myNumber) return false;
  const norm = normalizePhoneDigits || ((d) => String(d).replace(/\D/g, ''));
  const fromJid = String(jid).replace(/@.*/, '').replace(/\D/g, '');
  const fromMe = String(myNumber).replace(/@.*/, '').replace(/\D/g, '');
  if (!fromJid || !fromMe) return false;
  return norm(fromJid) === norm(fromMe);
}

function isSandeshaMentioned(msg, myNumber, aliases, normalizePhoneDigits) {
  const body = String(msg?.body || '');
  const data = msg?._data || {};

  const mentionedIds = msg?.mentionedIds || data.mentionedIds || data.mentionedJidList || [];
  if (Array.isArray(mentionedIds) && mentionedIds.length && myNumber) {
    for (const id of mentionedIds) {
      const serialized = typeof id === 'string' ? id : id?._serialized || id?.user || '';
      if (jidMatchesMyNumber(serialized, myNumber, normalizePhoneDigits)) return true;
    }
  }

  const aliasList = normalizeAliases(aliases);
  for (const alias of aliasList) {
    const re = new RegExp(`@${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(body)) return true;
  }
  return false;
}

function extractAuthorJid(msg) {
  if (msg?.author) return msg.author;
  const p = msg?._data?.participant;
  if (!p) return null;
  if (typeof p === 'string') return p;
  return p._serialized || (p.user ? `${p.user}@c.us` : null);
}

function extractPhoneDigitsFromJid(jid, normalizePhoneDigits) {
  if (!jid || String(jid).includes('@g.us')) return null;
  const m = String(jid).match(/^(\d{10,15})@(c\.us|s\.whatsapp\.net|lid)$/);
  if (!m) {
    const bare = String(jid).replace(/@.*/, '').replace(/\D/g, '');
    if (bare.length >= 10 && bare.length <= 15) return normalizePhoneDigits(bare);
    return null;
  }
  return normalizePhoneDigits(m[1]);
}

/** Comma/semicolon/newline-separated phones → normalized unique list. */
function parsePlanningOperators(raw, normalizePhoneDigits) {
  const norm = normalizePhoneDigits || ((d) => String(d).replace(/\D/g, ''));
  const parts = String(raw || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const d = norm(p.replace(/\D/g, ''));
    if (d.length >= 10 && d.length <= 15 && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

function normalizeOperatorAllowlist(configured, normalizePhoneDigits) {
  if (Array.isArray(configured)) {
    return parsePlanningOperators(configured.join(','), normalizePhoneDigits);
  }
  return parsePlanningOperators(configured, normalizePhoneDigits);
}

function resolveOperatorId(msg, configured, normalizePhoneDigits, getMyNumber) {
  const norm = normalizePhoneDigits || ((d) => String(d).replace(/\D/g, ''));
  const allowed = normalizeOperatorAllowlist(configured, norm);
  if (!allowed.length) return null;
  const allowedSet = new Set(allowed);

  if (msg.fromMe) {
    const my = getMyNumber ? getMyNumber() : null;
    if (my) {
      const myDigits = norm(String(my).replace(/@.*/, '').replace(/\D/g, ''));
      if (allowedSet.has(myDigits)) return myDigits;
    }
  }

  const authorJid = extractAuthorJid(msg);
  const authorDigits = authorJid ? extractPhoneDigitsFromJid(authorJid, norm) : null;
  if (authorDigits && allowedSet.has(authorDigits)) return authorDigits;

  return null;
}

function isAllowedPlanningOperator(msg, configured, normalizePhoneDigits, getMyNumber) {
  return !!resolveOperatorId(msg, configured, normalizePhoneDigits, getMyNumber);
}

function broadcastCount(members, planningGroupJid) {
  const planning = String(planningGroupJid || '').trim();
  const list = members || [];
  if (!planning) return list.length;
  return list.filter((j) => String(j || '').trim() && String(j).trim() !== planning).length;
}

function formatSetsMenu(sets, planningGroupJid) {
  const keys = Object.keys(sets || {});
  if (keys.length === 0) {
    return { text: 'No group sets defined. Add sets in the dashboard or groups.json first.', setKeys: [] };
  }
  let text = '📋 *Pick a set to send to:*\n\n';
  keys.forEach((k, i) => {
    const members = sets[k] || [];
    const outward = broadcastCount(members, planningGroupJid);
    let label;
    if (outward === 0 && members.length) label = 'this chat only — pick another for broadcast';
    else if (outward === 0) label = 'empty';
    else label = `${outward} group${outward === 1 ? '' : 's'}`;
    text += `${i + 1}. *${k}* (${label})\n`;
  });
  text += '\nReply with a number or set name · *cancel*';
  return { text, setKeys: keys };
}

function parseSetChoice(body, setKeys) {
  const t = (body || '').trim();
  if (!t || !setKeys?.length) return null;
  const num = parseInt(t, 10);
  if (!Number.isNaN(num) && num >= 1 && num <= setKeys.length) {
    return setKeys[num - 1];
  }
  const lower = t.toLowerCase();
  const exact = setKeys.find((k) => k.toLowerCase() === lower);
  if (exact) return exact;
  return null;
}

function createPlanningSendWizard(deps) {
  const {
    loadSets,
    botReply,
    log,
    normalizePhoneDigits,
    getQuotedMessageSafe,
    resolveQuotedTextBundle,
    sendQuotedToSet,
    sendStoredDraftToSet,
    getPlanningChat,
    getPlanningGroupJid,
    parseScheduleTime,
    validateScheduleTarget,
    loadSchedules,
    saveSchedules,
    nextLocalScheduleId,
    formatTimeUntil,
    MEDIA_DIR,
    getMyNumber,
    configuredOperator,
    mentionAliases,
    getPlanningChatId,
    isBotReplyText,
    getQuotedText,
    findPromoIdByMessage,
    markPromoSentFromPlanning,
    linkScheduleToPromo,
    saveDraftMedia,
    findDraftByStanza,
    stanzaIdFromMsg,
    cancelScheduleById,
    findCachedMediaByStanza,
  } = deps;

  const configuredOperators = normalizeOperatorAllowlist(configuredOperator, normalizePhoneDigits);

  async function handleQueueCommand(msg) {
    const cmd = parsePlanningQueueCommand(msg.body);
    if (!cmd) return false;

    const mentioned = isSandeshaMentioned(msg, getMyNumber?.(), mentionAliases, normalizePhoneDigits);
    if (!mentioned) return false;

    if (cmd.action === 'list') {
      const rows = listUpcomingSchedules(loadSchedules);
      await botReply(msg, formatQueueMenu(rows));
      return true;
    }

    if (cmd.action === 'cancelSchedule') {
      const rows = listUpcomingSchedules(loadSchedules);
      const idx = cmd.num - 1;
      if (idx < 0 || idx >= rows.length) {
        await botReply(msg, `No item *#${cmd.num}* in the queue. Reply *@sandesha queue* to see the list.`);
        return true;
      }
      const target = rows[idx];
      const ok = cancelScheduleById ? cancelScheduleById(target.id) : false;
      const preview = String(target.message || '(media)').replace(/\s+/g, ' ').trim();
      const short = preview.length > 40 ? `${preview.slice(0, 40)}…` : preview;
      if (ok) {
        await botReply(msg, `Cancelled *#${cmd.num}*: "${short}" → ${target.target}`);
      } else {
        await botReply(msg, `Could not cancel *#${cmd.num}* — it may have already gone out.`);
      }
      return true;
    }

    return false;
  }

  function chatIdFor(msg, chat) {
    const gid = getPlanningChatId ? getPlanningChatId(msg, chat) : null;
    return gid || msg?.from;
  }

  /**
   * New send: restarts the wizard (clears an old await_set session).
   * @sandesha/@sv + send, or reply-to-draft with send / send this now / send this at …
   */
  async function isFreshPlanningTrigger(msg, chat) {
    const parsed = parsePlanningCommand(msg.body);
    if (!parsed.ok) return false;
    const quoted = await getQuotedMessageSafe(msg, chat);
    if (!quoted) return false;
    if (isBotReplyText && getQuotedText && isBotReplyText(getQuotedText(quoted))) return false;

    if (isSandeshaMentioned(msg, getMyNumber?.(), mentionAliases, normalizePhoneDigits)) {
      return true;
    }
    // Follow-up on the flyer: "send this now" / "send this at 5.51pm today" without repeating @
    return true;
  }

  async function saveQuotedMedia(quotedMsg, stanzaHint) {
    if (!quotedMsg?.hasMedia || !saveDraftMedia) return null;
    try {
      return await saveDraftMedia(quotedMsg, stanzaHint || stanzaIdFromMsg?.(quotedMsg) || null);
    } catch (err) {
      log(`[PLANNING] save draft media: ${err.message}`);
      return null;
    }
  }

  async function ensurePlanningMediaFile(session, quotedMsg, refreshQuoted) {
    const stanza = session.quotedStanzaId || null;
    let filePath = session.filePath || null;
    if (filePath && fs.existsSync(filePath)) return filePath;
    if (findCachedMediaByStanza && stanza) {
      filePath = findCachedMediaByStanza(stanza);
      if (filePath && fs.existsSync(filePath)) return filePath;
    }
    let draft = quotedMsg;
    if (!draft && findDraftByStanza && stanza) {
      draft = await findDraftByStanza(stanza);
    }
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (draft?.hasMedia) {
        filePath = await saveQuotedMedia(draft, stanza);
        if (filePath && fs.existsSync(filePath)) return filePath;
      }
      if (attempt < 4) {
        await sleep(attempt * 1200);
        if (refreshQuoted) draft = await refreshQuoted();
      }
    }
    return null;
  }

  const MEDIA_REQUIRED_REPLY =
    '❌ Could not save the flyer/video from WhatsApp.\n\n' +
    '1. Post the image/video **in this planning group** again\n' +
    '2. Wait ~5 seconds (look for `[PLANNING-MEDIA] saved` in logs)\n' +
    '3. Reply to **that post** with `@sandesha send this now`\n\n' +
    'On the Pi after updating code: `npm install` then `./sandesha.sh restart` (applies the WhatsApp media patch).';

  async function resolveTriggerQuotedMsg(msg, session) {
    if (session.quotedStanzaId && findDraftByStanza) {
      const byStanza = await findDraftByStanza(session.quotedStanzaId);
      if (byStanza) return byStanza;
    }
    if (session.quotedMsgId && deps.getMessageById) {
      try {
        const draft = await deps.getMessageById(session.quotedMsgId);
        if (draft) return draft;
      } catch (err) {
        log(`[PLANNING] load draft by id: ${err.message}`);
      }
    }

    let planningChat = null;
    if (getPlanningChat) {
      try {
        planningChat = await getPlanningChat();
      } catch (err) {
        log(`[PLANNING] planning chat: ${err.message}`);
      }
    }

    let triggerMsg = msg;
    if (!msg?.hasQuotedMsg && session.triggerMsgId && deps.getMessageById) {
      try {
        const loaded = await deps.getMessageById(session.triggerMsgId);
        if (loaded) triggerMsg = loaded;
      } catch (err) {
        log(`[PLANNING] load trigger msg: ${err.message}`);
      }
    }
    return getQuotedMessageSafe(triggerMsg, planningChat);
  }

  async function executeSendNow(msg, session) {
    const runSession = { ...session };
    let quotedMsg = await resolveTriggerQuotedMsg(msg, runSession);

    if (runSession.hadMedia) {
      runSession.filePath = await ensurePlanningMediaFile(runSession, quotedMsg, async () => {
        quotedMsg = await resolveTriggerQuotedMsg(msg, runSession);
        return quotedMsg;
      });
      if (!runSession.filePath) {
        await botReply(msg, MEDIA_REQUIRED_REPLY);
        return;
      }
    }

    let sent = false;
    if (runSession.filePath || (runSession.messageText && !runSession.hadMedia)) {
      sent = await sendStoredDraftToSet(session.setKey, runSession, msg);
    } else if (quotedMsg) {
      sent = await sendQuotedToSet(session.setKey, quotedMsg, msg, {
        filePathFallback: runSession.filePath,
        hadMedia: runSession.hadMedia,
      });
    } else {
      await botReply(msg, '❌ Could not load the quoted draft anymore. Start again with @sandesha send on a fresh reply.');
      return;
    }
    if (sent && session.sourcePromoId && markPromoSentFromPlanning) {
      await markPromoSentFromPlanning(session.sourcePromoId, { setKey: session.setKey });
    }
  }

  async function executeSchedule(msg, session, timeStr) {
    const runAt = parseScheduleTime(timeStr);
    if (!runAt) {
      await botReply(
        msg,
        `Could not understand time: "${timeStr}"\nTry: 9am, 9:30am, 9am tomorrow, 9am monday, 14:30`,
      );
      touchSession(chatIdFor(msg, null), session.operatorId, { step: 'await_time' });
      return;
    }

    const setKey = session.setKey;
    try {
      await validateScheduleTarget(setKey);
    } catch (e) {
      await botReply(msg, `Cannot schedule to "${setKey}": ${e.message}`);
      return;
    }

    const quotedMsg = await resolveTriggerQuotedMsg(msg, session);

    let messageText = session.messageText || '';
    let filePath = session.filePath || null;

    if (quotedMsg) {
      const bundle = await resolveQuotedTextBundle(quotedMsg);
      messageText = (bundle.text || bundle.inlineText || bundle.companionText || '').trim();
    }
    if (session.hadMedia) {
      filePath = await ensurePlanningMediaFile(session, quotedMsg, async () => (
        resolveTriggerQuotedMsg(msg, session)
      ));
      if (!filePath) {
        await botReply(msg, MEDIA_REQUIRED_REPLY);
        return;
      }
    }

    if (!messageText && !filePath) {
      await botReply(msg, '❌ Nothing to schedule (no text or media in the quoted draft).');
      return;
    }

    const schedules = loadSchedules();
    const runAtIso = runAt.toISOString();
    const targetNorm = setKey.toLowerCase();
    const schedule = {
      id: nextLocalScheduleId(schedules),
      message: messageText || '(media)',
      target: setKey,
      isSet: true,
      runAt: runAtIso,
      createdAt: new Date().toISOString(),
      createdBy: session.operatorId || null,
      source: 'planning-group',
    };
    if (filePath) schedule.filePath = filePath;
    if (session.sourcePromoId) schedule.sourceId = String(session.sourcePromoId);

    schedules.push(schedule);
    saveSchedules(schedules);
    if (session.sourcePromoId && linkScheduleToPromo) {
      await linkScheduleToPromo(session.sourcePromoId, schedule.id);
    }

    const timeUntil = formatTimeUntil(runAt);
    await botReply(
      msg,
      `Scheduled! ✅\n"${schedule.message.substring(0, 80)}${schedule.message.length > 80 ? '…' : ''}" → *${setKey}* (set)\nWill send: ${runAt.toLocaleString()}\n(${timeUntil})`,
    );
  }

  function resolveSetHint(hint, setKeys) {
    if (!hint || !setKeys?.length) return null;
    const fromNum = parseSetChoice(hint, setKeys);
    if (fromNum) return fromNum;
    const lower = String(hint).toLowerCase();
    const exact = setKeys.find((k) => k.toLowerCase() === lower);
    if (exact) return exact;
    // "to testing_sandesha" vs set key "testing-sandesha"
    const norm = lower.replace(/_/g, '-');
    return setKeys.find((k) => k.toLowerCase().replace(/_/g, '-') === norm) || null;
  }

  async function proceedAfterSetKey(msg, operatorId, chat, session, setKey) {
    const chatId = chatIdFor(msg, chat);
    const sets = loadSets();
    const members = sets[setKey] || sets[setKey.toLowerCase()];
    const outward = broadcastCount(members, getPlanningGroupJid?.());
    if (!members || members.length === 0) {
      await botReply(msg, `Set "${setKey}" has no groups. Pick another set or *cancel*.`);
      return true;
    }
    if (outward === 0) {
      await botReply(
        msg,
        `*${setKey}* is only this planning chat — not an outward send. Pick e.g. *vjn_sub_center_grps* or *cancel*.`,
      );
      return true;
    }

    const runSession = { ...session, setKey };

    if (session.when === 'now') {
      clearSession(chatId, operatorId);
      await executeSendNow(msg, runSession);
      return true;
    }

    if (session.when === 'schedule' && session.timeStr) {
      const runAt = parseScheduleTime ? parseScheduleTime(session.timeStr) : null;
      if (!runAt) {
        await botReply(
          msg,
          `Could not understand time: "${session.timeStr}"\nTry: 6pm today, 9am tomorrow, 9:30am monday`,
        );
        touchSession(chatId, operatorId, { ...runSession, step: 'await_time' });
        return true;
      }
      clearSession(chatId, operatorId);
      await executeSchedule(msg, runSession, session.timeStr);
      return true;
    }

    touchSession(chatId, operatorId, { step: 'await_when', setKey });
    await botReply(msg, `Set: *${setKey}* (${outward} groups)\n\n1 — Send now\n2 — Schedule\n\nReply *1* or *2*, or *cancel*`);
    return true;
  }

  async function tryStartFromTrigger(msg, operatorId, chat) {
    const chatId = chatIdFor(msg, chat);
    const parsed = parsePlanningCommand(msg.body);
    if (!parsed.ok) return false;

    const quotedMsg = await getQuotedMessageSafe(msg, chat);
    if (!quotedMsg) {
      await botReply(
        msg,
        'Reply to the draft (swipe → Reply), then e.g.\n`@sandesha send this now`\n`@sandesha send this at 6pm today`\n`@sandesha send this now to vjn_sub_center_grps`',
      );
      return true;
    }
    if (isBotReplyText && getQuotedText && isBotReplyText(getQuotedText(quotedMsg))) {
      await botReply(msg, 'Reply to the *flyer* or draft — not Sandesha\'s hint message.');
      return true;
    }

    const bundle = await resolveQuotedTextBundle(quotedMsg);
    const messageText = (bundle.text || bundle.inlineText || bundle.companionText || '').trim();
    if (!messageText && !quotedMsg.hasMedia) {
      await botReply(msg, '❌ Quoted message has no text or media to send.');
      return true;
    }

    const sets = loadSets();
    const { text, setKeys } = formatSetsMenu(sets, getPlanningGroupJid?.());
    if (setKeys.length === 0) {
      await botReply(msg, text);
      return true;
    }

    let sourcePromoId = null;
    if (findPromoIdByMessage && messageText) {
      sourcePromoId = findPromoIdByMessage(messageText) || null;
      if (sourcePromoId) log(`[PLANNING] Linked draft to board post ${sourcePromoId}`);
    }

    const quotedStanzaId = stanzaIdFromMsg?.(quotedMsg) || null;
    let filePath = null;
    if (quotedMsg.hasMedia) {
      filePath = await ensurePlanningMediaFile(
        { filePath: null, quotedStanzaId, hadMedia: true },
        quotedMsg,
        async () => getQuotedMessageSafe(msg, chat),
      );
      if (!filePath) {
        await botReply(msg, MEDIA_REQUIRED_REPLY);
        return true;
      }
    }

    const sessionPatch = {
      step: 'await_set',
      setKeys,
      triggerMsgId: msgSerializedId(msg),
      messageText,
      quotedMsgId: msgSerializedId(quotedMsg),
      quotedStanzaId,
      sourcePromoId,
      filePath,
      hadMedia: !!quotedMsg.hasMedia,
      when: parsed.when ?? null,
      timeStr: parsed.timeStr || null,
    };

    const hintedSet = resolveSetHint(parsed.setHint, setKeys);
    if (hintedSet) {
      touchSession(chatId, operatorId, sessionPatch);
      return proceedAfterSetKey(msg, operatorId, chat, getSession(chatId, operatorId), hintedSet);
    }

    touchSession(chatId, operatorId, sessionPatch);
    if (parsed.when === 'now') {
      await botReply(msg, `${text}\n\n_(You said *now* — pick a set and it will send immediately.)_`);
    } else if (parsed.when === 'schedule' && parsed.timeStr) {
      await botReply(msg, `${text}\n\n_(Scheduled for *${parsed.timeStr}* after you pick a set.)_`);
    } else {
      await botReply(msg, text);
    }
    return true;
  }

  async function handleSession(msg, operatorId, chat) {
    const chatId = chatIdFor(msg, chat);
    const session = getSession(chatId, operatorId);
    if (!session) return false;

    const text = (msg.body || '').trim();
    if (!text) return true;

    if (isCancel(text)) {
      clearSession(chatId, operatorId);
      await botReply(msg, 'Planning send cancelled.');
      return true;
    }

    try {
      if (session.step === 'await_set') {
        const setKey = parseSetChoice(text, session.setKeys);
        if (!setKey) {
          await botReply(msg, 'Reply with a number or exact set name from the list, or *cancel*.');
          return true;
        }
        return proceedAfterSetKey(msg, operatorId, chat, session, setKey);
      }

      if (session.step === 'await_when') {
        const choice = text.trim();
        if (choice === '1') {
          const runSession = { ...session };
          clearSession(chatId, operatorId);
          await executeSendNow(msg, runSession);
          return true;
        }
        if (choice === '2') {
          touchSession(chatId, operatorId, { step: 'await_time', setKey: session.setKey });
          await botReply(
            msg,
            'When should it go out?\nExamples: 9am, 9:30am, 9am tomorrow, 9am monday, 14:30',
          );
          return true;
        }
        await botReply(msg, 'Reply *1* (send now) or *2* (schedule), or *cancel*.');
        return true;
      }

      if (session.step === 'await_time') {
        clearSession(chatId, operatorId);
        await executeSchedule(msg, session, text);
        return true;
      }

      clearSession(chatId, operatorId);
      return false;
    } catch (err) {
      log(`[PLANNING] wizard error: ${err.message}`);
      clearSession(chatId, operatorId);
      await botReply(msg, `Error: ${err.message}`);
      return true;
    }
  }

  async function handleIngress(msg, chat) {
    if (!configuredOperators.length) return false;
    if ((msg.body || '').includes('Reply to the draft first')) return false;

    const operatorId = resolveOperatorId(
      msg,
      configuredOperators,
      normalizePhoneDigits,
      getMyNumber,
    );
    if (!operatorId) return false;

    const chatId = chatIdFor(msg, chat);

    if (await handleQueueCommand(msg)) return true;

    // New @sandesha/@sv send always restarts the wizard (do not treat "send" as a set name).
    if (await isFreshPlanningTrigger(msg, chat)) {
      clearSession(chatId, operatorId);
      return tryStartFromTrigger(msg, operatorId, chat);
    }

    if (await handleSession(msg, operatorId, chat)) return true;

    if (
      !getSession(chatId, operatorId) &&
      isCancel(msg.body) &&
      isSandeshaMentioned(msg, getMyNumber?.(), mentionAliases, normalizePhoneDigits)
    ) {
      await botReply(
        msg,
        'No send wizard in progress.\n*@sandesha queue* — numbered list of scheduled sends\n*@sandesha cancel 1* — remove item #1 from the queue',
      );
      return true;
    }

    if (!parsePlanningCommand(msg.body).ok) return false;

    if (isSandeshaMentioned(msg, getMyNumber?.(), mentionAliases, normalizePhoneDigits)) {
      await botReply(
        msg,
        'Reply to the draft (swipe → Reply), then e.g.\n`@sandesha send this now`\n`@sandesha send this at 6pm today`\n`@sandesha send this now to vjn_sub_center_grps`\n\n*@sandesha queue* · *@sandesha cancel 1* (scheduled sends)',
      );
      return true;
    }

    return false;
  }

  return { handleSession, tryStartFromTrigger, handleIngress, handleSessionForOperator: handleSession };
}

module.exports = {
  createPlanningSendWizard,
  parsePlanningCommand,
  parsePlanningQueueCommand,
  listUpcomingSchedules,
  formatQueueMenu,
  parsePlanningOperators,
  stripMentionTokens,
  isSandeshaMentioned,
  isAllowedPlanningOperator,
  resolveOperatorId,
  formatSetsMenu,
  parseSetChoice,
  extractAuthorJid,
};

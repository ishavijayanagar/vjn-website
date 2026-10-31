'use strict';

const { stripMentionTokens, isSandeshaMentioned } = require('./planning-send');

const REPLIES = [
  'Happy to help 🙏',
  'Namaskaram 🙏 — glad it worked.',
  'Anytime 🙏',
  '🙏 Thank you — happy to serve Vijayanagar.',
  'All the best 🙏',
];

/** Short gratitude / praise — only when @sandesha or @sv is in the message. */
function isComplimentMessage(body, { mentionAliases, getMyNumber, normalizePhoneDigits, msg } = {}) {
  const raw = String(body || '').trim();
  if (!raw || raw.length > 160) return false;
  if (raw.startsWith('> Namaskaram')) return false;

  const mentioned = msg && isSandeshaMentioned(msg, getMyNumber?.(), mentionAliases, normalizePhoneDigits);
  if (!mentioned) return false;

  let t = stripMentionTokens(raw).toLowerCase().replace(/[!.🙏]+$/g, '').trim();
  t = t
    .replace(/\bu\s*r\b/g, 'you are')
    .replace(/\bur\b/g, 'you are')
    .replace(/\byoure\b/g, 'you are')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return true;

  const youPraise =
    /^(you are|you're)\s+(great|awesome|amazing|the best|good|nice|wonderful|fantastic|a star|the goat)[\s!.🙏]*$/i.test(t);

  const praise =
    youPraise
    || /^(thanks?|thank you|thx|ty|dhanyavada?|ಧನ್ಯವಾದ)[\s!.🙏]*$/i.test(t)
    || /^(good\s+(job|work)|well done|nice one|nice work|great work|great job|awesome|super|excellent|perfect|lovely|amazing|fantastic|brilliant|kudos)[\s!.🙏]*$/i.test(t)
    || /^(you are|you're)\s+(the best|awesome|great|amazing|a star|the goat)[\s!.🙏]*$/i.test(t);

  if (praise) return true;
  if (/thank|dhanyavada|ಧನ್ಯವಾದ|good job|well done|nice work|great work/i.test(t)) return true;

  return false;
}

const HELP_LINE =
  'To post a draft: reply to it with *@sandesha send*.\n*@sandesha queue* shows what is scheduled.';

const TIME_GREETING = /^(good\s+)?(morning|afternoon|evening|night)$|^g[mn]$/i;
const PLAIN_GREETING =
  /^((hi+|hello+|hey+|hii+|hlo|heya?|yo|namaste|namaskar(a|am)?|namaskaara|pranam|vanakkam|sat\s*sri\s*akal|jai\s*guru|hari\s*om)(\s+(there|team|all|everyone|sir|madam))?)$/i;

/** "@sandesha hi" / "@sv good morning" — only with the mention, like thanks. */
function greetingKind(body, { mentionAliases, getMyNumber, normalizePhoneDigits, msg } = {}) {
  const raw = String(body || '').trim();
  if (!raw || raw.length > 60) return null;
  if (raw.startsWith('> Namaskaram')) return null;

  const mentioned = msg && isSandeshaMentioned(msg, getMyNumber?.(), mentionAliases, normalizePhoneDigits);
  if (!mentioned) return null;

  const t = stripMentionTokens(raw).toLowerCase().replace(/[!.,?🙏\s]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return 'plain'; // just "@sandesha"
  const timeMatch = TIME_GREETING.exec(t);
  if (timeMatch) {
    const word = (timeMatch[2] || (t === 'gm' ? 'morning' : 'night')).toLowerCase();
    return word;
  }
  if (PLAIN_GREETING.test(t)) return 'plain';
  return null;
}

function isGreetingMessage(body, opts) {
  return greetingKind(body, opts) !== null;
}

function greetingReply(kind) {
  if (['morning', 'afternoon', 'evening', 'night'].includes(kind)) {
    return `Good ${kind} 🙏 — how can I help?\n\n${HELP_LINE}`;
  }
  return `How can I help?\n\n${HELP_LINE}`;
}

function pickReply() {
  return REPLIES[Math.floor(Math.random() * REPLIES.length)];
}

async function tryComplimentReply(msg, deps) {
  const { botReply, mentionAliases, getMyNumber, normalizePhoneDigits } = deps;
  if (!botReply || !msg?.body) return false;
  const opts = { mentionAliases, getMyNumber, normalizePhoneDigits, msg };
  const greeting = greetingKind(msg.body, opts);
  if (greeting) {
    await botReply(msg, greetingReply(greeting));
    return true;
  }
  if (!isComplimentMessage(msg.body, opts)) return false;
  await botReply(msg, pickReply());
  return true;
}

module.exports = { isComplimentMessage, isGreetingMessage, greetingKind, greetingReply, tryComplimentReply, pickReply };

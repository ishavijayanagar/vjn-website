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

function pickReply() {
  return REPLIES[Math.floor(Math.random() * REPLIES.length)];
}

async function tryComplimentReply(msg, deps) {
  const { botReply, mentionAliases, getMyNumber, normalizePhoneDigits } = deps;
  if (!botReply || !msg?.body) return false;
  if (!isComplimentMessage(msg.body, { mentionAliases, getMyNumber, normalizePhoneDigits, msg })) {
    return false;
  }
  await botReply(msg, pickReply());
  return true;
}

module.exports = { isComplimentMessage, tryComplimentReply, pickReply };

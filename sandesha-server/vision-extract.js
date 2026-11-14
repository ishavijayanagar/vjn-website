'use strict';

/**
 * Reads volunteer details out of a photo or screenshot with a vision model on OpenRouter.
 * Every request asks OpenRouter to use only providers that do not store or train on prompts
 * (provider.data_collection = deny); OPENROUTER_ZDR=1 also demands zero data retention. If no model
 * qualifies, the request fails rather than falling back to one that does not. Set OPENROUTER_API_KEY, and OPENROUTER_MODEL (one model id, or several separated by commas that are
 * tried in turn: free models are often busy). The photo is sent to that provider, so it should only
 * contain details people gave for volunteering. Whatever comes back is only a draft: the team checks
 * it in the preview before anything is saved.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_BASE64 = 8 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const PROMPT = [
  'This image shows details of people who want to volunteer (a list, table, form or chat screenshot).',
  'Extract every person as a JSON array. Each item has exactly these keys:',
  '"name", "whatsapp" (phone number as written), "area" (where they stay), "ie_completion" (Inner Engineering completion, as written),',
  '"vol_type" ("In-Person Volunteering", "Online Volunteering" or "Both"), "availability" ("Weekdays", "Weekends" or "Both"),',
  '"profession" (one of: Student, IT / Tech / Design, Teacher / Educator, Business / Management, Homemaker, Retired, Other), "skill",',
  'and "volunteer_remarks" (anything else they said).',
  'Use "" for anything not shown. Do not invent or guess values. Reply with ONLY the JSON array, no other text.',
].join(' ');

/** The JSON array inside a model reply (it may come wrapped in prose or a code fence). */
function parseReply(content) {
  const s = String(content || '');
  const from = s.indexOf('[');
  const to = s.lastIndexOf(']');
  if (from < 0 || to <= from) throw new Error('The model did not return a list.');
  const arr = JSON.parse(s.slice(from, to + 1));
  if (!Array.isArray(arr)) throw new Error('The model did not return a list.');
  return arr.filter((r) => r && typeof r === 'object');
}

function createVisionExtractor({ apiKey, models, zdr = false, fetchImpl = globalThis.fetch, timeoutMs = 90000, log = () => {} }) {
  const list = String(models || '').split(',').map((m) => m.trim()).filter(Boolean);
  if (!apiKey || !list.length) return null; // not configured

  return async function extractImage({ base64, mimeType }) {
    const mime = String(mimeType || '').toLowerCase();
    const data = String(base64 || '').replace(/^data:[^,]*,/, '');
    if (!TYPES.includes(mime)) throw Object.assign(new Error('Use a PNG, JPG, WEBP or GIF image.'), { status: 400 });
    if (!data) throw Object.assign(new Error('No image received.'), { status: 400 });
    if (data.length > MAX_BASE64) throw Object.assign(new Error('That image is too large (max about 6 MB).'), { status: 413 });

    let lastErr = 'No model answered.';
    for (const model of list) {
      const t0 = Date.now();
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        let res;
        try {
          res = await fetchImpl(ENDPOINT, {
            method: 'POST',
            signal: ctl.signal,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              temperature: 0,
              // Only providers that do not store or train on prompts; zdr also requires zero data retention.
              provider: { data_collection: 'deny', ...(zdr ? { zdr: true } : {}) },
              messages: [{ role: 'user', content: [
                { type: 'text', text: PROMPT },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } },
              ] }],
            }),
          });
        } finally { clearTimeout(timer); }
        if (!res.ok) { lastErr = `${model}: HTTP ${res.status}`; log(`[vol-interests] photo read failed (${lastErr}) after ${Date.now() - t0} ms`); continue; }
        const body = await res.json();
        const rows = parseReply(body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content);
        log(`[vol-interests] photo read by ${(body && body.model) || model}: ${rows.length} rows in ${Date.now() - t0} ms`);
        return rows;
      } catch (err) {
        lastErr = `${model}: ${err.name === 'AbortError' ? 'timed out' : err.message}`;
        log(`[vol-interests] photo read failed (${lastErr}) after ${Date.now() - t0} ms`);
      }
    }
    throw Object.assign(new Error(`Could not read the image right now (${lastErr}). Try again, or paste the details instead.`), { status: 502 });
  };
}

module.exports = { createVisionExtractor, parseReply };

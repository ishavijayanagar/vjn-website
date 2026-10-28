'use strict';

/**
 * Uploads nobody is waiting for any more. A schedule drops its attachment once
 * the last row has gone out, but an upload whose schedule failed, was never
 * saved, or was only sent by hand stays in media/. Anything older than
 * `maxAgeMs` that no queued row points at is removed; newer files are kept
 * so a retry or an unfinished draft can still use them.
 */

const fs = require('fs');
const path = require('path');

function pruneMedia({ dir, referenced = [], maxAgeMs = 3 * 24 * 3600e3, now = Date.now(), log = () => {} }) {
  const keep = new Set(referenced.map((p) => path.basename(String(p || ''))));
  let removed = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    if (keep.has(name)) continue;
    const abs = path.join(dir, name);
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || now - st.mtimeMs < maxAgeMs) continue;
      fs.unlinkSync(abs);
      removed++;
    } catch { /* gone already */ }
  }
  if (removed) log(`[media] removed ${removed} unused upload(s)`);
  return removed;
}

module.exports = { pruneMedia };

/**
 * Turn an audience selection into schedule rows. Lives apart from the compose
 * screen so the promotions board can queue a post without parsing that screen.
 */
import { getState } from './store.js?v=34';
import { toast } from './toast.js';

/** Sets stay whole so the server expands them once, not one row per group. */
export function scheduleTargets(selections) {
  const { sets, groups } = getState();
  const out = [];
  const seen = new Set();

  for (const t of selections || []) {
    if (!t?.value) continue;
    if (t.type === 'set') {
      const name = String(t.value);
      const members = sets[name.toLowerCase()] || sets[name] || [];
      if (!members.length) {
        toast(`Set "${name}" has no groups`, 'err');
        continue;
      }
      const key = `set:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ target: name, isSet: true });
      continue;
    }
    const value = String(t.value);
    if (!seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      out.push({ target: value, isSet: false });
    }
    const g = (groups || []).find(
      (x) => x.jid === value || (x.name && x.name.toLowerCase() === value.toLowerCase()),
    );
    if (g?.name) seen.add(String(g.name).toLowerCase());
    if (g?.jid) seen.add(String(g.jid).toLowerCase());
  }
  return out;
}

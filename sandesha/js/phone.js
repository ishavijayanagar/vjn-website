/**
 * Shared phone-number parsing for the add-members and bulk-send screens.
 */

/**
 * WhatsApp "LID" identifiers look like phone numbers but aren't dialable.
 * They're typically 13+ digits, and the NANP-looking ones start with 1 but
 * aren't 11 digits. Real MSISDNs here are 10–13 (India 12, Nepal 13, NANP 11).
 */
export function looksLikeLid(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length >= 14) return true;                 // 15–16 digit LIDs
  if (d[0] === '1' && d.length !== 11) return true; // NANP is exactly 1 + 10
  return false;
}

/** Digits only, kept only when it looks like a real, dialable number. */
export function digitsFromPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return '';
  if (looksLikeLid(d)) return '';
  return d;
}

/** Split a pasted blob on newlines / commas / semicolons / spaces. */
export function splitNumberBlob(text) {
  return String(text || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse a blob into { valid, invalid }.
 * `valid` is de-duped, order-preserving digit strings.
 */
export function parseNumbers(text) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const token of splitNumberBlob(text)) {
    const d = digitsFromPhone(token);
    if (!d) { invalid.push(token); continue; }
    if (seen.has(d)) continue;
    seen.add(d);
    valid.push(d);
  }
  return { valid, invalid };
}

/** Pretty +CC ..... grouping for display; falls back to the raw digits. */
export function formatNumber(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length < 10) return d;
  const cc = d.length > 10 ? d.slice(0, d.length - 10) : '';
  const rest = d.slice(-10);
  return `${cc ? `+${cc} ` : ''}${rest.slice(0, 5)} ${rest.slice(5)}`.trim();
}

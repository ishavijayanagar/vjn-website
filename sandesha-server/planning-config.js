'use strict';

const fs = require('fs');
const path = require('path');
const { parsePlanningOperators } = require('./planning-send');

const CONFIG_FILE = path.join(__dirname, 'planning-config.json');

let onChangeHook = null;

function loadFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function saveFile(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

function normalizeOperatorList(list, normalizePhoneDigits) {
  const norm = normalizePhoneDigits || ((d) => String(d).replace(/\D/g, ''));
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const d = norm(String(entry || '').replace(/\D/g, ''));
    if (d.length >= 10 && d.length <= 15 && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

/**
 * Effective planning-group settings: JSON file overrides env for group;
 * operators from file if non-empty, else env.
 */
function getEffectiveSettings(env = process.env, normalizePhoneDigits) {
  const file = loadFile();
  const envOperatorRaw = [env.SANDESHA_PLANNING_OPERATOR, env.SANDESHA_PLANNING_OPERATORS]
    .filter(Boolean)
    .join(',');
  const envOperators = parsePlanningOperators(envOperatorRaw, normalizePhoneDigits);
  const fileOperators = normalizeOperatorList(file.operators, normalizePhoneDigits);

  const groupJid = String(file.groupJid || env.SANDESHA_PLANNING_GROUP_JID || '').trim();
  const groupName = String(
    file.groupName || env.SANDESHA_PLANNING_GROUP_NAME || 'Promotions Planning',
  ).trim();
  const operators = fileOperators.length ? fileOperators : envOperators;
  const mentionAliases = String(env.SANDESHA_PLANNING_MENTION_ALIASES || 'sandesha,sv')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    groupJid,
    groupName,
    operators,
    mentionAliases,
    configuredInFile: Boolean(file.groupJid || file.groupName || fileOperators.length),
  };
}

function getPublicConfig(normalizePhoneDigits) {
  const s = getEffectiveSettings(process.env, normalizePhoneDigits);
  return {
    groupJid: s.groupJid,
    groupName: s.groupName,
    operators: s.operators,
    enabled: Boolean(s.operators.length && (s.groupJid || s.groupName)),
    source: s.configuredInFile ? 'file' : 'env',
  };
}

function validatePayload(body, normalizePhoneDigits) {
  const groupJid = String(body?.groupJid || '').trim();
  const groupName = String(body?.groupName || '').trim();
  const operators = normalizeOperatorList(body?.operators, normalizePhoneDigits);

  if (!groupJid || !groupJid.endsWith('@g.us')) {
    return { error: 'Pick a WhatsApp group (valid group JID required).' };
  }
  if (!groupName) {
    return { error: 'Group name is required.' };
  }
  if (!operators.length) {
    return { error: 'Add at least one operator phone number.' };
  }
  if (operators.length > 8) {
    return { error: 'At most 8 operator numbers allowed.' };
  }
  return {
    data: { groupJid, groupName, operators, updatedAt: new Date().toISOString() },
  };
}

async function savePlanningConfig(body, normalizePhoneDigits) {
  const verdict = validatePayload(body, normalizePhoneDigits);
  if (verdict.error) return { ok: false, error: verdict.error };
  saveFile(verdict.data);
  if (onChangeHook) await onChangeHook(verdict.data);
  return { ok: true, config: getPublicConfig(normalizePhoneDigits) };
}

function setOnChange(fn) {
  onChangeHook = typeof fn === 'function' ? fn : null;
}

module.exports = {
  CONFIG_FILE,
  loadFile,
  getEffectiveSettings,
  getPublicConfig,
  savePlanningConfig,
  validatePayload,
  normalizeOperatorList,
  setOnChange,
};

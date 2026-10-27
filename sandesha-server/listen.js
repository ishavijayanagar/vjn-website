const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const auth = require('./auth');
const { createApiHandlers } = require('./api-handlers');
const { createSettingsWizard } = require('./settings');
const { createBulkSendWizard } = require('./bulk-send');
const { createBulkAddMembersWizard } = require('./bulk-add-members');
const { isNotifyConfigured, formatPairingCode, sendPairingCodeEmail, sendQrEmail } = require('./notify-email');
const safety = require('./send-safety');
const activity = require('./activity');
const reach = require('./reach');
const push = require('./push');
// Summary activity events (job results, scheduled sends) also go out as Web Push.
activity.setPushSender((audience, payload) => push.notify(audience, payload));
const { isWhatsAppSessionError } = require('./wa-session');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

// Single instance lock - prevent running bot twice
const LOCK_FILE = path.join(__dirname, '.lock');

if (fs.existsSync(LOCK_FILE)) {
  console.error('❌ Bot is already running! Delete .lock file if not.');
  process.exit(1);
}
fs.writeFileSync(LOCK_FILE, process.pid.toString());

function clearLockFile() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

process.on('exit', clearLockFile);

const SESSION_PATH = path.join(__dirname, '.wwebjs_auth');

/** True when a previous LocalAuth Chromium profile looks present. */
function hasSavedWhatsAppSession() {
  const base = path.join(SESSION_PATH, 'session', 'Default');
  return (
    fs.existsSync(path.join(base, 'IndexedDB')) ||
    fs.existsSync(path.join(base, 'Local Storage'))
  );
}

function clearLocalAuthSession() {
  try {
    if (fs.existsSync(SESSION_PATH)) {
      fs.rmSync(SESSION_PATH, { recursive: true, force: true });
      log('Cleared WhatsApp session files — new pairing required');
    }
  } catch (err) {
    log('Could not clear session files:', err.message);
  }
}

const QR_PATH = path.join(__dirname, 'qr-code.png');
const GROUPS_FILE = path.join(__dirname, 'groups.json');
const DOCS_DIR = path.join(__dirname, 'docs');
const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');
const DELIVERED_FILE = path.join(__dirname, 'delivered.json');
const DELIVERED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NOTIFY_FILE = path.join(__dirname, 'notifications.log');
const MEDIA_DIR = path.join(__dirname, 'media');
const LOG_FILE = path.join(__dirname, 'sandesha.log');
const ZC_WEBHOOK = 'http://127.0.0.1:42617/webhook';
const LISTEN_PORT = 42620;
const COMMANDS_GROUP_NAME = 'Me Commands';
const COMMANDS_GROUP_JID = '120363426133559474@g.us';

// Pairing-code login (remote-friendly) when SANDESHA_PAIRING_PHONE is set.
const pairingPhone = (process.env.SANDESHA_PAIRING_PHONE || '').replace(/\D/g, '');
/** qr = scan QR only; phone = pairing code only; auto = try phone, fall back to QR */
const authMode = (process.env.SANDESHA_AUTH_MODE || 'auto').toLowerCase();
let useQrAuth = authMode === 'qr' || !pairingPhone;
let pairingPhoneFailed = false;

function isPairingCodeFailure(reason) {
  const msg = reason && reason.message ? reason.message : String(reason || '');
  const stack = reason && reason.stack ? reason.stack : '';
  return /requestPairingCode|PairingCodeLinkUtils|ExecutionContext\.js:391/i.test(`${msg}\n${stack}`);
}

function switchToQrAuth(reason) {
  if (useQrAuth || !pairingPhone) return false;
  useQrAuth = true;
  pairingPhoneFailed = true;
  log(
    'Phone pairing code unavailable (WhatsApp Web changed) — using QR scan instead.',
    reason ? `(${reason})` : ''
  );
  clearLocalAuthSession();
  setWaLink({
    state: 'pairing',
    reason: 'pairing_code_unavailable',
    pairingCode: null,
    pairingCodeRaw: null,
  });
  return true;
}

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

function log(...args) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${msg}`;
  console.error(logLine);
  fs.appendFileSync(LOG_FILE, logLine + '\n');
}

let lastReplyText = null;
let recentReplies = new Set();
let myNumber = null;
let commandsGroupJid = null;
let sendServer = null;
let apiHandlers = null;

/** WhatsApp link state — dashboard stays up even when this is disconnected/pairing. */
const waLink = {
  state: 'starting', // starting | connecting | connected | disconnected | pairing
  reason: null,
  pairingCode: null,
  pairingCodeRaw: null,
  pairingAt: null,
  qrIssued: false,
  updatedAt: new Date().toISOString(),
};

function setWaLink(patch) {
  Object.assign(waLink, patch, { updatedAt: new Date().toISOString() });
}

function clearStalePairingArtifacts() {
  waLink.pairingCode = null;
  waLink.pairingCodeRaw = null;
  waLink.qrIssued = false;
  try {
    if (fs.existsSync(QR_PATH)) fs.unlinkSync(QR_PATH);
  } catch { /* ignore */ }
}

function getWhatsAppHealth(authed) {
  const connected = waLink.state === 'connected';
  const hasCode = Boolean(waLink.pairingCode);
  const hasQr = waLink.state === 'pairing' && waLink.qrIssued && fs.existsSync(QR_PATH);
  const needsPairing = hasCode || hasQr;

  const base = {
    connected,
    state: waLink.state,
    reason: waLink.reason || null,
    updatedAt: waLink.updatedAt,
    pairingPhoneConfigured: Boolean(pairingPhone),
    needsPairing,
  };
  if (!authed) {
    return {
      ...base,
      qrAvailable: hasQr,
    };
  }
  return {
    ...base,
    pairingCode: hasCode ? waLink.pairingCode : null,
    pairingAt: hasCode ? waLink.pairingAt : null,
    qrAvailable: hasCode ? false : hasQr,
    instructions: hasCode
      ? 'On your phone: WhatsApp → Linked devices → Link a device → Link with phone number → enter the code.'
      : null,
  };
}

const BOT_GREETING = '> Namaskaram 🙏,';

const BOT_REPLY_PREFIXES = [
  'Group Sets:',
  'Scheduled! ✅',
  'Sent to ',
  'Contacts:',
  'No groups',
  'No sets defined',
  '📱 *Groups',
  '📋 *All Groups',
  '━━━━━━━━━━━━━━━━━━━━',
  'Unknown command:',
  'Cannot schedule',
  'Usage:',
  'Added contact:',
  'Cancelled:',
  'Scheduled messages',
  'Forwarding ',
  'Sending to ',
  'Progress: checked',
  'Inactive groups',
  'All groups have been active',
];

function formatBotReply(text) {
  const body = (text || '').trim();
  if (body.startsWith(BOT_GREETING)) return body;
  return body ? `${BOT_GREETING}\n${body}` : BOT_GREETING;
}

function isBotReplyText(body) {
  if (!body) return false;
  const text = body.trim();
  if (recentReplies.has(text)) return true;
  for (const reply of recentReplies) {
    if (text.startsWith(reply) || reply.startsWith(text)) return true;
  }
  if (text.startsWith(BOT_GREETING)) return true;
  const inner = text.replace(new RegExp(`^${BOT_GREETING}\\n?`), '').trim();
  return BOT_REPLY_PREFIXES.some(prefix => inner.startsWith(prefix) || text.startsWith(prefix));
}

function trackReply(text) {
  recentReplies.add(text);
  setTimeout(() => recentReplies.delete(text), 30000);
}

async function botReply(msg, text) {
  const full = formatBotReply(text);
  trackReply(full);
  lastReplyText = full;
  await msg.reply(full);
}

function loadSets() {
  try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch { return {}; }
}

function saveSets(sets) {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(sets, null, 2));
}

let settingsWizard = null;
let bulkSendWizard = null;
let bulkAddMembersWizard = null;

function loadSchedules() {
  try { return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8')); } catch { return []; }
}

function saveSchedules(schedules) {
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

/**
 * What was actually delivered, kept for a week.
 *
 * A delivered row is dropped from schedules.json, so "the row is gone" was the
 * only thing the promotions board could infer a send from. That is a negative
 * signal — a row cancelled by hand, a lost schedule-id link, or an unreachable
 * server all read the same as "sent", or as "never sent". Holding the positive
 * evidence, sourceId included, lets the board be told rather than guess.
 */
function loadDelivered() {
  try {
    const rows = JSON.parse(fs.readFileSync(DELIVERED_FILE, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function recordDelivered(schedules) {
  if (!schedules || !schedules.length) return;
  const cutoff = Date.now() - DELIVERED_TTL_MS;
  const rows = loadDelivered().filter(
    (r) => new Date(r.sentAt || 0).getTime() >= cutoff,
  );
  const sentAt = new Date().toISOString();
  for (const s of schedules) {
    rows.push({
      id: s.id,
      sourceId: s.sourceId ? String(s.sourceId) : '',
      target: s.target || '',
      sentAt,
    });
  }
  try {
    fs.writeFileSync(DELIVERED_FILE, JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('[DELIVERED] could not record:', err.message);
  }
}

const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

function loadContacts() {
  try { return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8')); } catch { return { contacts: {} }; }
}

function saveContacts(data) {
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(data, null, 2));
}

/**
 * After WhatsApp connects, import contacts that are saved in the phone's
 * address book (isMyContact === true) into contacts.json.
 * Does NOT overwrite names the user has already customised — only adds new ones.
 */
/**
 * A real phone number has 10–15 digits.
 * WhatsApp Linked-Device IDs (LIDs) look like 15–16 digit numbers — reject them.
 * We also reject anything that doesn't survive normalisePhoneDigits to 10–13 digits
 * (Indian numbers with country code = 12 digits).
 */
function isRealPhoneNumber(digits) {
  if (!digits || digits.length < 10 || digits.length > 15) return false;
  // LID values typically start with 10–12 digit prefixes like 100…, 101…, 257…, 130…
  // A normalised Indian/international number is 10–13 digits after country code expansion.
  const normalised = normalizePhoneDigits(digits);
  return normalised.length >= 10 && normalised.length <= 13;
}

async function syncPhoneBookContacts(waClient) {
  try {
    log('[contacts] syncing phone-book contacts from WhatsApp…');
    const waContacts = await waClient.getContacts();

    const saved = loadContacts();
    const existing = saved.contacts || {};

    // --- Step 1: Remove LID values already saved from a previous bad sync ---
    let cleaned = 0;
    for (const [name, number] of Object.entries(existing)) {
      const digits = String(number || '').replace(/\D/g, '');
      if (!isRealPhoneNumber(digits)) {
        delete existing[name];
        cleaned++;
      }
    }
    if (cleaned > 0) log(`[contacts] removed ${cleaned} bad LID entries from contacts.json`);

    // --- Step 2: Build reverse map of valid existing entries ---
    const existingByPhone = new Map();
    for (const [name, number] of Object.entries(existing)) {
      const digits = normalizePhoneDigits(String(number || '').replace(/\D/g, ''));
      existingByPhone.set(digits, name);
    }

    // --- Step 3: Import phone-book contacts, skipping LID JIDs ---
    let added = 0;
    let skipped = 0;

    for (const c of waContacts) {
      if (!c || !c.isMyContact || c.isGroup || c.isMe || c.isBroadcast || !c.isUser) continue;

      // Skip @lid contacts — their contact.number is a LID value, not a phone number
      const jid = String(c.id?._serialized || '');
      if (jid.endsWith('@lid')) continue;

      const rawNum = String(c.number || '').replace(/\D/g, '');
      if (!isRealPhoneNumber(rawNum)) continue;
      const phone = normalizePhoneDigits(rawNum);

      if (existingByPhone.has(phone)) { skipped++; continue; }

      const name = (c.name || c.pushname || c.shortName || '').trim();
      if (!name) continue;

      let label = name;
      if (Object.prototype.hasOwnProperty.call(existing, label)) {
        label = `${name} (${phone.slice(-4)})`;
      }

      existing[label] = phone;
      existingByPhone.set(phone, label);
      added++;
    }

    saveContacts({ contacts: existing });
    log(`[contacts] imported ${added} contacts, ${skipped} already saved, ${cleaned} bad entries removed`);
  } catch (err) {
    log(`[contacts] phone-book sync failed: ${err.message}`);
  }

  if (apiHandlers) {
    apiHandlers.warmContactIndex().catch((err) => log('contact index warm:', err.message));
  }
}

function resolveContact(name) {
  const contacts = loadContacts();
  const nameLower = name.toLowerCase();
  for (const [key, number] of Object.entries(contacts.contacts)) {
    if (key.toLowerCase() === nameLower || number.toLowerCase().includes(nameLower)) {
      return number;
    }
  }
  return null;
}

// Use system Chrome/Chromium if set (required when installing with PUPPETEER_SKIP_DOWNLOAD=1).
const puppeteerExecutable =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  process.env.CHROME_PATH ||
  undefined;

function buildClientOptions() {
  const opts = {
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
    puppeteer: {
      headless: true,
      ...(puppeteerExecutable ? { executablePath: puppeteerExecutable } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    }
  };
  // Pairing is only used when WhatsApp reports UNPAIRED; LocalAuth restores
  // an existing .wwebjs_auth session without needing a new code.
  if (pairingPhone && !useQrAuth) {
    opts.pairWithPhoneNumber = {
      phoneNumber: pairingPhone,
      showNotification: true,
      intervalMs: 180000
    };
  }
  return opts;
}

let client = null;
let shuttingDown = false;
let readyInFlight = false;
let setupDone = false;
let reconnectTimer = null;
let isInitializing = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[SHUTDOWN] ${signal} — closing WhatsApp session cleanly (keeps login)...`);
  try {
    if (pollInterval) clearInterval(pollInterval);
    if (schedulerInterval) clearInterval(schedulerInterval);
    if (reconnectTimer) clearTimeout(reconnectTimer);
  } catch {}
  try {
    // Must destroy the Puppeteer browser so Chromium flushes LocalAuth to disk.
    // SIGKILL / skipping this often corrupts .wwebjs_auth and forces re-pairing.
    if (client) {
      await Promise.race([
        client.destroy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timeout')), 15000)),
      ]);
    }
    console.log('[SHUTDOWN] Browser closed — session saved.');
  } catch (err) {
    console.log('[SHUTDOWN] Browser close:', err.message || err);
  }
  clearLockFile();
  console.log('[SHUTDOWN] Goodbye!');
  process.exit(0);
}

process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });

let pollInterval = null;
let schedulerInterval = null;

async function announcePairingCode(code) {
  const formatted = formatPairingCode(code);
  setWaLink({
    state: 'pairing',
    pairingCode: formatted,
    pairingCodeRaw: String(code || ''),
    pairingAt: new Date().toISOString(),
    qrIssued: false,
    reason: waLink.reason || 'awaiting_pair',
  });
  console.log('\n📱 WhatsApp pairing code:', formatted);
  console.log('   Phone → Linked devices → Link a device → Link with phone number');
  console.log('   Enter:', formatted, '\n');
  log('Pairing code:', formatted);

  if (!isNotifyConfigured()) {
    log('Email notify skipped (set SANDESHA_NOTIFY_EMAIL + SMTP_* in .env)');
    return;
  }

  const result = await sendPairingCodeEmail(code);
  if (result.sent) {
    log('Pairing code emailed to', process.env.SANDESHA_NOTIFY_EMAIL);
  } else if (result.error) {
    log('Failed to email pairing code:', result.error);
  }
}

// 'idle' → 'sending' → 'sent'. Back to 'idle' only if the send fails,
// and only for a few attempts so a broken SMTP setup can't loop all day.
let qrEmailState = 'idle';
let qrEmailAttempts = 0;
const QR_EMAIL_MAX_ATTEMPTS = 3;
const QR_EMAIL_COOLDOWN_MS = 60 * 1000;
let lastQrEmailRequestAt = 0;

/**
 * Email the QR once per server start. WhatsApp re-emits a new QR every ~20s;
 * the rest are on the dashboard, so only the first one goes out by email.
 * A failed send is retried with the next QR (up to QR_EMAIL_MAX_ATTEMPTS),
 * since nothing reached the inbox.
 */
function emailQrThrottled() {
  if (!isNotifyConfigured() || qrEmailState !== 'idle') return;
  if (qrEmailAttempts >= QR_EMAIL_MAX_ATTEMPTS) return;
  qrEmailAttempts += 1;
  qrEmailState = 'sending';
  sendQrEmail(QR_PATH)
    .then((r) => {
      if (r.sent) {
        qrEmailState = 'sent';
        log('QR emailed to', process.env.SANDESHA_NOTIFY_EMAIL, '(once per start — later QRs are on the dashboard)');
      } else {
        qrEmailState = 'idle';
        if (r.error) log('Failed to email QR:', r.error);
      }
    })
    .catch((err) => {
      qrEmailState = 'idle';
      log('QR email error:', err.message);
    });
}

let readyWatchdogTimer = null;

function cancelReadyWatchdog() {
  if (readyWatchdogTimer) {
    clearTimeout(readyWatchdogTimer);
    readyWatchdogTimer = null;
  }
}

function scheduleReadyWatchdog(c) {
  cancelReadyWatchdog();
  // Soft check only — do not force reconnect loops (they made things worse).
  // If ready never comes, leave session alone; user can restart ./start.sh.
  readyWatchdogTimer = setTimeout(() => {
    readyWatchdogTimer = null;
    if (waLink.state === 'connected' || shuttingDown) return;
    log('Ready still pending after authenticated (no forced reconnect)');
  }, 90000);
}

function wireClientEvents(c) {
  if (pairingPhone && !useQrAuth) {
    c.on('code', (code) => {
      announcePairingCode(code).catch((err) => log('Pairing notify error:', err.message));
    });
  } else {
    c.on('qr', async (qr) => {
      setWaLink({
        state: 'pairing',
        pairingCode: null,
        pairingCodeRaw: null,
        pairingAt: new Date().toISOString(),
        qrIssued: true,
        reason: waLink.reason || 'awaiting_qr',
      });
      await QRCode.toFile(QR_PATH, qr, { width: 400 });
      log('QR saved to', QR_PATH);
      console.log('\n📱 Scan QR code with WhatsApp:\n');
      const qrcode = require('qrcode-terminal');
      qrcode.generate(qr, { small: true });
      console.log('\nOr open:', QR_PATH, '\n');
      console.log('(Tip: set SANDESHA_PAIRING_PHONE in .env for a code on the dashboard instead of scanning)\n');
      emailQrThrottled();
    });
  }

  c.on('loading_screen', (percent, message) => {
    log(`Loading WhatsApp Web: ${percent}% ${message || ''}`.trim());
    if (waLink.state !== 'connected' && waLink.state !== 'pairing') {
      setWaLink({ state: 'connecting', reason: `loading:${percent}` });
    }
  });

  c.on('authenticated', () => {
    log('Authenticated — waiting for WhatsApp ready…');
    clearStalePairingArtifacts();
    setWaLink({
      state: 'connecting',
      reason: 'authenticated',
      pairingCode: null,
      pairingCodeRaw: null,
      qrIssued: false,
    });
    // If ready never arrives, don't leave the UI stuck forever
    scheduleReadyWatchdog(c);
  });

  c.on('ready', async () => {
    cancelReadyWatchdog();
    if (readyInFlight) {
      log('ready: already running setup — skip duplicate');
      return;
    }
    readyInFlight = true;
    try {
      log('WhatsApp connected');
      myNumber = c.info?.wid?._serialized || null;
      log('My number:', myNumber);
      clearStalePairingArtifacts();
      setWaLink({
        state: 'connected',
        reason: null,
        pairingCode: null,
        pairingCodeRaw: null,
        qrIssued: false,
      });
      reconnectAttempts = 0;
      isInitializing = false;

      log('Applying WhatsApp Web chat-store patches...');
      await patchWhatsAppWebHelpers();

      log('Waiting for WhatsApp chat store...');
      const storeReady = await waitForWhatsAppStore();
      if (!storeReady) {
        log('WARNING: chat store still not ready — group lookup / poller may fail');
      }

      log('Setting up commands group...');
      await setupCommandsGroup();

      // Recreate API handlers so they always point at the current client
      apiHandlers = createApiHandlers({
        client: c,
        loadSchedules,
        saveSchedules,
        loadDelivered,
        loadContacts,
        saveContacts,
        loadSets,
        parseScheduleTime,
        validateScheduleTarget,
        resolveAndSend,
        withSendContext,
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
        budget: sendBudget,
        onSessionError: notifyWhatsAppSessionError,
      });

      startSendServer();
      if (!setupDone) {
        log('Starting message poller...');
        startMessagePoller();
        log('Starting scheduler...');
        startScheduler();
        reach.start();
        setupDone = true;
      }

      // Import phone-book contacts 60s after ready — avoids competing with the poller
      // and other heavy Puppeteer calls that happen at startup
      setTimeout(() => {
        syncPhoneBookContacts(c).catch((err) => log('contact sync:', err.message));
      }, 60000);

      settingsWizard = createSettingsWizard({ client: c, loadSets, saveSets, botReply, log });
      bulkSendWizard = createBulkSendWizard({
        resolveAndSend, botReply, log, delay, normalizePhoneDigits, budget: sendBudget,
      });
      bulkAddMembersWizard = createBulkAddMembersWizard({
        client: c,
        botReply,
        log,
        normalizePhoneDigits,
        resolveGroupByName,
        resolveParticipantWids,
      });
      log('Setup complete!');
      log(`Dashboard: http://127.0.0.1:${LISTEN_PORT}/`);
    } catch (err) {
      log('ready handler error:', err.message);
      setWaLink({ state: 'disconnected', reason: err.message });
      scheduleWhatsAppReconnect(err.message);
    } finally {
      readyInFlight = false;
    }
  });

  c.on('disconnected', (reason) => {
    handleWhatsAppDisconnected(reason);
  });

  c.on('message_create', (msg) => { handleIncomingMessage(msg); });
  c.on('message_create', (msg) => reach.onMessage(msg));
  c.on('message_ack', (msg, ack) => reach.onAck(msg, ack));
  c.on('message_reaction', (r) => reach.onReaction(r));
}

async function handleWhatsAppDisconnected(reason) {
  const reasonStr = String(reason || 'unknown');
  console.error(`[${new Date().toISOString()}] Disconnected: ${reasonStr}`);
  setWaLink({
    state: 'disconnected',
    reason: reasonStr,
    pairingCode: null,
    pairingCodeRaw: null,
  });
  myNumber = null;

  if (shuttingDown) return;
  if (isInitializing) {
    log('Disconnect during init — will retry after current attempt');
    return;
  }

  // Keep HTTP/dashboard alive; schedule a safe re-pair (do NOT call initialize on the same page)
  scheduleWhatsAppReconnect(reasonStr);
}

function scheduleWhatsAppReconnect(reason) {
  if (shuttingDown) return;
  if (reconnectAttempts >= MAX_RECONNECT) {
    log(`Max reconnect attempts (${MAX_RECONNECT}) reached — dashboard stays up; restart ./start.sh or wait for manual retry`);
    setWaLink({ state: 'disconnected', reason: `max_reconnect:${reason}` });
    // Keep retrying slowly so the app never fully gives up while running
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectAttempts = 0;
      scheduleWhatsAppReconnect('retry_after_max');
    }, 120000);
    return;
  }

  reconnectAttempts += 1;
  const delayMs = Math.min(30000, 4000 * reconnectAttempts);
  console.error(`[${new Date().toISOString()}] Reconnecting safely in ${Math.round(delayMs / 1000)}s (attempt ${reconnectAttempts}/${MAX_RECONNECT}) — dashboard stays online`);
  setWaLink({ state: 'disconnected', reason: `reconnect_scheduled:${reason}` });

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectWhatsApp(reason).catch((err) => {
      log('Reconnect error:', err.message);
      isInitializing = false;
      scheduleWhatsAppReconnect(err.message);
    });
  }, delayMs);
}

function notifyWhatsAppSessionError(err, where) {
  if (!isWhatsAppSessionError(err)) return false;
  const msg = String(err?.message || err || 'unknown');
  log(`[WA session] ${where}: ${msg}`);
  setWaLink({ state: 'disconnected', reason: msg });
  if (!shuttingDown && !isInitializing) {
    scheduleWhatsAppReconnect(msg);
  }
  return true;
}

function whatsAppUnavailableResponse(res, authed = true) {
  jsonResponse(res, 503, {
    error: 'WhatsApp session reconnecting — try again in a moment',
    whatsapp: getWhatsAppHealth(authed),
  });
}

/**
 * End any Chrome still using the WhatsApp profile: SIGTERM first (lets it
 * flush the session to disk), SIGKILL only if it is still there after 5s.
 * No-op where pkill is unavailable (Windows).
 */
async function stopStaleSessionBrowser() {
  const marker = `user-data-dir=${path.join(SESSION_PATH, 'session')}`;
  const { execFileSync } = require('child_process');
  const running = () => {
    try {
      execFileSync('pgrep', ['-f', marker], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  try {
    if (!running()) return;
    log('Stopping a leftover WhatsApp browser before reconnecting');
    execFileSync('pkill', ['-TERM', '-f', marker], { stdio: 'ignore' });
    for (let i = 0; i < 10 && running(); i++) await delay(500);
    if (running()) execFileSync('pkill', ['-KILL', '-f', marker], { stdio: 'ignore' });
  } catch (err) {
    log('Could not stop leftover browser:', err.message);
  }
}

async function reconnectWhatsApp(reason) {
  if (shuttingDown) return;
  if (isInitializing) return;
  isInitializing = true;

  const isLogout = /logout/i.test(String(reason || ''));
  log(`Safe reconnect starting (reason=${reason}, logout=${isLogout})`);

  try {
    if (client) {
      try {
        await Promise.race([
          client.destroy(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timeout')), 10000)),
        ]);
      } catch (err) {
        log('destroy before reconnect:', err.message);
      }
      client = null;
    }
    // A crashed page ("detached Frame") can leave its Chrome alive and holding
    // the profile lock, so every new launch fails with "browser is already
    // running". Clear it the same way start.sh does before relaunching.
    await stopStaleSessionBrowser();

    // LOGOUT / unpaired / broken phone pairing: clear LocalAuth for fresh QR/code
    if (
      isLogout ||
      /unpaired|logged out|pairing-code-failed|pairing_code_unavailable/i.test(String(reason || ''))
    ) {
      clearLocalAuthSession();
    }

    setWaLink({
      state: 'pairing',
      reason: String(reason || 'reconnecting'),
      pairingCode: null,
      pairingCodeRaw: null,
    });

    client = new Client(buildClientOptions());
    wireClientEvents(client);
    await client.initialize();
    // ready handler clears isInitializing on success
  } catch (err) {
    log('reconnectWhatsApp failed:', err.message);
    setWaLink({ state: 'disconnected', reason: err.message });
    isInitializing = false;
    throw err;
  }
}

function createAndStartWhatsApp() {
  if (hasSavedWhatsAppSession()) {
    log('Saved WhatsApp session found in .wwebjs_auth — reconnecting (no new code if still linked)');
  } else {
    log('No saved WhatsApp session — first-time login required');
  }

  if (pairingPhone && !useQrAuth) {
    log('Auth mode: pairing code for', pairingPhone, '(falls back to QR if unavailable)');
    if (isNotifyConfigured()) {
      log('Will email pairing codes to', process.env.SANDESHA_NOTIFY_EMAIL);
    }
  } else {
    log('Auth mode: QR scan', useQrAuth && pairingPhoneFailed ? '(phone pairing unavailable)' : '');
  }

  client = new Client(buildClientOptions());
  wireClientEvents(client);
  setWaLink({ state: 'starting', reason: null });
  client.initialize().catch((err) => {
    log('Initial WhatsApp initialize failed:', err.message);
    setWaLink({ state: 'disconnected', reason: err.message });
    scheduleWhatsAppReconnect(err.message);
  });
}

// Keep Node alive on Puppeteer / WA quirks — dashboard must not die with the browser
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT]', err && err.stack ? err.stack : err);
  const msg = err && err.message ? err.message : String(err);
  if (/already exists|Session closed|Target closed|Execution context was destroyed|Protocol error|detached Frame|Evaluation failed/i.test(msg)) {
    setWaLink({ state: 'disconnected', reason: msg });
    if (!shuttingDown && !isInitializing) {
      scheduleWhatsAppReconnect(msg);
    }
    return;
  }
  // Still keep process up for unexpected errors so tunnel + dashboard survive
  log('Uncaught exception (process kept alive for dashboard):', msg);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason && reason.message ? reason.message : String(reason);
  const stack = reason && reason.stack ? reason.stack : '';
  console.error('[UNHANDLED REJECTION]', msg);
  if (stack && msg === 't') {
    console.error(stack.split('\n').slice(0, 8).join('\n'));
  }

  if (isPairingCodeFailure(reason) && switchToQrAuth(msg)) {
    isInitializing = false;
    if (!shuttingDown) scheduleWhatsAppReconnect('pairing-code-failed');
    return;
  }

  if (/already exists|Session closed|Target closed|Execution context was destroyed|Protocol error|detached Frame|Evaluation failed/i.test(msg)) {
    setWaLink({ state: 'disconnected', reason: msg });
    if (!shuttingDown && !isInitializing) {
      scheduleWhatsAppReconnect(msg);
    }
  }
});

// Dashboard / API come up immediately — even while WhatsApp is pairing
startSendServer();
createAndStartWhatsApp();

const STATE_FILE = path.join(__dirname, 'state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      console.log(`[STATE] Loaded lastProcessedTimestamp: ${data.lastProcessedTimestamp}`);
      return data;
    }
  } catch (e) {
    console.log(`[STATE] Error loading: ${e.message}`);
  }
  const ts = Math.floor(Date.now() / 1000);
  console.log(`[STATE] Using current timestamp: ${ts}`);
  return { lastProcessedTimestamp: ts };
}

/** Merges, because state.json holds both the poll cursor and the send budget. */
function saveState(patch) {
  let current = {};
  try {
    if (fs.existsSync(STATE_FILE)) current = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    current = {};
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...current, ...patch }, null, 2));
}

const sendBudget = safety.createSendBudget({ loadState, saveState, log: (m) => log(m) });

const initialState = loadState();
let lastProcessedTimestamp = initialState.lastProcessedTimestamp;
let pollInFlight = false;
const processedMessageKeys = new Set();

function messageDedupeKey(msg) {
  const id = msg?.id?._serialized || msg?.id?.id || msg?._data?.id?.id;
  if (id) return String(id);
  return `${msg?.timestamp || ''}|${msg?.from || ''}|${String(msg?.body || '').slice(0, 80)}`;
}

function markMessageProcessed(msg) {
  const key = messageDedupeKey(msg);
  if (processedMessageKeys.has(key)) return false;
  processedMessageKeys.add(key);
  // Bound memory
  if (processedMessageKeys.size > 500) {
    const first = processedMessageKeys.values().next().value;
    processedMessageKeys.delete(first);
  }
  if (msg.timestamp) {
    lastProcessedTimestamp = Math.max(lastProcessedTimestamp || 0, msg.timestamp);
    saveTimestamp();
  }
  return true;
}

// Clear recentReplies periodically to prevent memory leak
setInterval(() => {
  if (recentReplies.size > 100) {
    recentReplies.clear();
  }
}, 60000);

function saveTimestamp() {
  saveState({ lastProcessedTimestamp });
  console.log(`[STATE] Saved lastProcessedTimestamp: ${lastProcessedTimestamp}`);
}

/**
 * wwebjs 1.34 getChats() uses Promise.all(getChatModel) across every chat.
 * With large accounts (~1000 chats), one broken groupMetadata.update / serialize
 * throws a minified "r" and aborts the entire list. Also, awaiting GroupMetadata.update
 * per chat makes listing take minutes. Patch: skip bad chats + never network-refresh
 * metadata during bulk list (resolveGroupByName refreshes one chat when needed).
 */
async function patchWhatsAppWebHelpers() {
  if (!client.pupPage) {
    log('[PATCH] No pupPage yet — skipping');
    return;
  }

  const result = await client.pupPage.evaluate(() => {
    if (!window.WWebJS) return { ok: false, reason: 'no WWebJS' };
    if (window.WWebJS.__sandeshaPatched === 2) return { ok: true, reason: 'already patched' };

    const chatIdOf = (chat) =>
      chat?.id?._serialized || chat?.id?.$1 || (typeof chat?.id === 'string' ? chat.id : null);

    window.WWebJS.getChatModel = async (chat, { isChannel = false } = {}) => {
      if (!chat) return null;
      try {
        const model = chat.serialize();
        model.isGroup = false;
        model.isMuted = chat.mute?.expiration !== 0;
        if (isChannel) {
          try {
            model.isChannel = window.require('WAWebChatGetters').getIsNewsletter(chat);
          } catch (_) {
            model.isChannel = true;
          }
        } else {
          model.formattedTitle = chat.formattedTitle;
        }

        // Use already-cached groupMetadata only — do NOT call groupMetadata.update()
        // here (that is a network round-trip × hundreds of groups and times out startup).
        if (chat.groupMetadata) {
          model.isGroup = true;
          try {
            const { toPn } = window.require('WAWebLidMigrationUtils');
            const serializedMetadata = chat.groupMetadata.serialize();
            for (const p of serializedMetadata.participants || []) {
              try {
                p.id = toPn(p.id) ?? p.id;
              } catch (_) {}
            }
            model.groupMetadata = serializedMetadata;
            model.isReadOnly = chat.groupMetadata.announce;
            if (Array.isArray(serializedMetadata.participants)) {
              model.participants = serializedMetadata.participants;
            }
          } catch (_) {
            model.isGroup = true;
          }
        } else {
          const id = chatIdOf(chat);
          if (id && String(id).endsWith('@g.us')) model.isGroup = true;
        }

        model.lastMessage = null;
        delete model.msgs;
        delete model.msgUnsyncedButtonReplyMsgs;
        delete model.unsyncedButtonReplies;
        return model;
      } catch (err) {
        const id = chatIdOf(chat);
        if (!id) return null;
        return {
          id: {
            server: String(id).includes('@') ? String(id).split('@')[1] : 'c.us',
            user: String(id).split('@')[0],
            _serialized: id,
          },
          name: chat.formattedTitle || chat.name || id,
          formattedTitle: chat.formattedTitle || chat.name || id,
          isGroup: !!chat.groupMetadata || String(id).endsWith('@g.us'),
          isMuted: false,
          lastMessage: null,
        };
      }
    };

    window.WWebJS.getChats = async () => {
      const chats = window.require('WAWebCollections').Chat.getModelsArray();
      // Parallel with allSettled so one bad chat cannot abort listing, and we
      // finish hundreds of chats in seconds instead of a serial await loop.
      const settled = await Promise.allSettled(
        chats.map((chat) => window.WWebJS.getChatModel(chat))
      );
      const out = [];
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) out.push(r.value);
      }
      return out;
    };

    window.WWebJS.__sandeshaPatched = 2;
    return { ok: true, reason: 'patched' };
  });

  log(`[PATCH] chat helpers: ${result.reason || (result.ok ? 'ok' : 'failed')}`);
}

/** Find a group JID by exact title without full getChatModel (avoids broken chats). */
async function findGroupJidByName(name) {
  if (!client.pupPage) return null;
  const wanted = String(name || '').toLowerCase();
  return client.pupPage.evaluate((wantedName) => {
    try {
      const chats = window.require('WAWebCollections').Chat.getModelsArray();
      for (const chat of chats) {
        const title = (chat.formattedTitle || chat.name || '').toLowerCase();
        if (title !== wantedName) continue;
        const id = chat.id?._serialized || chat.id?.$1;
        if (id && String(id).endsWith('@g.us')) return id;
      }
      return null;
    } catch (_) {
      return null;
    }
  }, wanted);
}

async function waitForWhatsAppStore({ timeoutMs = 60000, intervalMs = 1500 } = {}) {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt += 1;
    try {
      if (!client.pupPage) {
        log(`[STORE] waiting for page (attempt ${attempt})`);
      } else {
        await patchWhatsAppWebHelpers();

        const status = await client.pupPage.evaluate(() => {
          try {
            const hasWWebJS = typeof window.WWebJS !== 'undefined' && typeof window.WWebJS.getChats === 'function';
            let chatCount = null;
            if (typeof window.require === 'function') {
              const collections = window.require('WAWebCollections');
              chatCount = collections?.Chat?.getModelsArray?.()?.length ?? null;
            }
            return {
              hasWWebJS,
              chatCount,
              patched: !!(window.WWebJS && window.WWebJS.__sandeshaPatched),
            };
          } catch (e) {
            return { hasWWebJS: false, chatCount: null, error: e.message };
          }
        });

        // Ready when collection is populated — do NOT require a full getChats() pass
        // (983 chats × serialize used to exceed the warm-up timeout and block setup).
        if (status.hasWWebJS && status.chatCount > 0) {
          log(`[STORE] ready after ${attempt} attempt(s) (collection=${status.chatCount}, patched=${status.patched})`);
          return true;
        }
        log(
          `[STORE] waiting (attempt ${attempt}): hasWWebJS=${status.hasWWebJS} chatCount=${status.chatCount}` +
            (status.error ? ` err=${status.error}` : '')
        );
      }
    } catch (err) {
      log(`[STORE] not ready (attempt ${attempt}): ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function startMessagePoller() {
  if (pollInterval) return;
  log('[POLL] Starting message poller, commandsGroupJid=' + commandsGroupJid);
  let consecutiveErrors = 0;
  let nextAllowedAt = 0;

  pollInterval = setInterval(async () => {
    if (pollInFlight) return;
    if (!commandsGroupJid) return;
    if (Date.now() < nextAllowedAt) return;

    pollInFlight = true;
    try {
      const chat = await Promise.race([
        client.getChatById(commandsGroupJid),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getChat timeout')), 20000))
      ]);
      if (!chat) {
        consecutiveErrors += 1;
        if (consecutiveErrors <= 3 || consecutiveErrors % 12 === 0) {
          log('[POLL] Chat not found for', commandsGroupJid);
        }
        nextAllowedAt = Date.now() + Math.min(60000, 5000 * consecutiveErrors);
        return;
      }

      // fetchMessages is the slow call (headless Chromium on a Pi can take
      // 20s+), so only a successful fetch counts as healthy. Resetting before
      // it made every timeout look like a first error: no backoff, endless logs.
      const messages = await Promise.race([
        chat.fetchMessages({ limit: 20 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('fetchMessages timeout')), 45000))
      ]);
      consecutiveErrors = 0;
      nextAllowedAt = 0;

      for (const msg of messages) {
        // Track ALL messages (both phone and web) to avoid reprocessing
        if (msg.timestamp > lastProcessedTimestamp) {
          log(`[POLL] NEW msg: fromMe=${msg.fromMe}, timestamp=${msg.timestamp}, body="${msg.body?.substring(0, 30)}"`);

          if (isBotReplyText(msg.body)) {
            markMessageProcessed(msg);
            continue;
          }

          // Skip if message_create already handled this message
          if (!markMessageProcessed(msg)) {
            log('[POLL] SKIP: already processed');
            continue;
          }

          const hasMedia = msg.hasMedia;

          try {
            if (hasMedia) {
              await handleMediaMessage(msg);
            } else if (bulkAddMembersWizard && await bulkAddMembersWizard.handleSession(msg)) {
              // active !addmembers wizard
            } else if (bulkSendWizard && await bulkSendWizard.handleSession(msg)) {
              // active !bulk wizard
            } else if (settingsWizard && await settingsWizard.handleSession(msg)) {
              // active !settings wizard
            } else if (msg.body?.startsWith('!')) {
              await handleCommand(msg.body, msg);
            } else if (parseQuotedSendTarget(msg.body)) {
              await handleQuotedSend(msg);
            } else {
              const scheduleIdx = msg.body.indexOf(' !schedule');
              if (scheduleIdx > 0) {
                const messagePart = msg.body.substring(0, scheduleIdx).trim();
                const schedulePart = msg.body.substring(scheduleIdx + 2).trim();
                await handleNaturalSchedule(messagePart, schedulePart, msg);
              } else {
                const parsed = await parseNaturalCommand(msg.body);
                if (parsed) {
                  await executeSend(parsed, msg);
                } else {
                  await handleAIChat(msg.body, msg);
                }
              }
            }
          } catch (err) {
            log(`[POLL] Handler error: ${err.message}`);
          }
        }
      }
    } catch (err) {
      consecutiveErrors += 1;
      nextAllowedAt = Date.now() + Math.min(120000, 10000 * consecutiveErrors);
      // Log on first error, then only every 6 (i.e. ~1 min) to avoid spam
      if (consecutiveErrors === 1 || consecutiveErrors % 6 === 0) {
        log(`[POLL] ${err.message} (backoff ${Math.round((nextAllowedAt - Date.now()) / 1000)}s, errors=${consecutiveErrors})`);
      }
      if (isWhatsAppSessionError(err)) {
        notifyWhatsAppSessionError(err, 'message poller');
      }
    } finally {
      pollInFlight = false;
    }
  }, 10000);
}

async function handleMediaMessage(msg) {
  try {
    log('HANDLE-MEDIA called');
    const media = await msg.downloadMedia();
    log('Media downloaded:', media ? 'success' : 'failed');
    if (!media) { await botReply(msg, 'Failed to download media'); return; }
    
    // Check file size (max 16MB)
    const MAX_FILE_SIZE = 16 * 1024 * 1024;
    if (media.data && Buffer.from(media.data, 'base64').length > MAX_FILE_SIZE) {
      await botReply(msg, 'File too large (max 16MB)'); 
      return;
    }
    
    const ext = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
    const filename = `media_${Date.now()}.${ext}`;
    const filepath = path.join(MEDIA_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(media.data, 'base64'));
    log('Media saved to:', filepath);
    
    const body = msg.body?.trim();
    log('Media caption:', body);
    if (!body) {
      await botReply(msg, 'Media received. Add a caption like "send to family" or "send to Group1"');
      return;
    }
    
    const parsed = await parseNaturalCommand(body);
    log('Parsed:', parsed);
    if (parsed) {
      // parsed.message is already "hi" - don't override with full caption
      await executeMediaSend(parsed, media, filename, msg);
    } else {
      await botReply(msg, `Don't understand "${body}". Try: "send to family" or "send to Group1"`);
    }
  } catch (err) {
    console.error(`Media error: ${err.message}`);
    await botReply(msg, `Error: ${err.message}`);
  }
}

async function executeMediaSend(parsed, media, filename, msg) {
  try {
    const msgMedia = new MessageMedia(media.mimetype, media.data, filename);
    const sets = loadSets();
    
    if (parsed.isAll) {
      const groups = sets.all || [];
      if (groups.length === 0) { await botReply(msg, 'No groups in "all" set'); return; }
      const allMedia = safety.shuffled(groups);
      await botReply(msg, `Sending media to ${allMedia.length} groups, spread out — this will take a while.`);
      for (let i = 0; i < allMedia.length; i++) {
        await resolveAndSendMedia(allMedia[i], msgMedia, safety.varyCaption(parsed.message));
        if (i < allMedia.length - 1) await safety.broadcastGap();
      }
      await botReply(msg, `Sent media to ${groups.length} groups ✅`);
      return;
    }
    
    const setGroups = sets[parsed.target.toLowerCase()];
    if (setGroups) {
      const setMedia = safety.shuffled(setGroups);
      await botReply(msg, `Sending media to ${setMedia.length} groups, spread out — this will take a while.`);
      for (let i = 0; i < setMedia.length; i++) {
        await resolveAndSendMedia(setMedia[i], msgMedia, safety.varyCaption(parsed.message));
        if (i < setMedia.length - 1) await safety.sendGap();
      }
      await botReply(msg, `Sent media to ${setGroups.length} groups in "${parsed.target}" ✅`);
      return;
    }
    
    const chats = await client.getChats();
    const group = chats.find(c => c.isGroup && c.name.toLowerCase() === parsed.target.toLowerCase());
    if (group) {
      await resolveAndSendMedia(group.id._serialized, msgMedia, parsed.message);
      await botReply(msg, `Sent media to ${group.name}`);
      return;
    }
    
    await botReply(msg, `Target "${parsed.target}" not found. Use !groups to see available groups.`);
  } catch (err) {
    await botReply(msg, `Error: ${err.message}`);
  }
}

/**
 * Optional framing for the activity log. A higher-level operation (a schedule
 * fan-out, a bulk run, a broadcast) sets this so the per-send rows it produces
 * can be grouped back into one logical action on the dashboard.
 */
let sendContext = null;
function withSendContext(ctx, fn) {
  const prev = sendContext;
  sendContext = ctx;
  return Promise.resolve()
    .then(fn)
    .finally(() => { sendContext = prev; });
}

// Reach tracking reads these lazily — the client is replaced on reconnect.
reach.init({
  getClient: () => client,
  getContext: () => sendContext,
  // A send in progress has right of way over reach checks.
  isBusy: () => sendContext !== null,
  ignoreChat: (jid) => jid === commandsGroupJid || jid === COMMANDS_GROUP_JID || jid === 'status@broadcast',
  myId: () => myNumber,
  log,
});
function logSend(jid, { kind, chars }) {
  try {
    const raw = String(jid || '');
    const where = raw.endsWith('@g.us')
      ? 'a group'
      : (raw.split('@')[0] ? `+${raw.split('@')[0]}` : 'a chat');
    activity.recordEvent({
      category: 'send',
      type: 'ok',
      ok: true,
      title: `Sent ${kind === 'media' ? 'media' : 'message'} to ${where}`,
      target: raw,
      count: 1,
      detail: chars ? `${chars} chars` : '',
      via: sendContext?.via || 'api',
      corrId: sendContext?.corrId || '',
      actor: sendContext?.actor || null,
      meta: { kind, chars, ...(sendContext?.message ? { message: sendContext.message } : {}) },
    });
  } catch { /* logging is best-effort */ }
}

async function resolveAndSendMedia(target, media, caption) {
  const jid = await resolveTargetJid(target);
  const chat = await client.getChatById(jid);
  if (!chat) throw new Error(`Chat not found`);
  await safety.withTypingPresence(chat, caption);
  const sent = await chat.sendMessage(media, { caption: caption || '' });
  reach.track(sent, { jid, content: media, caption });
  sendBudget.record();
  safety.auditSend({ kind: 'media', target: jid, chars: String(caption || '').length });
  logSend(jid, { kind: 'media', chars: String(caption || '').length });
  console.log(`Sent media to ${chat.name || jid}: ${caption || '(no caption)'}`);
}

async function setupCommandsGroup() {
  const configuredJid = (process.env.SANDESHA_COMMANDS_GROUP_JID || '').trim();
  const wantedName = COMMANDS_GROUP_NAME;

  // Fast path: scan raw collection by title (does not call broken getChatModel)
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const jid = await findGroupJidByName(wantedName);
      if (jid) {
        commandsGroupJid = jid;
        log(`Me Commands group found by name: ${wantedName} (${commandsGroupJid})`);
        return;
      }
      log(`No group named "${wantedName}" in collection (attempt ${attempt}/5)`);
    } catch (err) {
      log(`Name scan failed (attempt ${attempt}/5): ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Fallback: patched getChats + name match
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const chats = await Promise.race([
        client.getChats(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getChats timeout')), 45000)),
      ]);
      const match = chats.find(
        (c) => c.isGroup && c.name && c.name.toLowerCase() === wantedName.toLowerCase()
      );
      if (match) {
        commandsGroupJid = match.id._serialized;
        log(`Me Commands group verified via getChats: ${match.name} (${commandsGroupJid})`);
        return;
      }
      log(`getChats returned ${chats.length} chats but no "${wantedName}" (attempt ${attempt}/3)`);
    } catch (err) {
      log(`Commands group getChats failed (attempt ${attempt}/3): ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }

  if (configuredJid) {
    commandsGroupJid = configuredJid;
    log(`Using SANDESHA_COMMANDS_GROUP_JID from .env: ${commandsGroupJid}`);
    return;
  }

  commandsGroupJid = COMMANDS_GROUP_JID;
  log(`WARNING: Could not find "${wantedName}" — using fallback JID ${commandsGroupJid}`);
  log(`Create a WhatsApp group named exactly "${wantedName}", then restart the bot.`);
}

function handleIncomingMessage(msg) {
  return new Promise(async (resolve) => {
    try {
      if (!msg.body || msg.body.trim().length === 0) { resolve(); return; }
      if (msg.from === 'status@broadcast') { resolve(); return; }

      const isFromMe = msg.fromMe;
      let chat = null;
      try {
        chat = await msg.getChat();
      } catch (err) {
        // Store may be flaky; still allow matching by group JID
        log(`MSG getChat failed: ${err.message}`);
      }

      log(`MSG fromMe=${isFromMe} from=${msg.from} chat=${chat?.name || '?'} body="${msg.body?.substring(0, 80)}" hasMedia=${msg.hasMedia}`);

      // Skip messages from others (we only process commands sent through this WhatsApp Web session)
      if (!isFromMe) { resolve(); return; }

      if (!commandsGroupJid) { resolve(); return; }
      
      // Check if from Me Commands group
      const isFromCommandsGroup = 
        msg.from === commandsGroupJid ||
        chat?.name === COMMANDS_GROUP_NAME ||
        (chat?.isGroup && chat.name.toLowerCase() === COMMANDS_GROUP_NAME.toLowerCase());
      
      if (!isFromCommandsGroup) { resolve(); return; }

      // Skip bot's own replies (prevent infinite loops)
      if (isBotReplyText(msg.body)) {
        log('SKIP: Bot reply message');
        resolve(); return;
      }
      
      // Skip if this is the bot's own message (prevent infinite loops)
      const now = Math.floor(Date.now() / 1000);
      if (msg.timestamp && (now - msg.timestamp) < 5) {
        // Message sent less than 5 seconds ago - likely our own
        if (msg.timestamp <= lastProcessedTimestamp) {
          log('SKIP: Bot own message (recent)');
          resolve(); return;
        }
      }
      
      if (msg.timestamp && msg.timestamp <= lastProcessedTimestamp) { resolve(); return; }

      // Claim before handling so the poller cannot process the same message
      if (!markMessageProcessed(msg)) {
        log('SKIP: already processed');
        resolve(); return;
      }

      // Check for media first
      const mtype = msg._data?.mtype;
      const hasMedia = msg.hasMedia || mtype === 'imageMessage' || mtype === 'videoMessage' || mtype === 'documentMessage';
      log(`MEDIA-CHECK hasMedia=${hasMedia} mtype=${mtype}`);
      
      if (hasMedia) {
        await handleMediaMessage(msg);
        resolve(); return;
      }
      
      if (!msg.body || msg.body.trim().length === 0) { resolve(); return; }

      if (lastReplyText && msg.body.trim() === lastReplyText.trim()) {
        log('SKIP: Same as last reply');
        lastReplyText = null;
        resolve();
        return;
      }

      // Active wizards must run on message_create too (not only the poller).
      // Otherwise follow-up text like "Kolam Workshop" is treated as a natural send.
      if (bulkAddMembersWizard && await bulkAddMembersWizard.handleSession(msg)) {
        resolve(); return;
      }
      if (bulkSendWizard && await bulkSendWizard.handleSession(msg)) {
        resolve(); return;
      }
      if (settingsWizard && await settingsWizard.handleSession(msg)) {
        resolve(); return;
      }

      // Check for natural scheduling: "message !schedule to group at time"
      const scheduleIdx = msg.body.indexOf(' !schedule');
      if (scheduleIdx > 0) {
        const messagePart = msg.body.substring(0, scheduleIdx).trim();
        const schedulePart = msg.body.substring(scheduleIdx + 2).trim(); // +2 to skip " !"
        console.log(`[SCHEDULE-NL] message: "${messagePart.substring(0, 50)}", schedule: "${schedulePart.substring(0, 50)}"`);
        await handleNaturalSchedule(messagePart, schedulePart, msg);
        resolve();
        return;
      }

      if (msg.body.startsWith('!')) {
        await handleCommand(msg.body, msg);
      } else {
        const parsed = await parseNaturalCommand(msg.body);
        if (parsed) {
          await executeSend(parsed, msg);
        } else {
          await handleAIChat(msg.body, msg);
        }
      }
      resolve();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error:`, err.message);
      resolve();
    }
  });
}

async function handleCommand(text, msg) {
  const raw = text.trim().slice(1).trim();
  console.log(`[COMMAND] raw: "${raw.substring(0, 100)}"`);
  
  if (raw === 'ai' || raw.startsWith('ai ')) {
    const prompt = raw.replace(/^ai\s+/i, '').trim();
    await handleAIChat(prompt || 'hello', msg);
    return;
  }

  if (raw === 'settings') {
    if (!settingsWizard) { await botReply(msg, 'Settings not ready yet.'); return; }
    await settingsWizard.startSettings(msg);
    return;
  }

  if (raw === 'bulk' || raw === 'sendnumbers' || raw === 'sendlist') {
    if (!bulkSendWizard) { await botReply(msg, 'Bulk send not ready yet.'); return; }
    await bulkSendWizard.startBulk(msg);
    return;
  }

  if (raw === 'addmembers' || raw === 'addtogroup') {
    if (!bulkAddMembersWizard) { await botReply(msg, 'Add members not ready yet.'); return; }
    await bulkAddMembersWizard.startAddMembers(msg);
    return;
  }

  if (raw === 'sets') {
    const sets = loadSets();
    const keys = Object.keys(sets);
    if (keys.length === 0) { await botReply(msg, 'No sets defined'); return; }

    const chats = await client.getChats();
    const jidToName = new Map(
      chats.filter(c => c.isGroup).map(c => [c.id._serialized, c.name])
    );

    let reply = 'Group Sets:\n';
    for (const [name, jids] of Object.entries(sets)) {
      const labels = (jids || []).map(jid => jidToName.get(jid) || `? (${jid})`);
      reply += `• ${name} (${labels.length}):\n`;
      for (const label of labels) reply += `  - ${label}\n`;
    }
    await botReply(msg, reply.trim());
    return;
  }

  if (raw === 'groups') {
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    if (groups.length === 0) { await botReply(msg, 'No groups found'); return; }
    
    let reply = `📱 *Groups (${groups.length})*\n━━━━━━━━━━━━━━━━━━━━\n`;
    let activeCount = 0;
    let inactiveCount = 0;
    
    for (const g of groups.slice(0, 20)) {
      try {
        const messages = await Promise.race([
          g.fetchMessages({ limit: 1 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        const lastActive = messages.length > 0 ? formatTimeAgo(messages[0].timestamp) : 'Never';
        const daysInactive = messages.length > 0 ? Math.floor((Math.floor(Date.now() / 1000) - messages[0].timestamp) / 86400) : 999;
        const status = daysInactive > 30 ? '🔴' : daysInactive > 7 ? '🟡' : '🟢';
        if (daysInactive > 30) inactiveCount++; else activeCount++;
        
        reply += `${status} ${g.name}\n   Last: ${lastActive}\n`;
      } catch (e) {
        reply += `⚪ ${g.name}\n   Last: Unknown\n`;
      }
    }
    
    if (groups.length > 20) {
      reply += `\n...and ${groups.length - 20} more groups. Use !inactive to see all.\n`;
    }
    
    reply += `\n━━━━━━━━━━━━━━━━━━━━\n🟢 ${activeCount} active  🔴 ${inactiveCount} inactive (30+ days)`;
    await botReply(msg, reply);
    return;
  }

  // List all group names only
  if (raw === 'grouplist' || raw === 'allgroups') {
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    if (groups.length === 0) { await botReply(msg, 'No groups found'); return; }
    
    let reply = `📋 *All Groups (${groups.length})*\n━━━━━━━━━━━━━━━━━━━━\n`;
    for (const g of groups) {
      reply += `• ${g.name}\n`;
    }
    await botReply(msg, reply);
    return;
  }

  // Show active/inactive status of all groups
  if (raw === 'groupstatus' || raw === 'groupactive') {
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    if (groups.length === 0) { await botReply(msg, 'No groups found'); return; }
    
    await botReply(msg, `Checking ${groups.length} groups...`);
    
    const active = [];
    const week = [];
    const inactive = [];
    
    for (const g of groups) {
      try {
        const messages = await Promise.race([
          g.fetchMessages({ limit: 1 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        if (messages.length === 0) {
          inactive.push(g.name);
          continue;
        }
        const daysInactive = Math.floor((Math.floor(Date.now() / 1000) - messages[0].timestamp) / 86400);
        if (daysInactive > 30) inactive.push(g.name);
        else if (daysInactive > 7) week.push(g.name);
        else active.push(g.name);
      } catch (e) {
        inactive.push(g.name);
      }
    }
    
    let reply = `📊 *Group Status*\n━━━━━━━━━━━━━━━━━━━━\n`;
    reply += `🟢 Active (< 7 days): ${active.length}\n`;
    reply += `🟡 Week inactive (7-30 days): ${week.length}\n`;
    reply += `🔴 Inactive (> 30 days): ${inactive.length}\n`;
    reply += `━━━━━━━━━━━━━━━━━━━━\n`;
    reply += `Total: ${groups.length} groups`;
    
    await botReply(msg, reply);
    return;
  }

  // List members of a specific group
  if (raw.startsWith('members ') || raw.startsWith('members ')) {
    const groupName = raw.replace(/^members\s+/i, '').trim();
    if (!groupName) {
      await botReply(msg, 'Usage: !members <group_name>\nExample: !members Family');
      return;
    }
    
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    const group = groups.find(g => g.name.toLowerCase().includes(groupName.toLowerCase()));
    
    if (!group) {
      await botReply(msg, `Group "${groupName}" not found`);
      return;
    }
    
    try {
      const participants = group.participants || [];
      
      if (participants.length === 0) {
        // Try to fetch participants if not available
        try {
          await group.fetchParticipants();
        } catch (e) { /* ignore */ }
      }
      
      const memberList = group.participants || [];
      
      if (memberList.length === 0) {
        await botReply(msg, `No members found in "${group.name}"`);
        return;
      }
      
      let reply = `Members in "${group.name}" (${memberList.length}):\n`;
      for (const p of memberList.slice(0, 50)) {
        const contact = p.id ? await client.getContactById(p.id._serialized).catch(() => null) : null;
        const name = contact?.pushname || contact?.name || contact?.shortName || p.name || p.shortName || 'Unknown';
        const phone = p.id?.user || 'Unknown';
        reply += `• ${name} (${phone})\n`;
      }
      if (memberList.length > 50) {
        reply += `\n...and ${memberList.length - 50} more.`;
      }
      await botReply(msg, reply);
    } catch (e) {
      await botReply(msg, `Error fetching members: ${e.message}`);
    }
    return;
  }

  // Find member across all groups
  if (raw.startsWith('find ') || raw.startsWith('search ')) {
    const searchName = raw.replace(/^(find|search)\s+/i, '').trim();
    if (!searchName) {
      await botReply(msg, 'Usage: !find <name>\nExample: !find Veena amma');
      return;
    }
    
    await botReply(msg, `Searching for "${searchName}" in groups...`);
    
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    const found = [];
    
    for (const g of groups) {
      try {
        const participants = g.participants || [];
        if (participants.length === 0) {
          try { await g.fetchParticipants(); } catch (e) { /* ignore */ }
        }
        const memberList = g.participants || [];
        for (const p of memberList) {
          const name = p.name || p.shortName || '';
          if (name.toLowerCase().includes(searchName.toLowerCase())) {
            found.push({ group: g.name, name });
          }
        }
      } catch (e) {
        // Skip groups we can't access
      }
    }
    
    if (found.length === 0) {
      await botReply(msg, `No groups found with member matching "${searchName}"`);
      return;
    }
    
    let reply = `Found "${searchName}" in ${found.length} group(s):\n`;
    for (const f of found.slice(0, 20)) {
      reply += `• ${f.name} in "${f.group}"\n`;
    }
    if (found.length > 20) {
      reply += `\n...and ${found.length - 20} more.`;
    }
    await botReply(msg, reply);
    return;
  }

  // Check inactive groups
  if (raw.startsWith('inactive') || raw.startsWith('inactive ')) {
    await botReply(msg, 'Checking inactive groups... (this may take a moment)');
    let days = 30; // default 30 days
    const match = raw.match(/inactive\s+(\d+)/i);
    if (match) days = parseInt(match[1]);
    
    const cutoffTime = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup);
    
    let inactiveGroups = [];
    let checked = 0;
    
    for (const g of groups) {
      try {
        const messages = await g.fetchMessages({ limit: 1 });
        if (messages.length === 0 || messages[0].timestamp < cutoffTime) {
          inactiveGroups.push({
            name: g.name,
            lastActive: messages.length > 0 ? formatTimeAgo(messages[0].timestamp) : 'Never',
            jid: g.id._serialized
          });
        }
        checked++;
        if (checked % 10 === 0) {
          await botReply(msg, `Progress: checked ${checked}/${groups.length} groups...`);
        }
      } catch (e) {
        // Skip groups we can't access
      }
    }
    
    if (inactiveGroups.length === 0) {
      await botReply(msg, `All groups have been active in the last ${days} days! 🎉`);
      return;
    }
    
    let reply = `Inactive groups (no activity in ${days}+ days):\n`;
    for (const g of inactiveGroups.slice(0, 20)) {
      reply += `• ${g.name}\n  Last: ${g.lastActive}\n`;
    }
    if (inactiveGroups.length > 20) {
      reply += `\n...and ${inactiveGroups.length - 20} more.`;
    }
    reply += `\n\nTotal: ${inactiveGroups.length} inactive groups`;
    await botReply(msg, reply);
    return;
  }

  // Schedule command
  if (raw.startsWith('schedule') || raw.startsWith('remind')) {
    await handleSchedule(raw, msg);
    return;
  }

  // List schedules
  if (raw === 'schedules' || raw === 'reminders') {
    const schedules = loadSchedules();
    if (schedules.length === 0) {
      await botReply(msg, 'No scheduled messages. Use !schedule <msg> to <target> at <time>');
      return;
    }
    let reply = `Scheduled messages (${schedules.length}):\n`;
    schedules.forEach((s, i) => {
      const nextRun = new Date(s.runAt).toLocaleString();
      reply += `${i + 1}. ${s.filePath ? '📎 ' : ''}"${s.message}" → ${s.target}\n   At: ${nextRun}\n`;
    });
    await botReply(msg, reply);
    return;
  }

  // Cancel schedule
  if (raw.startsWith('cancel') || raw.startsWith('delete')) {
    const schedules = loadSchedules();
    if (schedules.length === 0) {
      await botReply(msg, 'No scheduled messages to cancel.');
      return;
    }
    // Cancel last schedule by default
    const removed = schedules.pop();
    saveSchedules(schedules);
    await botReply(msg, `Cancelled: "${removed.message}" → ${removed.target}`);
    return;
  }

  // Add contact: !addcontact name +919344915049
  if (raw.startsWith('addcontact ') || raw.startsWith('add contact ')) {
    const parts = raw.replace(/^(addcontact|add contact)\s+/i, '').split(/\s+/);
    if (parts.length < 2) {
      await botReply(msg, 'Usage: !addcontact <name> <number>\nExample: !addcontact John +919344915049');
      return;
    }
    const name = parts[0];
    const number = parts[1];
    const contacts = loadContacts();
    contacts.contacts[name] = number;
    saveContacts(contacts);
    await botReply(msg, `Added contact: ${name} → ${number}`);
    return;
  }

  // List contacts
  if (raw === 'contacts' || raw === 'contact') {
    const contacts = loadContacts();
    const keys = Object.keys(contacts.contacts);
    if (keys.length === 0) {
      await botReply(msg, 'No contacts saved.\nUse: !addcontact <name> <number>');
      return;
    }
    let reply = 'Contacts:\n';
    for (const [name, number] of Object.entries(contacts.contacts)) {
      reply += `• ${name}: ${number}\n`;
    }
    await botReply(msg, reply);
    return;
  }

  if (raw === 'help') {
    const help = `━━━━━━━━━━━━━━━━━━━━
📝 Natural Messaging
━━━━━━━━━━━━━━━━━━━━
Just type naturally:
• "hi family" → send to family
• "send hi to hebbal" → send to hebbal
• "say hi to all" → broadcast to all

Reply to a message, then:
• "send to all_vols_grps" → send quoted msg to set
• "to Maa" → send quoted msg to contact/group
• "forward to family" → same as above

━━━━━━━━━━━━━━━━━━━━
⚡ Commands
━━━━━━━━━━━━━━━━━━━━
🎨 !ai <text>      - Chat with AI
📤 !send <t> <msg> - Send to target
📱 !bulk           - Send one msg to a pasted list of numbers
👥 !addmembers     - Add pasted numbers to a group (background, admin only)
📢 !all <msg>      - Broadcast to all
⚙️ !settings       - Manage sets (add/edit/delete)
📋 !sets           - List group sets
📱 !groups         - List all groups
📋 !grouplist      - List all group names
📊 !groupstatus    - Show active/inactive status
🔀 !forward <msg> to <group> - Forward to another group
👥 !members <group> - List group members
🔍 !find <name>   - Find member in groups
📊 !inactive [d]  - Show inactive groups
📅 !schedules      - List scheduled msgs
❌ !cancel         - Cancel last schedule
👤 !contacts       - List saved contacts
  ➕ !addcontact <n> <num> - Add contact
🔎 !track <msg>   - Track replies
📋 !replies       - Show tracked replies
👁️ !seen <msg>   - Track who read your msg
🆘 !help           - Show this help

━━━━━━━━━━━━━━━━━━━━
📅 Scheduling
━━━━━━━━━━━━━━━━━━━━
Format: <msg> !schedule to <target> at <time>
Example: Hello !schedule to family at 9am`;
    await botReply(msg, help);
    return;
  }

  if (parseQuotedSendTarget(raw)) {
    await handleQuotedSend(msg, raw);
    return;
  }

  // Forward message to another group
  if (raw.startsWith('forward ') || raw.startsWith('fwd ')) {
    const parts = raw.replace(/^(forward|fwd)\s+/i, '').split(/\s+to\s+/i);
    if (parts.length !== 2) {
      await botReply(msg, 'Usage: !forward <message> to <group>\nExample: !forward Hello everyone to family');
      return;
    }
    
    const message = parts[0].trim();
    const targetGroup = parts[1].trim().toLowerCase();
    
    await botReply(msg, `Forwarding to ${targetGroup}...`);
    
    try {
      const sets = loadSets();
      let targetJid = null;
      
      // Check if target is a set
      const setGroups = sets[targetGroup];
      if (setGroups && Array.isArray(setGroups)) {
        for (const groupName of setGroups) {
          const chat = await resolveAndSend(groupName, message);
        }
        await botReply(msg, `✅ Forwarded "${message}" to ${setGroups.length} groups in ${targetGroup}`);
        return;
      }
      
      // Find direct group
      const chats = await client.getChats();
      const group = chats.find(c => 
        c.isGroup && c.name.toLowerCase().includes(targetGroup)
      );
      
      if (group) {
        const sent = await group.sendMessage(message);
        reach.track(sent, { jid: group.id._serialized, content: message, context: { via: 'bot' } });
        await botReply(msg, `✅ Forwarded to ${group.name}`);
      } else {
        await botReply(msg, `Group "${targetGroup}" not found`);
      }
    } catch (err) {
      await botReply(msg, `Error: ${err.message}`);
    }
    return;
  }

  const parsed = await parseNaturalCommand(raw);
  if (parsed) {
    await executeSend(parsed, msg);
    return;
  }

  await botReply(msg, `Unknown command: !${raw.split(' ')[0]}\nType !help`);
}

function parseQuotedSendTarget(body) {
  if (!body) return null;
  const text = body.trim();
  const patterns = [
    /^(?:send|forward|fwd)\s+to\s+(.+)$/i,
    /^(?:this|it)\s+to\s+(.+)$/i,
    /^to\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

const GROUP_TYPE_QUALIFIERS = new Set(['announcement', 'announce', 'community', 'discussion', 'group']);

function parseTargetWithQualifier(raw) {
  const trimmed = (raw || '').trim();
  const words = trimmed.split(/\s+/);
  const last = words[words.length - 1]?.toLowerCase();
  if (GROUP_TYPE_QUALIFIERS.has(last)) {
    const groupType = last === 'announce' ? 'announcement' : last;
    const name = words.slice(0, -1).join(' ').trim();
    return { name: name || trimmed, groupType };
  }
  return { name: trimmed, groupType: null };
}

function formatGroupTypeHint(chat, allChats = null) {
  if (isAnnouncementGroup(chat)) return ' (announcement — admins only)';
  if (getGroupTypeLabel(chat, allChats) === 'community') return ' (community — not postable)';
  if (getGroupTypeLabel(chat, allChats) === 'linked') return ' (linked group)';
  return '';
}

function findChatsWithSameName(chats, name) {
  const norm = normalizeNameForMatch(name);
  return chats.filter((c) => c.isGroup && c.name && normalizeNameForMatch(c.name) === norm);
}

function findCommunityPairByName(chats, name) {
  const sameName = findChatsWithSameName(chats, name);
  const announcement = sameName.find(isAnnouncementGroup);
  if (!announcement) return null;
  // Same display name + announcement sibling = WhatsApp Community parent shell
  // (not a size heuristic — small normal groups must not match).
  const community = sameName.find((c) => {
    const id = c.id?._serialized;
    return id && id !== announcement.id?._serialized && !isAnnouncementGroup(c);
  });
  return community ? { announcement, community } : null;
}

function buildCommunityAdminOnlyError(chatName, isAdmin) {
  return (
    `❌ "${chatName}" is a WhatsApp Community.\n` +
    `Only admins can post in the announcement group.\n` +
    (isAdmin
      ? 'You appear to be an admin — if send still fails, try from WhatsApp directly.'
      : 'You are not an admin. Please check with a community admin to post this message.')
  );
}

function getSendPermission(chat, allChats = null) {
  if (!chat?.isGroup) return { ok: true };

  const type = getGroupTypeLabel(chat, allChats);
  const name = chat.name || 'this group';
  const isAdmin = isUserGroupAdmin(chat);

  if (type === 'community') {
    const pair = allChats ? findCommunityPairByName(allChats, name) : null;
    const annAdmin = pair ? isUserGroupAdmin(pair.announcement) : false;
    return { ok: false, reason: buildCommunityAdminOnlyError(name, annAdmin) };
  }

  if (isAnnouncementGroup(chat) && !isAdmin) {
    return {
      ok: false,
      reason:
        `❌ "${name}" is an announcement group (admins only).\n` +
        'You are not an admin. Please check with a community admin to post this message.',
    };
  }

  return { ok: true };
}

function isQuotedSendOnlyCommand(body) {
  return !!parseQuotedSendTarget(body);
}

async function getQuotedMessageSafe(msg) {
  let current = msg;
  if (!current?.hasQuotedMsg) {
    try {
      const fresh = await client.getMessageById(current.id._serialized);
      if (fresh?.hasQuotedMsg) current = fresh;
    } catch (err) {
      log(`[QUOTE] Could not refresh message: ${err.message}`);
    }
  }
  if (!current?.hasQuotedMsg) return null;
  try {
    let quoted = await current.getQuotedMessage();
    if (!quoted) return null;
    try {
      const freshQuoted = await client.getMessageById(quoted.id._serialized);
      if (freshQuoted) quoted = freshQuoted;
    } catch (err) {
      log(`[QUOTE] Could not refresh quoted message: ${err.message}`);
    }
    return quoted;
  } catch (err) {
    log(`[QUOTE] getQuotedMessage failed: ${err.message}`);
    return null;
  }
}

function isCommandLikeText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('!')) return true;
  if (isBotReplyText(trimmed)) return true;
  if (parseQuotedSendTarget(trimmed)) return true;
  return false;
}

async function findCompanionTextForQuoted(quotedMsg) {
  if (!commandsGroupJid || !quotedMsg?.timestamp) return '';

  try {
    const chat = await client.getChatById(commandsGroupJid);
    const messages = await chat.fetchMessages({ limit: 50 });
    const candidates = messages
      .filter((m) =>
        m.timestamp < quotedMsg.timestamp &&
        !m.hasMedia &&
        m.body?.trim() &&
        !isCommandLikeText(m.body)
      )
      .sort((a, b) => b.timestamp - a.timestamp);

    if (candidates.length === 0) return '';

    const previousText = candidates[0];
    const gapSeconds = quotedMsg.timestamp - previousText.timestamp;
    if (gapSeconds > 300) return '';

    log(`[QUOTE] Companion text found (${gapSeconds}s before media): "${previousText.body.substring(0, 60)}"`);
    return previousText.body.trim();
  } catch (err) {
    log(`[QUOTE] Companion text lookup failed: ${err.message}`);
    return '';
  }
}

async function resolveQuotedTextBundle(quotedMsg) {
  let inlineText = getQuotedText(quotedMsg);

  if (!inlineText && quotedMsg?.hasQuotedMsg) {
    try {
      const parent = await quotedMsg.getQuotedMessage();
      if (parent) {
        let parentMsg = parent;
        try {
          const freshParent = await client.getMessageById(parent.id._serialized);
          if (freshParent) parentMsg = freshParent;
        } catch {}
        inlineText = getQuotedText(parentMsg);
        if (inlineText) {
          log(`[QUOTE] Text from nested quoted message: "${inlineText.substring(0, 60)}"`);
        }
      }
    } catch (err) {
      log(`[QUOTE] Nested quoted text lookup failed: ${err.message}`);
    }
  }

  let companionText = '';
  if (!inlineText && quotedMsg?.hasMedia) {
    companionText = await findCompanionTextForQuoted(quotedMsg);
  }

  const text = inlineText || companionText;
  return { inlineText, companionText, text };
}

async function handleQuotedSend(msg, instructionBody) {
  const targetRaw = parseQuotedSendTarget(instructionBody || msg.body);
  if (!targetRaw) return;

  log(`[QUOTE] send-to command for "${targetRaw}", hasQuotedMsg=${msg.hasQuotedMsg}`);
  const quotedMsg = await getQuotedMessageSafe(msg);
  if (!quotedMsg) {
    await botReply(msg, '❌ Reply to a message first (swipe right → Reply), then say:\n• send to <set or group>\n• to Maa\n• forward to all_vols_grps');
    return;
  }
  const { inlineText, companionText, text: quotedText } = await resolveQuotedTextBundle(quotedMsg);
  log(`[QUOTE] payload type=${quotedMsg.type} hasMedia=${quotedMsg.hasMedia} inlineLen=${inlineText.length} companionLen=${companionText.length}`);
  if (!quotedText && !quotedMsg.hasMedia) {
    await botReply(msg, '❌ Quoted message has no text or media to send.');
    return;
  }

  const { name: targetName, groupType } = parseTargetWithQualifier(targetRaw);
  const sets = loadSets();
  const setKey = targetName.toLowerCase();
  const isSet = sets[setKey] || ['everyone', 'all', 'all groups', 'everybody'].includes(setKey);

  let targetJid = null;
  let targetLabel = targetName;

  if (!isSet) {
    const contactNumber = resolveContact(targetName);
    if (contactNumber) {
      targetJid = `${contactNumber.replace(/\D/g, '')}@s.whatsapp.net`;
      targetLabel = targetName;
    } else {
      const chats = await client.getChats();
      const matches = await findChatMatchesByName(chats, targetName, { groupType });
      if (matches.length === 0) {
        const pair = findCommunityPairByName(chats, targetName);
        if (pair && !isUserGroupAdmin(pair.announcement)) {
          await botReply(msg, buildCommunityAdminOnlyError(targetName, false));
          return;
        }
        const hint = groupType ? ` (type: ${groupType})` : '';
        await botReply(msg, `Target "${targetName}"${hint} not found. Use !sets or !groups.`);
        return;
      }
      if (matches.length > 1) {
        let text = `Multiple matches for "${targetName}". Be more specific:\n`;
        matches.slice(0, 8).forEach((c, i) => {
          text += `${i + 1}. ${c.name}${formatGroupTypeHint(c, chats)}\n   ${c.id._serialized}\n`;
        });
        text += '\nTip: announcement groups need admin rights. Community shells are not postable.';
        await botReply(msg, text.trim());
        return;
      }
      const picked = matches[0];
      const permission = getSendPermission(picked, chats);
      if (!permission.ok) {
        await botReply(msg, permission.reason);
        return;
      }
      targetJid = picked.id._serialized;
      targetLabel = picked.name;
    }
  }

  try {
    if (setKey === 'all' || ['everyone', 'all groups', 'everybody'].includes(setKey)) {
      const setGroups = sets.all || [];
      if (setGroups.length === 0) { await botReply(msg, 'No groups in "all" set'); return; }
      const allQuoted = safety.shuffled(setGroups);
      await botReply(msg, `Sending quoted message to ${allQuoted.length} groups, spread out…`);
      for (let i = 0; i < allQuoted.length; i++) {
        await sendQuotedContent(allQuoted[i], quotedMsg, { inlineText, companionText });
        if (i < allQuoted.length - 1) await safety.broadcastGap();
      }
      await botReply(msg, `✅ Sent to ${allQuoted.length} groups`);
      return;
    }

    const setGroups = sets[setKey];
    if (setGroups) {
      const setQuoted = safety.shuffled(setGroups);
      await botReply(msg, `Sending quoted message to ${setQuoted.length} groups in "${setKey}", spread out…`);
      for (let i = 0; i < setQuoted.length; i++) {
        await sendQuotedContent(setQuoted[i], quotedMsg, { inlineText, companionText });
        if (i < setQuoted.length - 1) await safety.sendGap();
      }
      await botReply(msg, `✅ Sent to ${setGroups.length} groups in "${setKey}"`);
      return;
    }

    log(`[QUOTE] resolved "${targetRaw}" → "${targetLabel}" (${targetJid})`);
    await sendQuotedContent(targetJid, quotedMsg, { inlineText, companionText, text: quotedText });
    await botReply(msg, `✅ Sent to ${targetLabel}`);
  } catch (err) {
    await botReply(msg, `Error: ${err.message}`);
  }
}

function getQuotedText(quotedMsg) {
  const data = quotedMsg?._data || {};
  const raw =
    quotedMsg?.body ||
    data.caption ||
    data.body ||
    quotedMsg?.caption ||
    '';
  return String(raw).trim();
}

async function sendQuotedContent(target, quotedMsg, textBundle = null) {
  const bundle = textBundle || await resolveQuotedTextBundle(quotedMsg);
  const inlineText = bundle.inlineText || '';
  const companionText = bundle.companionText || '';
  const text = (bundle.text || inlineText || companionText || '').trim();
  const caption = inlineText || companionText || text;
  const jid = target.includes('@') ? target : await resolveTargetJid(target);

  if (quotedMsg.hasMedia) {
    const media = await quotedMsg.downloadMedia();
    if (media) {
      const msgMedia = new MessageMedia(media.mimetype, media.data, media.filename || 'file');

      // Very long text: WhatsApp caption limit ~1024 — send text first, then media
      if (caption && caption.length > 900) {
        await sendMessageToJid(jid, caption);
        await delay(800);
        await sendMessageToJid(jid, msgMedia);
        log(`[QUOTE-SEND] Sent long text + media to ${jid}`);
        return;
      }

      await sendMessageToJid(jid, msgMedia, { caption: caption || '' });
      log(`[QUOTE-SEND] Sent media with caption (${caption.length} chars) to ${jid}`);
      return;
    }
  }

  if (text) {
    await sendMessageToJid(jid, text);
    log(`[QUOTE-SEND] Sent text (${text.length} chars) to ${jid}`);
    return;
  }

  throw new Error('Nothing to send — quoted message has no text or media');
}

async function parseNaturalCommand(input) {
  const sets = loadSets();
  const words = input.split(/\s+/);
  
  if (words.length < 2) return null;

  const sendVerbs = ['send', 'say', 'tell', 'broadcast', 'msg', 'message', 'this', 'it'];
  const prepWords = ['to', 'in', 'for', 'at'];
  const allKeywords = ['everyone', 'all', 'all groups', 'everybody'];

  for (const prep of prepWords) {
    const prepIndex = words.findIndex(w => w.toLowerCase() === prep);
    if (prepIndex > 0 && prepIndex < words.length - 1) {
      let message = words.slice(0, prepIndex).join(' ');
      const targetRaw = words.slice(prepIndex + 1).join(' ');
      const result = await resolveTarget(targetRaw, sets);
      if (result) {
        message = cleanMessage(message, sendVerbs);
        if (!message.trim()) return null; // "send to X" — use reply-to-message flow
        return { target: result, message: message.trim(), isAll: allKeywords.includes(result.toLowerCase()) };
      }
    }
  }

  if (isQuotedSendOnlyCommand(input)) return null;

  for (let i = words.length - 1; i >= 1; i--) {
    const possibleTarget = words.slice(i).join(' ');
    const result = await resolveTarget(possibleTarget, sets);
    if (result) {
      let message = words.slice(0, i).join(' ');
      message = cleanMessage(message, sendVerbs);
      if (!message.trim()) continue;
      return { target: result, message: message.trim(), isAll: allKeywords.includes(result.toLowerCase()) };
    }
  }

  return null;
}

function cleanMessage(message, verbs) {
  const lower = message.toLowerCase().trim();
  for (const v of verbs) {
    if (lower === v) return '';
    if (lower.startsWith(v + ' ')) return message.substring(v.length + 1);
    if (lower.startsWith('please ' + v + ' ')) return message.substring(('please ' + v).length + 1);
  }
  return message;
}

async function resolveTarget(name, sets) {
  const lower = name.toLowerCase();
  if (['everyone', 'all', 'all groups', 'everybody'].includes(lower)) return 'all';
  if (sets[lower]) return lower;
  
  const contactNumber = resolveContact(lower);
  if (contactNumber) return contactNumber;
  
  try {
    const chats = await client.getChats();
    const found = await findChatByTargetName(chats, name);
    if (found) return found.name;
  } catch (e) { /* ignore */ }
  return null;
}

async function executeSend(parsed, msg) {
  try {
    if (!parsed.message?.trim()) {
      await botReply(msg, '❌ Message is empty. Type your message first, reply to it, then say "send to <target>".');
      return;
    }

    const sets = loadSets();
    
    if (parsed.isAll) {
      const groups = sets.all || [];
      if (groups.length === 0) { await botReply(msg, 'No groups in "all" set'); return; }
      const allText = safety.shuffled(groups);
      await botReply(msg, `Sending to ${allText.length} groups, spread out — this will take a while.`);
      for (let i = 0; i < allText.length; i++) {
        await resolveAndSend(allText[i], safety.varyCaption(parsed.message));
        if (i < allText.length - 1) await safety.broadcastGap();
      }
      await botReply(msg, `Sent to ${groups.length} groups ✅`);
      return;
    }

    const setGroups = sets[parsed.target.toLowerCase()];
    if (setGroups) {
      const setText = safety.shuffled(setGroups);
      await botReply(msg, `Sending to ${setText.length} groups, spread out — this will take a while.`);
      for (let i = 0; i < setText.length; i++) {
        await resolveAndSend(setText[i], safety.varyCaption(parsed.message));
        if (i < setText.length - 1) await safety.sendGap();
      }
      await botReply(msg, `Sent to ${setGroups.length} groups in "${parsed.target}" ✅`);
      return;
    }

    try {
      const chats = await client.getChats();
      const matches = await findChatMatchesByName(chats, parsed.target);
      if (matches.length > 1) {
        let text = `Multiple matches for "${parsed.target}". Be more specific:\n`;
        matches.slice(0, 8).forEach((c, i) => { text += `${i + 1}. ${c.name}\n`; });
        await botReply(msg, text.trim());
        return;
      }
      const jid = await resolveTargetJid(parsed.target);
      const chat = await client.getChatById(jid);
      log(`[SEND] resolved "${parsed.target}" → "${chat?.name || parsed.target}" (${jid})`);
      await resolveAndSend(jid, parsed.message);
      await botReply(msg, `Sent to ${chat?.name || parsed.target}`);
      return;
    } catch (e) {
      await botReply(msg, `Target "${parsed.target}" not found. Use !groups, !contacts, or !sets.`);
      return;
    }
  } catch (err) {
    console.error(`Execute send error: ${err.message}`);
    await botReply(msg, `Error: ${err.message}`);
  }
}

async function sendToTarget(target, message, msg, silent = false) {
  try {
    const sets = loadSets();
    const setGroups = sets[target.toLowerCase()];
    if (setGroups) {
      console.log(`Sending to set "${target}" (${setGroups.length} groups)`);
      const members = safety.shuffled(setGroups);
      for (let i = 0; i < members.length; i++) {
        await resolveAndSend(members[i], safety.varyCaption(message));
        if (i < members.length - 1) await safety.sendGap();
      }
      if (!silent) { await botReply(msg, `Sent to ${members.length} groups`); }
      return;
    }

    if (/^\+?\d{10,15}$/.test(target)) {
      const jid = `${target.replace('+', '')}@s.whatsapp.net`;
      await resolveAndSend(jid, message);
      if (!silent) { await botReply(msg, `Sent to ${target}`); }
      return;
    }

    await resolveAndSend(target, message);
    if (!silent) { await botReply(msg, `Sent to ${target}`); }
  } catch (err) {
    console.error(`Send error: ${err.message}`);
    if (!silent) { await botReply(msg, `Error: ${err.message}`); }
  }
}

function removeEmojis(str) {
  return str.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
}

function normalizeNameForMatch(str) {
  return removeEmojis(str)
    .toLowerCase()
    .replace(/[-–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_TARGET_WORDS = new Set([
  'group', 'groups', 'sets', 'set', 'all', 'the', 'msg', 'message', 'send', 'say', 'tell',
]);

function scoreChatNameMatch(targetNorm, chatNameNorm) {
  if (!targetNorm || !chatNameNorm) return 0;
  if (chatNameNorm === targetNorm) return 10000 + chatNameNorm.length;
  if (chatNameNorm.includes(targetNorm)) return 5000 + chatNameNorm.length;
  if (targetNorm.includes(chatNameNorm) && chatNameNorm.length >= 3) return 1000 + chatNameNorm.length;
  return 0;
}

function isAnnouncementGroup(chat) {
  return !!(chat?.groupMetadata?.announce || chat?._data?.groupMetadata?.announce);
}

function getGroupParticipantCount(chat) {
  return chat.participants?.length || chat.groupMetadata?.participants?.length || 0;
}

function getGroupTypeLabel(chat, allChats = null) {
  if (!chat?.isGroup) return 'chat';
  if (isAnnouncementGroup(chat)) return 'announcement';
  const parentId = chat.groupMetadata?.parentGroupId?._serialized || chat.groupMetadata?.parentGroupId;
  if (parentId) return 'linked';
  // Community parent shells share a display name with an announcement group.
  // Do NOT use member-count alone — that false-positives small real groups
  // (e.g. "Kolam Workshop" with 3 members).
  if (allChats && chat.name) {
    const pair = findCommunityPairByName(allChats, chat.name);
    if (pair?.community?.id?._serialized === chat.id?._serialized) return 'community';
  }
  return 'group';
}

function isUserGroupAdmin(chat) {
  if (!myNumber || !chat?.isGroup) return false;
  const parts = chat.groupMetadata?.participants || chat.participants || [];
  const meNorm = myNumber.replace(/@.*/, '');
  return parts.some((p) => {
    const id = p.id?._serialized || String(p.id || '');
    const idNorm = id.replace(/@.*/, '');
    return (id === myNumber || idNorm === meNorm) && (p.isAdmin || p.isSuperAdmin);
  });
}

async function canPostToGroup(chat, allChats = null) {
  return getSendPermission(chat, allChats).ok;
}

function matchesGroupTypeFilter(chat, groupType, allChats = null) {
  if (!groupType) return true;
  const label = getGroupTypeLabel(chat, allChats);
  if (groupType === 'announcement') return label === 'announcement';
  if (groupType === 'community') return label === 'community' || (!isAnnouncementGroup(chat) && label !== 'linked');
  if (groupType === 'discussion' || groupType === 'group') return !isAnnouncementGroup(chat);
  return true;
}

async function pickAmongSameNameChats(candidates) {
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];

  const details = await Promise.all(candidates.map(async (chat) => {
    let lastTs = 0;
    try {
      const msgs = await Promise.race([
        chat.fetchMessages({ limit: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      if (msgs[0]) lastTs = msgs[0].timestamp;
    } catch { /* ignore */ }
    const announce = isAnnouncementGroup(chat);
    const isAdmin = isUserGroupAdmin(chat);
    return {
      chat,
      lastTs,
      jid: chat.id?._serialized,
      announce,
      isAdmin,
      canPost: !announce || isAdmin,
      type: getGroupTypeLabel(chat, candidates),
      participants: getGroupParticipantCount(chat),
    };
  }));

  const hasAnnounce = details.some((d) => d.announce);
  const hasCommunity = details.some((d) => d.type === 'community');
  const annDetail = details.find((d) => d.announce);

  // Community + announcement pair: community shell is never postable; need announcement admin
  if (hasAnnounce && hasCommunity && !annDetail?.isAdmin) {
    log(`[MATCH] ${candidates.length} named "${candidates[0].chat.name}" — community pair, user not admin`);
    return null;
  }

  const pickPool = details.filter((d) => d.type !== 'community');

  pickPool.sort((a, b) => {
    const aGroup = a.chat.isGroup && a.jid?.endsWith('@g.us') ? 1 : 0;
    const bGroup = b.chat.isGroup && b.jid?.endsWith('@g.us') ? 1 : 0;
    if (bGroup !== aGroup) return bGroup - aGroup;
    if (a.canPost !== b.canPost) return b.canPost - a.canPost;
    if (a.announce !== b.announce) return a.announce - b.announce;
    if (b.lastTs !== a.lastTs) return b.lastTs - a.lastTs;
    if (b.participants !== a.participants) return b.participants - a.participants;
    return (b.chat.pinned || 0) - (a.chat.pinned || 0);
  });

  const picked = pickPool[0];
  if (!picked) return null;
  const others = details.map((d) =>
    `${d.jid}${d.announce ? '(ann)' : `(${d.type})`} postable=${d.canPost} activity=${d.lastTs || 'none'}`
  ).join(' | ');
  log(`[MATCH] ${candidates.length} named "${picked.chat.name}" → picked ${picked.jid} (${picked.type}${picked.announce ? ', announcement' : ''}) | ${others}`);
  return picked.chat;
}

async function collapseDuplicateNameMatches(matches, options = {}) {
  if (matches.length <= 1) return matches;

  const byName = new Map();
  for (const chat of matches) {
    const key = normalizeNameForMatch(chat.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(chat);
  }

  const collapsed = [];
  for (const group of byName.values()) {
    if (group.length > 1) {
      const hasAnnounce = group.some(isAnnouncementGroup);
      const hasNonAnnounce = group.some((c) => !isAnnouncementGroup(c));
      if (options.groupType && hasAnnounce && hasNonAnnounce) {
        for (const chat of group) {
          if (matchesGroupTypeFilter(chat, options.groupType, group)) collapsed.push(chat);
        }
        continue;
      }
    }
    const picked = await pickAmongSameNameChats(group);
    if (picked) collapsed.push(picked);
  }
  return collapsed.filter(Boolean);
}

async function findChatMatchesByName(chats, target, options = {}) {
  const targetNorm = normalizeNameForMatch(target);
  if (!targetNorm || targetNorm.length < 3 || GENERIC_TARGET_WORDS.has(targetNorm)) return [];

  const scored = chats
    .filter((c) => c.name)
    .map((c) => ({
      chat: c,
      score: scoreChatNameMatch(targetNorm, normalizeNameForMatch(c.name)),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.chat.name.length - a.chat.name.length);

  if (scored.length === 0) return [];
  const topScore = scored[0].score;
  let topMatches = scored.filter((x) => x.score === topScore).map((x) => x.chat);
  topMatches = await collapseDuplicateNameMatches(topMatches, options);
  if (options.groupType) {
    topMatches = topMatches.filter((c) => matchesGroupTypeFilter(c, options.groupType, chats));
  }
  return topMatches;
}

async function findChatByTargetName(chats, target, options = {}) {
  const { name, groupType } = parseTargetWithQualifier(target);
  const matches = await findChatMatchesByName(chats, name, { ...options, groupType: options.groupType || groupType });
  return matches[0] || null;
}

function inferDefaultCountryCode() {
  if (process.env.DEFAULT_COUNTRY_CODE) return process.env.DEFAULT_COUNTRY_CODE.replace(/\D/g, '');
  if (!myNumber) return '91';
  const digits = myNumber.replace(/\D/g, '');
  if (digits.length > 10) return digits.slice(0, digits.length - 10);
  return '91';
}

function normalizePhoneDigits(digits) {
  let d = String(digits).replace(/\D/g, '');
  if (d.length === 10 && /^[6-9]\d{9}$/.test(d)) {
    d = inferDefaultCountryCode() + d;
  }
  return d;
}

function extractPhoneDigitsFromJid(jid) {
  if (!jid || jid.includes('@g.us') || isLidJid(jid)) return null;
  // Only real phone JIDs — never treat Linked-ID (@lid) digits as a phone number
  const m = jid.match(/^(\d{10,15})@(c\.us|s\.whatsapp\.net)$/);
  return m ? m[1] : null;
}

async function resolvePhoneSendCandidates(phoneInput) {
  const normalized = normalizePhoneDigits(phoneInput);
  const candidates = new Set();

  let wid = null;
  try {
    wid = await client.getNumberId(normalized);
  } catch (err) {
    log(`[SEND] getNumberId failed for ${normalized}: ${err.message}`);
  }

  if (!wid) {
    throw new Error(`${normalized} is not on WhatsApp (check country code, e.g. 91XXXXXXXXXX)`);
  }

  const widStr = wid._serialized || String(wid);
  candidates.add(widStr);
  candidates.add(`${normalized}@c.us`);
  candidates.add(`${normalized}@s.whatsapp.net`);

  try {
    const [mapping] = await client.getContactLidAndPhone([widStr, `${normalized}@c.us`]);
    if (mapping?.lid) candidates.add(mapping.lid);
    if (mapping?.pn) candidates.add(mapping.pn);
  } catch (err) {
    log(`[SEND] LID lookup for ${normalized}: ${err.message}`);
  }

  try {
    await Promise.race([
      client.getChatById(widStr),
      new Promise((_, reject) => setTimeout(() => reject(new Error('getChat timeout')), 10000)),
    ]);
    const [mapping] = await client.getContactLidAndPhone([widStr]);
    if (mapping?.lid) candidates.add(mapping.lid);
  } catch (err) {
    log(`[SEND] Chat warm-up for ${normalized}: ${err.message}`);
  }

  return [...candidates].filter(Boolean);
}

function isLidJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

function isGroupJid(jid) {
  return typeof jid === 'string' && (jid.endsWith('@g.us') || jid.includes('newsletter'));
}

async function resolveSendableJids(jid) {
  if (!jid) return [];
  if (isGroupJid(jid)) return [jid];

  // Linked-device IDs (@lid) are not phone numbers — send via the chat/LID path.
  if (isLidJid(jid)) {
    const candidates = new Set([jid]);
    try {
      const chat = await client.getChatById(jid);
      if (chat) {
        const contact = await chat.getContact();
        if (contact?.number) {
          const num = normalizePhoneDigits(String(contact.number).replace(/\D/g, ''));
          if (num) {
            candidates.add(`${num}@c.us`);
            candidates.add(`${num}@s.whatsapp.net`);
          }
        }
        const contactId = contact?.id?._serialized;
        if (contactId) candidates.add(contactId);
      }
    } catch (err) {
      log(`[SEND] Contact lookup failed for ${jid}: ${err.message}`);
    }
    try {
      const [mapping] = await client.getContactLidAndPhone([jid]);
      if (mapping?.pn) candidates.add(mapping.pn);
      if (mapping?.lid) candidates.add(mapping.lid);
    } catch (err) {
      log(`[SEND] LID/phone lookup failed for ${jid}: ${err.message}`);
    }
    return [...candidates].filter(Boolean);
  }

  const phoneDigits = extractPhoneDigitsFromJid(jid);
  if (phoneDigits) {
    return resolvePhoneSendCandidates(phoneDigits);
  }

  const candidates = new Set([jid]);

  if (jid.endsWith('@s.whatsapp.net')) {
    const num = normalizePhoneDigits(jid.replace('@s.whatsapp.net', ''));
    candidates.add(`${num}@c.us`);
  }

  try {
    const [mapping] = await client.getContactLidAndPhone([jid]);
    if (mapping?.lid) candidates.add(mapping.lid);
    if (mapping?.pn) {
      candidates.add(mapping.pn);
      if (mapping.pn.endsWith('@c.us')) {
        const num = mapping.pn.replace('@c.us', '');
        candidates.add(`${num}@s.whatsapp.net`);
      }
    }
  } catch (err) {
    log(`[SEND] LID/phone lookup failed for ${jid}: ${err.message}`);
  }

  return [...candidates].filter(Boolean);
}

async function sendMessageToJid(jid, content, options = {}) {
  const jids = await resolveSendableJids(jid);
  // Groups (especially announcement) can take 60s+ to ack — don't block on delivery.
  const waitUntilMsgSent = options.waitUntilMsgSent ?? !isGroupJid(jids[0]);
  let lastErr;
  for (const attemptJid of jids) {
    try {
      const result = await client.sendMessage(attemptJid, content, {
        ...options,
        waitUntilMsgSent,
      });
      log(`[SEND] ✅ via ${attemptJid}${waitUntilMsgSent ? '' : ' (queued)'}`);
      reach.track(result, { jid: attemptJid, content, caption: options.caption });
      return result;
    } catch (err) {
      lastErr = err;
      log(`[SEND] failed via ${attemptJid}: ${err.message}`);
    }
  }
  throw lastErr || new Error(`Failed to send to ${jid}`);
}

async function resolveTargetJid(target) {
  if (!target) throw new Error('No target specified');
  if (target.includes('@')) return target;

  const { name, groupType } = parseTargetWithQualifier(target);

  if (/^\+?\d{10,15}$/.test(name)) {
    return `${normalizePhoneDigits(name.replace(/\D/g, ''))}@c.us`;
  }

  const contact = resolveContact(name);
  if (contact) {
    return `${normalizePhoneDigits(contact.replace(/\D/g, ''))}@c.us`;
  }

  const chats = await client.getChats();
  const matches = await findChatMatchesByName(chats, name, { groupType });
  if (matches.length === 0) {
    const pair = findCommunityPairByName(chats, name);
    if (pair && !isUserGroupAdmin(pair.announcement)) {
      throw new Error(buildCommunityAdminOnlyError(name, false));
    }
    throw new Error(`Target "${name}" not found`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple matches for "${name}" — be more specific`);
  }
  const picked = matches[0];
  const permission = getSendPermission(picked, chats);
  if (!permission.ok) throw new Error(permission.reason);
  return picked.id._serialized;
}

async function resolveGroupByName(name) {
  const chats = await client.getChats();
  const matches = await findChatMatchesByName(chats, name);
  if (matches.length === 0) {
    return { error: `Group "${name}" not found. Use !groups to list.` };
  }
  if (matches.length > 1) {
    let text = `Multiple groups match "${name}". Be more specific:\n`;
    matches.slice(0, 6).forEach((c, i) => {
      text += `${i + 1}. ${c.name}${formatGroupTypeHint(c, chats)}\n`;
    });
    return { error: text.trim() };
  }

  let chat = matches[0];
  // Refresh chat so participants/admin metadata are loaded (list models often omit them)
  try {
    const fresh = await Promise.race([
      client.getChatById(chat.id._serialized),
      new Promise((_, reject) => setTimeout(() => reject(new Error('getChatById timeout')), 15000)),
    ]);
    if (fresh) chat = fresh;
  } catch (err) {
    log(`[ADD-MEMBERS] refresh "${chat.name}" failed: ${err.message}`);
  }

  const count = getGroupParticipantCount(chat);
  if (getGroupTypeLabel(chat, chats) === 'community') {
    return {
      error:
        `"${chat.name}" looks like a WhatsApp Community shell (${count} members), not a regular group.\n` +
        `Use the announcement/discussion group name from !groups, or say the exact member-group title.`,
    };
  }
  if (count > 0 && !isUserGroupAdmin(chat)) {
    return { error: `You are not an admin of "${chat.name}". Only admins can add members.` };
  }
  if (count === 0) {
    log(`[ADD-MEMBERS] proceeding with "${chat.name}" without local participant list (admin check deferred to WhatsApp)`);
  }
  return { chat };
}

async function resolveParticipantWids(numbers) {
  const wids = [];
  const failed = [];
  const entries = [];
  for (const raw of numbers) {
    const digits = normalizePhoneDigits(String(raw).replace(/\D/g, ''));
    try {
      const wid = await client.getNumberId(digits);
      if (!wid) {
        failed.push({ num: digits, error: 'Not on WhatsApp' });
        continue;
      }
      const widStr = wid._serialized || `${digits}@c.us`;
      wids.push(widStr);
      entries.push({ digits, wid: widStr });
    } catch (err) {
      failed.push({ num: digits, error: err.message.split('\n')[0] });
    }
  }
  return { wids, failed, entries };
}

async function validateScheduleTarget(target) {
  const lower = target.toLowerCase();
  const sets = loadSets();
  if (sets[lower]) return;
  if (resolveContact(target)) return;
  await resolveTargetJid(target);
}

async function resolveAndSend(target, message) {
  if (!message?.trim()) throw new Error('Cannot send an empty message');
  const jid = await resolveTargetJid(target);
  log(`[SEND] → ${jid}: "${message.substring(0, 80)}"`);
  // Presence is best-effort and must not cost the send if the chat won't load.
  if (safety.CONFIG.typingSimulation) {
    try {
      await safety.withTypingPresence(await client.getChatById(jid), message);
    } catch { /* send anyway */ }
  }
  await sendMessageToJid(jid, message);
  sendBudget.record();
  safety.auditSend({ kind: 'text', target: jid, chars: message.length });
  logSend(jid, { kind: 'text', chars: message.length });
}


function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleAIChat(text, msg) {
  console.log(`[AI-CHAT] ${text}`);
  const reply = await forwardToZeroClaw(text);
  if (reply) {
    await botReply(msg, reply);
    console.log(`[AI-REPLY] ${reply.substring(0, 100)}`);
  }
}

function forwardToZeroClaw(message) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ message });
    const req = http.request({
      hostname: '127.0.0.1', port: 42617, path: '/webhook', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data).response); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

const WEB_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function isStaticAsset(pathname) {
  if (pathname === '/' || pathname.startsWith('/dashboard')) return true;
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/icons/')) return true;
  if (pathname === '/sw.js' || pathname === '/manifest.webmanifest' || pathname === '/config.js') return true;
  return /\.(css|js|png|svg|ico|webmanifest)$/i.test(pathname);
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function requireAuth(req, res, roles) {
  if (!auth.validateAuth(req)) {
    jsonResponse(res, 401, { error: 'Unauthorized' });
    return false;
  }
  if (roles && roles.length) {
    const role = auth.getRole(req) || 'admin';
    if (!roles.includes(role)) {
      jsonResponse(res, 403, { error: 'Forbidden — admin only' });
      return false;
    }
  }
  return true;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function serveStaticFile(req, res, parsed) {
  let reqPath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  if (reqPath.startsWith('/dashboard')) {
    reqPath = reqPath === '/dashboard' || reqPath === '/dashboard/'
      ? '/index.html'
      : reqPath.replace(/^\/dashboard/, '') || '/index.html';
  }
  const safe = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(DOCS_DIR, safe);
  if (!filePath.startsWith(DOCS_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('Not found');
    return true;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': WEB_MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function startSendServer() {
  if (sendServer) return;

  auth.checkStartupAuth(log);

  sendServer = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end();
      return;
    }

    if (req.method === 'GET' && isStaticAsset(parsed.pathname)) {
      if (serveStaticFile(req, res, parsed)) return;
    }

    if (req.method === 'POST' && parsed.pathname === '/auth/login') {
      try {
        const body = await readRequestBody(req);
        const { password } = JSON.parse(body || '{}');
        const result = auth.login(password || '');
        if (!result.ok) {
          jsonResponse(res, 401, { error: result.error });
          return;
        }
        jsonResponse(res, 200, {
          token: result.token,
          expiresAt: result.expiresAt,
          role: result.role || 'admin',
        });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/auth/vjn-exchange') {
      try {
        const body = await readRequestBody(req);
        const { token } = JSON.parse(body || '{}');
        const result = await auth.exchangeVjnToken(token || '');
        if (!result.ok) {
          jsonResponse(res, result.status || 401, { error: result.error });
          return;
        }
        jsonResponse(res, 200, {
          token: result.token,
          expiresAt: result.expiresAt,
          role: result.role,
          user: result.user,
        });
      } catch (err) {
        jsonResponse(res, 500, { error: err.message });
      }
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/auth/me') {
      if (!requireAuth(req, res)) return;
      jsonResponse(res, 200, {
        role: auth.getRole(req) || 'admin',
        authRequired: auth.isAuthRequired(),
      });
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/auth/logout') {
      auth.logout(auth.getBearerToken(req));
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/sets') {
      if (!requireAuth(req, res)) return;
      try {
        res.writeHead(200); res.end(JSON.stringify({ sets: loadSets() }));
      } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/sets') {
      // Promotions builds its own sets (Settings → Sets) to post to.
      if (!requireAuth(req, res, ['admin', 'promotions'])) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!data.sets || typeof data.sets !== 'object') {
            res.writeHead(400); res.end(JSON.stringify({ error: 'Body must include { sets: {...} }' }));
            return;
          }
          for (const [name, jids] of Object.entries(data.sets)) {
            if (!Array.isArray(jids)) {
              res.writeHead(400); res.end(JSON.stringify({ error: `Set "${name}" must be an array of JIDs` }));
              return;
            }
          }
          const before = Object.keys(loadSets());
          saveSets(data.sets);
          const after = Object.keys(data.sets);
          const added = after.filter((n) => !before.includes(n));
          const removed = before.filter((n) => !after.includes(n));
          if (added.length || removed.length) {
            activity.recordEvent({
              category: 'set',
              type: 'ok',
              title: removed.length && !added.length
                ? `Deleted set "${removed.join('", "')}"`
                : `Saved set "${(added[0] || after[after.length - 1] || 'set')}"`,
              detail: `${after.length} set${after.length === 1 ? '' : 's'} total`,
              via: 'api',
              actor: auth.getActor(req),
              meta: { added, removed },
              push: true,
            });
          }
          res.writeHead(200); res.end(JSON.stringify({ ok: true, sets: loadSets() }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/send') {
      if (!requireAuth(req, res)) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { recipient, message, jid } = JSON.parse(body);
          let target = jid || recipient;
          if (!target || !message) { res.writeHead(400); res.end('{}'); return; }
          const actor = auth.getActor(req);
          const sets = loadSets();
          const setGroups = sets[target.toLowerCase()];
          if (setGroups) {
            // Answer before fanning out: paced sending takes minutes, far
            // longer than any client is willing to hold the socket open.
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true, count: setGroups.length, paced: true }));
            const corrId = `set-${Date.now()}`;
            const members = safety.shuffled(setGroups);
            const failures = [];
            await withSendContext({ via: 'manual', corrId, actor }, async () => {
              for (let i = 0; i < members.length; i++) {
                try {
                  await resolveAndSend(members[i], safety.varyCaption(message));
                } catch (err) {
                  failures.push({ target: members[i], error: err.message });
                  log(`[SEND] set "${target}" → ${members[i]}: ${err.message}`);
                }
                if (i < members.length - 1) await safety.sendGap();
              }
            });
            const sent = members.length - failures.length;
            activity.recordEvent({
              category: 'send',
              type: failures.length ? (sent ? 'warn' : 'err') : 'ok',
              ok: !failures.length,
              title: `Sent to ${sent} of ${members.length} groups in "${target}"`,
              detail: failures.length ? `${failures.length} failed` : '',
              target,
              count: sent,
              via: 'manual',
              corrId,
              actor,
              meta: { message, set: target, total: members.length, sent, failures },
              push: true,
            });
            return;
          }
          try {
            await withSendContext({ via: 'manual', actor, message }, () => resolveAndSend(target, message));
          } catch (err) {
            activity.recordEvent({
              category: 'send', type: 'err', ok: false,
              title: 'Message failed to send',
              detail: err.message, target, via: 'manual', actor,
              meta: { message, error: err.message },
            });
            throw err;
          }
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/send-media') {
      if (!requireAuth(req, res)) return;
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { recipient, filePath, caption, jid } = JSON.parse(body);
          let target = jid || recipient;
          if (!target || !filePath) { res.writeHead(400); res.end('{}'); return; }
          if (!target.includes('@')) {
            const chats = await client.getChats();
            const group = chats.find(c => c.isGroup && c.name.toLowerCase() === target.toLowerCase());
            if (group) target = group.id._serialized;
          }
          const actor = auth.getActor(req);
          const mediaMeta = { caption: caption || '', file: path.basename(String(filePath)) };
          try {
            const chat = await client.getChatById(target);
            if (!chat) throw new Error('Chat not found');
            const media = MessageMedia.fromFilePath(filePath);
            const sent = await chat.sendMessage(media, { caption: caption || '' });
            reach.track(sent, { jid: target, content: media, caption, context: { via: 'manual', actor } });
            activity.recordEvent({
              category: 'send', type: 'ok', ok: true,
              title: `Sent media to ${chat.name || target}`,
              target, count: 1, via: 'manual', actor, meta: mediaMeta,
            });
          } catch (err) {
            activity.recordEvent({
              category: 'send', type: 'err', ok: false,
              title: 'Media failed to send',
              detail: err.message, target, via: 'manual', actor,
              meta: { ...mediaMeta, error: err.message },
            });
            const status = err.message === 'Chat not found' ? 404 : 500;
            res.writeHead(status); res.end(JSON.stringify(status === 404 ? {} : { error: err.message }));
            return;
          }
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/groups') {
      if (!requireAuth(req, res)) return;
      try {
        const force = parsed.query.refresh === '1';
        const groups = apiHandlers
          ? await apiHandlers.getGroupsEnriched(force)
          : [];
        jsonResponse(res, 200, groups);
      } catch (err) {
        if (notifyWhatsAppSessionError(err, 'GET /groups')) {
          whatsAppUnavailableResponse(res, true);
          return;
        }
        jsonResponse(res, 500, { error: err.message });
      }
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/health') {
      const authed = auth.validateAuth(req);
      const payload = {
        status: 'ok',
        authRequired: auth.isAuthRequired(),
        commandsGroupName: COMMANDS_GROUP_NAME,
        whatsapp: getWhatsAppHealth(authed),
      };
      if (authed) {
        payload.info = (waLink.state === 'connected' && client?.info) ? client.info : null;
        payload.commandsGroup = commandsGroupJid;
      }
      jsonResponse(res, 200, payload);
      return;
    }

    // "Email me the QR" button on the status pages. Open (no login) because the
    // mail only ever goes to SANDESHA_NOTIFY_EMAIL; a cooldown stops spamming.
    if (req.method === 'POST' && parsed.pathname === '/pairing/email-qr') {
      if (!isNotifyConfigured()) {
        jsonResponse(res, 503, { error: 'Email is not set up on the Sandesha server' });
        return;
      }
      if (waLink.state === 'connected') {
        jsonResponse(res, 409, { error: 'WhatsApp is already linked' });
        return;
      }
      const wait = QR_EMAIL_COOLDOWN_MS - (Date.now() - lastQrEmailRequestAt);
      if (wait > 0) {
        jsonResponse(res, 429, { error: `Already sent. Try again in ${Math.ceil(wait / 1000)}s`, retryAfter: Math.ceil(wait / 1000) });
        return;
      }
      const hasQr = waLink.state === 'pairing' && waLink.qrIssued && fs.existsSync(QR_PATH);
      if (!hasQr && !waLink.pairingCodeRaw) {
        jsonResponse(res, 404, { error: 'No QR available yet. Try again in a few seconds' });
        return;
      }
      lastQrEmailRequestAt = Date.now();
      const r = hasQr ? await sendQrEmail(QR_PATH) : await sendPairingCodeEmail(waLink.pairingCodeRaw);
      if (!r.sent) {
        lastQrEmailRequestAt = 0;
        log('Failed to email QR on request:', r.error || 'unknown');
        jsonResponse(res, 502, { error: 'Could not send the email' });
        return;
      }
      log('QR emailed on request');
      jsonResponse(res, 200, { sent: true });
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/pairing/qr.png') {
      if (!auth.validateAuth(req)) {
        jsonResponse(res, 401, { error: 'Unauthorized' });
        return;
      }
      if (!fs.existsSync(QR_PATH)) {
        jsonResponse(res, 404, { error: 'No QR yet' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(QR_PATH).pipe(res);
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/chats') {
      if (!requireAuth(req, res)) return;
      try {
        const limit = Math.min(parseInt(parsed.query.limit, 10) || 200, 500);
        const chats = await client.getChats();
        const sorted = chats
          .filter((c) => c?.name && c?.id?._serialized)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0) || (b.pinned || 0) - (a.pinned || 0));
        const page = sorted.slice(0, limit);
        jsonResponse(res, 200, {
          total: chats.length,
          chats: page.map((c) => ({
            name: c.name,
            jid: c.id._serialized,
            isGroup: !!c.isGroup,
          })),
        });
      } catch (err) {
        if (notifyWhatsAppSessionError(err, 'GET /chats')) {
          whatsAppUnavailableResponse(res, true);
          return;
        }
        jsonResponse(res, 500, { error: err.message });
      }
      return;
    }

    if (reach.handleRequest(req, res, parsed, requireAuth)) return;

    if (apiHandlers) {
      const handled = await apiHandlers.handleRequest(req, res, parsed, requireAuth);
      if (handled) return;
    }

    res.writeHead(404); res.end('Not found');
  });

  sendServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log(`Port ${LISTEN_PORT} already in use. Run: ./start.sh  (or kill the process on port ${LISTEN_PORT})`);
    } else {
      log(`HTTP server error: ${err.message}`);
    }
    process.exit(1);
  });

  sendServer.listen(LISTEN_PORT, '127.0.0.1', () => {
    console.error(`[${new Date().toISOString()}] Send server on http://127.0.0.1:${LISTEN_PORT}`);
    console.error(`[${new Date().toISOString()}] Dashboard:  http://127.0.0.1:${LISTEN_PORT}/`);
    console.error(`[${new Date().toISOString()}] =========================================`);
    console.error(`[${new Date().toISOString()}] IMPORTANT: Join the "Me Commands" group on WhatsApp to send bot commands!`);
    console.error(`[${new Date().toISOString()}] =========================================`);
  });
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)} weeks ago`;
  return `${Math.floor(seconds / 2592000)} months ago`;
}

async function handleNaturalSchedule(message, schedulePart, msg) {
  // Parse: schedule to <target> at <time>
  // schedulePart is like "schedule to family at 9am tomorrow"
  
  const match = schedulePart.match(/^schedule\s+to\s+(\S+)\s+at\s+(.+)$/i);
  if (!match) {
    await botReply(msg, `Usage: <message> !schedule to <target> at <time>
Example: Hello everyone !schedule to family at 9am tomorrow`);
    return;
  }
  
  const target = match[1].trim();
  const timeStr = match[2].trim();
  
  const runAt = parseScheduleTime(timeStr);
  if (!runAt) {
    await botReply(msg, `Could not understand time: "${timeStr}"
Try: 9am, 9:30am, 9am tomorrow, 9am monday`);
    return;
  }

  try {
    await validateScheduleTarget(target);
  } catch (e) {
    await botReply(msg, `Cannot schedule to "${target}": ${e.message}
Add to contacts.json, groups.json, or use an exact WhatsApp chat name.`);
    return;
  }

  const schedules = loadSchedules();
  const runAtIso = runAt.toISOString();
  const msgNorm = String(message).trim();
  const targetNorm = target.toLowerCase();
  const dup = schedules.find((s) =>
    String(s.message || '').trim() === msgNorm &&
    String(s.target || '').trim().toLowerCase() === targetNorm &&
    s.runAt === runAtIso &&
    (Date.now() - new Date(s.createdAt || 0).getTime()) < 15000,
  );
  if (dup) {
    await botReply(msg, `Already scheduled ✅
"${msgNorm}" → ${target}
Will send: ${runAt.toLocaleString()}`);
    return;
  }

  const sets = loadSets();
  const isSet = !!sets[targetNorm];
  const schedule = {
    id: nextLocalScheduleId(schedules),
    message: msgNorm,
    target,
    isSet,
    runAt: runAtIso,
    createdAt: new Date().toISOString()
  };
  
  schedules.push(schedule);
  saveSchedules(schedules);
  
  const timeUntil = formatTimeUntil(runAt);
  await botReply(msg, `Scheduled! ✅
"${message}" → ${target}${isSet ? ' (set)' : ''}
Will send: ${runAt.toLocaleString()}
(${timeUntil})`);
}

async function handleSchedule(raw, msg) {
  // Parse: !schedule <message> to <target> at <time>
  // Or: !remind <message> to <target> at <time>
  const text = raw.replace(/^(schedule|remind)\s+/i, '');
  
  // Find " at " (with spaces) to separate message+target from time
  // Use lastIndexOf to handle messages that contain " at "
  const atIndex = text.lastIndexOf(' at ');
  if (atIndex === -1) {
    await botReply(msg, `Usage: !schedule <msg> to <target> at <time>
Example: !schedule hello to family at 9am tomorrow
Example: !schedule good morning to everyone at 8am`);
    return;
  }
  
  const beforeAt = text.substring(0, atIndex);
  const timeStr = text.substring(atIndex + 4).trim();
  
  // Now find " to " to separate message from target
  const toIndex = beforeAt.lastIndexOf(' to ');
  if (toIndex === -1) {
    await botReply(msg, `Usage: !schedule <msg> to <target> at <time>
Example: !schedule hello to family at 9am tomorrow`);
    return;
  }
  
  const message = beforeAt.substring(0, toIndex).trim();
  const target = beforeAt.substring(toIndex + 4).trim();
  
  if (!message || !target) {
    await botReply(msg, `Usage: !schedule <msg> to <target> at <time>`);
    return;
  }
  
  const runAt = parseScheduleTime(timeStr);
  if (!runAt) {
    await botReply(msg, `Could not understand time: "${timeStr}"
Try: 9am, 9:30am, 9am tomorrow, 9am monday, 14:30`);
    return;
  }

  try {
    await validateScheduleTarget(target);
  } catch (e) {
    await botReply(msg, `Cannot schedule to "${target}": ${e.message}
Add to contacts.json, groups.json, or use an exact WhatsApp chat name.`);
    return;
  }

  const schedules = loadSchedules();
  const runAtIso = runAt.toISOString();
  const msgNorm = String(message).trim();
  const targetNorm = target.toLowerCase();
  const dup = schedules.find((s) =>
    String(s.message || '').trim() === msgNorm &&
    String(s.target || '').trim().toLowerCase() === targetNorm &&
    s.runAt === runAtIso &&
    (Date.now() - new Date(s.createdAt || 0).getTime()) < 15000,
  );
  if (dup) {
    await botReply(msg, `Already scheduled ✅
"${msgNorm}" → ${target}
Will send: ${runAt.toLocaleString()}`);
    return;
  }

  const sets = loadSets();
  const isSet = !!sets[targetNorm];
  const schedule = {
    id: nextLocalScheduleId(schedules),
    message: msgNorm,
    target,
    isSet,
    runAt: runAtIso,
    createdAt: new Date().toISOString()
  };
  
  schedules.push(schedule);
  saveSchedules(schedules);
  
  const timeUntil = formatTimeUntil(runAt);
  await botReply(msg, `Scheduled! ✅
"${message}" → ${target}${isSet ? ' (set)' : ''}
Will send: ${runAt.toLocaleString()}
(${timeUntil})`);
}

function nextLocalScheduleId(existing) {
  let id = Date.now();
  const ids = new Set((existing || []).map((s) => Number(s.id)));
  while (ids.has(id)) id += 1;
  return id;
}

function parseScheduleTime(timeStr) {
  const now = new Date();
  let lower = timeStr.toLowerCase().trim();
  
  // Remove day names and today/tomorrow to get just the time
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  for (const day of days) {
    if (lower.includes(day)) {
      lower = lower.replace(new RegExp(day, 'gi'), '').trim();
    }
  }
  lower = lower.replace(/\btoday\b/gi, '').trim();
  lower = lower.replace(/\btomorrow\b/gi, '').trim();
  lower = lower.replace(/\s+/g, ' ').trim();
  
  // "daily at 9am" or "every day at 9am"
  if (lower.startsWith('daily') || lower.startsWith('every day')) {
    const timeMatch = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3]?.toLowerCase();
      if (period === 'pm' && hours < 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;
      
      const next = new Date();
      next.setHours(hours, minutes, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }
  }
  
  // Specific time: "9am", "9:30am", "14:30", "4.47am" (4.47 = 4:47), "6am" (no separator)
  const timeMatch = lower.match(/^(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?$/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const period = timeMatch[3]?.toLowerCase();
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    
    const result = new Date();
    result.setHours(hours, minutes, 0, 0);
    
    if (result <= now) {
      result.setDate(result.getDate() + 1);
    }
    
    // Check for today, tomorrow, monday, etc.
    if (lower.includes('today')) {
      // Keep same day
    } else if (lower.includes('tomorrow')) {
      result.setDate(result.getDate() + 1);
    } else if (lower.includes('monday')) {
      const daysUntil = (8 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('tuesday')) {
      const daysUntil = (9 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('wednesday')) {
      const daysUntil = (10 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('thursday')) {
      const daysUntil = (11 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('friday')) {
      const daysUntil = (12 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('saturday')) {
      const daysUntil = (13 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    } else if (lower.includes('sunday')) {
      const daysUntil = (14 - result.getDay()) % 7 || 7;
      result.setDate(result.getDate() + daysUntil);
    }
    
    return result;
  }
  
  // Date format: "march 30", "30 march", "march 30 at 9am"
  const dateMatch = lower.match(/(\w+)\s+(\d{1,2})(?:\s+at\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?)?/);
  if (dateMatch) {
    const monthStr = dateMatch[1];
    const day = parseInt(dateMatch[2]);
    let hours = dateMatch[3] ? parseInt(dateMatch[3]) : 9;
    let minutes = dateMatch[4] ? parseInt(dateMatch[4]) : 0;
    const period = dateMatch[5]?.toLowerCase();
    
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
    
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const month = months.findIndex(m => monthStr.startsWith(m));
    if (month >= 0) {
      const result = new Date();
      result.setMonth(month, day);
      result.setHours(hours, minutes, 0, 0);
      if (result <= now) {
        result.setFullYear(result.getFullYear() + 1);
      }
      return result;
    }
  }
  
  return null;
}

function formatTimeUntil(date) {
  const diff = date - new Date();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `in ${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes} min`;
}

/** Schedule fields + outcome, for the activity detail view. */
function scheduleActivityMeta(schedule, extra = {}) {
  return {
    scheduleId: schedule.id,
    message: schedule.message || '',
    target: schedule.target,
    isSet: !!schedule.isSet,
    runAt: schedule.runAt,
    createdAt: schedule.createdAt || '',
    file: schedule.filePath ? path.basename(schedule.filePath) : '',
    ...extra,
  };
}

let sentScheduleIds = new Set();
let schedulerRunning = false;

function writeNotification(text) {
  const entry = `[${new Date().toISOString()}] ${text}\n`;
  fs.appendFileSync(NOTIFY_FILE, entry);
  console.error(`[NOTIFY] ${text}`);
}

/**
 * One scheduled row → one chat. Rows created with a flyer go out as the image
 * with the message as its caption, so the recipient sees one post, not two.
 */
async function deliverSchedule(target, schedule, { varyText = false } = {}) {
  // Fanning the identical byte-for-byte caption across many groups is
  // trivially clusterable, so each chat gets its own framing.
  const message = varyText ? safety.varyCaption(schedule.message) : schedule.message;
  if (!schedule.filePath) {
    await resolveAndSend(target, message);
    return;
  }
  if (!fs.existsSync(schedule.filePath)) {
    throw new Error(`Attachment missing: ${path.basename(schedule.filePath)}`);
  }
  const media = MessageMedia.fromFilePath(schedule.filePath);
  await safety.mediaSettleGap();
  await resolveAndSendMedia(target, media, message || '');
}

/**
 * Deliver one schedule to every chat it targets, paced per SENDING_SAFETY.md.
 *
 * Stops early — rather than pushing through — when quiet hours open or a send
 * budget runs out, reporting what it managed so the caller can resume the rest
 * on a later tick instead of dropping or re-sending them.
 *
 * @returns {Promise<{complete: boolean, sentTo: string[], reason?: string}>}
 */
function fanOutSchedule(schedule) {
  return withSendContext(
    { via: 'scheduled', corrId: String(schedule.sourceId || schedule.id || ''), actor: schedule.createdBy || null },
    () => fanOutScheduleInner(schedule),
  );
}

async function fanOutScheduleInner(schedule) {
  const sets = loadSets();
  const targetKey = String(schedule.target || '').toLowerCase();
  const setGroups = sets[targetKey];
  // Expand sets only when marked isSet (or legacy: target is a set name, not a JID)
  const shouldExpandSet = schedule.isSet === true ||
    (schedule.isSet !== false && Array.isArray(setGroups) && !String(schedule.target).includes('@'));

  const sentTo = [...(schedule.sentTo || [])];

  if (!(shouldExpandSet && Array.isArray(setGroups) && setGroups.length)) {
    const verdict = sendBudget.check();
    if (!verdict.ok) return { complete: false, sentTo, reason: verdict.reason };
    await deliverSchedule(schedule.target, schedule);
    return { complete: true, sentTo: [schedule.target] };
  }

  const outstanding = setGroups.length - sentTo.length;
  log(`[SCHEDULE] Fanning out to ${outstanding} groups, ${Math.round(safety.CONFIG.sendMinMs / 1000)}–${Math.round(safety.CONFIG.sendMaxMs / 1000)}s apart`);

  return safety.runPacedFanOut({
    members: setGroups,
    alreadySent: sentTo,
    deliver: (member) => deliverSchedule(member, schedule, { varyText: true }),
    guard: () => {
      if (safety.inQuietHours()) return { ok: false, reason: 'quiet hours' };
      return sendBudget.check();
    },
    gap: safety.sendGap,
  });
}

/** Drop a scheduled attachment once no remaining row points at it. */
function dropScheduleMedia(filePath, remaining) {
  const abs = String(filePath || '');
  if (!abs || path.dirname(path.resolve(abs)) !== path.resolve(MEDIA_DIR)) return;
  if ((remaining || []).some((s) => s.filePath === abs)) return;
  try {
    fs.unlinkSync(abs);
  } catch { /* already gone */ }
}

function startScheduler() {
  if (schedulerInterval) return;
  log('[SCHEDULER] Starting scheduler...');

  // Run once immediately
  runSchedulerCheck();

  schedulerInterval = setInterval(() => {
    runSchedulerCheck();
  }, 30000);

  // Heads-up push ~15 min before each scheduled send.
  runScheduleHeadsUp();
  setInterval(runScheduleHeadsUp, 60000);
}

/** Best-effort friendly name for a schedule's target (group name, or set name). */
async function friendlyTarget(schedule) {
  const t = String(schedule?.target || '');
  if (schedule?.isSet || !t.includes('@')) return t || 'a list';
  try {
    const chat = await client.getChatById(t);
    return chat?.name || t;
  } catch {
    return t;
  }
}

const HEADSUP_FILE = path.join(__dirname, 'push-prewarned.json');
function loadPrewarned() {
  try { return new Set(JSON.parse(fs.readFileSync(HEADSUP_FILE, 'utf8'))); }
  catch { return new Set(); }
}
function savePrewarned(set) {
  try { fs.writeFileSync(HEADSUP_FILE, JSON.stringify([...set])); } catch { /* ignore */ }
}

let headsUpRunning = false;
async function runScheduleHeadsUp() {
  if (headsUpRunning) return;
  headsUpRunning = true;
  try {
    const schedules = loadSchedules();
    const liveIds = new Set(schedules.map((s) => String(s.id)));
    const warned = loadPrewarned();
    let changed = false;

    // Forget ids whose schedule is gone (delivered / cancelled) so a re-booked
    // slot gets warned again.
    for (const id of [...warned]) {
      if (!liveIds.has(id)) { warned.delete(id); changed = true; }
    }

    const now = Date.now();
    for (const s of schedules) {
      const id = String(s.id);
      if (warned.has(id)) continue;
      const runAt = new Date(s.runAt).getTime();
      if (Number.isNaN(runAt)) continue;
      const mins = (runAt - now) / 60000;
      // Wide window so a 60s tick always catches it exactly once.
      if (mins < 9 || mins > 16) continue;
      // A quiet-hours row is held till morning — warn nearer the real send.
      if (safety.inQuietHours(new Date(runAt))) continue;

      const label = await friendlyTarget(s);
      const preview = String(s.message || '').slice(0, 80);
      push.notify('all', {
        title: '⏰ Sending in ~15 min',
        body: `${label} — "${preview}". Open Sandesha to post it by hand instead.`,
        tag: `sandesha-prewarn-${id}`,
        url: 'admin-promotions.html',
        kind: 'prewarn',
        corrId: String(s.sourceId || s.id || ''),
      }).catch(() => {});
      warned.add(id);
      changed = true;
    }
    if (changed) savePrewarned(warned);
  } catch (err) {
    log('[HEADSUP]', err.message);
  } finally {
    headsUpRunning = false;
  }
}

async function runSchedulerCheck() {
  if (schedulerRunning) {
    console.error('[SCHEDULER] Skip — previous tick still running');
    return;
  }
  schedulerRunning = true;
  try {
      // Clean up old schedule IDs (older than 24 hours) to prevent memory leak
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      for (const id of sentScheduleIds) {
        if (id < oneDayAgo) sentScheduleIds.delete(id);
      }
      
      const schedules = loadSchedules();
      const now = new Date();
      console.error(`[SCHEDULER] Checking ${schedules.length} schedules at ${now.toISOString()}`);
      const pending = [];
      const delivered = [];
      let quietNoted = false;
      let budgetNoted = false;
      
      for (const schedule of schedules) {
        // Skip already sent / in-flight schedules
        if (sentScheduleIds.has(schedule.id)) continue;
        
        const runAt = new Date(schedule.runAt);
        if (runAt <= now) {
          // A schedule due in the small hours waits for morning. It is held,
          // never dropped, so nothing the centre planned goes missing.
          if (safety.inQuietHours(now)) {
            if (!quietNoted) {
              log(`[SCHEDULER] Quiet hours — holding due schedules until ${safety.quietHoursEndAt(now).toISOString()}`);
              quietNoted = true;
            }
            pending.push(schedule);
            continue;
          }
          const budgetVerdict = sendBudget.check(now);
          if (!budgetVerdict.ok) {
            if (!budgetNoted) {
              log(`[SCHEDULER] Holding due schedules — ${budgetVerdict.reason}`);
              budgetNoted = true;
            }
            pending.push(schedule);
            continue;
          }

          // Claim before awaiting send so overlapping ticks can't double-send
          sentScheduleIds.add(schedule.id);
          console.log(`[SCHEDULE] Sending: "${schedule.message}" to ${schedule.target}`);
          const corrId = String(schedule.sourceId || schedule.id || '');
          const label = await friendlyTarget(schedule);
          const preview = String(schedule.message || '').slice(0, 80);
          try {
            const result = await fanOutSchedule(schedule);
            const kind = schedule.filePath ? '📎 ' : '';
            if (result.complete) {
              delivered.push(schedule);
              writeNotification(`✅ Sent: ${kind}"${schedule.message}" → ${schedule.target}`);
              activity.recordEvent({
                category: 'schedule', type: 'ok', ok: true,
                title: `Scheduled message delivered to ${label}`,
                detail: preview, target: schedule.target, corrId,
                via: 'scheduled', push: true,
                actor: schedule.createdBy || null,
                meta: scheduleActivityMeta(schedule, { sentTo: result.sentTo }),
              });
            } else {
              // Partly delivered: keep the rest queued with a record of who has
              // already had it, so resuming cannot send the same group twice.
              log(`[SCHEDULE] Paused after ${result.sentTo.length} of "${schedule.target}" — ${result.reason}`);
              sentScheduleIds.delete(schedule.id);
              pending.push({ ...schedule, sentTo: result.sentTo });
              writeNotification(`⏸️ Paused (${result.reason}): ${kind}"${schedule.message}" → ${schedule.target}`);
              activity.recordEvent({
                category: 'schedule', type: 'warn', ok: false,
                title: `Scheduled send to ${label} paused`,
                detail: `${result.reason} — ${result.sentTo.length} done, rest will retry`,
                target: schedule.target, corrId, via: 'scheduled', push: true,
                actor: schedule.createdBy || null,
                meta: scheduleActivityMeta(schedule, { sentTo: result.sentTo, reason: result.reason }),
              });
            }
          } catch (err) {
            console.error(`[SCHEDULE ERROR] ${err.message}`);
            // Allow retry on next tick
            sentScheduleIds.delete(schedule.id);
            pending.push(schedule);
            activity.recordEvent({
              category: 'schedule', type: 'err', ok: false,
              title: `Scheduled send to ${label} failed`,
              detail: `${err.message.split('\n')[0]} — post it by hand if needed`,
              target: schedule.target, corrId, via: 'scheduled', push: true,
              actor: schedule.createdBy || null,
              meta: scheduleActivityMeta(schedule, { error: err.message }),
            });
          }
        } else {
          pending.push(schedule);
        }
      }
      
      saveSchedules(pending);
      // Positive record of the send, so the board never has to infer one from
      // a missing row.
      recordDelivered(delivered);
      for (const done of delivered) {
        if (done.filePath) dropScheduleMedia(done.filePath, pending);
      }
    } catch (err) {
      console.error('[SCHEDULER ERROR]', err.message);
    } finally {
      schedulerRunning = false;
    }
}

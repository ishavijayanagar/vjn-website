'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// 'nurturing' has a deliberately tiny surface (list groups + one add-members
// job + poll) enforced per-route in api-handlers.js; it can still exchange a
// VJN login for a Sandesha session so those routes are reachable.
// 'programs' is narrower still — push subscribe/unsubscribe only, for
// program-starting-soon reminders; it has no UI path to any other route.
const MESSAGING_ROLES = new Set(['admin', 'promotions', 'nurturing', 'programs']);
const sessions = new Map();

function loadEnvFile(envPath) {
  try {
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // ignore missing or unreadable .env
  }
}

loadEnvFile(path.join(__dirname, '.env'));

/** Sessions are kept by a hash of the token: a copy of the database cannot be used to sign in. */
const tokenKey = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
let db = null;

/** Once the server hands over its database, sessions survive restarts (until then: memory only, as in tests). */
function useDb(handle) {
  db = handle;
  db.prepare('DELETE FROM login_sessions WHERE expires_at <= ?').run(Date.now());
  for (const r of db.prepare('SELECT * FROM login_sessions').all()) {
    sessions.set(r.token_hash, {
      expiresAt: r.expires_at,
      role: normalizeRole(r.role) || 'admin',
      source: r.source || 'password',
      user: cleanUser(JSON.parse(r.user_json || 'null')),
    });
  }
  // The old plaintext sessions file is not read any more; people sign in again once.
  try { fs.unlinkSync(path.join(__dirname, '.sandesha-sessions.json')); } catch { /* none */ }
}

function persistSession(key, meta) {
  if (!db) return;
  try {
    db.prepare(`INSERT INTO login_sessions (token_hash, role, source, user_json, expires_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (token_hash) DO UPDATE SET expires_at = excluded.expires_at`)
      .run(key, meta.role || 'admin', meta.source || 'password', JSON.stringify(meta.user || null), meta.expiresAt);
  } catch { /* best effort */ }
}

function dropSession(key) {
  sessions.delete(key);
  if (!db) return;
  try { db.prepare('DELETE FROM login_sessions WHERE token_hash = ?').run(key); } catch { /* best effort */ }
}


function isAuthDisabled() {
  return process.env.SANDESHA_AUTH_DISABLED === '1' || process.env.SANDESHA_AUTH_DISABLED === 'true';
}

function getAdminPassword() {
  return process.env.SANDESHA_ADMIN_PASSWORD || '';
}

function isAuthRequired() {
  return !isAuthDisabled() && getAdminPassword().length > 0;
}

function getVjnAppsScriptUrl() {
  return String(process.env.VJN_APPS_SCRIPT_URL || '').trim().replace(/\/$/, '');
}

function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'promotions' || r === 'promotion') return 'promotions';
  return r;
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Keep only the identity fields the activity log needs. */
function cleanUser(user) {
  if (!user || typeof user !== 'object') return null;
  const username = String(user.username || '').slice(0, 80);
  const displayName = String(user.displayName || '').slice(0, 80);
  return username || displayName ? { username, displayName } : null;
}

function issueSession(role, source, user) {
  const token = createToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const normalized = normalizeRole(role) || 'admin';
  const meta = {
    expiresAt,
    role: normalized,
    source: source || 'password',
    user: cleanUser(user),
  };
  sessions.set(tokenKey(token), meta);
  persistSession(tokenKey(token), meta);
  return {
    ok: true,
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    role: normalized,
  };
}

// Wrong-password limiter: this process-wide, so a spread-out guesser is stopped too.
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
let loginFails = [];

function passwordMatches(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function login(password) {
  const adminPassword = getAdminPassword();
  if (!adminPassword) {
    return { ok: false, error: 'Admin password not configured on server' };
  }
  const now = Date.now();
  loginFails = loginFails.filter((t) => now - t < LOGIN_WINDOW_MS);
  if (loginFails.length >= LOGIN_MAX_FAILS) {
    return { ok: false, error: 'Too many wrong passwords. Try again in a few minutes.' };
  }
  if (!passwordMatches(password, adminPassword)) {
    loginFails.push(now);
    return { ok: false, error: 'Invalid password' };
  }
  loginFails = [];
  return issueSession('admin', 'password');
}

function getBearerToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function getSession(token) {
  if (!token) return null;
  const key = tokenKey(token);
  const session = sessions.get(key);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    dropSession(key);
    return null;
  }
  return session;
}

function validateToken(token) {
  return !!getSession(token);
}

function validateAuth(req) {
  if (!isAuthRequired()) return true;
  return validateToken(getBearerToken(req));
}

function getRole(req) {
  if (!isAuthRequired()) return 'admin';
  const session = getSession(getBearerToken(req));
  return session?.role || null;
}

/**
 * Who made this request, for the activity log: { role, name, username }.
 * Sessions issued before names were stored fall back to the team label.
 */
function getActor(req) {
  if (!isAuthRequired()) return { role: 'admin', name: 'Admin', username: '' };
  const session = getSession(getBearerToken(req));
  if (!session) return null;
  const role = session.role || 'admin';
  const user = session.user || {};
  const name = user.displayName || user.username
    || (session.source === 'password' ? 'Admin (password login)' : `${role[0].toUpperCase()}${role.slice(1)} team`);
  return { role, name, username: user.username || '' };
}

function logout(token) {
  if (token) dropSession(tokenKey(token));
}

function httpJson(urlString, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };

    const attempt = (currentUrl, redirectsLeft, reqMethod, reqBody) => {
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch (err) {
        finish(err);
        return;
      }
      const lib = parsed.protocol === 'http:' ? http : https;
      const payload = reqBody == null ? null : Buffer.from(String(reqBody), 'utf8');
      const req = lib.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
          path: parsed.pathname + parsed.search,
          method: reqMethod,
          headers: {
            Accept: 'application/json',
            ...(payload
              ? {
                  'Content-Type': 'text/plain;charset=utf-8',
                  'Content-Length': payload.length,
                }
              : {}),
            ...headers,
          },
          timeout: 20000,
        },
        (res) => {
          const status = res.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
            const next = new URL(res.headers.location, currentUrl).toString();
            res.resume();
            // Google Apps Script: POST to /exec → 302; fetch JSON result with GET.
            let nextMethod = reqMethod;
            let nextBody = reqBody;
            if (reqMethod === 'POST') {
              nextMethod = 'GET';
              nextBody = null;
            }
            attempt(next, redirectsLeft - 1, nextMethod, nextBody);
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let data = null;
            try {
              data = text ? JSON.parse(text) : null;
            } catch {
              data = { raw: text };
            }
            finish(null, { status, data, text });
          });
        },
      );
      req.on('error', (err) => finish(err));
      req.on('timeout', () => {
        req.destroy();
        finish(new Error('VJN session check timed out'));
      });
      if (payload) req.write(payload);
      req.end();
    };

    attempt(urlString, 5, method, body);
  });
}

let localVjnVerifier = null;

/** fn(token) → session or null, for tokens signed by this server (vjn-users.js). */
function setLocalVjnVerifier(fn) {
  localVjnVerifier = fn;
}

async function exchangeVjnToken(vjnToken) {
  const token = String(vjnToken || '').trim();
  if (!token) {
    return { ok: false, error: 'Missing VJN token', status: 400 };
  }

  // Logins the Pi signed itself are checked here, without a round trip.
  if (token.startsWith('v1.')) {
    const local = localVjnVerifier ? localVjnVerifier(token) : null;
    if (!local) return { ok: false, error: 'VJN session is invalid or expired', status: 401 };
    return issueVjnSession(local);
  }

  const appsScriptUrl = getVjnAppsScriptUrl();
  if (!appsScriptUrl) {
    return {
      ok: false,
      error: 'VJN_APPS_SCRIPT_URL is not configured on the Sandesha server',
      status: 500,
    };
  }

  let response;
  try {
    response = await httpJson(appsScriptUrl, {
      method: 'POST',
      body: JSON.stringify({ formType: 'adminSession', token }),
    });
  } catch (err) {
    return { ok: false, error: err.message || 'Could not reach VJN Apps Script', status: 502 };
  }

  const data = response.data || {};
  if (response.status >= 400 || data.error) {
    const errMsg = data.error
      || (data.raw ? 'Could not read VJN Apps Script response' : null)
      || 'VJN session is invalid or expired';
    return {
      ok: false,
      error: errMsg,
      status: data.error ? 401 : (response.status >= 400 ? response.status : 401),
    };
  }

  return issueVjnSession(data.user || data.session || data);
}

function issueVjnSession(user) {
  const role = normalizeRole(user?.role);
  if (!MESSAGING_ROLES.has(role)) {
    return {
      ok: false,
      error: 'This VJN role cannot access messaging',
      status: 403,
    };
  }

  const issued = issueSession(role, 'vjn', user);
  return {
    ok: true,
    token: issued.token,
    expiresAt: issued.expiresAt,
    role: issued.role,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      role: issued.role,
    },
  };
}

function checkStartupAuth(logFn) {
  const log = logFn || (() => {});
  if (isAuthDisabled()) {
    log('[auth] WARNING: SANDESHA_AUTH_DISABLED is set — API routes are unauthenticated');
  } else if (!getAdminPassword()) {
    log('[auth] WARNING: SANDESHA_ADMIN_PASSWORD is not set. Set it in .env before exposing via Cloudflare Tunnel.');
  }
  if (!getVjnAppsScriptUrl()) {
    log('[auth] WARNING: VJN_APPS_SCRIPT_URL is not set — /auth/vjn-exchange will fail until configured.');
  }
}

/** For tests — clear all sessions */
function clearAllSessions() {
  sessions.clear();
  if (db) { try { db.prepare('DELETE FROM login_sessions').run(); } catch { /* ignore */ } }
}

module.exports = {
  useDb,
  login,
  exchangeVjnToken,
  setLocalVjnVerifier,
  validateAuth,
  validateToken,
  getBearerToken,
  getSession,
  getRole,
  getActor,
  logout,
  isAuthRequired,
  isAuthDisabled,
  getAdminPassword,
  getVjnAppsScriptUrl,
  checkStartupAuth,
  clearAllSessions,
  normalizeRole,
  MESSAGING_ROLES,
  SESSION_TTL_MS,
};

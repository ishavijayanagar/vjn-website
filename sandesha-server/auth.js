'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSIONS_FILE = path.join(__dirname, '.sandesha-sessions.json');
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

function loadSessionsFromDisk() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    if (!raw || typeof raw !== 'object') return;
    for (const [token, meta] of Object.entries(raw)) {
      const expiresAt = Number(meta?.expiresAt);
      if (!token || !Number.isFinite(expiresAt) || expiresAt <= now) continue;
      const role = normalizeRole(meta?.role) || 'admin';
      sessions.set(token, { expiresAt, role, source: meta?.source || 'password' });
    }
  } catch {
    // corrupt file — start fresh
  }
}

function saveSessionsToDisk() {
  try {
    const out = {};
    const now = Date.now();
    for (const [token, meta] of sessions.entries()) {
      if (meta.expiresAt > now) {
        out[token] = {
          expiresAt: meta.expiresAt,
          role: meta.role || 'admin',
          source: meta.source || 'password',
        };
      }
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(out), 'utf8');
  } catch {
    // ignore write errors
  }
}

loadSessionsFromDisk();

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

function issueSession(role, source) {
  const token = createToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const normalized = normalizeRole(role) || 'admin';
  sessions.set(token, {
    expiresAt,
    role: normalized,
    source: source || 'password',
  });
  saveSessionsToDisk();
  return {
    ok: true,
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    role: normalized,
  };
}

function login(password) {
  const adminPassword = getAdminPassword();
  if (!adminPassword) {
    return { ok: false, error: 'Admin password not configured on server' };
  }
  if (password !== adminPassword) {
    return { ok: false, error: 'Invalid password' };
  }
  return issueSession('admin', 'password');
}

function getBearerToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    saveSessionsToDisk();
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

function logout(token) {
  if (token) {
    sessions.delete(token);
    saveSessionsToDisk();
  }
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

async function exchangeVjnToken(vjnToken) {
  const token = String(vjnToken || '').trim();
  if (!token) {
    return { ok: false, error: 'Missing VJN token', status: 400 };
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

  const user = data.user || data.session || data;
  const role = normalizeRole(user?.role);
  if (!MESSAGING_ROLES.has(role)) {
    return {
      ok: false,
      error: 'This VJN role cannot access messaging',
      status: 403,
    };
  }

  const issued = issueSession(role, 'vjn');
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
  try {
    if (fs.existsSync(SESSIONS_FILE)) fs.unlinkSync(SESSIONS_FILE);
  } catch { /* ignore */ }
}

module.exports = {
  login,
  exchangeVjnToken,
  validateAuth,
  validateToken,
  getBearerToken,
  getSession,
  getRole,
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

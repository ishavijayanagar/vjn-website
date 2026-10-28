'use strict';

/**
 * VJN admin logins, owned by the Pi (moved from the Sheet's Users tab).
 *
 * A login is a signed token: "v1.<payload>.<HMAC-SHA256>", keyed with
 * VJN_AUTH_SECRET, which Apps Script also holds. Apps Script checks the
 * signature itself, so admin pages that talk only to the Sheet keep working
 * while the Pi is offline — only signing in needs the Pi.
 *
 * Disabling someone, changing their team or password stamps
 * revoked_before on the user and tells Apps Script the same, so every token
 * issued before that moment stops working in both places at once.
 */

const crypto = require('crypto');

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VALID_ROLES = ['admin', 'programs', 'promotions', 'nurturing'];

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Same scheme as the Sheet used, so imported passwords keep working. */
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(String(salt || '') + String(password || ''), 'utf8').digest('hex');
}

function normalizeRole(raw) {
  const r = String(raw || '').trim().toLowerCase();
  return VALID_ROLES.includes(r) ? r : '';
}

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

function nowIsoKolkata(ms) {
  return new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 19);
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name || u.username,
    role: u.role,
    status: u.status || 'active',
    createdAt: u.created_at || '',
  };
}

function createVjnUsers({ db, secret, notifySheet = async () => {}, now = () => Date.now() }) {
  const q = {
    all: db.prepare('SELECT * FROM users ORDER BY created_at, username'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    byRole: db.prepare("SELECT * FROM users WHERE role = ? AND status = 'active'"),
    count: db.prepare('SELECT COUNT(*) AS n FROM users'),
    activeAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id != ?"),
    usernames: db.prepare('SELECT username FROM users'),
    insert: db.prepare(`INSERT INTO users (id, username, display_name, role, password_salt, password_hash, status, created_at, revoked_before)
      VALUES (@id, @username, @display_name, @role, @password_salt, @password_hash, @status, @created_at, @revoked_before)`),
    update: db.prepare(`UPDATE users SET display_name = @display_name, role = @role, password_salt = @password_salt,
      password_hash = @password_hash, status = @status, revoked_before = @revoked_before WHERE id = @id`),
  };

  function requireSecret() {
    if (!secret) throw new Error('VJN_AUTH_SECRET is not set on the Sandesha server.');
  }

  function sign(user) {
    requireSecret();
    const iat = now();
    const payload = b64url(JSON.stringify({
      uid: user.id, u: user.username, n: user.display_name || user.username, r: user.role, iat, exp: iat + TOKEN_TTL_MS,
    }));
    const body = `v1.${payload}`;
    return `${body}.${b64url(crypto.createHmac('sha256', secret).update(body).digest())}`;
  }

  /** The live session behind a token, or null. Checks the database too. */
  function verify(token) {
    if (!secret) return null;
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const expected = crypto.createHmac('sha256', secret).update(`v1.${parts[1]}`).digest();
    const given = fromB64url(parts[2]);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    let p;
    try { p = JSON.parse(fromB64url(parts[1]).toString('utf8')); } catch { return null; }
    if (!p || !p.uid || !(p.exp > now())) return null;
    const user = q.byId.get(String(p.uid));
    if (!user || user.status !== 'active' || p.iat < user.revoked_before) return null;
    return { id: user.id, username: user.username, displayName: user.display_name || user.username, role: user.role, iat: p.iat };
  }

  function login(role, password) {
    const wanted = normalizeRole(role);
    if (!wanted) return { error: 'Choose your team.' };
    if (!password) return { error: 'Enter the password.' };
    if (!q.count.get().n) return { error: 'Logins are not set up yet. On the Pi, run: node scripts/import-users.js' };
    const candidates = q.byRole.all(wanted);
    if (!candidates.length) return { error: 'This team is not set up yet. Ask admin to add a login.' };
    const user = candidates.find((u) => u.password_hash && hashPassword(password, u.password_salt) === u.password_hash);
    if (!user) return { error: 'Invalid password.' };
    return { success: true, token: sign(user), user: publicUser(user) };
  }

  /** A fresh token for a still-valid one, so active users never hit the 30-day end. */
  function refresh(token) {
    const session = verify(token);
    if (!session) return { error: 'Unauthorized. Please log in again.' };
    return { success: true, token: sign(q.byId.get(session.id)), user: publicUser(q.byId.get(session.id)) };
  }

  function list() {
    return q.all.all().map(publicUser);
  }

  function setPassword(user, password) {
    user.password_salt = crypto.randomUUID().replace(/-/g, '');
    user.password_hash = hashPassword(password, user.password_salt);
  }

  function uniqueUsername(base) {
    const root = normalizeUsername(base) || 'user';
    const taken = new Set(q.usernames.all().map((r) => r.username));
    if (!taken.has(root)) return root;
    let n = 2;
    while (taken.has(root + n)) n++;
    return root + n;
  }

  /** Cut off tokens issued before now, here and in Apps Script. */
  async function revoke(user, disabled) {
    const before = now();
    await notifySheet({ id: user.id, disabled: !!disabled, before });
    user.revoked_before = before;
  }

  async function save(actor, data) {
    const id = String(data.id || '').trim();
    const role = normalizeRole(data.role);
    const displayName = String(data.displayName || data.display_name || '').trim();
    const password = String(data.password || '');

    if (id) {
      const user = q.byId.get(id);
      if (!user) throw new Error('Person not found.');
      let cutOff = false;
      if (role && role !== user.role) {
        if (user.role === 'admin' && role !== 'admin' && q.activeAdmins.get(user.id).n < 1) {
          throw new Error('Keep at least one active admin.');
        }
        if (user.id === actor.id) throw new Error('You cannot change your own role.');
        user.role = role;
        cutOff = true;
      }
      if (displayName) user.display_name = displayName;
      if (password) {
        if (password.length < 6) throw new Error('Password must be at least 6 characters.');
        setPassword(user, password);
        cutOff = true;
      }
      if (cutOff) await revoke(user, user.status !== 'active');
      q.update.run(user);
      const out = { success: true, user: publicUser(user) };
      // Changing your own password signs out your other devices, not this one.
      if (cutOff && user.id === actor.id) out.token = sign(user);
      return out;
    }

    if (!role) throw new Error('Choose a team.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const user = {
      id: crypto.randomUUID(),
      username: uniqueUsername(displayName || role),
      display_name: displayName || role,
      role,
      status: 'active',
      created_at: nowIsoKolkata(now()),
      revoked_before: 0,
    };
    setPassword(user, password);
    q.insert.run(user);
    return { success: true, user: publicUser(user) };
  }

  async function setStatus(actor, id, rawStatus) {
    const user = q.byId.get(String(id || ''));
    if (!user) throw new Error('Person not found.');
    const status = String(rawStatus || '').trim().toLowerCase() === 'disabled' ? 'disabled' : 'active';
    if (user.id === actor.id && status === 'disabled') throw new Error('You cannot disable your own account.');
    if (user.role === 'admin' && status === 'disabled' && q.activeAdmins.get(user.id).n < 1) {
      throw new Error('Keep at least one active admin.');
    }
    if (status === user.status) return { success: true, user: publicUser(user) };
    if (status === 'disabled') {
      await revoke(user, true);
    } else {
      await notifySheet({ id: user.id, disabled: false, before: user.revoked_before });
    }
    user.status = status;
    q.update.run(user);
    return { success: true, user: publicUser(user) };
  }

  /** One-off copy of the Sheet's Users tab, keeping ids and password hashes. */
  function importUsers(rows) {
    let added = 0;
    db.transaction(() => {
      for (const r of rows || []) {
        const role = normalizeRole(r.role);
        if (!r.id || !role || q.byId.get(String(r.id))) continue;
        q.insert.run({
          id: String(r.id),
          username: normalizeUsername(r.username) || uniqueUsername(r.display_name || role),
          display_name: String(r.display_name || r.username || role),
          role,
          password_salt: String(r.password_salt || ''),
          password_hash: String(r.password_hash || ''),
          status: String(r.status || '').toLowerCase() === 'active' ? 'active' : 'disabled',
          created_at: String(r.created_at || ''),
          revoked_before: 0,
        });
        added++;
      }
    })();
    return added;
  }

  return { login, refresh, verify, list, save, setStatus, importUsers, sign };
}

module.exports = { createVjnUsers, hashPassword };

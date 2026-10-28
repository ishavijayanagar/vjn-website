'use strict';

/**
 * HTTP routes for VJN admin logins (see vjn-users.js).
 *
 *   POST /vjn/login          { role, password }     → { token, user }
 *   POST /vjn/refresh        { token }              → { token, user }
 *   GET  /vjn/users          (admin)                → { users }
 *   POST /vjn/users          (admin) { id?, displayName, role, password? }
 *   POST /vjn/users/status   (admin) { id, status }
 *
 *   GET  /vjn/promos?due=1            (admin, promotions)    → { items, due, counts, stamp }
 *   POST /vjn/promos/save             (admin, promotions)    → { success, item }
 *   POST /vjn/promos/add              (admin, promotions)
 *   POST /vjn/promos/mark-sent        (admin, promotions)    { id, source? }
 *   POST /vjn/promos/unmark-sent      (admin, promotions)    { id }
 *   GET  /vjn/promos/invite-messages  (admin, nurturing)     → { messages }
 *
 * The admin routes take the VJN token as "Authorization: Bearer v1.…".
 */

const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;

function createVjnRoutes({ users, promos = null, readBody, jsonResponse, now = () => Date.now() }) {
  // Failed sign-ins per client address, so the public URL cannot be used to
  // guess passwords at speed.
  const fails = new Map();

  function clientKey(req) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
  }

  function tooManyFails(key) {
    const rec = fails.get(key);
    if (!rec || now() - rec.since > FAIL_WINDOW_MS) return false;
    return rec.count >= MAX_FAILS;
  }

  function noteFail(key) {
    const rec = fails.get(key);
    if (!rec || now() - rec.since > FAIL_WINDOW_MS) fails.set(key, { since: now(), count: 1 });
    else rec.count++;
  }

  function adminSession(req, roles = ['admin']) {
    const header = String(req.headers.authorization || '');
    const match = header.match(/^Bearer\s+(.+)$/i);
    const session = match ? users.verify(match[1].trim()) : null;
    if (!session) return { status: 401, error: 'Unauthorized. Please log in again.' };
    if (!roles.includes(session.role)) return { status: 403, error: 'You do not have access to this.' };
    return { session };
  }

  async function body(req) {
    try {
      return JSON.parse((await readBody(req)) || '{}');
    } catch {
      return {};
    }
  }

  async function handle(req, res, parsed) {
    const p = parsed.pathname;
    if (!p.startsWith('/vjn/')) return false;

    if (p === '/vjn/login' && req.method === 'POST') {
      const key = clientKey(req);
      if (tooManyFails(key)) {
        jsonResponse(res, 429, { error: 'Too many wrong passwords. Wait 15 minutes and try again.' });
        return true;
      }
      const { role, password } = await body(req);
      const result = users.login(role, String(password || ''));
      if (result.error === 'Invalid password.') noteFail(key);
      jsonResponse(res, result.error ? 401 : 200, result);
      return true;
    }

    if (p === '/vjn/refresh' && req.method === 'POST') {
      const { token } = await body(req);
      const result = users.refresh(token);
      jsonResponse(res, result.error ? 401 : 200, result);
      return true;
    }

    if (p === '/vjn/users' || p === '/vjn/users/status') {
      const auth = adminSession(req);
      if (auth.error) {
        jsonResponse(res, auth.status, { error: auth.error });
        return true;
      }
      try {
        if (p === '/vjn/users' && req.method === 'GET') {
          jsonResponse(res, 200, { users: users.list() });
        } else if (p === '/vjn/users' && req.method === 'POST') {
          jsonResponse(res, 200, await users.save(auth.session, await body(req)));
        } else if (p === '/vjn/users/status' && req.method === 'POST') {
          const { id, status } = await body(req);
          jsonResponse(res, 200, await users.setStatus(auth.session, id, status));
        } else {
          jsonResponse(res, 405, { error: 'Method not allowed' });
        }
      } catch (err) {
        jsonResponse(res, 400, { error: err.message });
      }
      return true;
    }

    if (promos && p.startsWith('/vjn/promos')) return handlePromos(req, res, parsed);

    return false;
  }

  async function handlePromos(req, res, parsed) {
    const p = parsed.pathname;
    const invite = p === '/vjn/promos/invite-messages';
    const auth = adminSession(req, invite ? ['admin', 'nurturing'] : ['admin', 'promotions']);
    if (auth.error) {
      jsonResponse(res, auth.status, { error: auth.error });
      return true;
    }
    try {
      if (p === '/vjn/promos' && req.method === 'GET') {
        jsonResponse(res, 200, await promos.list({ dueOnly: String(parsed.query?.due || '') === '1' }));
      } else if (invite && req.method === 'GET') {
        jsonResponse(res, 200, promos.inviteMessages());
      } else if (req.method === 'POST') {
        const data = await body(req);
        if (p === '/vjn/promos/save') jsonResponse(res, 200, await promos.save(data));
        else if (p === '/vjn/promos/add') jsonResponse(res, 200, await promos.add(auth.session, data));
        else if (p === '/vjn/promos/mark-sent') jsonResponse(res, 200, await promos.markSent(data.id, data.source, auth.session));
        else if (p === '/vjn/promos/unmark-sent') jsonResponse(res, 200, await promos.unmarkSent(data.id));
        else jsonResponse(res, 404, { error: 'Not found' });
      } else {
        jsonResponse(res, 405, { error: 'Method not allowed' });
      }
    } catch (err) {
      jsonResponse(res, 400, { error: err.message });
    }
    return true;
  }

  return { handle };
}

module.exports = { createVjnRoutes };

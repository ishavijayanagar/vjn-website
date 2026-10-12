/**
 * Bridge VJN admin session → Sandesha bearer token.
 * No Sandesha password UI — uses vjn_admin_token from the website login.
 */
import { api, reloadApiBase, getToken, setToken, setUnauthorizedHandler, runWithoutAuthRedirect } from './api.js';

const VJN_TOKEN_KEY = 'vjn_admin_token';
const VJN_USER_KEY = 'vjn_admin_user';
const ROLE_KEY = 'sandesha_role';
const EXCHANGED_VJN_KEY = 'sandesha_vjn_token';

function readStorage(key) {
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeSession(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch { /* ignore */ }
}

export function getVjnToken() {
  return readStorage(VJN_TOKEN_KEY);
}

export function getVjnUser() {
  try {
    return JSON.parse(readStorage(VJN_USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function getSandeshaRole() {
  return sessionStorage.getItem(ROLE_KEY) || localStorage.getItem(ROLE_KEY) || '';
}

export function isAdminRole() {
  return getSandeshaRole() === 'admin';
}

export function isPromotionsRole() {
  return getSandeshaRole() === 'promotions';
}

export function redirectToVjnLogin() {
  setToken('');
  writeSession(ROLE_KEY, '');
  writeSession(EXCHANGED_VJN_KEY, '');
  const next = encodeURIComponent(window.location.pathname.split('/').pop() || 'admin.html');
  window.location.replace(`admin.html?next=${next}`);
}

/**
 * Exchange VJN token for a Sandesha API token (once per VJN session).
 * @returns {{ token: string, role: string, user?: object }}
 */
export async function ensureSandeshaAuth() {
  reloadApiBase();

  const vjnToken = getVjnToken();
  if (!vjnToken) {
    redirectToVjnLogin();
    throw new Error('Not signed in to VJN admin');
  }

  const existing = getToken();
  const exchangedFor = sessionStorage.getItem(EXCHANGED_VJN_KEY) || '';
  if (existing && exchangedFor === vjnToken && getSandeshaRole()) {
    return { token: existing, role: getSandeshaRole(), user: getVjnUser() };
  }

  let data;
  try {
    data = await runWithoutAuthRedirect(() => api('/auth/vjn-exchange', {
      method: 'POST',
      body: JSON.stringify({ token: vjnToken }),
      skipAuthRedirect: true,
    }));
  } catch (err) {
    const msg = err?.message || 'Could not connect messaging';
    if (/invalid|expired|unauthorized/i.test(msg)) {
      throw new Error('VJN sign-in expired — sign out and sign in again, then retry.');
    }
    throw err;
  }

  if (!data?.token) {
    throw new Error(data?.error || 'Could not connect messaging');
  }

  setToken(data.token);
  writeSession(ROLE_KEY, data.role || '');
  writeSession(EXCHANGED_VJN_KEY, vjnToken);
  try {
    localStorage.setItem(ROLE_KEY, data.role || '');
  } catch { /* ignore */ }

  return {
    token: data.token,
    role: data.role || '',
    user: data.user || getVjnUser(),
  };
}

export function installUnauthorizedRedirect() {
  setUnauthorizedHandler(async () => {
    if (!getVjnToken()) {
      redirectToVjnLogin();
      return;
    }
    clearSandeshaSession();
    if (window.SANDESHA_EMBEDDED) {
      try {
        await ensureSandeshaAuth();
        window.dispatchEvent(new CustomEvent('sandesha:reauth'));
      } catch (err) {
        window.dispatchEvent(new CustomEvent('sandesha:auth-failed', { detail: err }));
      }
      return;
    }
    redirectToVjnLogin();
  });
}

/** Clear Sandesha tokens only (keep VJN session). */
export function clearSandeshaSession() {
  setToken('');
  writeSession(ROLE_KEY, '');
  writeSession(EXCHANGED_VJN_KEY, '');
  try {
    localStorage.removeItem(ROLE_KEY);
  } catch { /* ignore */ }
}

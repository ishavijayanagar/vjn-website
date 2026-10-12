const DEFAULT_API = 'http://127.0.0.1:42620';
const TOKEN_KEY = 'sandesha_token';

function pageOrigin() {
  if (typeof window === 'undefined' || !window.location) return '';
  return String(window.location.origin || '').replace(/\/$/, '');
}

function pageHostname() {
  if (typeof window === 'undefined' || !window.location) return '';
  return String(window.location.hostname || '').toLowerCase();
}

/** True when this page is served by listen.js (same origin as the Sandesha API). */
export function isServedByApi() {
  const h = pageHostname();
  const port = String(
    typeof window !== 'undefined' && window.location ? window.location.port : ''
  );

  if (h.endsWith('.ts.net') || h.endsWith('.trycloudflare.com')) {
    return true;
  }

  if (h === '127.0.0.1' || h === 'localhost' || h === '[::1]') {
    return port === '42620';
  }

  return false;
}

function configApiUrl() {
  if (typeof window === 'undefined') return null;
  // Prefer VJN website config (config.js sets SANDESHA_API_URL)
  if (window.SANDESHA_API_URL) return String(window.SANDESHA_API_URL).replace(/\/$/, '');
  const raw = window.SANDESHA_CONFIG?.apiUrl;
  return raw ? String(raw).replace(/\/$/, '') : null;
}

function storedApiUrl() {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem('sandesha_api');
  return raw ? String(raw).replace(/\/$/, '') : null;
}

function resolveApiBase() {
  const stored = storedApiUrl();
  if (stored) return stored;

  const config = configApiUrl();
  if (config) return config;

  if (isServedByApi()) {
    return pageOrigin() || DEFAULT_API;
  }

  return DEFAULT_API;
}

let apiBase = resolveApiBase();

/** Default from config.js (not the localStorage override). */
export function getConfigApiUrl() {
  return configApiUrl() || DEFAULT_API;
}

export function hasApiOverride() {
  return Boolean(storedApiUrl());
}

export function clearApiOverride() {
  try { localStorage.removeItem('sandesha_api'); } catch { /* ignore */ }
  apiBase = resolveApiBase();
  return apiBase;
}

export function reloadApiBase() {
  apiBase = resolveApiBase();
  return apiBase;
}
let onUnauthorized = null;
let suppressAuthRedirect = false;

export function runWithoutAuthRedirect(fn) {
  suppressAuthRedirect = true;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      suppressAuthRedirect = false;
    });
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export function getApiBase() {
  return apiBase;
}

export function setApiBase(url) {
  apiBase = (url || DEFAULT_API).replace(/\/$/, '');
  localStorage.setItem('sandesha_api', apiBase);
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(value) {
  if (value) {
    localStorage.setItem(TOKEN_KEY, value);
    sessionStorage.removeItem(TOKEN_KEY); // migrate off session-only storage
  } else {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export async function api(path, options = {}) {
  const url = `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = { ...(options.headers || {}) };
  const isForm = options.body instanceof FormData;
  if (!isForm && options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
  } else if (!isForm && options.method && options.method !== 'GET') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  let res;
  try {
    res = await fetch(url, { ...options, headers, signal: options.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error(`Cannot reach server at ${apiBase}`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text || res.statusText }; }

  if (res.status === 401) {
    setToken('');
    if (!options.skipAuthRedirect && !suppressAuthRedirect && onUnauthorized) onUnauthorized();
    throw new Error(data.error || 'Unauthorized');
  }
  if (res.status === 403) {
    throw new Error(data.error || 'Forbidden');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** The URL a queued attachment can be fetched back from. */
export function mediaUrl(filePathOrName) {
  const name = String(filePathOrName || '').split(/[\\/]/).pop();
  return name ? `${apiBase}/media/${encodeURIComponent(name)}` : '';
}

/**
 * Bytes of a queued attachment. /media is behind the bearer token, so an
 * <img src> cannot reach it — fetch here and hand back an object URL or blob.
 */
export async function fetchMedia(filePathOrName) {
  const url = mediaUrl(filePathOrName);
  if (!url) throw new Error('No attachment');
  const token = getToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`Could not fetch the attachment (HTTP ${res.status})`);
  const blob = await res.blob();
  return {
    blob,
    mime: blob.type || 'application/octet-stream',
    filename: String(filePathOrName || '').split(/[\\/]/).pop() || 'attachment',
  };
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  return api('/upload', { method: 'POST', body: fd });
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(s) {
  return escapeHtml(s);
}

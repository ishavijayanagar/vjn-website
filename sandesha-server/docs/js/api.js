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

/** True when this page is served by listen.js (not GitHub Pages). */
export function isServedByApi() {
  const h = pageHostname();
  return (
    h === '127.0.0.1' ||
    h === 'localhost' ||
    h === '[::1]' ||
    h.endsWith('.ts.net') ||
    h.endsWith('.trycloudflare.com')
  );
}

function configApiUrl() {
  const raw = typeof window !== 'undefined' && window.SANDESHA_CONFIG?.apiUrl;
  return raw ? String(raw).replace(/\/$/, '') : null;
}

function storedApiUrl() {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem('sandesha_api');
  return raw ? String(raw).replace(/\/$/, '') : null;
}

function resolveApiBase() {
  if (isServedByApi()) {
    const origin = pageOrigin();
    const stored = storedApiUrl();
    if (stored && stored !== origin) {
      try { localStorage.removeItem('sandesha_api'); } catch { /* ignore */ }
    }
    return origin || DEFAULT_API;
  }
  const config = configApiUrl();
  const stored = storedApiUrl();
  if (config) {
    if (stored && stored !== config) {
      try { localStorage.removeItem('sandesha_api'); } catch { /* ignore */ }
    }
    return config;
  }
  return stored || DEFAULT_API;
}

let apiBase = resolveApiBase();
let onUnauthorized = null;

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

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
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
    res = await fetch(url, { ...options, headers });
  } catch {
    throw new Error(`Cannot reach server at ${apiBase}`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text || res.statusText }; }

  if (res.status === 401) {
    setToken('');
    if (onUnauthorized) onUnauthorized();
    throw new Error(data.error || 'Unauthorized');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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

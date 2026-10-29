'use strict';

/**
 * Photos the website shows (program flyers, the homepage banner). Kept in
 * their own folder so the WhatsApp attachment cleanup never deletes them.
 * Old Drive links keep working; only a new upload lands here.
 */

const fs = require('fs');
const path = require('path');

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const MAX_BYTES = 8 * 1024 * 1024;

function dir() {
  return process.env.SANDESHA_SITE_MEDIA_DIR || path.join(__dirname, 'site-media');
}

/** Where the public site should load these files from. */
function publicBase() {
  const env = String(process.env.SANDESHA_PUBLIC_URL || '').replace(/\/$/, '');
  if (env) return env;
  try {
    const text = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
    const all = [...text.matchAll(/^const SANDESHA_API_URL = "([^"]+)"/gm)];
    if (all.length) return all[all.length - 1][1].replace(/\/$/, '');
  } catch { /* a bare server may not have the website config beside it */ }
  return '';
}

function saveImage({ base64, mimeType }) {
  const type = String(mimeType || '').toLowerCase();
  const ext = MIME_EXT[type];
  if (!ext) {
    const err = new Error('Use a JPEG, PNG, or WebP image.');
    err.status = 400;
    throw err;
  }
  const buf = Buffer.from(String(base64 || '').replace(/\s/g, ''), 'base64');
  if (!buf.length) {
    const err = new Error('No image data.');
    err.status = 400;
    throw err;
  }
  if (buf.length > MAX_BYTES) {
    const err = new Error('That image is too large.');
    err.status = 400;
    throw err;
  }
  const folder = dir();
  fs.mkdirSync(folder, { recursive: true });
  const name = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  fs.writeFileSync(path.join(folder, name), buf);
  return { name, mimeType: type === 'image/jpg' ? 'image/jpeg' : type };
}

function readFile(name) {
  const base = path.basename(String(name || ''));
  if (!base || base !== String(name || '') || base.startsWith('.')) return null;
  const abs = path.join(dir(), base);
  if (!fs.existsSync(abs)) return null;
  const mime = EXT_MIME[path.extname(abs).toLowerCase()];
  if (!mime) return null;
  return { abs, mime };
}

/** A URL this server published, so a scheduled send can attach the file without downloading it. */
function localFile(url) {
  let name = '';
  try {
    const u = new URL(String(url || ''));
    const m = u.pathname.match(/\/public\/media\/([^/]+)$/);
    if (m) name = decodeURIComponent(m[1]);
  } catch {
    const m = String(url || '').match(/\/public\/media\/([^/?#]+)/);
    if (m) name = decodeURIComponent(m[1]);
  }
  return name ? readFile(name) : null;
}

module.exports = { saveImage, readFile, localFile, publicBase, dir };

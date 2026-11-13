'use strict';

/**
 * Request body size caps. Node's http module reads whatever it is sent, so one huge POST
 * could fill the Pi's memory. Everything that reads a JSON body goes through here.
 *
 * JSON_MAX_BYTES fits a 16 MB photo sent as base64 (about 22 MB); logins and small forms
 * pass a much smaller limit.
 */

const JSON_MAX_BYTES = 24 * 1024 * 1024;
const SMALL_MAX_BYTES = 64 * 1024;

class BodyTooLarge extends Error {
  constructor(max) {
    super(`That request is too large (max ${Math.round(max / 1024)} KB).`);
    this.status = 413;
  }
}

/** Reads the whole body as text; rejects with BodyTooLarge (413) past `max` bytes. */
function readLimited(req, max = JSON_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers && req.headers['content-length']);
    if (Number.isFinite(declared) && declared > max) {
      req.resume();
      reject(new BodyTooLarge(max));
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      if (typeof c === 'string') c = Buffer.from(c);
      size += c.length;
      if (size > max) {
        done = true;
        chunks.length = 0;
        reject(new BodyTooLarge(max));
        req.resume(); // drain and discard the rest
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', (err) => { if (!done) { done = true; reject(err); } });
  });
}

/**
 * For routes that collect the body themselves with req.on('data'): answers 413 and stops
 * the request once it passes `max` bytes. Returns false if the request was refused.
 */
function guardBody(req, res, max = JSON_MAX_BYTES) {
  const declared = Number(req.headers && req.headers['content-length']);
  const refuse = () => {
    if (!res.headersSent) {
      res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ error: new BodyTooLarge(max).message }));
    }
    req.destroy();
  };
  if (Number.isFinite(declared) && declared > max) { refuse(); return false; }
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size > max) refuse(); });
  return true;
}

module.exports = { readLimited, guardBody, BodyTooLarge, JSON_MAX_BYTES, SMALL_MAX_BYTES };

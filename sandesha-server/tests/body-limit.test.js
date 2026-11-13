'use strict';
const assert = require('assert');
const http = require('http');
const { readLimited } = require('../body-limit');

function serve(max) {
  return http.createServer(async (req, res) => {
    try { const b = await readLimited(req, max); res.end(`ok ${b.length}`); }
    catch (e) { res.writeHead(e.status || 500); res.end(e.message); }
  });
}
function post(port, body) {
  return new Promise((resolve) => {
    const r = http.request({ port, method: 'POST', host: '127.0.0.1' }, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ status: res.statusCode, d })); });
    r.on('error', () => resolve({ status: 'closed' }));
    r.end(body);
  });
}
(async () => {
  const s = serve(1000); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  assert.deepStrictEqual(await post(port, 'x'.repeat(500)), { status: 200, d: 'ok 500' });
  assert.strictEqual((await post(port, 'x'.repeat(5000))).status, 413);
  s.close();
  console.log('  ✓ body-limit: small body ok, oversized body gets 413\nAll body-limit tests passed');
})();

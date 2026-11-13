'use strict';

/**
 * whatsapp-web.js 1.34.7: `ready` sometimes never fires after `authenticated`.
 * A short-lived pdf-viewer iframe closes while the library is exposing its
 * event bindings, Puppeteer rejects with "Target closed", and nothing reports it
 * (wwebjs issue #201946, fix proposed in PR #201958, not yet released).
 *
 * This retries the exposure a few times, only for that error, and re-checks
 * whether the binding already exists first. Safe to run repeatedly.
 */

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../node_modules/whatsapp-web.js/src/util/Puppeteer.js');
if (!fs.existsSync(target)) {
  console.log('[patch-expose] skip — whatsapp-web.js not installed');
  process.exit(0);
}

const src = fs.readFileSync(target, 'utf8');
if (src.includes('sandesha-expose-retry')) {
  console.log('[patch-expose] already patched');
  process.exit(0);
}

const original = `async function exposeFunctionIfAbsent(page, name, fn) {
    const exist = await page.evaluate((name) => {
        return !!window[name];
    }, name);
    if (exist) {
        return;
    }
    await page.exposeFunction(name, fn);
}`;

const patched = `// sandesha-expose-retry: see sandesha-server/scripts/patch-whatsapp-web-expose.js
async function exposeFunctionIfAbsent(page, name, fn) {
    const attempts = 5;
    for (let i = 1; i <= attempts; i++) {
        try {
            const exist = await page.evaluate((name) => {
                return !!window[name];
            }, name);
            if (exist) {
                return;
            }
            await page.exposeFunction(name, fn);
            return;
        } catch (err) {
            const retryable = /Target closed|Execution context was destroyed|already exists/i.test(String(err && err.message));
            if (!retryable || i === attempts) throw err;
            await new Promise((r) => setTimeout(r, 250));
        }
    }
}`;

if (!src.includes(original)) {
  console.log('[patch-expose] expected code not found (library changed?) — not patching');
  process.exit(0);
}
fs.writeFileSync(target, src.replace(original, patched));
console.log('[patch-expose] patched exposeFunctionIfAbsent');

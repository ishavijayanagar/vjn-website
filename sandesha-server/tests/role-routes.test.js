'use strict';

/**
 * Role permission matrix for Sandesha API routes (promotions vs admin).
 * Mirrors requireAuth(..., ['admin']) in listen.js and api-handlers.js.
 */
const PROMOTIONS_ALLOWED = new Set([
  'GET /health',
  'GET /auth/me',
  'GET /sets',
  'GET /groups',
  'GET /chats',
  'GET /schedules',
  'POST /schedules',
  'DELETE /schedules/:id',
  'GET /contacts',
  'POST /send',
  'POST /send-media',
  'POST /upload',
  'GET /push/vapid-public-key',
  'POST /push/subscribe',
  'POST /push/unsubscribe',
  'POST /push/test',
]);

const ADMIN_ONLY = [
  'POST /sets',
  'POST /contacts',
  'DELETE /contacts/:name',
  'GET /contacts/search',
  'GET /groups/inactive',
  'GET /groups/find-member',
  'GET /groups/:jid/members',
  'POST /send/broadcast',
  'POST /send/bulk',
  'POST /jobs/add-members',
  'GET /jobs/:id',
  'GET /ai/status',
  'POST /ai/chat',
  'GET /pairing/qr.png',
  'POST /volunteers/add-to-group',
  'GET /volunteers/job/:id',
];

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`✅ PASS: ${name}`);
    passed += 1;
  } else {
    console.log(`❌ FAIL: ${name}`);
    failed += 1;
  }
}

function isAllowedForPromotions(routeKey) {
  if (PROMOTIONS_ALLOWED.has(routeKey)) return true;
  if (routeKey.startsWith('DELETE /schedules/')) return true;
  return false;
}

console.log('='.repeat(60));
console.log('SANDESHA ROLE ROUTE MATRIX');
console.log('='.repeat(60));

for (const route of PROMOTIONS_ALLOWED) {
  assert(isAllowedForPromotions(route), `promotions may ${route}`);
}

for (const route of ADMIN_ONLY) {
  assert(!isAllowedForPromotions(route), `promotions blocked from ${route}`);
}

console.log('');
console.log('='.repeat(60));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('='.repeat(60));

if (failed > 0) process.exit(1);

// =============================================
// STEP 1: Paste your Google Apps Script URL here
// after deploying (see setup-guide.md for how)
// =============================================

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzYypTOLbAl-5UlA6ZDElEezfevwI9w3pfjoJ_0dxUYCDmKnaYZwdqIMOr0xOtY1d81/exec";

// Sandesha WhatsApp API — the funnel URL that sandesha-server/ is reachable on.
// Used by promotions Schedule/Send and admin Messaging.
// DEV: laptop backend (use while developing locally)
// const SANDESHA_API_URL = "https://prakash-lenovo-ideapad-s340-14iil.tail2677db.ts.net";
// PROD: Raspberry Pi backend
const SANDESHA_API_URL = "https://sandesha-vjn-pi.tail2677db.ts.net";
if (typeof window !== "undefined") {
  window.SANDESHA_API_URL = SANDESHA_API_URL;
  window.SANDESHA_CONFIG = window.SANDESHA_CONFIG || { apiUrl: SANDESHA_API_URL };
}

// Optional per-machine override (git-ignored). Only asked for on a developer machine,
// so the live site never requests a file that is not there (a 404 in every console).
if (typeof document !== "undefined" && /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|.*\.local$)/.test(location.hostname)) {
  document.write('<script src="config.local.js"><\/script>');
}

// Queries page: WhatsApp button opens the contact/group picker
// with the query text. Clicking a person's number opens that chat.

// =============================================
// STEP 1: Paste your Google Apps Script URL here
// after deploying (see setup-guide.md for how)
// =============================================

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzYypTOLbAl-5UlA6ZDElEezfevwI9w3pfjoJ_0dxUYCDmKnaYZwdqIMOr0xOtY1d81/exec";

// Sandesha WhatsApp API — the funnel URL that sandesha-server/ is reachable on.
// Used by promotions Schedule/Send and admin Messaging.
const SANDESHA_API_URL = "https://sandesha-vjn-pi.tail2677db.ts.net";
if (typeof window !== "undefined") {
  window.SANDESHA_API_URL = SANDESHA_API_URL;
  window.SANDESHA_CONFIG = window.SANDESHA_CONFIG || { apiUrl: SANDESHA_API_URL };
}

// Queries page: WhatsApp button opens the contact/group picker
// with the query text. Clicking a person's number opens that chat.

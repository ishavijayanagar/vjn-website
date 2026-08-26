// =============================================
// Isha Place, Vijayanagar — Google Apps Script
//
// FIRST-TIME ADMIN SETUP (do this in the Apps Script editor):
// 1. If this is a brand-new spreadsheet, put a password in ADMIN_PASSWORD
//    below (6+ characters). If you already set a password earlier, leave
//    ADMIN_PASSWORD as REPLACE_ME — setupAdmin will reuse the saved one.
// 2. Click Save (disk icon).
// 3. At the top, choose function: setupAdmin
// 4. Click Run.
// 5. Review permissions → your Google account → Advanced →
//    Go to Centre Website (unsafe) → Allow.
//    That screen is where Drive access is granted. Deploying
//    a web app does NOT show it.
// 6. Deploy → Manage deployments → pencil → New version → Deploy.
//
// Sign in at /admin.html: choose Admin, then the existing admin password.
// After that, add Programs / Promotions / Nurturing people from Team.
// =============================================

// First admin account password (change this, then Run setupAdmin).
const ADMIN_PASSWORD = "REPLACE_ME";

const PROGRAMS_SHEET = "Programs";
const VOLUNTEER_SHEET = "Volunteering";
const SITE_SHEET = "Site";
const USERS_SHEET = "Users";
const PROMOTIONS_SHEET = "Promotions";

const HOME_QUERIES_SHEET = "HomeQueries";
const PROGRAM_INTEREST_SHEET = "ProgramInterest";
const PROGRAM_VOLUNTEER_SHEET = "ProgramVolunteer";
const VOLUNTEERING_INTEREST_SHEET = "VolunteeringInterest";

const USER_HEADERS = [
  "id",
  "username",
  "display_name",
  "role",
  "password_salt",
  "password_hash",
  "status",
  "created_at",
];

const PROMO_HEADERS = [
  "id",
  "event_type",
  "event_id",
  "event_title",
  "message",
  "flyer_url",
  "send_at",
  "status",
  "created_by",
  "updated_at",
  "sent_at",
  "sent_by",
];

const VALID_ROLES_ = ["admin", "programs", "promotions", "nurturing"];

const PROGRAM_HEADERS = [
  "title",
  "description",
  "startdate",
  "enddate",
  "starttime",
  "endtime",
  "starttime2",
  "endtime2",
  "starttime3",
  "endtime3",
  "slotlabel",
  "slotlabel2",
  "slotlabel3",
  "timings",
  "location",
  "duration",
  "frequency",
  "image",
  "registerlink",
  "volunteering_available",
  "volunteers_needed",
  "status",
];

const PROGRAM_TZ_ = "Asia/Kolkata";

const VOLUNTEER_HEADERS = [
  "title",
  "description",
  "startdate",
  "enddate",
  "starttime",
  "endtime",
  "starttime2",
  "endtime2",
  "starttime3",
  "endtime3",
  "slotlabel",
  "slotlabel2",
  "slotlabel3",
  "timings",
  "location",
  "duration",
  "image",
  "status",
];

const SITE_DEFAULTS = {
  hero_quote:
    '"If tears of joy, tears of love, tears of ecstasy have not washed your cheeks, you are yet to experience life."',
  about_label: "About This Centre",
  about_heading: "A Space for Inner Wellbeing",
  about_body:
    "A local Isha Foundation centre offering yoga, meditation, and inner wellbeing programs. Whether you are a beginner or a seasoned practitioner, this is a space for you to grow, transform, and contribute.",
  footer_address: "195, 1st Floor, 17th Cross Rd,\nCHBS Layout, MC Layout,\nVijayanagar, Bengaluru – 560040",
  footer_phone: "+91 80957 63111",
  footer_hours: "Mon – Sun\n10:00 AM – 8:00 PM",
  hero_image: "",
  hero_image_mobile: "",
};

const TOKEN_TTL_SECONDS = 21600;
// CacheService is volatile and caps at 6h, so sessions are also mirrored into
// Script Properties, which is durable. That's what lets an installed PWA stay
// signed in across restarts.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_PROP_PREFIX = "sess_";
const TOKEN_CACHE_PREFIX = "admin_token_";
const USER_DISABLED_PREFIX = "user_disabled_";
const USER_TOKENS_PREFIX = "user_toks_";
const DISABLED_USER_IDS_PROP = "DISABLED_USER_IDS";
const PUBLIC_CACHE_TTL = 90;
const CACHE_PROGRAMS = "pub_programs_v3";
const CACHE_VOLUNTEER = "pub_volunteer_v3";
const CACHE_SITE = "pub_site_v2";

/** Per-execution spreadsheet handle (avoids repeated getActiveSpreadsheet). */
var SS_ = null;
/** Sheets already header-checked this execution. */
var ENSURED_ = {};

function ss_() {
  if (!SS_) SS_ = SpreadsheetApp.getActiveSpreadsheet();
  return SS_;
}

function cacheGetJson_(key) {
  const raw = CacheService.getScriptCache().get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function cachePutJson_(key, obj, ttl) {
  try {
    const text = JSON.stringify(obj);
    if (text.length > 90000) return;
    CacheService.getScriptCache().put(key, text, ttl || PUBLIC_CACHE_TTL);
  } catch (err) {
    // Cache is best-effort; ignore quota / size errors.
  }
}

function invalidatePublicCache_(resource) {
  const cache = CacheService.getScriptCache();
  if (!resource || resource === "programs") cache.remove(CACHE_PROGRAMS);
  if (!resource || resource === "volunteering") cache.remove(CACHE_VOLUNTEER);
  if (!resource || resource === "site") cache.remove(CACHE_SITE);
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Website")
      .addItem("Set admin password", "promptSetAdminPassword")
      .addItem("Authorize Drive / create image folder", "setupAdmin")
      .addToUi();
  } catch (err) {
    // Menu is optional. Password + Drive setup work via setupAdmin() in the editor.
  }
}

/**
 * Run this once from the Apps Script editor (function dropdown → setupAdmin → Run).
 * Google will then ask you to Allow Drive. That prompt does not appear on Deploy.
 */
function setupAdmin() {
  const fromFile = String(ADMIN_PASSWORD || "").trim();
  let password = "";
  if (fromFile && fromFile !== "REPLACE_ME" && fromFile.length >= 6) {
    password = fromFile;
    PropertiesService.getScriptProperties().setProperty("ADMIN_PASSWORD", password);
  } else {
    password = getAdminPassword_();
  }
  if (!password || password.length < 6) {
    throw new Error(
      "No admin password is saved yet. In the spreadsheet use Website → Set admin password, or put it in ADMIN_PASSWORD at the top of this file, Save, then Run setupAdmin again."
    );
  }
  upsertAdminUser_(password);
  ensureSheet_(USERS_SHEET, USER_HEADERS);
  ensureSheet_(PROMOTIONS_SHEET, PROMO_HEADERS);
  ensureDuePromoTrigger_();
  const folder = getCentreImagesFolder_();
  Logger.log("Setup complete. Sign in at /admin.html: choose Admin, then the existing admin password.");
  Logger.log("Drive folder: " + folder.getName() + " (" + folder.getUrl() + ")");
}

function promptSetAdminPassword() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    "Website admin password",
    "This sets the password for username \"admin\" on /admin.html",
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const password = String(result.getResponseText() || "").trim();
  if (password.length < 6) {
    ui.alert("Password must be at least 6 characters.");
    return;
  }
  PropertiesService.getScriptProperties().setProperty("ADMIN_PASSWORD", password);
  upsertAdminUser_(password);
  ui.alert("Saved. Sign in at /admin.html with username admin and this password.");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  const type = (params.type || "").toString();
  const id = params.id;

  try {
    if (type === "site") {
      return json_(getSiteContent());
    }
    if (type === "programs" || type === "volunteering") {
      const sheetName = type === "programs" ? PROGRAMS_SHEET : VOLUNTEER_SHEET;
      return json_(id ? getSingleItem(sheetName, id, false) : getAllItems(sheetName, false));
    }
    return json_({ error: "Unknown type" });
  } catch (err) {
    return json_({ error: err.message });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const formType = data.formType;

    if (formType === "homeQuery") {
      saveHomeQuery(data);
      return json_({ success: true });
    }
    if (formType === "programInterest") {
      saveProgramInterest(data);
      return json_({ success: true });
    }
    if (formType === "programVolunteer") {
      saveProgramVolunteer(data);
      return json_({ success: true });
    }
    if (formType === "volunteeringInterest") {
      saveVolunteeringInterest(data);
      return json_({ success: true });
    }

    if (formType === "adminLogin") {
      return json_(adminLogin(data));
    }
    if (formType === "adminLogout") {
      return json_(adminLogout(data));
    }
    if (formType === "adminSession") {
      const session = requireLiveSession_(data.token);
      return json_({ user: publicSession_(session) });
    }
    if (formType === "adminGet") {
      return json_(adminRead_(data));
    }
    if (formType === "adminSaveItem") {
      return json_(adminSaveItem(data));
    }
    if (formType === "adminDeleteItem") {
      return json_(adminDeleteItem(data));
    }
    if (formType === "adminClearClosed") {
      return json_(adminClearClosed(data));
    }
    if (formType === "adminUploadImage") {
      return json_(adminUploadImage(data));
    }
    if (formType === "adminGetImage") {
      return json_(adminGetImage(data));
    }
    if (formType === "adminSaveSite") {
      return json_(adminSaveSite(data));
    }
    if (formType === "adminUpdateInquiry") {
      return json_(adminUpdateInquiry(data));
    }
    if (formType === "adminSaveUser") {
      return json_(adminSaveUser(data));
    }
    if (formType === "adminSetUserStatus") {
      return json_(adminSetUserStatus(data));
    }
    if (formType === "adminSavePromotion") {
      return json_(adminSavePromotion(data));
    }
    if (formType === "adminAddPromotion") {
      return json_(adminAddPromotion(data));
    }
    if (formType === "adminMarkPromotionSent") {
      return json_(adminMarkPromotionSent(data));
    }
    if (formType === "adminUnmarkPromotionSent") {
      return json_(adminUnmarkPromotionSent(data));
    }

    return json_({
      error:
        "Unknown formType. Use homeQuery, programInterest, programVolunteer, volunteeringInterest, or admin actions.",
    });
  } catch (err) {
    return json_({ error: err.message });
  }
}

function getAdminPassword_() {
  const fromProps = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  if (fromProps && fromProps !== "REPLACE_ME") return fromProps;
  const fromConst = String(ADMIN_PASSWORD || "").trim();
  if (fromConst && fromConst !== "REPLACE_ME") return fromConst;
  return "";
}

function hashPassword_(password, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt || "") + String(password || ""));
  return raw
    .map(function (b) {
      const v = b < 0 ? b + 256 : b;
      return ("0" + v.toString(16)).slice(-2);
    })
    .join("");
}

function newSalt_() {
  return Utilities.getUuid().replace(/-/g, "");
}

function normalizeUsername_(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function normalizeRole_(raw) {
  const r = String(raw || "")
    .trim()
    .toLowerCase();
  return VALID_ROLES_.indexOf(r) >= 0 ? r : "";
}

function nowIsoKolkata_() {
  return Utilities.formatDate(new Date(), PROGRAM_TZ_, "yyyy-MM-dd'T'HH:mm:ss");
}

function publicSession_(session) {
  return {
    id: session.id,
    username: session.username,
    displayName: session.displayName || session.username,
    role: session.role,
  };
}

function tokenCacheKey_(token) {
  return TOKEN_CACHE_PREFIX + String(token);
}

function userDisabledKey_(userId) {
  return USER_DISABLED_PREFIX + String(userId);
}

function userTokensKey_(userId) {
  return USER_TOKENS_PREFIX + String(userId);
}

function sessionPropKey_(token) {
  return SESSION_PROP_PREFIX + String(token);
}

function persistSession_(token, session) {
  if (!token || !session) return;
  try {
    PropertiesService.getScriptProperties().setProperty(
      sessionPropKey_(token),
      JSON.stringify({ session: session, expiresAt: Date.now() + SESSION_TTL_MS })
    );
  } catch (err) {}
}

function readPersistedSession_(token) {
  if (!token) return null;
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(sessionPropKey_(token));
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || !rec.session) return null;
    if (rec.expiresAt && Date.now() > rec.expiresAt) {
      dropPersistedSession_(token);
      return null;
    }
    return rec.session;
  } catch (err) {
    return null;
  }
}

function dropPersistedSession_(token) {
  if (!token) return;
  try {
    PropertiesService.getScriptProperties().deleteProperty(sessionPropKey_(token));
  } catch (err) {}
}

function dropToken_(token) {
  if (!token) return;
  CacheService.getScriptCache().remove(tokenCacheKey_(token));
  dropPersistedSession_(token);
}

function rememberUserToken_(userId, token) {
  if (!userId || !token) return;
  const cache = CacheService.getScriptCache();
  const key = userTokensKey_(userId);
  let list = [];
  try {
    list = JSON.parse(cache.get(key) || "[]");
  } catch (err) {
    list = [];
  }
  if (list.indexOf(token) < 0) list.push(token);
  cache.put(key, JSON.stringify(list), TOKEN_TTL_SECONDS);
}

function dropUserTokens_(userId) {
  if (!userId) return;
  const cache = CacheService.getScriptCache();
  const key = userTokensKey_(userId);
  let list = [];
  try {
    list = JSON.parse(cache.get(key) || "[]");
  } catch (err) {
    list = [];
  }
  for (let i = 0; i < list.length; i++) dropToken_(list[i]);
  cache.remove(key);
}

function disabledUserIdSet_() {
  const raw = String(PropertiesService.getScriptProperties().getProperty(DISABLED_USER_IDS_PROP) || "");
  const set = {};
  raw.split(",").forEach(function (id) {
    const trimmed = String(id || "").trim();
    if (trimmed) set[trimmed] = true;
  });
  return set;
}

function persistUserDisabled_(userId, disabled) {
  if (!userId) return;
  const id = String(userId);
  const set = disabledUserIdSet_();
  if (disabled) set[id] = true;
  else delete set[id];
  PropertiesService.getScriptProperties().setProperty(DISABLED_USER_IDS_PROP, Object.keys(set).join(","));
}

function isPersistentlyDisabled_(userId) {
  if (!userId) return false;
  return !!disabledUserIdSet_()[String(userId)];
}

function markUserDisabled_(userId) {
  if (!userId) return;
  persistUserDisabled_(userId, true);
  CacheService.getScriptCache().put(userDisabledKey_(userId), "1", TOKEN_TTL_SECONDS);
  dropUserTokens_(userId);
}

function clearUserDisabled_(userId) {
  if (!userId) return;
  persistUserDisabled_(userId, false);
  CacheService.getScriptCache().remove(userDisabledKey_(userId));
}

function readSession_(token) {
  if (!token) return { reason: "expired" };
  const cache = CacheService.getScriptCache();
  let session = null;

  const cached = cache.get(tokenCacheKey_(token));
  if (cached && cached !== "1") {
    try {
      session = JSON.parse(cached);
    } catch (err) {
      session = null;
    }
  }

  if (!session || !session.role || !session.id) {
    // Cache expired or was evicted; fall back to the durable copy and re-warm.
    // Re-persisting here slides the 30-day window forward on continued use,
    // without a Properties write on every single request.
    session = readPersistedSession_(token);
    if (session && session.role && session.id) {
      cache.put(tokenCacheKey_(token), JSON.stringify(session), TOKEN_TTL_SECONDS);
      persistSession_(token, session);
    }
  }

  if (!session || !session.role || !session.id) return { reason: "expired" };

  if (cache.get(userDisabledKey_(session.id)) === "1" || isPersistentlyDisabled_(session.id)) {
    cache.remove(tokenCacheKey_(token));
    dropPersistedSession_(token);
    return { reason: "disabled" };
  }
  return { session: session };
}

function getSession_(token) {
  const result = readSession_(token);
  return result.session || null;
}

function isValidAdminToken(token) {
  return !!getSession_(token);
}

function authEndedError_(reason) {
  if (reason === "disabled") {
    throw new Error("Unauthorized. This login has been disabled.");
  }
  throw new Error("Unauthorized. Please log in again.");
}

function requireSession_(token) {
  const result = readSession_(token);
  if (result.session) return result.session;
  authEndedError_(result.reason);
}

function userIsActive_(user) {
  return !!user && String(user.status || "").toLowerCase() === "active";
}

function requireLiveSession_(token) {
  const session = requireSession_(token);
  const user = findUserById_(session.id);
  if (!userIsActive_(user)) {
    markUserDisabled_(session.id);
    dropToken_(token);
    authEndedError_("disabled");
  }
  return session;
}

function requireRole_(token, allowedRoles) {
  const session = requireLiveSession_(token);
  const allowed = allowedRoles || [];
  if (allowed.indexOf(session.role) < 0) {
    throw new Error("You do not have access to this.");
  }
  return session;
}

function requireAdmin_(token) {
  return requireRole_(token, ["admin"]);
}

function findUserByRoleAndPassword_(role, password) {
  const wanted = normalizeRole_(role);
  if (!wanted || !password) return { user: null, hasRole: false };
  const loaded = loadUsers_();
  let hasRole = false;
  for (let i = 0; i < loaded.users.length; i++) {
    const user = loaded.users[i];
    if (normalizeRole_(user.role) !== wanted) continue;
    if (String(user.status || "").toLowerCase() !== "active") continue;
    hasRole = true;
    const expectedHash = String(user.password_hash || "");
    if (expectedHash && hashPassword_(password, user.password_salt) === expectedHash) {
      return { user: user, hasRole: true };
    }
  }
  return { user: null, hasRole: hasRole };
}

function adminLogin(data) {
  bootstrapAdminUser_(getAdminPassword_());
  const role = normalizeRole_(data.role);
  const password = String(data.password || "");
  if (!role) return { error: "Choose your team." };
  if (!password) return { error: "Enter the password." };
  if (loadUsers_().users.length === 0) {
    return {
      error: "Admin is not set up. In Apps Script, set ADMIN_PASSWORD and Run setupAdmin.",
    };
  }
  const found = findUserByRoleAndPassword_(role, password);
  if (!found.hasRole) {
    return { error: "This team is not set up yet. Ask admin to add a login." };
  }
  if (!found.user) return { error: "Invalid password." };
  const user = found.user;
  clearUserDisabled_(user.id);
  const token = Utilities.getUuid();
  const session = {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    role: user.role,
  };
  CacheService.getScriptCache().put(tokenCacheKey_(token), JSON.stringify(session), TOKEN_TTL_SECONDS);
  persistSession_(token, session);
  rememberUserToken_(user.id, token);
  return { success: true, token: token, user: publicSession_(session) };
}

function adminLogout(data) {
  dropToken_(data && data.token);
  return { success: true };
}

function adminRead_(data) {
  const type = String((data && data.type) || "");
  const token = data && data.token;
  const id = data && data.id;

  if (type === "session") {
    const session = requireLiveSession_(token);
    return { user: publicSession_(session) };
  }
  if (type === "programs" || type === "volunteering") {
    if (type === "volunteering") requireRole_(token, ["admin", "nurturing"]);
    else requireRole_(token, ["admin", "programs", "promotions"]);
    const sheetName = type === "programs" ? PROGRAMS_SHEET : VOLUNTEER_SHEET;
    return id ? getSingleItem(sheetName, id, true) : getAllItems(sheetName, true);
  }
  if (type === "inquiries") {
    requireRole_(token, ["admin", "nurturing"]);
    const groupKey = String((data && data.group) || "").trim();
    if (groupKey) return getInquiryGroup_(groupKey);
    return getInquiryMeta_();
  }
  if (type === "promotions") {
    requireRole_(token, ["admin", "promotions"]);
    const dueOnly = String((data && data.due) || "") === "1";
    return listPromotions_({ dueOnly: dueOnly });
  }
  if (type === "users") {
    requireRole_(token, ["admin"]);
    return { users: listUsersPublic_() };
  }
  throw new Error("Unknown type");
}

function sheetNameForResource_(resource) {
  if (resource === "programs") return PROGRAMS_SHEET;
  if (resource === "volunteering") return VOLUNTEER_SHEET;
  throw new Error("Unknown resource. Use programs or volunteering.");
}

function expectedHeadersFor_(sheetName) {
  if (sheetName === PROGRAMS_SHEET) return PROGRAM_HEADERS;
  if (sheetName === VOLUNTEER_SHEET) return VOLUNTEER_HEADERS;
  return [];
}

function valueForHeader_(item, header) {
  if (item[header] !== undefined && item[header] !== null) return String(item[header]).trim();
  if (header === "register link" || header === "registerlink") {
    const v = item.registerlink || item["register link"] || item.registerLink;
    if (v !== undefined && v !== null) return String(v).trim();
  }
  if (header === "start date" || header === "startdate") {
    const v = item.startdate || item["start date"] || item.startDate;
    if (v !== undefined && v !== null) return String(v).trim();
  }
  if (header === "end date" || header === "enddate") {
    const v = item.enddate || item["end date"] || item.endDate;
    if (v !== undefined && v !== null) return String(v).trim();
  }
  if (header === "start time" || header === "starttime") {
    const v = item.starttime || item["start time"] || item.startTime;
    if (v !== undefined && v !== null) return String(v).trim();
  }
  if (header === "end time" || header === "endtime") {
    const v = item.endtime || item["end time"] || item.endTime;
    if (v !== undefined && v !== null) return String(v).trim();
  }
  if (header === "start time 2" || header === "starttime2") {
    const v = item.starttime2 || item["start time 2"] || item.startTime2;
    if (v !== undefined && v !== null) return String(v).trim();
  }
  if (header === "end time 2" || header === "endtime2") {
    const v = item.endtime2 || item["end time 2"] || item.endTime2;
    if (v !== undefined && v !== null) return String(v).trim();
  }
  if (header === "start time 3" || header === "starttime3") {
    const v = item.starttime3 || item["start time 3"] || item.startTime3;
    if (v !== undefined && v !== null) return String(v).trim();
  }
  if (header === "end time 3" || header === "endtime3") {
    const v = item.endtime3 || item["end time 3"] || item.endTime3;
    if (v !== undefined && v !== null) return String(v).trim();
  }
  if (header === "program status" || header === "listing status") {
    if (item.status !== undefined && item.status !== null) return String(item.status).trim();
  }
  return undefined;
}

function cellToDisplay_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, PROGRAM_TZ_, "yyyy-MM-dd");
  }
  if (value === undefined || value === null) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

function cellToHm_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, PROGRAM_TZ_, "HH:mm");
  }
  return toHm_(value);
}

function toYmd_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, PROGRAM_TZ_, "yyyy-MM-dd");
  }
  const s = cellToDisplay_(value);
  if (!s) return "";
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, PROGRAM_TZ_, "yyyy-MM-dd");
  }
  return "";
}

function toHm_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, PROGRAM_TZ_, "HH:mm");
  }
  const s = String(value === undefined || value === null ? "" : value)
    .replace(/\u00a0/g, " ")
    .trim();
  if (!s) return "";
  const iso = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (iso) {
    const h = Math.min(23, parseInt(iso[1], 10));
    const m = Math.min(59, parseInt(iso[2], 10));
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12;
    if (/pm/i.test(ampm[3])) h += 12;
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  return "";
}

function formatHmAmPm_(hm) {
  const t = toHm_(hm);
  if (!t) return "";
  const parts = t.split(":");
  let h = parseInt(parts[0], 10);
  const m = parts[1] || "00";
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return h + ":" + m + " " + ap;
}

function formatSlotLabel_(startHm, endHm) {
  const a = formatHmAmPm_(startHm);
  const b = formatHmAmPm_(endHm);
  if (a && b) return a + " – " + b;
  return a || b || "";
}

function formatSlotLine_(label, startHm, endHm) {
  const range = formatSlotLabel_(startHm, endHm);
  const name = String(label || "").trim();
  if (name && range) return name + " " + range;
  return name || range || "";
}

function kolkataNowParts_() {
  const now = new Date();
  return {
    ymd: Utilities.formatDate(now, PROGRAM_TZ_, "yyyy-MM-dd"),
    hm: Utilities.formatDate(now, PROGRAM_TZ_, "HH:mm"),
  };
}

function headerIndex_(headers, names) {
  for (let i = 0; i < names.length; i++) {
    const ix = headers.indexOf(names[i]);
    if (ix >= 0) return ix;
  }
  return -1;
}

function programEndDateFromRow_(headers, row) {
  const endIx = headerIndex_(headers, ["enddate", "end date"]);
  if (endIx >= 0 && cellToDisplay_(row[endIx])) return row[endIx];
  const dateIx = headers.indexOf("date");
  if (dateIx >= 0) return row[dateIx];
  return "";
}

function programStartDateFromRow_(headers, row) {
  const startIx = headerIndex_(headers, ["startdate", "start date"]);
  if (startIx >= 0 && cellToDisplay_(row[startIx])) return row[startIx];
  const dateIx = headers.indexOf("date");
  if (dateIx >= 0) return row[dateIx];
  return "";
}

function programStartTimeFromRow_(headers, row) {
  const ix = headerIndex_(headers, ["starttime", "start time"]);
  if (ix >= 0) {
    const hm = cellToHm_(row[ix]);
    if (hm) return hm;
  }
  const timingsIx = headers.indexOf("timings");
  if (timingsIx >= 0) {
    const parsed = parseFirstSlotFromTimings_(cellToDisplay_(row[timingsIx]));
    if (parsed && parsed.start) return parsed.start;
  }
  return "";
}

function parseFirstSlotFromTimings_(raw) {
  const s = String(raw || "");
  const re = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/gi;
  const times = [];
  let m;
  while ((m = re.exec(s)) && times.length < 2) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const ap = (m[3] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    if (!ap && h > 23) continue;
    times.push((h < 10 ? "0" : "") + h + ":" + (min < 10 ? "0" : "") + min);
  }
  if (!times.length) return null;
  return { start: times[0], end: times[1] || "" };
}

function formatProgramDateLabel_(startRaw, endRaw) {
  const start = toYmd_(startRaw);
  const end = toYmd_(endRaw);
  if (start && end && start !== end) return start + " – " + end;
  return end || start || "";
}

/** Close when now >= startdate + first slot starttime (Asia/Kolkata). */
function isPastEventStart_(startDateRaw, startTimeRaw) {
  const startYmd = toYmd_(startDateRaw);
  if (!startYmd) return false;
  const startHm = toHm_(startTimeRaw) || "00:00";
  const now = kolkataNowParts_();
  if (now.ymd > startYmd) return true;
  if (now.ymd < startYmd) return false;
  return now.hm >= startHm;
}

function applyListingAutoClose_(sheet, sheetName, headers, rowIndex1Based, row) {
  const statusIx = getProgramsStatusColumnIndex_(headers);
  if (statusIx < 0) return row;
  if (isClosedStatus_(row[statusIx])) return row;
  const startDate = programStartDateFromRow_(headers, row);
  const startTime = programStartTimeFromRow_(headers, row);
  if (!isPastEventStart_(startDate, startTime)) return row;
  const closedValue = sheetName === VOLUNTEER_SHEET ? "inactive" : "Closed";
  sheet.getRange(rowIndex1Based, statusIx + 1).setValue(closedValue);
  row[statusIx] = closedValue;
  return row;
}

function rowToItem_(headers, row, id) {
  const item = {};
  headers.forEach(function (h, idx) {
    if (/time/.test(h)) item[h] = cellToHm_(row[idx]);
    else item[h] = cellToDisplay_(row[idx]);
  });
  item.id = String(id);
  return item;
}

function enrichListingDates_(item, headers, row) {
  const startRaw = programStartDateFromRow_(headers, row);
  const endRaw = programEndDateFromRow_(headers, row);
  const startYmd = toYmd_(startRaw);
  const endYmd = toYmd_(endRaw);
  if (startYmd) item.startdate = startYmd;
  if (endYmd) item.enddate = endYmd;
  item.date = formatProgramDateLabel_(startYmd || startRaw, endYmd || endRaw);

  const st1 = toHm_(item.starttime || item["start time"]) || programStartTimeFromRow_(headers, row);
  const et1 = toHm_(item.endtime || item["end time"]);
  const st2 = toHm_(item.starttime2 || item["start time 2"]);
  const et2 = toHm_(item.endtime2 || item["end time 2"]);
  const st3 = toHm_(item.starttime3 || item["start time 3"]);
  const et3 = toHm_(item.endtime3 || item["end time 3"]);

  if (!st1 && !et1 && item.timings) {
    const parsed = parseFirstSlotFromTimings_(item.timings);
    if (parsed) {
      if (parsed.start) item.starttime = parsed.start;
      if (parsed.end) item.endtime = parsed.end;
    }
  } else {
    if (st1) item.starttime = st1;
    if (et1) item.endtime = et1;
  }
  if (st2) item.starttime2 = st2;
  if (et2) item.endtime2 = et2;
  if (st3) item.starttime3 = st3;
  if (et3) item.endtime3 = et3;

  const label1 = String(item.slotlabel || item["slot label"] || "").trim();
  const label2 = String(item.slotlabel2 || item["slot label 2"] || "").trim();
  const label3 = String(item.slotlabel3 || item["slot label 3"] || "").trim();
  if (label1) item.slotlabel = label1;
  if (label2) item.slotlabel2 = label2;
  if (label3) item.slotlabel3 = label3;

  const slots = [];
  if (item.starttime && item.endtime) {
    slots.push({ label: label1, start: item.starttime, end: item.endtime });
  } else if (item.starttime) {
    slots.push({ label: label1, start: item.starttime, end: item.endtime || "" });
  }
  if (item.starttime2 && item.endtime2) {
    slots.push({ label: label2, start: item.starttime2, end: item.endtime2 });
  }
  if (item.starttime3 && item.endtime3) {
    slots.push({ label: label3, start: item.starttime3, end: item.endtime3 });
  }
  item.slots = slots;

  const lines = slots
    .map(function (slot) {
      return formatSlotLine_(slot.label, slot.start, slot.end);
    })
    .filter(Boolean);
  if (lines.length) item.timings = lines.join("\n");
  return item;
}

function adminSaveItem(data) {
  const resource = String(data.resource || "programs");
  const session =
    resource === "volunteering"
      ? requireRole_(data.token, ["admin", "nurturing"])
      : requireRole_(data.token, ["admin", "programs"]);
  const sheetName = sheetNameForResource_(resource);
  ensureSheet_(sheetName, expectedHeadersFor_(sheetName));
  const sheet = ss_().getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const item = data.item || {};
  const id = data.id ? String(data.id).trim() : "";
  let savedId = id;

  if (!id) {
    const values = headers.map(function (h) {
      const v = valueForHeader_(item, h);
      return v === undefined ? "" : v;
    });
    sheet.appendRow(values);
    savedId = String(sheet.getLastRow() - 1);
    invalidatePublicCache_(resource);
    maybeCreatePromoForListing_(resource, savedId, item, session);
    return { success: true, id: savedId };
  }

  const rowIndex = parseInt(id, 10);
  if (isNaN(rowIndex) || rowIndex < 1) throw new Error("Invalid item id.");
  const lastRow = Math.max(sheet.getLastRow(), 1);
  if (rowIndex > lastRow) throw new Error("Item not found.");
  const existing = sheet.getRange(rowIndex + 1, 1, 1, headers.length).getValues()[0];
  const values = headers.map(function (h, idx) {
    const v = valueForHeader_(item, h);
    if (v === undefined) return existing[idx];
    return v;
  });
  sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([values]);
  invalidatePublicCache_(resource);
  maybeCreatePromoForListing_(resource, savedId, item, session);
  return { success: true, id: String(rowIndex) };
}

function isClosedStatus_(raw) {
  const s = normalizeProgramStatusValue_(raw);
  return s === "closed" || s === "inactive";
}

function statusValueFromRow_(headers, row) {
  const keys = ["status", "program status", "listing status"];
  for (let i = 0; i < keys.length; i++) {
    const ix = headers.indexOf(keys[i]);
    if (ix >= 0 && row[ix] !== undefined && String(row[ix]).replace(/\u00a0/g, " ").trim() !== "") {
      return row[ix];
    }
  }
  return "";
}

function adminClearClosed(data) {
  const resource = String(data.resource || "programs");
  if (resource === "volunteering") requireRole_(data.token, ["admin", "nurturing"]);
  else requireRole_(data.token, ["admin", "programs"]);
  const sheetName = sheetNameForResource_(resource);
  if (sheetName === PROGRAMS_SHEET) {
    ensureSheet_(PROGRAMS_SHEET, PROGRAM_HEADERS);
  } else if (sheetName === VOLUNTEER_SHEET) {
    ensureSheet_(VOLUNTEER_SHEET, VOLUNTEER_HEADERS);
  }
  const sheet = ss_().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet not found.");
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) {
    invalidatePublicCache_(resource);
    return { success: true, deleted: 0 };
  }

  const headers = rows[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  if (sheetName === PROGRAMS_SHEET || sheetName === VOLUNTEER_SHEET) {
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      rows[i] = applyListingAutoClose_(sheet, sheetName, headers, i + 1, rows[i]);
    }
  }
  const sheetRowsToDelete = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    if (isClosedStatus_(statusValueFromRow_(headers, rows[i]))) {
      sheetRowsToDelete.push(i + 1);
    }
  }
  sheetRowsToDelete.sort(function (a, b) {
    return b - a;
  });
  for (let d = 0; d < sheetRowsToDelete.length; d++) {
    sheet.deleteRow(sheetRowsToDelete[d]);
  }
  invalidatePublicCache_(resource);
  return { success: true, deleted: sheetRowsToDelete.length };
}

function adminDeleteItem(data) {
  const resource = String(data.resource || "programs");
  if (resource === "volunteering") requireRole_(data.token, ["admin", "nurturing"]);
  else requireRole_(data.token, ["admin", "programs"]);
  const sheetName = sheetNameForResource_(resource);
  const sheet = ss_().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet not found.");
  const rowIndex = parseInt(data.id, 10);
  if (isNaN(rowIndex) || rowIndex < 1) throw new Error("Invalid item id.");
  sheet.deleteRow(rowIndex + 1);
  invalidatePublicCache_(resource);
  return { success: true };
}

function adminUploadImage(data) {
  requireRole_(data.token, ["admin", "programs", "promotions", "nurturing"]);
  const raw = String(data.base64 || "").replace(/\s/g, "");
  if (!raw) throw new Error("No image data.");
  const bytes = Utilities.base64Decode(raw);
  const mime = data.mimeType || "image/jpeg";
  const name = data.filename || "upload-" + new Date().getTime() + ".jpg";
  const blob = Utilities.newBlob(bytes, mime, name);
  const folder = getCentreImagesFolder_();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const id = file.getId();
  return { success: true, url: "https://drive.google.com/uc?id=" + id, fileId: id };
}

function driveIdFromUrl_(url) {
  const s = String(url || "");
  let m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : "";
}

/** Returns flyer bytes so the phone can save to gallery (avoids Drive CORS). */
function adminGetImage(data) {
  requireRole_(data.token, ["admin", "programs", "promotions"]);
  const id = driveIdFromUrl_(data.url) || String(data.fileId || "").trim();
  if (!id) throw new Error("Flyer not found.");
  const file = DriveApp.getFileById(id);
  const blob = file.getBlob();
  const mime = blob.getContentType() || "image/jpeg";
  const name = file.getName() || "flyer.jpg";
  return {
    success: true,
    base64: Utilities.base64Encode(blob.getBytes()),
    mimeType: mime,
    filename: name,
  };
}

function getCentreImagesFolder_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty("DRIVE_FOLDER_ID");
  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (e) {
      // Folder was deleted; create a new one below.
    }
  }
  const folder = DriveApp.createFolder("Isha Place Centre Images");
  props.setProperty("DRIVE_FOLDER_ID", folder.getId());
  return folder;
}

function getSiteContent() {
  const cached = cacheGetJson_(CACHE_SITE);
  if (cached && cached.content) return cached;
  const sheet = ensureSheet_(SITE_SHEET, ["key", "value"]);
  const rows = sheet.getDataRange().getValues();
  const content = {};
  Object.keys(SITE_DEFAULTS).forEach(function (k) {
    content[k] = SITE_DEFAULTS[k];
  });
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0] || "").trim();
    if (!key) continue;
    content[key] = rows[i][1] === undefined || rows[i][1] === null ? "" : String(rows[i][1]);
  }
  const payload = { content: content };
  cachePutJson_(CACHE_SITE, payload);
  return payload;
}

function adminSaveSite(data) {
  requireRole_(data.token, ["admin"]);
  const incoming = data.content || {};
  const sheet = ensureSheet_(SITE_SHEET, ["key", "value"]);
  const keys = Object.keys(SITE_DEFAULTS);
  const existing = {};
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0] || "").trim();
    if (key) existing[key] = i + 1;
  }
  keys.forEach(function (key) {
    const value = incoming[key] !== undefined ? String(incoming[key]) : "";
    if (existing[key]) {
      sheet.getRange(existing[key], 2).setValue(value);
    } else {
      sheet.appendRow([key, value]);
    }
  });
  invalidatePublicCache_("site");
  return { success: true };
}

function normalizeProgramStatusValue_(raw) {
  if (raw === undefined || raw === null) return "";
  return String(raw)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getProgramsStatusColumnIndex_(headers) {
  const ordered = ["status", "program status", "listing status"];
  for (let o = 0; o < ordered.length; o++) {
    const ix = headers.indexOf(ordered[o]);
    if (ix >= 0) return ix;
  }
  return -1;
}

function getProgramsSheetRowStatus_(headers, row) {
  const ix = getProgramsStatusColumnIndex_(headers);
  if (ix < 0) return null;
  return normalizeProgramStatusValue_(row[ix]);
}

function getAllItems(sheetName, includeHidden) {
  if (!includeHidden) {
    const cacheKey = sheetName === PROGRAMS_SHEET ? CACHE_PROGRAMS : sheetName === VOLUNTEER_SHEET ? CACHE_VOLUNTEER : "";
    if (cacheKey) {
      const cached = cacheGetJson_(cacheKey);
      if (cached && cached.items) return cached;
    }
  }

  if (sheetName === PROGRAMS_SHEET) {
    ensureSheet_(PROGRAMS_SHEET, PROGRAM_HEADERS);
  } else if (sheetName === VOLUNTEER_SHEET) {
    ensureSheet_(VOLUNTEER_SHEET, VOLUNTEER_HEADERS);
  }
  const sheet = ss_().getSheetByName(sheetName);
  if (!sheet) return { items: [] };

  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return { items: [] };

  const headers = rows[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const items = [];

  for (let i = 1; i < rows.length; i++) {
    let row = rows[i];
    if (!row[0]) continue;

    if (sheetName === PROGRAMS_SHEET || sheetName === VOLUNTEER_SHEET) {
      row = applyListingAutoClose_(sheet, sheetName, headers, i + 1, row);
    }

    if (!includeHidden) {
      if (sheetName === PROGRAMS_SHEET) {
        const stPrograms = getProgramsSheetRowStatus_(headers, row);
        if (stPrograms !== null && stPrograms !== "open") continue;
      } else {
        const statusIdx = headers.indexOf("status");
        if (statusIdx >= 0 && row[statusIdx].toString().toLowerCase() === "inactive") continue;
      }
    }

    const item = rowToItem_(headers, row, i);
    if (sheetName === PROGRAMS_SHEET || sheetName === VOLUNTEER_SHEET) {
      enrichListingDates_(item, headers, row);
    }
    items.push(item);
  }

  const payload = { items: items };
  if (!includeHidden) {
    const cacheKey = sheetName === PROGRAMS_SHEET ? CACHE_PROGRAMS : sheetName === VOLUNTEER_SHEET ? CACHE_VOLUNTEER : "";
    if (cacheKey) cachePutJson_(cacheKey, payload);
  }
  return payload;
}

function getSingleItem(sheetName, id, includeHidden) {
  if (sheetName === PROGRAMS_SHEET) {
    ensureSheet_(PROGRAMS_SHEET, PROGRAM_HEADERS);
  } else if (sheetName === VOLUNTEER_SHEET) {
    ensureSheet_(VOLUNTEER_SHEET, VOLUNTEER_HEADERS);
  }
  const sheet = ss_().getSheetByName(sheetName);
  if (!sheet) return { item: null };

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const rowIndex = parseInt(id, 10);

  if (rowIndex < 1 || rowIndex >= rows.length) return { item: null };

  let row = rows[rowIndex];
  if (sheetName === PROGRAMS_SHEET || sheetName === VOLUNTEER_SHEET) {
    row = applyListingAutoClose_(sheet, sheetName, headers, rowIndex + 1, row);
  }

  const item = rowToItem_(headers, row, id);
  if (sheetName === PROGRAMS_SHEET || sheetName === VOLUNTEER_SHEET) {
    enrichListingDates_(item, headers, row);
  }

  if (!includeHidden && sheetName === PROGRAMS_SHEET) {
    const st = getProgramsSheetRowStatus_(headers, row);
    if (st !== null && st !== "open") return { item: null };
  }
  if (!includeHidden && sheetName === VOLUNTEER_SHEET) {
    const statusIdx = headers.indexOf("status");
    if (statusIdx >= 0 && String(row[statusIdx]).toLowerCase() === "inactive") return { item: null };
  }

  return { item: item };
}

function ensureSheet_(name, headers) {
  const ss = ss_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#c8a96e");
    ENSURED_[name] = true;
    return sheet;
  }
  if (ENSURED_[name]) return sheet;

  const existingHeaderRow = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
  const existingHeaders = existingHeaderRow.map(function (h) {
    return h.toString().trim();
  });
  const existingNorm = existingHeaders.map(function (h) {
    return h.toLowerCase();
  });
  const missing = (headers || []).filter(function (h) {
    return existingNorm.indexOf(h.toString().trim().toLowerCase()) === -1;
  });

  if (missing.length > 0) {
    const startCol =
      existingHeaders.filter(function (h) {
        return h !== "";
      }).length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight("bold").setBackground("#c8a96e");
  }
  ENSURED_[name] = true;
  return sheet;
}

const INQUIRY_DEFS = [
  {
    key: "homeQueries",
    sheet: HOME_QUERIES_SHEET,
    title: "Home queries",
    headers: ["Timestamp", "Name", "WhatsApp", "Area", "Query", "Status", "Remarks"],
  },
  {
    key: "programInterest",
    sheet: PROGRAM_INTEREST_SHEET,
    title: "Program interest",
    headers: [
      "Timestamp",
      "Name",
      "WhatsApp",
      "Area",
      "Program Name",
      "Program ID",
      "Search Keyword",
      "Status",
      "Remarks",
    ],
  },
  {
    key: "programVolunteer",
    sheet: PROGRAM_VOLUNTEER_SHEET,
    title: "Program volunteer",
    headers: ["Timestamp", "Name", "WhatsApp", "Area", "Program Name", "Program ID", "Status", "Remarks"],
  },
  {
    key: "volunteeringInterest",
    sheet: VOLUNTEERING_INTEREST_SHEET,
    title: "Volunteering interest",
    headers: [
      "Timestamp",
      "Name",
      "WhatsApp",
      "Area",
      "Opportunity Name",
      "Opportunity ID",
      "Status",
      "Remarks",
    ],
  },
];

function inquiryStatusLabel_(raw) {
  const s = String(raw || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();
  if (s === "resolved" || s === "closed" || s === "done" || s === "inactive") return "Resolved";
  return "Open";
}

function parseInquiryItems_(def, rows) {
  const items = [];
  if (!rows || rows.length < 2) return items;
  const headers = rows[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const hasValue = row.some(function (cell) {
      return String(cell || "").trim() !== "";
    });
    if (!hasValue) continue;
    const item = { id: String(i), sheet: def.key };
    headers.forEach(function (h, idx) {
      item[h] = row[idx] === undefined || row[idx] === null ? "" : String(row[idx]).trim();
    });
    item.status = inquiryStatusLabel_(item.status);
    items.push(item);
  }
  items.reverse();
  return items;
}

function inquiryPreviewFromRow_(headers, row) {
  const map = {};
  headers.forEach(function (h, idx) {
    map[h] = row[idx] === undefined || row[idx] === null ? "" : String(row[idx]).trim();
  });
  return map.query || map["program name"] || map["opportunity name"] || map.area || "";
}

function latestInquiryFromSheet_(sheet, lastRow, lastCol, headers) {
  const lookback = Math.min(8, lastRow - 1);
  if (lookback < 1) return null;
  const startRow = lastRow - lookback + 1;
  const values = sheet.getRange(startRow, 1, lookback, lastCol).getValues();
  const nameIx = headers.indexOf("name");
  const tsIx = headers.indexOf("timestamp");
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    const hasValue = row.some(function (cell) {
      return String(cell || "").trim() !== "";
    });
    if (!hasValue) continue;
    return {
      id: String(startRow + i - 1),
      name: nameIx >= 0 ? String(row[nameIx] || "").trim() : "",
      preview: inquiryPreviewFromRow_(headers, row),
      timestamp: tsIx >= 0 ? String(row[tsIx] || "").trim() : "",
    };
  }
  return null;
}

/** Lightweight tab badges: open/total only (no full item payloads). */
function getInquiryMeta_() {
  const groups = INQUIRY_DEFS.map(function (def) {
    const sheet = ensureSheet_(def.sheet, def.headers);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn() || 1;
    if (lastRow < 2) {
      return {
        key: def.key,
        title: def.title,
        openCount: 0,
        total: 0,
        latest: null,
        items: [],
        loaded: false,
      };
    }
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
      return h.toString().trim().toLowerCase();
    });
    const statusIx = headers.indexOf("status");
    const nameIx = headers.indexOf("name");
    const probeIx = nameIx >= 0 ? nameIx : 0;
    const probe = sheet.getRange(2, probeIx + 1, lastRow, probeIx + 1).getValues();
    const statuses =
      statusIx >= 0 ? sheet.getRange(2, statusIx + 1, lastRow, statusIx + 1).getValues() : null;
    let open = 0;
    let total = 0;
    for (let i = 0; i < probe.length; i++) {
      const hasName = String(probe[i][0] || "").trim() !== "";
      const stRaw = statuses ? statuses[i][0] : "";
      if (!hasName && String(stRaw || "").trim() === "") continue;
      total++;
      if (inquiryStatusLabel_(stRaw) !== "Resolved") open++;
    }
    return {
      key: def.key,
      title: def.title,
      openCount: open,
      total: total,
      latest: latestInquiryFromSheet_(sheet, lastRow, lastCol, headers),
      items: [],
      loaded: false,
    };
  });
  const stamp = groups
    .map(function (g) {
      return g.key + ":" + (g.total || 0);
    })
    .join("|");
  const total = groups.reduce(function (sum, g) {
    return sum + (g.total || 0);
  }, 0);
  return { groups: groups, stamp: stamp, total: total };
}

/** Full items for one inquiry type. */
function getInquiryGroup_(key) {
  const def = inquiryDefByKey_(key);
  if (!def) throw new Error("Unknown inquiry type.");
  const sheet = ensureSheet_(def.sheet, def.headers);
  const lastRow = sheet.getLastRow();
  const rows = lastRow < 1 ? [] : sheet.getRange(1, 1, lastRow, sheet.getLastColumn() || 1).getValues();
  const items = parseInquiryItems_(def, rows);
  const openCount = items.filter(function (it) {
    return it.status !== "Resolved";
  }).length;
  return {
    group: {
      key: def.key,
      title: def.title,
      items: items,
      openCount: openCount,
      total: items.length,
      loaded: true,
    },
  };
}

function getAllInquiries_() {
  const groups = INQUIRY_DEFS.map(function (def) {
    const sheet = ensureSheet_(def.sheet, def.headers);
    const lastRow = sheet.getLastRow();
    const rows = lastRow < 1 ? [] : sheet.getRange(1, 1, lastRow, sheet.getLastColumn() || 1).getValues();
    const items = parseInquiryItems_(def, rows);
    return {
      key: def.key,
      title: def.title,
      items: items,
      openCount: items.filter(function (it) {
        return it.status !== "Resolved";
      }).length,
      total: items.length,
      loaded: true,
    };
  });
  return { groups: groups };
}

function inquiryDefByKey_(key) {
  for (let i = 0; i < INQUIRY_DEFS.length; i++) {
    if (INQUIRY_DEFS[i].key === key) return INQUIRY_DEFS[i];
  }
  return null;
}

function adminUpdateInquiry(data) {
  requireRole_(data.token, ["admin", "nurturing"]);
  const def = inquiryDefByKey_(data.sheet);
  if (!def) throw new Error("Unknown inquiry type.");
  const sheet = ensureSheet_(def.sheet, def.headers);
  const rowIndex = parseInt(data.id, 10);
  if (isNaN(rowIndex) || rowIndex < 1) throw new Error("Invalid inquiry id.");
  const lastCol = sheet.getLastColumn() || 1;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const statusIx = headers.indexOf("status");
  const remarksIx = headers.indexOf("remarks");
  if (statusIx < 0 || remarksIx < 0) throw new Error("Status/Remarks columns missing. Save the updated Apps Script and try again.");
  const status = inquiryStatusLabel_(data.status);
  const remarks = data.remarks === undefined || data.remarks === null ? "" : String(data.remarks);
  const row = sheet.getRange(rowIndex + 1, 1, 1, headers.length).getValues()[0];
  row[statusIx] = status;
  row[remarksIx] = remarks;
  sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([row]);
  return { success: true, status: status };
}

function saveHomeQuery(data) {
  const sheet = ensureSheet_(HOME_QUERIES_SHEET, [
    "Timestamp",
    "Name",
    "WhatsApp",
    "Area",
    "Query",
    "Status",
    "Remarks",
  ]);
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.name || "",
    data.phone || "",
    data.area || "",
    data.query || "",
    "Open",
    "",
  ]);
}

function saveProgramInterest(data) {
  const sheet = ensureSheet_(PROGRAM_INTEREST_SHEET, [
    "Timestamp",
    "Name",
    "WhatsApp",
    "Area",
    "Program Name",
    "Program ID",
    "Search Keyword",
    "Status",
    "Remarks",
  ]);
  const searchKw = (data.searchKeyword && String(data.searchKeyword).trim()) || "";
  const programName = (data.programName && String(data.programName).trim()) || searchKw || "";
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.name || "",
    data.phone || "",
    data.area || "",
    programName,
    data.programId || "",
    searchKw,
    "Open",
    "",
  ]);
}

function saveProgramVolunteer(data) {
  const sheet = ensureSheet_(PROGRAM_VOLUNTEER_SHEET, [
    "Timestamp",
    "Name",
    "WhatsApp",
    "Area",
    "Program Name",
    "Program ID",
    "Status",
    "Remarks",
  ]);
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.name || "",
    data.phone || "",
    data.area || "",
    (data.programName && String(data.programName).trim()) || "",
    data.programId || "",
    "Open",
    "",
  ]);
}

function saveVolunteeringInterest(data) {
  const sheet = ensureSheet_(VOLUNTEERING_INTEREST_SHEET, [
    "Timestamp",
    "Name",
    "WhatsApp",
    "Area",
    "Opportunity Name",
    "Opportunity ID",
    "Status",
    "Remarks",
  ]);
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.name || "",
    data.phone || "",
    data.area || "",
    data.opportunityName || "",
    data.opportunityId || "",
    "Open",
    "",
  ]);
}

function usersSheet_() {
  return ensureSheet_(USERS_SHEET, USER_HEADERS);
}

function userFromRow_(headers, row) {
  const user = {};
  headers.forEach(function (h, idx) {
    user[h] = row[idx] === undefined || row[idx] === null ? "" : String(row[idx]).trim();
  });
  return user;
}

function publicUser_(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    role: user.role,
    status: user.status || "active",
    createdAt: user.created_at || "",
  };
}

function loadUsers_() {
  const sheet = usersSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn() || 1;
  if (lastRow < 2) return { sheet: sheet, headers: USER_HEADERS.slice(), users: [] };
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const rows = sheet.getRange(2, 1, lastRow, lastCol).getValues();
  const users = [];
  for (let i = 0; i < rows.length; i++) {
    const user = userFromRow_(headers, rows[i]);
    if (!user.id && !user.username) continue;
    user._row = i + 2;
    users.push(user);
  }
  return { sheet: sheet, headers: headers, users: users };
}

function findUserByUsername_(username) {
  const wanted = normalizeUsername_(username);
  if (!wanted) return null;
  const loaded = loadUsers_();
  for (let i = 0; i < loaded.users.length; i++) {
    if (normalizeUsername_(loaded.users[i].username) === wanted) return loaded.users[i];
  }
  return null;
}

function findUserById_(id) {
  const wanted = String(id || "").trim();
  if (!wanted) return null;
  const loaded = loadUsers_();
  for (let i = 0; i < loaded.users.length; i++) {
    if (String(loaded.users[i].id) === wanted) return loaded.users[i];
  }
  return null;
}

function writeUserRow_(sheet, headers, rowIndex, user) {
  const values = headers.map(function (h) {
    if (user[h] === undefined || user[h] === null) return "";
    return String(user[h]);
  });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([values]);
}

function setUserPasswordFields_(user, password) {
  const salt = newSalt_();
  user.password_salt = salt;
  user.password_hash = hashPassword_(password, salt);
}

function upsertAdminUser_(password) {
  const pw = String(password || "").trim();
  if (!pw || pw === "REPLACE_ME") return;
  const loaded = loadUsers_();
  let existing = null;
  for (let i = 0; i < loaded.users.length; i++) {
    if (normalizeUsername_(loaded.users[i].username) === "admin") {
      existing = loaded.users[i];
      break;
    }
  }
  if (existing) {
    setUserPasswordFields_(existing, pw);
    existing.status = "active";
    existing.role = "admin";
    if (!existing.display_name) existing.display_name = "Admin";
    writeUserRow_(loaded.sheet, loaded.headers, existing._row, existing);
    return;
  }
  const user = {
    id: Utilities.getUuid(),
    username: "admin",
    display_name: "Admin",
    role: "admin",
    status: "active",
    created_at: nowIsoKolkata_(),
  };
  setUserPasswordFields_(user, pw);
  const values = loaded.headers.map(function (h) {
    return user[h] || "";
  });
  loaded.sheet.appendRow(values);
}

function bootstrapAdminUser_(password) {
  usersSheet_();
  if (loadUsers_().users.length > 0) return;
  upsertAdminUser_(password);
}

function listUsersPublic_() {
  return loadUsers_().users.map(publicUser_);
}

function countActiveAdmins_(users, exceptId) {
  let n = 0;
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    if (exceptId && String(u.id) === String(exceptId)) continue;
    if (u.role === "admin" && String(u.status || "").toLowerCase() === "active") n++;
  }
  return n;
}

function uniqueUsernameFor_(base, users) {
  const root = normalizeUsername_(base) || "user";
  const taken = {};
  for (let i = 0; i < (users || []).length; i++) {
    taken[normalizeUsername_(users[i].username)] = true;
  }
  if (!taken[root]) return root;
  let n = 2;
  while (taken[root + String(n)]) n++;
  return root + String(n);
}

function adminSaveUser(data) {
  const session = requireRole_(data.token, ["admin"]);
  const loaded = loadUsers_();
  const id = String(data.id || "").trim();
  const role = normalizeRole_(data.role);
  const displayName = String(data.displayName || data.display_name || "").trim();
  const password = String(data.password || "");

  if (id) {
    const user = findUserById_(id);
    if (!user) throw new Error("Person not found.");
    if (role) {
      if (user.role === "admin" && role !== "admin" && countActiveAdmins_(loaded.users, user.id) < 1) {
        throw new Error("Keep at least one active admin.");
      }
      if (String(user.id) === String(session.id) && role !== "admin") {
        throw new Error("You cannot change your own role.");
      }
      user.role = role;
    }
    if (displayName) user.display_name = displayName;
    if (password) {
      if (password.length < 6) throw new Error("Password must be at least 6 characters.");
      setUserPasswordFields_(user, password);
    }
    writeUserRow_(loaded.sheet, loaded.headers, user._row, user);
    return { success: true, user: publicUser_(user) };
  }

  if (!role) throw new Error("Choose a team.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  const username = uniqueUsernameFor_(displayName || role, loaded.users);
  const user = {
    id: Utilities.getUuid(),
    username: username,
    display_name: displayName || role,
    role: role,
    status: "active",
    created_at: nowIsoKolkata_(),
  };
  setUserPasswordFields_(user, password);
  const values = loaded.headers.map(function (h) {
    return user[h] || "";
  });
  loaded.sheet.appendRow(values);
  return { success: true, user: publicUser_(user) };
}

function adminSetUserStatus(data) {
  const session = requireRole_(data.token, ["admin"]);
  const loaded = loadUsers_();
  const user = findUserById_(data.id);
  if (!user) throw new Error("Person not found.");
  const status = String(data.status || "").trim().toLowerCase() === "disabled" ? "disabled" : "active";
  if (String(user.id) === String(session.id) && status === "disabled") {
    throw new Error("You cannot disable your own account.");
  }
  if (user.role === "admin" && status === "disabled" && countActiveAdmins_(loaded.users, user.id) < 1) {
    throw new Error("Keep at least one active admin.");
  }
  user.status = status;
  writeUserRow_(loaded.sheet, loaded.headers, user._row, user);
  SpreadsheetApp.flush();
  if (status === "disabled") markUserDisabled_(user.id);
  else clearUserDisabled_(user.id);
  return { success: true, user: publicUser_(user) };
}

function promoSheet_() {
  return ensureSheet_(PROMOTIONS_SHEET, PROMO_HEADERS);
}

function promoFromRow_(headers, row) {
  const item = {};
  headers.forEach(function (h, idx) {
    let value = row[idx];
    if (h === "send_at" || h === "updated_at" || h === "sent_at" || h === "created_at") {
      if (value instanceof Date && !isNaN(value.getTime())) {
        value = Utilities.formatDate(value, PROGRAM_TZ_, "yyyy-MM-dd HH:mm");
      }
    }
    item[h] = value === undefined || value === null ? "" : String(value).trim();
  });
  return item;
}

function sendAtKey_(raw) {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return Utilities.formatDate(raw, PROGRAM_TZ_, "yyyy-MM-dd HH:mm");
  }
  const s = String(raw || "")
    .replace("T", " ")
    .replace(/\u00a0/g, " ")
    .trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
  if (!m) return "";
  const hh = ("0" + Math.min(23, parseInt(m[2], 10))).slice(-2);
  return m[1] + " " + hh + ":" + m[3];
}

function isSendDue_(sendAt) {
  const key = sendAtKey_(sendAt);
  if (!key) return false;
  const now = kolkataNowParts_();
  return key <= now.ymd + " " + now.hm;
}

function isOpenListingStatus_(raw) {
  const s = normalizeProgramStatusValue_(raw);
  if (!s) return true;
  return s === "open" || s === "active";
}

function normalizePromoStatus_(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (s === "needs_copy" || s === "pending") return "pending";
  if (s === "ready" || s === "due" || s === "sent") return s;
  return "pending";
}

function listingMapForPromos_() {
  const map = {};
  ["programs", "volunteering"].forEach(function (resource) {
    const sheetName = resource === "programs" ? PROGRAMS_SHEET : VOLUNTEER_SHEET;
    const payload = getAllItems(sheetName, true);
    (payload.items || []).forEach(function (item) {
      map[resource + ":" + String(item.id)] = item;
    });
  });
  return map;
}

function listingImage_(listing) {
  if (!listing) return "";
  return String(listing.image || "").trim();
}

function promoFlyerSource_(item, listingMap) {
  const own = String(item.flyer_url || "").trim();
  if (own) return own;
  if (String(item.event_image || "").trim()) return String(item.event_image).trim();
  if (!listingMap) return "";
  const key = String(item.event_type || "") + ":" + String(item.event_id || "");
  return listingImage_(listingMap[key]);
}

function sendAtDayKey_(sendAt) {
  const key = sendAtKey_(sendAt);
  return key ? key.slice(0, 10) : "";
}

/** Max scheduled (non-sent) promotions per Kolkata calendar day. */
var MAX_PROMOS_PER_DAY_ = 4;

function countPromosOnDay_(items, ymd, excludeId) {
  const day = String(ymd || "").trim();
  if (!day) return 0;
  let n = 0;
  (items || []).forEach(function (item) {
    if (excludeId && String(item.id) === String(excludeId)) return;
    if (normalizePromoStatus_(item.status) === "sent") return;
    if (sendAtDayKey_(item.send_at) === day) n++;
  });
  return n;
}

function enrichPromo_(item, listingMap) {
  const key = String(item.event_type || "") + ":" + String(item.event_id || "");
  const listing = listingMap ? listingMap[key] : null;
  if (listing) {
    item.event_title = listing.title || item.event_title;
    item.event_date =
      listing.date ||
      listing.startdate ||
      listing["start date"] ||
      "";
    item.event_location = listing.location || "";
    item.event_status = listing.status || "";
    item.event_open = isOpenListingStatus_(listing.status);
    item.event_image = listingImage_(listing);
  } else {
    item.event_date = item.event_date || "";
    item.event_location = item.event_location || "";
    item.event_status = item.event_status || "";
    item.event_open = false;
    item.event_image = item.event_image || "";
  }
  item.send_at = sendAtKey_(item.send_at);
  if (normalizePromoStatus_(item.status) === "sent") {
    item.status = "sent";
  } else {
    const forStatus = {
      message: item.message,
      flyer_url: promoFlyerSource_(item, listingMap),
      send_at: item.send_at,
      status: item.status,
    };
    item.status = promoReadyStatus_(forStatus);
  }
  return item;
}

function loadPromos_() {
  const sheet = promoSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn() || 1, PROMO_HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  if (lastRow < 2) return { sheet: sheet, headers: headers, items: [] };
  const rows = sheet.getRange(2, 1, lastRow, lastCol).getValues();
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const item = promoFromRow_(headers, rows[i]);
    if (!item.id) continue;
    item._row = i + 2;
    items.push(item);
  }
  return { sheet: sheet, headers: headers, items: items };
}

function writePromoRow_(sheet, headers, rowIndex, item) {
  const values = headers.map(function (h) {
    if (h === "_row") return "";
    if (item[h] === undefined || item[h] === null) return "";
    return String(item[h]);
  });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([values]);
}

function applyDuePromotions_() {
  const loaded = loadPromos_();
  const listingMap = listingMapForPromos_();
  let changed = 0;
  loaded.items.forEach(function (item) {
    if (normalizePromoStatus_(item.status) === "sent") return;
    const forStatus = {
      message: item.message,
      flyer_url: promoFlyerSource_(item, listingMap),
      send_at: item.send_at,
      status: item.status,
    };
    const next = promoReadyStatus_(forStatus);
    if (next === normalizePromoStatus_(item.status)) return;
    item.status = next;
    item.updated_at = nowIsoKolkata_();
    writePromoRow_(loaded.sheet, loaded.headers, item._row, item);
    changed++;
  });
  return changed;
}

function markDuePromotions() {
  applyDuePromotions_();
}

function ensureDuePromoTrigger_() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "markDuePromotions") return;
    }
    ScriptApp.newTrigger("markDuePromotions").timeBased().everyMinutes(10).create();
  } catch (err) {
    Logger.log("Could not create due-promotions trigger: " + err.message);
  }
}

function promoCounts_(items) {
  const counts = { pending: 0, ready: 0, due: 0, sent: 0, needs_copy: 0 };
  (items || []).forEach(function (item) {
    const status = normalizePromoStatus_(item.status);
    if (counts[status] !== undefined) counts[status]++;
  });
  counts.needs_copy = counts.pending;
  return counts;
}

function listPromotions_(opts) {
  applyDuePromotions_();
  const loaded = loadPromos_();
  const listingMap = listingMapForPromos_();
  const items = loaded.items.map(function (item) {
    return enrichPromo_(item, listingMap);
  });
  items.sort(function (a, b) {
    const order = { due: 0, pending: 1, ready: 2, sent: 3 };
    const da = order[a.status] != null ? order[a.status] : 9;
    const db = order[b.status] != null ? order[b.status] : 9;
    if (da !== db) return da - db;
    return String(b.send_at || "").localeCompare(String(a.send_at || ""));
  });
  const dueItems = items.filter(function (item) {
    return item.status === "due";
  });
  const stamp = dueItems
    .map(function (item) {
      return item.id;
    })
    .sort()
    .join("|");
  if (opts && opts.dueOnly) {
    return { items: dueItems, due: dueItems, counts: promoCounts_(items), stamp: stamp };
  }
  return { items: items, due: dueItems, counts: promoCounts_(items), stamp: stamp };
}

function findPromoByEvent_(eventType, eventId) {
  const wantedType = String(eventType || "").trim();
  const wantedId = String(eventId || "").trim();
  const loaded = loadPromos_();
  for (let i = 0; i < loaded.items.length; i++) {
    const item = loaded.items[i];
    if (String(item.event_type) === wantedType && String(item.event_id) === wantedId) return item;
  }
  return null;
}

function appendPromo_(fields) {
  const loaded = loadPromos_();
  const item = {
    id: Utilities.getUuid(),
    event_type: fields.event_type || "programs",
    event_id: String(fields.event_id || ""),
    event_title: fields.event_title || "",
    message: fields.message || "",
    flyer_url: fields.flyer_url || "",
    send_at: sendAtKey_(fields.send_at),
    status: fields.status || "pending",
    created_by: fields.created_by || "",
    updated_at: nowIsoKolkata_(),
    sent_at: "",
    sent_by: "",
  };
  item.status = promoReadyStatus_(item);
  const values = loaded.headers.map(function (h) {
    return item[h] || "";
  });
  loaded.sheet.appendRow(values);
  return item;
}

function maybeCreatePromoForListing_(resource, eventId, item, session) {
  const eventType = resource === "volunteering" ? "volunteering" : "programs";
  const status = item && item.status;
  if (!isOpenListingStatus_(status)) return;
  if (findPromoByEvent_(eventType, eventId)) return;
  appendPromo_({
    event_type: eventType,
    event_id: eventId,
    event_title: (item && item.title) || "",
    flyer_url: listingImage_(item),
    created_by: session && session.username ? session.username : "",
    status: "pending",
  });
}

function findPromoById_(id) {
  const wanted = String(id || "").trim();
  if (!wanted) return null;
  const loaded = loadPromos_();
  for (let i = 0; i < loaded.items.length; i++) {
    if (String(loaded.items[i].id) === wanted) return loaded.items[i];
  }
  return null;
}

/**
 * Status rules:
 * - sent stays sent
 * - message + flyer + send_at due → due
 * - message + flyer → ready (send_at optional / future)
 * - else → pending
 */
function promoReadyStatus_(item) {
  if (normalizePromoStatus_(item.status) === "sent") return "sent";
  const hasCopy = String(item.message || "").trim();
  const hasFlyer = String(item.flyer_url || "").trim();
  if (hasCopy && hasFlyer) {
    if (sendAtKey_(item.send_at) && isSendDue_(item.send_at)) return "due";
    return "ready";
  }
  return "pending";
}

function adminSavePromotion(data) {
  const session = requireRole_(data.token, ["admin", "promotions"]);
  const loaded = loadPromos_();
  const item = findPromoById_(data.id);
  if (!item) throw new Error("Promotion not found.");
  const listingMap = listingMapForPromos_();
  if (data.message !== undefined) item.message = String(data.message || "");
  if (data.flyer_url !== undefined) item.flyer_url = String(data.flyer_url || "");
  if (!String(item.flyer_url || "").trim()) {
    item.flyer_url = promoFlyerSource_(item, listingMap);
  }
  if (data.send_at !== undefined) {
    const nextSend = sendAtKey_(data.send_at);
    const nextDay = sendAtDayKey_(nextSend);
    if (nextDay) {
      const used = countPromosOnDay_(loaded.items, nextDay, item.id);
      if (used >= MAX_PROMOS_PER_DAY_) {
        throw new Error("Only " + MAX_PROMOS_PER_DAY_ + " posts can be scheduled on one day.");
      }
    }
    item.send_at = nextSend;
  }

  if (data.clear_sent) {
    item.sent_at = "";
    item.sent_by = "";
    item.status = promoReadyStatus_({
      message: item.message,
      flyer_url: item.flyer_url,
      send_at: item.send_at,
      status: "ready",
    });
  } else {
    item.status = promoReadyStatus_({
      message: item.message,
      flyer_url: item.flyer_url,
      send_at: item.send_at,
      status: item.status,
    });
  }
  item.updated_at = nowIsoKolkata_();
  writePromoRow_(loaded.sheet, loaded.headers, item._row, item);
  return { success: true, item: enrichPromo_(item, listingMap) };
}

function adminAddPromotion(data) {
  const session = requireRole_(data.token, ["admin", "promotions"]);
  const eventType = data.event_type === "volunteering" ? "volunteering" : "programs";
  const eventId = String(data.event_id || "").trim();
  if (!eventId) throw new Error("Choose an event.");
  const sheetName = eventType === "volunteering" ? VOLUNTEER_SHEET : PROGRAMS_SHEET;
  const listing = getSingleItem(sheetName, eventId, true);
  const listingItem = listing && listing.item ? listing.item : null;
  const title = (listingItem && listingItem.title) || data.event_title || "";
  const item = appendPromo_({
    event_type: eventType,
    event_id: eventId,
    event_title: title,
    flyer_url: listingImage_(listingItem),
    created_by: session.username,
    status: "pending",
  });
  return { success: true, item: enrichPromo_(item, listingMapForPromos_()) };
}

function adminMarkPromotionSent(data) {
  const session = requireRole_(data.token, ["admin", "promotions"]);
  const loaded = loadPromos_();
  const item = findPromoById_(data.id);
  if (!item) throw new Error("Promotion not found.");
  item.status = "sent";
  item.sent_at = nowIsoKolkata_();
  item.sent_by = session.username;
  item.updated_at = item.sent_at;
  writePromoRow_(loaded.sheet, loaded.headers, item._row, item);
  const listingMap = listingMapForPromos_();
  return { success: true, item: enrichPromo_(item, listingMap) };
}

function adminUnmarkPromotionSent(data) {
  requireRole_(data.token, ["admin", "promotions"]);
  const loaded = loadPromos_();
  const item = findPromoById_(data.id);
  if (!item) throw new Error("Promotion not found.");
  item.sent_at = "";
  item.sent_by = "";
  item.status = promoReadyStatus_({
    message: item.message,
    flyer_url: item.flyer_url,
    send_at: item.send_at,
    status: "ready",
  });
  item.updated_at = nowIsoKolkata_();
  writePromoRow_(loaded.sheet, loaded.headers, item._row, item);
  return { success: true, item: enrichPromo_(item, listingMapForPromos_()) };
}

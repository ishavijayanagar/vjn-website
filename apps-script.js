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
const VOLUNTEER_ATTENDANCE_SHEET = "VolunteerAttendance";

// Nurturing's event-volunteer pipeline. One sheet, "kind" column:
//   kind="need"      one per program that asked for volunteers (handling state)
//   kind="volunteer" one per recruited person (attendance + WhatsApp-group flags)
const EVENT_VOLUNTEERS_SHEET = "EventVolunteers";

// ── Form templates ────────────────────────────────────────────────────────────
// Each entry is a "master" Google Form that gets copied per program run.
// Only the `slotQuestion` checkbox question is updated with the current slots.
// masterFormId: the form ID from the edit URL .../forms/d/{ID}/edit
// slotQuestion: exact title of the checkbox question whose choices get replaced.
// Add more templates here as your program types grow.
const FORM_TEMPLATES = [
  {
    id: "ie-kannada",
    name: "Inner Engineering",
    type: "single-program",   // 1 form = 1 program; textarea = time slots
    masterFormId: "1t9ZIDZtlRqsrTupaLaB5asQJAbyfMjlW93pjx3mYGQQ",
    slotQuestion: "How would you like to volunteer?",
    slotPlaceholder: "Hall setup - Tuesday, 4th Jan 2026 (7 AM - 8 AM)\nClass Volunteering Morning - Wed-Sat (5:00 AM to 9:30 AM)\nClass Volunteering Evening - Wed-Sat (5:00 PM to 9:30 PM)",
  },
  {
    id: "hatha-yoga",
    name: "Hatha Yoga",
    type: "multi-program",    // 1 form = N programs; checkboxes = individual programs
    masterFormId: "1Lr5VRKAHY3aUOnNVfRLfavbjO3vNZeWg5epJwbCMBko",
    slotQuestion: "I would like to volunteer for",
    slotPlaceholder: "",      // not used; program list comes from the app
    // Drive file ID of the header image to insert at the top of each generated form.
    // Get it from the Drive URL: drive.google.com/file/d/FILE_ID/view
    // Leave empty to skip (image can be added manually via Customize Theme in Forms editor).
    headerImageDriveId: "",
  },
  // Add more templates here as needed
];
const EV_HEADERS = [
  "row_id",
  "kind",
  "event_id",
  "event_title",
  "event_date",
  "needed",
  "handled",
  "handled_remarks",
  "handled_by",
  "handled_at",
  "reminded_at",
  "volunteer_name",
  "phone",
  "volunteer_remarks",
  "area_of_stay",
  "ie_completion",
  "added_by",
  "attended",
  "in_wa_group",
  "invite_sent",
  "attendance_at",
  // need-row form fields (blank for volunteer rows)
  "volunteer_form_id",
  "volunteer_form_short_url",
  "volunteer_form_fields",
  "volunteer_form_template",
  "updated_at",
];

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
  "target",
  "wa_schedule_ids",
];

const VALID_ROLES_ = ["admin", "programs", "promotions", "nurturing"];

// Fixed list of program names the Programs team can pick from — keeps flyer
// matching reliable (a flyer is tied to one or more program_title values in FlyerTemplates).
const PROGRAM_TITLES_SHEET = "ProgramTitles";
const PROGRAM_TITLE_HEADERS = ["title", "active"];

// One row per flyer design. Each flyer is its own single-slide Google Slides
// file (slide_id), sized to match that shape — Slides applies one page size
// to a whole file, so flyers with a different aspect ratio need their own
// file. Same-shaped flyers can share one file: put each on its own slide and
// set slide_index (1 = first slide, 2 = second, ...). Leave slide_index blank
// for a single-slide file.
// program_title: one program name, or a JSON array of names when the flyer
// applies to several programs, e.g. ["Inner Engineering","Inner Engineering - 4 Days"].
// fields_json lists the {{placeholder}} fields that flyer needs, e.g.
// [{"key":"date","label":"Event date"},{"key":"time","label":"Event time"},{"key":"link","label":"Registration link"}]
const FLYER_TEMPLATES_SHEET = "FlyerTemplates";
const FLYER_TEMPLATE_HEADERS = [
  "template_id",
  "program_title",
  "label",
  "thumbnail_url",
  "slide_id",
  "slide_index",
  "fields_json",
  "active",
];

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
  "flyer_image",
  "registerlink",
  "free_offering",
  "volunteering_available",
  "volunteers_needed",
  "volunteer_requirements",
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
  // Homepage promo popup (managed in admin > Banner). banner_until is an ISO timestamp.
  banner_enabled: "",
  banner_image: "",
  banner_link: "",
  banner_until: "",
  banner_text: "",
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
  ensureSheet_(EVENT_VOLUNTEERS_SHEET, EV_HEADERS);
  ensureDuePromoTrigger_();
  ensureAttendanceTrigger_();
  ensureProgramReminderTrigger_();
  const folder = getCentreImagesFolder_();
  Logger.log("Setup complete. Sign in at /admin.html: choose Admin, then the existing admin password.");
  Logger.log("Drive folder: " + folder.getName() + " (" + folder.getUrl() + ")");
}

/**
 * Run this once (function dropdown → authorizeFlyerFeature → Run) after
 * adding the flyer feature, so Google prompts for the extra Slides
 * permission it needs. Deploying a new version does not trigger that
 * prompt by itself — only an interactive Run in the editor does. Safe to
 * delete this function afterward; it cleans up its own test file.
 */
function authorizeFlyerFeature() {
  const test = SlidesApp.create("VJN flyer auth test - delete me");
  Logger.log("Slides access works. Deleting the test file: " + test.getUrl());
  DriveApp.getFileById(test.getId()).setTrashed(true);
}

/**
 * Debug helper: runs the same steps generateFlyerThumbnail_ does for one
 * FlyerTemplates row, but WITHOUT swallowing errors, so the real failure
 * shows up in the Execution log. Edit the template_id below if needed. Safe
 * to delete once the flyer feature is working.
 */
/**
 * Clears cached flyer thumbnails so the next gallery load re-renders each
 * slide_index correctly. Run once from the Apps Script editor after fixing
 * export, or after redesigning slides. Safe to keep.
 */
function refreshAllFlyerThumbnails() {
  ensureSheet_(FLYER_TEMPLATES_SHEET, FLYER_TEMPLATE_HEADERS);
  const sheet = ss_().getSheetByName(FLYER_TEMPLATES_SHEET);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) {
    Logger.log("No flyer templates.");
    return;
  }
  const headers = rows[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const thumbCol = headers.indexOf("thumbnail_url");
  if (thumbCol < 0) throw new Error("thumbnail_url column missing.");
  let refreshed = 0;
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const item = rowToItem_(headers, rows[i], i);
    if (/^no$/i.test(String(item.active || "yes"))) continue;
    sheet.getRange(i + 1, thumbCol + 1).setValue("");
    const url = generateFlyerThumbnail_({
      slide_id: item.slide_id,
      slide_index: item.slide_index,
      label: item.label,
    });
    if (url) {
      sheet.getRange(i + 1, thumbCol + 1).setValue(url);
      refreshed++;
      Logger.log(item.template_id + " → slide " + normalizeFlyerSlideIndex_(item.slide_index) + " → " + url);
    } else {
      Logger.log("FAILED " + item.template_id + " slide_index=" + item.slide_index);
    }
  }
  Logger.log("Refreshed " + refreshed + " thumbnail(s).");
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
    if (formType === "volunteerAttendance") {
      saveVolunteerAttendance(data);
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
    if (formType === "adminGenerateFlyer") {
      return json_(adminGenerateFlyer(data));
    }
    if (formType === "adminPreviewFlyerPptx") {
      return json_(adminPreviewFlyerPptx(data));
    }
    if (formType === "adminImportFlyerTemplate") {
      return json_(adminImportFlyerTemplate(data));
    }
    if (formType === "adminDeleteFlyerTemplate") {
      return json_(adminDeleteFlyerTemplate(data));
    }
    if (formType === "adminSaveSite") {
      return json_(adminSaveSite(data));
    }
    if (formType === "adminUpdateInquiry") {
      return json_(adminUpdateInquiry(data));
    }
    if (formType === "adminInquiriesAddedToGroup") {
      return json_(adminInquiriesAddedToGroup(data));
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
    if (formType === "adminSaveVolunteerNeed") {
      return json_(adminSaveVolunteerNeed(data));
    }
    if (formType === "adminAddEventVolunteer") {
      return json_(adminAddEventVolunteer(data));
    }
    if (formType === "adminUpdateEventVolunteer") {
      return json_(adminUpdateEventVolunteer(data));
    }
    if (formType === "adminDeleteEventVolunteer") {
      return json_(adminDeleteEventVolunteer(data));
    }
    if (formType === "adminMarkVolunteersInGroup") {
      return json_(adminMarkVolunteersInGroup(data));
    }
    if (formType === "adminCreateProgramVolunteerForm") {
      return json_(adminCreateProgramVolunteerForm(data));
    }

    return json_({
      error:
        "Unknown formType. Use homeQuery, programInterest, programVolunteer, volunteeringInterest, volunteerAttendance, or admin actions.",
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
  if (type === "inviteMessages") {
    requireRole_(token, ["admin", "nurturing"]);
    return { messages: programInviteMessages_() };
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
  if (type === "volunteerRoster") {
    requireRole_(token, ["admin", "nurturing"]);
    return getVolunteerRoster_();
  }
  if (type === "volunteerNeeds") {
    requireRole_(token, ["admin", "nurturing", "programs"]);
    return getVolunteerNeeds_();
  }
  if (type === "formTemplates") {
    requireRole_(token, ["admin", "nurturing"]);
    return {
      templates: FORM_TEMPLATES.map(function (t) {
        return { id: t.id, name: t.name, type: t.type || "single-program", slotPlaceholder: t.slotPlaceholder || "", slotQuestion: t.slotQuestion || "" };
      }),
    };
  }
  if (type === "formTemplateQuestions") {
    requireRole_(token, ["admin", "nurturing"]);
    return { questions: formTemplateQuestions_(String((data && data.templateId) || "")) };
  }
  if (type === "programTitles") {
    requireRole_(token, ["admin", "programs"]);
    return { titles: listProgramTitles_() };
  }
  if (type === "flyerTemplates") {
    requireRole_(token, ["admin", "programs"]);
    const title = String((data && data.title) || "").trim();
    return { templates: listFlyerTemplates_(title) };
  }
  if (type === "flyerImportConfig") {
    requireRole_(token, ["admin"]);
    return getFlyerImportConfig_();
  }
  throw new Error("Unknown type");
}

/* ── Volunteer roster (Nurturing) ──────────────────────────────────────
   Read-only list of volunteers from a SEPARATE Google Sheet. Link it once by
   running setVolunteerRosterSheet("<sheet URL or ID>", "<tab name, optional>")
   from the Apps Script editor; the script owner must have access to that sheet.
   Row 1 is the header; every column is passed through as-is. */
const ROSTER_ID_PROP = "VOLUNTEER_ROSTER_SHEET_ID";
const ROSTER_TAB_PROP = "VOLUNTEER_ROSTER_TAB";

function setVolunteerRosterSheet(urlOrId, tabName) {
  const m = String(urlOrId || "").match(/\/d\/([a-zA-Z0-9_-]+)/);
  const id = m ? m[1] : String(urlOrId || "").trim();
  if (!id) throw new Error("Pass the sheet URL or ID.");
  SpreadsheetApp.openById(id); // fail now if there is no access
  const props = PropertiesService.getScriptProperties();
  props.setProperty(ROSTER_ID_PROP, id);
  props.setProperty(ROSTER_TAB_PROP, String(tabName || "").trim());
}

function getVolunteerRoster_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(ROSTER_ID_PROP);
  if (!id) return { configured: false, headers: [], rows: [] };
  const book = SpreadsheetApp.openById(id);
  const tab = props.getProperty(ROSTER_TAB_PROP);
  const sheet = tab ? book.getSheetByName(tab) : book.getSheets()[0];
  if (!sheet) throw new Error('Tab "' + tab + '" not found in the roster sheet.');
  const values = sheet.getDataRange().getDisplayValues();
  const headers = (values.shift() || []).map(function (h) { return String(h).trim(); });
  const rows = values.filter(function (r) {
    return r.some(function (c) { return String(c).trim() !== ""; });
  });
  return { configured: true, title: book.getName(), headers: headers, rows: rows };
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
  if (header === "free offering" || header === "free_offering" || header === "freeoffering") {
    const v = item.free_offering || item["free offering"] || item.freeoffering;
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

/** Strips zero-width/invisible Unicode characters that sneak in from copy-paste
 * (word joiner, zero-width space/joiners, BOM) \u2014 invisible in the sheet, but
 * enough to make an otherwise-identical title fail an exact-match comparison. */
function stripInvisibleChars_(s) {
  return s.replace(/[\u200b-\u200d\u2060\ufeff]/g, "");
}

function cellToDisplay_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, PROGRAM_TZ_, "yyyy-MM-dd");
  }
  if (value === undefined || value === null) return "";
  return stripInvisibleChars_(String(value).replace(/\u00a0/g, " ")).trim();
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

function listProgramTitles_() {
  ensureSheet_(PROGRAM_TITLES_SHEET, PROGRAM_TITLE_HEADERS);
  const sheet = ss_().getSheetByName(PROGRAM_TITLES_SHEET);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const titleIdx = headers.indexOf("title");
  const activeIdx = headers.indexOf("active");
  const titles = [];
  for (let i = 1; i < rows.length; i++) {
    const title = cellToDisplay_(rows[i][titleIdx]);
    if (!title) continue;
    if (activeIdx >= 0 && /^no$/i.test(cellToDisplay_(rows[i][activeIdx]))) continue;
    titles.push(title);
  }
  return titles;
}

function parseFlyerProgramTitles_(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  if (s.charAt(0) === "[") {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr
          .map(function (t) {
            return String(t || "").trim();
          })
          .filter(Boolean);
      }
    } catch (e) {
      // fall through
    }
  }
  if (s.indexOf("\n") >= 0 || s.indexOf("|") >= 0) {
    return s
      .split(/\n|\|/)
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean);
  }
  return [s];
}

function serializeFlyerProgramTitles_(titles) {
  const list = (titles || [])
    .map(function (t) {
      return String(t || "").trim();
    })
    .filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  return JSON.stringify(list);
}

function flyerMatchesProgramTitle_(raw, wantedTitle) {
  const wanted = stripInvisibleChars_(String(wantedTitle || "")).trim().toLowerCase();
  if (!wanted) return true;
  const titles = parseFlyerProgramTitles_(raw);
  for (let i = 0; i < titles.length; i++) {
    if (titles[i].toLowerCase() === wanted) return true;
  }
  return false;
}

function listFlyerTemplates_(title) {
  ensureSheet_(FLYER_TEMPLATES_SHEET, FLYER_TEMPLATE_HEADERS);
  const sheet = ss_().getSheetByName(FLYER_TEMPLATES_SHEET);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const thumbCol = headers.indexOf("thumbnail_url");
  const wanted = String(title || "").trim();
  const templates = [];
  const thumbOwner = {}; // thumbnail_url → "slide_id|slide_index"

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    const item = rowToItem_(headers, row, i);
    if (wanted && !flyerMatchesProgramTitle_(item.program_title, wanted)) continue;
    if (/^no$/i.test(String(item.active || "yes"))) continue;
    let fields = [];
    try {
      fields = JSON.parse(item.fields_json || "[]");
    } catch (e) {
      fields = [];
    }

    const slideIndex = normalizeFlyerSlideIndex_(item.slide_index);
    const slideKey = String(item.slide_id || "").trim() + "|" + slideIndex;
    let thumbnailUrl = String(item.thumbnail_url || "").trim();

    // Same cached PNG claimed by two different slides → force a fresh render.
    if (thumbnailUrl && thumbOwner[thumbnailUrl] && thumbOwner[thumbnailUrl] !== slideKey) {
      thumbnailUrl = "";
    }

    if (!thumbnailUrl) {
      thumbnailUrl = generateFlyerThumbnail_({
        slide_id: item.slide_id,
        slide_index: slideIndex,
        label: item.label,
      });
      if (thumbnailUrl && thumbCol >= 0) {
        sheet.getRange(i + 1, thumbCol + 1).setValue(thumbnailUrl);
      }
    }
    if (thumbnailUrl) thumbOwner[thumbnailUrl] = slideKey;

    templates.push({
      template_id: item.template_id,
      label: item.label,
      thumbnail_url: thumbnailUrl,
      slide_index: slideIndex,
      program_titles: parseFlyerProgramTitles_(item.program_title),
      fields: fields,
    });
  }
  return templates;
}

/**
 * Renders a flyer's slide as-is (placeholders unfilled) straight from its
 * source Slides file, and saves it to Drive as that flyer's thumbnail. Runs
 * automatically the first time a flyer with no thumbnail_url is listed, and
 * the result is cached back into the sheet — clear that cell to force a
 * fresh thumbnail after redesigning the slide.
 */
function generateFlyerThumbnail_(template) {
  if (!template.slide_id) return "";
  try {
    const pageId = resolveFlyerSlidePageId_(template.slide_id, template.slide_index);
    const blob = exportSlidePng_(template.slide_id, pageId);
    const safeName = String(template.label || "flyer").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    blob.setName(safeName + "-thumb-" + new Date().getTime() + ".png");
    const folder = getCentreImagesFolder_();
    const outFile = folder.createFile(blob);
    outFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return "https://drive.google.com/uc?id=" + outFile.getId();
  } catch (e) {
    return "";
  }
}

/** 1-based slide number; blank/invalid → 1 (first slide). */
function normalizeFlyerSlideIndex_(slideIndexRaw) {
  const requestedIndex = parseInt(slideIndexRaw, 10);
  return !isNaN(requestedIndex) && requestedIndex > 0 ? requestedIndex : 1;
}

/** Finds the slide_index'th slide (1-based; blank/1 = first) in a presentation and returns its object id. */
function resolveFlyerSlidePageId_(presentationId, slideIndexRaw) {
  const presentation = SlidesApp.openById(presentationId);
  const slides = presentation.getSlides();
  const slideIndex = normalizeFlyerSlideIndex_(slideIndexRaw) - 1;
  if (slideIndex >= slides.length) {
    throw new Error("slide_index (" + slideIndexRaw + ") doesn't exist in this Slides file.");
  }
  return slides[slideIndex].getObjectId();
}

/**
 * Exports one slide as a PNG blob.
 * Prefer the Slides API thumbnail endpoint (reliable per pageObjectId).
 * Fall back to the docs export URL if needed.
 */
function exportSlidePng_(presentationId, pageId) {
  const token = ScriptApp.getOAuthToken();
  const thumbMetaUrl =
    "https://slides.googleapis.com/v1/presentations/" +
    encodeURIComponent(presentationId) +
    "/pages/" +
    encodeURIComponent(pageId) +
    "/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE";
  const metaRes = UrlFetchApp.fetch(thumbMetaUrl, {
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  if (metaRes.getResponseCode() === 200) {
    try {
      const meta = JSON.parse(metaRes.getContentText());
      if (meta && meta.contentUrl) {
        const imgRes = UrlFetchApp.fetch(meta.contentUrl, { muteHttpExceptions: true });
        if (imgRes.getResponseCode() === 200) {
          return imgRes.getBlob().setContentType("image/png");
        }
      }
    } catch (e) {
      // fall through to docs export
    }
  }

  const exportUrl =
    "https://docs.google.com/presentation/d/" +
    presentationId +
    "/export/png?pageid=" +
    encodeURIComponent(pageId);
  const response = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("Could not render the slide image.");
  }
  return response.getBlob();
}

function findFlyerTemplateRow_(templateId) {
  ensureSheet_(FLYER_TEMPLATES_SHEET, FLYER_TEMPLATE_HEADERS);
  const sheet = ss_().getSheetByName(FLYER_TEMPLATES_SHEET);
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return null;
  const headers = rows[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const wanted = String(templateId || "").trim();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    const item = rowToItem_(headers, row, i);
    if (String(item.template_id || "").trim() === wanted) return item;
  }
  return null;
}

/**
 * Fills a flyer's Google Slides template with the submitted field values and
 * returns a PNG. Each template is its own single-slide file so its custom
 * page size (square, A4, etc.) carries straight through to the exported PNG.
 */
function adminGenerateFlyer(data) {
  requireRole_(data.token, ["admin", "programs"]);
  const templateId = String(data.templateId || "").trim();
  if (!templateId) throw new Error("Choose a flyer.");
  const template = findFlyerTemplateRow_(templateId);
  if (!template) throw new Error("Flyer template not found.");
  if (!template.slide_id) throw new Error("This flyer has no Slides template linked.");

  let fields = [];
  try {
    fields = JSON.parse(template.fields_json || "[]");
  } catch (e) {
    fields = [];
  }
  const fieldValues = data.fields || {};
  for (let i = 0; i < fields.length; i++) {
    const key = fields[i].key;
    if (fields[i].required && !String(fieldValues[key] || "").trim()) {
      throw new Error("Fill in " + (fields[i].label || key) + ".");
    }
  }

  const sourceFile = DriveApp.getFileById(template.slide_id);
  const copy = sourceFile.makeCopy("Flyer render - " + template.label + " - " + new Date().getTime());
  try {
    const presentation = SlidesApp.openById(copy.getId());
    const pageId = resolveFlyerSlidePageId_(copy.getId(), template.slide_index);
    // replaceAllText touches every slide in this throwaway copy, not just the
    // target one — harmless since only the target slide gets exported below.
    fields.forEach(function (f) {
      const value = String(fieldValues[f.key] !== undefined ? fieldValues[f.key] : "");
      presentation.replaceAllText("{{" + f.key + "}}", value);
    });
    presentation.saveAndClose();

    const safeName = String(template.label || "flyer").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const blob = exportSlidePng_(copy.getId(), pageId).setName(safeName + "-" + new Date().getTime() + ".png");
    const folder = getCentreImagesFolder_();
    const outFile = folder.createFile(blob);
    outFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { success: true, url: "https://drive.google.com/uc?id=" + outFile.getId(), fileId: outFile.getId() };
  } finally {
    copy.setTrashed(true);
  }
}

// --- Flyer template import (PPTX upload from admin) ---
// Requires Advanced Google service: Drive API (v3 default; v2 also works).
const FLYER_PPTX_MAX_BYTES = 8 * 1024 * 1024;
const FLYER_SQUARE_MASTER_PROP = "FLYER_SQUARE_MASTER_ID";
// Existing square-flyer deck — all square PPTX imports append slides here.
const FLYER_SQUARE_MASTER_DEFAULT = "1Dy1DGOYKfh3NwuGSAmelbraQ4pF4uCp_mLun_SteZNQ";

function ensureDriveApi_() {
  if (typeof Drive === "undefined" || !Drive.Files) {
    throw new Error(
      "Enable the Drive API advanced service in Apps Script (Services → Drive API), then redeploy."
    );
  }
  if (typeof Drive.Files.create !== "function" && typeof Drive.Files.insert !== "function") {
    throw new Error(
      "Drive API is enabled but Files.create/insert is missing. In Services, set Drive API to v3 (or v2), save, then redeploy."
    );
  }
}

function flyerImportScratchFolder_() {
  const props = PropertiesService.getScriptProperties();
  const key = "FLYER_IMPORT_SCRATCH_FOLDER_ID";
  const saved = props.getProperty(key);
  if (saved) {
    try {
      return DriveApp.getFolderById(saved);
    } catch (e) {
      // fall through
    }
  }
  const folder = DriveApp.createFolder("VJN flyer imports (scratch)");
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
  props.setProperty(key, folder.getId());
  return folder;
}

/** Resolves the square master Slides file. Prefers script property, else the known deck. */
function resolveSquareFlyerMasterId_() {
  const props = PropertiesService.getScriptProperties();
  const candidates = [
    props.getProperty(FLYER_SQUARE_MASTER_PROP),
    FLYER_SQUARE_MASTER_DEFAULT,
  ];
  for (let i = 0; i < candidates.length; i++) {
    const id = String(candidates[i] || "").trim();
    if (!id) continue;
    try {
      DriveApp.getFileById(id);
      if (props.getProperty(FLYER_SQUARE_MASTER_PROP) !== id) {
        props.setProperty(FLYER_SQUARE_MASTER_PROP, id);
      }
      return id;
    } catch (e) {
      // try next
    }
  }
  throw new Error(
    "Square flyer master Slides file not found. Check FLYER_SQUARE_MASTER_DEFAULT / script property FLYER_SQUARE_MASTER_ID."
  );
}

function getOrCreateSquareFlyerMasterId_() {
  return resolveSquareFlyerMasterId_();
}

function getFlyerImportConfig_() {
  let masterId = "";
  let slideCount = 0;
  let masterUrl = "";
  try {
    masterId = resolveSquareFlyerMasterId_();
    const pres = SlidesApp.openById(masterId);
    slideCount = pres.getSlides().length;
    masterUrl = pres.getUrl();
  } catch (e) {
    masterId = FLYER_SQUARE_MASTER_DEFAULT;
  }
  const driveOk =
    typeof Drive !== "undefined" &&
    Drive.Files &&
    (typeof Drive.Files.create === "function" || typeof Drive.Files.insert === "function");
  return {
    masterConfigured: !!masterUrl,
    masterSlideId: masterId,
    masterUrl: masterUrl,
    slideCount: slideCount,
    driveApiRequired: !driveOk,
  };
}

function decodeFlyerPptxUpload_(data) {
  const raw = String((data && data.base64) || "").replace(/\s/g, "");
  if (!raw) throw new Error("Choose a PPTX file to upload.");
  const bytes = Utilities.base64Decode(raw);
  if (bytes.length > FLYER_PPTX_MAX_BYTES) {
    throw new Error("File is too large (max " + Math.round(FLYER_PPTX_MAX_BYTES / (1024 * 1024)) + " MB).");
  }
  const name = String((data && data.filename) || "flyer-template.pptx").trim() || "flyer-template.pptx";
  if (!/\.pptx$/i.test(name)) throw new Error("Upload a .pptx file exported from Canva.");
  const blob = Utilities.newBlob(bytes, "application/vnd.openxmlformats-officedocument.presentationml.presentation", name);
  return { blob: blob, title: name.replace(/\.pptx$/i, "") };
}

const FLYER_IMAGE_MIME_BY_EXT_ = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

function isFlyerImageFilename_(name) {
  return /\.(png|jpe?g|webp)$/i.test(String(name || ""));
}

/** Decodes a plain PNG/JPG/WEBP flyer upload — no placeholders to detect, used as a static flyer. */
function decodeFlyerImageUpload_(data) {
  const raw = String((data && data.base64) || "").replace(/\s/g, "");
  if (!raw) throw new Error("Choose a flyer image to upload.");
  const bytes = Utilities.base64Decode(raw);
  if (bytes.length > FLYER_PPTX_MAX_BYTES) {
    throw new Error("File is too large (max " + Math.round(FLYER_PPTX_MAX_BYTES / (1024 * 1024)) + " MB).");
  }
  const name = String((data && data.filename) || "flyer-template.png").trim() || "flyer-template.png";
  const ext = (name.match(/\.([a-z0-9]+)$/i) || ["", ""])[1].toLowerCase();
  const mime = FLYER_IMAGE_MIME_BY_EXT_[ext];
  if (!mime) throw new Error("Upload a PNG, JPG, or WEBP flyer image.");
  const blob = Utilities.newBlob(bytes, mime, name);
  return { blob: blob, title: name.replace(/\.[a-z0-9]+$/i, "") };
}

/** Appends a new blank slide to the square master deck with the image filling it (letterboxed, not cropped). */
/**
 * Serializes read-append-write on the shared master deck. Two imports
 * submitted close together would otherwise both read the same "current
 * slide count" before either save commits, and compute the same next
 * slide_index — this lock is what stops that collision.
 */
function withFlyerMasterLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * The slide count read right after appendSlide() can't be trusted as the
 * final index — re-opens the deck fresh (past any stale in-memory state)
 * and locates the appended slide by its own object id, which is always
 * correct regardless of what else changed the slide count meanwhile.
 */
function resolveFlyerSlideIndexByObjectId_(masterId, objectId) {
  const fresh = SlidesApp.openById(masterId);
  const slides = fresh.getSlides();
  for (let i = 0; i < slides.length; i++) {
    if (slides[i].getObjectId() === objectId) return i + 1;
  }
  throw new Error("Could not locate the newly added slide in the master deck.");
}

function appendImageSlideToSquareMaster_(imageBlob) {
  return withFlyerMasterLock_(function () {
    const masterId = getOrCreateSquareFlyerMasterId_();
    const master = SlidesApp.openById(masterId);
    const countBefore = master.getSlides().length;
    const slide = master.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    const appendedId = slide.getObjectId();
    const pageWidth = master.getPageWidth();
    const pageHeight = master.getPageHeight();
    const image = slide.insertImage(imageBlob);
    const srcW = image.getWidth();
    const srcH = image.getHeight();
    const scale = Math.min(pageWidth / srcW, pageHeight / srcH);
    const newW = srcW * scale;
    const newH = srcH * scale;
    image.setWidth(newW);
    image.setHeight(newH);
    image.setLeft((pageWidth - newW) / 2);
    image.setTop((pageHeight - newH) / 2);

    const slides = master.getSlides();
    if (countBefore === 1 && slides.length === 2 && !slideHasVisibleText_(slides[0])) {
      slides[0].remove();
    }
    master.saveAndClose();
    return { masterId: masterId, slideIndex: resolveFlyerSlideIndexByObjectId_(masterId, appendedId) };
  });
}

/**
 * Converts a PPTX blob to a native Google Slides file.
 * Drive API v3 uses Files.create; older v2 uses Files.insert + convert.
 */
function convertPptxBlobToSlidesId_(blob, title) {
  ensureDriveApi_();
  const folder = flyerImportScratchFolder_();
  const slidesTitle = title + " (import)";

  if (typeof Drive.Files.create === "function") {
    const file = Drive.Files.create(
      {
        name: slidesTitle,
        mimeType: MimeType.GOOGLE_SLIDES,
        parents: [folder.getId()],
      },
      blob,
      { fields: "id,name" }
    );
    if (!file || !file.id) throw new Error("Could not convert PPTX to Google Slides.");
    return file.id;
  }

  const file = Drive.Files.insert(
    {
      title: slidesTitle,
      mimeType: MimeType.GOOGLE_SLIDES,
      parents: [{ id: folder.getId() }],
    },
    blob,
    { convert: true }
  );
  if (!file || !file.id) throw new Error("Could not convert PPTX to Google Slides.");
  return file.id;
}

function slugFlyerFieldKey_(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[<>{}]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function humanizeFlyerFieldKey_(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
}

function forEachTextRangeOnPageElement_(element, fn) {
  if (!element) return;
  const type = element.getPageElementType();
  if (type === SlidesApp.PageElementType.GROUP) {
    element
      .asGroup()
      .getChildren()
      .forEach(function (child) {
        forEachTextRangeOnPageElement_(child, fn);
      });
    return;
  }
  if (type === SlidesApp.PageElementType.SHAPE) {
    const shape = element.asShape();
    try {
      const text = shape.getText();
      if (text) fn(text);
    } catch (e) {
      // not a text shape
    }
    return;
  }
  if (type === SlidesApp.PageElementType.TABLE) {
    const table = element.asTable();
    for (let r = 0; r < table.getNumRows(); r++) {
      for (let c = 0; c < table.getNumColumns(); c++) {
        try {
          const text = table.getCell(r, c).getText();
          if (text) fn(text);
        } catch (e2) {
          // empty cell
        }
      }
    }
  }
}

function forEachTextRangeOnSlide_(slide, fn) {
  slide.getPageElements().forEach(function (pe) {
    forEachTextRangeOnPageElement_(pe, fn);
  });
}

function collectFlyerTokensFromSlide_(slide) {
  const found = [];
  const seen = {};
  function addToken(token) {
    const t = String(token || "").trim();
    if (!t || seen[t]) return;
    seen[t] = true;
    found.push(t);
  }
  forEachTextRangeOnSlide_(slide, function (textRange) {
    const s = textRange.asString();
    let m;
    const angle = /<([^>]+)>/g;
    while ((m = angle.exec(s))) addToken("<" + m[1].trim() + ">");
    const curly = /\{\{([^}]+)\}\}/g;
    while ((m = curly.exec(s))) addToken("{{" + m[1].trim() + "}}");
  });
  return found;
}

function placeholdersFromTokens_(tokens) {
  return tokens.map(function (token) {
    let inner = token;
    if (/^<.+>$/.test(token)) inner = token.slice(1, -1);
    else if (/^\{\{[\s\S]+\}\}$/.test(token)) inner = token.slice(2, -2);
    const key = slugFlyerFieldKey_(inner);
    return {
      token: token,
      key: key || "field",
      label: humanizeFlyerFieldKey_(key || inner),
      required: true,
      type: /link|url|http/i.test(inner) ? "url" : "text",
    };
  });
}

function normalizePlaceholdersOnSlide_(slide, fields) {
  (fields || []).forEach(function (f) {
    const token = String(f.token || "").trim();
    const key = String(f.key || "").trim();
    if (!token || !key) return;
    const replacement = "{{" + key + "}}";
    if (token === replacement) return;
    forEachTextRangeOnSlide_(slide, function (textRange) {
      textRange.replaceAllText(token, replacement);
    });
  });
}

function slideHasVisibleText_(slide) {
  let has = false;
  forEachTextRangeOnSlide_(slide, function (textRange) {
    if (String(textRange.asString() || "").trim()) has = true;
  });
  return has;
}

function appendPptxSlideToSquareMaster_(tempSlidesId) {
  return withFlyerMasterLock_(function () {
    const masterId = getOrCreateSquareFlyerMasterId_();
    const tempPres = SlidesApp.openById(tempSlidesId);
    if (!tempPres.getSlides().length) throw new Error("The PPTX has no slides.");
    const importedSlide = tempPres.getSlides()[0];

    const master = SlidesApp.openById(masterId);
    const countBefore = master.getSlides().length;
    const appended = master.appendSlide(importedSlide);
    const appendedId = appended.getObjectId();
    const slides = master.getSlides();
    if (countBefore === 1 && slides.length === 2 && !slideHasVisibleText_(slides[0])) {
      slides[0].remove();
    }
    master.saveAndClose();
    return { masterId: masterId, slideIndex: resolveFlyerSlideIndexByObjectId_(masterId, appendedId) };
  });
}

function buildFieldsJsonForSave_(fields) {
  const out = [];
  (fields || []).forEach(function (f) {
    const key = String(f.key || "").trim();
    if (!key) return;
    const item = {
      key: key,
      label: String(f.label || humanizeFlyerFieldKey_(key)).trim() || key,
      required: f.required !== false,
    };
    if (f.type === "url" || f.type === "time") item.type = f.type;
    out.push(item);
  });
  return out;
}

function appendFlyerTemplateRow_(row) {
  ensureSheet_(FLYER_TEMPLATES_SHEET, FLYER_TEMPLATE_HEADERS);
  const sheet = ss_().getSheetByName(FLYER_TEMPLATES_SHEET);
  const headers = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), FLYER_TEMPLATE_HEADERS.length))
    .getValues()[0]
    .map(function (h) {
      return h.toString().trim().toLowerCase();
    });
  const values = headers.map(function (h) {
    if (h === "template_id") return row.template_id || "";
    if (h === "program_title") return row.program_title || "";
    if (h === "label") return row.label || "";
    if (h === "thumbnail_url") return row.thumbnail_url || "";
    if (h === "slide_id") return row.slide_id || "";
    if (h === "slide_index") return row.slide_index || "";
    if (h === "fields_json") return JSON.stringify(row.fields || []);
    if (h === "active") return "yes";
    return "";
  });
  sheet.appendRow(values);
}

function trashFileQuiet_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    // ignore
  }
}

function adminPreviewFlyerPptx(data) {
  requireRole_(data.token, ["admin"]);
  const upload = decodeFlyerPptxUpload_(data);
  let tempId = "";
  try {
    tempId = convertPptxBlobToSlidesId_(upload.blob, upload.title);
    const slide = SlidesApp.openById(tempId).getSlides()[0];
    const tokens = collectFlyerTokensFromSlide_(slide);
    const placeholders = placeholdersFromTokens_(tokens);
    // No placeholders is fine — it's just imported as a static flyer with
    // no editable fields, same as a plain image upload.
    return { success: true, placeholders: placeholders, filename: upload.blob.getName() };
  } finally {
    trashFileQuiet_(tempId);
  }
}

function adminImportFlyerTemplate(data) {
  requireRole_(data.token, ["admin"]);
  const templateId = String(data.templateId || "").trim();
  const label = String(data.label || "").trim();
  let programTitles = [];
  if (Array.isArray(data.program_titles)) {
    programTitles = data.program_titles;
  } else if (Array.isArray(data.programTitles)) {
    programTitles = data.programTitles;
  } else if (data.program_title || data.programTitle) {
    programTitles = [data.program_title || data.programTitle];
  }
  const programTitleCell = serializeFlyerProgramTitles_(programTitles);
  if (!templateId) throw new Error("Enter a template id (e.g. ie-centre-v2).");
  if (!programTitleCell) throw new Error("Choose at least one program.");
  if (!label) throw new Error("Enter a short label for the flyer picker.");
  if (findFlyerTemplateRow_(templateId)) throw new Error("That template id is already in use.");

  const filename = String(data.filename || "");
  const isImage = isFlyerImageFilename_(filename);
  const upload = isImage ? decodeFlyerImageUpload_(data) : decodeFlyerPptxUpload_(data);
  let tempId = "";
  try {
    const appended = isImage
      ? appendImageSlideToSquareMaster_(upload.blob)
      : (function () {
          tempId = convertPptxBlobToSlidesId_(upload.blob, upload.title);
          return appendPptxSlideToSquareMaster_(tempId);
        })();
    const master = SlidesApp.openById(appended.masterId);
    const slide = master.getSlides()[appended.slideIndex - 1];

    // Images have no editable text to scan, and a PPTX with no {{placeholders}}
    // is a valid static flyer too — either way, an empty field list is fine.
    let fieldDefs = Array.isArray(data.fields) ? data.fields : [];
    if (!fieldDefs.length && !isImage) {
      fieldDefs = placeholdersFromTokens_(collectFlyerTokensFromSlide_(slide));
    }
    fieldDefs = fieldDefs.map(function (f) {
      return {
        token: String(f.token || "").trim(),
        key: slugFlyerFieldKey_(f.key || f.token || ""),
        label: String(f.label || "").trim(),
        required: f.required !== false,
        type: f.type === "url" || f.type === "time" ? f.type : "text",
      };
    });
    fieldDefs = fieldDefs.filter(function (f) {
      return f.key;
    });

    if (fieldDefs.length) normalizePlaceholdersOnSlide_(slide, fieldDefs);
    master.saveAndClose();

    const fieldsJson = buildFieldsJsonForSave_(fieldDefs);
    const thumbnailUrl = generateFlyerThumbnail_({
      slide_id: appended.masterId,
      slide_index: appended.slideIndex,
      label: label,
    });
    const savedTitles = parseFlyerProgramTitles_(programTitleCell);
    appendFlyerTemplateRow_({
      template_id: templateId,
      program_title: programTitleCell,
      label: label,
      thumbnail_url: thumbnailUrl,
      slide_id: appended.masterId,
      slide_index: appended.slideIndex,
      fields: fieldsJson,
    });

    const cfg = getFlyerImportConfig_();
    return {
      success: true,
      template_id: templateId,
      slide_id: appended.masterId,
      slide_index: appended.slideIndex,
      thumbnail_url: thumbnailUrl,
      program_titles: savedTitles,
      masterUrl: cfg.masterUrl,
      fields: fieldsJson,
    };
  } finally {
    trashFileQuiet_(tempId);
  }
}

/**
 * Hides a flyer template by setting its row's active column to "no". The
 * slide stays in the shared master deck: removing it would shift the
 * slide_index of every template after it.
 */
function adminDeleteFlyerTemplate(data) {
  requireRole_(data.token, ["admin"]);
  const wanted = String(data.templateId || "").trim();
  if (!wanted) throw new Error("Missing template id.");
  ensureSheet_(FLYER_TEMPLATES_SHEET, FLYER_TEMPLATE_HEADERS);
  const sheet = ss_().getSheetByName(FLYER_TEMPLATES_SHEET);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const idCol = headers.indexOf("template_id");
  const activeCol = headers.indexOf("active");
  if (idCol < 0 || activeCol < 0) throw new Error("FlyerTemplates sheet is missing its template_id or active column.");
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol] || "").trim() === wanted) {
      sheet.getRange(i + 1, activeCol + 1).setValue("no");
      return { success: true, template_id: wanted };
    }
  }
  throw new Error("That template no longer exists.");
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
  requireRole_(data.token, ["admin", "promotions"]);
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
    // Only touch keys the caller sent, so saving the banner never blanks other site text.
    if (incoming[key] === undefined) return;
    const value = String(incoming[key]);
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

  // How many volunteers Nurturing has recruited per program, for a progress line.
  const volunteerCounts = sheetName === PROGRAMS_SHEET ? evVolunteerCountsByEvent_() : null;

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
    if (volunteerCounts) {
      item.volunteers_added = volunteerCounts[String(item.id)] || 0;
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
    headers: ["Timestamp", "Name", "WhatsApp", "Area", "Query", "Status", "Remarks", "In Group"],
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
      "Invite Sent",
      "In Group",
    ],
  },
  {
    key: "programVolunteer",
    sheet: PROGRAM_VOLUNTEER_SHEET,
    title: "Program volunteer",
    headers: [
      "Timestamp",
      "Name",
      "WhatsApp",
      "Area",
      "Program Name",
      "Program ID",
      "Status",
      "Remarks",
      "In Group",
      "IE Completion",
    ],
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
      "In Group",
      "IE Completion",
      "Volunteer Remarks",
    ],
  },
  {
    key: "volunteerAttendance",
    sheet: VOLUNTEER_ATTENDANCE_SHEET,
    title: "Volunteer attendance",
    headers: [
      "Timestamp",
      "Name",
      "WhatsApp",
      "Area",
      "Program Name",
      "Program ID",
      "Consent",
      "Status",
      "Remarks",
      "In Group",
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
  const inviteIx = headers.indexOf("invite sent");
  let inviteSent;
  if (data.inviteSent !== undefined && inviteIx >= 0) {
    inviteSent = data.inviteSent ? nowIsoKolkata_() : "";
    row[inviteIx] = inviteSent;
  }
  const groupIx = headers.indexOf("in group");
  let inGroup;
  if (data.inGroup !== undefined && groupIx >= 0) {
    inGroup = data.inGroup ? String(data.inGroup).trim() + " · " + nowIsoKolkata_().slice(0, 10) : "";
    row[groupIx] = inGroup;
  }
  sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([row]);
  return { success: true, status: status, inviteSent: inviteSent, inGroup: inGroup };
}

/**
 * Enquiries Sandesha just added to a WhatsApp group: record the group in
 * "In Group" and mark each one Resolved. data.items = [{ sheet, id }], data.group = group name.
 */
function adminInquiriesAddedToGroup(data) {
  requireRole_(data.token, ["admin", "nurturing"]);
  const items = Array.isArray(data && data.items) ? data.items : [];
  const groupName = String((data && data.group) || "").trim() || "WhatsApp group";
  const stamp = groupName + " · " + nowIsoKolkata_().slice(0, 10);
  const bySheet = {};
  items.forEach(function (it) {
    const key = String((it && it.sheet) || "");
    if (!inquiryDefByKey_(key)) return;
    (bySheet[key] = bySheet[key] || []).push(parseInt(it.id, 10));
  });
  let updated = 0;
  Object.keys(bySheet).forEach(function (key) {
    const def = inquiryDefByKey_(key);
    const sheet = ensureSheet_(def.sheet, def.headers);
    const lastCol = sheet.getLastColumn() || 1;
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
      return h.toString().trim().toLowerCase();
    });
    const statusIx = headers.indexOf("status");
    const groupIx = headers.indexOf("in group");
    if (statusIx < 0 || groupIx < 0) throw new Error("Status/In Group columns missing on " + def.sheet + ".");
    bySheet[key].forEach(function (rowIndex) {
      if (isNaN(rowIndex) || rowIndex < 1 || rowIndex + 1 > sheet.getLastRow()) return;
      sheet.getRange(rowIndex + 1, statusIx + 1).setValue("Resolved");
      sheet.getRange(rowIndex + 1, groupIx + 1).setValue(stamp);
      updated += 1;
    });
  });
  return { success: true, updated: updated, inGroup: stamp };
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

/** Appends a row by header name, so columns added later (e.g. IE Completion) land in the right place. */
function appendByHeaders_(sheet, map) {
  const lastCol = sheet.getLastColumn() || 1;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  sheet.appendRow(
    headers.map(function (h) {
      return map[h] === undefined || map[h] === null ? "" : map[h];
    })
  );
}

function saveProgramVolunteer(data) {
  const sheet = ensureSheet_(PROGRAM_VOLUNTEER_SHEET, inquiryDefByKey_("programVolunteer").headers);
  appendByHeaders_(sheet, {
    timestamp: data.timestamp || new Date().toISOString(),
    name: data.name || "",
    whatsapp: data.phone || "",
    area: data.area || "",
    "program name": (data.programName && String(data.programName).trim()) || "",
    "program id": data.programId || "",
    status: "Open",
    remarks: "",
    "ie completion": String(data.ieCompletion || "").trim(),
  });
}

function saveVolunteeringInterest(data) {
  const sheet = ensureSheet_(VOLUNTEERING_INTEREST_SHEET, inquiryDefByKey_("volunteeringInterest").headers);
  appendByHeaders_(sheet, {
    timestamp: data.timestamp || new Date().toISOString(),
    name: data.name || "",
    whatsapp: data.phone || "",
    area: data.area || "",
    "opportunity name": data.opportunityName || "",
    "opportunity id": data.opportunityId || "",
    status: "Open",
    remarks: "",
    "ie completion": String(data.ieCompletion || "").trim(),
    "volunteer remarks": String(data.remarks || "").trim().slice(0, 1000),
  });
}

function saveVolunteerAttendance(data) {
  const sheet = ensureSheet_(VOLUNTEER_ATTENDANCE_SHEET, [
    "Timestamp",
    "Name",
    "WhatsApp",
    "Area",
    "Program Name",
    "Program ID",
    "Consent",
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
    data.consent ? "Yes" : "No",
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

/** programId -> message the Promotions team wrote for that program. Text only
 * (no flyer / schedule), so Nurturing can invite a Program-interest lead. */
function programInviteMessages_() {
  const out = {};
  loadPromos_().items.forEach(function (item) {
    if (String(item.event_type) !== "programs") return;
    const msg = String(item.message || "").trim();
    if (msg) out[String(item.event_id)] = msg;
  });
  return out;
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
    target: fields.target || "",
    wa_schedule_ids: fields.wa_schedule_ids || "",
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
  if (data.target !== undefined) item.target = String(data.target || "");
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
    // Off the day board means Sandesha is no longer holding a row for it.
    if (!nextSend && data.wa_schedule_ids === undefined) item.wa_schedule_ids = "";
  }
  if (data.wa_schedule_ids !== undefined) {
    item.wa_schedule_ids = normalizeScheduleIds_(data.wa_schedule_ids);
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

/** Sandesha schedule ids, stored as a comma list so one promo can fan out. */
function normalizeScheduleIds_(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
  return list
    .map(function (v) {
      return String(v).trim();
    })
    .filter(function (v) {
      return v !== "";
    })
    .join(",");
}

function adminMarkPromotionSent(data) {
  const session = requireRole_(data.token, ["admin", "promotions"]);
  const loaded = loadPromos_();
  const item = findPromoById_(data.id);
  if (!item) throw new Error("Promotion not found.");
  item.status = "sent";
  item.sent_at = nowIsoKolkata_();
  // Sandesha delivered it on the schedule; the admin who happened to open the
  // board did not, so record the bot rather than them.
  item.sent_by = data.source === "sandesha" ? "sandesha" : session.username;
  item.wa_schedule_ids = "";
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

/* ================================================================
   Event volunteers — Nurturing recruits, tracks attendance, and
   pushes attendees into a general WhatsApp group after the event.
   One sheet (EVENT_VOLUNTEERS_SHEET), "kind" column: need | volunteer.
   ================================================================ */

function evSheet_() {
  return ensureSheet_(EVENT_VOLUNTEERS_SHEET, EV_HEADERS);
}

function evYes_(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y";
}

/** Digits only when it looks like a dialable number (10–13, not a LID shape). */
function evDigits_(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) return "";
  if (d.charAt(0) === "1" && d.length !== 11) return "";
  return d;
}

/** Server mirror of admin.js isVolunteerAvailableValue. */
function programWantsVolunteers_(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y";
}

function parseVolunteersNeeded_(raw) {
  const n = parseInt(String(raw || "").replace(/\D/g, ""), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function loadEventVolunteers_() {
  const sheet = evSheet_();
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn() || 1, EV_HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  if (lastRow < 2) return { sheet: sheet, headers: headers, rows: [] };
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const obj = {};
    headers.forEach(function (h, idx) {
      const v = values[i][idx];
      obj[h] = v === undefined || v === null ? "" : String(v).trim();
    });
    if (!obj.row_id) continue;
    obj._row = i + 2;
    rows.push(obj);
  }
  return { sheet: sheet, headers: headers, rows: rows };
}

function evWriteRow_(loaded, obj) {
  const values = loaded.headers.map(function (h) {
    if (h === "_row") return "";
    return obj[h] === undefined || obj[h] === null ? "" : String(obj[h]);
  });
  loaded.sheet.getRange(obj._row, 1, 1, loaded.headers.length).setValues([values]);
}

function evAppendRow_(loaded, obj) {
  const values = loaded.headers.map(function (h) {
    return obj[h] === undefined || obj[h] === null ? "" : String(obj[h]);
  });
  loaded.sheet.appendRow(values);
}

/** { eventId: countOfVolunteerRows } — for the Programs progress line. */
function evVolunteerCountsByEvent_() {
  const map = {};
  try {
    loadEventVolunteers_().rows.forEach(function (r) {
      if (r.kind !== "volunteer") return;
      const id = String(r.event_id || "");
      if (id) map[id] = (map[id] || 0) + 1;
    });
  } catch (err) {
    // sheet missing — no counts
  }
  return map;
}

function evProgramSnapshot_(eventId) {
  const single = getSingleItem(PROGRAMS_SHEET, String(eventId), true);
  const item = single && single.item ? single.item : null;
  if (!item) return null;
  return {
    title: item.title || "",
    date: item.date || item.startdate || "",
    startdate: item.startdate || "",
    enddate: item.enddate || "",
    status: item.status || "",
    open: isOpenListingStatus_(item.status),
    needed: parseVolunteersNeeded_(item.volunteers_needed || item.volunteersneeded),
    wantsVolunteers: programWantsVolunteers_(item.volunteering_available || item.volunteeringavailable),
    requirements: item.volunteer_requirements || "",
  };
}

function evVolunteerView_(r) {
  return {
    rowId: r.row_id,
    name: r.volunteer_name || "",
    phone: r.phone || "",
    remarks: r.volunteer_remarks || "",
    area: r.area_of_stay || "",
    ieCompletion: r.ie_completion || "",
    attended: String(r.attended || "").toLowerCase(),
    inGroup: evYes_(r.in_wa_group),
    inviteSent: evYes_(r.invite_sent),
    attendanceAt: r.attendance_at || "",
    addedBy: r.added_by || "",
  };
}

function evFindNeed_(loaded, eventId) {
  const id = String(eventId || "");
  for (let i = 0; i < loaded.rows.length; i++) {
    if (loaded.rows[i].kind === "need" && String(loaded.rows[i].event_id) === id) return loaded.rows[i];
  }
  return null;
}

function evFindVolunteer_(loaded, rowId) {
  const id = String(rowId || "");
  for (let i = 0; i < loaded.rows.length; i++) {
    if (loaded.rows[i].kind === "volunteer" && String(loaded.rows[i].row_id) === id) return loaded.rows[i];
  }
  return null;
}

/** Nurturing view: every program that asked for volunteers, joined with tracking. */
function getVolunteerNeeds_() {
  const programs = getAllItems(PROGRAMS_SHEET, true).items || [];
  const loaded = loadEventVolunteers_();
  const needByEvent = {};
  const volsByEvent = {};
  loaded.rows.forEach(function (r) {
    const id = String(r.event_id || "");
    if (!id) return;
    if (r.kind === "need") needByEvent[id] = r;
    else if (r.kind === "volunteer") {
      if (!volsByEvent[id]) volsByEvent[id] = [];
      volsByEvent[id].push(r);
    }
  });

  const items = [];
  let unmet = 0;
  let awaitingAttendance = 0;

  programs.forEach(function (p) {
    if (!programWantsVolunteers_(p.volunteering_available || p.volunteeringavailable)) return;
    const id = String(p.id);
    const needed = parseVolunteersNeeded_(p.volunteers_needed || p.volunteersneeded);
    const need = needByEvent[id] || null;
    const vols = (volsByEvent[id] || []).map(evVolunteerView_);
    vols.sort(function (a, b) { return a.name.localeCompare(b.name); });
    const open = isOpenListingStatus_(p.status);
    const handled = !!(need && evYes_(need.handled));
    const addedCount = vols.length;
    const allAttendanceDone =
      vols.length > 0 && vols.every(function (v) { return v.attended === "yes" || v.attended === "no"; });

    if (open && addedCount < needed) unmet += 1;
    if (!open && handled && vols.some(function (v) { return v.attended === ""; })) awaitingAttendance += 1;

    items.push({
      id: id,
      title: p.title || "",
      date: p.date || p.startdate || "",
      startdate: p.startdate || "",
      enddate: p.enddate || "",
      slots: p.slots || [],
      timings: p.timings || "",
      status: p.status || "",
      open: open,
      needed: needed,
      requirements: p.volunteer_requirements || "",
      handled: handled,
      handledRemarks: need ? need.handled_remarks || "" : "",
      handledBy: need ? need.handled_by || "" : "",
      handledAt: need ? need.handled_at || "" : "",
      formId: need ? need.volunteer_form_id || "" : "",
      formShortUrl: need ? need.volunteer_form_short_url || "" : "",
      formFields: need ? (need.volunteer_form_fields || "").split(",").filter(Boolean) : [],
      formTemplateId: need ? need.volunteer_form_template || "" : "",
      volunteers: vols,
      addedCount: addedCount,
      allAttendanceDone: allAttendanceDone,
    });
  });

  items.sort(function (a, b) {
    const ra = a.open ? (a.addedCount < a.needed ? 0 : 1) : 2;
    const rb = b.open ? (b.addedCount < b.needed ? 0 : 1) : 2;
    if (ra !== rb) return ra - rb;
    return String(a.startdate || "").localeCompare(String(b.startdate || ""));
  });

  return { items: items, counts: { unmet: unmet, awaitingAttendance: awaitingAttendance } };
}

function adminSaveVolunteerNeed(data) {
  const session = requireRole_(data.token, ["admin", "nurturing"]);
  const eventId = String((data && data.eventId) || "").trim();
  if (!eventId) throw new Error("eventId required.");
  const snap = evProgramSnapshot_(eventId);
  if (!snap) throw new Error("Program not found.");

  const loaded = loadEventVolunteers_();
  let need = evFindNeed_(loaded, eventId);
  const now = nowIsoKolkata_();
  const handled = evYes_(data.handled);
  const remarks = data.remarks === undefined || data.remarks === null ? "" : String(data.remarks);

  if (!need) {
    need = { row_id: Utilities.getUuid(), kind: "need", event_id: eventId, _row: null };
  }
  need.event_title = snap.title;
  need.event_date = snap.date;
  need.needed = String(snap.needed);
  need.handled = handled ? "yes" : "no";
  need.handled_remarks = remarks;
  if (handled) {
    if (!need.handled_at) need.handled_at = now;
    need.handled_by = session.username || need.handled_by || "";
  } else {
    need.handled_at = "";
    need.handled_by = "";
    need.reminded_at = "";
  }
  need.updated_at = now;

  if (need._row) evWriteRow_(loaded, need);
  else evAppendRow_(loaded, need);
  return { success: true };
}

function adminAddEventVolunteer(data) {
  const session = requireRole_(data.token, ["admin", "nurturing", "programs"]);
  const eventId = String((data && data.eventId) || "").trim();
  const name = String((data && data.name) || "").trim();
  const phone = evDigits_(data && data.phone);
  const area = String((data && data.area) || "").trim();
  const ieCompletion = String((data && data.ieCompletion) || "").trim();
  const fromForm = String((data && data.addedBy) || "").toLowerCase() === "google-form";
  if (!eventId) throw new Error("eventId required.");
  if (!name) throw new Error("Volunteer name required.");
  if (!phone) throw new Error("A valid phone number is required.");
  if (!area && !fromForm) throw new Error("Area of stay is required.");

  const loaded = loadEventVolunteers_();
  let need = evFindNeed_(loaded, eventId);
  const now = nowIsoKolkata_();

  // Historically Nurturing had to click "Mark handled" before anyone could
  // add a volunteer. Programs (and anyone else) can now add directly —
  // silently create/confirm the need row instead of blocking on that step.
  if (!need || !evYes_(need.handled)) {
    const snap = evProgramSnapshot_(eventId);
    if (!snap) throw new Error("Program not found.");
    if (!need) {
      need = { row_id: Utilities.getUuid(), kind: "need", event_id: eventId, _row: null };
    }
    need.event_title = snap.title;
    need.event_date = snap.date;
    need.needed = String(snap.needed);
    need.handled = "yes";
    need.handled_remarks = need.handled_remarks || "";
    if (!need.handled_at) need.handled_at = now;
    need.handled_by = session.username || need.handled_by || "";
    need.updated_at = now;
    if (need._row) evWriteRow_(loaded, need);
    else evAppendRow_(loaded, need);
  }

  const dup = loaded.rows.some(function (r) {
    return r.kind === "volunteer" && String(r.event_id) === eventId && evDigits_(r.phone) === phone;
  });
  if (dup) throw new Error("That number is already on this event's list.");

  evAppendRow_(loaded, {
    row_id: Utilities.getUuid(),
    kind: "volunteer",
    event_id: eventId,
    event_title: need.event_title || "",
    volunteer_name: name,
    phone: phone,
    volunteer_remarks: String((data && data.remarks) || ""),
    area_of_stay: area,
    ie_completion: ieCompletion,
    added_by: fromForm ? "google-form" : (session.username || ""),
    attended: "",
    in_wa_group: "no",
    invite_sent: "no",
    updated_at: now,
  });
  return { success: true };
}

function adminUpdateEventVolunteer(data) {
  requireRole_(data.token, ["admin", "nurturing", "programs"]);
  const loaded = loadEventVolunteers_();
  const row = evFindVolunteer_(loaded, data && data.rowId);
  if (!row) throw new Error("Volunteer row not found.");
  const now = nowIsoKolkata_();

  if (data.name !== undefined) {
    const nm = String(data.name || "").trim();
    if (nm) row.volunteer_name = nm;
  }
  if (data.phone !== undefined) {
    const p = evDigits_(data.phone);
    if (!p) throw new Error("A valid phone number is required.");
    row.phone = p;
  }
  if (data.remarks !== undefined) row.volunteer_remarks = String(data.remarks || "");
  if (data.area !== undefined) row.area_of_stay = String(data.area || "").trim();
  if (data.attended !== undefined) {
    const a = String(data.attended || "").toLowerCase();
    row.attended = a === "yes" || a === "no" ? a : "";
    row.attendance_at = row.attended ? now : "";
  }
  if (data.inGroup !== undefined) row.in_wa_group = evYes_(data.inGroup) ? "yes" : "no";
  if (data.inviteSent !== undefined) row.invite_sent = evYes_(data.inviteSent) ? "yes" : "no";
  row.updated_at = now;
  evWriteRow_(loaded, row);
  return { success: true, volunteer: evVolunteerView_(row) };
}

function adminDeleteEventVolunteer(data) {
  requireRole_(data.token, ["admin", "nurturing", "programs"]);
  const loaded = loadEventVolunteers_();
  const row = evFindVolunteer_(loaded, data && data.rowId);
  if (!row) throw new Error("Volunteer row not found.");
  loaded.sheet.deleteRow(row._row);
  return { success: true };
}

function adminMarkVolunteersInGroup(data) {
  requireRole_(data.token, ["admin", "nurturing"]);
  const ids = (data && data.rowIds) || [];
  const field = data && data.field === "inviteSent" ? "invite_sent" : "in_wa_group";
  if (!ids.length) return { success: true, updated: 0 };
  const loaded = loadEventVolunteers_();
  const wanted = {};
  ids.forEach(function (id) { wanted[String(id)] = true; });
  const now = nowIsoKolkata_();
  let updated = 0;
  loaded.rows.forEach(function (r) {
    if (r.kind !== "volunteer" || !wanted[String(r.row_id)]) return;
    r[field] = "yes";
    r.updated_at = now;
    evWriteRow_(loaded, r);
    updated += 1;
  });
  return { success: true, updated: updated };
}

/* ── Attendance reminder (Web Push via the Sandesha server) ──────
   Needs Script Properties:
     SANDESHA_API_URL        e.g. https://sandesha.example.ts.net
     SANDESHA_INTERNAL_TOKEN  the value Sandesha prints/stores in its .env
*/
function ensureAttendanceTrigger_() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "remindAttendance") return;
    }
    ScriptApp.newTrigger("remindAttendance").timeBased().everyMinutes(30).create();
  } catch (err) {
    Logger.log("Could not create attendance-reminder trigger: " + err.message);
  }
}

function remindAttendance() {
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty("SANDESHA_API_URL") || "").replace(/\/$/, "");
  const secret = String(props.getProperty("SANDESHA_INTERNAL_TOKEN") || "");
  if (!base || !secret) {
    Logger.log("remindAttendance: set SANDESHA_API_URL and SANDESHA_INTERNAL_TOKEN script properties");
    return;
  }
  const loaded = loadEventVolunteers_();
  const needs = loaded.rows.filter(function (r) { return r.kind === "need" && evYes_(r.handled); });
  if (!needs.length) return;

  const volsByEvent = {};
  loaded.rows.forEach(function (r) {
    if (r.kind !== "volunteer") return;
    const id = String(r.event_id);
    if (!volsByEvent[id]) volsByEvent[id] = [];
    volsByEvent[id].push(r);
  });

  const now = Date.now();
  needs.forEach(function (need) {
    const id = String(need.event_id);
    const vols = volsByEvent[id] || [];
    if (!vols.some(function (v) { return String(v.attended || "") === ""; })) return;

    const snap = evProgramSnapshot_(id);
    if (!snap || snap.open) return;

    const last = Date.parse(need.reminded_at || "");
    if (!isNaN(last) && now - last < 20 * 3600 * 1000) return;

    try {
      UrlFetchApp.fetch(base + "/push/notify-internal", {
        method: "post",
        contentType: "application/json",
        muteHttpExceptions: true,
        payload: JSON.stringify({
          token: secret,
          audience: "nurturing",
          title: "Mark volunteer attendance",
          body: '"' + (need.event_title || snap.title || "An event") + '" has finished — mark who came',
          url: "admin.html#volunteering",
          tag: "vjn-attendance-" + id,
        }),
      });
      need.reminded_at = nowIsoKolkata_();
      need.updated_at = need.reminded_at;
      evWriteRow_(loaded, need);
    } catch (err) {
      Logger.log("remindAttendance push failed: " + err.message);
    }
  });
}

/* ── Upcoming-program reminder (Web Push via the Sandesha server) ────
   Same Script Properties as remindAttendance:
     SANDESHA_API_URL, SANDESHA_INTERNAL_TOKEN
   Fires once per program, ~2 days before it starts, to everyone
   subscribed as "programs". Dedup lives in a Script Property (a small
   JSON map of programId -> the date it was sent) rather than a sheet
   column, since Programs has no per-program tracking row the way
   EventVolunteers does for attendance.
*/
function ensureProgramReminderTrigger_() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "remindUpcomingPrograms") return;
    }
    ScriptApp.newTrigger("remindUpcomingPrograms").timeBased().everyHours(6).create();
  } catch (err) {
    Logger.log("Could not create program-reminder trigger: " + err.message);
  }
}

function remindUpcomingPrograms() {
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty("SANDESHA_API_URL") || "").replace(/\/$/, "");
  const secret = String(props.getProperty("SANDESHA_INTERNAL_TOKEN") || "");
  if (!base || !secret) {
    Logger.log("remindUpcomingPrograms: set SANDESHA_API_URL and SANDESHA_INTERNAL_TOKEN script properties");
    return;
  }

  const target = new Date();
  target.setDate(target.getDate() + 2);
  const targetStr = Utilities.formatDate(target, PROGRAM_TZ_, "yyyy-MM-dd");

  const items = (getAllItems(PROGRAMS_SHEET, true).items || []).filter(function (p) {
    if (!isOpenListingStatus_(p.status)) return false;
    return String(p.startdate || "") === targetStr;
  });
  if (!items.length) return;

  const sentKey = "remind2d_sent";
  let sent = {};
  try {
    sent = JSON.parse(props.getProperty(sentKey) || "{}");
  } catch (err) {
    sent = {};
  }

  let changed = false;
  items.forEach(function (p) {
    const id = String(p.id);
    if (sent[id] === targetStr) return; // already reminded for this program's 2-day mark

    const timings = String(p.timings || "").split("\n")[0] || "";
    const body = timings
      ? '"' + p.title + '" is happening in 2 days — ' + timings
      : '"' + (p.title || "A program") + '" is happening in 2 days';

    try {
      UrlFetchApp.fetch(base + "/push/notify-internal", {
        method: "post",
        contentType: "application/json",
        muteHttpExceptions: true,
        payload: JSON.stringify({
          token: secret,
          audience: "programs",
          title: "Program in 2 days",
          body: body,
          url: "admin.html#events",
          tag: "vjn-program-2d-" + id,
        }),
      });
      sent[id] = targetStr;
      changed = true;
    } catch (err) {
      Logger.log("remindUpcomingPrograms push failed for " + id + ": " + err.message);
    }
  });

  if (changed) {
    // Trim entries older than ~14 days so this property never grows unbounded.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffStr = Utilities.formatDate(cutoff, PROGRAM_TZ_, "yyyy-MM-dd");
    Object.keys(sent).forEach(function (id) {
      if (sent[id] < cutoffStr) delete sent[id];
    });
    props.setProperty(sentKey, JSON.stringify(sent));
  }
}

/* ── Google Form generation ──────────────────────────────────────────────── */

/**
 * Create (or reuse) a per-program Google Form for volunteer sign-ups.
 *
 * data.eventId    – required
 * data.templateId – if set, copy the master template form and update slot choices
 * data.slots      – array of slot strings (used when templateId is set)
 * data.fields     – array of optional field keys for custom (no-template) path:
 *                   "area_of_stay", "ie_completion", "volunteer_remarks"
 * data.regenerate – if true, replace an existing form
 *
 * Returns { success, formId, shortUrl, formFields, templateId }
 */
/** Questions on a template's master form, so the app can show exactly what a
 * generated form will contain. Cached for a few hours; the master rarely changes. */
function formTemplateQuestions_(templateId) {
  const tmpl = FORM_TEMPLATES.filter(function (t) { return t.id === templateId; })[0];
  if (!tmpl) throw new Error("Unknown template.");
  const cache = CacheService.getScriptCache();
  const key = "vjn_tq_" + templateId;
  try {
    const hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* fall through */ }
  const requiredGetters = {
    TEXT: "asTextItem", PARAGRAPH_TEXT: "asParagraphTextItem", CHECKBOX: "asCheckboxItem",
    MULTIPLE_CHOICE: "asMultipleChoiceItem", LIST: "asListItem", DATE: "asDateItem",
    TIME: "asTimeItem", SCALE: "asScaleItem", DATETIME: "asDateTimeItem", DURATION: "asDurationItem",
  };
  const skip = { IMAGE: 1, VIDEO: 1, PAGE_BREAK: 1, SECTION_HEADER: 1 };
  const out = [];
  FormApp.openById(tmpl.masterFormId).getItems().forEach(function (item) {
    const type = String(item.getType());
    if (skip[type]) return;
    let required = false;
    try {
      const getter = requiredGetters[type];
      if (getter) required = !!item[getter]().isRequired();
    } catch (e) { /* leave false */ }
    out.push({ title: item.getTitle(), type: type, required: required, help: item.getHelpText() || "" });
  });
  try { cache.put(key, JSON.stringify(out), 21600); } catch (e) { /* ignore */ }
  return out;
}

/**
 * Coordinator-defined extra fields (any form type). Titles are remembered in Script
 * Properties so a regenerate removes the old extras instead of duplicating them, and so
 * the submit handler knows which answers to keep.
 */
function applyCustomFields_(form, data) {
  const props = PropertiesService.getScriptProperties();
  const key = "vjn_form_extras_" + form.getId();
  try {
    const prev = JSON.parse(props.getProperty(key) || "[]");
    if (prev.length) {
      form.getItems().forEach(function (it) {
        if (prev.indexOf(it.getTitle()) >= 0) form.deleteItem(it);
      });
    }
  } catch (e) { /* nothing to clean */ }
  const added = [];
  (Array.isArray(data && data.customFields) ? data.customFields : []).slice(0, 15).forEach(function (f) {
    const title = String((f && f.title) || "").trim().slice(0, 200);
    if (!title) return;
    const opts = (Array.isArray(f.options) ? f.options : [])
      .map(function (o) { return String(o || "").trim(); }).filter(Boolean);
    let item;
    switch (String(f.type)) {
      case "PARAGRAPH": item = form.addParagraphTextItem(); break;
      case "DATE": item = form.addDateItem(); break;
      case "TIME": item = form.addTimeItem(); break;
      case "MULTIPLE_CHOICE": if (!opts.length) return; item = form.addMultipleChoiceItem().setChoiceValues(opts); break;
      case "CHECKBOX": if (!opts.length) return; item = form.addCheckboxItem().setChoiceValues(opts); break;
      case "LIST": if (!opts.length) return; item = form.addListItem().setChoiceValues(opts); break;
      default: item = form.addTextItem();
    }
    item.setTitle(title).setRequired(!!f.required);
    added.push(title);
  });
  if (added.length) props.setProperty(key, JSON.stringify(added));
  else props.deleteProperty(key);
}

/** "Question: answer | …" for a response's custom-field answers ("" if none). */
function customFieldsRemark_(formId, answers) {
  try {
    const titles = JSON.parse(PropertiesService.getScriptProperties().getProperty("vjn_form_extras_" + formId) || "[]");
    const parts = [];
    titles.forEach(function (t) {
      const v = Array.isArray(answers[t]) ? answers[t].join(", ") : String(answers[t] || "").trim();
      if (v) parts.push(t + ": " + v);
    });
    return parts.join(" | ");
  } catch (e) { return ""; }
}

function adminCreateProgramVolunteerForm(data) {
  requireRole_(data.token, ["admin", "nurturing"]);
  const eventId = String((data && data.eventId) || "").trim();
  if (!eventId) throw new Error("eventId required.");

  const snap = evProgramSnapshot_(eventId);
  if (!snap) throw new Error("Program not found.");

  const loaded = loadEventVolunteers_();
  let need = evFindNeed_(loaded, eventId);
  const now = nowIsoKolkata_();

  // Reuse existing form unless the caller explicitly asked to regenerate.
  if (!data.regenerate && need && need.volunteer_form_id) {
    return {
      success: true,
      formId: need.volunteer_form_id,
      shortUrl: need.volunteer_form_short_url || "",
      formFields: (need.volunteer_form_fields || "").split(",").filter(Boolean),
      templateId: need.volunteer_form_template || "",
    };
  }

  const formTitle = String((data && data.formTitle) || "").trim()
    || (snap.title || "Program") + " — volunteer sign-up";
  let form;
  let storedFields = "";
  let programSnaps = {};   // hoisted — used later in multi-program persistence

  // ── Template path: copy master form + update slot/program choices ────────
  const templateId = String((data && data.templateId) || "").trim();
  if (templateId) {
    const tmpl = FORM_TEMPLATES.filter(function (t) { return t.id === templateId; })[0] || null;
    if (!tmpl) throw new Error("Unknown template: " + templateId);

    // ── Prefer updating the EXISTING form so images/theme are preserved ──
    // Only copy the master when no form exists yet for this program.
    const existingFormId = (need && need.volunteer_form_id) ? String(need.volunteer_form_id) : "";
    var formIsNew = false;
    if (existingFormId) {
      try {
        form = FormApp.openById(existingFormId);
        form.setTitle(formTitle);
        // Don't touch description — preserves prerequisite text from the original copy
      } catch (openErr) {
        Logger.log("Could not open existing form " + existingFormId + ": " + openErr.message + ". Creating fresh copy.");
        form = null;
      }
    }
    if (!form) {
      // First time or form was deleted — make a fresh copy of the master
      formIsNew = true;
      const masterFile = DriveApp.getFileById(tmpl.masterFormId);
      const copiedFile = masterFile.makeCopy(formTitle);
      form = FormApp.openById(copiedFile.getId());
      form.setTitle(formTitle);
      form.setDescription(""); // clear any __vjn__ metadata inherited from master
      // Insert header image as first item (makeCopy doesn't copy the banner image)
      if (tmpl.headerImageDriveId) {
        try {
          var imgBlob = DriveApp.getFileById(tmpl.headerImageDriveId).getBlob();
          var imgItem = form.addImageItem();
          imgItem.setImage(imgBlob);
          imgItem.setAlignment(FormApp.Alignment.CENTER);
          // Move to top (position 0)
          var allFormItems = form.getItems();
          form.moveItem(allFormItems.length - 1, 0);
          Logger.log("Header image inserted successfully.");
        } catch (imgErr) {
          Logger.log("Could not insert header image: " + imgErr.message);
        }
      }
    }

    if (tmpl.type === "multi-program") {
      // ── Multi-program: choices = individual program titles ──────────────
      // Collect all programs to include: primary + any additional ones
      const allProgramIds = [eventId];
      const extra = Array.isArray(data && data.additionalProgramIds) ? data.additionalProgramIds : [];
      extra.forEach(function (id) { if (id && allProgramIds.indexOf(id) < 0) allProgramIds.push(String(id)); });

      // Build title list for the checkbox choices
      // programTimings is an optional map of pid → timing string (appended as "Title | Timing")
      const timings = (data && data.programTimings) || {};
      const choiceTitles = [];
      allProgramIds.forEach(function (pid) {
        const s = pid === eventId ? snap : evProgramSnapshot_(pid);
        if (s) {
          programSnaps[pid] = s;
          const timing = timings[pid] ? String(timings[pid]).trim() : "";
          // Format: "Program Title | Date | Timing"
          const dateStr = s.date ? String(s.date).trim() : "";
          let label = s.title;
          if (dateStr) label += " | " + dateStr;
          if (timing) label += " | " + timing;
          choiceTitles.push(label);
        }
      });
      if (!choiceTitles.length) throw new Error("No valid programs selected.");

      // Update the checkbox question with program titles.
      // The master form question may be MULTIPLE_CHOICE (radio) or CHECKBOX;
      // we always want CHECKBOX so volunteers can pick multiple programs.
      const items = form.getItems();
      for (var i = 0; i < items.length; i++) {
        if (items[i].getTitle() === tmpl.slotQuestion) {
          var itemType = items[i].getType();
          if (itemType === FormApp.ItemType.CHECKBOX) {
            // Already a checkbox — just update choices
            items[i].asCheckboxItem().setChoiceValues(choiceTitles);
          } else if (itemType === FormApp.ItemType.MULTIPLE_CHOICE) {
            // Radio button — replace with a checkbox item at the same position
            var mcItem = items[i].asMultipleChoiceItem();
            var helpText = mcItem.getHelpText();
            var isRequired = mcItem.isRequired();
            form.deleteItem(items[i]);
            var newCb = form.addCheckboxItem();
            newCb.setTitle(tmpl.slotQuestion);
            if (helpText) newCb.setHelpText(helpText);
            newCb.setRequired(isRequired);
            newCb.setChoiceValues(choiceTitles);
            // Move from end to original position
            var allItems = form.getItems();
            form.moveItem(allItems.length - 1, i);
          }
          break;
        }
      }

      // Store mapping: choice label → eventId in Script Properties
      const mapping = {};
      allProgramIds.forEach(function (pid) {
        if (programSnaps[pid]) {
          const timing = timings[pid] ? String(timings[pid]).trim() : "";
          const dateStr = programSnaps[pid].date ? String(programSnaps[pid].date).trim() : "";
          let label = programSnaps[pid].title;
          if (dateStr) label += " | " + dateStr;
          if (timing) label += " | " + timing;
          mapping[label] = pid;
        }
      });

      // Create/update need rows for ALL included programs
      allProgramIds.forEach(function (pid) {
        const s = programSnaps[pid];
        if (!s) return;
        let n = evFindNeed_(loaded, pid);
        if (!n) n = { row_id: Utilities.getUuid(), kind: "need", event_id: pid, _row: null };
        n.event_title = s.title;
        n.event_date = s.date;
        n.needed = String(s.needed);
        n.volunteer_form_id = ""; // will be set after getId() below
        n.volunteer_form_fields = "multi-program";
        n.volunteer_form_template = templateId;
        n.updated_at = now;
        // Temporarily mark; real formId written after creation
        programSnaps[pid]._needObj = n;
      });
      storedFields = "multi-program";

    } else {
      // ── Single-program: choices = time slots entered by user ─────────────
      const slots = Array.isArray(data && data.slots) ? data.slots.filter(Boolean) : [];
      if (slots.length > 0 && tmpl.slotQuestion) {
        const items = form.getItems();
        for (var j = 0; j < items.length; j++) {
          if (items[j].getTitle() === tmpl.slotQuestion) {
            var itype = items[j].getType();
            if (itype === FormApp.ItemType.CHECKBOX) {
              items[j].asCheckboxItem().setChoiceValues(slots);
            } else if (itype === FormApp.ItemType.MULTIPLE_CHOICE) {
              var mc2 = items[j].asMultipleChoiceItem();
              var ht2 = mc2.getHelpText(); var req2 = mc2.isRequired();
              form.deleteItem(items[j]);
              var cb2 = form.addCheckboxItem();
              cb2.setTitle(tmpl.slotQuestion);
              if (ht2) cb2.setHelpText(ht2);
              cb2.setRequired(req2);
              cb2.setChoiceValues(slots);
              var ai2 = form.getItems();
              form.moveItem(ai2.length - 1, j);
            }
            break;
          }
        }
      }
      storedFields = "template:" + templateId;
    }

  // ── Custom path: build form from selected field checkboxes ────────────────
  } else {
    const requestedFields = (Array.isArray(data && data.fields) ? data.fields : [])
      .filter(function (f) {
        return ["area_of_stay", "ie_completion", "volunteer_remarks"].indexOf(f) >= 0;
      });

    form = FormApp.create(formTitle);
    form.setDescription(
      "Register as a volunteer for this program. Name and WhatsApp number are required so we can stay in touch."
    );
    form.setCollectEmail(false);

    form.addTextItem().setTitle("Name").setRequired(true);
    form.addTextItem().setTitle("WhatsApp number").setRequired(true)
      .setHelpText("Include country code if needed, e.g. +91 98765 43210");

    const reqMap = (data && data.fieldRequired) || {};
    if (requestedFields.indexOf("area_of_stay") >= 0) {
      form.addTextItem().setTitle("Area of stay").setRequired(!!reqMap.area_of_stay);
    }
    if (requestedFields.indexOf("ie_completion") >= 0) {
      form.addTextItem().setTitle("IE Completion date")
        .setHelpText("e.g. May-2024")
        .setRequired(!!reqMap.ie_completion);
    }
    if (requestedFields.indexOf("volunteer_remarks") >= 0) {
      form.addParagraphTextItem().setTitle("Remarks if any").setRequired(!!reqMap.volunteer_remarks);
    }
    // Optional checkbox question: volunteers pick from options the coordinator wrote.
    const customOptions = (Array.isArray(data && data.slots) ? data.slots : [])
      .map(function (s) { return String(s || "").trim(); })
      .filter(Boolean);
    const stored = requestedFields.slice();
    if (customOptions.length) {
      const optionTitle = String((data && data.slotQuestionTitle) || "").trim() || "How would you like to volunteer?";
      form.addCheckboxItem().setTitle(optionTitle).setChoiceValues(customOptions).setRequired(true);
      stored.push("custom_options");
    }
    storedFields = stored.join(",");
  }

  applyCustomFields_(form, data);

  // Make the form live (ignore if method not available in this Apps Script version)
  try { form.setPublished(true); } catch (e) { /* ignore */ }

  const formId = form.getId();
  const publishedUrl = form.getPublishedUrl();
  // Reuse stored shortUrl if updating an existing form (avoids re-shortening)
  let shortUrl = (need && need.volunteer_form_short_url && need.volunteer_form_id === formId)
    ? need.volunteer_form_short_url
    : publishedUrl;
  if (shortUrl === publishedUrl) {
    try {
      const maybe = form.shortenFormUrl(publishedUrl);
      if (maybe && maybe.length < publishedUrl.length) shortUrl = maybe;
    } catch (e) {
      Logger.log("shortenFormUrl failed: " + e.message + ". Using full URL.");
    }
  }

  // For multi-program forms: persist choice→eventId mapping in Script Properties
  // so onVolunteerFormSubmit can route responses to the correct program rows.
  if (storedFields === "multi-program" && typeof mapping !== "undefined") {
    try {
      PropertiesService.getScriptProperties()
        .setProperty("vjn_form_map_" + formId, JSON.stringify(mapping));
    } catch (e) {
      Logger.log("Could not store form mapping: " + e.message);
    }
  }

  // Install per-form onFormSubmit trigger (once)
  try {
    const existingTriggers = ScriptApp.getUserTriggers(form);
    const hasSubmit = existingTriggers.some(function (t) {
      return t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT;
    });
    if (!hasSubmit) {
      ScriptApp.newTrigger("onVolunteerFormSubmit")
        .forForm(form)
        .onFormSubmit()
        .create();
    }
  } catch (e) {
    Logger.log("Could not install form trigger: " + e.message);
  }

  // Persist on the need row(s)
  if (templateId && storedFields === "multi-program") {
    // Multi-program: write need row for every included program
    const allSnaps = Object.keys(programSnaps || {});
    allSnaps.forEach(function (pid) {
      const s = programSnaps[pid];
      if (!s || !s._needObj) return;
      const n = s._needObj;
      n.volunteer_form_id = formId;
      n.volunteer_form_short_url = shortUrl;
      if (n._row) evWriteRow_(loaded, n);
      else evAppendRow_(loaded, n);
    });
  } else {
    // Single-program path
    if (!need) {
      need = { row_id: Utilities.getUuid(), kind: "need", event_id: eventId, _row: null };
    }
    need.event_title = snap.title;
    need.event_date = snap.date;
    need.needed = String(snap.needed);
    need.volunteer_form_id = formId;
    need.volunteer_form_short_url = shortUrl;
    need.volunteer_form_fields = storedFields;
    need.volunteer_form_template = templateId || "";
    need.updated_at = now;
    if (need._row) evWriteRow_(loaded, need);
    else evAppendRow_(loaded, need);
  }

  return { success: true, formId: formId, shortUrl: shortUrl, formFields: storedFields, templateId: templateId };
}

/**
 * onFormSubmit trigger — installed automatically when a volunteer form is created.
 * Maps form answers to EventVolunteers rows (kind="volunteer").
 *
 * NOTE: This function must be deployed as part of the Apps Script project.
 *       The trigger is installed per-form by adminCreateProgramVolunteerForm.
 */
function onVolunteerFormSubmit(e) {
  try {
    const formId = e.source.getId();
    const loaded = loadEventVolunteers_();

    // Find need row(s) for this form
    var needRows = [];
    for (var i = 0; i < loaded.rows.length; i++) {
      var r = loaded.rows[i];
      if (r.kind === "need" && r.volunteer_form_id === formId) {
        needRows.push(r);
      }
    }
    if (!needRows.length) return;

    // Parse responses into a map keyed by question title
    var responses = e.response.getItemResponses();
    var answers = {};
    responses.forEach(function (ir) {
      var resp = ir.getResponse();
      // Checkbox questions return an array; join for storage
      answers[ir.getItem().getTitle()] = Array.isArray(resp) ? resp : String(resp || "").trim();
    });

    var name = String(answers["Name"] || "").trim();
    var phone = evDigits_(answers["WhatsApp number"] || answers["WhatsApp Number"] || "");
    if (!name || !phone) return;

    var now = nowIsoKolkata_();

    // ── Multi-program: create one volunteer row per selected program ──────
    var isMulti = needRows.some(function (n) { return (n.volunteer_form_fields || "") === "multi-program"; });

    if (isMulti) {
      // Read choice→eventId mapping from Script Properties (stored at form creation time)
      var mapping = {};
      try {
        var stored = PropertiesService.getScriptProperties()
          .getProperty("vjn_form_map_" + formId);
        if (stored) mapping = JSON.parse(stored);
      } catch (parseErr) { /* fall through to title-match */ }

      // The checkbox question answer is an array of selected program titles
      var slotQuestion = "";
      for (var t = 0; t < FORM_TEMPLATES.length; t++) {
        if (FORM_TEMPLATES[t].type === "multi-program") { slotQuestion = FORM_TEMPLATES[t].slotQuestion; break; }
      }
      var selectedTitles = [];
      if (slotQuestion && Array.isArray(answers[slotQuestion])) {
        selectedTitles = answers[slotQuestion];
      } else {
        // Fallback: any array answer is likely the program choices
        Object.keys(answers).forEach(function (q) {
          if (Array.isArray(answers[q])) selectedTitles = selectedTitles.concat(answers[q]);
        });
      }

      selectedTitles.forEach(function (title) {
        // Find eventId from mapping, or by matching need row title
        var eventId = mapping[title] || "";
        if (!eventId) {
          var matchingNeed = needRows.filter(function (n) { return n.event_title === title; })[0];
          if (matchingNeed) eventId = String(matchingNeed.event_id);
        }
        if (!eventId) return; // unrecognised choice — skip

        var needRow = needRows.filter(function (n) { return String(n.event_id) === eventId; })[0] || needRows[0];

        // Dedup: skip if same phone+event already exists
        var dup = loaded.rows.some(function (row) {
          return row.kind === "volunteer" && String(row.event_id) === eventId && evDigits_(row.phone) === phone;
        });
        if (dup) return;

        evAppendRow_(loaded, {
          row_id: Utilities.getUuid(),
          kind: "volunteer",
          event_id: eventId,
          event_title: needRow ? (needRow.event_title || title) : title,
          volunteer_name: name,
          phone: phone,
          area_of_stay: String(answers["Area of stay"] || "").trim(),
          ie_completion: String(answers["IE completion date, month and year (Ex: May-2023)"] || answers["IE Completion date"] || "").trim(),
          volunteer_remarks: [String(answers["Remarks"] || answers["Remarks if any"] || "").trim(), customFieldsRemark_(formId, answers)].filter(Boolean).join(" | "),
          added_by: "google-form",
          attended: "",
          in_wa_group: "no",
          invite_sent: "no",
          updated_at: now,
        });
      });

    } else {
      // ── Single-program: one need row, one volunteer row ───────────────
      var needRow = needRows[0];
      var eventId = String(needRow.event_id);
      var formFields = (needRow.volunteer_form_fields || "").split(",").filter(Boolean);

      var dup = loaded.rows.some(function (row) {
        return row.kind === "volunteer" && String(row.event_id) === eventId && evDigits_(row.phone) === phone;
      });
      if (dup) return;

      evAppendRow_(loaded, {
        row_id: Utilities.getUuid(),
        kind: "volunteer",
        event_id: eventId,
        event_title: needRow.event_title || "",
        volunteer_name: name,
        phone: phone,
        area_of_stay: formFields.indexOf("area_of_stay") >= 0 ? String(answers["Area of stay"] || "").trim() : "",
        ie_completion: formFields.indexOf("ie_completion") >= 0 ? String(answers["IE Completion date"] || "").trim() : "",
        volunteer_remarks: (function () {
          var remarks = formFields.indexOf("volunteer_remarks") >= 0 ? String(answers["Remarks if any"] || "").trim() : "";
          // Custom forms with a choice question: keep what they picked with the volunteer.
          if (formFields.indexOf("custom_options") >= 0) {
            var chosen = [];
            Object.keys(answers).forEach(function (q) {
              if (Array.isArray(answers[q])) chosen = chosen.concat(answers[q]);
            });
            if (chosen.length) remarks = (remarks ? remarks + " | " : "") + "Chose: " + chosen.join(", ");
          }
          var extrasText = customFieldsRemark_(formId, answers);
          if (extrasText) remarks = (remarks ? remarks + " | " : "") + extrasText;
          return remarks;
        })(),
        added_by: "google-form",
        attended: "",
        in_wa_group: "no",
        invite_sent: "no",
        updated_at: now,
      });
    }
  } catch (err) {
    Logger.log("onVolunteerFormSubmit error: " + err.message);
  }
}

/**
 * ONE-TIME scope authorizer for FormApp.
 * Run this once from the Apps Script editor to approve the Forms + Drive OAuth scopes.
 * After running it and clicking Allow, you can delete this function.
 */
function authorizeFormApp() {
  var form = FormApp.create("_auth_test_delete_me");
  Logger.log("FormApp authorized. Test form URL: " + form.getPublishedUrl());
  try { DriveApp.getFileById(form.getId()).setTrashed(true); } catch (e) {}
  Logger.log("Test form trashed. Authorization complete — you can delete this function now.");
}

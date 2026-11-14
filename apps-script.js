// =============================================
// Isha Place, Vijayanagar — Google Apps Script
//
// WHAT THIS IS NOW: the Sandesha database on the Pi (sandesha-server/) is the SOURCE OF TRUTH
// for all data and runs the admin logins. This script is NOT the system of record. It only does
// what needs Google: Forms, Slides flyers, Drive images, the volunteer roster sheet, a Sheet
// COPY (backup / reporting tabs) that the Pi keeps up to date, and a temporary buffer for form
// submissions while the Pi is down. Never edit data in the Sheet: it is overwritten by the Pi.
//
// FIRST-TIME SETUP (Apps Script editor):
// 1. Click Save (disk icon).
// 2. At the top, choose function: setupDrive
// 3. Click Run.
// 4. Review permissions -> your Google account -> Advanced ->
//    Go to Centre Website (unsafe) -> Allow.
//    That screen is where Drive access is granted. Deploying
//    a web app does NOT show it.
// 5. Deploy -> Manage deployments -> pencil -> New version -> Deploy.
//
// Admin sign-in is handled by Sandesha (the Pi), not here.
// =============================================

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
  // where a volunteer row came from (admin | google-form | walk-in) and when they checked in
  "source",
  "checked_in",
  "checked_in_at",
];

// Volunteer check-ins: one tab per month ("Oct 2026"), written by the Pi's mirror.
// They go to a separate Google Sheet linked once with setCheckinSheet("<sheet URL or ID>")
// (run from the Apps Script editor). Until it is linked, the tabs are made in this spreadsheet.
const CHECKIN_SHEET_ID_PROP = "CHECKIN_SHEET_ID";
// Volunteer interests entered by the team (the vol_interests table): one tab per month, in their own Google Sheet (link it with setInterestSheet).
const INTEREST_SHEET_ID_PROP = "INTEREST_SHEET_ID";
// Only these go to the sheet: nothing else about a person is copied there.
const INTEREST_HEADERS = [
  "Name",
  "WhatsApp Number",
  "IE Completion Date",
  "Source",
  "Volunteer Remarks",
  "Calling Remarks",
];
const CHECKIN_HEADERS = [
  "Timestamp",
  "Program Date",
  "Program Name",
  "Name",
  "Phone",
  "Area",
  "IE Completion",
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
  "language",
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
const USER_DISABLED_PREFIX = "user_disabled_";
const DISABLED_USER_IDS_PROP = "DISABLED_USER_IDS";
// Logins live on the Sandesha Pi (sandesha-server/vjn-users.js) once this
// Script Property is set to the same value as the Pi's VJN_AUTH_SECRET.
const VJN_AUTH_SECRET_PROP = "VJN_AUTH_SECRET";
const VJN_REVOKED_PREFIX = "vjn_rev_";
// Set by vjnExportPromos_: the Pi owns promotion posts from then on, and the
// Promotions tab is left as a read-only record of what was there.
const VJN_PROMOS_ON_PI_PROP = "VJN_PROMOS_ON_PI";
// Set by vjnExportAll_: the Pi owns programs, volunteering, site text,
// enquiries and event volunteers. The tabs are then a copy the Pi keeps up to
// date (vjnMirror), read when the Pi is down; the Sheet takes no admin edits.
const VJN_DATA_ON_PI_PROP = "VJN_DATA_ON_PI";
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

    if (formType === "vjnRevoke") {
      return json_(vjnRevoke_(data));
    }
    if (formType === "vjnExportUsers") {
      return json_(vjnExportUsers_(data));
    }
    if (formType === "vjnExportPromos") {
      return json_(vjnExportPromos_(data));
    }
    if (formType === "vjnListings") {
      return json_(vjnListings_(data));
    }
    if (formType === "vjnExportAll") {
      return json_(vjnExportAll_(data));
    }
    if (formType === "vjnMirror") {
      return json_(vjnMirror_(data));
    }
    if (formType === "vjnReadSheet") return json_(vjnReadSheet_(data));
    if (formType === "vjnLockSheet") return json_(vjnLockSheet_(data));
    if (formType === "vjnCreateSheet") {
      return json_(vjnCreateSheet_(data));
    }
    if (formType === "vjnExportRoster") {
      requireVjnSecret_(data);
      return json_(getVolunteerRoster_());
    }
    if (formType === "vjnInboxList") {
      return json_(vjnInboxList_(data));
    }
    if (formType === "vjnInboxAck") {
      return json_(vjnInboxAck_(data));
    }
    if (formType === "adminGet") {
      return json_(adminRead_(data));
    }
    if (formType === "adminGetMany") {
      return json_(adminReadMany_(data));
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
    if (formType === "adminCreateProgramVolunteerForm") {
      return json_(adminCreateProgramVolunteerForm(data));
    }
    if (formType === "adminListVolunteerForms") {
      return json_(adminListVolunteerForms(data));
    }
    if (formType === "adminInspectVolunteerForm") {
      return json_(adminInspectVolunteerForm(data));
    }
    if (formType === "adminConnectProgramVolunteerForm") {
      return json_(adminConnectProgramVolunteerForm(data));
    }

    return json_({
      error:
        "Unknown formType. Use homeQuery, programInterest, programVolunteer, volunteeringInterest, volunteerAttendance, or admin actions.",
    });
  } catch (err) {
    return json_({ error: err.message });
  }
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

function userDisabledKey_(userId) {
  return USER_DISABLED_PREFIX + String(userId);
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
}

function clearUserDisabled_(userId) {
  if (!userId) return;
  persistUserDisabled_(userId, false);
  CacheService.getScriptCache().remove(userDisabledKey_(userId));
}

function readSession_(token) {
  // Only logins signed by the Sandesha Pi ("v1.…") exist now.
  if (!token || String(token).indexOf("v1.") !== 0) return { reason: "expired" };
  return readSignedSession_(token);
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

function requireLiveSession_(token) {
  // A Pi login was checked against the revocation list already.
  return requireSession_(token);
}

function requireRole_(token, allowedRoles) {
  const session = requireLiveSession_(token);
  const allowed = allowedRoles || [];
  if (allowed.indexOf(session.role) < 0) {
    throw new Error("You do not have access to this.");
  }
  return session;
}

/* ───────── logins signed by the Sandesha Pi ───────── */

function vjnSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty(VJN_AUTH_SECRET_PROP) || "");
}

function webSafe_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}

function fromWebSafe_(str) {
  let s = String(str || "");
  while (s.length % 4) s += "=";
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString();
}

/** "v1.<payload>.<sig>" — see sandesha-server/vjn-users.js. */
function readSignedSession_(token) {
  const secret = vjnSecret_();
  const parts = String(token).split(".");
  if (!secret || parts.length !== 3) return { reason: "expired" };
  const expected = webSafe_(Utilities.computeHmacSha256Signature("v1." + parts[1], secret));
  if (expected !== parts[2]) return { reason: "expired" };
  let p;
  try {
    p = JSON.parse(fromWebSafe_(parts[1]));
  } catch (err) {
    return { reason: "expired" };
  }
  if (!p || !p.uid || !(p.exp > Date.now())) return { reason: "expired" };
  if (isPersistentlyDisabled_(p.uid)) return { reason: "disabled" };
  const revokedBefore = Number(PropertiesService.getScriptProperties().getProperty(VJN_REVOKED_PREFIX + p.uid) || 0);
  if (p.iat < revokedBefore) return { reason: "expired" };
  return {
    session: { id: p.uid, username: p.u, displayName: p.n || p.u, role: normalizeRole_(p.r), signed: true },
  };
}

function requireVjnSecret_(data) {
  const secret = vjnSecret_();
  if (!secret || String((data && data.secret) || "") !== secret) throw new Error("Unauthorized.");
}

/** The Pi disabled someone or changed their team/password. */
function vjnRevoke_(data) {
  requireVjnSecret_(data);
  const id = String(data.id || "").trim();
  if (!id) throw new Error("id required");
  const props = PropertiesService.getScriptProperties();
  const before = Number(data.before || 0);
  if (before) props.setProperty(VJN_REVOKED_PREFIX + id, String(before));
  if (data.disabled) markUserDisabled_(id);
  else clearUserDisabled_(id);
  return { success: true };
}

/** One-off copy of the Users tab for the Pi (scripts/import-users.js). */
function vjnExportUsers_(data) {
  requireVjnSecret_(data);
  return {
    users: loadUsers_().users.map(function (u) {
      return {
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        role: u.role,
        password_salt: u.password_salt,
        password_hash: u.password_hash,
        status: u.status,
        created_at: u.created_at,
      };
    }),
  };
}

/**
 * Hands the Promotions tab to the Pi and stops the Sheet taking promotion
 * writes. Safe to run again: it only reads.
 */
function vjnExportPromos_(data) {
  requireVjnSecret_(data);
  const loaded = loadPromos_();
  PropertiesService.getScriptProperties().setProperty(VJN_PROMOS_ON_PI_PROP, "1");
  return {
    promos: loaded.items.map(function (item) {
      const row = {};
      PROMO_HEADERS.forEach(function (h) {
        row[h] = item[h] === undefined || item[h] === null ? "" : String(item[h]);
      });
      return row;
    }),
  };
}

/** Programs and volunteering listings, for the Pi to build posts from. */
function vjnListings_(data) {
  requireVjnSecret_(data);
  const out = {};
  ["programs", "volunteering"].forEach(function (resource) {
    const sheetName = resource === "programs" ? PROGRAMS_SHEET : VOLUNTEER_SHEET;
    out[resource] = (getAllItems(sheetName, true).items || []).map(function (item) {
      return {
        id: String(item.id),
        title: item.title || "",
        date: item.date || "",
        startdate: item.startdate || "",
        location: item.location || "",
        status: item.status || "",
        image: item.image || "",
      };
    });
  });
  return out;
}

/**
 * Need-row changes made by the form functions. While the Pi owns the data the
 * Sheet is only a copy, so instead of writing them here they are handed back
 * to the page, which gives them to the Pi (adminSetVolunteerForm).
 */
function needRelay_(need, extra) {
  return {
    event_id: String(need.event_id),
    event_title: need.event_title || "",
    event_date: need.event_date || "",
    needed: String(need.needed || ""),
    volunteer_form_id: need.volunteer_form_id || "",
    volunteer_form_short_url: need.volunteer_form_short_url || "",
    volunteer_form_fields: need.volunteer_form_fields || "",
    volunteer_form_template: need.volunteer_form_template || "",
  };
}

/** Ask the Pi to collect rows the Sheet just received (form responses). Best effort. */
function pokePi_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const base = String(props.getProperty("SANDESHA_API_URL") || "").replace(/\/$/, "");
    if (!base) return;
    UrlFetchApp.fetch(base + "/vjn/internal/drain", {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({ secret: vjnSecret_() }),
    });
  } catch (err) {
    // The Pi collects them on its own within minutes.
  }
}

/**
 * Sends Google Form responses straight to the Pi, which saves them in its database. Only a response the Pi could
 * not take (it is down, or does not know the program) is written to the EventVolunteers tab, and the Pi collects
 * it from there later. Returns one result per row: "added", "duplicate" or "parked".
 */
function deliverVolunteerRows_(loaded, rows) {
  let results = [];
  if (rows.length && dataOnPi_()) {
    try {
      const base = String(PropertiesService.getScriptProperties().getProperty("SANDESHA_API_URL") || "").replace(/\/$/, "");
      if (base) {
        const res = UrlFetchApp.fetch(base + "/vjn/internal/form-responses", {
          method: "post",
          contentType: "application/json",
          muteHttpExceptions: true,
          payload: JSON.stringify({ secret: vjnSecret_(), rows: rows }),
        });
        if (res.getResponseCode() === 200) results = JSON.parse(res.getContentText()).results || [];
      }
    } catch (err) {
      results = [];
    }
  }
  const outcome = rows.map(function (row, i) {
    if (results[i] === "added" || results[i] === "duplicate") return results[i];
    evAppendRow_(loaded, row);
    return "parked";
  });
  if (outcome.indexOf("parked") >= 0 && dataOnPi_()) pokePi_();
  return outcome;
}

/** True once the data has been moved into the Pi database (the source of truth). Until then this Sheet still answers. */
function dataOnPi_() {
  return PropertiesService.getScriptProperties().getProperty(VJN_DATA_ON_PI_PROP) === "1";
}

/** Which tab and key column each mirrored table lives in. */
function vjnTable_(tbl) {
  if (tbl === "programs") return { sheet: PROGRAMS_SHEET, headers: PROGRAM_HEADERS.concat(["id"]), key: "id" };
  if (tbl === "volunteering") return { sheet: VOLUNTEER_SHEET, headers: VOLUNTEER_HEADERS.concat(["id"]), key: "id" };
  if (tbl === "site") return { sheet: SITE_SHEET, headers: ["key", "value"], key: "key" };
  if (tbl === "programTitles") return { sheet: PROGRAM_TITLES_SHEET, headers: PROGRAM_TITLE_HEADERS, key: "title" };
  if (tbl === "promos") return { sheet: PROMOTIONS_SHEET, headers: PROMO_HEADERS, key: "id" };
  if (tbl === "checkins") return { sheet: "", headers: CHECKIN_HEADERS.concat(["id"]), key: "id", monthly: true };
  if (tbl === "ev") return { sheet: EVENT_VOLUNTEERS_SHEET, headers: EV_HEADERS.concat(["pi_synced"]), key: "row_id" };
  if (tbl === "volInterests") {
    return { sheet: "", headers: INTEREST_HEADERS.concat(["id"]), key: "id", monthly: true, bookProp: INTEREST_SHEET_ID_PROP };
  }
  const m = String(tbl).match(/^inquiries:(.+)$/);
  const def = m ? inquiryDefByKey_(m[1]) : null;
  if (def) return { sheet: def.sheet, headers: def.headers.concat(["id"]), key: "id", inquiry: def };
  throw new Error("Unknown table " + tbl);
}

function sheetHeadersLower_(sheet) {
  return sheet
    .getRange(1, 1, 1, sheet.getLastColumn() || 1)
    .getValues()[0]
    .map(function (h) {
      return h.toString().trim().toLowerCase();
    });
}

/**
 * The Pi's changes, copied into the Sheet. ops: [{ tbl, op: upsert|delete, key, row }].
 * A row is found by its key column (id / row_id / key / title), so it does not
 * matter where it sits in the tab.
 */
function vjnMirror_(data) {
  requireVjnSecret_(data);
  const ops = Array.isArray(data.ops) ? data.ops : [];
  const byTbl = {};
  ops.forEach(function (op) {
    (byTbl[op.tbl] = byTbl[op.tbl] || []).push(op);
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    Object.keys(byTbl).forEach(function (tbl) {
      mirrorTable_(tbl, byTbl[tbl]);
    });
  } finally {
    lock.releaseLock();
  }
  invalidatePublicCache_();
  return { success: true, applied: ops.length };
}

/** Links the separate Google Sheet that holds the monthly check-in tabs. */
function setCheckinSheet(urlOrId) {
  const m = String(urlOrId || "").match(/\/d\/([a-zA-Z0-9_-]+)/);
  const id = m ? m[1] : String(urlOrId || "").trim();
  if (!id) throw new Error("Pass the sheet URL or ID.");
  SpreadsheetApp.openById(id); // fail now if there is no access
  PropertiesService.getScriptProperties().setProperty(CHECKIN_SHEET_ID_PROP, id);
}

/** Editor-friendly: paste the sheet URL below, Save, then Run this once. */
function linkCheckinSheet() {
  setCheckinSheet("https://docs.google.com/spreadsheets/d/115JS1CN6QmCSPbb5FnQvvC-OeswrUkE8lRkaXP19mNA/edit?gid=0#gid=0");
}

/** "2026-10" -> "Oct 2026". */
function checkinTabName_(month) {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = String(month).match(/^(\d{4})-(\d{2})$/);
  return m ? names[parseInt(m[2], 10) - 1] + " " + m[1] : String(month);
}

function checkinBook_() {
  const id = PropertiesService.getScriptProperties().getProperty(CHECKIN_SHEET_ID_PROP);
  return id ? SpreadsheetApp.openById(id) : null;
}

/** Links the Google Sheet that holds the monthly volunteering-interest tabs. */
function setInterestSheet(urlOrId) {
  const m = String(urlOrId || "").match(/\/d\/([a-zA-Z0-9_-]+)/);
  const id = m ? m[1] : String(urlOrId || "").trim();
  if (!id) throw new Error("Pass the sheet URL or ID.");
  SpreadsheetApp.openById(id); // fail now if there is no access
  PropertiesService.getScriptProperties().setProperty(INTEREST_SHEET_ID_PROP, id);
}

/** Editor-friendly: paste the sheet URL below, Save, then Run this once. */
function linkInterestSheet() {
  setInterestSheet("https://docs.google.com/spreadsheets/d/1dKgFyZKsflslOPp-VwvebgBZlEPZDmhI0ENVP8VPLGE/edit?gid=0#gid=0");
}

/** A tab with the given header row in another spreadsheet, made if missing. */
function ensureTabIn_(book, name, headers) {
  let sheet = book.getSheetByName(name);
  if (sheet) return sheet;
  sheet = book.insertSheet(name);
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#c8a96e");
  // The id only lets the mirror find a row again; people reading the sheet don't need it.
  const idAt = headers.indexOf("id");
  if (idAt >= 0) sheet.hideColumns(idAt + 1);
  return sheet;
}

function mirrorTable_(tbl, ops) {
  const t = vjnTable_(tbl);
  if (t.monthly) {
    const byMonth = {};
    ops.forEach(function (op) {
      const month = String((op.row && op.row.month) || "").trim();
      if (!/^\d{4}-\d{2}$/.test(month)) return;
      (byMonth[month] = byMonth[month] || []).push(op);
    });
    const bookId = t.bookProp ? PropertiesService.getScriptProperties().getProperty(t.bookProp) : "";
    const book = (t.bookProp ? (bookId ? SpreadsheetApp.openById(bookId) : null) : checkinBook_()) || ss_();
    Object.keys(byMonth).forEach(function (month) {
      mirrorRows_(t, checkinTabName_(month), byMonth[month], book);
    });
    return;
  }
  mirrorRows_(t, t.sheet, ops);
}

/** Columns that must stay exactly as written: Sheets would turn "+9198…" into a number and "May-2021" into a date. */
const TEXT_COLUMNS_ = ["timestamp", "whatsapp", "phone", "whatsapp number", "ie completion", "ie completion date", "opportunity id", "id"];

function setTextColumns_(sheet, headers) {
  TEXT_COLUMNS_.forEach(function (name) {
    const ix = headers.indexOf(name);
    if (ix >= 0) sheet.getRange(2, ix + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat("@");
  });
}

function mirrorRows_(t, sheetName, ops, book) {
  const sheet = book ? ensureTabIn_(book, sheetName, t.headers) : (ensureSheet_(sheetName, t.headers), ss_().getSheetByName(sheetName));
  const headers = sheetHeadersLower_(sheet);
  if (book) setTextColumns_(sheet, headers);
  const keyIx = headers.indexOf(t.key);
  if (keyIx < 0) throw new Error(sheetName + " has no " + t.key + " column.");
  const lastRow = sheet.getLastRow();
  const keys = lastRow > 1 ? sheet.getRange(2, keyIx + 1, lastRow - 1, 1).getValues() : [];
  const rowOf = {};
  keys.forEach(function (r, i) {
    const k = String(r[0]).trim();
    if (k) rowOf[k] = i + 2;
  });
  const removals = [];
  ops.forEach(function (op) {
    const key = String(op.key);
    if (op.op === "delete") {
      if (rowOf[key]) removals.push(rowOf[key]);
      return;
    }
    const row = op.row || {};
    const at = rowOf[key];
    const current = at ? sheet.getRange(at, 1, 1, headers.length).getValues()[0] : null;
    const values = headers.map(function (h, i) {
      if (h === t.key) return key;
      if (h === "pi_synced") return "1";
      if (row[h] !== undefined && row[h] !== null) return String(row[h]);
      return current ? current[i] : "";
    });
    if (at) {
      sheet.getRange(at, 1, 1, headers.length).setValues([values]);
    } else {
      sheet.appendRow(values);
      rowOf[key] = sheet.getLastRow();
    }
  });
  removals
    .sort(function (a, b) {
      return b - a;
    })
    .forEach(function (r) {
      sheet.deleteRow(r);
    });
}

/**
 * One-off copy of everything the Pi will own (scripts/import-data.js). Gives
 * every existing row an id first (its position, which is what the pages have
 * been using), so later rows without an id are known to be new.
 */
function vjnExportAll_(data) {
  requireVjnSecret_(data);
  const out = { programs: [], volunteering: [], site: [], programTitles: [], inquiries: {}, ev: [] };

  [["programs", PROGRAMS_SHEET, PROGRAM_HEADERS], ["volunteering", VOLUNTEER_SHEET, VOLUNTEER_HEADERS]].forEach(function (r) {
    ensureSheet_(r[1], r[2].concat(["id"]));
    const sheet = ss_().getSheetByName(r[1]);
    const rows = sheet.getDataRange().getValues();
    const headers = sheetHeadersLower_(sheet);
    const idIx = headers.indexOf("id");
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      const item = rowToItem_(headers, rows[i], i);
      if (idIx >= 0 && String(rows[i][idIx]).trim()) item.id = String(rows[i][idIx]).trim();
      else sheet.getRange(i + 1, idIx + 1).setValue(String(i));
      out[r[0]].push(item);
    }
  });

  const siteSheet = ensureSheet_(SITE_SHEET, ["key", "value"]);
  siteSheet.getDataRange().getValues().forEach(function (row, i) {
    if (i > 0 && String(row[0] || "").trim()) out.site.push({ key: String(row[0]).trim(), value: row[1] === undefined || row[1] === null ? "" : String(row[1]) });
  });

  ensureSheet_(PROGRAM_TITLES_SHEET, PROGRAM_TITLE_HEADERS);
  ss_().getSheetByName(PROGRAM_TITLES_SHEET).getDataRange().getValues().forEach(function (row, i) {
    if (i > 0 && String(row[0] || "").trim()) out.programTitles.push({ title: String(row[0]).trim(), active: String(row[1] || "yes").trim() });
  });

  INQUIRY_DEFS.forEach(function (def) {
    const sheet = ensureSheet_(def.sheet, def.headers.concat(["id"]));
    const rows = sheet.getDataRange().getValues();
    const headers = sheetHeadersLower_(sheet);
    const idIx = headers.indexOf("id");
    out.inquiries[def.key] = [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].some(function (c) { return String(c || "").trim() !== ""; })) continue;
      const item = { id: String(i) };
      headers.forEach(function (h, ix) {
        if (h !== "id") item[h] = rows[i][ix] === undefined || rows[i][ix] === null ? "" : String(rows[i][ix]).trim();
      });
      if (idIx >= 0 && String(rows[i][idIx]).trim()) item.id = String(rows[i][idIx]).trim();
      else sheet.getRange(i + 1, idIx + 1).setValue(String(i));
      out.inquiries[def.key].push(item);
    }
  });

  ensureSheet_(EVENT_VOLUNTEERS_SHEET, EV_HEADERS.concat(["pi_synced"]));
  const ev = loadEventVolunteers_();
  const evSyncIx = ev.headers.indexOf("pi_synced");
  ev.rows.forEach(function (r) {
    if (evSyncIx >= 0) ev.sheet.getRange(r._row, evSyncIx + 1).setValue("1");
    const row = {};
    Object.keys(r).forEach(function (k) {
      if (k.charAt(0) !== "_") row[k] = r[k];
    });
    out.ev.push(row);
  });

  PropertiesService.getScriptProperties().setProperty(VJN_DATA_ON_PI_PROP, "1");
  return out;
}

/* ── Google Sheets made for the Pi (volunteer campaigns and exports) ───────────── */
const VOLUNTEER_SHEETS_FOLDER_PROP = "VOLUNTEER_SHEETS_FOLDER_ID";
const VOLUNTEER_SHEET_MAX_ROWS = 5000;

function volunteerSheetsFolder_() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty(VOLUNTEER_SHEETS_FOLDER_PROP);
  if (saved) {
    try {
      return DriveApp.getFolderById(saved);
    } catch (e) {
      // the folder was deleted: make a new one below
    }
  }
  const folder = DriveApp.createFolder("Volunteer campaigns");
  props.setProperty(VOLUNTEER_SHEETS_FOLDER_PROP, folder.getId());
  return folder;
}

/**
 * A new Google Sheet for the Pi: a header row and the rows it sends, kept exactly as written (so "+9198…" stays a
 * number with its plus and "May-2024" stays text), filed in the "Volunteer campaigns" folder, and editable by anyone
 * who has the link (callers add their notes in it). data.dropdowns { "Column name": [choices] } turns those columns
 * into dropdowns; a value that is not in the list is still allowed. Returns its id and link.
 */
function vjnCreateSheet_(data) {
  requireVjnSecret_(data);
  const headers = Array.isArray(data.headers) ? data.headers.map(String) : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!headers.length) throw new Error("No columns to write.");
  if (rows.length > VOLUNTEER_SHEET_MAX_ROWS) throw new Error("Too many rows (max " + VOLUNTEER_SHEET_MAX_ROWS + ").");
  const book = SpreadsheetApp.create(String(data.title || "Volunteers").slice(0, 100));
  const sheet = book.getSheets()[0];
  sheet.setName("Volunteers");
  const width = headers.length;
  sheet.getRange(1, 1, rows.length + 1, width).setNumberFormat("@");
  sheet.getRange(1, 1, 1, width).setValues([headers]).setFontWeight("bold").setBackground("#c8a96e");
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, width).setValues(
      rows.map(function (r) {
        return headers.map(function (h, i) {
          return r[i] === undefined || r[i] === null ? "" : String(r[i]);
        });
      })
    );
  }
  const dropdowns = data.dropdowns && typeof data.dropdowns === "object" ? data.dropdowns : {};
  headers.forEach(function (h, i) {
    const choices = Array.isArray(dropdowns[h]) ? dropdowns[h].map(String).filter(Boolean) : [];
    if (!choices.length || !rows.length) return;
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(choices, true).setAllowInvalid(true).build();
    sheet.getRange(2, i + 1, rows.length, 1).setDataValidation(rule);
  });
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, width);
  // Callers can only fill the columns named in data.editable: the header, the fixed columns and the rows are protected,
  // and nothing can be inserted or deleted.
  const editable = Array.isArray(data.editable) ? data.editable.map(String) : [];
  if (editable.length && rows.length) {
    const open = [];
    headers.forEach(function (h, i) {
      if (editable.indexOf(h) >= 0) open.push(sheet.getRange(2, i + 1, rows.length, 1));
    });
    vjnProtectSheet_(sheet, open);
  }
  const file = DriveApp.getFileById(book.getId());
  volunteerSheetsFolder_().addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
  return { success: true, id: book.getId(), url: book.getUrl() };
}

/** Protect a whole tab so only the owner (this script) edits it, except the given ranges, which anyone with the link may. */
function vjnProtectSheet_(sheet, openRanges) {
  sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  const p = sheet.protect().setDescription("Campaign sheet");
  p.setUnprotectedRanges(openRanges || []);
  // Everyone but the owner (the owner cannot be removed) loses edit rights on the protected parts.
  p.getEditors().forEach(function (u) {
    try { p.removeEditor(u); } catch (e) { /* the owner stays */ }
  });
  if (p.canDomainEdit()) p.setDomainEdit(false);
}

/** The header row and every filled row of a campaign sheet, as the callers left it (what they see, as text). */
function vjnReadSheet_(data) {
  requireVjnSecret_(data);
  const book = SpreadsheetApp.openById(String(data.id || ""));
  const sheet = book.getSheets()[0];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };
  const values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  return { headers: values[0].map(function (h) { return String(h).trim(); }), rows: values.slice(1) };
}

/** Closing a campaign: the whole sheet becomes view-only for everyone with the link. */
function vjnLockSheet_(data) {
  requireVjnSecret_(data);
  const id = String(data.id || "");
  const book = SpreadsheetApp.openById(id);
  book.getSheets().forEach(function (sheet) { vjnProtectSheet_(sheet, []); });
  DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { success: true };
}

/** A sheet cell as text. A date cell (Sheets turns "May-2021" into one) is written back as "May-2021". */
function inboxCellText_(header, value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return header.indexOf("ie") === 0
      ? Utilities.formatDate(value, PROGRAM_TZ_, "MMM-yyyy")
      : Utilities.formatDate(value, PROGRAM_TZ_, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return value === undefined || value === null ? "" : String(value).trim();
}

/** Submissions made while the Pi was unreachable: rows with no id yet. */
function vjnInboxList_(data) {
  requireVjnSecret_(data);
  const out = [];
  INQUIRY_DEFS.forEach(function (def) {
    const sheet = ss_().getSheetByName(def.sheet);
    if (!sheet || sheet.getLastRow() < 2) return;
    const headers = sheetHeadersLower_(sheet);
    const idIx = headers.indexOf("id");
    if (idIx < 0) return;
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    rows.forEach(function (row, i) {
      if (String(row[idIx]).trim()) return;
      if (!row.some(function (c) { return String(c || "").trim() !== ""; })) return;
      const rec = {};
      headers.forEach(function (h, ix) {
        if (h !== "id") rec[h] = inboxCellText_(h, row[ix]);
      });
      out.push({ tbl: "inquiries:" + def.key, row: i + 2, data: rec });
    });
  });
  // Volunteers added by a Google Form response (or a form being connected)
  // while the Pi was not told: rows with a row_id but not yet marked synced.
  const evSheet = ss_().getSheetByName(EVENT_VOLUNTEERS_SHEET);
  if (evSheet && evSheet.getLastRow() > 1) {
    const eh = sheetHeadersLower_(evSheet);
    const syncIx = eh.indexOf("pi_synced");
    const rowIdIx = eh.indexOf("row_id");
    if (syncIx >= 0 && rowIdIx >= 0) {
      evSheet.getRange(2, 1, evSheet.getLastRow() - 1, eh.length).getValues().forEach(function (row, i) {
        if (!String(row[rowIdIx]).trim() || String(row[syncIx]).trim()) return;
        const rec = {};
        eh.forEach(function (h, ix) {
          if (h !== "pi_synced") rec[h] = row[ix] === undefined || row[ix] === null ? "" : String(row[ix]).trim();
        });
        out.push({ tbl: "ev", row: i + 2, data: rec });
      });
    }
  }
  return { rows: out };
}

/** The Pi took these rows in and gave them ids; write the ids so they are not sent again. */
function vjnInboxAck_(data) {
  requireVjnSecret_(data);
  const acks = Array.isArray(data.acks) ? data.acks : [];
  acks.forEach(function (a) {
    const t = vjnTable_(a.tbl);
    const sheet = ss_().getSheetByName(t.sheet);
    if (!sheet) return;
    const col = a.tbl === "ev" ? "pi_synced" : "id";
    const ix = sheetHeadersLower_(sheet).indexOf(col);
    if (ix >= 0) sheet.getRange(Number(a.row), ix + 1).setValue(a.tbl === "ev" ? "1" : String(a.id));
  });
  return { success: true };
}

/**
 * Several adminGet reads in one request. Each web-app call pays ~1.5s of
 * fixed overhead, so the hub's six counts cost one round trip, not six.
 * data.reads: [{ type, ...extra }]. A failed read becomes { error } in its
 * slot instead of failing the whole batch.
 */
function adminReadMany_(data) {
  const reads = Array.isArray(data && data.reads) ? data.reads.slice(0, 12) : [];
  return {
    results: reads.map(function (r) {
      try {
        return adminRead_(Object.assign({}, r, { token: data.token }));
      } catch (err) {
        return { error: err.message };
      }
    }),
  };
}

function adminRead_(data) {
  const type = String((data && data.type) || "");
  const token = data && data.token;
  const id = data && data.id;

  if (type === "volunteerRoster") {
    requireRole_(token, ["admin", "nurturing"]);
    return getVolunteerRoster_();
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
  // The Pi closes listings itself and copies the result here.
  if (!dataOnPi_()) sheet.getRange(rowIndex1Based, statusIx + 1).setValue(closedValue);
  row[statusIx] = closedValue;
  return row;
}

/** A row's id: its id column once the Pi has copied the tab, else its position. */
function listingRowId_(headers, row, position) {
  const ix = headers.indexOf("id");
  const v = ix >= 0 ? String(row[ix] === undefined || row[ix] === null ? "" : row[ix]).trim() : "";
  return v || String(position);
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

function isClosedStatus_(raw) {
  const s = normalizeProgramStatusValue_(raw);
  return s === "closed" || s === "inactive";
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

    const item = rowToItem_(headers, row, listingRowId_(headers, row, i));
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
  let rowIndex = parseInt(id, 10);
  const idCol = headers.indexOf("id");
  if (idCol >= 0) {
    rowIndex = -1;
    for (let r = 1; r < rows.length; r++) {
      if (String(rows[r][idCol]).trim() === String(id).trim()) {
        rowIndex = r;
        break;
      }
    }
  }

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

function inquiryDefByKey_(key) {
  for (let i = 0; i < INQUIRY_DEFS.length; i++) {
    if (INQUIRY_DEFS[i].key === key) return INQUIRY_DEFS[i];
  }
  return null;
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
      const v = map[h] === undefined || map[h] === null ? "" : map[h];
      // A leading apostrophe makes Sheets keep it as typed ("+91…" stays a number with its +, "May-2021" stays text).
      return v !== "" && (h === "whatsapp" || h === "ie completion") ? "'" + v : v;
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

function isOpenListingStatus_(raw) {
  const s = normalizeProgramStatusValue_(raw);
  if (!s) return true;
  return s === "open" || s === "active";
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

/* ================================================================
   Event volunteers — Nurturing recruits, tracks attendance, and
   pushes attendees into a general WhatsApp group after the event.
   One sheet (EVENT_VOLUNTEERS_SHEET), "kind" column: need | volunteer.
   ================================================================ */

function evSheet_() {
  return ensureSheet_(EVENT_VOLUNTEERS_SHEET, EV_HEADERS);
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

function evFindNeed_(loaded, eventId) {
  const id = String(eventId || "");
  for (let i = 0; i < loaded.rows.length; i++) {
    if (loaded.rows[i].kind === "need" && String(loaded.rows[i].event_id) === id) return loaded.rows[i];
  }
  return null;
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
  const relayNeeds = [];   // need rows for the Pi to keep (see needRelay_)

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
      if (dataOnPi_()) {
        relayNeeds.push(needRelay_(n));
        return;
      }
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
    if (dataOnPi_()) relayNeeds.push(needRelay_(need));
    else if (need._row) evWriteRow_(loaded, need);
    else evAppendRow_(loaded, need);
  }

  return {
    success: true,
    formId: formId,
    shortUrl: shortUrl,
    formFields: storedFields,
    templateId: templateId,
    needs: relayNeeds,
  };
}

/* ── Connect an existing Google Form ─────────────────────────────────────────
 * For a form someone already made by hand: read its questions, let Nurturing
 * confirm which question is the name / WhatsApp number / area / IE date /
 * remarks, then pull in its existing responses and every new one (via the same
 * onVolunteerFormSubmit trigger generated forms use). The form is not changed.
 *
 * The forms live in this script's own Google account, so they can be listed
 * to pick from; a pasted share link (forms.gle / …/viewform) is matched back
 * to its form among them.
 */
const CONNECT_FORM_FIELDS_ = [
  { key: "name", re: /\bname\b/i, not: /program|group|father|mother|parent|company|organi[sz]ation|college|school|guardian/i },
  { key: "phone", re: /whats\s*app|phone|mobile|contact\s*(no|num)|cell/i, not: /emergency|alternate|guardian|parent/i },
  { key: "area", re: /area|locality|location|stay|reside|address|place|city/i },
  { key: "ie", re: /inner\s*engineering|\bie\b|shambhavi/i },
  { key: "remarks", re: /remark|comment|note|anything else|message|suggestion/i },
];
const CONNECT_ANSWERABLE_ = ["TEXT", "PARAGRAPH_TEXT", "MULTIPLE_CHOICE", "CHECKBOX", "LIST", "DATE", "DATETIME", "TIME", "SCALE"];

function formIdFromLink_(raw) {
  let s = String(raw || "").trim();
  if (!s) throw new Error("Pick a form or paste its link.");
  // forms.gle short link → the …/forms/d/e/{publishedId}/viewform it points at.
  if (/forms\.gle\//i.test(s)) {
    try {
      const res = UrlFetchApp.fetch(s, { followRedirects: false, muteHttpExceptions: true });
      const loc = res.getHeaders().Location || res.getHeaders().location || "";
      if (loc) s = String(loc);
    } catch (e) { /* fall through to the error below */ }
  }
  const pub = s.match(/\/forms\/d\/e\/([a-zA-Z0-9_-]{20,})/);
  if (pub) return formIdFromPublishedId_(pub[1]);
  const m = s.match(/\/forms\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/^([a-zA-Z0-9_-]{25,})$/);
  if (!m) throw new Error("That doesn't look like a Google Form link.");
  return m[1];
}

/** A share link only carries the published id; find which of our forms it is. */
function formIdFromPublishedId_(publishedId) {
  const files = DriveApp.searchFiles('mimeType = "' + MimeType.GOOGLE_FORMS + '" and trashed = false');
  let checked = 0;
  while (files.hasNext() && checked < 200) {
    const f = files.next();
    checked++;
    try {
      if (FormApp.openById(f.getId()).getPublishedUrl().indexOf(publishedId) >= 0) return f.getId();
    } catch (e) { /* not openable — skip */ }
  }
  throw new Error("Couldn't find that form in the website's Google account. Pick it from the list instead.");
}

/** The account's forms, newest first, for the picker. Drive metadata only (fast). */
function adminListVolunteerForms(data) {
  requireRole_(data.token, ["admin", "nurturing"]);
  const linked = {};
  loadEventVolunteers_().rows.forEach(function (r) {
    if (r.kind === "need" && r.volunteer_form_id) linked[r.volunteer_form_id] = { eventId: String(r.event_id), title: r.event_title || "" };
  });
  const out = [];
  const files = DriveApp.searchFiles('mimeType = "' + MimeType.GOOGLE_FORMS + '" and trashed = false');
  while (files.hasNext() && out.length < 300) {
    const f = files.next();
    const name = f.getName();
    if (/^_auth_test/i.test(name)) continue;
    const link = linked[f.getId()];
    out.push({
      formId: f.getId(),
      title: name,
      updatedAt: f.getLastUpdated().toISOString(),
      linkedEventId: link ? link.eventId : "",
      linkedTitle: link ? link.title : "",
    });
  }
  out.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
  return { success: true, forms: out.slice(0, 150) };
}

function openConnectableForm_(formId) {
  try {
    return FormApp.openById(formId);
  } catch (e) {
    let who = "";
    try { who = Session.getEffectiveUser().getEmail(); } catch (e2) { /* unknown */ }
    throw new Error(
      "Can't open that form. Make sure it was created in " + (who || "the website's Google account") +
      " (or that account is an editor of it)."
    );
  }
}

function connectFormQuestions_(form) {
  return form.getItems()
    .filter(function (it) { return CONNECT_ANSWERABLE_.indexOf(String(it.getType())) >= 0; })
    .map(function (it) { return { id: String(it.getId()), title: it.getTitle() || "(Untitled question)", type: String(it.getType()) }; });
}

/** Best guess of { name, phone, area, ie, remarks } → question id. */
function guessConnectMap_(questions) {
  const map = {};
  const used = {};
  CONNECT_FORM_FIELDS_.forEach(function (f) {
    const hit = questions.filter(function (q) {
      if (used[q.id]) return false;
      if (!f.re.test(q.title)) return false;
      if (f.not && f.not.test(q.title)) return false;
      // A number lives in a text box, not a choice list.
      if (f.key === "phone" && q.type !== "TEXT") return false;
      return true;
    })[0];
    if (hit) {
      map[f.key] = hit.id;
      used[hit.id] = true;
    }
  });
  return map;
}

function needUsingForm_(loaded, formId, exceptEventId) {
  return loaded.rows.filter(function (r) {
    return r.kind === "need" && r.volunteer_form_id === formId && String(r.event_id) !== String(exceptEventId || "");
  })[0] || null;
}

function adminInspectVolunteerForm(data) {
  requireRole_(data.token, ["admin", "nurturing"]);
  const formId = formIdFromLink_(data.link);
  const form = openConnectableForm_(formId);
  const questions = connectFormQuestions_(form);
  const other = needUsingForm_(loadEventVolunteers_(), formId, data.eventId);
  return {
    success: true,
    formId: formId,
    title: form.getTitle() || "Untitled form",
    responses: form.getResponses().length,
    acceptingResponses: form.isAcceptingResponses(),
    questions: questions,
    guess: guessConnectMap_(questions),
    usedBy: other ? (other.event_title || "another program") : "",
  };
}

/** "Mar-2024", a Date, an array of choices… → one tidy string. */
function connectAnswerText_(value) {
  if (Array.isArray(value)) return value.map(connectAnswerText_).filter(Boolean).join(", ");
  if (value instanceof Date) return Utilities.formatDate(value, "Asia/Kolkata", "MMM-yyyy");
  return String(value == null ? "" : value).trim();
}

/** A date question answers "2024-05-01"; the site keeps IE dates as "May-2024". */
function connectIeText_(text) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return text;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return (months[parseInt(m[2], 10) - 1] || m[2]) + "-" + m[1];
}

/** One form response → a volunteer row object, or null without a name + number. */
function connectedVolunteerRow_(needRow, map, response, now) {
  const byId = {};
  const order = [];
  response.getItemResponses().forEach(function (ir) {
    const id = String(ir.getItem().getId());
    byId[id] = { title: ir.getItem().getTitle(), text: connectAnswerText_(ir.getResponse()) };
    order.push(id);
  });
  const val = function (key) { return map[key] && byId[map[key]] ? byId[map[key]].text : ""; };
  const name = val("name");
  const phone = evDigits_(val("phone"));
  if (!name || !phone) return null;
  // Mapped questions have their own columns; "skip" lists other questions the
  // coordinator chose not to keep. Everything else goes into remarks.
  const mapped = {};
  ["name", "phone", "area", "ie", "remarks"].forEach(function (k) { if (map[k]) mapped[map[k]] = true; });
  (Array.isArray(map.skip) ? map.skip : []).forEach(function (id) { mapped[String(id)] = true; });
  const extras = order
    .filter(function (id) { return !mapped[id] && byId[id].text; })
    .map(function (id) { return byId[id].title + ": " + byId[id].text; });
  const remarks = [val("remarks")].concat(extras).filter(Boolean).join(" | ").slice(0, 1000);
  return {
    row_id: Utilities.getUuid(),
    kind: "volunteer",
    event_id: String(needRow.event_id),
    event_title: needRow.event_title || "",
    volunteer_name: name,
    phone: phone,
    area_of_stay: val("area"),
    ie_completion: connectIeText_(val("ie")),
    volunteer_remarks: remarks,
    added_by: "google-form",
    attended: "",
    in_wa_group: "no",
    invite_sent: "no",
    updated_at: now,
  };
}

function connectedFormMap_(formId) {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty("vjn_form_qmap_" + formId) || "{}");
  } catch (e) {
    return {};
  }
}

function installVolunteerFormTrigger_(form) {
  const has = ScriptApp.getUserTriggers(form).some(function (t) {
    return t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT && t.getHandlerFunction() === "onVolunteerFormSubmit";
  });
  if (!has) ScriptApp.newTrigger("onVolunteerFormSubmit").forForm(form).onFormSubmit().create();
}

function adminConnectProgramVolunteerForm(data) {
  requireRole_(data.token, ["admin", "nurturing"]);
  const eventId = String((data && data.eventId) || "").trim();
  if (!eventId) throw new Error("eventId required.");
  const snap = evProgramSnapshot_(eventId);
  if (!snap) throw new Error("Program not found.");
  const formId = formIdFromLink_(data.link);
  const form = openConnectableForm_(formId);

  const questions = connectFormQuestions_(form);
  const ids = {};
  questions.forEach(function (q) { ids[q.id] = true; });
  const map = {};
  ["name", "phone", "area", "ie", "remarks"].forEach(function (k) {
    const id = String((data.map && data.map[k]) || "");
    if (id && ids[id]) map[k] = id;
  });
  if (!map.name || !map.phone) throw new Error("Pick the questions for the name and the WhatsApp number.");
  map.skip = (Array.isArray(data.skip) ? data.skip : [])
    .map(String)
    .filter(function (id) { return ids[id]; });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const loaded = loadEventVolunteers_();
    const other = needUsingForm_(loaded, formId, eventId);
    if (other) throw new Error("This form is already connected to " + (other.event_title || "another program") + ".");

    PropertiesService.getScriptProperties().setProperty("vjn_form_qmap_" + formId, JSON.stringify(map));

    let shortUrl = form.getPublishedUrl();
    try {
      const maybe = form.shortenFormUrl(shortUrl);
      if (maybe && maybe.length < shortUrl.length) shortUrl = maybe;
    } catch (e) { /* keep the full link */ }

    let need = evFindNeed_(loaded, eventId);
    if (!need) need = { row_id: Utilities.getUuid(), kind: "need", event_id: eventId, _row: null };
    need.event_title = snap.title;
    need.event_date = snap.date;
    need.needed = String(snap.needed);
    need.volunteer_form_id = formId;
    need.volunteer_form_short_url = shortUrl;
    need.volunteer_form_fields = "connected";
    need.volunteer_form_template = "";
    need.updated_at = nowIsoKolkata_();
    const relayNeed = dataOnPi_() ? needRelay_(need) : null;
    if (relayNeed) {
      // The Pi stores it (the page hands it over). Nothing to write here.
    } else if (need._row) evWriteRow_(loaded, need);
    else evAppendRow_(loaded, need);

    // Bring in everyone who already answered — once per phone number.
    const seen = {};
    loaded.rows.forEach(function (r) {
      if (r.kind === "volunteer" && String(r.event_id) === eventId) seen[evDigits_(r.phone)] = true;
    });
    const now = nowIsoKolkata_();
    const fresh = [];
    let skipped = 0;
    let duplicates = 0;
    form.getResponses().forEach(function (resp) {
      const row = connectedVolunteerRow_(need, map, resp, now);
      if (!row) { skipped++; return; }
      if (seen[row.phone]) { duplicates++; return; }
      seen[row.phone] = true;
      fresh.push(row);
    });
    // Straight to the Pi; only what it could not take is parked in the tab.
    const outcome = fresh.length ? deliverVolunteerRows_(loaded, fresh) : [];
    const importedCount = outcome.filter(function (r) { return r !== "duplicate"; }).length;
    duplicates += outcome.length - importedCount;

    let liveSync = true;
    try {
      installVolunteerFormTrigger_(form);
    } catch (e) {
      liveSync = false;
      Logger.log("Could not install form trigger: " + e.message);
    }

    return {
      success: true,
      needs: relayNeed ? [relayNeed] : [],
      formId: formId,
      shortUrl: shortUrl,
      formFields: ["connected"],
      templateId: "",
      title: form.getTitle() || "",
      imported: importedCount,
      duplicates: duplicates,
      skipped: skipped,
      liveSync: liveSync,
    };
  } finally {
    lock.releaseLock();
  }
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

    // A connected (hand-made) form: answers go by the question mapping saved
    // when it was connected, not by the generated forms' fixed titles.
    if ((needRows[0].volunteer_form_fields || "") === "connected") {
      const row = connectedVolunteerRow_(needRows[0], connectedFormMap_(formId), e.response, nowIsoKolkata_());
      if (!row) return;
      const dupC = loaded.rows.some(function (r) {
        return r.kind === "volunteer" && String(r.event_id) === row.event_id && evDigits_(r.phone) === row.phone;
      });
      if (!dupC) deliverVolunteerRows_(loaded, [row]);
      return;
    }

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

      var multiRows = [];
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

        multiRows.push({
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
      deliverVolunteerRows_(loaded, multiRows);

    } else {
      // ── Single-program: one need row, one volunteer row ───────────────
      var needRow = needRows[0];
      var eventId = String(needRow.event_id);
      var formFields = (needRow.volunteer_form_fields || "").split(",").filter(Boolean);

      var dup = loaded.rows.some(function (row) {
        return row.kind === "volunteer" && String(row.event_id) === eventId && evDigits_(row.phone) === phone;
      });
      if (dup) return;

      deliverVolunteerRows_(loaded, [{
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
      }]);
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

/**
 * Run once from the editor (function dropdown -> authorizeVolunteerSheets -> Run) after adding the volunteers page,
 * so Google asks for the permission to make new spreadsheets. Deploying alone does not ask. It makes a test sheet and
 * trashes it straight away; safe to delete afterwards.
 */
function authorizeVolunteerSheets() {
  const book = SpreadsheetApp.create("VJN sheets auth test - delete me");
  DriveApp.getFileById(book.getId()).setTrashed(true);
  Logger.log("Sheets and Drive access work. The test sheet was trashed.");
}

/**
 * Run once from the editor (function dropdown -> setupDrive -> Run). Google then asks to allow
 * Drive; that prompt does not appear on Deploy. Creates the image folder used by flyers.
 */
function setupDrive() {
  const folder = getCentreImagesFolder_();
  Logger.log("Drive folder: " + folder.getName() + " (" + folder.getUrl() + ")");
}


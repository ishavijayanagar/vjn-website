// =============================================
// Isha Place, Vijayanagar — Google Apps Script
//
// FIRST-TIME ADMIN SETUP (do this in the Apps Script editor):
// 1. Put your admin password in ADMIN_PASSWORD below (6+ characters).
// 2. Click Save (disk icon).
// 3. At the top, choose function: setupAdmin
// 4. Click Run.
// 5. Review permissions → your Google account → Advanced →
//    Go to Centre Website (unsafe) → Allow.
//    That screen is where Drive access is granted. Deploying
//    a web app does NOT show it.
// 6. Deploy → Manage deployments → pencil → New version → Deploy.
//
// Then open /admin.html and sign in with ADMIN_PASSWORD.
// =============================================

// Admin login password for /admin.html (change this, then Run setupAdmin).
const ADMIN_PASSWORD = "REPLACE_ME";

const PROGRAMS_SHEET = "Programs";
const VOLUNTEER_SHEET = "Volunteering";
const SITE_SHEET = "Site";

const HOME_QUERIES_SHEET = "HomeQueries";
const PROGRAM_INTEREST_SHEET = "ProgramInterest";
const PROGRAM_VOLUNTEER_SHEET = "ProgramVolunteer";
const VOLUNTEERING_INTEREST_SHEET = "VolunteeringInterest";

const PROGRAM_HEADERS = [
  "title",
  "description",
  "startdate",
  "enddate",
  "starttime",
  "endtime",
  "starttime2",
  "endtime2",
  "timings",
  "location",
  "duration",
  "frequency",
  "image",
  "registerlink",
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
const TOKEN_CACHE_PREFIX = "admin_token_";
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
  const password = String(ADMIN_PASSWORD || "").trim();
  if (!password || password === "REPLACE_ME" || password.length < 6) {
    throw new Error(
      'Set ADMIN_PASSWORD at the top of this file to a real password (6+ characters), Save, then Run setupAdmin again.'
    );
  }
  PropertiesService.getScriptProperties().setProperty("ADMIN_PASSWORD", password);
  const folder = getCentreImagesFolder_();
  Logger.log("Admin password saved.");
  Logger.log("Drive folder: " + folder.getName() + " (" + folder.getUrl() + ")");
}

function promptSetAdminPassword() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    "Website admin password",
    "Enter the password for /admin.html",
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  const password = String(result.getResponseText() || "").trim();
  if (password.length < 6) {
    ui.alert("Password must be at least 6 characters.");
    return;
  }
  PropertiesService.getScriptProperties().setProperty("ADMIN_PASSWORD", password);
  ui.alert("Admin password saved. Redeploy the web app if this is the first time you pasted the script.");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const type = (e.parameter.type || "").toString();
  const id = e.parameter.id;
  const token = e.parameter.token;
  const admin = isValidAdminToken(token);

  try {
    const wantAdmin = String(e.parameter.admin || "") === "1";
    if (wantAdmin && !admin) {
      return json_({ error: "Unauthorized. Please log in again." });
    }

    if (type === "inquiries") {
      if (!wantAdmin) return json_({ error: "Unauthorized. Please log in again." });
      const groupKey = (e.parameter.group || "").toString().trim();
      if (groupKey) return json_(getInquiryGroup_(groupKey));
      return json_(getInquiryMeta_());
    }
    if (type === "site") {
      return json_(getSiteContent());
    }
    if (type === "programs") {
      return json_(id ? getSingleItem(PROGRAMS_SHEET, id, wantAdmin) : getAllItems(PROGRAMS_SHEET, wantAdmin));
    }
    if (type === "volunteering") {
      return json_(id ? getSingleItem(VOLUNTEER_SHEET, id, wantAdmin) : getAllItems(VOLUNTEER_SHEET, wantAdmin));
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
    if (formType === "adminSaveSite") {
      return json_(adminSaveSite(data));
    }
    if (formType === "adminUpdateInquiry") {
      return json_(adminUpdateInquiry(data));
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

function isValidAdminToken(token) {
  if (!token) return false;
  const cached = CacheService.getScriptCache().get(TOKEN_CACHE_PREFIX + String(token));
  return cached === "1";
}

function requireAdmin_(token) {
  if (!isValidAdminToken(token)) {
    throw new Error("Unauthorized. Please log in again.");
  }
}

function adminLogin(data) {
  const expected = getAdminPassword_();
  if (!expected) {
    return {
      error: "Admin password is not set. In the Google Sheet, open Website → Set admin password.",
    };
  }
  if (String(data.password || "") !== expected) {
    return { error: "Invalid password." };
  }
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(TOKEN_CACHE_PREFIX + token, "1", TOKEN_TTL_SECONDS);
  return { success: true, token: token };
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

  const slots = [];
  if (item.starttime && item.endtime) {
    slots.push({ start: item.starttime, end: item.endtime });
  } else if (item.starttime) {
    slots.push({ start: item.starttime, end: item.endtime || "" });
  }
  if (item.starttime2 && item.endtime2) {
    slots.push({ start: item.starttime2, end: item.endtime2 });
  }
  item.slots = slots;

  const lines = slots
    .map(function (slot) {
      return formatSlotLabel_(slot.start, slot.end);
    })
    .filter(Boolean);
  if (lines.length) item.timings = lines.join("\n");
  return item;
}

function adminSaveItem(data) {
  requireAdmin_(data.token);
  const sheetName = sheetNameForResource_(data.resource);
  ensureSheet_(sheetName, expectedHeadersFor_(sheetName));
  const sheet = ss_().getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0].map(function (h) {
    return h.toString().trim().toLowerCase();
  });
  const item = data.item || {};
  const id = data.id ? String(data.id).trim() : "";

  if (!id) {
    const values = headers.map(function (h) {
      const v = valueForHeader_(item, h);
      return v === undefined ? "" : v;
    });
    sheet.appendRow(values);
    const newId = String(sheet.getLastRow() - 1);
    invalidatePublicCache_(data.resource);
    return { success: true, id: newId };
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
  invalidatePublicCache_(data.resource);
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
  requireAdmin_(data.token);
  const sheetName = sheetNameForResource_(data.resource);
  if (sheetName === PROGRAMS_SHEET) {
    ensureSheet_(PROGRAMS_SHEET, PROGRAM_HEADERS);
  } else if (sheetName === VOLUNTEER_SHEET) {
    ensureSheet_(VOLUNTEER_SHEET, VOLUNTEER_HEADERS);
  }
  const sheet = ss_().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet not found.");
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) {
    invalidatePublicCache_(data.resource);
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
  invalidatePublicCache_(data.resource);
  return { success: true, deleted: sheetRowsToDelete.length };
}

function adminDeleteItem(data) {
  requireAdmin_(data.token);
  const sheetName = sheetNameForResource_(data.resource);
  const sheet = ss_().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet not found.");
  const rowIndex = parseInt(data.id, 10);
  if (isNaN(rowIndex) || rowIndex < 1) throw new Error("Invalid item id.");
  sheet.deleteRow(rowIndex + 1);
  invalidatePublicCache_(data.resource);
  return { success: true };
}

function adminUploadImage(data) {
  requireAdmin_(data.token);
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
  requireAdmin_(data.token);
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
  requireAdmin_(data.token);
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

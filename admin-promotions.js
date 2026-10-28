(function () {
  "use strict";

  const TOKEN_KEY = "vjn_admin_token";
  const THEME_KEY = "vjn_promo_theme";
  const USER_KEY = "vjn_admin_user";
  const NOTIFY_KEY = "vjn_query_notify";
  const MAX_SLOTS = 4;
  const SLOT_DEFAULTS = ["10:00", "13:00", "17:00", "20:00"];
  const TABS = ["Today", "Tomorrow", "Events"];
  const THRESH = 88;
  const MAXPULL = 120;

  const IMG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.4"/><path d="M21 15l-5-5L5 21"/></svg>';
  const CHK =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  const CLK =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const CLK_ART =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const CAL_ART =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
  const LOCK_ART =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

  /** Timeline placeholders while the sheet is still answering. */
  function skeletonHtml() {
    const row =
      '<li class="row skel" aria-hidden="true">' +
      '<div class="t"><span class="sk sk-time"></span><small class="sk sk-mer"></small></div>' +
      '<div class="rowcard"><div class="fg sk-card">' +
      '<span class="sk sk-th"></span><span class="tx">' +
      '<span class="sk sk-line short"></span><span class="sk sk-line"></span>' +
      "</span></div></div></li>";
    return (
      '<ul class="rail is-loading" aria-busy="true" aria-label="Loading promotions">' +
      row +
      row +
      row +
      "</ul>"
    );
  }

  function showBoardLoading() {
    if (barEl) barEl.hidden = false;
    if (fillEl) fillEl.style.transform = "scaleX(0)";
    if (btLEl) btLEl.innerHTML = "<b>Loading</b>";
    if (btREl) btREl.textContent = "";
    listEl.innerHTML = skeletonHtml();
    listEl.setAttribute("aria-busy", "true");
  }

  /** One shape for every empty screen: mark, headline, a line, an exit. */
  function emptyHtml(art, title, body, action) {
    return (
      '<div class="empty"><div class="mark-art">' +
      art +
      "</div><h3>" +
      esc(title) +
      "</h3>" +
      body +
      (action ? "<br/>" + action : "") +
      "</div>"
    );
  }

  const $ = function (id) {
    return document.getElementById(id);
  };

  const listEl = $("scroll");
  const barEl = $("bar");
  const fillEl = $("fill");
  const btLEl = $("btL");
  const btREl = $("btR");
  const tabsBase = $("tabsBase");
  const tabsAct = $("tabsActive");
  const COMPOSE_EXIT_MS = 320;
  let composeHideTimer = 0;
  const sheetEl = $("sheet");
  const scrimEl = $("scrim");
  const fabEl = $("fab");
  const toastEl = $("toast");
  const tmsgEl = $("tmsg");
  const undoEl = $("undo");
  const dayTitleEl = $("dayTitle");

  let items = [];
  let view = 0;
  let undoFn = null;
  let current = null;
  let toastTimer = 0;
  let sheetMode = "detail";
  let composeDateYmd = "";
  let editingId = "";
  let pendingFlyer = null;
  let flyerOverride = "";
  let composeTargets = [];
  let relayReady = null;
  let reconciling = false;
  const busyIds = {};
  // Retry needs what was typed, which the server does not hand back.
  const jobInputs = {};
  let pollTimer = 0;
  let stickyToast = null;
  const MARK_SPIN = '<span class="mark-spin" aria-hidden="true"></span>';

  /* ───────── theme ───────── */
  /* The inline script in the page already picked a theme before first paint;
     this only keeps the button, the browser chrome and the stored choice in
     step with it. */
  function isDarkTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }

  function savedTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function applyTheme(dark, remember) {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#1c1a17" : "#ffffff");
    const light = $("themeLight");
    const darkBtn = $("themeDark");
    if (light) light.setAttribute("aria-pressed", dark ? "false" : "true");
    if (darkBtn) darkBtn.setAttribute("aria-pressed", dark ? "true" : "false");
    if (remember) {
      try {
        localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
      } catch (e) {}
    }
  }

  function initTheme() {
    applyTheme(isDarkTheme(), false);
    const light = $("themeLight");
    const darkBtn = $("themeDark");
    if (light) {
      light.onclick = function () {
        applyTheme(false, true);
      };
    }
    if (darkBtn) {
      darkBtn.onclick = function () {
        applyTheme(true, true);
      };
    }
    // Until someone picks a side, the device keeps deciding.
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const follow = function (ev) {
        if (!savedTheme()) applyTheme(ev.matches, false);
      };
      if (mq.addEventListener) mq.addEventListener("change", follow);
      else if (mq.addListener) mq.addListener(follow);
    } catch (e) {}
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function token() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function clearAuth() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(READ_CACHE_PREFIX) === 0) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  // Shared with admin.js: the last promotions list, drawn at once on open
  // while the fresh one loads (stale-while-revalidate).
  const READ_CACHE_PREFIX = "vjn_rc:";
  const PROMO_CACHE_KEY = READ_CACHE_PREFIX + "promotions";

  function readPromoCache() {
    try {
      const raw = localStorage.getItem(PROMO_CACHE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      return data && Array.isArray(data.items) ? data : null;
    } catch (e) {
      return null;
    }
  }

  function writePromoCache(data) {
    try {
      localStorage.setItem(PROMO_CACHE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function driveFileId(url) {
    const s = String(url || "");
    let m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    return m ? m[1] : "";
  }

  function fixDriveUrl(url) {
    const id = driveFileId(url);
    if (id) return "https://drive.google.com/thumbnail?id=" + id + "&sz=w800";
    return url || "";
  }

  function flyerDownloadUrl(url) {
    const id = driveFileId(url);
    if (id) return "https://drive.google.com/uc?export=download&id=" + id;
    return url || "";
  }

  function flyerOf(item) {
    return String((item && (item.flyer_url || item.event_image)) || "").trim();
  }

  function flyerFileName(item, mime) {
    const base =
      String((item && item.event_title) || "flyer")
        .replace(/[^\w\s-]+/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 40) || "flyer";
    const ext = /png/i.test(mime || "") ? ".png" : /webp/i.test(mime || "") ? ".webp" : ".jpg";
    return base + ext;
  }

  function base64ToBlob(base64, mime) {
    const bin = atob(String(base64 || ""));
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "image/jpeg" });
  }

  function isIosLike() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  /* Persist Pictures/ folder access so later taps save without a share preview. */
  const GALLERY_DB = "vjn-promo-gallery";
  const GALLERY_STORE = "handles";
  const GALLERY_KEY = "dir";
  let galleryDirHandle = null;

  function openGalleryDb() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(GALLERY_DB, 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(GALLERY_STORE)) {
          db.createObjectStore(GALLERY_STORE);
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  async function loadGalleryHandle() {
    try {
      const db = await openGalleryDb();
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(GALLERY_STORE, "readonly");
        const req = tx.objectStore(GALLERY_STORE).get(GALLERY_KEY);
        req.onsuccess = function () {
          resolve(req.result || null);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    } catch (_) {
      return null;
    }
  }

  async function saveGalleryHandle(handle) {
    try {
      const db = await openGalleryDb();
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(GALLERY_STORE, "readwrite");
        tx.objectStore(GALLERY_STORE).put(handle, GALLERY_KEY);
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    } catch (_) {}
  }

  async function ensureGalleryDir(interactive) {
    if (typeof window.showDirectoryPicker !== "function") return null;
    let handle = galleryDirHandle || (await loadGalleryHandle());
    if (handle) {
      try {
        let perm = await handle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") {
          perm = await handle.requestPermission({ mode: "readwrite" });
        }
        if (perm === "granted") {
          galleryDirHandle = handle;
          return handle;
        }
      } catch (_) {}
    }
    if (!interactive) return null;
    handle = await window.showDirectoryPicker({
      id: "vjn-flyers",
      mode: "readwrite",
      startIn: "pictures",
    });
    galleryDirHandle = handle;
    await saveGalleryHandle(handle);
    return handle;
  }

  async function writeBlobToDir(dir, blob, filename) {
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function saveWithFilePicker(blob, filename, mime) {
    if (typeof window.showSaveFilePicker !== "function") return false;
    const ext = (filename.match(/\.[a-z0-9]+$/i) || [".jpg"])[0];
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      id: "vjn-flyer-file",
      startIn: "pictures",
      types: [
        {
          description: "Flyer image",
          accept: { [mime || "image/jpeg"]: [ext] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  function triggerAnchorDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(objectUrl);
    }, 2000);
  }

  async function blobFromFlyerUrl(url) {
    const candidates = [flyerDownloadUrl(url), fixDriveUrl(url), url].filter(Boolean);
    let lastErr = null;
    for (let i = 0; i < candidates.length; i++) {
      try {
        const res = await fetch(candidates[i], { mode: "cors" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        if (!blob || !blob.size) throw new Error("Empty image");
        return blob;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Could not fetch flyer");
  }

  async function resolveFlyerBlob(item, url) {
    try {
      const blob = await blobFromFlyerUrl(url);
      const mime = blob.type || "image/jpeg";
      return { blob: blob, mime: mime, filename: flyerFileName(item, mime) };
    } catch (_) {
      const data = await apiPost({
        formType: "adminGetImage",
        token: token(),
        url: url,
      });
      if (data.error || !data.base64) {
        if (/Unknown formType/i.test(data.error || "")) {
          throw new Error("Redeploy Apps Script to enable flyer download.");
        }
        throw new Error(data.error || "Could not download flyer.");
      }
      const mime = data.mimeType || "image/jpeg";
      return {
        blob: base64ToBlob(data.base64, mime),
        mime: mime,
        filename: data.filename || flyerFileName(item, mime),
      };
    }
  }

  function setBtnBusy(btn, on) {
    if (!btn) return;
    btn.classList.toggle("busy", !!on);
    btn.disabled = !!on;
    if (on) btn.setAttribute("aria-busy", "true");
    else btn.removeAttribute("aria-busy");
  }

  /**
   * Put a blob in the phone's gallery, by whichever route this browser allows.
   *
   * @param {Promise<{blob: Blob, mime: string, filename: string}>} pending
   *   resolved bytes; started by the caller *before* any await, so the picker
   *   below still counts as being inside the tap gesture.
   * @param {object} [opts] - dirPromise: an in-flight Pictures handle request,
   *   label: what to call the file in the share sheet.
   */
  async function saveBlobToGallery(pending, opts) {
    const options = opts || {};
    const galleryPromise = options.dirPromise || null;
    const tasks = [pending];
    if (galleryPromise) tasks.push(galleryPromise);
    const results = await Promise.all(tasks);
    const resolved = results[0];
    const dir = galleryPromise ? results[1] : null;
    const blob = resolved.blob;
    const mime = resolved.mime;
    const filename = resolved.filename;

    if (dir) {
      await writeBlobToDir(dir, blob, filename);
      return "Flyer saved to gallery";
    }

    try {
      if (await saveWithFilePicker(blob, filename, mime)) return "Flyer saved";
    } catch (pickerErr) {
      if (pickerErr && pickerErr.name === "AbortError") return "";
    }

    /* Share sheet = preview + manual save — only use on iOS where downloads are limited. */
    if (isIosLike()) {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
          text: options.label || "Flyer",
        });
        return "Tap Save Image in the share sheet";
      }
    }

    triggerAnchorDownload(blob, filename);
    return "Flyer downloaded";
  }

  /** Ask for Pictures access while the tap gesture is still valid, or null. */
  function galleryDirRequest() {
    if (typeof window.showDirectoryPicker !== "function") return null;
    return ensureGalleryDir(true).catch(function () {
      return null;
    });
  }

  async function downloadFlyer(item, btn) {
    const url = flyerOf(item);
    if (!url) {
      toast("No flyer to download", null);
      return;
    }
    setBtnBusy(btn, true);
    const dirPromise = galleryDirRequest();
    try {
      const done = await saveBlobToGallery(resolveFlyerBlob(item, url), {
        dirPromise: dirPromise,
        label: (item && item.event_title) || "Flyer",
      });
      if (done) toast(done, null);
    } catch (e) {
      if (e && e.name === "AbortError") {
        toast("Save cancelled", null);
        return;
      }
      toast(e.message || "Could not download flyer", null);
    } finally {
      setBtnBusy(btn, false);
    }
  }

  /**
   * Handed to the Sandesha Schedule sheet, which is an ES module and cannot
   * reach into this classic script. Mirrors window.SandeshaPromo the other way.
   */
  window.VjnPromoBoard = {
    galleryDirRequest: galleryDirRequest,
    saveBlobToGallery: saveBlobToGallery,
    isIosLike: isIosLike,
  };

  function thumbHtml(url) {
    if (!url) return IMG;
    return (
      '<img src="' +
      esc(fixDriveUrl(url)) +
      '" alt="" loading="lazy" referrerpolicy="no-referrer"/>'
    );
  }

  function todayYmd() {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch (e) {
      const d = new Date();
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }
  }

  function shiftYmd(ymd, days) {
    const parts = String(ymd || "").split("-");
    if (parts.length !== 3) return "";
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + days);
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
  }

  function splitSendAt(sendAt) {
    const key = String(sendAt || "").replace("T", " ").trim();
    const m = key.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    if (!m) return { date: "", hm: "" };
    return { date: m[1], hm: m[2] };
  }

  function formatHmAmPm(hm) {
    const parts = String(hm || "").split(":");
    if (parts.length < 2) return { time: "--", mer: "" };
    let h = parseInt(parts[0], 10);
    const mer = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return { time: h + ":" + parts[1], mer: mer };
  }

  function dayTitle(offset) {
    const ymd = offset ? shiftYmd(todayYmd(), offset) : todayYmd();
    const parts = ymd.split("-");
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }

  function nowLabel() {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date());
    } catch (e) {
      return "";
    }
  }

  function normalizeStatus(status) {
    const s = String(status || "").trim().toLowerCase();
    if (s === "needs_copy") return "pending";
    return s || "pending";
  }

  function groupsOf(item) {
    const bridge = relay();
    if (bridge && item && item.target) {
      const targets = bridge.parse(item.target);
      if (targets.length) return bridge.summary(targets);
    }
    return String(item.event_location || "").trim() || "Vijayanagar";
  }

  function formatLateBy(sendAt) {
    const parts = splitSendAt(sendAt);
    if (!parts.date || !parts.hm) return "Overdue";
    const target = new Date(parts.date.replace(/-/g, "/") + " " + parts.hm);
    if (isNaN(target.getTime())) return "Overdue";
    const mins = Math.max(1, Math.round((Date.now() - target.getTime()) / 60000));
    if (mins < 60) return mins + " min late";
    const hrs = Math.round(mins / 60);
    return hrs + (hrs === 1 ? " hr late" : " hrs late");
  }

  function formatDueIn(sendAt) {
    const parts = splitSendAt(sendAt);
    if (!parts.date || !parts.hm) return "soon";
    const target = new Date(parts.date.replace(/-/g, "/") + " " + parts.hm);
    if (isNaN(target.getTime())) return "soon";
    const mins = Math.round((target.getTime() - Date.now()) / 60000);
    if (mins <= 0) return "now";
    if (mins < 60) return "in " + mins + " min";
    const hrs = Math.round(mins / 60);
    return "in " + hrs + (hrs === 1 ? " hr" : " hrs");
  }

  /** Compact slot label for the program picker (e.g. "Aug 31 · 5:30 PM"). */
  function formatPickScheduleWhen(sendAt) {
    const parts = splitSendAt(sendAt);
    if (!parts.date || !parts.hm) return "";
    const dp = parts.date.split("-");
    const dt = new Date(Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]));
    if (isNaN(dt.getTime())) return "";
    const day = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const clock = formatHmAmPm(parts.hm);
    return day + " · " + clock.time + " " + clock.mer;
  }

  function pickStatusMarkup(item) {
    const s = normalizeStatus(item.status);
    const when = formatPickScheduleWhen(item.send_at);
    if (s === "sent") {
      return (
        '<span class="pick-status pick-status--ready">' +
        '<span class="pick-status-kind">Sent</span></span>'
      );
    }
    if (s === "pending") {
      return (
        '<span class="pick-status pick-status--pending">' +
        '<span class="pick-status-kind">Pending</span></span>'
      );
    }
    if (when) {
      const mod = s === "due" ? "due" : "scheduled";
      const kind = s === "due" ? "Overdue" : "Scheduled";
      const sub = s === "due" ? formatLateBy(item.send_at) : when;
      return (
        '<span class="pick-status pick-status--' +
        mod +
        '">' +
        '<span class="pick-status-kind">' +
        kind +
        '</span><span class="pick-status-when">' +
        esc(sub) +
        "</span></span>"
      );
    }
    return (
      '<span class="pick-status pick-status--ready">' +
      '<span class="pick-status-kind">Ready</span></span>'
    );
  }

  function formatSentAt(item) {
    const raw = String(item.sent_at || "").trim();
    const m = raw.match(/(\d{1,2}):(\d{2})/);
    if (!m) return nowLabel();
    return formatHmAmPm(pad2(parseInt(m[1], 10) % 24) + ":" + m[2]).time +
      " " +
      formatHmAmPm(pad2(parseInt(m[1], 10) % 24) + ":" + m[2]).mer;
  }

  function annotate(list) {
    let nextMarked = false;
    return list.map(function (item) {
      const status = normalizeStatus(item.status);
      let state = "soon";
      let note = "";
      if (status === "sent") {
        state = "sent";
        note = formatSentAt(item);
      } else if (status === "due") {
        state = "late";
        note = formatLateBy(item.send_at);
      } else if (!nextMarked) {
        state = "next";
        note = formatDueIn(item.send_at);
        nextMarked = true;
      }
      return { item: item, state: state, note: note };
    });
  }

  function promosOnDate(ymd, includeSent) {
    return items
      .filter(function (item) {
        if (!includeSent && normalizeStatus(item.status) === "sent") return false;
        return splitSendAt(item.send_at).date === ymd;
      })
      .sort(function (a, b) {
        return String(a.send_at || "").localeCompare(String(b.send_at || ""));
      });
  }

  function dayList(offset, includeSent) {
    const ymd = offset ? shiftYmd(todayYmd(), 1) : todayYmd();
    return promosOnDate(ymd, includeSent);
  }

  function viewIndexForYmd(ymd) {
    const today = todayYmd();
    if (ymd === today) return 0;
    if (ymd === shiftYmd(today, 1)) return 1;
    return 2;
  }

  function readComposeDate() {
    const el = $("composeDate");
    const val = el && el.value ? String(el.value).trim() : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(val) && val >= todayYmd()) return val;
    return composeDateYmd || todayYmd();
  }

  function libraryItems() {
    return items
      .filter(function (item) {
        return item.event_open !== false;
      })
      .sort(function (a, b) {
        return String(a.event_title || "").localeCompare(String(b.event_title || ""));
      });
  }

  function find(id) {
    return items.find(function (item) {
      return String(item.id) === String(id);
    });
  }

  async function apiPost(payload) {
    if (window.PiPromos) {
      const piReply = await window.PiPromos.route(payload);
      if (piReply !== undefined) return piReply;
    }
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Could not read the server response. Redeploy Apps Script and try again.");
    }
  }

  /* ───────── sandesha ─────────
     The board decides what goes out and when; Sandesha holds the queue and
     does the sending, so every scheduled post is mirrored into it. */
  function relay() {
    return window.SandeshaPromo || null;
  }

  /** Boots messaging once. Rejects with a message worth showing the user. */
  function ensureRelay() {
    if (relayReady) return relayReady;
    relayReady = (async function () {
      const bridge = await waitForRelay();
      await bridge.ready();
      return bridge;
    })();
    relayReady.catch(function () {
      relayReady = null;
    });
    return relayReady;
  }

  /** promo-shell.js is a module, so it may still be parsing on first paint. */
  function waitForRelay() {
    if (relay()) return Promise.resolve(relay());
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        window.removeEventListener("sandesha:promo-relay-ready", onReady);
        reject(new Error("Messaging did not load. Reload the page and try again."));
      }, 15000);
      function onReady() {
        clearTimeout(timer);
        window.removeEventListener("sandesha:promo-relay-ready", onReady);
        resolve(relay());
      }
      window.addEventListener("sandesha:promo-relay-ready", onReady);
    });
  }

  /** Kolkata wall-clock slot → the absolute instant Sandesha fires on. */
  function sendAtToIso(ymd, hm) {
    const dt = new Date(ymd + "T" + hm + ":00+05:30");
    if (isNaN(dt.getTime())) throw new Error("That time could not be read.");
    return dt.toISOString();
  }

  /** Bytes for the flyer, from the unsaved pick if there is one. */
  async function flyerForSandesha(item, flyerUrl) {
    if (pendingFlyer) {
      return {
        blob: base64ToBlob(pendingFlyer.base64, pendingFlyer.mimeType),
        filename: pendingFlyer.filename || flyerFileName(item, pendingFlyer.mimeType),
      };
    }
    if (!flyerUrl) return null;
    const resolved = await resolveFlyerBlob(item, flyerUrl);
    return { blob: resolved.blob, filename: resolved.filename };
  }

  function scheduleIdsOf(item) {
    return String((item && item.wa_schedule_ids) || "")
      .split(",")
      .map(function (v) {
        return v.trim();
      })
      .filter(Boolean);
  }

  /** Take rows off Sandesha's queue. Never throws — the board moves on. */
  async function cancelIds(ids) {
    if (!ids || !ids.length) return;
    try {
      const bridge = await ensureRelay();
      await bridge.cancel(ids);
    } catch (e) {
      /* Server unreachable: the row stays queued and the next load reconciles. */
    }
  }

  /** Take a post off the queue entirely. */
  function unqueue(item) {
    return cancelIds(scheduleIdsOf(item));
  }

  /**
   * Rows the post no longer refers to. Re-saving an unchanged slot inside the
   * server's dedupe window hands back the row that is already queued, and
   * cancelling that would silently unschedule the post.
   */
  function staleIds(previousIds, keptIds) {
    const kept = (keptIds || []).map(String);
    return (previousIds || []).filter(function (id) {
      return kept.indexOf(String(id)) < 0;
    });
  }

  /**
   * Bring the board in line with what Sandesha has actually posted.
   *
   * Sandesha's own delivery record is the truth: it names the board post it
   * sent. The older reading — the schedule row is gone and the slot has passed
   * — is kept as a fallback for posts sent before the server started keeping
   * that record, but it cannot stand on its own, because a post whose schedule
   * ids never reached the sheet looks exactly like one that was never queued.
   */
  async function reconcileSent() {
    const queued = items.filter(function (item) {
      return normalizeStatus(item.status) !== "sent" && !pendingJobs[String(item.id)];
    });
    if (!queued.length) return false;

    let live;
    let liveSources;
    let delivered = new Set();
    try {
      const bridge = await ensureRelay();
      if (typeof bridge.deliveredSources === "function") {
        try {
          delivered = await bridge.deliveredSources();
        } catch (e) {
          /* Server predates the delivered record — fall back to the inference. */
        }
      }
      if (typeof bridge.liveSchedules === "function") {
        const rows = await bridge.liveSchedules();
        live = new Set((rows || []).map(function (s) {
          return String(s.id);
        }));
        liveSources = new Set(
          (rows || [])
            .filter(function (s) {
              return s && s.sourceId;
            })
            .map(function (s) {
              return String(s.sourceId);
            })
        );
      } else if (typeof bridge.liveIds === "function") {
        live = await bridge.liveIds();
        liveSources = new Set();
      } else {
        return false;
      }
    } catch (e) {
      return false;
    }

    const done = queued.filter(function (item) {
      // Queued again since it last went out — the board is waiting on the new
      // row, not reporting the old send.
      if (liveSources.has(String(item.id))) return false;
      if (delivered.has(String(item.id))) return true;
      if (!scheduleIdsOf(item).length) return false;
      if (!isPastSlot(item.send_at)) return false;
      return scheduleIdsOf(item).every(function (id) {
        return !live.has(String(id));
      });
    });
    if (!done.length) return false;

    let changed = false;
    for (const item of done) {
      try {
        const data = await apiPost({
          formType: "adminMarkPromotionSent",
          token: token(),
          id: item.id,
          source: "sandesha",
        });
        if (!data.error) {
          changed = true;
          patchItemSent(item.id, data.item);
        }
      } catch (e) {
        /* try again on the next load */
      }
    }
    return changed;
  }

  function patchItemSent(id, fromServer) {
    const idx = items.findIndex(function (item) {
      return String(item.id) === String(id);
    });
    if (idx < 0) return;
    if (fromServer && typeof fromServer === "object") {
      fromServer.status = normalizeStatus(fromServer.status || "sent");
      items[idx] = fromServer;
      return;
    }
    items[idx].status = "sent";
    items[idx].sent_at = items[idx].sent_at || nowLabel();
    items[idx].wa_schedule_ids = "";
  }

  function isPastSlot(sendAt) {
    const parts = splitSendAt(sendAt);
    if (!parts.date || !parts.hm) return false;
    const target = new Date(parts.date + "T" + parts.hm + ":00+05:30");
    return !isNaN(target.getTime()) && target.getTime() <= Date.now();
  }

  function nextFreeHm(ymd) {
    const used = {};
    promosOnDate(ymd, true).forEach(function (item) {
      const hm = splitSendAt(item.send_at).hm;
      if (hm) used[hm] = true;
    });
    for (let i = 0; i < SLOT_DEFAULTS.length; i++) {
      if (!used[SLOT_DEFAULTS[i]]) return SLOT_DEFAULTS[i];
    }
    return "10:00";
  }

  function fillTimeSelect() {
    const sel = $("composeTime");
    if (!sel || sel.options.length) return;
    const parts = [];
    for (let mins = 0; mins < 24 * 60; mins += 15) {
      const hm = pad2(Math.floor(mins / 60)) + ":" + pad2(mins % 60);
      const clock = formatHmAmPm(hm);
      parts.push('<option value="' + hm + '">' + clock.time + " " + clock.mer + "</option>");
    }
    sel.innerHTML = parts.join("");
  }

  /* ───────── tabs ───────── */
  function buildTabs() {
    const html = TABS.map(function (n, i) {
      return (
        '<button type="button" role="tab" data-i="' +
        i +
        '" aria-selected="' +
        (i === 0 ? "true" : "false") +
        '">' +
        n +
        "</button>"
      );
    }).join("");
    tabsBase.innerHTML = html;
    if (tabsAct) tabsAct.innerHTML = html;
    tabsBase.querySelectorAll("button").forEach(function (b) {
      b.onclick = function () {
        setView(+b.dataset.i);
      };
    });
  }

  /** Tab labels carry the day's load, so the count reads before the tap. */
  function syncTabCounts() {
    const counts = [dayList(0, true).length, dayList(1, true).length, libraryItems().length];
    tabsBase.querySelectorAll("button").forEach(function (btn, i) {
      const n = counts[i];
      btn.innerHTML = TABS[i] + (n ? '<span class="count">' + n + "</span>" : "");
    });
  }

  function setView(i) {
    view = i;
    const thumb = $("tabsThumb");
    if (thumb) thumb.style.transform = "translate3d(" + i * 100 + "%,0,0)";
    tabsBase.querySelectorAll("button").forEach(function (b, idx) {
      const on = idx === i;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (i === 0) dayTitleEl.textContent = dayTitle(0);
    else if (i === 1) dayTitleEl.textContent = dayTitle(1);
    else dayTitleEl.textContent = "Events";
    render();
  }

  /* ───────── render ───────── */
  /** The chip carries the state; the line beside it carries the detail. */
  function chipHtml(entry) {
    if (entry.state === "sent") return '<span class="chip sent">' + CHK + " Sent</span>";
    if (entry.state === "late") return '<span class="chip late">' + CLK + " Due</span>";
    if (entry.state === "next") return '<span class="chip queued">' + CLK + " Next</span>";
    return '<span class="chip">Queued</span>';
  }

  function audLine(entry) {
    const where = groupsOf(entry.item);
    return entry.note ? entry.note + " · " + where : where;
  }

  function rowHTML(entry) {
    const p = entry.item;
    const clock = formatHmAmPm(splitSendAt(p.send_at).hm || "10:00");
    const flyer = flyerOf(p);
    const busy = !!busyIds[String(p.id)];
    return (
      '<li class="row ' +
      entry.state +
      (busy ? " is-busy" : "") +
      '" data-id="' +
      esc(p.id) +
      '">' +
      // The time sits outside the card, on the rail, so the spine can run
      // through the dot between the two columns.
      '<div class="t">' +
      esc(clock.time) +
      "<small>" +
      esc(clock.mer) +
      "</small></div>" +
      '<div class="rowcard">' +
      '<div class="rowbg">' +
      '<span class="bg-l">' +
      CHK +
      " Mark as sent</span>" +
      '<span class="bg-r">Snooze 15 min' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>' +
      "</div>" +
      '<button type="button" class="fg" data-open="' +
      esc(p.id) +
      '"' +
      (busy ? ' aria-busy="true"' : "") +
      ">" +
      '<span class="th">' +
      thumbHtml(flyer) +
      "</span>" +
      '<span class="tx"><span class="cline">' +
      chipHtml(entry) +
      '<span class="aud">' +
      esc(audLine(entry)) +
      "</span></span><b>" +
      esc(p.event_title || "Untitled") +
      "</b></span>" +
      '<span class="mark' +
      (busy ? " is-busy" : "") +
      '" aria-hidden="true">' +
      (busy ? MARK_SPIN : CHK) +
      "</span>" +
      "</button></div></li>"
    );
  }

  function setRowBusy(id, on) {
    const key = String(id);
    if (on) busyIds[key] = true;
    else delete busyIds[key];
    const row = listEl && listEl.querySelector('.row[data-id="' + key.replace(/"/g, '\\"') + '"]');
    if (!row) return;
    row.classList.toggle("is-busy", !!on);
    const mark = row.querySelector(".mark");
    const fg = row.querySelector(".fg");
    if (fg) {
      if (on) fg.setAttribute("aria-busy", "true");
      else fg.removeAttribute("aria-busy");
    }
    if (!mark) return;
    mark.classList.toggle("is-busy", !!on);
    mark.innerHTML = on ? MARK_SPIN : CHK;
  }

  function updateBar(list, isToday) {
    if (!list.length) {
      fillEl.style.transform = "scaleX(0)";
      btLEl.innerHTML = "<b>0 posts</b> scheduled";
      btREl.textContent = "Up to " + MAX_SLOTS;
      return;
    }
    if (!isToday) {
      fillEl.style.transform = "scaleX(0)";
      const first = formatHmAmPm(splitSendAt(list[0].send_at).hm);
      btLEl.innerHTML =
        "<b>" + list.length + " post" + (list.length === 1 ? "" : "s") + "</b> scheduled";
      btREl.textContent = "First at " + first.time + " " + first.mer;
      return;
    }
    const sent = list.filter(function (p) {
      return normalizeStatus(p.status) === "sent";
    }).length;
    const late = list.filter(function (p) {
      return normalizeStatus(p.status) === "due";
    }).length;
    fillEl.style.transform = "scaleX(" + sent / list.length + ")";
    btLEl.innerHTML = "<b>" + sent + " of " + list.length + " sent</b>";
    btREl.textContent = late ? late + " overdue" : "All caught up";
  }

  function render() {
    if (!token()) {
      barEl.hidden = true;
      listEl.innerHTML = emptyHtml(
        LOCK_ART,
        "Sign in required",
        'Open <a href="admin.html">Admin</a> to sign in, then come back here.',
      );
      return;
    }

    syncTabCounts();

    if (view === 2) {
      barEl.hidden = true;
      const lib = libraryItems();
      if (!lib.length) {
        listEl.innerHTML = emptyHtml(
          CAL_ART,
          "No events yet",
          "Open programs land here as soon as Programs publishes one.",
        );
        return;
      }
      listEl.innerHTML =
        '<div class="groupline">Open programs · ' +
        lib.length +
        "</div>" +
        '<div class="lib">' +
        lib
          .map(function (item) {
            const s = normalizeStatus(item.status);
            return (
              '<button type="button" class="lc" data-lib="' +
              esc(item.id) +
              '"><div class="a">' +
              thumbHtml(flyerOf(item)) +
              '</div><div class="c"><b>' +
              esc(item.event_title || "Untitled") +
              "</b><span>" +
              (s === "pending" ? "Pending" : "Ready") +
              (item.send_at ? " · scheduled" : "") +
              "</span></div></button>"
            );
          })
          .join("") +
        "</div>";
      listEl.querySelectorAll("[data-lib]").forEach(function (btn) {
        btn.onclick = function () {
          openCompose(find(btn.getAttribute("data-lib")), { preferSchedule: false });
        };
      });
      return;
    }

    barEl.hidden = false;
    const offset = view === 1 ? 1 : 0;
    const list = dayList(offset, true);
    updateBar(list, view === 0);

    if (!list.length) {
      listEl.innerHTML = emptyHtml(
        CLK_ART,
        view === 1 ? "Tomorrow is clear" : "Nothing goes out today",
        "All " + MAX_SLOTS + " slots are free.",
        '<button type="button" class="link" data-new>Write a post</button>',
      );
      const start = listEl.querySelector("[data-new]");
      if (start) start.onclick = openPickSheet;
      return;
    }

    const annotated = annotate(list);
    listEl.innerHTML =
      '<ul class="rail">' +
      annotated.map(rowHTML).join("") +
      "</ul>" +
      '<div class="hint">' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' +
      "Swipe a post right to mark it sent</div>";
    bindRows();
  }

  /* ───────── swipe ───────── */
  function bindRows() {
    listEl.querySelectorAll(".fg").forEach(function (fg) {
      const row = fg.closest(".row");
      const id = fg.dataset.open;
      let x0 = 0;
      let y0 = 0;
      let t0 = 0;
      let dx = 0;
      let lock = null;
      let active = false;

      fg.addEventListener("pointerdown", function (e) {
        if (active) return;
        if (busyIds[String(id)] || row.classList.contains("is-busy")) return;
        active = true;
        lock = null;
        dx = 0;
        x0 = e.clientX;
        y0 = e.clientY;
        t0 = Date.now();
        fg.classList.remove("snap");
        try {
          fg.setPointerCapture(e.pointerId);
        } catch (_) {}
      });

      fg.addEventListener("pointermove", function (e) {
        if (!active) return;
        const ax = e.clientX - x0;
        const ay = e.clientY - y0;
        if (lock === null) {
          if (Math.abs(ax) < 8 && Math.abs(ay) < 8) return;
          lock = Math.abs(ax) > Math.abs(ay) ? "x" : "y";
          if (lock === "y") {
            active = false;
            return;
          }
        }
        let d = ax;
        const a = Math.abs(d);
        if (a > MAXPULL) d = Math.sign(d) * (MAXPULL + (a - MAXPULL) * 0.22);
        dx = d;
        row.dataset.dir = d > 0 ? "r" : "l";
        fg.style.transform = "translateX(" + d + "px)";
      });

      const end = function (e) {
        if (!active) return;
        active = false;
        try {
          fg.releasePointerCapture(e.pointerId);
        } catch (_) {}
        const v = Math.abs(dx) / Math.max(1, Date.now() - t0);
        const commit = Math.abs(dx) >= THRESH || v > 0.11;
        const tapped = lock === null && Math.abs(dx) < 4;

        fg.classList.add("snap");
        fg.style.transform = "translateX(0)";
        setTimeout(function () {
          delete row.dataset.dir;
        }, 180);

        if (busyIds[String(id)] || row.classList.contains("is-busy")) {
          dx = 0;
          return;
        }
        if (commit && dx > 0 && !row.classList.contains("sent")) markSent(id);
        else if (commit && dx < 0) snooze(id);
        else if (tapped) openDetailSheet(id);
        dx = 0;
      };
      fg.addEventListener("pointerup", end);
      fg.addEventListener("pointercancel", end);
    });
  }

  /* ───────── toast ───────── */
  function toast(msg, fn, opts) {
    opts = opts || {};
    // A failure stays until it is dealt with; a passing message only covers it.
    if (opts.sticky) stickyToast = { msg: msg, fn: fn, opts: opts };
    tmsgEl.textContent = msg;
    undoFn = fn || null;
    undoEl.textContent = opts.label || "Undo";
    undoEl.style.display = undoFn ? "" : "none";
    fabEl.classList.add("hide");
    toastEl.classList.add("on");
    clearTimeout(toastTimer);
    if (!opts.sticky) toastTimer = setTimeout(hideToast, opts.ms || 4200);
  }

  function hideToast() {
    if (stickyToast) {
      const s = stickyToast;
      toast(s.msg, s.fn, s.opts);
      return;
    }
    toastEl.classList.remove("on");
    fabEl.classList.remove("hide");
    undoFn = null;
  }

  /* The Sandesha Schedule tab hands a Board-owned post back here to edit,
     since this editor is what owns its copy, flyer and slot. */
  window.addEventListener("promo:board-show", function () {
    if (!token()) return;
    load(false).catch(function () {});
  });

  window.addEventListener("promo:edit-post", function (ev) {
    const id = ev && ev.detail && ev.detail.promoId;
    const item = find(id);
    if (!item) {
      toast("That post is no longer on the board", null);
      return;
    }
    // promo-shell.js switches to the Board tab on this same event.
    openCompose(item, { preferSchedule: true });
  });

  undoEl.onclick = function () {
    const fn = undoFn;
    stickyToast = null;
    hideToast();
    if (fn) fn();
  };

  /* ───────── actions ───────── */
  async function markSent(id) {
    const p = find(id);
    if (!p || normalizeStatus(p.status) === "sent") return;
    if (busyIds[String(id)]) return;
    setRowBusy(id, true);
    try {
      // Posted by hand — pull the queued rows so WhatsApp does not repeat it.
      await unqueue(p);
      const data = await apiPost({
        formType: "adminMarkPromotionSent",
        token: token(),
        id: id,
      });
      if (data.error) throw new Error(data.error);
      delete busyIds[String(id)];
      patchItemSent(id, data.item);
      render();
      toast((p.event_title || "Post") + " marked as sent", function () {
        unmarkSent(id);
      });
    } catch (e) {
      setRowBusy(id, false);
      toast(e.message || "Could not mark sent", null);
      return;
    }
    try {
      await load(false);
    } catch (_) {}
  }

  async function unmarkSent(id) {
    if (busyIds[String(id)]) return;
    setRowBusy(id, true);
    try {
      // Uses existing adminSavePromotion + clear_sent (no new formType).
      // Requires the latest apps-script.js deployed as a New version.
      const data = await apiPost({
        formType: "adminSavePromotion",
        token: token(),
        id: id,
        clear_sent: true,
      });
      if (data.error) {
        if (/Unknown formType/i.test(data.error)) {
          setRowBusy(id, false);
          toast("Redeploy Apps Script: paste latest apps-script.js → Deploy → New version.", null);
          return;
        }
        throw new Error(data.error);
      }
      if (data.item && normalizeStatus(data.item.status) === "sent") {
        setRowBusy(id, false);
        toast("Redeploy Apps Script: paste latest apps-script.js → Deploy → New version.", null);
        return;
      }
      delete busyIds[String(id)];
      await load(false);
      toast("Restored to schedule", null);
    } catch (e) {
      setRowBusy(id, false);
      toast(e.message || "Could not undo", null);
    }
  }

  async function snooze(id) {
    const p = find(id);
    if (!p) return;
    if (busyIds[String(id)]) return;
    const parts = splitSendAt(p.send_at);
    if (!parts.date || !parts.hm) {
      toast("Nothing to snooze", null);
      return;
    }
    const bits = parts.hm.split(":");
    let mins = parseInt(bits[0], 10) * 60 + parseInt(bits[1], 10) + 15;
    let day = parts.date;
    if (mins >= 24 * 60) {
      mins -= 24 * 60;
      day = shiftYmd(day, 1);
    }
    const hm = pad2(Math.floor(mins / 60)) + ":" + pad2(mins % 60);
    setRowBusy(id, true);
    try {
      const payload = {
        formType: "adminSavePromotion",
        token: token(),
        id: id,
        send_at: day + " " + hm,
      };
      // Move the queue with the slot, or the old time still fires.
      const previousIds = scheduleIdsOf(p);
      if (previousIds.length) {
        const bridge = await ensureRelay();
        const flyer = await flyerForSandesha(p, flyerOf(p));
        payload.wa_schedule_ids = await bridge.schedule({
          promoId: p.id,
          message: p.message,
          runAtIso: sendAtToIso(day, hm),
          targets: bridge.resolveTargets(p.target),
          flyer: flyer,
        });
      }
      const data = await apiPost(payload);
      if (data.error) throw new Error(data.error);
      await cancelIds(staleIds(previousIds, payload.wa_schedule_ids));
      await load(false);
      toast((p.event_title || "Post") + " snoozed 15 minutes", null);
    } catch (e) {
      setRowBusy(id, false);
      toast(e.message || "Could not snooze", null);
    }
  }

  async function removeFromDay(id) {
    if (busyIds[String(id)]) return;
    setRowBusy(id, true);
    toast("Removing from the day…", null);
    try {
      await unqueue(find(id));
      const data = await apiPost({
        formType: "adminSavePromotion",
        token: token(),
        id: id,
        send_at: "",
      });
      if (data.error) throw new Error(data.error);
      delete busyIds[String(id)];
      await load(false);
      toast("Removed from day", null);
    } catch (e) {
      setRowBusy(id, false);
      toast(e.message || "Could not remove", null);
    }
  }

  /* ───────── detail / pick sheet ───────── */
  function openDetailSheet(id) {
    const p = find(id);
    if (!p) return;
    current = p;
    sheetMode = "detail";
    sheetEl.classList.remove("is-picker");
    const clock = formatHmAmPm(splitSendAt(p.send_at).hm || "10:00");
    const flyer = flyerOf(p);
    const sent = normalizeStatus(p.status) === "sent";
    sheetEl.innerHTML =
      '<div class="grab"></div>' +
      '<div class="sh-top"><div class="sh-art">' +
      thumbHtml(flyer) +
      "</div><div><b>" +
      esc(p.event_title || "Untitled") +
      "</b><span>" +
      esc(clock.time + " " + clock.mer) +
      " · " +
      esc(groupsOf(p)) +
      "</span></div></div>" +
      '<div class="msg-l">Message<button type="button" data-a="edit">Edit</button></div>' +
      '<div class="msg">' +
      esc(p.message || "No message yet") +
      "</div>" +
      '<div class="btns">' +
      '<button type="button" class="b" data-a="copy"><span class="lbl">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy text</span></button>' +
      (flyer
        ? '<button type="button" class="b" data-a="flyer"><span class="lbl">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>Download flyer</span></button>'
        : '<button type="button" class="b" disabled><span class="lbl">No flyer</span></button>') +
      (sent
        ? '<button type="button" class="b ok pri" data-a="unsend"><span class="lbl">' +
          CHK +
          " Sent · tap to undo</span></button>"
        : '<button type="button" class="b pri" data-a="sent"><span class="lbl">' +
          CHK +
          " Mark as sent</span></button>") +
      "</div>" +
      '<button type="button" class="hold" data-a="hold" draggable="false">Hold to remove<span class="fillx">Removing…</span></button>';

    sheetEl.style.transform = "";
    scrimEl.classList.add("on");
    sheetEl.classList.add("on");
    setSheetHidden(false);
    bindSheetButtons(p);
  }

  function openPickSheet() {
    sheetMode = "pick";
    current = null;
    const lib = libraryItems();
    sheetEl.classList.add("is-picker");
    sheetEl.innerHTML =
      '<div class="grab"></div>' +
      "<div class=\"sh-top\"><div><b>Choose a program</b><span>Open events ready to promote</span></div></div>" +
      '<input type="search" class="pick-search" id="pickSearch" placeholder="Search programs, dates, places…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search"/>' +
      '<div id="pickList"></div>';
    const renderPick = function (q) {
      const words = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      const filtered = lib.filter(function (item) {
        if (!words.length) return true;
        const hay = [
          item.event_title,
          item.event_location,
          item.event_date,
          item.send_at,
          item.message,
          normalizeStatus(item.status),
        ]
          .join(" ")
          .toLowerCase();
        return words.every(function (w) {
          return hay.indexOf(w) >= 0;
        });
      });
      const host = $("pickList");
      if (!host) return;
      if (!filtered.length) {
        host.innerHTML = '<div class="empty">No matching programs.</div>';
        return;
      }
      host.innerHTML = filtered
        .map(function (item) {
          return (
            '<button type="button" class="pick-row" data-pick="' +
            esc(item.id) +
            '"><span class="th">' +
            thumbHtml(flyerOf(item)) +
            '</span><span class="pick-copy"><b>' +
            esc(item.event_title || "Untitled") +
            "</b>" +
            (item.event_date
              ? '<span class="pick-date">' + esc(item.event_date) + "</span>"
              : "") +
            "</span>" +
            pickStatusMarkup(item) +
            "</button>"
          );
        })
        .join("");
      host.querySelectorAll("[data-pick]").forEach(function (btn) {
        btn.onclick = function () {
          const item = find(btn.getAttribute("data-pick"));
          parkFocusOutside(sheetEl);
          closeSheet();
          if (item) openCompose(item, { preferSchedule: true });
        };
      });
    };
    renderPick("");
    const search = $("pickSearch");
    if (search) {
      const onQuery = function () {
        renderPick(search.value);
      };
      search.addEventListener("input", onQuery);
      search.addEventListener("search", onQuery);
      setTimeout(function () {
        search.focus();
      }, 320);
    }
    sheetEl.style.transform = "";
    scrimEl.classList.add("on");
    sheetEl.classList.add("on");
    setSheetHidden(false);
  }

  function parkFocusOutside(container) {
    const active = document.activeElement;
    if (active && container && container.contains(active) && typeof active.blur === "function") {
      active.blur();
    }
    let park = $("focusPark");
    if (!park) {
      park = document.createElement("button");
      park.type = "button";
      park.id = "focusPark";
      park.setAttribute("aria-label", "Close");
      park.tabIndex = -1;
      park.style.cssText =
        "position:fixed;width:1px;height:1px;padding:0;margin:0;border:0;opacity:0;overflow:hidden;clip:rect(0,0,0,0);";
      document.body.appendChild(park);
    }
    try {
      park.focus({ preventScroll: true });
    } catch (e) {
      park.focus();
    }
  }

  function setSheetHidden(hidden) {
    if (!hidden) {
      sheetEl.removeAttribute("inert");
      // Prefer inert over aria-hidden while open/closed to avoid focus conflicts.
      sheetEl.removeAttribute("aria-hidden");
      return;
    }
    parkFocusOutside(sheetEl);
    sheetEl.setAttribute("inert", "");
    // Do not set aria-hidden while any descendant might still hold focus —
    // inert already removes the subtree from the a11y tree / tab order.
    sheetEl.removeAttribute("aria-hidden");
    requestAnimationFrame(function () {
      if (sheetEl.contains(document.activeElement)) parkFocusOutside(sheetEl);
    });
  }

  function closeSheet() {
    sheetEl.classList.remove("on");
    sheetEl.classList.remove("is-picker");
    scrimEl.classList.remove("on");
    setSheetHidden(true);
    sheetEl.style.transform = "";
    current = null;
    sheetMode = "detail";
  }

  scrimEl.onclick = closeSheet;

  function bindSheetButtons(p) {
    sheetEl.querySelectorAll("[data-a]").forEach(function (b) {
      const a = b.dataset.a;
      if (a === "hold") {
        let timer;
        let armed = false;
        const clearSel = function () {
          try {
            const sel = window.getSelection();
            if (sel) sel.removeAllRanges();
          } catch (_) {}
        };
        const start = function (e) {
          if (e.button != null && e.button !== 0) return;
          if (armed) return;
          armed = true;
          e.preventDefault();
          clearSel();
          try {
            if (e.pointerId != null) b.setPointerCapture(e.pointerId);
          } catch (_) {}
          b.classList.add("holding");
          clearTimeout(timer);
          timer = setTimeout(function () {
            armed = false;
            b.classList.remove("holding");
            parkFocusOutside(sheetEl);
            closeSheet();
            removeFromDay(p.id);
          }, 1200);
        };
        const stop = function () {
          armed = false;
          clearTimeout(timer);
          b.classList.remove("holding");
        };
        b.addEventListener("pointerdown", start);
        b.addEventListener("pointerup", stop);
        b.addEventListener("pointercancel", stop);
        b.addEventListener("lostpointercapture", stop);
        b.addEventListener("touchstart", start, { passive: false });
        b.addEventListener("touchend", stop);
        b.addEventListener("touchcancel", stop);
        b.addEventListener("contextmenu", function (e) {
          e.preventDefault();
        });
        return;
      }

      b.onclick = function (e) {
        e.preventDefault();
        if (a === "flyer") {
          downloadFlyer(p, b);
          return;
        }
        if (a === "copy") {
          if (!p.message) {
            toast("No message to copy", null);
            return;
          }
          const lbl = b.querySelector(".lbl");
          const prevHtml = lbl ? lbl.innerHTML : "";
          setBtnBusy(b, true);
          navigator.clipboard
            .writeText(p.message)
            .then(function () {
              setBtnBusy(b, false);
              b.classList.add("ok");
              if (lbl) lbl.innerHTML = CHK + " Copied";
              toast("Message copied", null);
              setTimeout(function () {
                b.classList.remove("ok");
                if (lbl) lbl.innerHTML = prevHtml;
              }, 1600);
            })
            .catch(function () {
              setBtnBusy(b, false);
              toast("Could not copy", null);
            });
          return;
        }
        if (a === "edit") {
          parkFocusOutside(sheetEl);
          closeSheet();
          openCompose(p, { preferSchedule: !!p.send_at });
          return;
        }
        if (a === "sent") {
          parkFocusOutside(sheetEl);
          closeSheet();
          setTimeout(function () {
            markSent(p.id);
          }, 140);
          return;
        }
        if (a === "unsend") {
          parkFocusOutside(sheetEl);
          closeSheet();
          unmarkSent(p.id);
        }
      };
    });
  }

  (function sheetDrag() {
    let y0 = 0;
    let d = 0;
    let t0 = 0;
    let on = false;
    sheetEl.addEventListener("pointerdown", function (e) {
      if (!sheetEl.classList.contains("on")) return;
      if (e.target.closest("button,a,input,textarea,select")) return;
      on = true;
      y0 = e.clientY;
      t0 = Date.now();
      d = 0;
      sheetEl.style.transition = "none";
      try {
        sheetEl.setPointerCapture(e.pointerId);
      } catch (_) {}
    });
    sheetEl.addEventListener("pointermove", function (e) {
      if (!on) return;
      d = e.clientY - y0;
      if (d < 0) d = d * 0.16;
      sheetEl.style.transform = "translateY(" + d + "px)";
    });
    const up = function () {
      if (!on) return;
      on = false;
      sheetEl.style.transition = "";
      const v = d / Math.max(1, Date.now() - t0);
      if (d > 110 || v > 0.11) closeSheet();
      else sheetEl.style.transform = "";
      d = 0;
    };
    sheetEl.addEventListener("pointerup", up);
    sheetEl.addEventListener("pointercancel", up);
  })();

  /* ───────── compose ───────── */
  function syncComposeWhen() {
    const scheduleOn = !!($("composeWhenSchedule") && $("composeWhenSchedule").checked);
    const panel = $("composeSchedule");
    if (panel) {
      panel.classList.toggle("on", scheduleOn);
      if (scheduleOn) panel.removeAttribute("inert");
      else panel.setAttribute("inert", "");
    }
    const btn = $("composeSave");
    if (btn) btn.textContent = scheduleOn ? "Schedule" : "Save";
    showEl($("composeFlyerReq"), scheduleOn && !currentFlyerUrl());
    if (scheduleOn) {
      syncComposeDays();
      syncComposeAudience();
    }
  }

  function syncComposeAudience() {
    const btn = $("composeAud");
    const name = $("composeAudName");
    const sub = $("composeAudSub");
    const count = $("composeAudCount");
    if (!btn || !name) return;
    const bridge = relay();
    const chosen = composeTargets.length;
    btn.classList.toggle("is-empty", !chosen);
    name.textContent = bridge && chosen
      ? bridge.summary(composeTargets)
      : chosen
        ? chosen + (chosen === 1 ? " list" : " lists")
        : "Choose who gets this";
    sub.textContent = chosen
      ? "Sandesha posts to " + (chosen === 1 ? "this list" : "these lists") + " at the slot time"
      : "Tap to pick WhatsApp groups";
    count.textContent = bridge ? bridge.reach(composeTargets) : chosen;
  }

  /** Fill the picker from the post, then from whatever was last scheduled. */
  async function primeComposeAudience(item) {
    syncComposeAudience();
    try {
      const bridge = await ensureRelay();
      if (String(editingId) !== String(item.id)) return;
      composeTargets = bridge.resolveTargets(item.target);
      syncComposeAudience();
    } catch (e) {
      const sub = $("composeAudSub");
      if (sub) sub.textContent = e.message || "Messaging unavailable";
    }
  }

  // Mirrors the flyer resolution in saveCompose so the UI can warn before submit.
  function currentFlyerUrl() {
    if (pendingFlyer) return "__pending__";
    if (flyerOverride) return flyerOverride;
    const item = find(editingId);
    if (!item) return "";
    return String(item.flyer_url || "").trim() || String(item.event_image || "").trim();
  }

  function syncComposeDays() {
    const cur = find(editingId);
    const ymd = readComposeDate();
    const used = promosOnDate(ymd, true).filter(function (p) {
      return !cur || String(p.id) !== String(cur.id);
    }).length;
    const left = Math.max(0, MAX_SLOTS - used);
    const hint = $("composeDateHint");
    if (hint) {
      hint.textContent = left
        ? left + (left === 1 ? " slot free on this day" : " slots free on this day")
        : "Day is full — pick another date";
      hint.classList.toggle("is-full", left === 0);
    }
  }

  async function pasteComposeMessage() {
    const box = $("composeMessage");
    const err = $("composeErr");
    if (!box) return;
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        throw new Error("Clipboard not available in this browser.");
      }
      const text = await navigator.clipboard.readText();
      if (!String(text || "").trim()) {
        if (err) {
          err.textContent = "Clipboard is empty.";
          err.hidden = false;
        }
        return;
      }
      box.value = text;
      syncComposeCount();
      if (err) err.hidden = true;
      box.focus();
    } catch (e) {
      if (err) {
        err.textContent = "Could not paste — tap the message field and paste manually.";
        err.hidden = false;
      }
    }
  }

  function syncComposeCount() {
    const el = $("composeCount");
    const box = $("composeMessage");
    if (!el || !box) return;
    const n = (box.value || "").trim().length;
    el.textContent = n ? n + " chars" : "";
  }

  function showEl(el, on) {
    if (!el) return;
    if (on) {
      el.hidden = false;
      el.removeAttribute("hidden");
    } else {
      el.hidden = true;
    }
  }

  function setComposeOpen(on) {
    const panel = $("compose");
    const scrim = $("composeScrim");
    if (!panel || !scrim) return;

    if (!on) {
      parkFocusOutside(panel);
    }

    clearTimeout(composeHideTimer);

    if (on) {
      // Drop display:none first, then force a reflow so the browser has a
      // closed frame to animate away from -- otherwise the slide-in is skipped.
      panel.classList.remove("gone");
      scrim.classList.remove("gone");
      void panel.offsetWidth;
      panel.classList.add("open");
      scrim.classList.add("open");
      panel.removeAttribute("inert");
      panel.setAttribute("aria-hidden", "false");
      scrim.setAttribute("aria-hidden", "false");
    } else {
      panel.classList.remove("open");
      scrim.classList.remove("open");
      panel.setAttribute("inert", "");
      const apply = function () {
        if (panel.contains(document.activeElement)) parkFocusOutside(panel);
        if (panel.contains(document.activeElement)) {
          panel.removeAttribute("aria-hidden");
        } else {
          panel.setAttribute("aria-hidden", "true");
        }
        scrim.setAttribute("aria-hidden", "true");
      };
      apply();
      requestAnimationFrame(function () {
        requestAnimationFrame(apply);
      });
      // Hard-hide after the exit has had time to play. Not conditional on
      // transitionend, which may never fire if the transition is interrupted.
      composeHideTimer = setTimeout(function () {
        panel.classList.add("gone");
        scrim.classList.add("gone");
      }, COMPOSE_EXIT_MS);
    }
  }

  function setComposeDate(ymd) {
    const today = todayYmd();
    let next = String(ymd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next < today) next = today;
    composeDateYmd = next;
    const dateEl = $("composeDate");
    if (dateEl) {
      dateEl.min = today;
      dateEl.value = next;
    }
    const timeEl = $("composeTime");
    if (timeEl) timeEl.value = nextFreeHm(next);
    syncComposeDays();
  }

  function syncFlyerReset(item) {
    const btn = $("composeFlyerReset");
    if (!btn || !item) return;
    const programs = String(item.event_image || "").trim();
    if (!programs) {
      btn.hidden = true;
      return;
    }
    const currentUrl = pendingFlyer
      ? "__pending__"
      : flyerOverride || String(item.flyer_url || "").trim() || programs;
    btn.hidden = currentUrl === programs;
  }

  function setFlyerPreview(url) {
    const img = $("composeFlyerPreview");
    const drop = $("composeDrop");
    if (!img) return;
    if (!url) {
      img.hidden = true;
      img.removeAttribute("src");
      if (drop) drop.classList.remove("has");
      return;
    }
    img.src = fixDriveUrl(url);
    img.hidden = false;
    if (drop) drop.classList.add("has");
  }

  function openCompose(item, opts) {
    opts = opts || {};
    if (!item) return;
    editingId = item.id;
    pendingFlyer = null;
    flyerOverride = "";
    composeTargets = [];
    fillTimeSelect();
    $("composeTitle").textContent = item.event_title || "Compose post";
    $("composeMeta").textContent = [item.event_date, item.event_location].filter(Boolean).join(" · ");
    $("composeMessage").value = item.message || "";
    $("composeFlyerName").textContent = flyerOf(item) ? "Current flyer" : "No flyer yet";
    $("composeFlyerFile").value = "";
    $("composeErr").hidden = true;
    setFlyerPreview(flyerOf(item));
    syncFlyerReset(item);
    const prefer = !!opts.preferSchedule || !String(item.message || "").trim();
    document.querySelectorAll('input[name="composeWhen"]').forEach(function (r) {
      r.checked = prefer ? r.value === "schedule" : r.value === "save";
    });
    const sendParts = splitSendAt(item.send_at);
    const today = todayYmd();
    const initialDate =
      sendParts.date && sendParts.date >= today ? sendParts.date : today;
    setComposeDate(initialDate);
    syncComposeCount();
    syncComposeDays();
    syncComposeWhen();
    primeComposeAudience(item);
    setComposeOpen(true);
    if (!String(item.message || "").trim()) {
      setTimeout(function () {
        $("composeMessage").focus();
      }, 50);
    }
  }

  function closeCompose() {
    if (window.DraftKeeper) DraftKeeper.clear("boardCompose");
    setComposeOpen(false);
    editingId = "";
    pendingFlyer = null;
    flyerOverride = "";
    composeTargets = [];
  }

  function readFileAsImagePayload(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || "")) {
        reject(new Error("Choose an image file."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("Could not read that image."));
      };
      reader.onload = function () {
        const dataUrl = String(reader.result || "");
        const comma = dataUrl.indexOf(",");
        if (comma < 0) {
          reject(new Error("Could not read that image."));
          return;
        }
        resolve({
          base64: dataUrl.slice(comma + 1),
          mimeType: file.type || "image/jpeg",
          filename: file.name || "flyer.jpg",
          preview: dataUrl,
        });
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadPayload(payload) {
    const data = await apiPost({
      formType: "adminUploadImage",
      token: token(),
      base64: payload.base64,
      mimeType: payload.mimeType,
      filename: payload.filename,
    });
    if (data.error || !data.url) throw new Error(data.error || "Image upload failed.");
    return data.url;
  }

  /* Save/Schedule answers at once: the sheet closes, the row shows as busy
     and a toast says what's happening, while the slow part (Sandesha queue,
     flyer upload, Apps Script) runs in the background. A failure comes back
     as a toast with Retry, so nothing typed is lost. */
  function saveCompose() {
    const item = find(editingId);
    if (!item) return;
    const err = $("composeErr");
    const message = ($("composeMessage").value || "").trim();
    const wantSchedule = $("composeWhenSchedule") && $("composeWhenSchedule").checked;
    err.hidden = true;
    if (!message) {
      err.textContent = "Write a message.";
      err.hidden = false;
      return;
    }
    if (busyIds[String(item.id)]) {
      err.textContent = "Still saving the last change to this post — one moment.";
      err.hidden = false;
      return;
    }
    const job = {
      id: item.id,
      message: message,
      wantSchedule: wantSchedule,
      flyerUrl: flyerOverride || String(item.flyer_url || "").trim() || String(item.event_image || "").trim(),
      pendingFlyer: pendingFlyer,
      targets: composeTargets.slice(),
      title: item.event_title || "this post",
      ymd: "",
      hm: "",
    };
    if (wantSchedule) {
      if (!job.targets.length) {
        err.textContent = "Choose who this goes to.";
        err.hidden = false;
        return;
      }
      if (!job.flyerUrl && !job.pendingFlyer) {
        err.textContent = "Add a flyer before scheduling.";
        err.hidden = false;
        return;
      }
      job.ymd = readComposeDate();
      if (
        promosOnDate(job.ymd, true).filter(function (p) {
          return String(p.id) !== String(item.id);
        }).length >= MAX_SLOTS
      ) {
        err.textContent = "Only " + MAX_SLOTS + " posts can be scheduled on one day.";
        err.hidden = false;
        return;
      }
      job.hm = ($("composeTime") && $("composeTime").value) || nextFreeHm(job.ymd);
    }
    closeCompose();
    if (wantSchedule) setView(viewIndexForYmd(job.ymd));
    runComposeJob(job);
  }

  /* Anything that touches Sandesha is handed to it whole (see
     sandesha-server/promo-jobs.js). The board shows the slot at once and the
     server finishes the job even if this phone switches apps or closes the
     tab; the outcome is picked up by pollJobs, here or on the next open. */
  async function runComposeJob(job) {
    const item = find(job.id);
    if (!item) return;
    const previousIds = scheduleIdsOf(item);
    let ymd = job.ymd;
    let hm = job.hm;
    if (!job.wantSchedule) {
      // Editing the copy of a post that is already queued re-queues it at the
      // same slot, or WhatsApp would send the words that were replaced.
      const parts = splitSendAt(item.send_at);
      if (!previousIds.length || !parts.date || !parts.hm) return runComposeJobHere(job);
      ymd = parts.date;
      hm = parts.hm;
    }
    const key = String(job.id);
    const fields = { message: job.message };
    if (job.wantSchedule) {
      fields.send_at = ymd + " " + hm;
      fields.target = job.targets.length ? JSON.stringify(job.targets) : "";
    }
    jobInputs[key] = job;
    setPendingJob(key, {
      jobId: "",
      title: job.title,
      fields: fields,
      prev: { send_at: item.send_at, target: item.target, message: item.message, status: item.status },
      startedAt: Date.now(),
    });
    overlayPendingJobs();
    render();
    const clock = formatHmAmPm(hm);
    toast(
      job.wantSchedule
        ? "Scheduled for " + clock.time + " " + clock.mer + " — finishing in the background"
        : "Saved — updating the queued post",
      null
    );
    try {
      const bridge = await ensureRelay();
      const targets = job.wantSchedule ? job.targets : bridge.resolveTargets(item.target);
      const sheetFields = { message: job.message };
      if (job.wantSchedule) {
        sheetFields.send_at = fields.send_at;
        sheetFields.target = bridge.stringify(targets);
      }
      let flyer = null;
      if (job.pendingFlyer) {
        flyer = {
          base64: job.pendingFlyer.base64,
          mimeType: job.pendingFlyer.mimeType,
          filename: job.pendingFlyer.filename || flyerFileName(item, job.pendingFlyer.mimeType),
        };
      } else if (job.flyerUrl) {
        flyer = { url: job.flyerUrl };
        sheetFields.flyer_url = job.flyerUrl;
      }
      const started = await bridge.startJob({
        promoId: job.id,
        title: job.title,
        message: job.message,
        runAtIso: sendAtToIso(ymd, hm),
        targets: targets,
        flyer: flyer,
        previousIds: previousIds,
        sheet: { url: APPS_SCRIPT_URL, token: token(), fields: sheetFields },
      });
      const pending = pendingJobs[key];
      if (pending) {
        pending.jobId = started.id;
        savePendingJobs();
      }
      schedulePoll(2000);
    } catch (e) {
      const pending = pendingJobs[key];
      clearPendingJob(key);
      if (pending) Object.assign(item, pending.prev);
      // A Sandesha server that predates /promo-jobs: do it from here instead.
      if (e && e.unsupported) return runComposeJobHere(job);
      render();
      showJobFailure(key, job.title, (e && e.message) || "something went wrong", job.wantSchedule);
    }
  }

  /* ───────── handed-over jobs ─────────
     promoId -> the job Sandesha is running for it, with the fields the board
     shows meanwhile. Kept in localStorage so a reload, or a tab Android
     discarded, still shows the slot and still learns how the job ended. */
  const PENDING_JOBS_KEY = "vjn_promo_jobs";
  const pendingJobs = loadPendingJobs();

  function loadPendingJobs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PENDING_JOBS_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (e) {
      return {};
    }
  }

  function savePendingJobs() {
    try {
      localStorage.setItem(PENDING_JOBS_KEY, JSON.stringify(pendingJobs));
    } catch (e) {}
  }

  function setPendingJob(key, entry) {
    pendingJobs[key] = entry;
    savePendingJobs();
  }

  function clearPendingJob(key) {
    delete pendingJobs[key];
    delete busyIds[key];
    savePendingJobs();
  }

  /** Show what was asked for, not what the sheet says yet. */
  function overlayPendingJobs() {
    items.forEach(function (item) {
      const pending = pendingJobs[String(item.id)];
      if (!pending) return;
      Object.assign(item, pending.fields);
      if (normalizeStatus(item.status) !== "sent") item.status = "ready";
      busyIds[String(item.id)] = true;
    });
  }

  function schedulePoll(ms) {
    clearTimeout(pollTimer);
    if (!Object.keys(pendingJobs).length) return;
    pollTimer = setTimeout(pollJobs, ms || 3000);
  }

  async function pollJobs() {
    clearTimeout(pollTimer);
    const keys = Object.keys(pendingJobs);
    if (!keys.length || document.hidden || !token()) return;
    let bridge;
    let jobs;
    try {
      bridge = await ensureRelay();
      jobs = await bridge.jobs();
    } catch (e) {
      schedulePoll(8000);
      return;
    }
    let changed = false;
    keys.forEach(function (key) {
      const pending = pendingJobs[key];
      if (!pending) return;
      const job = pending.jobId && jobs.find(function (j) {
        return j.id === pending.jobId;
      });
      if (!job) {
        // The hand-off never landed (closed mid-request) — the sheet is the truth.
        if (Date.now() - pending.startedAt > 2 * 60 * 1000) {
          clearPendingJob(key);
          changed = true;
        }
        return;
      }
      if (job.status === "running") return;
      clearPendingJob(key);
      changed = true;
      bridge.dismissJob(job.id).catch(function () {});
      const scheduling = !!(pending.fields && pending.fields.send_at);
      if (job.status === "done") {
        delete jobInputs[key];
        const linked = bridge.isLinked();
        toast(
          scheduling
            ? linked
              ? "“" + pending.title + "” scheduled — Sandesha will post it"
              : "Scheduled — link WhatsApp so it can send"
            : "Queued post updated",
          null
        );
      } else {
        showJobFailure(key, pending.title, job.error || "something went wrong", scheduling);
      }
    });
    if (changed) await load(false).catch(function () {});
    schedulePoll();
  }

  /** Stays on screen until acted on — a lost post must not go unnoticed. */
  function showJobFailure(key, title, message, scheduling) {
    const input = jobInputs[key];
    toast(
      "Couldn't " + (scheduling ? "schedule" : "save") + " “" + title + "”: " + message,
      function () {
        if (input) runComposeJob(input);
        else if (find(key)) openCompose(find(key));
      },
      { label: input ? "Retry" : "Edit", sticky: true }
    );
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) pollJobs();
  });

  /** Plain save, and the fallback when Sandesha cannot take a job. */
  async function runComposeJobHere(job) {
    const item = find(job.id);
    if (!item) return;
    setRowBusy(job.id, true);
    toast(job.wantSchedule ? "Scheduling… you can keep working" : "Saving…", null);
    const previousIds = scheduleIdsOf(item);
    let queuedIds = null;
    let flyerUrl = job.flyerUrl;
    try {
      const payload = {
        formType: "adminSavePromotion",
        token: token(),
        id: job.id,
        message: job.message,
      };
      if (job.wantSchedule) {
        // Hand it to Sandesha before the sheet records the slot, so the board
        // can never show a queued post that WhatsApp was never told about.
        const bridge = await ensureRelay();
        const flyer = await flyerForSandesha(item, flyerUrl);
        queuedIds = await bridge.schedule({
          promoId: job.id,
          message: job.message,
          runAtIso: sendAtToIso(job.ymd, job.hm),
          targets: job.targets,
          flyer: flyer,
        });
        payload.send_at = job.ymd + " " + job.hm;
        payload.target = bridge.stringify(job.targets);
        payload.wa_schedule_ids = queuedIds;
      }
      if (!job.wantSchedule && previousIds.length) {
        // Editing the copy of a post that is already queued: re-queue it at
        // the same slot, or WhatsApp would send the words that were replaced.
        const parts = splitSendAt(item.send_at);
        if (parts.date && parts.hm) {
          const bridge = await ensureRelay();
          queuedIds = await bridge.schedule({
            promoId: job.id,
            message: job.message,
            runAtIso: sendAtToIso(parts.date, parts.hm),
            targets: bridge.resolveTargets(item.target),
            flyer: await flyerForSandesha(item, flyerUrl),
          });
          payload.wa_schedule_ids = queuedIds;
        }
      }
      if (job.pendingFlyer) flyerUrl = await uploadPayload(job.pendingFlyer);
      payload.flyer_url = flyerUrl;
      const data = await apiPost(payload);
      if (data.error) throw new Error(data.error);
      // Committed — only now is it safe to drop the rows this post used to
      // hold, since the sheet no longer refers to them.
      const committed = queuedIds || [];
      queuedIds = null;
      await cancelIds(staleIds(previousIds, committed));
      setRowBusy(job.id, false);
      if (job.wantSchedule) {
        const linked = relay() && relay().isLinked();
        toast(linked ? "Scheduled — Sandesha will post it" : "Scheduled — link WhatsApp so it can send", null);
      } else {
        toast("Saved to Events", null);
      }
      await load(false);
    } catch (e) {
      // The sheet never learned about these rows, so nothing would ever cancel
      // them — drop them rather than leave WhatsApp holding an orphan post.
      // Rows the server deduped back to the existing queue are left alone.
      await cancelIds(staleIds(queuedIds, previousIds)).catch(function () {});
      setRowBusy(job.id, false);
      const what = job.wantSchedule ? "schedule" : "save";
      toast(
        "Couldn't " + what + ": " + ((e && e.message) || "something went wrong"),
        function () { runComposeJob(job); },
        { label: "Retry", ms: 15000 }
      );
    }
  }

  /* ───────── load / boot ───────── */
  function applyPromotions(data) {
    items = (data.items || []).map(function (item) {
      item.status = normalizeStatus(item.status);
      return item;
    });
    overlayPendingJobs();
    const due = items.some(function (item) {
      return normalizeStatus(item.status) === "due";
    });
    const dot = $("notifyDot");
    if (dot) dot.hidden = !due;
    listEl.removeAttribute("aria-busy");
    render();
  }

  async function load(showLoading) {
    if (showLoading !== false) {
      const cached = readPromoCache();
      if (cached) applyPromotions(cached);
      else showBoardLoading();
    }
    const data = await apiPost({
      formType: "adminGet",
      type: "promotions",
      token: token(),
    });
    if (data.error && /Unauthorized|session/i.test(data.error)) {
      clearAuth();
      location.href = "admin.html";
      return;
    }
    if (data.error) throw new Error(data.error);
    writePromoCache(data);
    applyPromotions(data);

    // Sandesha has no way back into the sheet, so the board catches up on
    // what it already posted the next time someone opens this page.
    if (!reconciling && (await reconcileSent())) {
      render();
      reconciling = true;
      try {
        await load(false);
      } finally {
        reconciling = false;
      }
    }
  }

  function bindChrome() {
    fabEl.onclick = function () {
      openPickSheet();
    };
    const logoutBtn = $("logoutBtn");
    if (logoutBtn) logoutBtn.onclick = function () {
      const t = token();
      clearAuth();
      // Leave at once; telling the server is best effort and must not hold the page.
      if (t) {
        try {
          fetch(APPS_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({ formType: "adminLogout", token: t }),
            keepalive: true,
          }).catch(function () {});
        } catch (e) {}
      }
      location.href = "admin.html";
    };
    $("notifyBtn").onclick = function () {
      toast("Alerts stay on when this page is installed as an app", null);
    };
    const hdr = document.querySelector(".hdr");
    if (hdr && listEl) {
      const compact = function () {
        hdr.classList.toggle("is-compact", listEl.scrollTop > 20);
      };
      listEl.addEventListener("scroll", compact, { passive: true });
      compact();
    }
    $("composeClose").addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeCompose();
    });
    $("composeCancel").addEventListener("click", function (e) {
      e.preventDefault();
      closeCompose();
    });
    $("composeAud").addEventListener("click", async function () {
      const sub = $("composeAudSub");
      if (sub) sub.textContent = "Opening lists…";
      try {
        const bridge = await ensureRelay();
        composeTargets = await bridge.pick(composeTargets);
        syncComposeAudience();
      } catch (e) {
        if (sub) sub.textContent = e.message || "Messaging unavailable";
      }
    });
    $("composeScrim").addEventListener("click", closeCompose);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("compose") && $("compose").classList.contains("open")) {
        closeCompose();
      }
    });
    $("composeSave").onclick = saveCompose;
    $("composePaste").onclick = pasteComposeMessage;
    $("composeMessage").addEventListener("input", syncComposeCount);
    document.querySelectorAll('input[name="composeWhen"]').forEach(function (r) {
      r.addEventListener("change", syncComposeWhen);
    });
    const composeDate = $("composeDate");
    if (composeDate) {
      composeDate.addEventListener("change", function () {
        setComposeDate(composeDate.value);
      });
    }
    $("composeFlyerFile").addEventListener("change", async function () {
      const file = this.files && this.files[0];
      if (!file) return;
      $("composeFlyerName").textContent = "Reading photo…";
      try {
        pendingFlyer = await readFileAsImagePayload(file);
        $("composeFlyerName").textContent = file.name || "Replace flyer";
        setFlyerPreview(pendingFlyer.preview);
        syncFlyerReset(find(editingId));
        syncComposeWhen();
      } catch (e) {
        pendingFlyer = null;
        $("composeFlyerName").textContent = "No flyer yet";
        const err = $("composeErr");
        err.textContent = e.message || "Could not read that image.";
        err.hidden = false;
        syncComposeWhen();
      }
    });
    $("composeFlyerReset").onclick = function () {
      const item = find(editingId);
      if (!item) return;
      pendingFlyer = null;
      flyerOverride = String(item.event_image || "").trim();
      $("composeFlyerFile").value = "";
      $("composeFlyerName").textContent = flyerOverride ? "Programs photo" : "No flyer yet";
      setFlyerPreview(flyerOverride);
      syncFlyerReset(item);
      syncComposeWhen();
    };
  }

  function initPullToRefresh() {
    if (!window.PullToRefresh) return;
    var scroll = $("scroll");
    if (!scroll) return;
    window.PullToRefresh.init({
      scroller: scroll,
      onRefresh: function () {
        // A pull behind the compose panel or a sheet would refresh unseen.
        var panel = $("compose");
        if (panel && panel.classList.contains("open")) return Promise.resolve();
        if (sheetEl && sheetEl.classList.contains("on")) return Promise.resolve();
        if (!token()) return Promise.resolve();
        return load(false);
      }
    });
  }

  async function boot() {
    initTheme();
    buildTabs();
    bindChrome();
    setView(0);
    initPullToRefresh();
    if (!token()) {
      render();
      return;
    }
    try {
      await load(true);
      watchComposeDraft();
      pollJobs();
    } catch (e) {
      listEl.removeAttribute("aria-busy");
      listEl.innerHTML = emptyHtml(
        CLK_ART,
        "Could not load",
        esc(e.message || "Try again") + '<br/><a href="admin.html">Return to Admin</a>',
      );
    }
  }

  /**
   * Android Chrome reloads a tab it discarded in the background, which used to
   * empty a half-written post. drafts.js keeps the fields; this reopens the
   * post they belong to and puts back the audience and chosen flyer.
   */
  function watchComposeDraft() {
    if (!window.DraftKeeper) return;
    DraftKeeper.watch("boardCompose", {
      root: function () { return $("compose"); },
      isOpen: function () { return !!$("compose") && $("compose").classList.contains("open"); },
      meta: function () {
        return { id: editingId, targets: composeTargets, flyer: flyerOverride, hadFile: !!pendingFlyer };
      },
      reopen: function (meta) {
        const item = meta && find(meta.id);
        if (!item) return false;
        openCompose(item);
        return true;
      },
      restored: function (meta) {
        if (!meta || String(editingId) !== String(meta.id)) return;
        if (Array.isArray(meta.targets) && meta.targets.length) {
          composeTargets = meta.targets;
          syncComposeAudience();
        }
        if (meta.flyer) {
          flyerOverride = meta.flyer;
          $("composeFlyerName").textContent = "Chosen flyer";
          setFlyerPreview(meta.flyer);
          syncFlyerReset(find(editingId));
        }
        syncComposeCount();
        syncComposeDays();
        syncComposeWhen();
      },
    });
  }

  boot();
})();

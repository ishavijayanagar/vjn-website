(function () {
  "use strict";

  const TOKEN_KEY = "vjn_admin_token";
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
  let composeDay = "today";
  let editingId = "";
  let pendingFlyer = null;
  let flyerOverride = "";
  const busyIds = {};
  const MARK_SPIN = '<span class="mark-spin" aria-hidden="true"></span>';

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

  async function downloadFlyer(item, btn) {
    const url = flyerOf(item);
    if (!url) {
      toast("No flyer to download", null);
      return;
    }
    setBtnBusy(btn, true);
    /* Ask for Pictures access immediately while the tap gesture is still valid. */
    let galleryPromise = null;
    if (typeof window.showDirectoryPicker === "function") {
      galleryPromise = ensureGalleryDir(true).catch(function () {
        return null;
      });
    }
    try {
      const tasks = [resolveFlyerBlob(item, url)];
      if (galleryPromise) tasks.push(galleryPromise);
      const results = await Promise.all(tasks);
      const resolved = results[0];
      const dir = galleryPromise ? results[1] : null;
      const blob = resolved.blob;
      const mime = resolved.mime;
      const filename = resolved.filename;

      if (dir) {
        await writeBlobToDir(dir, blob, filename);
        toast("Flyer saved to gallery", null);
        return;
      }

      try {
        if (await saveWithFilePicker(blob, filename, mime)) {
          toast("Flyer saved", null);
          return;
        }
      } catch (pickerErr) {
        if (pickerErr && pickerErr.name === "AbortError") return;
      }

      /* Share sheet = preview + manual save — only use on iOS where downloads are limited. */
      if (isIosLike()) {
        const file = new File([blob], filename, { type: mime });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: filename,
            text: (item && item.event_title) || "Flyer",
          });
          toast("Tap Save Image in the share sheet", null);
          return;
        }
      }

      triggerAnchorDownload(blob, filename);
      toast("Flyer downloaded", null);
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
    return dt.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" });
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

  function dayList(offset, includeSent) {
    const ymd = offset ? shiftYmd(todayYmd(), 1) : todayYmd();
    return items
      .filter(function (item) {
        if (!includeSent && normalizeStatus(item.status) === "sent") return false;
        return splitSendAt(item.send_at).date === ymd;
      })
      .sort(function (a, b) {
        return String(a.send_at || "").localeCompare(String(b.send_at || ""));
      });
  }

  function libraryItems() {
    return items
      .filter(function (item) {
        if (item.event_open === false) return false;
        const s = normalizeStatus(item.status);
        return s === "pending" || s === "ready" || s === "due";
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

  function nextFreeHm(ymd) {
    const used = {};
    dayList(ymd === shiftYmd(todayYmd(), 1) ? 1 : 0, true).forEach(function (item) {
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
      return '<button type="button" data-i="' + i + '">' + n + "</button>";
    }).join("");
    tabsBase.innerHTML = html;
    tabsAct.innerHTML = html;
    tabsBase.querySelectorAll("button").forEach(function (b) {
      b.onclick = function () {
        setView(+b.dataset.i);
      };
    });
  }

  function setView(i) {
    view = i;
    const w = 100 / TABS.length;
    tabsAct.style.clipPath =
      "inset(0 " + (100 - w * (i + 1)) + "% 0 " + w * i + "% round 10px)";
    if (i === 0) dayTitleEl.textContent = dayTitle(0);
    else if (i === 1) dayTitleEl.textContent = dayTitle(1);
    else dayTitleEl.textContent = "Events";
    render();
  }

  /* ───────── render ───────── */
  function statusLine(entry) {
    if (entry.state === "sent") return "<em>Sent " + esc(entry.note) + "</em>";
    if (entry.state === "late") return "<em>" + esc(entry.note) + "</em>";
    if (entry.state === "next") return "<em>Next " + esc(entry.note) + "</em>";
    return "Scheduled";
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
      '<span class="t">' +
      esc(clock.time) +
      "<small>" +
      esc(clock.mer) +
      "</small></span>" +
      '<span class="th">' +
      thumbHtml(flyer) +
      "</span>" +
      '<span class="tx"><b>' +
      esc(p.event_title || "Untitled") +
      "</b><span>" +
      statusLine(entry) +
      "</span></span>" +
      '<span class="mark' +
      (busy ? " is-busy" : "") +
      '" aria-hidden="true">' +
      (busy ? MARK_SPIN : CHK) +
      "</span>" +
      "</button></li>"
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
      barEl.style.visibility = "hidden";
      listEl.innerHTML =
        '<div class="empty"><h3>Sign in required</h3>Open <a href="admin.html">Admin</a> to sign in, then return here.</div>';
      return;
    }

    if (view === 2) {
      barEl.style.visibility = "hidden";
      const lib = libraryItems();
      if (!lib.length) {
        listEl.innerHTML =
          '<div class="empty"><h3>No events yet</h3>Open programs appear here after Programs publishes an event.</div>';
        return;
      }
      listEl.innerHTML =
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

    barEl.style.visibility = "visible";
    const offset = view === 1 ? 1 : 0;
    const list = dayList(offset, true);
    updateBar(list, view === 0);

    if (!list.length) {
      listEl.innerHTML =
        '<div class="empty"><h3>Nothing scheduled</h3>Tap New post to write a message and pick a time.</div>';
      return;
    }

    const annotated = annotate(list);
    listEl.innerHTML =
      '<ul style="list-style:none;margin:0;padding:0">' +
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
  function toast(msg, fn) {
    tmsgEl.textContent = msg;
    undoFn = fn || null;
    undoEl.style.display = undoFn ? "" : "none";
    fabEl.classList.add("hide");
    toastEl.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4200);
  }

  function hideToast() {
    toastEl.classList.remove("on");
    fabEl.classList.remove("hide");
    undoFn = null;
  }

  undoEl.onclick = function () {
    if (undoFn) undoFn();
    hideToast();
  };

  /* ───────── actions ───────── */
  async function markSent(id) {
    const p = find(id);
    if (!p || normalizeStatus(p.status) === "sent") return;
    if (busyIds[String(id)]) return;
    setRowBusy(id, true);
    try {
      const data = await apiPost({
        formType: "adminMarkPromotionSent",
        token: token(),
        id: id,
      });
      if (data.error) throw new Error(data.error);
      delete busyIds[String(id)];
      await load(false);
      toast((p.event_title || "Post") + " marked as sent", function () {
        unmarkSent(id);
      });
    } catch (e) {
      setRowBusy(id, false);
      toast(e.message || "Could not mark sent", null);
    }
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
      const data = await apiPost({
        formType: "adminSavePromotion",
        token: token(),
        id: id,
        send_at: day + " " + hm,
      });
      if (data.error) throw new Error(data.error);
      await load(false);
      toast((p.event_title || "Post") + " snoozed 15 minutes", null);
    } catch (e) {
      setRowBusy(id, false);
      toast(e.message || "Could not snooze", null);
    }
  }

  async function removeFromDay(id) {
    try {
      const data = await apiPost({
        formType: "adminSavePromotion",
        token: token(),
        id: id,
        send_at: "",
      });
      if (data.error) throw new Error(data.error);
      await load(false);
      toast("Removed from day", null);
    } catch (e) {
      toast(e.message || "Could not remove", null);
    }
  }

  /* ───────── detail / pick sheet ───────── */
  function openDetailSheet(id) {
    const p = find(id);
    if (!p) return;
    current = p;
    sheetMode = "detail";
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
        ? '<button type="button" class="b pri" data-a="unsend" style="background:var(--green-tint);color:var(--green);box-shadow:none"><span class="lbl">' +
          CHK +
          " Sent · tap to undo</span></button>"
        : '<button type="button" class="b pri" data-a="sent"><span class="lbl">' +
          CHK +
          " Mark as sent</span></button>") +
      "</div>" +
      '<button type="button" class="hold" data-a="hold">Hold to remove<span class="fillx">Removing…</span></button>';

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
    sheetEl.innerHTML =
      '<div class="grab"></div>' +
      "<div class=\"sh-top\"><div><b>Choose a program</b><span>Open events ready to promote</span></div></div>" +
      '<input type="search" class="pick-search" id="pickSearch" placeholder="Search…" autocomplete="off"/>' +
      '<div id="pickList"></div>';
    const renderPick = function (q) {
      const query = String(q || "").trim().toLowerCase();
      const filtered = lib.filter(function (item) {
        if (!query) return true;
        return (
          String(item.event_title || "").toLowerCase().indexOf(query) >= 0 ||
          String(item.event_location || "").toLowerCase().indexOf(query) >= 0
        );
      });
      const host = $("pickList");
      if (!host) return;
      if (!filtered.length) {
        host.innerHTML = '<div class="empty">No open programs found.</div>';
        return;
      }
      host.innerHTML = filtered
        .map(function (item) {
          const s = normalizeStatus(item.status);
          return (
            '<button type="button" class="pick-row" data-pick="' +
            esc(item.id) +
            '"><span class="th">' +
            thumbHtml(flyerOf(item)) +
            "</span><span><b>" +
            esc(item.event_title || "Untitled") +
            "</b><span>" +
            (s === "pending" ? "Pending" : "Ready") +
            "</span></span></button>"
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
      search.oninput = function () {
        renderPick(search.value);
      };
      setTimeout(function () {
        search.focus();
      }, 50);
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
        const start = function () {
          b.classList.add("holding");
          timer = setTimeout(function () {
            b.classList.remove("holding");
            parkFocusOutside(sheetEl);
            closeSheet();
            removeFromDay(p.id);
          }, 1200);
        };
        const stop = function () {
          clearTimeout(timer);
          b.classList.remove("holding");
        };
        b.addEventListener("pointerdown", start);
        b.addEventListener("pointerup", stop);
        b.addEventListener("pointerleave", stop);
        b.addEventListener("pointercancel", stop);
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
      else sheetEl.style.transform = "translateY(0)";
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
    if (scheduleOn) syncComposeDays();
  }

  // Mirrors the flyer resolution in saveCompose so the UI can warn before submit.
  function currentFlyerUrl() {
    if (pendingFlyer) return "__pending__";
    if (flyerOverride) return flyerOverride;
    const item = find(editingId);
    if (!item) return "";
    return String(item.flyer_url || "").trim() || String(item.event_image || "").trim();
  }

  // Slot pressure per day, counted the same way saveCompose validates it.
  function syncComposeDays() {
    const cur = find(editingId);
    document.querySelectorAll(".compose-day").forEach(function (btn) {
      const day = btn.getAttribute("data-day");
      const used = dayList(day === "tomorrow" ? 1 : 0, true).filter(function (p) {
        return !cur || String(p.id) !== String(cur.id);
      }).length;
      const left = Math.max(0, MAX_SLOTS - used);
      const small = btn.querySelector("small");
      if (small) small.textContent = left ? left + (left === 1 ? " slot free" : " slots free") : "Full";
      btn.disabled = left === 0;
    });
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

  function setComposeDay(day) {
    composeDay = day === "tomorrow" ? "tomorrow" : "today";
    document.querySelectorAll(".compose-day").forEach(function (btn) {
      btn.classList.toggle("on", btn.getAttribute("data-day") === composeDay);
    });
    fillTimeSelect();
    const ymd = composeDay === "tomorrow" ? shiftYmd(todayYmd(), 1) : todayYmd();
    const timeEl = $("composeTime");
    if (timeEl) timeEl.value = nextFreeHm(ymd);
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
    fillTimeSelect();
    const pending = normalizeStatus(item.status) === "pending";
    const chip = $("composeEyebrow");
    chip.textContent = pending ? "Pending" : "Ready";
    chip.classList.toggle("is-pending", pending);
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
    setComposeDay(view === 1 ? "tomorrow" : "today");
    syncComposeCount();
    syncComposeDays();
    syncComposeWhen();
    setComposeOpen(true);
    if (!String(item.message || "").trim()) {
      setTimeout(function () {
        $("composeMessage").focus();
      }, 50);
    }
  }

  function closeCompose() {
    setComposeOpen(false);
    editingId = "";
    pendingFlyer = null;
    flyerOverride = "";
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

  async function saveCompose() {
    const item = find(editingId);
    if (!item) return;
    const err = $("composeErr");
    const message = ($("composeMessage").value || "").trim();
    const wantSchedule = $("composeWhenSchedule") && $("composeWhenSchedule").checked;
    const btn = $("composeSave");
    err.hidden = true;
    if (!message) {
      err.textContent = "Write a message.";
      err.hidden = false;
      return;
    }
    let flyerUrl =
      flyerOverride || String(item.flyer_url || "").trim() || String(item.event_image || "").trim();
    btn.disabled = true;
    btn.textContent = wantSchedule ? "Scheduling…" : "Saving…";
    try {
      if (pendingFlyer) flyerUrl = await uploadPayload(pendingFlyer);
      const payload = {
        formType: "adminSavePromotion",
        token: token(),
        id: item.id,
        message: message,
        flyer_url: flyerUrl,
      };
      if (wantSchedule) {
        if (!flyerUrl) {
          err.textContent = "Add a flyer before scheduling.";
          err.hidden = false;
          return;
        }
        const ymd = composeDay === "tomorrow" ? shiftYmd(todayYmd(), 1) : todayYmd();
        if (
          dayList(composeDay === "tomorrow" ? 1 : 0, true).filter(function (p) {
            return String(p.id) !== String(item.id);
          }).length >= MAX_SLOTS
        ) {
          err.textContent = "Only " + MAX_SLOTS + " posts can be scheduled on one day.";
          err.hidden = false;
          return;
        }
        const hm = ($("composeTime") && $("composeTime").value) || nextFreeHm(ymd);
        payload.send_at = ymd + " " + hm;
      }
      const data = await apiPost(payload);
      if (data.error) throw new Error(data.error);
      closeCompose();
      await load(false);
      if (wantSchedule) {
        setView(composeDay === "tomorrow" ? 1 : 0);
        toast("Scheduled", null);
      } else {
        toast("Saved to Events", null);
      }
    } catch (e) {
      err.textContent = e.message || "Could not save.";
      err.hidden = false;
    } finally {
      btn.disabled = false;
      syncComposeWhen();
    }
  }

  /* ───────── load / boot ───────── */
  async function load(showLoading) {
    if (showLoading !== false) {
      listEl.innerHTML = '<div class="empty">Loading…</div>';
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
    items = (data.items || []).map(function (item) {
      item.status = normalizeStatus(item.status);
      return item;
    });
    const due = items.some(function (item) {
      return normalizeStatus(item.status) === "due";
    });
    const dot = $("notifyDot");
    if (dot) dot.hidden = !due;
    render();
  }

  function bindChrome() {
    fabEl.onclick = function () {
      openPickSheet();
    };
    $("logoutBtn").onclick = async function () {
      const t = token();
      clearAuth();
      if (t) {
        try {
          await apiPost({ formType: "adminLogout", token: t });
        } catch (e) {}
      }
      location.href = "admin.html";
    };
    $("notifyBtn").onclick = function () {
      toast("Alerts stay on when this page is installed as an app", null);
    };
    $("composeClose").addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeCompose();
    });
    $("composeCancel").addEventListener("click", function (e) {
      e.preventDefault();
      closeCompose();
    });
    $("composeScrim").addEventListener("click", closeCompose);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("compose") && $("compose").classList.contains("open")) {
        closeCompose();
      }
    });
    $("composeSave").onclick = saveCompose;
    $("composeMessage").addEventListener("input", syncComposeCount);
    document.querySelectorAll('input[name="composeWhen"]').forEach(function (r) {
      r.addEventListener("change", syncComposeWhen);
    });
    document.querySelectorAll(".compose-day").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setComposeDay(btn.getAttribute("data-day"));
      });
    });
    $("composeFlyerFile").addEventListener("change", async function () {
      const file = this.files && this.files[0];
      if (!file) return;
      try {
        pendingFlyer = await readFileAsImagePayload(file);
        $("composeFlyerName").textContent = file.name || "Replace flyer";
        setFlyerPreview(pendingFlyer.preview);
        syncFlyerReset(find(editingId));
        syncComposeWhen();
      } catch (e) {
        pendingFlyer = null;
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
    } catch (e) {
      listEl.innerHTML =
        '<div class="empty"><h3>Could not load</h3>' +
        esc(e.message || "Try again") +
        '<br><a href="admin.html">Return to Admin</a></div>';
    }
  }

  boot();
})();

(function () {
  const TOKEN_KEY = "vjn_admin_token";
  const MAX_IMAGE_EDGE = 1400;
  const JPEG_QUALITY = 0.82;
  const FREQUENCY_OPTIONS = ["Daily", "Weekly", "Monthly", "Scheduled"];
  const DEFAULT_LOCATION = "Isha Place, Vijayanagar";

  let currentResource = "programs";
  let items = [];
  let listingFilter = "open";
  let editingId = "";
  let pendingImage = null;
  let editorMode = "single";
  let bulkPreviewRows = [];
  let hubStatsAt = 0;
  let hubStatsDirty = true;
  const listingPrefetch = {};

  function setButtonBusy(btn, on, busyText) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.idleLabel) btn.dataset.idleLabel = btn.textContent;
      btn.disabled = true;
      btn.classList.add("is-busy");
      if (busyText) btn.textContent = busyText;
    } else {
      btn.disabled = false;
      btn.classList.remove("is-busy");
      if (btn.dataset.idleLabel) btn.textContent = btn.dataset.idleLabel;
    }
  }

  function setPageBusy(on, message) {
    const app = $("adminApp");
    if (app) app.classList.toggle("is-page-busy", !!on);
    document.body.classList.toggle("is-page-busy", !!on);
    if (on) {
      if (window.beginPageLoad) beginPageLoad();
      else document.documentElement.classList.add("is-page-loading");
    } else if (window.endPageLoad) {
      endPageLoad();
    } else {
      document.documentElement.classList.remove("is-page-loading");
    }
    document.querySelectorAll(
      "button, .filter-pill, .inquiry-type-pill, .inquiry-status-tab, .inquiry-action, .admin-hub-path"
    ).forEach(function (el) {
      if (!el) return;
      if (on) {
        if (!el.dataset.wasDisabled) el.dataset.wasDisabled = el.disabled ? "1" : "0";
        el.disabled = true;
      } else if (el.dataset.wasDisabled !== undefined) {
        el.disabled = el.dataset.wasDisabled === "1";
        delete el.dataset.wasDisabled;
      }
    });
    if (on && message) setStatus(message);
  }

  function token() {
    try {
      return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function setToken(value) {
    try {
      if (value) {
        localStorage.setItem(TOKEN_KEY, value);
        sessionStorage.removeItem(TOKEN_KEY);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
      }
    } catch (e) {}
  }

  function $(id) {
    return document.getElementById(id);
  }

  function show(el, on) {
    if (!el) return;
    el.classList.toggle("hidden", !on);
  }

  function friendlyError(message) {
    const msg = String(message || "");
    if (/DriveApp|auth\/drive/i.test(msg)) {
      return "Google Drive is not allowed yet. In the spreadsheet: Extensions → Apps Script → function setupAdmin → Run → Allow. Then Deploy → Manage deployments → pencil → New version → Deploy. After that, save again.";
    }
    return msg;
  }

  async function apiPost(payload) {
    const formType = (payload && payload.formType) || "";
    if (/^admin/.test(formType) && formType !== "adminLogin") {
      hubStatsDirty = true;
      delete listingPrefetch.programs;
      delete listingPrefetch.volunteering;
    }
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Could not read the server response. Redeploy the Apps Script and try again.");
    }
  }

  async function apiGet(type, asAdmin, extra) {
    let url = APPS_SCRIPT_URL + "?type=" + encodeURIComponent(type);
    if (asAdmin) {
      url += "&admin=1&token=" + encodeURIComponent(token());
    }
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        if (extra[key] === undefined || extra[key] === null || extra[key] === "") return;
        url += "&" + encodeURIComponent(key) + "=" + encodeURIComponent(extra[key]);
      });
    }
    const res = await fetch(url);
    return res.json();
  }

  function setStatus(message, isError) {
    const el = $("adminStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", !!isError);
  }

  function loginError(message) {
    const el = $("loginError");
    el.textContent = message || "";
    el.style.display = message ? "block" : "none";
  }

  function enterApp() {
    document.documentElement.classList.add("admin-authed");
    show($("loginScreen"), false);
    show($("adminApp"), true);
    const hash = (location.hash || "").replace(/^#/, "").toLowerCase();
    if (hash === "events" || hash === "queries") {
      openAdminPage(hash, true);
    } else {
      showAdminHub(true);
      if (window.endPageLoad) endPageLoad();
    }
  }

  function setAdminTitle(title) {
    const el = $("adminPageTitle");
    if (el) el.textContent = title;
    document.title = title + " – Isha Place, Vijayanagar";
  }

  function hubGreeting(now) {
    const hour = now.getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    if (hour < 21) return "Good evening";
    return "Good night";
  }

  function renderHubIntro() {
    const now = new Date();
    const greet = $("hubGreeting");
    if (greet) greet.textContent = hubGreeting(now);
    const date = $("hubDate");
    if (date) {
      date.textContent = now.toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
  }

  function setHubStat(key, open, total) {
    const value = document.querySelector('[data-stat-value="' + key + '"]');
    const sub = document.querySelector('[data-stat-sub="' + key + '"]');
    if (value) value.textContent = open == null ? "—" : String(open);
    if (sub) {
      sub.textContent =
        total == null ? "" : total === 0 ? "nothing yet" : "of " + total + " total";
    }
  }

  function hubStatsNote(message) {
    const note = $("hubStatsNote");
    if (!note) return;
    note.textContent = message || "";
    note.hidden = !message;
  }

  function countOpenListings(list) {
    return (list || []).filter(isListingOpen).length;
  }

  async function loadHubStats(force) {
    const grid = $("hubStats");
    if (!grid) return;
    const fresh = Date.now() - hubStatsAt < 30000;
    if (!force && !hubStatsDirty && fresh) return;
    grid.classList.add("is-loading");
    hubStatsNote("");
    try {
      const [programs, volunteering, inquiries] = await Promise.all([
        apiGet("programs", true),
        apiGet("volunteering", true),
        apiGet("inquiries", true),
      ]);
      const unauthorized = [programs, volunteering, inquiries].find(function (res) {
        return res && res.error && /Unauthorized/i.test(res.error);
      });
      if (unauthorized) {
        logout();
        loginError(unauthorized.error);
        return;
      }
      const programItems = (programs && programs.items) || [];
      const volunteerItems = (volunteering && volunteering.items) || [];
      listingPrefetch.programs = { items: programItems, at: Date.now() };
      listingPrefetch.volunteering = { items: volunteerItems, at: Date.now() };
      setHubStat("programs", countOpenListings(programItems), programItems.length);
      setHubStat("volunteering", countOpenListings(volunteerItems), volunteerItems.length);
      const groups = (inquiries && inquiries.groups) || [];
      const openQueries = groups.reduce(function (sum, g) {
        return sum + (g.openCount || 0);
      }, 0);
      const totalQueries = groups.reduce(function (sum, g) {
        return sum + (g.total || 0);
      }, 0);
      setHubStat("queries", openQueries, totalQueries);
      hubStatsAt = Date.now();
      hubStatsDirty = false;
    } catch (err) {
      setHubStat("programs", null, null);
      setHubStat("volunteering", null, null);
      setHubStat("queries", null, null);
      hubStatsNote("Could not load today's counts. Open a workspace to see the latest.");
    } finally {
      grid.classList.remove("is-loading");
    }
  }

  function showAdminHub(replaceHash) {
    const app = $("adminApp");
    if (app) {
      app.classList.add("is-hub");
      app.classList.remove("is-workspace", "is-queries", "is-events");
    }
    show($("adminHub"), true);
    show($("adminWorkspace"), false);
    show($("backToHubBtn"), false);
    show($("adminOpenBadge"), false);
    show($("logoutBtn"), true);
    setAdminTitle("Admin");
    setStatus("");
    renderHubIntro();
    loadHubStats();
    if (replaceHash) {
      if (location.hash && location.hash !== "#") {
        history.replaceState(null, "", location.pathname + location.search);
      }
    } else if (location.hash) {
      history.pushState(null, "", location.pathname + location.search);
    }
  }

  function openAdminPage(page, replaceHash) {
    const isQueries = page === "queries";
    const app = $("adminApp");
    if (app) {
      app.classList.remove("is-hub");
      app.classList.add("is-workspace");
      app.classList.toggle("is-queries", isQueries);
      app.classList.toggle("is-events", !isQueries);
    }
    show($("adminHub"), false);
    show($("adminWorkspace"), true);
    show($("backToHubBtn"), true);
    show($("logoutBtn"), false);
    show($("listingsPanel"), !isQueries);
    show($("inquiriesPanel"), isQueries);
    $("addItemBtn").classList.toggle("hidden", isQueries);
    if (isQueries) show($("adminOpenBadge"), false);
    setAdminTitle(isQueries ? "Queries" : "Events");
    const hash = isQueries ? "#queries" : "#events";
    if (replaceHash) history.replaceState(null, "", hash);
    else if (location.hash !== hash) history.pushState(null, "", hash);
    if (isQueries) {
      inquiryShowLimit = 12;
      loadInquiries();
    } else {
      setTab(currentResource === "volunteering" ? "volunteering" : "programs");
    }
  }

  function logout() {
    setToken("");
    document.documentElement.classList.remove("admin-authed");
    show($("adminApp"), false);
    show($("loginScreen"), true);
    setAdminTitle("Admin login");
    document.title = "Admin login – Isha Place, Vijayanagar";
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    closeLogoutConfirm();
  }

  function openLogoutConfirm() {
    const overlay = $("logoutOverlay");
    if (overlay) overlay.classList.add("open");
  }

  function closeLogoutConfirm() {
    const overlay = $("logoutOverlay");
    if (overlay) overlay.classList.remove("open");
  }

  async function handleLogin() {
    const password = $("adminPassword").value;
    const btn = $("loginBtn");
    loginError("");
    if (!password) {
      loginError("Enter the admin password.");
      return;
    }
    setButtonBusy(btn, true, "Signing in…");
    try {
      const data = await apiPost({ formType: "adminLogin", password: password });
      if (data.error || !data.token) {
        loginError(data.error || "Login failed.");
        return;
      }
      setToken(data.token);
      $("adminPassword").value = "";
      enterApp();
    } catch (err) {
      loginError(err.message || "Login failed.");
    } finally {
      setButtonBusy(btn, false);
    }
  }

  function driveFileId(url) {
    if (!url || typeof url !== "string") return "";
    const u = url.trim();
    const fromPath = u.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (fromPath) return fromPath[1];
    const fromQuery = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (fromQuery) return fromQuery[1];
    const fromLh = u.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
    if (fromLh) return fromLh[1];
    return "";
  }

  function fixDriveUrl(url) {
    const id = driveFileId(url);
    if (id) return "https://drive.google.com/thumbnail?id=" + id + "&sz=w800";
    return url;
  }

  function setListingImagePreview(url) {
    const img = $("fImagePreview");
    if (!img) return;
    const src = url ? fixDriveUrl(url) : "";
    img.src = src || "";
    img.referrerPolicy = "no-referrer";
    img.style.display = src ? "block" : "none";
  }
  const SANNIDHI_STORE_KEY = "vjn_sannidhi_defaults";
  const SANNIDHI_DEFAULTS = {
    title: "Sannidhi Pooja",
    location: "Isha Place, Vijayanagar",
    duration: "45 mins",
    description: "Weekly Sannidhi Pooja at the centre.",
    frequency: "Weekly",
    registerlink: "",
    image: "https://drive.google.com/file/d/1Mv7j8R_QyWqk4uJg24UtbEhbzOH43VVb/view?usp=drive_link",
    timings: "6:00 PM – 6:45 PM",
  };

  function nextMonday(from) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const offset = (1 - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + offset);
    return d;
  }

  function formatMondayLabel(d) {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    return "Monday, " + d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }

  function loadSannidhiDefaults() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(SANNIDHI_STORE_KEY) || "{}") || {};
    } catch (err) {
      saved = {};
    }
    return {
      title: SANNIDHI_DEFAULTS.title,
      location: saved.location || SANNIDHI_DEFAULTS.location,
      duration: saved.duration != null ? saved.duration : SANNIDHI_DEFAULTS.duration,
      description: saved.description != null ? saved.description : SANNIDHI_DEFAULTS.description,
      frequency: SANNIDHI_DEFAULTS.frequency,
      registerlink: saved.registerlink || "",
      image: saved.image || SANNIDHI_DEFAULTS.image,
      timings: saved.timings || SANNIDHI_DEFAULTS.timings,
    };
  }

  function rememberSannidhiDefaults(item) {
    if (!item || !/^sannidhi pooja$/i.test(item.title || "")) return;
    localStorage.setItem(
      SANNIDHI_STORE_KEY,
      JSON.stringify({
        timings: item.timings || "",
        location: item.location || "",
        duration: item.duration || "",
        description: item.description || "",
        registerlink: item.registerlink || "",
        image: item.image || "",
      })
    );
  }

  function setTemplateActive(id) {
    document.querySelectorAll("[data-template]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-template") === id);
    });
  }

  function toInputDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function hmToParts(hm) {
    const m = String(hm || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { hour: "6", min: "00", ap: "AM" };
    let h = parseInt(m[1], 10);
    let min = parseInt(m[2], 10);
    const opts = [0, 15, 30, 45];
    let best = 0;
    let bestDiff = 99;
    opts.forEach(function (o) {
      const d = Math.abs(o - min);
      if (d < bestDiff) {
        bestDiff = d;
        best = o;
      }
    });
    min = best;
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return { hour: String(h), min: pad2(min), ap: ap };
  }

  function partsToHm(hourEl, minEl, apEl) {
    if (!hourEl || !minEl || !apEl) return "";
    let h = parseInt(hourEl.value, 10);
    const min = minEl.value || "00";
    const ap = apEl.value;
    if (isNaN(h)) return "";
    if (ap === "AM") {
      if (h === 12) h = 0;
    } else if (h !== 12) h += 12;
    return pad2(h) + ":" + min;
  }

  function formatHmAmPm(hm) {
    const p = hmToParts(hm);
    if (!hm) return "";
    return p.hour + ":" + p.min + " " + p.ap;
  }

  function formatSlotLabel(startHm, endHm) {
    const a = formatHmAmPm(startHm);
    const b = formatHmAmPm(endHm);
    if (a && b) return a + " – " + b;
    return a || b || "";
  }

  function fillTimeSelects() {
    const hours = [];
    for (let h = 1; h <= 12; h++) hours.push('<option value="' + h + '">' + h + "</option>");
    const mins = ["00", "15", "30", "45"]
      .map(function (m) {
        return '<option value="' + m + '">' + m + "</option>";
      })
      .join("");
    const hourHtml = hours.join("");
    ["fSlot1StartHour", "fSlot1EndHour", "fSlot2StartHour", "fSlot2EndHour"].forEach(function (id) {
      const el = $(id);
      if (el && !el.options.length) el.innerHTML = hourHtml;
    });
    ["fSlot1StartMin", "fSlot1EndMin", "fSlot2StartMin", "fSlot2EndMin"].forEach(function (id) {
      const el = $(id);
      if (el && !el.options.length) el.innerHTML = mins;
    });
  }

  function setSlotFields(slotNum, startHm, endHm) {
    const prefix = slotNum === 2 ? "fSlot2" : "fSlot1";
    const sp = hmToParts(startHm || "06:00");
    const ep = hmToParts(endHm || "09:00");
    if ($(prefix + "StartHour")) $(prefix + "StartHour").value = sp.hour;
    if ($(prefix + "StartMin")) $(prefix + "StartMin").value = sp.min;
    if ($(prefix + "StartAp")) $(prefix + "StartAp").value = sp.ap;
    if ($(prefix + "EndHour")) $(prefix + "EndHour").value = ep.hour;
    if ($(prefix + "EndMin")) $(prefix + "EndMin").value = ep.min;
    if ($(prefix + "EndAp")) $(prefix + "EndAp").value = ep.ap;
  }

  function getSlotHm(slotNum) {
    const prefix = slotNum === 2 ? "fSlot2" : "fSlot1";
    return {
      start: partsToHm($(prefix + "StartHour"), $(prefix + "StartMin"), $(prefix + "StartAp")),
      end: partsToHm($(prefix + "EndHour"), $(prefix + "EndMin"), $(prefix + "EndAp")),
    };
  }

  function isSlot2Visible() {
    const wrap = $("slot2Wrap");
    return !!(wrap && !wrap.classList.contains("hidden"));
  }

  function setSlot2Visible(on) {
    show($("slot2Wrap"), !!on);
    show($("addSlotBtn"), !on);
    if (!on) setSlotFields(2, "18:00", "21:00");
  }

  function parseTimingsToSlots(raw) {
    const s = String(raw || "");
    const re = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi;
    const found = [];
    let m;
    while ((m = re.exec(s)) && found.length < 4) {
      let h = parseInt(m[1], 10) % 12;
      if (/pm/i.test(m[3])) h += 12;
      const min = m[2] ? parseInt(m[2], 10) : 0;
      found.push(pad2(h) + ":" + pad2(min));
    }
    const slots = [];
    if (found.length >= 2) slots.push({ start: found[0], end: found[1] });
    if (found.length >= 4) slots.push({ start: found[2], end: found[3] });
    return slots;
  }

  function collectSlotsFromForm() {
    const slot1 = getSlotHm(1);
    const slots = [{ start: slot1.start, end: slot1.end }];
    if (isSlot2Visible()) {
      const slot2 = getSlotHm(2);
      slots.push({ start: slot2.start, end: slot2.end });
    }
    return slots;
  }

  function validateSlots(slots) {
    if (!slots.length || !slots[0].start || !slots[0].end) {
      return "Please set start and end time for slot 1.";
    }
    if (slots[0].end <= slots[0].start) {
      return "Slot 1 end time must be after the start time.";
    }
    if (slots[1]) {
      if (!slots[1].start || !slots[1].end) {
        return "Please set start and end time for slot 2, or remove it.";
      }
      if (slots[1].end <= slots[1].start) {
        return "Slot 2 end time must be after the start time.";
      }
    }
    return "";
  }

  function slotsToTimings(slots) {
    return slots
      .map(function (s) {
        return formatSlotLabel(s.start, s.end);
      })
      .filter(Boolean)
      .join("\n");
  }

  function applySlotsToItem(item, slots) {
    item.starttime = slots[0] ? slots[0].start : "";
    item.endtime = slots[0] ? slots[0].end : "";
    item.starttime2 = slots[1] ? slots[1].start : "";
    item.endtime2 = slots[1] ? slots[1].end : "";
    item.timings = slotsToTimings(slots);
    return item;
  }

  function loadSlotsIntoForm(item) {
    fillTimeSelects();
    let slots = [];
    if (item && item.slots && item.slots.length) {
      slots = item.slots;
    } else if (item) {
      if (item.starttime || item.endtime) {
        slots.push({ start: item.starttime || "", end: item.endtime || "" });
      }
      if (item.starttime2 || item.endtime2) {
        slots.push({ start: item.starttime2 || "", end: item.endtime2 || "" });
      }
      if (!slots.length && item.timings) slots = parseTimingsToSlots(item.timings);
    }
    if (!slots.length) slots = [{ start: "06:00", end: "09:00" }];
    setSlotFields(1, slots[0].start, slots[0].end);
    if (slots[1] && slots[1].start) {
      setSlot2Visible(true);
      setSlotFields(2, slots[1].start, slots[1].end);
    } else {
      setSlot2Visible(false);
    }
  }

  function parseToInputDate(raw) {
    const s = (raw || "").toString().trim();
    if (!s) return "";
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const d = new Date(s);
    if (!isNaN(d.getTime())) return toInputDate(d);
    return "";
  }

  function formatListingDay(ymd) {
    const s = (ymd || "").toString().trim();
    if (!s) return "";
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function listingDateLabel(item) {
    if (!item) return "";
    const start = parseToInputDate(item.startdate || item["start date"]);
    const end = parseToInputDate(item.enddate || item["end date"]);
    if (start && end && start !== end) {
      return formatListingDay(start) + " – " + formatListingDay(end);
    }
    if (end || start) return formatListingDay(end || start);
    const raw = (item.date || "").toString().trim();
    const parsed = parseToInputDate(raw);
    return parsed ? formatListingDay(parsed) : raw;
  }

  function listingMetaLine(item) {
    const bits = [];
    const date = listingDateLabel(item);
    if (date) bits.push(date);
    if (item.location) bits.push(item.location);
    const slotText =
      item.slots && item.slots.length
        ? item.slots
            .map(function (s) {
              return formatSlotLabel(s.start, s.end);
            })
            .filter(Boolean)
            .join(" · ")
        : item.timings
          ? String(item.timings).split("\n").join(" · ")
          : "";
    if (slotText) bits.push(slotText);
    return bits.join(" · ");
  }

  function applySannidhiTemplate() {
    const defaults = loadSannidhiDefaults();
    const monday = nextMonday(new Date());
    const dateLabel = formatMondayLabel(monday);
    const ymd = toInputDate(monday);
    $("fTitle").value = defaults.title;
    $("fDescription").value = defaults.description;
    $("fStartDate").value = ymd;
    $("fEndDate").value = ymd;
    $("fLocation").value = defaults.location || DEFAULT_LOCATION;
    $("fDuration").value = defaults.duration;
    fillTimeSelects();
    setSlot2Visible(false);
    setSlotFields(1, "18:00", "18:45");
    $("fRegister").value = defaults.registerlink;
    $("fImageUrl").value = defaults.image || "";
    $("fImageFile").value = "";
    pendingImage = null;
    setListingImagePreview(defaults.image);
    setFrequencySelect(defaults.frequency);
    $("fStatus").value = currentResource === "programs" ? "Open" : "active";
    setTemplateActive("");
    $("templateHint").textContent =
      "Dates set to the coming Monday (" +
      dateLabel +
      "). Slot set to 6:00 PM – 6:45 PM.";
  }

  function resourceLabel() {
    return currentResource === "programs" ? "program" : "opportunity";
  }

  function statusOf(item) {
    const raw = (item.status || item["program status"] || item["listing status"] || "").toString().trim();
    return raw || "—";
  }

  function isListingOpen(item) {
    const s = statusOf(item).toLowerCase();
    if (s === "closed" || s === "inactive") return false;
    return true;
  }

  function listingInitial(item) {
    const title = (item.title || "").toString().trim();
    const ch = title.charAt(0);
    return ch ? ch.toUpperCase() : "?";
  }

  function updateEventsOpenBadge() {
    const badge = $("adminOpenBadge");
    if (!badge) return;
    show(badge, false);
  }

  function renderRow(item) {
    const title = item.title || "(Untitled)";
    const open = isListingOpen(item);
    const meta = listingMetaLine(item);
    const clearSlot = "";
    return (
      '<article class="inquiry-card event-card' +
      (open ? "" : " is-resolved") +
      '" data-id="' +
      escapeHtml(item.id) +
      '">' +
      '<div class="inquiry-ticket-main event-ticket-main">' +
      '<span class="inquiry-avatar" aria-hidden="true">' +
      escapeHtml(listingInitial(item)) +
      "</span>" +
      '<span class="inquiry-ticket-copy">' +
      '<span class="inquiry-ticket-top">' +
      '<span class="inquiry-ticket-who"><strong>' +
      escapeHtml(title) +
      "</strong>" +
      (meta ? '<span class="inquiry-time">' + escapeHtml(meta) + "</span>" : "") +
      '</span><span class="inquiry-badge">' +
      escapeHtml(open ? "Open" : "Closed") +
      "</span></span></span></div>" +
      '<div class="inquiry-seam" aria-hidden="true"><span class="inquiry-notch l"></span><span class="inquiry-notch r"></span></div>' +
      '<div class="inquiry-quick-actions">' +
      '<button type="button" class="inquiry-action inquiry-action-wa" data-edit="' +
      escapeHtml(item.id) +
      '">Edit</button>' +
      '<button type="button" class="inquiry-action inquiry-action-resolve event-action-delete" data-delete="' +
      escapeHtml(item.id) +
      '">Delete</button>' +
      "</div>" +
      clearSlot +
      "</article>"
    );
  }

  function setListingFilter(key, skipRender) {
    listingFilter = key || "open";
    document.querySelectorAll("[data-listing-filter]").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-listing-filter") === listingFilter);
    });
    if (!skipRender) renderList();
  }

  function updateListingFilterLabels(openCount, closedCount) {
    document.querySelectorAll("[data-listing-filter]").forEach(function (btn) {
      const key = btn.getAttribute("data-listing-filter") || "open";
      const active = btn.classList.contains("active");
      let label = "Open";
      if (key === "all") label = "All";
      else if (key === "closed") label = "Closed";
      if (active) {
        const n = key === "all" ? openCount + closedCount : key === "closed" ? closedCount : openCount;
        label = label + " " + n;
      }
      btn.textContent = label;
    });
  }

  function renderList() {
    const host = $("itemList");
    const kind = currentResource === "programs" ? "programs" : "volunteering events";
    updateEventsOpenBadge();
    const openItems = items.filter(isListingOpen);
    const closedItems = items.filter(function (item) {
      return !isListingOpen(item);
    });
    updateListingFilterLabels(openItems.length, closedItems.length);
    if (!items.length) {
      host.innerHTML =
        '<div class="admin-empty">No ' + kind + " yet. Add one to publish it on the site.</div>";
      setStatus("");
      return;
    }
    let filtered = items;
    if (listingFilter === "open") filtered = openItems;
    else if (listingFilter === "closed") filtered = closedItems;

    const clearBar =
      listingFilter === "closed" && closedItems.length
        ? '<div class="event-clear-bar">' +
          '<span class="admin-clear-progress" data-clear-progress hidden></span>' +
          '<button type="button" class="btn btn-outline admin-clear-all" data-clear-closed>Clear all closed</button>' +
          "</div>"
        : "";

    if (!filtered.length) {
      host.innerHTML =
        clearBar + '<div class="admin-empty">None in this filter.</div>';
      setStatus("");
      return;
    }
    host.innerHTML = clearBar + filtered.map(renderRow).join("");
    setStatus("");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadList() {
    const cached = listingPrefetch[currentResource];
    delete listingPrefetch[currentResource];
    if (cached && Date.now() - cached.at < 60000) {
      items = cached.items;
      renderList();
      return;
    }
    setPageBusy(true);
    setStatus("");
    $("itemList").innerHTML =
      '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading events…</div>';
    try {
      const data = await apiGet(currentResource, true);
      if (data.error && /Unauthorized/i.test(data.error)) {
        logout();
        loginError(data.error);
        return;
      }
      if (data.error) throw new Error(data.error);
      items = data.items || [];
      renderList();
    } catch (err) {
      items = [];
      renderList();
      setStatus(err.message, true);
    } finally {
      setPageBusy(false);
    }
  }

  let inquiryGroups = [];
  let inquiryFilter = "open";
  let inquiryType = "";
  let inquiryShowLimit = 12;

  function setTab(resource) {
    if (resource === "inquiries") {
      openAdminPage("queries");
      return;
    }
    currentResource = resource;
    document.querySelectorAll("#eventsTabs [data-tab]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === resource);
    });
    show($("listingsPanel"), true);
    show($("inquiriesPanel"), false);
    $("addItemBtn").classList.remove("hidden");
    loadList();
  }

  function toggleProgramFields(on) {
    document.querySelectorAll("[data-program-only]").forEach(function (el) {
      el.style.display = on ? "" : "none";
    });
  }

  function setEditorMode(mode) {
    editorMode = mode === "bulk" ? "bulk" : "single";
    document.querySelectorAll("[data-editor-mode]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-editor-mode") === editorMode);
    });
    show($("singleEditorFields"), editorMode === "single");
    show($("bulkEditorFields"), editorMode === "bulk");
    const hint = $("bulkImageHint");
    if (hint) hint.hidden = editorMode !== "bulk";
    const saveBtn = $("saveItemBtn");
    if (saveBtn) {
      saveBtn.textContent = editorMode === "bulk" ? "Create events" : "Save";
      saveBtn.dataset.idleLabel = saveBtn.textContent;
    }
    if (editorMode === "single") {
      show($("listingTemplates"), !editingId && currentResource === "programs");
    } else {
      show($("listingTemplates"), false);
    }
  }

  function looksLikeDateField(raw) {
    const s = String(raw || "").trim();
    if (!s) return false;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
    if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/.test(s)) return true;
    if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/.test(s)) return true;
    return !!parseToInputDate(s);
  }

  function splitBulkLine(line) {
    const raw = String(line || "").trim();
    if (!raw) return [];
    if (raw.indexOf("|") >= 0) {
      return raw.split("|").map(function (p) {
        return p.trim();
      });
    }
    if (raw.indexOf("\t") >= 0) {
      return raw.split("\t").map(function (p) {
        return p.trim();
      });
    }
    const parts = raw.split(",").map(function (p) {
      return p.trim();
    });
    if (parts.length >= 3 && parts.slice(1, 3).some(looksLikeDateField)) return parts;
    return [raw];
  }

  function parseBulkLine(line, lineNo) {
    const parts = splitBulkLine(line);
    const row = {
      lineNo: lineNo,
      raw: line,
      title: "",
      startdate: "",
      enddate: "",
      timings: "",
      location: DEFAULT_LOCATION,
      duration: "",
      frequency: currentResource === "programs" ? "Scheduled" : "",
      registerlink: "",
      description: "",
      errors: [],
    };
    if (!parts.length || (parts.length === 1 && !parts[0])) {
      row.errors.push("Empty line");
      return row;
    }
    if (parts.length === 1) {
      row.title = parts[0];
      row.errors.push("Need at least Title and Start date");
      return row;
    }
    row.title = parts[0] || "";
    row.startdate = parseToInputDate(parts[1] || "");
    row.enddate = parseToInputDate(parts[2] || "") || row.startdate;
    row.timings = parts[3] || "";
    row.location = (parts[4] || "").trim() || DEFAULT_LOCATION;
    row.duration = parts[5] || "";
    if (parts[6]) row.frequency = parts[6];
    row.registerlink = parts[7] || "";
    row.description = parts.slice(8).join(" | ").trim();

    const parsedSlots = parseTimingsToSlots(row.timings);
    row.starttime = parsedSlots[0] ? parsedSlots[0].start : "";
    row.endtime = parsedSlots[0] ? parsedSlots[0].end : "";
    row.starttime2 = parsedSlots[1] ? parsedSlots[1].start : "";
    row.endtime2 = parsedSlots[1] ? parsedSlots[1].end : "";

    if (!row.title) row.errors.push("Missing title");
    if (!row.startdate) row.errors.push("Missing or invalid start date");
    if (row.startdate && row.enddate && row.enddate < row.startdate) {
      row.errors.push("End date before start date");
    }
    if (!row.starttime || !row.endtime) {
      row.errors.push("Missing or invalid slot times (e.g. 6:00 AM – 9:00 AM)");
    } else if (row.endtime <= row.starttime) {
      row.errors.push("Slot end must be after start");
    }
    if (currentResource === "programs" && !row.frequency) {
      row.frequency = "Scheduled";
    }
    return row;
  }

  function parseBulkPaste(text) {
    const lines = String(text || "").split(/\r?\n/);
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (/^title\s*[|,\t]/i.test(line) && /start/i.test(line)) continue;
      rows.push(parseBulkLine(line, i + 1));
    }
    return rows;
  }

  function renderBulkPreview() {
    const host = $("bulkPreview");
    if (!host) return;
    if (!bulkPreviewRows.length) {
      host.innerHTML = '<p class="admin-empty admin-empty-group">No rows to preview. Paste lines and click Preview.</p>';
      show(host, true);
      return;
    }
    const valid = bulkPreviewRows.filter(function (r) {
      return !r.errors.length;
    }).length;
    const head =
      '<div class="admin-bulk-preview-head">' +
      "<strong>" +
      valid +
      "</strong> of " +
      bulkPreviewRows.length +
      " ready to create" +
      "</div>";
    const cards = bulkPreviewRows
      .map(function (row, idx) {
        const bad = row.errors.length > 0;
        const meta = [row.startdate, row.enddate && row.enddate !== row.startdate ? "– " + row.enddate : "", row.timings, row.location]
          .filter(Boolean)
          .join(" · ");
        return (
          '<article class="admin-bulk-row' +
          (bad ? " is-invalid" : "") +
          '" data-bulk-idx="' +
          idx +
          '">' +
          '<div class="admin-bulk-row-main">' +
          "<h3>" +
          escapeHtml(row.title || "(Untitled)") +
          "</h3>" +
          (meta ? "<p>" + escapeHtml(meta) + "</p>" : "") +
          (bad
            ? '<p class="admin-bulk-row-err">' + escapeHtml(row.errors.join("; ")) + "</p>"
            : "") +
          '<div class="admin-bulk-row-edit">' +
          '<label>Title <input type="text" data-bulk-field="title" value="' +
          escapeHtml(row.title) +
          '"/></label>' +
          '<label>Start <input type="date" data-bulk-field="startdate" value="' +
          escapeHtml(row.startdate) +
          '"/></label>' +
          '<label>End <input type="date" data-bulk-field="enddate" value="' +
          escapeHtml(row.enddate) +
          '"/></label>' +
          '<label>Timings <input type="text" data-bulk-field="timings" value="' +
          escapeHtml(row.timings) +
          '"/></label>' +
          '<label>Location <input type="text" data-bulk-field="location" value="' +
          escapeHtml(row.location) +
          '"/></label>' +
          (currentResource === "programs"
            ? '<label>Frequency <input type="text" data-bulk-field="frequency" value="' +
              escapeHtml(row.frequency) +
              '"/></label>' +
              '<label>Register <input type="url" data-bulk-field="registerlink" value="' +
              escapeHtml(row.registerlink) +
              '"/></label>'
            : "") +
          '<label>Duration <input type="text" data-bulk-field="duration" value="' +
          escapeHtml(row.duration) +
          '"/></label>' +
          '<label class="admin-bulk-span">Description <input type="text" data-bulk-field="description" value="' +
          escapeHtml(row.description) +
          '"/></label>' +
          "</div></div>" +
          '<button type="button" class="btn btn-outline" data-bulk-remove="' +
          idx +
          '">Remove</button>' +
          "</article>"
        );
      })
      .join("");
    host.innerHTML = head + cards;
    show(host, true);
  }

  function validateBulkRow(row) {
    row.errors = [];
    row.startdate = parseToInputDate(row.startdate) || String(row.startdate || "").trim();
    row.enddate = parseToInputDate(row.enddate) || String(row.enddate || "").trim() || row.startdate;
    row.location = (row.location || "").trim() || DEFAULT_LOCATION;
    if (!(row.title || "").trim()) row.errors.push("Missing title");
    if (!row.startdate) row.errors.push("Missing or invalid start date");
    if (row.startdate && row.enddate && row.enddate < row.startdate) {
      row.errors.push("End date before start date");
    }
    if (!(row.starttime || "").trim() || !(row.endtime || "").trim()) {
      const parsed = parseTimingsToSlots(row.timings);
      if (parsed[0]) {
        row.starttime = parsed[0].start;
        row.endtime = parsed[0].end;
        if (parsed[1]) {
          row.starttime2 = parsed[1].start;
          row.endtime2 = parsed[1].end;
        }
      }
    }
    if (!(row.starttime || "").trim() || !(row.endtime || "").trim()) {
      row.errors.push("Missing or invalid slot times (e.g. 6:00 AM – 9:00 AM)");
    } else if (row.endtime <= row.starttime) {
      row.errors.push("Slot end must be after start");
    }
    row.timings = slotsToTimings(
      [
        { start: row.starttime, end: row.endtime },
        row.starttime2 && row.endtime2
          ? { start: row.starttime2, end: row.endtime2 }
          : null,
      ].filter(Boolean)
    );
    if (currentResource === "programs" && !(row.frequency || "").trim()) {
      row.frequency = "Scheduled";
    }
    return row;
  }

  function syncBulkPreviewFromDom() {
    const host = $("bulkPreview");
    if (!host) return;
    host.querySelectorAll("[data-bulk-idx]").forEach(function (card) {
      const idx = parseInt(card.getAttribute("data-bulk-idx"), 10);
      const row = bulkPreviewRows[idx];
      if (!row) return;
      card.querySelectorAll("[data-bulk-field]").forEach(function (input) {
        const field = input.getAttribute("data-bulk-field");
        row[field] = input.value;
      });
      validateBulkRow(row);
    });
  }

  function runBulkPreview() {
    $("editorError").style.display = "none";
    bulkPreviewRows = parseBulkPaste(($("fBulkPaste") && $("fBulkPaste").value) || "");
    if (!bulkPreviewRows.length) {
      $("editorError").textContent = "Paste at least one event line, then Preview.";
      $("editorError").style.display = "block";
      show($("bulkPreview"), false);
      return;
    }
    renderBulkPreview();
  }

  function openEditor(item) {
    editingId = item && item.id ? String(item.id) : "";
    pendingImage = null;
    bulkPreviewRows = [];
    $("editorTitle").textContent = editingId ? "Edit event" : "New event";
    const eyebrow = $("editorEyebrow");
    if (eyebrow) {
      eyebrow.textContent = currentResource === "programs" ? "Programs" : "Volunteering";
    }
    $("fTitle").value = (item && item.title) || "";
    $("fDescription").value = (item && item.description) || "";
    $("fStartDate").value = parseToInputDate(
      (item && (item.startdate || item["start date"])) || (item && item.date) || ""
    );
    $("fEndDate").value = parseToInputDate(
      (item && (item.enddate || item["end date"])) || (item && item.date) || ""
    );
    loadSlotsIntoForm(item);
    $("fLocation").value = (item && item.location) || DEFAULT_LOCATION;
    $("fDuration").value = (item && item.duration) || "";
    setFrequencySelect(item && item.frequency);
    $("fRegister").value = (item && (item.registerlink || item.registerLink)) || "";
    $("fImageUrl").value = (item && item.image) || "";
    $("fImageFile").value = "";
    setListingImagePreview((item && item.image) || "");
    if ($("fBulkPaste")) $("fBulkPaste").value = "";
    show($("bulkPreview"), false);

    toggleProgramFields(currentResource === "programs");
    const status = ((item && item.status) || "").toString();
    if (currentResource === "programs") {
      $("fStatus").innerHTML = '<option value="Open">Open</option><option value="Closed">Closed</option>';
      $("fStatus").value = /^closed$/i.test(status) ? "Closed" : "Open";
    } else {
      $("fStatus").innerHTML = '<option value="active">Active</option><option value="inactive">Inactive</option>';
      $("fStatus").value = /^inactive$/i.test(status) ? "inactive" : "active";
    }
    $("editorError").style.display = "none";
    const isNew = !editingId;
    show($("editorModeTabs"), isNew);
    setEditorMode("single");
    setTemplateActive("");
    $("templateHint").textContent =
      isNew && currentResource === "programs"
        ? "Choose Sannidhi Pooja to fill next Monday and the usual timings."
        : "";
    $("editorOverlay").classList.add("open");
    const body = $("editorBody");
    if (body) body.scrollTop = 0;
  }

  function setFrequencySelect(raw) {
    const select = $("fFrequency");
    if (!select) return;
    const value = (raw || "").toString().trim();
    select.innerHTML =
      '<option value="">Select frequency</option>' +
      FREQUENCY_OPTIONS.map(function (opt) {
        return '<option value="' + opt + '">' + opt + "</option>";
      }).join("");
    if (!value) {
      select.value = "";
      return;
    }
    const match = FREQUENCY_OPTIONS.find(function (opt) {
      return opt.toLowerCase() === value.toLowerCase();
    });
    if (match) {
      select.value = match;
      return;
    }
    const extra = document.createElement("option");
    extra.value = value;
    extra.textContent = value;
    select.appendChild(extra);
    select.value = value;
  }

  function closeEditor() {
    $("editorOverlay").classList.remove("open");
  }

  function readFileAsImagePayload(file) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = function () {
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        resolve({
          mimeType: "image/jpeg",
          filename: (file.name || "upload").replace(/\.[^.]+$/, "") + ".jpg",
          base64: dataUrl.split(",")[1],
          preview: dataUrl,
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that image."));
      };
      img.src = url;
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

  async function createBulkEvents() {
    if (!bulkPreviewRows.length) {
      bulkPreviewRows = parseBulkPaste(($("fBulkPaste") && $("fBulkPaste").value) || "");
      if (bulkPreviewRows.length) renderBulkPreview();
    } else {
      syncBulkPreviewFromDom();
      bulkPreviewRows.forEach(validateBulkRow);
      renderBulkPreview();
    }
    const ready = bulkPreviewRows.filter(function (r) {
      return !r.errors.length;
    });
    if (!ready.length) {
      $("editorError").textContent =
        bulkPreviewRows.length
          ? "Fix the highlighted rows (or remove them) before creating."
          : "Paste events and click Preview first.";
      $("editorError").style.display = "block";
      return;
    }
    const status = $("fStatus").value.trim();
    const imageUrl = $("fImageUrl").value.trim();
    if (!status) {
      $("editorError").textContent = "Please fill in: status.";
      $("editorError").style.display = "block";
      return;
    }
    if (!imageUrl && !pendingImage) {
      $("editorError").textContent = "Please fill in: image.";
      $("editorError").style.display = "block";
      return;
    }
    const btn = $("saveItemBtn");
    const cancel = $("cancelEditorBtn");
    const previewBtn = $("bulkPreviewBtn");
    btn.disabled = true;
    btn.classList.add("is-busy");
    cancel.disabled = true;
    if (previewBtn) previewBtn.disabled = true;
    const overlay = $("editorOverlay");
    if (overlay) overlay.classList.add("is-saving");
    try {
      let savedImage = imageUrl;
      if (pendingImage) {
        btn.textContent = "Uploading photo…";
        savedImage = await uploadPayload(pendingImage);
      }
      let created = 0;
      for (let i = 0; i < ready.length; i++) {
        const row = ready[i];
        btn.textContent = "Creating " + (i + 1) + " of " + ready.length + "…";
        const item = {
          title: row.title.trim(),
          description: (row.description || "").trim(),
          startdate: row.startdate,
          enddate: row.enddate || row.startdate,
          date:
            row.startdate === row.enddate || !row.enddate
              ? row.startdate
              : row.startdate + " – " + row.enddate,
          location: (row.location || "").trim() || DEFAULT_LOCATION,
          duration: (row.duration || "").trim(),
          image: savedImage,
          status: status,
        };
        const bulkSlots = [{ start: row.starttime, end: row.endtime }];
        if (row.starttime2 && row.endtime2) {
          bulkSlots.push({ start: row.starttime2, end: row.endtime2 });
        }
        applySlotsToItem(item, bulkSlots);
        if (currentResource === "programs") {
          item.frequency = (row.frequency || "Scheduled").trim() || "Scheduled";
          item.registerlink = (row.registerlink || "").trim();
        }
        const data = await apiPost({
          formType: "adminSaveItem",
          token: token(),
          resource: currentResource,
          id: "",
          item: item,
        });
        if (data.error) throw new Error(data.error);
        created += 1;
      }
      closeEditor();
      await loadList();
      setStatus(created === 1 ? "1 event created." : created + " events created.");
    } catch (err) {
      if (/Unauthorized/i.test(err.message || "")) {
        closeEditor();
        logout();
        loginError(err.message);
        return;
      }
      $("editorError").textContent = friendlyError(err.message);
      $("editorError").style.display = "block";
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-busy");
      btn.textContent = editorMode === "bulk" ? "Create events" : "Save";
      cancel.disabled = false;
      if (previewBtn) previewBtn.disabled = false;
      if (overlay) overlay.classList.remove("is-saving");
    }
  }

  async function saveEditor() {
    if (editorMode === "bulk" && !editingId) {
      await createBulkEvents();
      return;
    }
    const btn = $("saveItemBtn");
    const title = $("fTitle").value.trim();
    const startDate = $("fStartDate").value.trim();
    const endDate = $("fEndDate").value.trim();
    const location = $("fLocation").value.trim() || DEFAULT_LOCATION;
    const slots = collectSlotsFromForm();
    const slotErr = validateSlots(slots);
    const status = $("fStatus").value.trim();
    const imageUrl = $("fImageUrl").value.trim();
    const frequency = $("fFrequency").value.trim();
    const registerlink = $("fRegister").value.trim();
    const missing = [];
    if (!title) missing.push("title");
    if (!startDate) missing.push("start date");
    if (!endDate) missing.push("end date");
    else if (startDate && endDate && endDate < startDate) {
      $("editorError").textContent = "End date must be on or after the start date.";
      $("editorError").style.display = "block";
      return;
    }
    if (slotErr) {
      $("editorError").textContent = slotErr;
      $("editorError").style.display = "block";
      return;
    }
    if (!location) missing.push("location");
    if (!status) missing.push("status");
    if (!imageUrl && !pendingImage) missing.push("image");
    if (currentResource === "programs") {
      if (!frequency) missing.push("frequency");
      if (!registerlink && !/^sannidhi pooja$/i.test(title)) missing.push("register link");
    }
    if (missing.length) {
      $("editorError").textContent =
        "Please fill in: " + missing.join(", ") + ".";
      $("editorError").style.display = "block";
      return;
    }
    const cancel = $("cancelEditorBtn");
    btn.disabled = true;
    btn.classList.add("is-busy");
    cancel.disabled = true;
    const overlay = $("editorOverlay");
    if (overlay) overlay.classList.add("is-saving");
    try {
      let savedImage = imageUrl;
      if (pendingImage) {
        btn.textContent = "Uploading photo…";
        savedImage = await uploadPayload(pendingImage);
      }
      btn.textContent = "Saving…";
      const item = {
        title: title,
        description: $("fDescription").value.trim(),
        startdate: startDate,
        enddate: endDate,
        date: startDate === endDate ? startDate : startDate + " – " + endDate,
        location: location,
        duration: $("fDuration").value.trim(),
        image: savedImage,
        status: status,
      };
      applySlotsToItem(item, slots);
      if (currentResource === "programs") {
        item.frequency = frequency;
        item.registerlink = registerlink;
      }
      const data = await apiPost({
        formType: "adminSaveItem",
        token: token(),
        resource: currentResource,
        id: editingId,
        item: item,
      });
      if (data.error) throw new Error(data.error);
      rememberSannidhiDefaults(item);
      closeEditor();
      await loadList();
      setStatus("Saved.");
    } catch (err) {
      if (/Unauthorized/i.test(err.message || "")) {
        closeEditor();
        logout();
        loginError(err.message);
        return;
      }
      $("editorError").textContent = friendlyError(err.message);
      $("editorError").style.display = "block";
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-busy");
      btn.textContent = "Save";
      cancel.disabled = false;
      if (overlay) overlay.classList.remove("is-saving");
    }
  }

  function setClearLoading(on, current, total) {
    const btn = document.querySelector("[data-clear-closed]");
    const progress = document.querySelector("[data-clear-progress]");
    const wrap = btn && btn.closest(".admin-clear-wrap");
    if (wrap) wrap.classList.toggle("is-loading", !!on);
    if (btn) {
      btn.disabled = !!on;
      btn.textContent = on ? "Clearing…" : "Clear all";
    }
    if (progress) {
      progress.hidden = !on;
      if (on && current && total) {
        progress.textContent = "Clearing " + current + " of " + total;
      } else if (on) {
        progress.textContent = "Clearing…";
      } else {
        progress.textContent = "";
      }
    }
  }

  async function clearClosedListings() {
    const closed = items.filter(function (item) {
      return !isListingOpen(item);
    });
    if (!closed.length) return;
    const names = closed
      .map(function (item) {
        return item.title || "(Untitled)";
      })
      .slice(0, 12);
    const extra = closed.length > names.length ? "\n…" : "";
    if (
      !confirm(
        "Delete " +
          closed.length +
          " closed event" +
          (closed.length === 1 ? "" : "s") +
          " only?\n\n" +
          names.join("\n") +
          extra +
          "\n\nOpen events will not be removed."
      )
    ) {
      return;
    }
    setClearLoading(true, 0, closed.length);
    setPageBusy(true, "Clearing closed events…");
    try {
      const data = await apiPost({
        formType: "adminClearClosed",
        token: token(),
        resource: currentResource,
      });
      if (data.error) throw new Error(data.error);
      await loadList();
      setStatus(
        data.deleted === 1 ? "1 closed event cleared." : (data.deleted || 0) + " closed events cleared."
      );
    } catch (err) {
      setClearLoading(false);
      await loadList();
      setStatus(err.message, true);
    }
  }

  let pendingDeleteId = null;

  function openDeleteConfirm(id) {
    pendingDeleteId = id;
    const item = items.find(function (row) {
      return String(row.id) === String(id);
    });
    const title = (item && item.title) || "this event";
    const lead = $("deleteConfirmLead");
    if (lead) {
      lead.textContent = "Delete “" + title + "”? This cannot be undone.";
    }
    const overlay = $("deleteOverlay");
    if (overlay) overlay.classList.add("open");
  }

  function closeDeleteConfirm() {
    pendingDeleteId = null;
    const overlay = $("deleteOverlay");
    if (overlay) overlay.classList.remove("open");
  }

  async function deleteItem(id) {
    closeDeleteConfirm();
    const rowBtn = document.querySelector('[data-delete="' + CSS.escape(String(id)) + '"]');
    const row = rowBtn && (rowBtn.closest(".event-card") || rowBtn.closest(".admin-row"));
    if (row) row.classList.add("is-busy");
    if (rowBtn) {
      rowBtn.disabled = true;
      rowBtn.classList.add("is-busy");
      rowBtn.textContent = "Deleting…";
    }
    setPageBusy(true, "Deleting event…");
    try {
      const data = await apiPost({
        formType: "adminDeleteItem",
        token: token(),
        resource: currentResource,
        id: id,
      });
      if (data.error) throw new Error(data.error);
      await loadList();
      setStatus("Deleted.");
    } catch (err) {
      if (row) row.classList.remove("is-busy");
      if (rowBtn) {
        rowBtn.disabled = false;
        rowBtn.classList.remove("is-busy");
        rowBtn.textContent = "Delete";
      }
      setPageBusy(false);
      setStatus(err.message, true);
    }
  }

  function inquiryField(item, key) {
    return (item[key] || "").toString().trim();
  }

  function formatInquiryTime(raw) {
    const s = (raw || "").toString().trim();
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  function isInquiryResolved(item) {
    return /^resolved$/i.test(inquiryField(item, "status"));
  }

  function inquiryMatchesFilter(item) {
    if (inquiryFilter === "resolved") return isInquiryResolved(item);
    if (inquiryFilter === "open") return !isInquiryResolved(item);
    return true;
  }

  function openCountForGroup(group) {
    if (!group) return 0;
    if (group.loaded && group.items) {
      return group.items.filter(function (it) {
        return !isInquiryResolved(it);
      }).length;
    }
    if (typeof group.openCount === "number") return group.openCount;
    return (group.items || []).filter(function (it) {
      return !isInquiryResolved(it);
    }).length;
  }

  function refreshGroupOpenCount(group) {
    if (!group) return;
    group.openCount = (group.items || []).filter(function (it) {
      return !isInquiryResolved(it);
    }).length;
    group.total = (group.items || []).length;
  }

  function totalOpenInquiries() {
    return inquiryGroups.reduce(function (n, g) {
      return n + openCountForGroup(g);
    }, 0);
  }

  function currentInquiryGroup() {
    for (let i = 0; i < inquiryGroups.length; i++) {
      if (inquiryGroups[i].key === inquiryType) return inquiryGroups[i];
    }
    return null;
  }

  function ensureInquiryType() {
    if (inquiryType && inquiryGroups.some(function (g) {
      return g.key === inquiryType;
    })) {
      return;
    }
    const withOpen = inquiryGroups.find(function (g) {
      return openCountForGroup(g) > 0;
    });
    inquiryType = (withOpen || inquiryGroups[0] || {}).key || "";
  }

  function inquiryPreview(item) {
    return (
      inquiryField(item, "query") ||
      inquiryField(item, "program name") ||
      inquiryField(item, "opportunity name") ||
      inquiryField(item, "search keyword") ||
      inquiryField(item, "area") ||
      ""
    );
  }

  function inquiryInitial(item) {
    const name = inquiryField(item, "name");
    const ch = name.charAt(0);
    return ch ? ch.toUpperCase() : "?";
  }

  function inquiryWhatsAppDigits(item) {
    const digits = inquiryField(item, "whatsapp").replace(/\D/g, "");
    if (!digits) return "";
    return digits.slice(-10);
  }

  function inquiryShareMessage(item, groupTitle) {
    const lines = ["*New query – Isha Place, Vijayanagar*"];
    if (groupTitle) lines.push("Type: " + groupTitle);
    function add(label, value) {
      if (!value) return;
      lines.push(label + ": " + value);
    }
    add("Name", inquiryField(item, "name"));
    const phone = inquiryWhatsAppDigits(item);
    add("WhatsApp", phone ? "+91 " + phone : inquiryField(item, "whatsapp"));
    add("Area", inquiryField(item, "area"));
    add("Query", inquiryField(item, "query"));
    add("Program", inquiryField(item, "program name"));
    add("Search", inquiryField(item, "search keyword"));
    add("Opportunity", inquiryField(item, "opportunity name"));
    add("Received", formatInquiryTime(inquiryField(item, "timestamp")));
    add("Remarks", inquiryField(item, "remarks"));
    return lines.join("\n");
  }

  function inquiryWhatsAppUrl(item, groupTitle) {
    const text = inquiryShareMessage(item, groupTitle);
    return "https://wa.me/?text=" + encodeURIComponent(text);
  }

  function inquiryDetailRows(item) {
    const rows = [];
    function add(label, value) {
      if (!value) return;
      rows.push("<p><strong>" + escapeHtml(label) + ":</strong> " + escapeHtml(value) + "</p>");
    }
    add("WhatsApp", inquiryField(item, "whatsapp"));
    add("Area", inquiryField(item, "area"));
    add("Query", inquiryField(item, "query"));
    add("Program", inquiryField(item, "program name"));
    add("Search", inquiryField(item, "search keyword"));
    add("Opportunity", inquiryField(item, "opportunity name"));
    add("Received", formatInquiryTime(inquiryField(item, "timestamp")));
    return rows.join("");
  }

  function shortTypeLabel(title) {
    const t = (title || "").toString();
    if (/^home/i.test(t)) return "Home";
    if (/program interest/i.test(t)) return "Program interest";
    if (/program volunteer/i.test(t)) return "Program vol.";
    if (/volunteering/i.test(t)) return "Volunteering";
    return t;
  }

  function updateOpenBadge() {
    const badge = $("adminOpenBadge");
    if (!badge) return;
    const open = totalOpenInquiries();
    if (!open) {
      show(badge, false);
      return;
    }
    badge.textContent = open + " open";
    show(badge, true);
  }

  function renderInquiryTypeTabs() {
    const host = $("inquiryTypeTabs");
    if (!host) return;
    if (!inquiryGroups.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = inquiryGroups
      .map(function (group) {
        const open = openCountForGroup(group);
        const active = group.key === inquiryType;
        return (
          '<button type="button" class="inquiry-type-pill' +
          (active ? " active" : "") +
          (open && !active ? " has-open" : "") +
          '" role="tab" aria-selected="' +
          (active ? "true" : "false") +
          '" data-inquiry-type="' +
          escapeHtml(group.key) +
          '">' +
          escapeHtml(shortTypeLabel(group.title)) +
          "</button>"
        );
      })
      .join("");
  }

  function setInquiryStatusLine() {
    updateOpenBadge();
    setStatus("");
  }

  function waIconSvg() {
    return (
      '<svg class="inquiry-wa-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M17.47 14.38c-.28-.14-1.64-.81-1.9-.9-.25-.1-.44-.14-.62.14-.18.28-.71.9-.87 1.08-.16.18-.32.2-.6.07-.28-.14-1.17-.43-2.23-1.37-.82-.73-1.38-1.64-1.54-1.92-.16-.28-.02-.43.12-.57.13-.13.28-.32.42-.48.14-.16.18-.28.28-.46.1-.18.05-.34-.02-.48-.07-.14-.62-1.49-.85-2.04-.22-.53-.45-.46-.62-.46h-.53c-.18 0-.48.07-.73.34-.25.28-.96.94-.96 2.3s.98 2.67 1.12 2.85c.14.18 1.93 2.95 4.67 4.14.65.28 1.16.45 1.56.57.65.21 1.25.18 1.72.11.52-.08 1.64-.67 1.87-1.32.23-.65.23-1.2.16-1.32-.07-.11-.25-.18-.53-.32z"/>' +
      '<path d="M12.04 2C6.58 2 2.15 6.41 2.15 11.85c0 1.74.46 3.44 1.33 4.94L2 22l5.35-1.4c1.45.79 3.08 1.21 4.69 1.21h.01c5.46 0 9.89-4.41 9.89-9.85C21.94 6.41 17.5 2 12.04 2zm0 17.93h-.01c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.17.83.85-3.09-.2-.32a8.1 8.1 0 0 1-1.24-4.33c0-4.49 3.67-8.14 8.18-8.14 4.49 0 8.15 3.65 8.15 8.14 0 4.49-3.66 8.14-8.16 8.14z"/>' +
      "</svg>"
    );
  }

  function topicIconSvg() {
    return (
      '<svg class="inquiry-topic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
      '<polyline points="14 2 14 8 20 8"/>' +
      "</svg>"
    );
  }

  function renderInquiryCard(group, item) {
    const resolved = isInquiryResolved(item);
    const title = inquiryField(item, "name") || "(No name)";
    const preview = inquiryPreview(item);
    const remarks = inquiryField(item, "remarks");
    const waUrl = inquiryWhatsAppUrl(item, group.title);
    const waBtn =
      '<a class="inquiry-action inquiry-action-wa" href="' +
      escapeHtml(waUrl) +
      '" target="_blank" rel="noopener noreferrer">' +
      waIconSvg() +
      "WhatsApp</a>";
    const actions = resolved
      ? ""
      : '<div class="inquiry-seam" aria-hidden="true"><span class="inquiry-notch l"></span><span class="inquiry-notch r"></span></div>' +
        '<div class="inquiry-quick-actions">' +
        waBtn +
        '<button type="button" class="inquiry-action inquiry-action-resolve" data-inquiry-status="Resolved">Resolved</button>' +
        "</div>";
    return (
      '<article class="inquiry-card' +
      (resolved ? " is-resolved" : "") +
      '" data-sheet="' +
      escapeHtml(group.key) +
      '" data-id="' +
      escapeHtml(item.id) +
      '">' +
      '<button type="button" class="inquiry-ticket-main" data-inquiry-toggle aria-expanded="false">' +
      '<span class="inquiry-avatar" aria-hidden="true">' +
      escapeHtml(inquiryInitial(item)) +
      "</span>" +
      '<span class="inquiry-ticket-copy">' +
      '<span class="inquiry-ticket-top">' +
      '<span class="inquiry-ticket-who"><strong>' +
      escapeHtml(title) +
      '</strong><span class="inquiry-time">' +
      escapeHtml(formatInquiryTime(inquiryField(item, "timestamp"))) +
      "</span></span>" +
      '<span class="inquiry-badge">' +
      (resolved ? "Resolved" : "Open") +
      "</span></span>" +
      (preview
        ? '<span class="inquiry-topic">' + topicIconSvg() + "<span>" + escapeHtml(preview) + "</span></span>"
        : "") +
      (remarks
        ? '<span class="inquiry-remarks-preview">' + escapeHtml(remarks) + "</span>"
        : "") +
      "</span></button>" +
      actions +
      '<div class="inquiry-body" hidden>' +
      inquiryDetailRows(item) +
      (resolved
        ? '<button type="button" class="btn btn-outline" data-inquiry-status="Open">Reopen</button>'
        : "") +
      '<div class="form-group"><label>Admin remarks</label>' +
      '<textarea data-inquiry-remarks rows="3" placeholder="Notes for follow-up…">' +
      escapeHtml(inquiryField(item, "remarks")) +
      "</textarea></div>" +
      '<button type="button" class="btn btn-outline" data-inquiry-save>Save remarks</button>' +
      "</div></article>"
    );
  }

  function renderInquiries() {
    const host = $("inquiryList");
    if (!host) return;
    ensureInquiryType();
    renderInquiryTypeTabs();
    if (!inquiryGroups.length) {
      host.innerHTML = '<div class="admin-empty">No queries yet.</div>';
      setInquiryStatusLine();
      return;
    }
    const group = currentInquiryGroup();
    if (!group) {
      host.innerHTML = '<div class="admin-empty">No queries yet.</div>';
      setInquiryStatusLine();
      return;
    }
    const items = (group.items || []).filter(inquiryMatchesFilter);
    if (!items.length) {
      host.innerHTML = '<div class="admin-empty">None in this filter.</div>';
      setInquiryStatusLine();
      return;
    }
    const visible = items.slice(0, inquiryShowLimit);
    const remaining = items.length - visible.length;
    host.innerHTML =
      visible
        .map(function (item) {
          return renderInquiryCard(group, item);
        })
        .join("") +
      (remaining > 0
        ? '<button type="button" class="inquiry-more" data-inquiry-more>' +
          remaining +
          " more quer" +
          (remaining === 1 ? "y" : "ies") +
          "</button>"
        : "");
    setInquiryStatusLine();
  }

  async function loadInquiryGroup(key, force) {
    if (!key) return;
    let group = null;
    for (let i = 0; i < inquiryGroups.length; i++) {
      if (inquiryGroups[i].key === key) {
        group = inquiryGroups[i];
        break;
      }
    }
    if (group && group.loaded && !force) return;
    const data = await apiGet("inquiries", true, { group: key });
    if (data.error) throw new Error(data.error);
    const loaded = data.group;
    if (!loaded) throw new Error("Could not load queries.");
    if (group) {
      group.items = loaded.items || [];
      group.openCount = loaded.openCount;
      group.total = loaded.total;
      group.loaded = true;
      group.title = loaded.title || group.title;
    } else {
      loaded.loaded = true;
      inquiryGroups.push(loaded);
    }
  }

  async function loadInquiries() {
    setPageBusy(true);
    setStatus("");
    $("inquiryList").innerHTML =
      '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading queries…</div>';
    try {
      const meta = await apiGet("inquiries", true);
      if (meta.error && /Unauthorized/i.test(meta.error)) {
        logout();
        loginError(meta.error);
        return;
      }
      if (meta.error) throw new Error(meta.error);
      inquiryGroups = (meta.groups || []).map(function (g) {
        return {
          key: g.key,
          title: g.title,
          openCount: g.openCount || 0,
          total: g.total || 0,
          items: g.items || [],
          loaded: !!g.loaded,
        };
      });
      ensureInquiryType();
      renderInquiryTypeTabs();
      await loadInquiryGroup(inquiryType, true);
      renderInquiries();
    } catch (err) {
      inquiryGroups = [];
      renderInquiries();
      setStatus(err.message, true);
    } finally {
      setPageBusy(false);
    }
  }

  function findInquiry(sheet, id) {
    for (let g = 0; g < inquiryGroups.length; g++) {
      if (inquiryGroups[g].key !== sheet) continue;
      const items = inquiryGroups[g].items || [];
      for (let i = 0; i < items.length; i++) {
        if (String(items[i].id) === String(id)) return items[i];
      }
    }
    return null;
  }

  async function saveInquiryCard(card, statusOverride, busyEl) {
    const sheet = card.getAttribute("data-sheet");
    const id = card.getAttribute("data-id");
    const item = findInquiry(sheet, id);
    if (!item) return;
    const remarksEl = card.querySelector("[data-inquiry-remarks]");
    const remarks = remarksEl ? remarksEl.value.trim() : inquiryField(item, "remarks");
    const status = statusOverride || inquiryField(item, "status") || "Open";
    const btn =
      busyEl ||
      card.querySelector("[data-inquiry-save]") ||
      card.querySelector("[data-inquiry-status]");
    setButtonBusy(btn, true, "Saving…");
    try {
      const data = await apiPost({
        formType: "adminUpdateInquiry",
        token: token(),
        sheet: sheet,
        id: id,
        status: status,
        remarks: remarks,
      });
      if (data.error) throw new Error(data.error);
      item.status = data.status || status;
      item.remarks = remarks;
      const group = inquiryGroups.find(function (g) {
        return g.key === sheet;
      });
      refreshGroupOpenCount(group);
      renderInquiries();
    } catch (err) {
      setStatus(err.message, true);
      setButtonBusy(btn, false);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("loginBtn").addEventListener("click", handleLogin);
    $("adminPassword").addEventListener("keydown", function (e) {
      if (e.key === "Enter") handleLogin();
    });
    $("logoutBtn").addEventListener("click", openLogoutConfirm);
    $("cancelLogoutBtn").addEventListener("click", closeLogoutConfirm);
    $("confirmLogoutBtn").addEventListener("click", logout);
    $("logoutOverlay").addEventListener("click", function (e) {
      if (e.target === this) closeLogoutConfirm();
    });
    $("cancelDeleteBtn").addEventListener("click", closeDeleteConfirm);
    $("confirmDeleteBtn").addEventListener("click", function () {
      if (pendingDeleteId != null) deleteItem(pendingDeleteId);
    });
    $("deleteOverlay").addEventListener("click", function (e) {
      if (e.target === this) closeDeleteConfirm();
    });
    $("togglePassword").addEventListener("click", function () {
      const input = $("adminPassword");
      const btn = $("togglePassword");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", show ? "true" : "false");
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      btn.classList.toggle("is-visible", show);
    });
    $("addItemBtn").addEventListener("click", function () {
      openEditor(null);
    });
    fillTimeSelects();
    $("addSlotBtn").addEventListener("click", function () {
      setSlot2Visible(true);
      setSlotFields(2, "18:00", "21:00");
    });
    $("removeSlotBtn").addEventListener("click", function () {
      setSlot2Visible(false);
    });
    $("listingTemplates").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-template]");
      if (!btn) return;
      if (btn.getAttribute("data-template") === "sannidhi") {
        if (btn.classList.contains("active")) {
          setTemplateActive("");
          $("templateHint").textContent = "";
          return;
        }
        applySannidhiTemplate();
      }
    });
    $("editorModeTabs").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-editor-mode]");
      if (!btn || editingId) return;
      setEditorMode(btn.getAttribute("data-editor-mode"));
    });
    $("bulkPreviewBtn").addEventListener("click", runBulkPreview);
    $("bulkPreview").addEventListener("click", function (e) {
      const removeBtn = e.target.closest("[data-bulk-remove]");
      if (!removeBtn) return;
      const idx = parseInt(removeBtn.getAttribute("data-bulk-remove"), 10);
      syncBulkPreviewFromDom();
      if (!isNaN(idx)) bulkPreviewRows.splice(idx, 1);
      renderBulkPreview();
    });
    $("cancelEditorBtn").addEventListener("click", closeEditor);
    $("closeEditorBtn").addEventListener("click", closeEditor);
    $("saveItemBtn").addEventListener("click", saveEditor);
    $("editorOverlay").addEventListener("click", function (e) {
      if (e.target === this) closeEditor();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const overlay = $("editorOverlay");
      if (overlay && overlay.classList.contains("open") && !overlay.classList.contains("is-saving")) {
        closeEditor();
      }
    });

    document.querySelectorAll("[data-admin-page]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const resource = btn.getAttribute("data-hub-resource");
        if (resource) {
          currentResource = resource;
          setListingFilter("open", true);
        }
        openAdminPage(btn.getAttribute("data-admin-page"));
      });
    });

    document.querySelectorAll("[data-hub-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const action = btn.getAttribute("data-hub-action");
        currentResource = action === "add-volunteering" ? "volunteering" : "programs";
        openAdminPage("events");
        openEditor(null);
      });
    });
    $("backToHubBtn").addEventListener("click", function () {
      showAdminHub(false);
    });
    window.addEventListener("popstate", function () {
      if (!token()) return;
      const hash = (location.hash || "").replace(/^#/, "").toLowerCase();
      if (hash === "events" || hash === "queries") openAdminPage(hash, true);
      else showAdminHub(true);
    });

    document.querySelectorAll("#eventsTabs [data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTab(btn.getAttribute("data-tab"));
      });
    });

    document.querySelectorAll("[data-listing-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setListingFilter(btn.getAttribute("data-listing-filter"));
      });
    });

    $("itemList").addEventListener("click", function (e) {
      const clearClosed = e.target.closest("[data-clear-closed]");
      if (clearClosed) {
        clearClosedListings();
        return;
      }
      const edit = e.target.closest("[data-edit]");
      const del = e.target.closest("[data-delete]");
      if (edit) {
        const id = edit.getAttribute("data-edit");
        const item = items.find(function (it) {
          return String(it.id) === String(id);
        });
        openEditor(item || { id: id });
      }
      if (del) openDeleteConfirm(del.getAttribute("data-delete"));
    });

    $("fImageFile").addEventListener("change", async function () {
      const file = this.files && this.files[0];
      if (!file) return;
      const preview = $("fImagePreview");
      if (preview) {
        preview.style.display = "block";
        preview.classList.add("is-busy");
      }
      try {
        pendingImage = await readFileAsImagePayload(file);
        $("fImagePreview").src = pendingImage.preview;
        $("fImagePreview").style.display = "block";
      } catch (err) {
        $("editorError").textContent = err.message;
        $("editorError").style.display = "block";
      } finally {
        if (preview) preview.classList.remove("is-busy");
      }
    });

    document.querySelectorAll("[data-inquiry-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        inquiryFilter = btn.getAttribute("data-inquiry-filter") || "open";
        inquiryShowLimit = 12;
        document.querySelectorAll("[data-inquiry-filter]").forEach(function (el) {
          el.classList.toggle("active", el === btn);
        });
        renderInquiries();
      });
    });

    $("inquiryTypeTabs").addEventListener("click", function (e) {
      const typeBtn = e.target.closest("[data-inquiry-type]");
      if (!typeBtn) return;
      const nextType = typeBtn.getAttribute("data-inquiry-type") || "";
      if (!nextType || nextType === inquiryType) return;
      inquiryType = nextType;
      inquiryShowLimit = 12;
      const group = currentInquiryGroup();
      if (group && group.loaded) {
        renderInquiries();
        return;
      }
      $("inquiryList").innerHTML =
        '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading…</div>';
      renderInquiryTypeTabs();
      loadInquiryGroup(inquiryType, false)
        .then(function () {
          renderInquiries();
        })
        .catch(function (err) {
          setStatus(err.message, true);
          renderInquiries();
        });
    });

    $("inquiryList").addEventListener("click", function (e) {
      if (e.target.closest(".inquiry-action-wa, .inquiry-quick-actions a")) return;
      const moreBtn = e.target.closest("[data-inquiry-more]");
      if (moreBtn) {
        inquiryShowLimit += 12;
        renderInquiries();
        return;
      }
      const itemToggle = e.target.closest("[data-inquiry-toggle]");
      if (itemToggle) {
        const card = itemToggle.closest(".inquiry-card");
        const body = card && card.querySelector(".inquiry-body");
        if (!body) return;
        const open = body.hasAttribute("hidden");
        body.hidden = !open;
        card.classList.toggle("is-open", open);
        itemToggle.setAttribute("aria-expanded", open ? "true" : "false");
        return;
      }
      const statusBtn = e.target.closest("[data-inquiry-status]");
      if (statusBtn) {
        const card = statusBtn.closest(".inquiry-card");
        if (card) saveInquiryCard(card, statusBtn.getAttribute("data-inquiry-status"), statusBtn);
        return;
      }
      const saveBtn = e.target.closest("[data-inquiry-save]");
      if (saveBtn) {
        const card = saveBtn.closest(".inquiry-card");
        if (card) saveInquiryCard(card, null, saveBtn);
      }
    });

    if (token()) enterApp();
    else if (window.endPageLoad) endPageLoad();
  });
})();

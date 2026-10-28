(function () {
  const TOKEN_KEY = "vjn_admin_token";
  const USER_KEY = "vjn_admin_user";
  const INQUIRY_STAMP_KEY = "vjn_inquiry_stamp";
  const PROMO_DUE_KEY = "vjn_promo_due_stamp";
  const QUERY_NOTIFY_KEY = "vjn_query_notify";
  const QUERY_WATCH_MS = 45000;
  const ROLE_PAGES = {
    admin: ["events", "volunteering", "promotions", "messaging", "queries", "team", "flyerTemplates", "newFlyerTemplate", "banner", "settings", "programTitles", "sandeshaActivity"],
    programs: ["events", "programVolunteers", "settings", "generateFlyer"],
    promotions: ["promotions", "banner"],
    nurturing: ["queries", "volunteering", "volunteers", "settings", "sandeshaActivity"],
  };
  const ROLE_LABELS = {
    admin: "Admin",
    programs: "Programs",
    promotions: "Promotions",
    nurturing: "Nurturing",
  };
  let selectedLoginRole = "";
  const MAX_IMAGE_EDGE = 1400;
  const JPEG_QUALITY = 0.82;
  const FREQUENCY_OPTIONS = ["Daily", "Weekly", "Monthly", "Scheduled"];
  const DEFAULT_LOCATION = "Isha Place, Vijayanagar";

  /** Official Isha program descriptions (exact wording from isha.sadhguru.org),
   * keyed by a normalized title, used to auto-fill the Description field when
   * a program is picked in the editor. "Inner Engineering" matches any
   * duration variant (4 Days / 7 Days) since the program description itself
   * doesn't differ by duration. */
  const PROGRAM_DESCRIPTIONS = {
    "inner engineering": "Inner Engineering, a transformative program designed by Sadhguru, offers tools to take charge of your body, mind, emotions and energies.",
    "upa-yoga": "Upa-Yoga is a simple yet powerful set of ten practices that activate the joints, muscles and energy system, bringing ease to the whole system.",
    "upa yoga": "Upa-Yoga is a simple yet powerful set of ten practices that activate the joints, muscles and energy system, bringing ease to the whole system.",
    "surya kriya": "Surya Kriya is a potent yogic practice of tremendous antiquity, designed as a holistic process for health, wellness, and complete inner wellbeing.",
    "angamardana": "Angamardana, a fitness system rooted in yoga, offers everyone the opportunity to invigorate the body and reach peak physical and mental health.",
    "yogasanas": "The word asana literally means a posture. Out of the innumerable asanas a body can assume, 84 have been identified as Yogasanas, through which one can transform the body and mind into a possibility for ultimate well-being.",
    "bhuta shuddhi": "The basis for all creation, including the physical body, is the group of five elements: earth, water, wind, fire, and space. Bhuta Shuddhi processes offered by Isha provide a unique opportunity for everyone to benefit from this esoteric yogic science, which otherwise requires intense sadhana.",
    "janani": "Isha Janani is a program specially designed for the wellbeing of pregnant women and unborn children. As a pregnant woman's physical, mental and emotional state has an impact on her child's development, an elaborate system of taking care of pregnant women was established in the Indian culture.",
    "guru pooja": "Guru Pooja is a certain science of using chants and offerings to manifest a powerful experience in your living space.",
    "children's hatha yoga": "Isha Hatha Yoga for Children introduces yoga through simple, life enhancing asanas and offers a unique possibility for every child to experience a joyful blossoming of their natural potential.",
    "childrens hatha yoga": "Isha Hatha Yoga for Children introduces yoga through simple, life enhancing asanas and offers a unique possibility for every child to experience a joyful blossoming of their natural potential.",
    "shanmukhi mudra": "Shanmukhi Mudra is a simple but subtle practice that brightens and rejuvenates the face and eyes and brings about a state of balance leading toward increased awareness and meditativeness.",
    "bhastrika kriya": "Bhastrika Kriya is especially beneficial for those suffering from asthma, allergies, sinusitis, diabetes, hormonal imbalances and skin diseases.",
    "eye care": "Isha's rejuvenating Eye Care workshop offers a natural way to improve vision-related issues, relieving strain and preventing further deterioration.",
    "shivanga sadhana": "Shivanga Sadhana is a powerful spiritual practice designed by Sadhguru to bring forth devotion from within and enhance your receptivity to Shiva – the Adiyogi.",
    "shivanga spurthi": "Devotion will let you sail across even if you do not know the way. Shivanga Spurthi is a devotional offering of chants and songs to Shiva to nurture and kindle the flames of devotion within one's heart.",
    "bhairavi sadhana": "Bhairavi Sadhana is a simple yet powerful process through which one can become receptive to the grace of Linga Bhairavi and bring forth the dimension of devotion from within.",
    "devi divya pooja": "Every Purnima (full moon) is celebrated at Linga Bhairavi with an elaborate Abhishekam and a lively offering of music and dance, creating an explosive atmosphere.",
    "sannidhi pooja": "A Sannidhi is a consecrated form designed by Sadhguru, which creates an opportunity to always be in the Presence of the Master.",
    "satsang": "Satsang means to be in communion with Truth. This is an opportunity to come in touch with the Source, to deepen your experience of Inner Engineering and correct your practices.",
    "monthly satsang": "Satsang means to be in communion with Truth. This is an opportunity to come in touch with the Source, to deepen your experience of Inner Engineering and correct your practices.",
    "sadhguru darshan": "The word darshan literally means to behold or to see. Darshan is an opportunity to be in the presence of Sadhguru, to receive and absorb his grace and wisdom.",
    "guru purnima": "Guru Purnima, the first full moon after the summer solstice, marks the first transmission of the Yogic sciences from Shiva – the Adiyogi or first Yogi – to his first disciples, the Saptarishis, the seven celebrated sages.",
  };

  /** Looks up a program's official description for the auto-fill, matching
   * loosely (case/spacing-insensitive, "Inner Engineering – 4 Days" etc. all
   * match the base "inner engineering" entry). Returns "" when unknown. */
  function findProgramDescription(title) {
    const norm = String(title || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
    if (!norm) return "";
    if (norm.indexOf("inner engineering") !== -1) return PROGRAM_DESCRIPTIONS["inner engineering"];
    if (PROGRAM_DESCRIPTIONS[norm]) return PROGRAM_DESCRIPTIONS[norm];
    const key = Object.keys(PROGRAM_DESCRIPTIONS).find(function (k) {
      return norm.indexOf(k) !== -1;
    });
    return key ? PROGRAM_DESCRIPTIONS[key] : "";
  }

  let currentResource = "programs";
  let currentVolNeedId = "";
  let formTemplates = [];   // loaded once from API: [{id,name,slotPlaceholder}]
  let items = [];
  let listingFilter = "open";
  let editingId = "";
  /** Which resource the listing last finished loading — drafts wait on it. */
  let listLoadedFor = "";
  let pendingImage = null;
  let editorMode = "single";
  let bulkPreviewRows = [];
  let hubStatsAt = 0;
  let hubStatsDirty = true;
  let pvItems = [];
  let pvView = "open";
  let pvExpandedId = "";
  let pvLoading = false;
  let pvDetailRowId = "";
  let pvDetailPendingAttended = "";
  const listingPrefetch = {};
  let promoCacheDirty = true;

  let programTitlesCache = [];
  let titleSelectSilent = false;
  let flyerTemplatesCache = [];
  let selectedFlyerTemplateId = "";
  let generatedFlyerUrl = "";
  let pendingManualFlyer = null;
  let flyerImportPptxFile = null;
  let flyerImportPlaceholders = [];

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
      "button, .filter-pill, .inquiry-type-pill, .inquiry-status-tab, .inquiry-action, .admin-hub-path, .admin-hub-panel, .admin-card"
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

  /* Installed as a PWA, the session persists across app restarts (localStorage).
     In a normal browser tab it stays session-only, as before, so a signed-in
     session can't outlive the tab on a shared computer. */
  function isInstalledApp() {
    try {
      if (window.navigator && window.navigator.standalone === true) return true; // iOS
      return !!(
        window.matchMedia && window.matchMedia("(display-mode: standalone)").matches
      );
    } catch (e) {
      return false;
    }
  }

  function authStore() {
    return isInstalledApp() ? localStorage : sessionStorage;
  }

  function readAuth(key) {
    try {
      return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
    } catch (e) {
      return "";
    }
  }

  function writeAuth(key, value) {
    try {
      const keep = authStore();
      const other = keep === localStorage ? sessionStorage : localStorage;
      other.removeItem(key);
      if (value) keep.setItem(key, value);
      else keep.removeItem(key);
    } catch (e) {}
  }

  // Move any existing session into whichever store this context should use.
  function migrateSessionKeys() {
    try {
      [TOKEN_KEY, USER_KEY].forEach(function (key) {
        const existing = readAuth(key);
        if (existing) writeAuth(key, existing);
        else writeAuth(key, "");
      });
    } catch (e) {}
  }

  migrateSessionKeys();

  function token() {
    return readAuth(TOKEN_KEY);
  }

  function setToken(value) {
    writeAuth(TOKEN_KEY, value || "");
  }

  function currentUser() {
    try {
      return JSON.parse(readAuth(USER_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function setCurrentUser(user) {
    writeAuth(USER_KEY, user ? JSON.stringify(user) : "");
  }

  function role() {
    const user = currentUser();
    return (user && user.role) || "";
  }

  /** Hashes are compared lower-cased; map one back to its camelCase page name. */
  function pageFromHash(hash) {
    const pages = ROLE_PAGES[role()] || [];
    return pages.find(function (p) { return p.toLowerCase() === hash; }) || "";
  }

  function canAccess(page) {
    const pages = ROLE_PAGES[role()] || [];
    return pages.indexOf(page) >= 0;
  }

  function canNotifyQueries() {
    const r = role();
    return r === "admin" || r === "nurturing";
  }

  function canNotifyPromos() {
    const r = role();
    return r === "admin" || r === "promotions";
  }

  function canNotifyPrograms() {
    return role() === "programs";
  }

  function applyRoleUi() {
    const r = role();
    document.body.setAttribute("data-role", r || "");
    document.querySelectorAll("[data-admin-page]").forEach(function (card) {
      const page = card.getAttribute("data-admin-page");
      const hideForRole = card.getAttribute("data-hide-for-role");
      const hiddenForCurrentRole = hideForRole
        ? hideForRole.split(",").map(function (s) { return s.trim(); }).indexOf(r) >= 0
        : false;
      const isNrCard = card.hasAttribute("data-nr-card");
      // nr-cards are only shown for nurturing; all others follow canAccess
      if (isNrCard) {
        card.classList.toggle("hidden", r !== "nurturing" || !canAccess(page));
      } else {
        card.classList.toggle("hidden", !canAccess(page) || hiddenForCurrentRole);
      }
    });
    document.querySelectorAll("[data-hub-role-only]").forEach(function (el) {
      const allowed = (el.getAttribute("data-hub-role-only") || "")
        .split(",")
        .map(function (s) { return s.trim(); });
      el.classList.toggle("hidden", allowed.indexOf(r) < 0);
    });
    defaultHubLead();
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
    if (/Unknown formType|Unknown type/i.test(msg)) {
      return "The live Apps Script is still the old version. Paste the latest apps-script.js, Save, then Deploy → Manage deployments → pencil → New version → Deploy.";
    }
    return msg;
  }

  function isAuthEndedError(error) {
    return !!(error && /Unauthorized/i.test(String(error)));
  }

  function rejectIfAuthEnded(data) {
    if (data && isAuthEndedError(data.error) && token()) {
      logout();
      loginError(data.error);
    }
    return data;
  }

  function isAdminWrite(formType) {
    return (
      /^admin/.test(formType) &&
      formType !== "adminLogin" &&
      formType !== "adminLogout" &&
      formType !== "adminSession" &&
      formType !== "adminGet"
    );
  }

  async function apiPost(payload) {
    const formType = (payload && payload.formType) || "";
    if (isAdminWrite(formType)) {
      hubStatsDirty = true;
      delete listingPrefetch.programs;
      delete listingPrefetch.volunteering;
      promoCacheDirty = true;
    }
    if (window.PiPromos) {
      const piReply = await window.PiPromos.route(payload);
      if (piReply !== undefined) return rejectIfAuthEnded(piReply);
    }
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    try {
      return rejectIfAuthEnded(JSON.parse(text));
    } catch (e) {
      throw new Error("Could not read the server response. Redeploy the Apps Script and try again.");
    }
  }

  /* ───────── sign-in on Sandesha ─────────
     Logins live on the Pi (sandesha-server/vjn-users.js) as signed "v1." tokens.
     Apps Script checks the signature itself, so only signing in and the Team
     page need the Pi; everything else keeps working if it is offline. */
  function isPiToken(t) {
    return /^v1\./.test(String(t || ""));
  }

  async function piCall(path, opts) {
    const base = String(window.SANDESHA_API_URL || "").replace(/\/$/, "");
    const options = Object.assign({}, opts || {});
    if (options.auth) {
      options.headers = { Authorization: "Bearer " + token() };
      delete options.auth;
    }
    let res;
    try {
      res = await fetch(base + path, options);
    } catch (e) {
      throw new Error("Sandesha is offline — signing in and Team need it. Try again in a minute.");
    }
    if (res.status === 404) {
      const err = new Error("Sandesha is not updated yet.");
      err.unsupported = true;
      throw err;
    }
    const data = await res.json().catch(function () {
      return { error: "Sandesha replied HTTP " + res.status };
    });
    return rejectIfAuthEnded(data);
  }

  /** Swap a day-old login for a fresh one, so active people stay signed in. */
  function refreshPiToken() {
    const t = token();
    if (!isPiToken(t)) return;
    let iat = 0;
    try {
      iat = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).iat || 0;
    } catch (e) {}
    if (Date.now() - iat < 24 * 60 * 60 * 1000) return;
    piCall("/vjn/refresh", { method: "POST", body: JSON.stringify({ token: t }) })
      .then(function (data) {
        if (data && data.token && token() === t) setToken(data.token);
      })
      .catch(function () {});
  }

  async function apiGet(type, asAdmin, extra) {
    const payload = { formType: "adminGet", type: type, token: token() };
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        if (extra[key] === undefined || extra[key] === null || extra[key] === "") return;
        payload[key] = extra[key];
      });
    }
    const data = await apiPost(payload);
    writeCached(type, extra, data);
    return data;
  }

  /** Several reads in one Apps Script round trip (each call costs ~1.5s of
   * fixed overhead). Falls back to parallel single reads on a script that
   * predates adminGetMany. */
  async function apiGetMany(reads) {
    // Promotion reads are answered by the Pi for Pi logins; the rest by the Sheet.
    const onPi = function (r) {
      return isPiToken(token()) && (r.type === "promotions" || r.type === "inviteMessages");
    };
    if (!reads.some(onPi)) return apiGetManySheet(reads);
    const sheetReads = reads.filter(function (r) { return !onPi(r); });
    const both = await Promise.all([
      sheetReads.length ? apiGetManySheet(sheetReads) : [],
      Promise.all(
        reads.filter(onPi).map(function (r) {
          return apiGet(r.type, true).catch(function (e) { return { error: e.message }; });
        })
      ),
    ]);
    let si = 0;
    let pi = 0;
    return reads.map(function (r) {
      return onPi(r) ? both[1][pi++] : both[0][si++];
    });
  }

  async function apiGetManySheet(reads) {
    if (!reads.length) return [];
    const data = await apiPost({ formType: "adminGetMany", token: token(), reads: reads });
    if (data && Array.isArray(data.results)) {
      reads.forEach(function (r, i) {
        const extra = Object.assign({}, r);
        delete extra.type;
        writeCached(r.type, Object.keys(extra).length ? extra : undefined, data.results[i]);
      });
      return data.results;
    }
    if (data && data.error && !/Unknown formType/i.test(data.error)) return reads.map(function () { return data; });
    return Promise.all(reads.map(function (r) {
      const extra = Object.assign({}, r);
      delete extra.type;
      return apiGet(r.type, true, Object.keys(extra).length ? extra : undefined);
    }));
  }

  /* ── Read cache (stale-while-revalidate) ───────────────────────────────
   * The last good answer to each read, so a page can draw instantly from it
   * and refresh behind the scenes. Per browser; wiped on login and logout so
   * one person's data never shows to the next. */
  const READ_CACHE_PREFIX = "vjn_rc:";

  function readCacheKey(type, extra) {
    let key = READ_CACHE_PREFIX + type;
    if (extra) {
      Object.keys(extra).sort().forEach(function (k) {
        if (extra[k] === undefined || extra[k] === null || extra[k] === "") return;
        key += "|" + k + "=" + extra[k];
      });
    }
    return key;
  }

  function readCached(type, extra) {
    try {
      const raw = localStorage.getItem(readCacheKey(type, extra));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeCached(type, extra, data) {
    if (!data || data.error) return;
    const key = readCacheKey(type, extra);
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      // Over quota: drop the whole cache rather than evict piecemeal.
      clearReadCache();
    }
  }

  function clearReadCache() {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(READ_CACHE_PREFIX) === 0) localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  function setStatus(message, isError) {
    const mirror = $("oppStatus");
    if (mirror) {
      mirror.textContent = message || "";
      mirror.classList.toggle("is-error", !!isError);
    }
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

  function isInstalledApp() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches ||
      window.navigator.standalone === true
    );
  }

  function notificationAllowed() {
    return typeof Notification !== "undefined" && Notification.permission === "granted";
  }

  function queryNotifyPref() {
    try {
      return localStorage.getItem(QUERY_NOTIFY_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function setQueryNotifyPref(value) {
    try {
      if (value) localStorage.setItem(QUERY_NOTIFY_KEY, value);
      else localStorage.removeItem(QUERY_NOTIFY_KEY);
    } catch (e) {}
  }

  function queryNotifyEnabled() {
    return queryNotifyPref() !== "off" && notificationAllowed();
  }

  function updateNotifyButton() {
    const btn = $("queryNotifyBtn");
    if (!btn) return;
    const canNotify = canNotifyQueries() || canNotifyPromos() || canNotifyPrograms();
    if (
      !token() ||
      !canNotify ||
      !isInstalledApp() ||
      typeof Notification === "undefined" ||
      Notification.permission === "denied"
    ) {
      btn.hidden = true;
      return;
    }
    const on = queryNotifyEnabled();
    btn.hidden = false;
    btn.classList.toggle("is-on", on);
    btn.classList.toggle("is-off", !on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", on ? "Turn off alerts" : "Turn on alerts");
    btn.title = on ? "Turn off alerts" : "Turn on alerts";
  }

  async function requestQueryNotifications() {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const result = await Notification.requestPermission();
      updateNotifyButton();
      return result === "granted";
    } catch (err) {
      return false;
    }
  }

  async function turnOnQueryAlerts() {
    const ok = await requestQueryNotifications();
    if (!ok) {
      updateNotifyButton();
      return false;
    }
    setQueryNotifyPref("on");
    startAlertWatch();
    return true;
  }

  /** Bell buttons (header and Promotions). Every outcome says something —
   * the header button is hidden outside the installed app, so a silent
   * no-op here looked like a dead button. */
  async function onNotifyButton() {
    if (typeof Notification === "undefined" || !isInstalledApp()) {
      showToast("Install this page as an app (Add to Home screen), then turn alerts on from there.", {
        title: "Alerts work in the installed app",
        ms: 6000,
      });
      return;
    }
    if (Notification.permission === "denied") {
      showToast("Allow notifications for this site in your phone's settings, then try again.", {
        title: "Notifications are blocked",
        tone: "warn",
        ms: 6000,
      });
      return;
    }
    if (queryNotifyEnabled()) {
      openNotifyOffConfirm();
      return;
    }
    showToast("Asking for permission…", { tone: "progress", ms: 8000 });
    const ok = await turnOnQueryAlerts();
    showToast(ok ? "You'll get a phone alert for new queries and due posts." : "Notifications weren't allowed.", {
      title: ok ? "Alerts on" : undefined,
      tone: ok ? "success" : "warn",
    });
  }

  function openNotifyOffConfirm() {
    const overlay = $("notifyOffOverlay");
    if (overlay) overlay.classList.add("open");
  }

  function closeNotifyOffConfirm() {
    const overlay = $("notifyOffOverlay");
    if (overlay) overlay.classList.remove("open");
  }

  function turnOffQueryAlerts() {
    setQueryNotifyPref("off");
    stopAlertWatch();
    updateNotifyButton();
    closeNotifyOffConfirm();
    showToast("Alerts off");
  }

  function readInquiryStamp() {
    try {
      return localStorage.getItem(INQUIRY_STAMP_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function writeInquiryStamp(stamp) {
    try {
      if (stamp) localStorage.setItem(INQUIRY_STAMP_KEY, stamp);
    } catch (e) {}
  }

  function stampFromGroups(groups) {
    return (groups || [])
      .map(function (g) {
        return g.key + ":" + (g.total || 0);
      })
      .join("|");
  }

  function parseInquiryStamp(stamp) {
    const map = {};
    String(stamp || "")
      .split("|")
      .forEach(function (part) {
        const i = part.lastIndexOf(":");
        if (i < 0) return;
        map[part.slice(0, i)] = parseInt(part.slice(i + 1), 10) || 0;
      });
    return map;
  }

  function countNewQueries(prevStamp, nextStamp) {
    const prev = parseInquiryStamp(prevStamp);
    const next = parseInquiryStamp(nextStamp);
    let n = 0;
    Object.keys(next).forEach(function (key) {
      const delta = (next[key] || 0) - (prev[key] || 0);
      if (delta > 0) n += delta;
    });
    return n;
  }

  function latestNewQuery(groups, prevStamp, nextStamp) {
    const prev = parseInquiryStamp(prevStamp);
    const next = parseInquiryStamp(nextStamp);
    for (let i = 0; i < (groups || []).length; i++) {
      const g = groups[i];
      if ((next[g.key] || 0) > (prev[g.key] || 0) && g.latest) return g;
    }
    return (groups || []).find(function (g) {
      return g.latest;
    }) || null;
  }

  async function showQueryNotification(count, group) {
    if (!queryNotifyEnabled() || !navigator.serviceWorker) return;
    const latest = group && group.latest;
    const title = count > 1 ? count + " new queries" : "New query";
    let body = "A new query was submitted.";
    if (count === 1 && latest) {
      const name = latest.name || "Someone";
      body = latest.preview ? name + " — " + latest.preview : "From " + name;
    } else if (count > 1 && latest && latest.name) {
      body = "Latest from " + latest.name;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body: body,
        icon: "assets/icon-192.png",
        badge: "assets/icon-192.png",
        tag: "vjn-new-query",
        renotify: true,
        data: { url: "admin.html#queries" },
      });
      return;
    } catch (err) {}
    try {
      new Notification(title, { body: body, icon: "assets/icon-192.png" });
    } catch (err) {}
  }

  async function refreshQueriesAfterNotify() {
    hubStatsDirty = true;
    const app = $("adminApp");
    if (app && app.classList.contains("is-hub")) {
      loadHubStats(true);
      return;
    }
    if (!app || !app.classList.contains("is-queries")) return;
    try {
      const meta = await apiGet("inquiries", true);
      if (meta.error) return;
      inquiryGroups = (meta.groups || []).map(function (g) {
        const prev = inquiryGroups.find(function (old) {
          return old.key === g.key;
        });
        return {
          key: g.key,
          title: g.title,
          openCount: g.openCount || 0,
          total: g.total || 0,
          latest: g.latest || null,
          items: (prev && prev.loaded && prev.items) || g.items || [],
          loaded: !!(prev && prev.loaded),
        };
      });
      await loadInquiryScopeGroups(true);
      renderInquiries();
    } catch (err) {}
  }

  async function checkNewQueries() {
    if (queryWatchBusy || !token() || !queryNotifyEnabled() || !canNotifyQueries()) return;
    queryWatchBusy = true;
    try {
      const meta = await apiGet("inquiries", true);
      if (meta && meta.error && /Unauthorized/i.test(meta.error)) {
        stopAlertWatch();
        logout();
        loginError(meta.error);
        return;
      }
      if (!meta || meta.error) return;
      const nextStamp = meta.stamp || stampFromGroups(meta.groups);
      const prevStamp = readInquiryStamp();
      if (!prevStamp) {
        writeInquiryStamp(nextStamp);
        return;
      }
      if (nextStamp === prevStamp) return;
      const added = countNewQueries(prevStamp, nextStamp);
      writeInquiryStamp(nextStamp);
      if (added < 1) return;
      const group = latestNewQuery(meta.groups, prevStamp, nextStamp);
      await showQueryNotification(added, group);
      refreshQueriesAfterNotify();
    } catch (err) {
      // Keep watching; a single failed poll should not stop alerts.
    } finally {
      queryWatchBusy = false;
    }
  }

  function stopQueryWatch() {
    if (queryWatchTimer) {
      clearInterval(queryWatchTimer);
      queryWatchTimer = 0;
    }
  }

  function stopPromoWatch() {
    if (promoWatchTimer) {
      clearInterval(promoWatchTimer);
      promoWatchTimer = 0;
    }
  }

  function stopAlertWatch() {
    stopQueryWatch();
    stopPromoWatch();
  }

  function startQueryWatch() {
    stopQueryWatch();
    if (!token() || !isInstalledApp() || !queryNotifyEnabled() || !canNotifyQueries()) {
      updateNotifyButton();
      return;
    }
    updateNotifyButton();
    checkNewQueries();
    queryWatchTimer = setInterval(checkNewQueries, QUERY_WATCH_MS);
  }

  function startPromoWatch() {
    stopPromoWatch();
    if (!token() || !isInstalledApp() || !queryNotifyEnabled() || !canNotifyPromos()) {
      updateNotifyButton();
      return;
    }
    updateNotifyButton();
    checkDuePromos();
    promoWatchTimer = setInterval(checkDuePromos, QUERY_WATCH_MS);
  }

  function startAlertWatch() {
    startQueryWatch();
    startPromoWatch();
  }

  async function loadSessionUser() {
    try {
      const posted = await apiPost({ formType: "adminSession", token: token() });
      if (posted && posted.user) {
        setCurrentUser(posted.user);
        return { user: posted.user };
      }
      if (posted && posted.error && isAuthEndedError(posted.error)) {
        return { unauthorized: posted.error };
      }
    } catch (err) {}
    return { user: null };
  }

  /** Reveals the app once a reloaded sub-page is ready (see the head script in admin.html). */
  function endDeepLinkBoot() {
    document.documentElement.classList.remove("admin-deeplink");
  }
  // Never leave the page covered if something stalls.
  setTimeout(endDeepLinkBoot, 10000);

  async function enterApp() {
    /* On a cold boot the shell is already on screen (inline head script keeps the
       login screen from flashing), so show the hub chrome while the session
       loads instead of a blank panel. On a fresh login the login screen stays up
       until we know which view to open, so there's no empty-shell flash. */
    if (document.documentElement.classList.contains("admin-authed") &&
        !document.documentElement.classList.contains("admin-deeplink")) {
      const bootApp = $("adminApp");
      if (bootApp) bootApp.classList.add("is-hub");
    }
    // A returning user goes straight in on the role saved at login and the
    // session is confirmed in the background — it costs a ~2s Apps Script
    // round trip. An expired session still ends at the login screen.
    const stored = currentUser();
    const sessionCheck = loadSessionUser();
    refreshPiToken();
    if (stored && stored.role) {
      sessionCheck.then(function (session) {
        if (session.unauthorized) {
          logout();
          loginError(session.unauthorized);
        } else if (session.user && session.user.role !== stored.role) {
          location.reload();
        }
      });
    } else {
      const session = await sessionCheck;
      if (session.unauthorized) {
        logout();
        loginError(session.unauthorized);
        if (window.endPageLoad) endPageLoad();
        return;
      }
      if (!session.user) {
        logout();
        loginError("Please log in again.");
        if (window.endPageLoad) endPageLoad();
        return;
      }
    }
    applyRoleUi();
    const hash = (location.hash || "").replace(/^#/, "").toLowerCase();
    if (role() === "promotions" || hash === "promotions") {
      window.location.replace("admin-promotions.html");
      return;
    }
    document.documentElement.classList.add("admin-authed");
    show($("loginScreen"), false);
    show($("adminApp"), true);
    if (hash.startsWith("volunteering/") && canAccess("volunteering")) {
      // Set up the workspace shell first, then open the sub-page the URL points at.
      openAdminPage("volunteering", true);
      if (!routeVolunteeringHash(hash)) history.replaceState(null, "", "#volunteering");
      // The program detail page reveals itself once its data is in.
      if (!hash.startsWith("volunteering/need/")) endDeepLinkBoot();
    } else if (hash && pageFromHash(hash)) {
      openAdminPage(pageFromHash(hash), true);
      endDeepLinkBoot();
    } else {
      showAdminHub(true);
      endDeepLinkBoot();
      if (window.endPageLoad) endPageLoad();
    }
    startAlertWatch();
    watchDrafts();
  }

  /** Opens a volunteering sub-page from its hash (also used to restore the page on refresh). */
  function routeVolunteeringHash(hash) {
    if (hash === "volunteering/needs") {
      openVolNeedsList(true);
    } else if (hash.startsWith("volunteering/need/")) {
      const id = hash.slice("volunteering/need/".length);
      if (id) openVolProgramDetail(id, true);
      else openVolNeedsList(true);
    } else if (hash === "volunteering/opportunities") {
      openVolOpportunities(true);
    } else if (hash === "volunteering/attendance") {
      openVolAttendance(true);
    } else if (hash.startsWith("volunteering/attendance/")) {
      openVolAttendanceMark(hash.slice("volunteering/attendance/".length), true);
    } else {
      return false;
    }
    return true;
  }

  /** opts: { eyebrow } small label above the title, { sub } line under it,
   * { back } label for the header back button. */
  function setAdminTitle(title, opts) {
    const el = $("adminPageTitle");
    if (el) el.textContent = title;
    const eyebrow = $("adminPageEyebrow");
    if (eyebrow) {
      eyebrow.textContent = (opts && opts.eyebrow) || "";
      eyebrow.classList.toggle("hidden", !(opts && opts.eyebrow));
    }
    const sub = $("adminPageSub");
    if (sub) {
      const subHtml = opts && opts.subHtml;
      if (subHtml) sub.innerHTML = subHtml;
      else sub.textContent = (opts && opts.sub) || "";
      sub.classList.toggle("admin-bar-sub--rich", !!subHtml);
      sub.classList.toggle("hidden", !(subHtml || (opts && opts.sub)));
    }
    const backLabel = (opts && opts.back) || "Back to menu";
    const backBtn = $("backToHubBtn");
    if (backBtn) {
      backBtn.setAttribute("aria-label", backLabel);
      backBtn.setAttribute("title", backLabel);
    }
    document.title = title + " – Isha Place, Vijayanagar";
  }

  function renderHubIntro() {
    const user = currentUser();
    const greet = $("hubGreeting");
    const name = user && (user.displayName || user.username);
    if (greet) {
      greet.textContent = name ? "Namaskaram," : "Namaskaram";
      if (name) {
        greet.appendChild(document.createElement("br"));
        greet.appendChild(document.createTextNode(name));
      }
    }
    defaultHubLead();
  }

  function setHubStat(key, open) {
    document.querySelectorAll('[data-stat-value="' + key + '"]').forEach(function (value) {
      value.textContent = open == null ? "—" : String(open);
    });
    document.querySelectorAll('[data-stat-row="' + key + '"]').forEach(function (row) {
      row.classList.toggle("is-none", open === 0);
    });
    // Labels that agree with the number: "1 program needs…" / "3 programs need…".
    document.querySelectorAll('[data-stat-label="' + key + '"]').forEach(function (label) {
      const text = open === 1 ? label.getAttribute("data-one") : label.getAttribute("data-many");
      if (text) label.textContent = text;
    });
  }

  function defaultHubLead() {
    const lead = $("hubLead");
    if (!lead) return;
    const r = role();
    if (r === "programs" || r === "nurturing") {
      lead.hidden = true;
      return;
    }
    lead.hidden = false;
    if (r === "promotions") {
      lead.textContent = "Prepare the next post below.";
      return;
    }
    if (r === "admin") {
      lead.textContent = "Overlook the centre below.";
      return;
    }
    lead.textContent = "";
  }

  /** "Volunteers needed" now lives as a card inside the Needs attention stack. */
  function showHubNeedsBanner(unmet) {
    if ($("hubNeeds")) show($("hubNeeds"), false);
    if (hubNeedsUnmet === unmet) return;
    hubNeedsUnmet = unmet;
    const host = $("hubAlertStack");
    if (host && !host.classList.contains("is-loading")) renderHubAlertStack();
  }

  function setHubLead(promoCounts, volunteerNeedCounts) {
    const lead = $("hubLead");
    if (!lead) return;
    const r = role();
    if (r !== "nurturing") showHubNeedsBanner(0);
    if (r === "programs") {
      lead.hidden = true;
      return;
    }
    lead.hidden = false;
    if (r === "promotions") {
      const due = (promoCounts && promoCounts.due) || 0;
      const need = (promoCounts && (promoCounts.pending || promoCounts.needs_copy)) || 0;
      if (due > 0) {
        lead.innerHTML =
          due === 1
            ? "There is <b>1</b> post due to share now."
            : "There are <b>" + due + "</b> posts due to share now.";
        return;
      }
      if (need > 0) {
        lead.innerHTML =
          need === 1
            ? "<b>1</b> event still needs a message."
            : "<b>" + need + "</b> events still need a message.";
        return;
      }
      lead.textContent = "All quiet for now. Prepare the next post below.";
      return;
    }
    if (r === "nurturing") {
      const unmet = (volunteerNeedCounts && volunteerNeedCounts.unmet) || 0;
      if (unmet > 0) {
        // Shown as its own "Volunteers needed" banner instead of a lead line.
        lead.hidden = true;
        showHubNeedsBanner(unmet);
        return;
      }
      showHubNeedsBanner(0);
      lead.textContent = "All quiet for now. Enquiries and volunteering are below.";
      return;
    }
    if (r === "admin") {
      lead.textContent = "Choose a path below.";
      return;
    }
    lead.textContent = "";
  }

  function setNotifyDot(on) {
    const dot = $("queryNotifyDot");
    if (dot) show(dot, !!on);
  }

  function hubStatsNote(message) {
    const note = $("hubStatsNote");
    if (!note) return;
    note.textContent = message || "";
    note.hidden = !message;
  }

  /** Copies text via a throwaway off-screen textarea + execCommand — works
      in contexts (plain HTTP, no user-activation nuance) where the async
      Clipboard API is unavailable or refuses. Returns whether it worked. */
  function legacyCopyText(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.left = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  /** Copies an absolute link built from a relative page path (e.g. the
      public volunteer-attendance page) and gives brief on-card + hub
      feedback. Tries the Clipboard API first, then a legacy execCommand
      fallback, and only resorts to a prompt() if both are unavailable. */
  function copyHubLink(relativeHref, btn) {
    const url = new URL(relativeHref, window.location.href).href;
    const label = btn && btn.querySelector("[data-attendance-cta-label]");
    const prevLabel = label ? label.textContent : "";
    function showCopied() {
      if (label) label.textContent = "Copied!";
      if (btn) btn.classList.add("is-copied");
      hubStatsNote("Volunteer attendance link copied to clipboard.");
      setTimeout(function () {
        if (label) label.textContent = prevLabel;
        if (btn) btn.classList.remove("is-copied");
        hubStatsNote("");
      }, 1800);
    }
    function fallback() {
      if (legacyCopyText(url)) {
        showCopied();
      } else {
        prompt("Copy this link:", url);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(showCopied).catch(fallback);
    } else {
      fallback();
    }
  }

  function countOpenListings(list) {
    return (list || []).filter(isListingOpen).length;
  }

  function applyHubStats(byKey) {
    if (byKey.programs) {
      const programItems = byKey.programs.items || [];
      listingPrefetch.programs = { items: programItems, at: Date.now() };
      const programsOpen = countOpenListings(programItems);
      setHubStat("programs", programsOpen);
      setHubStat("programs-closed", Math.max(0, programItems.length - programsOpen));
    }
    if (byKey.volunteering) {
      const volunteerItems = byKey.volunteering.items || [];
      listingPrefetch.volunteering = { items: volunteerItems, at: Date.now() };
      setHubStat("volunteering", countOpenListings(volunteerItems));
    }
    const volunteerNeedCounts = (byKey.volunteerNeeds && byKey.volunteerNeeds.counts) || {};
    if (byKey.volunteerNeeds) {
      setHubStat("volunteer-needs", volunteerNeedCounts.unmet || 0);
      setHubStat("pv-unmet", volunteerNeedCounts.unmet || 0);
      setHubStat("vol-awaiting", volunteerNeedCounts.awaitingAttendance || 0);
      volunteerNeeds = byKey.volunteerNeeds.items || [];
    }
    let openQueries = 0;
    if (byKey.inquiries) {
      // Attendance sign-ins now live under Volunteering, not this card.
      const groups = (byKey.inquiries.groups || []).filter(function (g) {
        return QUERY_GROUP_KEYS.indexOf(g.key) >= 0;
      });
      openQueries = groups.reduce(function (sum, g) {
        return sum + (g.openCount || 0);
      }, 0);
      const totalQueries = groups.reduce(function (sum, g) {
        return sum + (g.total || 0);
      }, 0);
      setHubStat("queries", openQueries);
      setHubStat("queries-resolved", Math.max(0, totalQueries - openQueries));
      setNotifyDot(canNotifyQueries() && openQueries > 0);
    }
    const promoCounts = (byKey.promotions && byKey.promotions.counts) || {};
    if (byKey.promotions) {
      setHubStat("promo-due", promoCounts.due || 0);
      setHubStat("promo-copy", promoCounts.pending || promoCounts.needs_copy || 0);
      if (canNotifyPromos() && (promoCounts.due || 0) > 0) setNotifyDot(true);
    }
    if (byKey.users) {
      const people = byKey.users.users || [];
      const active = people.filter(function (u) {
        return String(u.status || "").toLowerCase() === "active";
      }).length;
      setHubStat("team", people.length);
      setHubStat("team-active", active);
    }
    setHubLead(promoCounts, volunteerNeedCounts);
  }

  async function loadHubStats(force) {
    const grid = $("hubStats");
    if (!grid) return;
    const fresh = Date.now() - hubStatsAt < 30000;
    if (!force && !hubStatsDirty && fresh) return;
    hubStatsNote("");
    const keys = [];
    if (canAccess("events")) keys.push("programs");
    if (canAccess("volunteering")) keys.push("volunteering");
    if (canAccess("volunteering") || canAccess("programVolunteers")) keys.push("volunteerNeeds");
    if (canAccess("queries")) keys.push("inquiries");
    if (canAccess("promotions")) keys.push("promotions");
    if (canAccess("team")) keys.push("users");
    // Draw last visit's counts at once; the fresh ones replace them below.
    const cached = {};
    const haveCache = keys.every(function (key) {
      cached[key] = readCached(key);
      return !!cached[key];
    });
    if (haveCache && keys.length) {
      applyHubStats(cached);
      grid.classList.remove("is-loading");
    } else {
      grid.classList.add("is-loading");
    }
    try {
      // Team comes from Sandesha once logins live there.
      const piTeam = isPiToken(token()) && keys.indexOf("users") >= 0;
      const sheetKeys = piTeam ? keys.filter(function (key) { return key !== "users"; }) : keys;
      const both = await Promise.all([
        apiGetMany(sheetKeys.map(function (key) { return { type: key }; })),
        piTeam
          ? piCall("/vjn/users", { auth: true }).catch(function (e) { return { error: e.message }; })
          : null,
      ]);
      const results = both[0];
      const byKey = {};
      sheetKeys.forEach(function (key, i) {
        byKey[key] = results[i];
      });
      if (piTeam) {
        byKey.users = both[1];
        if (!both[1].error) writeCached("users", undefined, both[1]);
        results.push(both[1]);
      }
      const unauthorized = results.find(function (res) {
        return res && res.error && /Unauthorized/i.test(res.error);
      });
      if (unauthorized) {
        logout();
        loginError(unauthorized.error);
        return;
      }
      applyHubStats(byKey);
      hubStatsAt = Date.now();
      hubStatsDirty = false;
    } catch (err) {
      if (haveCache && keys.length) {
        hubStatsNote("Showing the last counts — could not refresh them.");
        return;
      }
      setHubStat("programs", null);
      setHubStat("programs-closed", null);
      setHubStat("volunteering", null);
      setHubStat("volunteer-needs", null);
      setHubStat("queries", null);
      setHubStat("queries-resolved", null);
      setHubStat("promo-due", null);
      setHubStat("promo-copy", null);
      setHubStat("team", null);
      setHubStat("team-active", null);
      setNotifyDot(false);
      hubStatsNote("Could not load today's counts. Open a workspace to see the latest.");
    } finally {
      grid.classList.remove("is-loading");
    }
  }

  function showAdminHub(replaceHash) {
    const app = $("adminApp");
    if (app) {
      app.classList.add("is-hub");
      app.classList.remove("is-workspace", "is-queries", "is-events", "is-promotions", "is-team");
    }
    show($("adminHub"), true);
    show($("adminWorkspace"), false);
    show($("backToHubBtn"), false);
    show($("adminOpenBadge"), false);
    show($("logoutBtn"), true);
    if ($("settingsBtn")) $("settingsBtn").hidden = !canAccess("settings");
    setAdminTitle("Team");
    setStatus("");
    renderHubIntro();
    // Runs on its own, ahead of loadHubStats() below — the alert shouldn't
    // wait on every other card's slower fetches (programs, inquiries, ...)
    // to come back before it can appear.
    checkHubAttendanceAlertsNow();
    loadHubStats();
    window.dispatchEvent(new CustomEvent("vjn:admin-hub-show"));
    if (replaceHash) {
      if (location.hash && location.hash !== "#") {
        history.replaceState(null, "", location.pathname + location.search);
      }
    } else if (location.hash) {
      history.pushState(null, "", location.pathname + location.search);
    }
  }

  function workspaceTitle(page) {
    if (page === "queries") return "Queries";
    if (page === "promotions") return "Promotions";
    if (page === "messaging") return "Tools";
    if (page === "team") return "Team";
    if (page === "banner") return "Homepage banner";
    if (page === "volunteering") return "Volunteering";
    if (page === "volunteers") return "Volunteers";
    if (page === "programVolunteers") return "Program volunteers";
    if (page === "flyerTemplates") return "Flyer templates";
    if (page === "newFlyerTemplate") return "New template";
    if (page === "settings") return "Settings";
    if (page === "programTitles") return "Program names";
    if (page === "sandeshaActivity") return "Sandesha activities";
    if (page === "generateFlyer") return "Generate flyer";
    return "Programs";
  }

  function openAdminPage(page, replaceHash) {
    if (!canAccess(page)) {
      showAdminHub(true);
      return;
    }
    const isQueries = page === "queries";
    const isEvents = page === "events";
    const isVolunteering = page === "volunteering";
    const isListings = isEvents || isVolunteering;
    const isPromos = page === "promotions";
    if (isPromos) {
      window.location.href = "admin-promotions.html";
      return;
    }
    if (page === "messaging") {
      window.location.href = "admin-messaging.html";
      return;
    }
    const isTeam = page === "team";
    const isPv = page === "programVolunteers";
    const isFlyerImport = page === "newFlyerTemplate";
    const isFlyerGen = page === "generateFlyer" || page === "flyerTemplates";
    // Nurturing volunteers to a sub-chooser rather than straight to the list
    const isNurturingVolChooser = isVolunteering && role() === "nurturing";
    const app = $("adminApp");
    if (app) {
      app.classList.remove("is-hub");
      app.classList.add("is-workspace");
      app.classList.toggle("is-queries", isQueries);
      app.classList.toggle("is-events", isListings && !isNurturingVolChooser);
      app.classList.toggle("is-promotions", isPromos);
      app.classList.toggle("is-team", isTeam);
      app.classList.toggle("is-pv", isPv);
    }
    show($("adminHub"), false);
    show($("adminWorkspace"), true);
    const promotionsOnly = role() === "promotions";
    show($("backToHubBtn"), !promotionsOnly);
    show($("logoutBtn"), promotionsOnly);
    if ($("settingsBtn")) $("settingsBtn").hidden = true;
    show($("listingsPanel"), isListings && !isNurturingVolChooser);
    show($("inquiriesPanel"), isQueries);
    show($("promotionsPanel"), isPromos);
    show($("teamPanel"), isTeam);
    show($("programVolunteersPanel"), isPv);
    show($("flyerTemplatesPanel"), isFlyerImport);
    show($("settingsPanel"), page === "settings");
    show($("programTitlesPanel"), page === "programTitles");
    show($("sandeshaActivityPanel"), page === "sandeshaActivity");
    show($("generateFlyerPanel"), isFlyerGen);
    show($("gfToolbar"), page === "flyerTemplates");
    show($("bannerPanel"), page === "banner");
    show($("volChooserPanel"), isNurturingVolChooser);
    show($("volRosterPanel"), page === "volunteers");
    show($("volProgramDetailPanel"), false);
    show($("volAttendancePanel"), false);
    show($("volNeedsPanel"), false);
    show($("volOppsPanel"), false);
    if ($("addItemBtn")) $("addItemBtn").classList.toggle("hidden", !isListings || isNurturingVolChooser);
    show($("adminOpenBadge"), false);
    setAdminTitle(workspaceTitle(page));
    const hash = "#" + page;
    if (replaceHash) history.replaceState(null, "", hash);
    else if (location.hash !== hash) history.pushState(null, "", hash);
    // Whatever the page loads, its panel stays busy (controls disabled) until
    // that data is in; the header and back button stay usable throughout.
    let pending = null;
    let pendingPanel = null;
    if (isQueries) {
      inquiryScope = "queries";
      inquiryShowLimit = 12;
      resetInquirySearch();
      pending = loadInquiries();
      pendingPanel = $("inquiriesPanel");
    } else if (isEvents) {
      setTab("programs");
    } else if (page === "volunteers") {
      pending = loadRoster();
      pendingPanel = $("volRosterPanel");
    } else if (isNurturingVolChooser) {
      // The chooser's counts come from the hub stats; a direct load / reload
      // of #volunteering never visited the hub, so fetch them here.
      pending = loadHubStats();
      pendingPanel = $("volChooserPanel");
    } else if (isVolunteering) {
      setTab("volunteering");
    } else if (isPromos) {
      setPromoView("today");
      pending = loadPromotions();
      pendingPanel = $("promotionsPanel");
    } else if (isTeam) {
      pending = loadTeam();
      pendingPanel = $("teamPanel");
    } else if (isPv) {
      pending = loadProgramVolunteers();
      pendingPanel = $("programVolunteersPanel");
    } else if (isFlyerImport) {
      pending = loadFlyerImportPage();
      pendingPanel = $("flyerTemplatesPanel");
    } else if (isFlyerGen) {
      pending = loadGenerateFlyerPage();
      pendingPanel = $("generateFlyerPanel");
    } else if (page === "programTitles") {
      pending = loadProgramTitlesPage();
      pendingPanel = $("programTitlesPanel");
    } else if (page === "sandeshaActivity") {
      pending = loadSandeshaActivity();
      pendingPanel = $("sandeshaActivityPanel");
    } else if (page === "banner") {
      loadBannerPage();
    } else if (page === "settings") {
      updateSettingsEmpty();
      startSandeshaStatus();
    }
    if (page !== "settings") stopSandeshaStatus();
    if (pending && window.sectionLoading) window.sectionLoading(pendingPanel, pending);
    if (window.endPageLoad) endPageLoad();
  }

  function logout() {
    const current = token();
    stopAlertWatch();
    clearReadCache();
    setToken("");
    setCurrentUser(null);
    updateNotifyButton();
    document.body.removeAttribute("data-role");
    document.documentElement.classList.remove("admin-authed");
    endDeepLinkBoot();
    show($("adminApp"), false);
    show($("loginScreen"), true);
    setAdminTitle("Team login");
    document.title = "Team login – Isha Place, Vijayanagar";
    resetLoginForm();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    closeLogoutConfirm();
    if (current) {
      fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({ formType: "adminLogout", token: current }),
        keepalive: true,
      }).catch(function () {});
    }
  }

  function openLogoutConfirm() {
    const overlay = $("logoutOverlay");
    if (overlay) overlay.classList.add("open");
  }

  function closeLogoutConfirm() {
    const overlay = $("logoutOverlay");
    if (overlay) overlay.classList.remove("open");
  }

  function resetLoginForm() {
    selectedLoginRole = "";
    loginError("");
    if ($("adminPassword")) $("adminPassword").value = "";
    const lead = $("loginLead");
    if (lead) lead.textContent = "Choose your team to continue.";
    show($("loginTeamStep"), true);
    show($("loginPasswordStep"), false);
    if (window.__loginGlass && typeof window.__loginGlass.refresh === "function") {
      requestAnimationFrame(function () { window.__loginGlass.refresh(); });
    }
    const toggle = $("togglePassword");
    if (toggle && $("adminPassword")) {
      $("adminPassword").type = "password";
      toggle.setAttribute("aria-pressed", "false");
      toggle.setAttribute("aria-label", "Show password");
      toggle.classList.remove("is-visible");
    }
  }

  /** Flips a password input between dots and plain text, keeping its eye button in sync. */
  function setPasswordVisible(input, visible) {
    input.type = visible ? "text" : "password";
    const btn = document.querySelector('[data-pw-toggle="' + input.id + '"]');
    if (!btn) return;
    btn.setAttribute("aria-pressed", visible ? "true" : "false");
    btn.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    btn.classList.toggle("is-visible", visible);
  }

  function showLoginPassword(role) {
    selectedLoginRole = role;
    loginError("");
    const label = ROLE_LABELS[role] || "team";
    const lead = $("loginLead");
    // The team is shown on the back chip right below, so don't repeat it here.
    if (lead) lead.textContent = "Enter your password.";
    if ($("loginChosenTeam")) $("loginChosenTeam").textContent = label;
    show($("loginTeamStep"), false);
    show($("loginPasswordStep"), true);
    if (window.__loginGlass && typeof window.__loginGlass.refresh === "function") {
      requestAnimationFrame(function () { window.__loginGlass.refresh(); });
    }
    const input = $("adminPassword");
    if (input) {
      input.value = "";
      setTimeout(function () {
        input.focus();
      }, 50);
    }
  }

  async function handleLogin() {
    const password = ($("adminPassword") && $("adminPassword").value) || "";
    const btn = $("loginBtn");
    loginError("");
    if (!selectedLoginRole) {
      loginError("Choose your team.");
      return;
    }
    if (!password) {
      loginError("Enter the password.");
      return;
    }
    setButtonBusy(btn, true, "Signing in…");
    if (isInstalledApp() && queryNotifyPref() !== "off") await requestQueryNotifications();
    try {
      let data;
      try {
        data = await piCall("/vjn/login", {
          method: "POST",
          body: JSON.stringify({ role: selectedLoginRole, password: password }),
        });
      } catch (e) {
        if (!e.unsupported) throw e;
        // Sandesha predates /vjn — the Sheet still holds the logins.
        data = await apiPost({
          formType: "adminLogin",
          role: selectedLoginRole,
          password: password,
        });
      }
      if (data.error || !data.token) {
        loginError(data.error || "Login failed.");
        return;
      }
      clearReadCache();
      setToken(data.token);
      if (data.user) setCurrentUser(data.user);
      else
        setCurrentUser({
          role: selectedLoginRole,
          displayName: ROLE_LABELS[selectedLoginRole] || selectedLoginRole,
          username: selectedLoginRole,
        });
      $("adminPassword").value = "";
      await enterApp();
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

  function setImageFileLabel(text) {
    const el = $("fImageFileName");
    if (el) el.textContent = text || "Choose a " + photoWord();
  }

  function setImageUrlOpen(on) {
    const wrap = $("imageUrlWrap");
    const btn = $("imageUrlToggle");
    show(wrap, !!on);
    if (btn) {
      btn.setAttribute("aria-expanded", on ? "true" : "false");
      btn.textContent = on ? "Hide link field" : "Paste a link instead";
    }
  }

  function clearFieldErrors() {
    document.querySelectorAll("#editorBody .form-group.has-error").forEach(function (group) {
      group.classList.remove("has-error");
      const note = group.querySelector(".admin-field-err");
      if (note) note.remove();
    });
  }

  function setFieldError(id, message) {
    const el = $(id);
    const group = el && el.closest ? el.closest(".form-group") : null;
    if (!group) return { el: el, group: null };
    group.classList.add("has-error");
    let note = group.querySelector(".admin-field-err");
    if (!note) {
      note = document.createElement("p");
      note.className = "admin-field-err";
      group.appendChild(note);
    }
    note.textContent = message;
    return { el: el, group: group };
  }

  function focusFieldError(target) {
    if (!target) return;
    const scrollTo = target.group || target.el;
    if (scrollTo && scrollTo.scrollIntoView) {
      scrollTo.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (target.el && target.el.offsetParent !== null) {
      try {
        target.el.focus({ preventScroll: true });
      } catch (err) {
        target.el.focus();
      }
    }
  }

  /** Applies inline errors and jumps to the first one. Returns true when any were shown. */
  function showFieldErrors(pairs) {
    clearFieldErrors();
    let first = null;
    pairs.forEach(function (pair) {
      const target = setFieldError(pair[0], pair[1]);
      if (!first) first = target;
    });
    if (!first) return false;
    focusFieldError(first);
    return true;
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
    let anyActive = false;
    document.querySelectorAll("[data-template]").forEach(function (btn) {
      const on = btn.getAttribute("data-template") === id;
      if (on) anyActive = true;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const clearBtn = $("clearTemplateBtn");
    if (clearBtn) clearBtn.hidden = !anyActive;
  }

  function shortDateLabel(d) {
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return "Mon " + d.getDate() + " " + months[d.getMonth()];
  }

  /** Keeps each quick-fill card's subtitle in step with the saved defaults. */
  function updateTemplateCards() {
    const card = document.querySelector('[data-template="sannidhi"] [data-template-sub]');
    if (!card) return;
    const defaults = loadSannidhiDefaults();
    const timings = String(defaults.timings || "").trim();
    const bits = [shortDateLabel(nextMonday(new Date()))];
    if (timings) bits.push(timings);
    card.textContent = bits.join(" · ");
  }

  function setNoRegister(on) {
    const check = $("fNoRegister");
    const input = $("fRegister");
    if (check) check.checked = !!on;
    if (!input) return;
    if (on) input.value = "";
    input.disabled = !!on;
    input.placeholder = on ? "Not required" : "https://…";
  }

  function isNoRegister() {
    const check = $("fNoRegister");
    return !!(check && check.checked);
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

  /** Normalises any "H:MM" / "HH:MM" value to the "HH:MM" form time inputs expect. */
  function normalizeHm(value) {
    const m = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!m) return "";
    const h = Math.min(23, parseInt(m[1], 10));
    const min = Math.min(59, parseInt(m[2], 10));
    return pad2(h) + ":" + pad2(min);
  }

  function formatHmAmPm(hm) {
    const norm = normalizeHm(hm);
    if (!norm) return "";
    const parts = norm.split(":");
    let h = parseInt(parts[0], 10);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return h + ":" + parts[1] + " " + ap;
  }

  function formatSlotLabel(startHm, endHm) {
    const a = formatHmAmPm(startHm);
    const b = formatHmAmPm(endHm);
    if (a && b) return a + " – " + b;
    return a || b || "";
  }

  function formatSlotLine(slot) {
    if (!slot) return "";
    const range = formatSlotLabel(slot.start, slot.end);
    const name = String(slot.label || "").trim();
    if (name && range) return name + " " + range;
    return name || range || "";
  }

  const MAX_SLOTS = 3;
  const SLOT_DEFAULTS = {
    1: { start: "06:00", end: "09:00" },
    2: { start: "12:00", end: "15:00" },
    3: { start: "18:00", end: "21:00" },
  };

  const TIME_STEP_MINUTES = 15;
  let timeOptionsHtml = "";

  /** Rounds to the nearest selectable step so stored odd times still match an option. */
  function snapHm(hm) {
    const norm = normalizeHm(hm);
    if (!norm) return "";
    const parts = norm.split(":");
    let total = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    total = Math.round(total / TIME_STEP_MINUTES) * TIME_STEP_MINUTES;
    if (total >= 24 * 60) total = 24 * 60 - TIME_STEP_MINUTES;
    return pad2(Math.floor(total / 60)) + ":" + pad2(total % 60);
  }

  function fillTimeSelects() {
    if (!timeOptionsHtml) {
      const parts = [];
      for (let mins = 0; mins < 24 * 60; mins += TIME_STEP_MINUTES) {
        const hm = pad2(Math.floor(mins / 60)) + ":" + pad2(mins % 60);
        parts.push('<option value="' + hm + '">' + formatHmAmPm(hm) + "</option>");
      }
      timeOptionsHtml = parts.join("");
    }
    document.querySelectorAll("select.admin-time-select").forEach(function (el) {
      if (!el.options.length) el.innerHTML = timeOptionsHtml;
    });
  }

  function slotFieldPrefix(slotNum) {
    return "fSlot" + slotNum;
  }

  function setSlotLabel(slotNum, label) {
    const el = $(slotFieldPrefix(slotNum) + "Label");
    if (el) el.value = label || "";
  }

  function getSlotLabel(slotNum) {
    const el = $(slotFieldPrefix(slotNum) + "Label");
    return el ? String(el.value || "").trim() : "";
  }

  /** Shows the slot's own name in its heading so slots stay recognisable. */
  function syncSlotTitle(slotNum) {
    const wrap = $("slot" + slotNum + "Wrap");
    if (!wrap) return;
    const title = wrap.querySelector("[data-slot-title]");
    if (!title) return;
    title.textContent = getSlotLabel(slotNum) || "Slot " + slotNum;
  }

  function setSlotFields(slotNum, startHm, endHm, label) {
    fillTimeSelects();
    const prefix = slotFieldPrefix(slotNum);
    const defaults = SLOT_DEFAULTS[slotNum] || SLOT_DEFAULTS[1];
    const startEl = $(prefix + "Start");
    const endEl = $(prefix + "End");
    if (startEl) startEl.value = snapHm(startHm) || defaults.start;
    if (endEl) endEl.value = snapHm(endHm) || defaults.end;
    if (arguments.length >= 4) setSlotLabel(slotNum, label);
    syncSlotTitle(slotNum);
  }

  function getSlotHm(slotNum) {
    const prefix = slotFieldPrefix(slotNum);
    const startEl = $(prefix + "Start");
    const endEl = $(prefix + "End");
    return {
      label: getSlotLabel(slotNum),
      start: normalizeHm(startEl ? startEl.value : ""),
      end: normalizeHm(endEl ? endEl.value : ""),
    };
  }

  function isSlotVisible(slotNum) {
    if (slotNum <= 1) return true;
    const wrap = $("slot" + slotNum + "Wrap");
    return !!(wrap && !wrap.classList.contains("hidden"));
  }

  function visibleSlotCount() {
    if (isSlotVisible(3)) return 3;
    if (isSlotVisible(2)) return 2;
    return 1;
  }

  function setVisibleSlotCount(count) {
    const n = Math.max(1, Math.min(MAX_SLOTS, Number(count) || 1));
    for (let i = 2; i <= MAX_SLOTS; i++) {
      const on = i <= n;
      show($("slot" + i + "Wrap"), on);
      if (!on) {
        const d = SLOT_DEFAULTS[i];
        setSlotFields(i, d.start, d.end, "");
      }
    }
    show($("addSlotBtn"), n < MAX_SLOTS);
  }

  function parseTimingsToSlots(raw) {
    const s = String(raw || "");
    const re = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi;
    const found = [];
    let m;
    while ((m = re.exec(s)) && found.length < MAX_SLOTS * 2) {
      let h = parseInt(m[1], 10) % 12;
      if (/pm/i.test(m[3])) h += 12;
      const min = m[2] ? parseInt(m[2], 10) : 0;
      found.push(pad2(h) + ":" + pad2(min));
    }
    const slots = [];
    for (let i = 0; i + 1 < found.length && slots.length < MAX_SLOTS; i += 2) {
      slots.push({ label: "", start: found[i], end: found[i + 1] });
    }
    return slots;
  }

  function collectSlotsFromForm() {
    const slots = [];
    const count = visibleSlotCount();
    for (let i = 1; i <= count; i++) {
      const slot = getSlotHm(i);
      slots.push({ label: slot.label, start: slot.start, end: slot.end });
    }
    return slots;
  }

  /** Returns the first slot problem as { message, field } so it can be shown inline. */
  function validateSlots(slots) {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const prefix = slotFieldPrefix(i + 1);
      if (!slot.start) {
        return { message: "Set a start time.", field: prefix + "Start" };
      }
      if (!slot.end) {
        return { message: "Set an end time.", field: prefix + "End" };
      }
      if (slot.end <= slot.start) {
        return { message: "End time must be after the start time.", field: prefix + "End" };
      }
    }
    return { message: "", field: "" };
  }

  function slotsToTimings(slots) {
    return slots
      .map(function (s) {
        return formatSlotLine(s);
      })
      .filter(Boolean)
      .join("\n");
  }

  function applySlotsToItem(item, slots) {
    item.starttime = slots[0] ? slots[0].start : "";
    item.endtime = slots[0] ? slots[0].end : "";
    item.slotlabel = slots[0] ? String(slots[0].label || "").trim() : "";
    item.starttime2 = slots[1] ? slots[1].start : "";
    item.endtime2 = slots[1] ? slots[1].end : "";
    item.slotlabel2 = slots[1] ? String(slots[1].label || "").trim() : "";
    item.starttime3 = slots[2] ? slots[2].start : "";
    item.endtime3 = slots[2] ? slots[2].end : "";
    item.slotlabel3 = slots[2] ? String(slots[2].label || "").trim() : "";
    item.timings = slotsToTimings(slots);
    return item;
  }

  function loadSlotsIntoForm(item) {
    fillTimeSelects();
    let slots = [];
    if (item && item.slots && item.slots.length) {
      slots = item.slots.map(function (s) {
        return {
          label: s.label || "",
          start: s.start || "",
          end: s.end || "",
        };
      });
    } else if (item) {
      if (item.starttime || item.endtime) {
        slots.push({
          label: item.slotlabel || "",
          start: item.starttime || "",
          end: item.endtime || "",
        });
      }
      if (item.starttime2 || item.endtime2) {
        slots.push({
          label: item.slotlabel2 || "",
          start: item.starttime2 || "",
          end: item.endtime2 || "",
        });
      }
      if (item.starttime3 || item.endtime3) {
        slots.push({
          label: item.slotlabel3 || "",
          start: item.starttime3 || "",
          end: item.endtime3 || "",
        });
      }
      if (!slots.length && item.timings) slots = parseTimingsToSlots(item.timings);
    }
    if (!slots.length) slots = [{ label: "", start: "06:00", end: "09:00" }];
    const count = Math.min(MAX_SLOTS, Math.max(1, slots.length));
    setVisibleSlotCount(count);
    for (let i = 0; i < count; i++) {
      setSlotFields(i + 1, slots[i].start, slots[i].end, slots[i].label || "");
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
              return formatSlotLine(s);
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
    titleSelectSilent = true;
    populateTitleProgramSelect(defaults.title, true);
    resetFlyerPicker();
    loadFlyerGalleryForTitle(defaults.title);
    $("fDescription").value = defaults.description;
    $("fStartDate").value = ymd;
    $("fEndDate").value = ymd;
    $("fLocation").value = defaults.location || DEFAULT_LOCATION;
    setVisibleSlotCount(1);
    setSlotFields(1, "18:00", "18:45", "");
    $("fRegister").value = defaults.registerlink || "";
    setNoRegister(!String(defaults.registerlink || "").trim());
    setFreeOfferingChecked(true);
    $("fImageUrl").value = defaults.image || "";
    $("fImageFile").value = "";
    pendingImage = null;
    setListingImagePreview(defaults.image);
    setImageFileLabel(defaults.image ? "Replace " + photoWord() : "");
    setFrequencySelect(defaults.frequency);
    $("fLanguage").value = "English";
    $("fStatus").value = currentResource === "programs" ? "Open" : "active";
    clearFieldErrors();
    setTemplateActive("sannidhi");
    $("templateHint").textContent =
      "Filled for " + dateLabel + ", 6:00 PM – 6:45 PM. Edit anything below, or tap the card again to clear.";
  }

  /** Empties the single-event fields without touching the editor mode or overlay. */
  function resetSingleFields() {
    titleSelectSilent = false;
    $("fTitle").value = "";
    if ($("fTitleProgram")) $("fTitleProgram").value = "";
    resetFlyerPicker();
    $("fDescription").value = "";
    $("fStartDate").value = "";
    $("fEndDate").value = "";
    loadSlotsIntoForm(null);
    $("fLocation").value = DEFAULT_LOCATION;
    setFrequencySelect("");
    $("fLanguage").value = "";
    $("fRegister").value = "";
    setNoRegister(false);
    setFreeOfferingChecked(false);
    $("fImageUrl").value = "";
    $("fImageFile").value = "";
    pendingImage = null;
    setListingImagePreview("");
    setImageFileLabel("");
    setImageUrlOpen(false);
    if ($("fVolunteerAvailable")) $("fVolunteerAvailable").checked = false;
    if ($("fVolunteersNeeded")) $("fVolunteersNeeded").value = "";
    syncVolunteerNeededField();
    clearFieldErrors();
  }

  /** `keepProgramTitle`: don't wipe the Program name select — used when the
   * user just picked a different program, which is what triggered the clear. */
  function clearTemplateFill(keepProgramTitle) {
    const savedTitle = keepProgramTitle && $("fTitleProgram") ? $("fTitleProgram").value : "";
    resetSingleFields();
    if (keepProgramTitle && $("fTitleProgram")) $("fTitleProgram").value = savedTitle;
    setTemplateActive("");
    $("templateHint").textContent = templateIdleHint();
    const body = $("editorBody");
    if (body) body.scrollTop = 0;
  }

  function templateIdleHint() {
    return currentResource === "programs"
      ? "Fills the title, description, location and timings for you."
      : "";
  }

  function resourceLabel() {
    return currentResource === "programs" ? "program" : "opportunity";
  }

  function photoWord() {
    return currentResource === "programs" ? "flyer" : "photo";
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

  /** Programs list avatar: the attached flyer/photo when there is one, else the title's initial.
   * Tapping an image avatar expands it full-size (data-avatar-preview, handled in the itemList
   * click listener) — a bare-letter avatar has nothing to expand, so it stays inert. */
  function listingAvatarHtml(item) {
    const raw = item && (item.image || item.flyer_image);
    const img = raw ? fixDriveUrl(raw) : "";
    if (img) {
      return (
        '<span class="inquiry-avatar has-image" role="button" tabindex="0" aria-label="View flyer" data-avatar-preview="' +
        escapeHtml(img) +
        '">' +
        '<img src="' + escapeHtml(img) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"/>' +
        "</span>"
      );
    }
    return '<span class="inquiry-avatar" aria-hidden="true">' + escapeHtml(listingInitial(item)) + "</span>";
  }

  function openAvatarPreview(url) {
    if (!url) return;
    const img = $("avatarPreviewImg");
    const overlay = $("avatarPreviewOverlay");
    if (!img || !overlay) return;
    img.src = url;
    overlay.classList.add("open");
  }

  function closeAvatarPreview() {
    const overlay = $("avatarPreviewOverlay");
    if (overlay) overlay.classList.remove("open");
    const img = $("avatarPreviewImg");
    if (img) img.src = "";
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
    const volunteersOn =
      currentResource === "programs" &&
      isVolunteerAvailableValue(item.volunteering_available || item.volunteeringavailable);
    const volunteersNeeded = Number(item.volunteers_needed || item.volunteersneeded || 0);
    const volunteersAdded = Number(item.volunteers_added) || 0;
    return (
      '<article class="inquiry-card event-card' +
      (open ? "" : " is-resolved") +
      '" data-id="' +
      escapeHtml(item.id) +
      '">' +
      '<div class="event-card-head">' +
      listingAvatarHtml(item) +
      '<strong class="event-card-title">' +
      escapeHtml(title) +
      "</strong>" +
      '<span class="event-card-badges">' +
      '<span class="inquiry-badge' + (open ? "" : " is-closed") + '">' +
      escapeHtml(open ? "Open" : "Closed") +
      "</span>" +
      (volunteersOn
        ? '<span class="inquiry-badge inquiry-badge-soft">Volunteers</span>'
        : "") +
      "</span>" +
      "</div>" +
      (meta
        ? '<div class="event-time-row"><svg class="event-time-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>' +
          escapeHtml(meta) +
          "</span></div>"
        : "") +
      (volunteersOn && volunteersNeeded > 0
        ? '<div class="event-vol-row"><svg class="event-vol-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>' +
          escapeHtml(volunteersAdded + " of " + volunteersNeeded + " volunteers") +
          "</span></div>"
        : "") +
      '<div class="inquiry-quick-actions">' +
      '<button type="button" class="inquiry-action inquiry-action-wa" data-edit="' +
      escapeHtml(item.id) +
      '">Edit</button>' +
      '<button type="button" class="inquiry-action inquiry-action-resolve event-action-delete" data-delete="' +
      escapeHtml(item.id) +
      '">Delete</button>' +
      "</div>" +
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
    if (oppActive()) {
      oppRender();
      return;
    }
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
    delete listingPrefetch[currentResource];
    setPageBusy(true);
    // "Add program"/"Add volunteering" opens an editor that expects the
    // resource list (for duplicate-title checks etc.) — keep it disabled,
    // not just visually busy, so a click during the fetch can't no-op.
    if ($("addItemBtn")) $("addItemBtn").disabled = true;
    if ($("oppAddBtn")) $("oppAddBtn").disabled = true;
    setStatus("");
    const resource = currentResource;
    const cached = readCached(resource);
    if (cached && cached.items) {
      // Last visit's list straight away; the fresh one replaces it below.
      items = cached.items;
      listLoadedFor = resource;
      renderList();
    } else {
      (oppActive() ? $("oppCards") : $("itemList")).innerHTML =
        '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading…</div>';
    }
    try {
      const data = await apiGet(resource, true);
      if (currentResource !== resource) return;
      if (data.error && /Unauthorized/i.test(data.error)) {
        logout();
        loginError(data.error);
        return;
      }
      if (data.error) throw new Error(data.error);
      items = data.items || [];
      listLoadedFor = currentResource;
      renderList();
    } catch (err) {
      if (!(cached && cached.items)) {
        items = [];
        renderList();
      }
      setStatus(err.message, true);
    } finally {
      setPageBusy(false);
      if ($("addItemBtn")) $("addItemBtn").disabled = false;
      if ($("oppAddBtn")) $("oppAddBtn").disabled = false;
    }
  }

  // Enquiries page merges these four public-facing query types into one
  // list; volunteer attendance sign-ins are a separate self-check-in flow
  // and live under Volunteering instead (see openVolAttendance).
  const QUERY_GROUP_KEYS = ["homeQueries", "programInterest", "programVolunteer", "volunteeringInterest"];
  const ATTENDANCE_GROUP_KEY = "volunteerAttendance";
  let inquiryGroups = [];
  let inquiryFilter = "open";
  let inquiryScope = "queries"; // "queries" (merged 4) | "attendance" (volunteerAttendance only)
  let inquiryShowLimit = 12;
  let inquirySearchQuery = "";
  let inquiryTypeFilter = ""; // "" = all types, else a group key

  function resetInquirySearch() {
    inquirySearchQuery = "";
    inquiryTypeFilter = "";
    if ($("inquirySearchInput")) $("inquirySearchInput").value = "";
    show($("inquirySearchClear"), false);
  }
  let queryWatchTimer = 0;
  let queryWatchBusy = false;
  let promoWatchTimer = 0;
  let promoWatchBusy = false;

  function setTab(resource) {
    if (resource === "inquiries") {
      openAdminPage("queries");
      return;
    }
    currentResource = resource === "volunteering" ? "volunteering" : "programs";
    show($("listingsPanel"), true);
    show($("inquiriesPanel"), false);
    if ($("addItemBtn")) {
      $("addItemBtn").classList.remove("hidden");
      $("addItemBtn").textContent = currentResource === "volunteering" ? "Add volunteering" : "Add program";
      $("addItemBtn").dataset.idleLabel = $("addItemBtn").textContent;
    }

    const isVol = currentResource === "volunteering";
    show($("volunteerViewNav"), isVol);
    if ($("volunteerPushBtn")) $("volunteerPushBtn").classList.toggle("hidden", !isVol);

    if (isVol) {
      updateVolunteerPushBtn();
      applyVolunteerView();
      return;
    }
    show($("itemList"), true);
    show($("eventsStatusFilters"), true);
    show($("volunteerNeedsList"), false);
    loadList();
    loadProgramTitles();
  }

  function isVolunteerAvailableValue(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase();
    return s === "yes" || s === "true" || s === "1" || s === "y";
  }

  /* ============================================================
     Event-volunteer pipeline (Nurturing): a program's "volunteers
     needed" flows here, Nurturing handles it, recruits people,
     marks attendance after the event, and adds attendees to a
     WhatsApp group via the narrow Sandesha bridge (window.VjnVol).
     ============================================================ */

  const VOLUNTEER_VIEW_KEY = "vjn_volunteer_view";
  let volunteerView = (function () {
    try {
      const saved = localStorage.getItem(VOLUNTEER_VIEW_KEY);
      return saved === "needs" ? "needs" : "opportunities";
    } catch (e) {
      return "opportunities";
    }
  })();
  let volunteerNeeds = [];
  let volunteerNeedsLoading = false;
  let vnHandleEventId = "";
  let hubAttendanceQueue = [];
  let hubAttendanceIndex = 0;
  /** Items X'd out of the full-screen alert without being handled — parked
   * here as a notification stack instead of nagging with the overlay again
   * on every hub visit this session. */
  let dismissedHubAlerts = [];
  // Programs still short of volunteers — shown as the first Needs attention card.
  let hubNeedsUnmet = 0;
  const HUB_ALERT_DISMISSED_KEY = "vjn_hub_alert_dismissed";

  /** The parked ids survive reloads, so the overlay only pops up for a
   * program the first time it needs attendance, not on every visit. */
  function loadDismissedHubAlertIds() {
    try {
      const ids = JSON.parse(localStorage.getItem(HUB_ALERT_DISMISSED_KEY) || "[]");
      return Array.isArray(ids) ? ids.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function saveDismissedHubAlertIds() {
    try {
      localStorage.setItem(
        HUB_ALERT_DISMISSED_KEY,
        JSON.stringify(dismissedHubAlerts.map(function (it) { return String(it.id); }))
      );
    } catch (e) {}
  }

  /** Closed, handled programs with at least one volunteer whose attendance
   * is still blank — the ones the hub alert nags Nurturing about. */
  function attendanceAlertItems() {
    return volunteerNeeds.filter(function (it) {
      const vols = it.volunteers || [];
      return !it.open && it.handled && vols.length > 0 && vols.some(function (v) {
        return v.attended === "";
      });
    });
  }

  function openHubAlertOverlay() {
    const overlay = $("hubAlertOverlay");
    if (overlay) overlay.classList.add("open");
  }

  function closeHubAlertOverlay() {
    const overlay = $("hubAlertOverlay");
    if (overlay) overlay.classList.remove("open");
  }

  function renderHubAlert(item) {
    show($("hubAlertSpinner"), false);
    const eyebrowText = $("hubAlertEyebrowText");
    if (eyebrowText) eyebrowText.textContent = "Needs attendance";
    show($("hubAlertActions"), true);
    const total = hubAttendanceQueue.length;
    const titleEl = $("hubAlertTitle");
    if (titleEl) titleEl.textContent = item.title || "(Untitled)";
    const vols = item.volunteers || [];
    const marked = vols.filter(function (v) {
      return v.attended === "yes" || v.attended === "no";
    }).length;
    const dateLabel = listingDateLabel(item);
    const subEl = $("hubAlertSub");
    if (subEl) {
      subEl.textContent = (dateLabel ? dateLabel + " · " : "") + "Mark attendance";
    }
    const pct = vols.length ? Math.round((marked / vols.length) * 100) : 0;
    if ($("hubAlertRingVal")) $("hubAlertRingVal").setAttribute("stroke-dasharray", pct + " 100");
    if ($("hubAlertRingText")) $("hubAlertRingText").textContent = marked + "/" + vols.length;
    const steps = $("hubAlertSteps");
    if (steps) {
      let dots = "";
      for (let i = 0; i < total && total > 1; i++) {
        dots += '<i class="' + (i < hubAttendanceIndex ? "is-done" : i === hubAttendanceIndex ? "is-on" : "") + '"></i>';
      }
      steps.innerHTML = dots;
    }
    const progress = $("hubAlertProgress");
    if (progress) {
      if (total > 1) {
        progress.textContent = (hubAttendanceIndex + 1) + " of " + total + " programs need attendance marked.";
        show(progress, true);
      } else {
        show(progress, false);
      }
    }
  }

  /** Shows the current queue item, or closes the overlay once the queue is spent. */
  function showCurrentHubAlert() {
    if (hubAttendanceIndex >= hubAttendanceQueue.length) {
      closeHubAlertOverlay();
      return;
    }
    renderHubAlert(hubAttendanceQueue[hubAttendanceIndex]);
    openHubAlertOverlay();
  }

  /** Called after landing on the hub — not on every background stats refresh,
   * so the dialog doesn't reappear over and over while the user is on the hub. */
  function maybeShowHubAttendanceAlerts() {
    if (role() !== "nurturing") return;
    const app = $("adminApp");
    if (!app || !app.classList.contains("is-hub")) return;
    const pending = attendanceAlertItems();
    // Anything already parked in the notification stack (this visit or an
    // earlier one) stays there quietly instead of popping the overlay again.
    const parkedIds = dismissedHubAlerts
      .map(function (it) { return String(it.id); })
      .concat(loadDismissedHubAlertIds());
    const stacked = {};
    parkedIds.forEach(function (id) {
      stacked[id] = true;
    });
    hubAttendanceQueue = pending.filter(function (it) {
      return !stacked[String(it.id)];
    });
    hubAttendanceIndex = 0;
    // Rebuild the stack from what still needs attendance, so entries handled
    // some other way (e.g. from the Program volunteers view) drop out.
    dismissedHubAlerts = pending.filter(function (it) {
      return stacked[String(it.id)];
    });
    // An empty list may just be a failed fetch — don't wipe the saved ids over it.
    if (pending.length) saveDismissedHubAlertIds();
    renderHubAlertStack();
    showCurrentHubAlert();
  }

  /** Fetches just what the alert needs, independent of loadHubStats()'s
   * Promise.all over every other card — so the dialog can show as soon as
   * this one call is back, instead of behind the slowest of the group.
   * Nothing is shown while it loads; the overlay only opens if something urgent turns up. */
  async function checkHubAttendanceAlertsNow() {
    if (role() !== "nurturing") return;
    showHubAlertStackLoading();
    try {
      const data = await apiGet("volunteerNeeds", true);
      if (!data.error) volunteerNeeds = data.items || [];
    } catch (e) {}
    maybeShowHubAttendanceAlerts();
    // maybeShow bails out early off the hub; never leave the placeholder up.
    renderHubAlertStack();
  }

  /** X button — parks this program in the notification stack instead of just
   * losing it, then the next queued one takes its place. */
  function dismissCurrentHubAlert() {
    const item = hubAttendanceQueue[hubAttendanceIndex];
    if (item) addToHubAlertStack(item);
    hubAttendanceIndex += 1;
    showCurrentHubAlert();
  }

  /* ── Notification stack for dismissed-but-unhandled attendance alerts ──── */

  function addToHubAlertStack(item) {
    if (!item) return;
    const already = dismissedHubAlerts.some(function (it) {
      return String(it.id) === String(item.id);
    });
    if (!already) dismissedHubAlerts.push(item);
    saveDismissedHubAlertIds();
    renderHubAlertStack();
  }

  function removeFromHubAlertStack(id) {
    dismissedHubAlerts = dismissedHubAlerts.filter(function (it) {
      return String(it.id) !== String(id);
    });
    saveDismissedHubAlertIds();
    renderHubAlertStack();
  }

  /** One notification in the iOS-style stack: app-icon tile, small app
   * label + time on top, bold title, one body line. */
  function hubStackNoticeHtml(opts) {
    return (
      '<div class="hub-alert-stack-card' + (opts.cls ? " " + opts.cls : "") + '"' + (opts.attrs || "") + ">" +
      '<button type="button" class="hub-alert-stack-body" ' + opts.open + ">" +
      '<span class="hub-alert-stack-icon" aria-hidden="true">' + opts.icon + "</span>" +
      '<span class="hub-alert-stack-text">' +
      '<span class="hub-alert-stack-head">' +
      '<span class="hub-alert-stack-app">' + escapeHtml(opts.app) + "</span>" +
      (opts.meta ? '<span class="hub-alert-stack-meta">' + escapeHtml(opts.meta) + "</span>" : "") +
      "</span>" +
      '<strong class="hub-alert-stack-title">' + escapeHtml(opts.title) + "</strong>" +
      '<span class="hub-alert-stack-sub">' + escapeHtml(opts.sub) + "</span>" +
      "</span>" +
      "</button>" +
      (opts.dismissId != null
        ? '<button type="button" class="hub-alert-stack-dismiss" data-stack-dismiss="' +
          escapeHtml(opts.dismissId) +
          '" aria-label="Remove from list">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
          "</button>"
        : "") +
      "</div>"
    );
  }

  function hubAlertStackCardHtml(item) {
    const vols = item.volunteers || [];
    const marked = vols.filter(function (v) {
      return v.attended === "yes" || v.attended === "no";
    }).length;
    const pct = vols.length ? Math.round((marked / vols.length) * 100) : 0;
    return hubStackNoticeHtml({
      attrs: ' data-stack-id="' + escapeHtml(item.id) + '"',
      open: 'data-stack-open="' + escapeHtml(item.id) + '"',
      icon:
        '<span class="hub-alert-stack-ring">' +
        '<svg viewBox="0 0 36 36"><circle class="trk" cx="18" cy="18" r="14"/>' +
        (pct ? '<circle class="val" cx="18" cy="18" r="14" pathLength="100" stroke-dasharray="' + pct + ' 100"/>' : "") +
        "</svg>" +
        "<b>" + marked + "/" + vols.length + "</b></span>",
      app: "Attendance",
      meta: listingDateLabel(item),
      title: item.title || "(Untitled)",
      sub: "Mark attendance · " + marked + " of " + vols.length + " marked",
      dismissId: item.id,
    });
  }

  function hubNeedsStackCardHtml(unmet) {
    return hubStackNoticeHtml({
      cls: "hub-alert-stack-card--needs",
      open: "data-stack-needs",
      icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      app: "Volunteering",
      meta: "",
      title: "Volunteers needed",
      sub: unmet === 1 ? "1 program still needs volunteers" : unmet + " programs still need volunteers",
    });
  }

  /** Volunteers-needed card first, then most-recently-dismissed first, so it sits at the front of the peeked stack. */
  function renderHubAlertStack() {
    const host = $("hubAlertStack");
    if (!host) return;
    const wasLoading = host.classList.contains("is-loading");
    host.classList.remove("is-loading");
    $("hubAlertStackToggle").disabled = false;
    const total = dismissedHubAlerts.length + (hubNeedsUnmet > 0 ? 1 : 0);
    if (!total) {
      host.hidden = true;
      host.classList.remove("is-collapsed");
      $("hubAlertStackCards").innerHTML = "";
      return;
    }
    host.hidden = false;
    // Arrive folded (top task + peeking edges) when there's more than one.
    if (wasLoading && total > 1) host.classList.add("is-collapsed");
    $("hubAlertStackToggle").setAttribute("aria-expanded", String(!host.classList.contains("is-collapsed")));
    if ($("hubAlertStackToggleLabel")) {
      $("hubAlertStackToggleLabel").innerHTML =
        'Needs attention <span class="hub-alert-stack-count">' + total + "</span>";
    }
    $("hubAlertStackCards").innerHTML =
      (hubNeedsUnmet > 0 ? hubNeedsStackCardHtml(hubNeedsUnmet) : "") +
      dismissedHubAlerts
        .slice()
        .reverse()
        .map(hubAlertStackCardHtml)
        .join("");
  }

  function setHubAlertStackCollapsed(collapsed) {
    const host = $("hubAlertStack");
    if (!host) return;
    host.classList.toggle("is-collapsed", collapsed);
    $("hubAlertStackToggle").setAttribute("aria-expanded", String(!collapsed));
  }

  /** Placeholder in the urgent tasks section while the check is in flight. */
  function showHubAlertStackLoading() {
    const host = $("hubAlertStack");
    if (!host) return;
    host.hidden = false;
    host.classList.remove("is-collapsed");
    host.classList.add("is-loading");
    $("hubAlertStackToggle").disabled = true;
    if ($("hubAlertStackToggleLabel")) $("hubAlertStackToggleLabel").textContent = "Checking urgent tasks";
    $("hubAlertStackCards").innerHTML =
      '<div class="hub-alert-stack-card hub-alert-stack-skel" aria-hidden="true">' +
      '<span class="hub-alert-stack-skel-line is-short"></span>' +
      '<span class="hub-alert-stack-skel-line"></span>' +
      '<span class="hub-alert-stack-skel-line is-mid"></span>' +
      "</div>";
  }

  function openHubAlertStackItem(id) {
    const item = dismissedHubAlerts.find(function (it) {
      return String(it.id) === String(id);
    });
    removeFromHubAlertStack(id);
    if (!item) return;
    openAdminPage("volunteering", true);
    openVolAttendanceMark(item.id, true);
  }

  /** "Mark attendance" — leaves the hub for that program's roster. */
  function addressCurrentHubAlert() {
    const item = hubAttendanceQueue[hubAttendanceIndex];
    closeHubAlertOverlay();
    if (!item) return;
    // openVolProgramDetail assumes the workspace shell is already active
    // (that's true for every other caller — a click from inside the
    // volunteering view, or a popstate back into it); jumping here straight
    // from the hub needs that same transition run first.
    openAdminPage("volunteering", true);
    openVolAttendanceMark(item.id, true);
  }

  function digitsLookLikePhone(raw) {
    const d = String(raw || "").replace(/\D/g, "");
    if (d.length < 10 || d.length > 13) return "";
    if (d.charAt(0) === "1" && d.length !== 11) return "";
    return d;
  }

  /** Stricter than digitsLookLikePhone: exactly 10 digits, valid Indian
      mobile prefix — for forms where the number is typed fresh (not
      pasted from varied historical formats). */
  function strictIndianMobile(raw) {
    const d = String(raw || "").replace(/\D/g, "");
    return /^[6-9]\d{9}$/.test(d) ? d : "";
  }

  function applyVolunteerView() {
    document.querySelectorAll("[data-volunteer-view]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-volunteer-view") === volunteerView);
    });
    const showNeeds = volunteerView === "needs";
    show($("itemList"), !showNeeds);
    show($("eventsStatusFilters"), !showNeeds);
    show($("volunteerNeedsList"), showNeeds);
    if ($("addItemBtn")) $("addItemBtn").classList.toggle("hidden", showNeeds);
    if (showNeeds) loadVolunteerNeeds();
    else loadList();
  }

  function setVolunteerView(view) {
    volunteerView = view === "needs" ? "needs" : "opportunities";
    try {
      localStorage.setItem(VOLUNTEER_VIEW_KEY, volunteerView);
    } catch (e) {}
    applyVolunteerView();
  }

  async function loadVolunteerNeeds() {
    const host = $("volunteerNeedsList");
    if (!host) return;
    const cached = readCached("volunteerNeeds");
    if (cached && cached.items) {
      volunteerNeeds = cached.items;
      renderVolunteerNeeds();
    } else if (!volunteerNeedsLoading) {
      host.innerHTML = '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading…</div>';
    }
    volunteerNeedsLoading = true;
    try {
      const data = await apiGet("volunteerNeeds", true);
      if (data.error) throw new Error(data.error);
      volunteerNeeds = data.items || [];
      setHubStat("volunteer-needs", (data.counts && data.counts.unmet) || 0);
      renderVolunteerNeeds();
    } catch (err) {
      if (!(cached && cached.items)) {
        host.innerHTML = '<div class="admin-empty">' + escapeHtml(err.message || "Could not load volunteer needs.") + "</div>";
      }
    } finally {
      volunteerNeedsLoading = false;
    }
  }

  function vnFindItem(id) {
    return volunteerNeeds.find(function (it) {
      return String(it.id) === String(id);
    });
  }

  function vnFindVolunteer(rowId) {
    for (let i = 0; i < volunteerNeeds.length; i++) {
      const vols = volunteerNeeds[i].volunteers || [];
      for (let j = 0; j < vols.length; j++) {
        if (String(vols[j].rowId) === String(rowId)) return vols[j];
      }
    }
    return null;
  }

  /** Roster row on the requirements detail page. Attendance itself is
   * marked on the Attendance marking page; here it is only shown. */
  function vpdRowHtml(item, v, index) {
    const at = v.attended || "";
    const closed = !item.open;
    const rid = escapeHtml(v.rowId);
    const digits = String(v.phone || "").replace(/\D/g, "").slice(-10);
    const waUrl = waMeUrl(digits);
    const phone = formatInquiryPhone(v.phone || "");
    // Collapsed: who + where. Everything else waits behind a tap.
    const details =
      (phone ? '<span class="vpr-detail"><b>WhatsApp</b> ' + escapeHtml(phone) + "</span>" : "") +
      (v.ieCompletion ? '<span class="vpr-detail"><b>IE completed</b> ' + escapeHtml(v.ieCompletion) + "</span>" : "") +
      (v.addedBy ? '<span class="vpr-detail"><b>Added by</b> ' + escapeHtml(v.addedBy === "google-form" ? "Google form" : v.addedBy) + "</span>" : "") +
      (v.remarks ? volunteerRemarksHtml(v.remarks, "vpr-remarks") : "") +
      (closed
        ? '<span class="vpr-chips">' +
          '<button type="button" class="vn-chip ' + (v.inGroup ? "is-on" : "") + '" data-vn-flag="' + rid + '" data-field="inGroup">In WA group</button>' +
          '<button type="button" class="vn-chip ' + (v.inviteSent ? "is-on" : "") + '" data-vn-flag="' + rid + '" data-field="inviteSent">Invite sent</button>' +
          "</span>"
        : "");
    return (
      '<div class="vpr-row" data-vpr-row>' +
      '<span class="inquiry-avatar" aria-hidden="true" style="background:' +
      AVATAR_COLORS_[index % AVATAR_COLORS_.length] + '">' + escapeHtml((v.name || "?").trim().charAt(0).toUpperCase()) + "</span>" +
      '<span class="vpr-main">' +
      '<span class="vpr-top" data-vpr-toggle role="button" tabindex="0" aria-expanded="false">' +
      '<span class="vpr-head"><span class="vpr-name">' + escapeHtml(v.name || "(No name)") + "</span>" +
      ((v.area || closed)
        ? '<span class="vpr-sub">' + escapeHtml(v.area || "") +
          (closed
            ? '<span class="vat-tag' + (at === "yes" ? "" : at === "no" ? " is-no" : " is-idle") + '">' +
              (at === "yes" ? "Present" : at === "no" ? "Absent" : "Not marked") + "</span>"
            : "") +
          "</span>"
        : "") +
      "</span>" +
      (digits
        ? '<a class="vpr-wa vpr-call" href="tel:+91' + digits + '" aria-label="Call ' + escapeHtml(v.name || "volunteer") + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg></a>'
        : "") +
      (waUrl
        ? '<a class="vpr-wa" href="' + escapeHtml(waUrl) + '" target="_blank" rel="noopener noreferrer" aria-label="Message ' +
          escapeHtml(v.name || "volunteer") + ' on WhatsApp">' + waIconSvg() + "</a>"
        : "") +
      (details ? '<svg class="vpr-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' : "") +
      "</span>" +
      (details ? '<span class="vpr-body" hidden>' + details + "</span>" : "") +
      "</span></div>"
    );
  }

  function vprToggleRow(toggle) {
    const row = toggle.closest("[data-vpr-row]");
    const body = row && row.querySelector(".vpr-body");
    if (!body) return;
    const open = body.hidden;
    body.hidden = !open;
    row.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  }

  function vnVolunteerRowHtml(item, v) {
    const attended = v.attended || "";
    const showAttendance = !item.open;
    return (
      '<div class="vn-vol-row" data-vn-vol="' + escapeHtml(v.rowId) + '">' +
      '<div class="vn-vol-main">' +
      '<div class="vn-vol-name">' + escapeHtml(v.name || "(No name)") + "</div>" +
      '<div class="vn-vol-phone">' + escapeHtml(v.phone || "") + "</div>" +
      (v.remarks ? '<div class="vn-vol-remarks">' + escapeHtml(v.remarks) + "</div>" : "") +
      "</div>" +
      '<div class="vn-vol-flags">' +
      (showAttendance
        ? '<button type="button" class="vn-chip ' + (attended === "yes" ? "is-on" : "") +
          '" data-vn-attend="' + escapeHtml(v.rowId) + '" data-val="yes">Attended</button>' +
          '<button type="button" class="vn-chip ' + (attended === "no" ? "is-off attend-no" : "") +
          '" data-vn-attend="' + escapeHtml(v.rowId) + '" data-val="no">No-show</button>' +
          '<button type="button" class="vn-chip ' + (v.inGroup ? "is-on" : "") +
          '" data-vn-flag="' + escapeHtml(v.rowId) + '" data-field="inGroup">In WA group</button>' +
          '<button type="button" class="vn-chip ' + (v.inviteSent ? "is-on" : "") +
          '" data-vn-flag="' + escapeHtml(v.rowId) + '" data-field="inviteSent">Invite sent</button>'
        : "") +
      "</div></div>"
    );
  }

  function vnCardHtml(item) {
    const dateLabel = listingDateLabel(item);
    const needed = item.needed || 0;
    const added = item.addedCount || 0;
    const pct = needed > 0 ? Math.min(100, Math.round((added / needed) * 100)) : added > 0 ? 100 : 0;
    const enough = needed > 0 && added >= needed;
    const progressLine =
      added + " of " + needed + " volunteer" + (needed === 1 ? "" : "s") +
      (enough ? " · enough" : needed > added ? " · " + (needed - added) + " more needed" : "");
    const vols = item.volunteers || [];
    const canGroup = item.handled && vols.length > 0 && item.allAttendanceDone;

    return (
      '<article class="vn-card' + (item.open ? "" : " is-closed") + '" data-vn-id="' + escapeHtml(item.id) + '">' +
      '<div class="vn-head">' +
      '<div><div class="vn-title">' + escapeHtml(item.title || "(Untitled)") + "</div>" +
      '<div class="vn-meta">' + escapeHtml(dateLabel) + "</div></div>" +
      '<span class="inquiry-badge' + (item.open ? "" : " inquiry-badge-soft") + '">' + (item.open ? "Open" : "Closed") + "</span>" +
      "</div>" +
      '<div class="vn-progress-wrap">' +
      '<div class="vn-progress-line">' + escapeHtml(progressLine) + "</div>" +
      '<div class="vn-progress"><div class="vn-progress-fill' + (enough ? " is-full" : "") + '" style="width:' + pct + '%"></div></div>' +
      "</div>" +
      (item.requirements
        ? '<div class="vn-requirements">Requirements: ' + escapeHtml(item.requirements) + "</div>"
        : "") +
      (item.handled
        ? '<div class="vn-handled-strip">Handled' + (item.handledBy ? " by " + escapeHtml(item.handledBy) : "") +
          (item.handledRemarks ? ' · "' + escapeHtml(item.handledRemarks) + '"' : "") + "</div>"
        : '<div class="vn-actions"><button type="button" class="btn btn-outline vn-btn-sm" data-vn-handle="' +
          escapeHtml(item.id) + '">Mark handled</button></div>') +
      (item.handled
        ? '<div class="vn-roster">' +
          vols.map(function (v) { return vnVolunteerRowHtml(item, v); }).join("") +
          '<div class="vn-add-form">' +
          '<input type="text" placeholder="Volunteer name" data-vn-add-name/>' +
          '<input type="tel" placeholder="Phone" data-vn-add-phone/>' +
          '<input type="text" class="vn-add-remarks" placeholder="Remarks (optional)" data-vn-add-remarks/>' +
          '<button type="button" class="btn btn-outline vn-btn-sm vn-add-btn" data-vn-add-save="' + escapeHtml(item.id) + '">Add volunteer</button>' +
          "</div>" +
          (canGroup
            ? '<button type="button" class="btn btn-gold vn-btn-sm" data-vn-group="' + escapeHtml(item.id) +
              '">Add attendees to a volunteering group</button>'
            : "") +
          "</div>"
        : "") +
      "</article>"
    );
  }

  function renderVolunteerNeeds() {
    const host = $("volunteerNeedsList");
    if (!host) return;
    if (!volunteerNeeds.length) {
      host.innerHTML = '<div class="admin-empty">No programs are asking for volunteers right now.</div>';
      return;
    }
    // Nurturing: compact clickable cards → detail page
    const mapper = role() === "nurturing" ? vnCompactCardHtml : vnCardHtml;
    host.innerHTML = volunteerNeeds.map(mapper).join("");
  }

  /* ── Compact card (Nurturing need list) ─────────────────────────────── */

  function vnCompactCardHtml(item) {
    const dateLabel = listingDateLabel(item);
    const needed = item.needed || 0;
    const added = item.addedCount || 0;
    const enough = needed > 0 && added >= needed;
    const progressLine = added + " of " + needed + (enough ? " · full" : needed > added ? " · " + (needed - added) + " more needed" : "");
    const vols = item.volunteers || [];
    // For closed cards, show volunteer names as a brief list
    const closedNames = !item.open && vols.length > 0
      ? '<div class="vnc-names">' + vols.map(function (v) { return escapeHtml(v.name || "—"); }).join(" · ") + "</div>"
      : "";
    const handledPip = item.handled
      ? '<span class="vnc-handled">Handled</span>'
      : "";
    return (
      '<button type="button" class="vnc-card' + (item.open ? "" : " is-closed") + '" data-vnc-id="' + escapeHtml(item.id) + '">' +
      '<div class="vnc-top">' +
      '<div class="vnc-info">' +
      '<div class="vnc-title">' + escapeHtml(item.title || "(Untitled)") + "</div>" +
      '<div class="vnc-meta">' + escapeHtml(dateLabel) + " · " + escapeHtml(progressLine) + "</div>" +
      "</div>" +
      '<div class="vnc-right">' +
      '<span class="inquiry-badge' + (item.open ? "" : " inquiry-badge-soft") + '">' + (item.open ? "Open" : "Closed") + "</span>" +
      handledPip +
      "</div>" +
      "</div>" +
      closedNames +
      "</button>"
    );
  }

  /* ── Volunteering sub-navigation (Nurturing) ─────────────────────────── */

  function showOnlyPanel(panelId) {
    ["listingsPanel", "inquiriesPanel", "promotionsPanel", "teamPanel", "programVolunteersPanel",
     "flyerTemplatesPanel", "settingsPanel", "programTitlesPanel", "sandeshaActivityPanel", "generateFlyerPanel", "bannerPanel", "volRosterPanel", "volChooserPanel", "volProgramDetailPanel", "volAttendancePanel", "volNeedsPanel", "volOppsPanel"].forEach(function (id) {
      show($(id), id === panelId);
    });
    show($("backToHubBtn"), role() !== "promotions");
    if ($("addItemBtn")) $("addItemBtn").classList.add("hidden");
  }

  /* ── Opportunities (Nurturing) ─────────────────────────────────────────
   * The volunteering listings, as cards: search, Open / Closed tabs, and
   * Edit / Delete on each. Uses the shared `items` list + editor, so saving,
   * deleting and clearing all refresh through loadList() → renderList(). */

  let oppTab = "open";
  let oppQuery = "";

  function oppActive() {
    const p = $("volOppsPanel");
    return !!p && !p.classList.contains("hidden");
  }

  function oppCardHtml(item) {
    const open = isListingOpen(item);
    const when = vatWhen(item);
    const place = String(item.location || "").trim();
    const CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>';
    const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
    return (
      '<article class="vop-card' + (open ? "" : " is-closed") + '" data-id="' + escapeHtml(item.id) + '">' +
      '<div class="vop-head">' + listingAvatarHtml(item) +
      '<div class="vop-main"><strong class="vop-title">' + escapeHtml(item.title || "(Untitled)") + "</strong>" +
      '<span class="vat-tag' + (open ? "" : " is-idle") + '">' + (open ? "Open" : "Closed") + "</span></div></div>" +
      (when || place
        ? '<div class="vop-meta">' +
          (when ? '<span class="vop-meta-row">' + CAL + "<span>" + escapeHtml(when) + "</span></span>" : "") +
          (place ? '<span class="vop-meta-row">' + PIN + "<span>" + escapeHtml(place) + "</span></span>" : "") +
          "</div>"
        : "") +
      '<div class="vop-actions">' +
      '<button type="button" class="vop-btn" data-edit="' + escapeHtml(item.id) + '">Edit</button>' +
      '<button type="button" class="vop-btn vop-btn--danger" data-delete="' + escapeHtml(item.id) + '">Delete</button>' +
      "</div></article>"
    );
  }

  function oppRender() {
    const q = oppQuery.trim().toLowerCase();
    const searched = items.filter(function (it) {
      if (!q) return true;
      return [it.title, it.location, listingDateLabel(it)].some(function (h) {
        return String(h || "").toLowerCase().indexOf(q) >= 0;
      });
    });
    const open = searched.filter(isListingOpen);
    const closed = searched.filter(function (it) { return !isListingOpen(it); });
    if ($("oppCountOpen")) $("oppCountOpen").textContent = open.length;
    if ($("oppCountClosed")) $("oppCountClosed").textContent = closed.length;
    if ($("oppCountAll")) $("oppCountAll").textContent = searched.length;
    document.querySelectorAll("[data-opp-tab]").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-opp-tab") === oppTab);
    });
    const list = oppTab === "closed" ? closed : oppTab === "all" ? searched : open;
    const clearBar =
      oppTab === "closed" && closed.length && !q
        ? '<div class="event-clear-bar"><button type="button" class="btn btn-outline admin-clear-all" data-clear-closed>Clear all closed</button></div>'
        : "";
    $("oppCards").innerHTML = list.length
      ? clearBar + list.map(oppCardHtml).join("")
      : '<div class="admin-empty">' +
        (q ? "Nothing matches your search." : items.length ? "None in this tab." : "No opportunities yet. Tap Add to publish one.") +
        "</div>";
  }

  function openVolOpportunities(replaceHash) {
    showOnlyPanel("volOppsPanel");
    currentResource = "volunteering";
    oppTab = "open";
    oppQuery = "";
    if ($("oppSearchInput")) $("oppSearchInput").value = "";
    setAdminTitle("Volunteering opportunities", { back: "Back to volunteering" });
    const hash = "#volunteering/opportunities";
    if (replaceHash) history.replaceState(null, "", hash);
    else if (location.hash !== hash) history.pushState(null, "", hash);
    updateVolunteerPushBtn();
    loadList();
  }

  /* ── Volunteer requirements list (Nurturing) ─────────────────────────── */

  let vnlTab = "open";

  function vnlBucket(item) {
    if (!item.open) return "closed";
    const needed = item.needed || 0;
    const added = item.addedCount || 0;
    return needed > 0 && added >= needed ? "filled" : "needs";
  }

  let vnlQuery = "";

  function vnlStartDate(item) {
    const ymd = parseToInputDate(item.startdate || item.date || "");
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  /** "Today" / "Tomorrow" / "In 3 days" for a program that is still open and close by. */
  function vnlSoonLabel(item) {
    if (!item.open) return "";
    const d = vnlStartDate(item);
    if (!d) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((d - today) / 86400000);
    if (days < 0 || days > 7) return "";
    return days === 0 ? "Today" : days === 1 ? "Tomorrow" : "In " + days + " days";
  }

  function vnlCardHtml(item, index) {
    const needed = item.needed || 0;
    const added = item.addedCount || 0;
    const bucket = vnlBucket(item);
    const pct = needed > 0 ? Math.min(100, Math.round((added / needed) * 100)) : added > 0 ? 100 : 0;
    const more = needed - added;
    const d = vnlStartDate(item);
    const dateTile = d
      ? "<span>" + d.toLocaleDateString("en-IN", { month: "short" }) + "</span><b>" + d.getDate() + "</b>"
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>';
    // The date tile carries the day, so the line under the title shows the time only.
    const slotText =
      item.slots && item.slots.length
        ? item.slots.map(formatSlotLine).filter(Boolean).join(", ")
        : String(item.timings || "").split("\n").filter(Boolean).join(", ");
    const when = d
      ? (slotText ? '<span class="vat-when-part">' + VAT_WHEN_CLOCK_ICON + "<span>" + escapeHtml(slotText) + "</span></span>" : "")
      : vatWhenHtml(item);
    const badge =
      bucket === "needs" && more > 0
        ? '<span class="vnl-more">' + more + " more</span>"
        : bucket === "filled"
          ? '<span class="vnl-more is-full">Full</span>'
          : '<span class="vnl-more is-closed">Closed</span>';
    const vols = item.volunteers || [];
    const avatars = vols.length
      ? vols
          .slice(0, 4)
          .map(function (v, i) {
            return '<span class="vnl-av" style="background:' + AVATAR_COLORS_[(index + i) % AVATAR_COLORS_.length] + '">' +
              escapeHtml((v.name || "?").trim().charAt(0).toUpperCase()) + "</span>";
          })
          .join("") + (vols.length > 4 ? '<span class="vnl-av vnl-av--more">+' + (vols.length - 4) + "</span>" : "")
      : '<span class="vnl-empty">No volunteers yet</span>';
    const soon = vnlSoonLabel(item);
    const note = String(item.requirements || "").trim(); // added by the Programs team
    const count =
      bucket === "closed"
        ? "<b>" + added + "</b> volunteer" + (added === 1 ? "" : "s")
        : "<b>" + added + "</b>/" + needed;
    return (
      '<button type="button" class="vnl-card' + (bucket === "filled" ? " is-done" : "") + (bucket === "closed" ? " is-closed" : "") +
      '" data-vnl-open="' + escapeHtml(item.id) + '">' +
      '<span class="vnl-head">' +
      '<span class="vnl-date">' + dateTile + "</span>" +
      '<span class="vnl-head-text">' +
      '<span class="vnl-title">' + escapeHtml(item.title || "(Untitled)") + "</span>" +
      (when || soon || item.handled
        ? '<span class="vnl-when">' + when +
          (soon ? '<span class="vnl-soon">' + soon + "</span>" : "") +
          (item.handled ? '<span class="vnl-handled">Handled</span>' : "") + "</span>"
        : "") +
      "</span>" + badge + "</span>" +
      (note ? '<span class="vnl-note">' + escapeHtml(note) + "</span>" : "") +
      '<span class="vnl-foot">' +
      '<span class="vnl-avs">' + avatars + "</span>" +
      '<span class="vnl-progress"><span class="vnl-count">' + count + "</span>" +
      (bucket === "closed" ? "" : '<span class="vnl-meter" aria-hidden="true"><span style="width:' + pct + '%"></span></span>') +
      "</span></span>" +
      "</button>"
    );
  }

  function vnlRender() {
    const groups = { needs: [], filled: [], closed: [] };
    volunteerNeeds.forEach(function (it) { groups[vnlBucket(it)].push(it); });
    const q = vnlQuery.trim().toLowerCase();
    const soonest = function (a, b) {
      const da = vnlStartDate(a), db = vnlStartDate(b);
      return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
    };
    groups.needs.sort(soonest);
    groups.filled.sort(soonest);
    groups.closed.sort(function (a, b) { return soonest(b, a); });
    const shown = {};
    Object.keys(groups).forEach(function (k) {
      shown[k] = q
        ? groups[k].filter(function (it) { return String(it.title || "").toLowerCase().indexOf(q) >= 0; })
        : groups[k];
    });
    const openCount = shown.needs.length + shown.filled.length;
    if ($("vnlCountOpen")) $("vnlCountOpen").textContent = openCount;
    if ($("vnlCountClosed")) $("vnlCountClosed").textContent = shown.closed.length;
    document.querySelectorAll("[data-vnl-tab]").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-vnl-tab") === vnlTab);
    });
    const section = function (label, list, tone) {
      return (
        '<div class="vnl-group">' +
        '<p class="vnl-group-label' + (tone ? " is-" + tone : "") + '">' + label +
        ' <span class="vnl-group-count">' + list.length + "</span></p>" +
        list.map(vnlCardHtml).join("") +
        "</div>"
      );
    };
    let html = "";
    if (vnlTab === "closed") {
      html = shown.closed.map(vnlCardHtml).join("");
      if (!html) html = '<div class="admin-empty">' + (q ? "Nothing matches your search." : "No closed programs.") + "</div>";
    } else {
      if (shown.needs.length) html += '<div class="vnl-group">' + shown.needs.map(vnlCardHtml).join("") + "</div>";
      if (shown.filled.length) html += section("Filled", shown.filled, "filled");
      if (!html) html = '<div class="admin-empty">' + (q ? "Nothing matches your search." : "No open programs right now.") + "</div>";
    }
    $("vnlCards").innerHTML = html;
  }

  async function openVolNeedsList(replaceHash) {
    showOnlyPanel("volNeedsPanel");
    vnlQuery = "";
    if ($("vnlSearchInput")) $("vnlSearchInput").value = "";
    setAdminTitle("Volunteer requirements", { back: "Back to volunteering" });
    const hash = "#volunteering/needs";
    if (replaceHash) history.replaceState(null, "", hash);
    else if (location.hash !== hash) history.pushState(null, "", hash);
    if (volunteerNeeds.length) vnlRender();
    else $("vnlCards").innerHTML = '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading…</div>';
    await refreshCurrentNeedItem();
    if ($("volNeedsPanel").classList.contains("hidden")) return;
    vnlRender();
  }

  /* ── Attendance marking (Nurturing) ──────────────────────────────────
   * List of closed programs that have volunteers → tap one to mark each
   * volunteer Present / Absent. Volunteers who self-checked-in through the
   * public attendance form (matched by program + WhatsApp number) are tagged
   * "Checked in" and can be marked present in one tap. */

  let vatTab = "todo";
  let vatSignins = [];
  let vatMarkId = "";

  function vatDigits(s) {
    return String(s || "").replace(/\D/g, "").slice(-10);
  }

  function vatPrograms() {
    return volunteerNeeds.filter(function (it) {
      return !it.open && (it.volunteers || []).length > 0;
    });
  }

  function vatMarkedCount(item) {
    return (item.volunteers || []).filter(function (v) {
      return v.attended === "yes" || v.attended === "no";
    }).length;
  }

  function vatIsDone(item) {
    const vols = item.volunteers || [];
    return vols.length > 0 && vatMarkedCount(item) === vols.length;
  }

  /** The volunteer's self check-in for this program, if any (latest wins). */
  function vatSigninFor(item, v) {
    const phone = vatDigits(v.phone);
    if (!phone) return null;
    let found = null;
    vatSignins.forEach(function (s) {
      if (String(s["program id"] || "") !== String(item.id)) return;
      if (vatDigits(s.whatsapp) !== phone) return;
      if (!found || Date.parse(s.timestamp) > Date.parse(found.timestamp)) found = s;
    });
    return found;
  }

  function vatCheckedInCount(item) {
    return (item.volunteers || []).filter(function (v) {
      return !!vatSigninFor(item, v);
    }).length;
  }

  /** "20 Sept 2026 · 6:00 AM – 9:00 AM" — the date, then the program's time slots. */
  function vatWhen(item) {
    const slotText =
      item.slots && item.slots.length
        ? item.slots.map(formatSlotLine).filter(Boolean).join(", ")
        : String(item.timings || "").split("\n").filter(Boolean).join(", ");
    return [listingDateLabel(item), slotText].filter(Boolean).join(" · ");
  }

  const VAT_WHEN_CAL_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/></svg>';
  const VAT_WHEN_CLOCK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.25"/><path d="M12 7.5v4.5l3 2"/></svg>';

  /** Same date + time as vatWhen(), but as two icon-led segments instead of one
      dense "date · time" string — easier to scan at a glance. */
  function vatWhenHtml(item) {
    const dateLabel = listingDateLabel(item);
    const slotText =
      item.slots && item.slots.length
        ? item.slots.map(formatSlotLine).filter(Boolean).join(", ")
        : String(item.timings || "").split("\n").filter(Boolean).join(", ");
    let html = dateLabel
      ? '<span class="vat-when-part">' + VAT_WHEN_CAL_ICON + "<span>" + escapeHtml(dateLabel) + "</span></span>"
      : "";
    if (slotText) html += '<span class="vat-when-part">' + VAT_WHEN_CLOCK_ICON + "<span>" + escapeHtml(slotText) + "</span></span>";
    return html;
  }

  function vatFindItem(id) {
    const want = String(id || "").toLowerCase();
    return volunteerNeeds.find(function (it) {
      return String(it.id).toLowerCase() === want;
    });
  }

  function vatSyncHubCount() {
    setHubStat("vol-awaiting", attendanceAlertItems().length);
  }

  async function vatLoadData() {
    const results = await Promise.all([
      apiGet("volunteerNeeds", true).catch(function () { return {}; }),
      apiGet("inquiries", true, { group: ATTENDANCE_GROUP_KEY }).catch(function () { return {}; }),
    ]);
    if (results[0] && !results[0].error && results[0].items) {
      volunteerNeeds = results[0].items;
      setHubStat("volunteer-needs", (results[0].counts && results[0].counts.unmet) || 0);
    }
    const g = results[1] && results[1].group;
    vatSignins = (g && g.items) || [];
    vatSyncHubCount();
  }

  function vatShowView(view) {
    show($("vatList"), view === "list");
    show($("vatMark"), view === "mark");
  }

  function vatTime(raw) {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  }

  function vatCardHtml(item) {
    const vols = item.volunteers || [];
    const marked = vatMarkedCount(item);
    const done = vatIsDone(item);
    const checkedIn = vatCheckedInCount(item);
    const pct = vols.length ? Math.round((marked / vols.length) * 100) : 0;
    return (
      '<button type="button" class="vat-card' + (done ? " is-done" : "") + '" data-vat-open="' + escapeHtml(item.id) + '">' +
      '<span class="vat-card-top">' +
      '<span class="vat-card-title">' + escapeHtml(item.title || "(Untitled)") + "</span>" +
      '<svg class="vch-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>' +
      "</span>" +
      '<span class="vat-card-meta">' + escapeHtml(listingDateLabel(item)) + " · " + vols.length +
      " volunteer" + (vols.length === 1 ? "" : "s") + "</span>" +
      '<span class="vat-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
      '<span class="vat-card-foot">' +
      "<span>" + (done ? "All marked" : marked + " of " + vols.length + " marked") + "</span>" +
      (checkedIn ? '<span class="vat-tag">' + checkedIn + " checked in</span>" : "") +
      "</span>" +
      "</button>"
    );
  }

  /** Volunteers who checked in but are not yet marked, across every program. */
  function vatPendingSignins() {
    const out = [];
    vatPrograms().forEach(function (item) {
      (item.volunteers || []).forEach(function (v) {
        if (!v.attended && vatSigninFor(item, v)) out.push(v);
      });
    });
    return out;
  }

  function vatCloseConfirm() {
    $("vatConfirmOverlay").classList.remove("open");
  }

  /** Shows who is about to be marked present, grouped by program. */
  function vatOpenConfirmAll() {
    const groups = [];
    vatPrograms().forEach(function (item) {
      const names = (item.volunteers || [])
        .filter(function (v) { return !v.attended && vatSigninFor(item, v); })
        .map(function (v) { return v.name || "(No name)"; });
      if (names.length) groups.push({ title: item.title || "(Untitled)", names: names });
    });
    const total = groups.reduce(function (n, g) { return n + g.names.length; }, 0);
    if (!total) return;
    $("vatConfirmSub").textContent =
      "These " + total + " volunteer" + (total === 1 ? "" : "s") + " signed in. Mark them all as present?";
    $("vatConfirmList").innerHTML = groups
      .map(function (g) {
        return (
          '<div class="vat-confirm-group"><p class="vat-confirm-prog">' + escapeHtml(g.title) + "</p><ul>" +
          g.names.map(function (n) { return "<li>" + escapeHtml(n) + "</li>"; }).join("") +
          "</ul></div>"
        );
      })
      .join("");
    $("vatConfirmYes").textContent = "Confirm (" + total + ")";
    $("vatConfirmOverlay").classList.add("open");
  }

  async function vatConfirmAllSignins() {
    const targets = vatPendingSignins();
    if (!targets.length) {
      vatCloseConfirm();
      return;
    }
    const btn = $("vatConfirmYes");
    setButtonBusy(btn, true, "Saving…");
    await Promise.all(targets.map(function (v) { return vatSaveAttended(v, "yes"); }));
    setButtonBusy(btn, false);
    vatCloseConfirm();
    vatRenderList();
    vatSyncHubCount();
  }

  function vatRenderList() {
    const pending = vatPendingSignins();
    show($("vatConfirmAll"), pending.length > 0);
    if ($("vatConfirmTxt")) {
      $("vatConfirmTxt").textContent =
        pending.length + " signed-in volunteer" + (pending.length === 1 ? "" : "s") + " waiting to be confirmed";
    }
    const all = vatPrograms();
    const todo = all.filter(function (it) { return !vatIsDone(it); });
    const done = all.filter(vatIsDone);
    if ($("vatCountTodo")) $("vatCountTodo").textContent = todo.length;
    if ($("vatCountDone")) $("vatCountDone").textContent = done.length;
    document.querySelectorAll("[data-vat-tab]").forEach(function (el) {
      el.classList.toggle("active", el.getAttribute("data-vat-tab") === vatTab);
    });
    const list = vatTab === "done" ? done : todo;
    $("vatCards").innerHTML = list.length
      ? list.map(vatCardHtml).join("")
      : '<div class="admin-empty">' +
        (vatTab === "done" ? "No finished programs yet." : "Nothing to mark right now. All caught up.") +
        "</div>";
  }

  function vatRowHtml(item, v, index) {
    const signin = vatSigninFor(item, v);
    const at = v.attended || "";
    const saving = !!vatSaving[v.rowId];
    const failed = vatFailed[v.rowId];
    const spin = '<span class="admin-spinner" aria-label="Saving"></span>';
    return (
      '<div class="vat-row' + (at ? " is-marked" : "") + (saving ? " is-saving" : "") + '">' +
      '<span class="inquiry-avatar" aria-hidden="true" style="background:' +
      AVATAR_COLORS_[index % AVATAR_COLORS_.length] + '">' + escapeHtml((v.name || "?").trim().charAt(0).toUpperCase()) + "</span>" +
      '<span class="vat-row-main">' +
      '<span class="vat-row-name">' + escapeHtml(v.name || "(No name)") + "</span>" +
      '<span class="vat-row-sub">' +
      escapeHtml([formatInquiryPhone(v.phone || ""), v.area || ""].filter(Boolean).join(" · ")) +
      (signin ? ' <span class="vat-tag">Checked in' + (vatTime(signin.timestamp) ? " · " + vatTime(signin.timestamp) : "") + "</span>" : "") +
      (v.inGroup ? ' <span class="vat-tag vat-tag--group">In group</span>' : v.inviteSent ? ' <span class="vat-tag vat-tag--group">Link sent</span>' : "") +
      "</span></span>" +
      '<span class="vat-row-btns">' +
      '<button type="button" class="vat-btn vat-btn--yes' + (at === "yes" ? " is-on" : "") + '"' + (saving ? " disabled" : "") +
      ' aria-pressed="' + (at === "yes") + '" data-vat-set="' + escapeHtml(v.rowId) + '" data-val="yes">' +
      (saving && at === "yes" ? spin : "Present") + "</button>" +
      '<button type="button" class="vat-btn vat-btn--no' + (at === "no" ? " is-on" : "") + '"' + (saving ? " disabled" : "") +
      ' aria-pressed="' + (at === "no") + '" data-vat-set="' + escapeHtml(v.rowId) + '" data-val="no">' +
      (saving && at === "no" ? spin : "Absent") + "</button>" +
      "</span>" +
      (failed
        ? '<p class="vat-row-err"><span>Couldn’t save.</span>' +
          '<button type="button" class="vat-retry" data-vat-retry="' + escapeHtml(v.rowId) + '">Retry</button></p>'
        : "") +
      "</div>"
    );
  }

  function vatRenderMark() {
    const item = vatFindItem(vatMarkId);
    if (!item) {
      $("vatMarkHead").innerHTML = "";
      $("vatBulk").innerHTML = "";
      $("vatGroupBar").innerHTML = "";
      $("vatRoster").innerHTML = '<div class="admin-empty">Program not found.</div>';
      return;
    }
    const vols = item.volunteers || [];
    const marked = vatMarkedCount(item);
    const pct = vols.length ? Math.round((marked / vols.length) * 100) : 0;
    setAdminTitle(item.title || "Attendance marking", {
      eyebrow: "Attendance marking",
      sub: vatWhen(item),
      back: "Back to programs",
    });
    $("vatMarkHead").innerHTML =
      '<span class="vat-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
      '<p class="vat-progress-txt">' + marked + " of " + vols.length + " marked" +
      (vatCheckedInCount(item) ? " · " + vatCheckedInCount(item) + " checked in" : "") + "</p>";
    const unmarked = vols.filter(function (v) { return !v.attended; });
    const checkedUnmarked = unmarked.filter(function (v) { return !!vatSigninFor(item, v); });
    const notCheckedIn = unmarked.length - checkedUnmarked.length;
    $("vatBulk").innerHTML =
      (checkedUnmarked.length
        ? '<button type="button" class="vat-bulk-btn vat-bulk-btn--primary" data-vat-bulk="checkedin">Mark checked-in (' +
          checkedUnmarked.length + ")</button>"
        : "") +
      (notCheckedIn > 0
        ? '<button type="button" class="vat-bulk-btn ' + (checkedUnmarked.length ? "" : "vat-bulk-btn--primary") +
          '" data-vat-bulk="all">Mark all present (' + unmarked.length + ")</button>"
        : "");
    $("vatRoster").innerHTML = vols.map(function (v, i) { return vatRowHtml(item, v, i); }).join("");
    $("vatGroupBar").innerHTML = vatGroupBarHtml(item);
  }

  // rowIds currently being saved, and ones whose last save failed.
  const vatSaving = {};
  const vatFailed = {};

  async function vatSaveAttended(v, next) {
    const prev = v.attended || "";
    v.attended = next;
    vatSaving[v.rowId] = true;
    delete vatFailed[v.rowId];
    try {
      const data = await apiPost({
        formType: "adminUpdateEventVolunteer",
        token: token(),
        rowId: v.rowId,
        attended: next,
      });
      if (data.error) throw new Error(data.error);
    } catch (err) {
      v.attended = prev;
      vatFailed[v.rowId] = { msg: err.message || "Could not save.", next: next };
    } finally {
      delete vatSaving[v.rowId];
    }
  }

  async function vatSet(rowId, val) {
    const v = vnFindVolunteer(rowId);
    if (!v || vatSaving[rowId]) return;
    const saving = vatSaveAttended(v, v.attended === val ? "" : val); // tap again to clear
    vatRenderMark(); // optimistic: the row reflects the tap straight away
    await saving;
    vatRenderMark();
    vatSyncHubCount();
  }

  async function vatRetry(rowId) {
    const v = vnFindVolunteer(rowId);
    const failed = vatFailed[rowId];
    if (!v || !failed || vatSaving[rowId]) return;
    const saving = vatSaveAttended(v, failed.next);
    vatRenderMark();
    await saving;
    vatRenderMark();
    vatSyncHubCount();
  }

  async function vatBulk(kind) {
    const item = vatFindItem(vatMarkId);
    if (!item) return;
    const targets = (item.volunteers || []).filter(function (v) {
      return !v.attended && (kind === "all" || vatSigninFor(item, v));
    });
    if (!targets.length) return;
    const saving = Promise.all(targets.map(function (v) { return vatSaveAttended(v, "yes"); }));
    vatRenderMark();
    await saving;
    vatRenderMark();
    vatSyncHubCount();
  }

  async function openVolAttendance(replaceHash) {
    showOnlyPanel("volAttendancePanel");
    setAdminTitle("Attendance marking", { back: "Back to volunteering" });
    const hash = "#volunteering/attendance";
    if (replaceHash) history.replaceState(null, "", hash);
    else if (location.hash !== hash) history.pushState(null, "", hash);
    vatShowView("list");
    if (!vatPrograms().length) {
      $("vatCards").innerHTML = '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading…</div>';
    } else {
      vatRenderList();
    }
    await vatLoadData();
    if ($("vatList").classList.contains("hidden")) return;
    vatRenderList();
  }

  async function openVolAttendanceMark(eventId, replaceHash) {
    vatMarkId = String(eventId || "");
    showOnlyPanel("volAttendancePanel");
    setAdminTitle("Attendance marking", { back: "Back to programs" });
    const hash = "#volunteering/attendance/" + vatMarkId;
    if (replaceHash) history.replaceState(null, "", hash);
    else if (location.hash !== hash) history.pushState(null, "", hash);
    vatShowView("mark");
    vatRenderMark();
    await vatLoadData();
    if ($("vatMark").classList.contains("hidden") || String(vatMarkId) !== String(eventId || "")) return;
    vatRenderMark();
  }

  async function openVolProgramDetail(eventId, replaceHash) {
    currentVolNeedId = String(eventId || "");
    // Switch panels and URL first so the previous page never lingers while data loads.
    showOnlyPanel("volProgramDetailPanel");
    setAdminTitle("Program volunteers", { eyebrow: "Volunteer requirements", back: "Back to volunteer requirements" });
    const hash = "#volunteering/need/" + currentVolNeedId;
    if (replaceHash) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
    if (!volunteerNeeds.length) {
      const cachedNeeds = readCached("volunteerNeeds");
      if (cachedNeeds && cachedNeeds.items) volunteerNeeds = cachedNeeds.items;
    }
    if (!volunteerNeeds.length) {
      try {
        const data = await apiGet("volunteerNeeds", true);
        if (!data.error) volunteerNeeds = data.items || [];
      } catch (e) {}
      if (currentVolNeedId !== String(eventId || "") || $("volProgramDetailPanel").classList.contains("hidden")) {
        endDeepLinkBoot();
        return;
      }
    }
    renderVolProgramDetail();
    endDeepLinkBoot();
  }

  /** Three quick numbers: how the roster is filling, or (once closed) how attendance went. */
  function vpdRenderStats(item) {
    const host = $("vpdStats");
    if (!host) return;
    const vols = item.volunteers || [];
    const needed = item.needed || 0;
    const tile = function (num, label, tone) {
      return '<span class="vpd-stat' + (tone ? " is-" + tone : "") + '"><b>' + num + "</b><span>" + label + "</span></span>";
    };
    if (item.open) {
      host.innerHTML =
        tile(vols.length, "Joined") + tile(needed || "—", "Needed") +
        tile(Math.max(0, needed - vols.length), "To go", needed - vols.length > 0 ? "warn" : "good");
    } else {
      const yes = vols.filter(function (v) { return v.attended === "yes"; }).length;
      const no = vols.filter(function (v) { return v.attended === "no"; }).length;
      host.innerHTML = tile(yes, "Present", "good") + tile(no, "Absent", no ? "warn" : "") + tile(vols.length - yes - no, "Not marked");
    }
  }

  let vpdRosterQuery = "";

  function renderVolProgramDetail() {
    const item = vnFindItem(currentVolNeedId);
    if (!item) {
      const panel = $("volProgramDetailPanel");
      if (panel) panel.innerHTML = '<div class="admin-empty">Program not found. <button type="button" class="btn btn-outline" id="vpdBackBtn">Back</button></div>';
      return;
    }

    // Title + badges + progress
    const badgesEl = $("vpdBadges");
    const reqEl = $("vpdReq");
    const needed = item.needed || 0;
    const added = item.addedCount || 0;
    setAdminTitle(item.title || "(Untitled)", {
      eyebrow: "Volunteer requirements",
      subHtml: vatWhenHtml(item),
      back: "Back to volunteer requirements",
    });
    if (badgesEl) {
      badgesEl.innerHTML =
        '<span class="inquiry-badge' + (item.open ? "" : " inquiry-badge-soft") + '">' + (item.open ? "Open" : "Closed") + "</span>" +
        (item.handled
          ? '<span class="vpd-handled-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>' +
            (item.handledBy ? "Handled by " + escapeHtml(item.handledBy) : "Handled") + "</span>"
          : "");
    }
    // The handler's own remarks, if any, sit quietly under the badges.
    const hNote = $("vpdHandledNote");
    if (hNote) {
      const r = String(item.handledRemarks || "").trim();
      hNote.textContent = item.handled && r ? "“" + r + "”" : "";
      show(hNote, item.handled && !!r);
    }
    vpdRenderStats(item);
    if (reqEl) {
      const more = needed - added;
      reqEl.textContent = added + " of " + needed + " volunteer" + (needed === 1 ? "" : "s") +
        (more > 0 ? " · " + more + " more needed" : added >= needed ? " · all filled" : "");
    }
    if ($("vpdMeterFill")) {
      $("vpdMeterFill").style.width = (needed > 0 ? Math.min(100, Math.round((added / needed) * 100)) : added > 0 ? 100 : 0) + "%";
      $("vpdMeterFill").parentNode.classList.toggle("is-full", needed > 0 && added >= needed);
    }
    const notesEl = $("vpdRequirementsNote");
    if (notesEl) {
      const requirements = (item.requirements || "").trim();
      notesEl.textContent = requirements;
      show(notesEl, !!requirements);
    }
    // Closed programs with people on the roster can go straight to marking.
    show($("vpdAttendBtn"), role() === "nurturing" && !item.open && (item.volunteers || []).length > 0);

    // Generate form: pre-check fields that are already on this program's form
    const existing = item.formFields || [];

    vpdSyncFormBtn(item);

    // Mark handled section (Nurturing only)
    const handledSection = $("vpdHandledSection");
    if (handledSection) {
      const isNurturing = role() === "nurturing";
      // Once handled, the badge up top says so (and by whom); no second strip.
      handledSection.classList.toggle("hidden", !isNurturing || !!item.handled);
      const handledContent = $("vpdHandledContent");
      if (handledContent && isNurturing) {
        handledContent.innerHTML = item.handled
          ? ""
          : '<button type="button" class="vpd-handle-btn" id="vpdMarkHandledBtn">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>' +
            "Mark handled</button>";
      }
    }

    // Roster
    const rosterList = $("vpdRosterList");
    const rosterCount = $("vpdRosterCount");
    const vols = item.volunteers || [];
    if (rosterCount) rosterCount.textContent = vols.length > 0 ? "(" + vols.length + ")" : "";
    show($("vpdRosterSearchWrap"), vols.length > 6);
    const rq = vols.length > 6 ? vpdRosterQuery.trim().toLowerCase() : "";
    const shownVols = rq
      ? vols.filter(function (v) {
          return [v.name, v.phone, v.area].some(function (x) { return String(x || "").toLowerCase().indexOf(rq) >= 0; });
        })
      : vols;
    if (rosterList) {
      if (!vols.length) {
        rosterList.innerHTML =
          '<div class="vpr-empty"><span class="vpr-empty-ico" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg></span>' +
          "<p>No volunteers yet</p><small>Add people you have spoken to, or share the Google form in your WhatsApp groups.</small>" +
          '<button type="button" class="btn btn-outline vpd-btn-sm" data-vpd-add>Add the first volunteer</button></div>';
      } else {
        rosterList.innerHTML = shownVols.length
          ? shownVols.map(function (v, i) { return vpdRowHtml(item, v, i); }).join("")
          : '<div class="admin-empty">Nobody matches your search.</div>';
      }
    }
  }

  /* ── Form builder UI ────────────────────────────────────────────────── */

  async function ensureFormTemplates() {
    if (formTemplates.length > 0) return;
    try {
      const data = await apiGet("formTemplates", true);
      if (!data.error) formTemplates = data.templates || [];
    } catch (e) {}
  }

  function selectedTemplateId() {
    const radio = document.querySelector("#vpdFormBuilder input[name='vpdTemplate']:checked");
    return radio ? radio.value : "";
  }

  const GF_TYPE_LABELS = {
    TEXT: "Short answer", PARAGRAPH_TEXT: "Paragraph", CHECKBOX: "Checkboxes", MULTIPLE_CHOICE: "Multiple choice",
    LIST: "Dropdown", DATE: "Date", TIME: "Time", SCALE: "Scale", DATETIME: "Date & time", DURATION: "Duration",
  };
  const GF_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const GF_PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const gfTemplateQuestions = {}; // templateId -> [{title,type,required,help}]

  /** One editable option in the "How would you like to volunteer?" list. */
  function gfOptionRow(n, value) {
    return (
      '<div class="gf-opt"><span class="gf-opt-n">' + n + "</span>" +
      '<input type="text" class="admin-input gf-opt-input" value="' + escapeHtml(value || "") + '" ' +
      'placeholder="e.g. Hall setup - Tue (7 AM - 8 AM)" aria-label="Option ' + n + '"/>' +
      '<button type="button" class="gf-opt-x" aria-label="Remove option">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>'
    );
  }

  function gfRenumber(box) {
    box.querySelectorAll(".gf-opt").forEach(function (row, i) {
      row.querySelector(".gf-opt-n").textContent = i + 1;
      row.querySelector(".gf-opt-input").setAttribute("aria-label", "Option " + (i + 1));
    });
  }

  function gfAddOption(box, afterRow) {
    const n = box.querySelectorAll(".gf-opt").length + 1;
    const holder = document.createElement("div");
    holder.innerHTML = gfOptionRow(n, "");
    const row = holder.firstChild;
    if (afterRow && afterRow.nextSibling) box.insertBefore(row, afterRow.nextSibling);
    else box.appendChild(row);
    gfRenumber(box);
    row.querySelector("input").focus();
  }

  /** The non-empty options typed for a template, in order. */
  function gfCollectOptions(templateId) {
    const box = document.querySelector('[data-gf-opts="' + templateId + '"]');
    if (!box) return [];
    return Array.prototype.map
      .call(box.querySelectorAll(".gf-opt-input"), function (i) { return i.value.trim(); })
      .filter(Boolean);
  }

  /* ── Your own fields (custom form) ─────────────────────────────────── */
  const GF_XF_TYPES = [
    ["TEXT", "Short answer"], ["PARAGRAPH", "Paragraph"], ["DATE", "Date"], ["TIME", "Time"],
    ["MULTIPLE_CHOICE", "Multiple choice"], ["CHECKBOX", "Checkboxes"], ["LIST", "Dropdown"],
  ];
  const GF_XF_CHOICE = { MULTIPLE_CHOICE: 1, CHECKBOX: 1, LIST: 1 };

  function gfAddCustomField() {
    const box = $("gfCustomFields");
    if (!box) return;
    const row = document.createElement("div");
    row.className = "gf-xf";
    row.innerHTML =
      '<div class="gf-xf-top"><input type="text" class="admin-input gf-xf-title" placeholder="Field name" aria-label="Field name"/>' +
      '<button type="button" class="gf-opt-x gf-xf-x" aria-label="Remove field">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>' +
      '<div class="gf-xf-bar"><select class="admin-input gf-xf-type" aria-label="Field type">' +
      GF_XF_TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + "</option>"; }).join("") +
      '</select><label class="gf-req"><input type="checkbox" class="gf-xf-req"/> Required</label></div>' +
      '<input type="text" class="admin-input gf-xf-opts hidden" placeholder="Options, separated by commas" aria-label="Options"/>';
    box.appendChild(row);
    row.querySelector(".gf-xf-title").focus();
  }

  /** The custom fields as typed: [{title, type, required, options}] (blank-title rows skipped). */
  function gfCollectCustomFields() {
    const out = [];
    document.querySelectorAll("#gfCustomFields .gf-xf").forEach(function (row) {
      const title = row.querySelector(".gf-xf-title").value.trim();
      const type = row.querySelector(".gf-xf-type").value;
      const options = GF_XF_CHOICE[type]
        ? row.querySelector(".gf-xf-opts").value.split(",").map(function (o) { return o.trim(); }).filter(Boolean)
        : [];
      if (title) out.push({ title: title, type: type, required: row.querySelector(".gf-xf-req").checked, options: options });
    });
    return out;
  }

  /** One row of the "what volunteers will fill in" list. */
  function gfFixedRow(title, typeLabel, required, help) {
    return (
      '<li class="gf-field gf-field--fixed"><span class="gf-ico">' + GF_LOCK + "</span>" +
      '<span class="gf-fmain"><b>' + escapeHtml(title) + "</b>" +
      '<small>' + escapeHtml(typeLabel) + (help ? " · " + escapeHtml(help) : "") + "</small></span>" +
      '<span class="gf-badge' + (required ? " is-req" : "") + '">' + (required ? "Required" : "Optional") + "</span></li>"
    );
  }

  const gfQuestionErrors = {}; // templateId -> message, when the master form couldn't be read

  /** Shown when the template's own questions can't be read: what we know for certain. */
  function gfKnownRows(tmpl, why) {
    return (
      gfFixedRow("Name", "Short answer", true, "") +
      gfFixedRow("WhatsApp number", "Short answer", true, "") +
      '<li class="gf-loading">The other questions come from the “' + escapeHtml(tmpl.name) + '” template form.' +
      (why ? ' <span class="gf-why">(' + escapeHtml(why) + ")</span>" : "") + "</li>"
    );
  }

  function gfQuestionRows(tmpl) {
    if (gfQuestionErrors[tmpl.id]) return gfKnownRows(tmpl, gfQuestionErrors[tmpl.id]);
    const qs = gfTemplateQuestions[tmpl.id];
    if (!qs) return '<li class="gf-loading">Loading the questions on this form…</li>';
    const rows = qs
      .filter(function (q) { return q.title !== tmpl.slotQuestion; })
      .map(function (q) { return gfFixedRow(q.title, GF_TYPE_LABELS[q.type] || "Question", q.required, q.help); });
    return rows.length ? rows.join("") : "";
  }

  async function gfLoadQuestions(tmpl) {
    if (!tmpl || gfTemplateQuestions[tmpl.id]) return;
    const host = document.querySelector('[data-gf-fixed="' + tmpl.id + '"]');
    try {
      const data = await apiGet("formTemplateQuestions", true, { templateId: tmpl.id });
      if (data.error) throw new Error(data.error);
      gfTemplateQuestions[tmpl.id] = data.questions || [];
    } catch (err) {
      gfQuestionErrors[tmpl.id] = friendlyError(err.message || "");
      const again = document.querySelector('[data-gf-fixed="' + tmpl.id + '"]');
      if (again) again.innerHTML = gfKnownRows(tmpl, gfQuestionErrors[tmpl.id]);
      return;
    }
    const target = document.querySelector('[data-gf-fixed="' + tmpl.id + '"]') || host;
    if (target) target.innerHTML = gfQuestionRows(tmpl);
  }

  /* ── Step-by-step controller for the form drawer ───────────────────── */
  const GF_STEP_NAMES = ["Form type", "Questions", "Review"];
  let gfStep = 1; // 1..3, or "ready" when the program already has a form

  function gfCurrentTemplate() {
    const id = selectedTemplateId();
    return formTemplates.filter(function (t) { return t.id === id; })[0] || null;
  }

  /** Step 2 sanity check so people don't reach the end with an empty question. */
  function gfStep2Problem() {
    const t = gfCurrentTemplate();
    const bad = gfCollectCustomFields().filter(function (f) { return GF_XF_CHOICE[f.type] && !f.options.length; })[0];
    if (bad) return "Add options for “" + bad.title + "”.";
    if (!t) return "";
    if (t.type === "multi-program") {
      const picked = document.querySelectorAll(".vpd-prog-pick:checked");
      if (!picked.length) return "Tick at least one program.";
      for (let i = 0; i < picked.length; i++) {
        const row = picked[i].closest(".vpd-prog-row");
        const timing = row && row.querySelector(".vpd-timing-input");
        if (timing && !timing.value.trim()) {
          timing.classList.add("input-error");
          timing.focus();
          return "Add the timings for every ticked program.";
        }
      }
      return "";
    }
    if (!gfCollectOptions(t.id).length) return "Add at least one option.";
    return "";
  }

  /** Review: a preview that looks like the Google Form volunteers will open. */
  function gfRenderReview() {
    const host = $("gfReview");
    if (!host) return;
    const nameEl = $("vpdFormTitle");
    const star = '<span class="gp-star" aria-hidden="true">*</span>';
    const card = function (title, type, required, help, options) {
      let body;
      if (type === "CHECKBOX" || type === "MULTIPLE_CHOICE") {
        body = '<ul class="gp-opts' + (type === "CHECKBOX" ? " is-check" : "") + '">' +
          (options || []).map(function (o) { return "<li>" + escapeHtml(o) + "</li>"; }).join("") + "</ul>";
      } else if (type === "LIST") {
        body = '<div class="gp-select">Choose</div>';
      } else if (type === "DATE") {
        body = '<div class="gp-line gp-line--short">Month, day, year</div>';
      } else if (type === "TIME") {
        body = '<div class="gp-line gp-line--short">Time</div>';
      } else {
        body = '<div class="gp-line">Your answer</div>';
      }
      return '<div class="gp-card"><p class="gp-q">' + escapeHtml(title) + (required ? star : "") + "</p>" +
        (help ? '<p class="gp-help">' + escapeHtml(help) + "</p>" : "") + body + "</div>";
    };
    const t = gfCurrentTemplate();
    let desc = "";
    let html = "";
    if (t) {
      const qs = gfTemplateQuestions[t.id];
      if (qs) {
        qs.filter(function (q) { return q.title !== t.slotQuestion; }).forEach(function (q) {
          html += card(q.title, q.type === "PARAGRAPH_TEXT" ? "PARAGRAPH" : q.type, q.required, q.help);
        });
      } else {
        html += card("Name", "TEXT", true) + card("WhatsApp number", "TEXT", true);
      }
      let chips = [];
      if (t.type === "multi-program") {
        document.querySelectorAll(".vpd-prog-pick:checked").forEach(function (el) {
          const r = el.closest(".vpd-prog-row");
          const label = r && r.querySelector(".vpd-check-label strong");
          const timing = r && r.querySelector(".vpd-timing-input");
          chips.push((label ? label.textContent : "Program") + (timing && timing.value.trim() ? " | " + timing.value.trim() : ""));
        });
      } else {
        chips = gfCollectOptions(t.id);
      }
      html += card(t.slotQuestion || "Options", "CHECKBOX", true, "", chips);
      gfCollectCustomFields().forEach(function (f) { html += card(f.title, f.type, f.required, "", f.options); });
    } else {
      desc = "Register as a volunteer for this program. Name and WhatsApp number are required so we can stay in touch.";
      html += card("Name", "TEXT", true) + card("WhatsApp number", "TEXT", true, "Include country code if needed, e.g. +91 98765 43210");
      [["vpdFieldArea", "vpdReqArea", "Area of stay", "TEXT", ""],
       ["vpdFieldIe", "vpdReqIe", "IE Completion date", "TEXT", "e.g. May-2024"],
       ["vpdFieldRemarks", "vpdReqRemarks", "Remarks if any", "PARAGRAPH", ""]].forEach(function (f) {
        const on = $(f[0]), req = $(f[1]);
        if (on && on.checked) html += card(f[2], f[3], !!(req && req.checked), f[4]);
      });
      gfCollectCustomFields().forEach(function (f) {
        html += card(f.title, f.type === "PARAGRAPH" ? "PARAGRAPH" : f.type, f.required, "", f.options);
      });
      const opts = gfCollectOptions("custom");
      if (opts.length) html += card(($("vpdCustomQuestion") && $("vpdCustomQuestion").value.trim()) || "How would you like to volunteer?", "CHECKBOX", true, "", opts);
    }
    host.innerHTML =
      '<div class="gp-card gp-title"><h3>' + escapeHtml(nameEl ? nameEl.value.trim() : "") + "</h3>" +
      (desc ? "<p>" + escapeHtml(desc) + "</p>" : "") + '<p class="gp-req-note">' + star + " Indicates required question</p></div>" + html;
  }

  function gfGo(step) {
    gfStep = step;
    const host = $("vpdFormBuilder");
    if (!host) return;
    const ready = step === "ready";
    const review = step === "review";
    const pos = review ? 3 : step;
    host.querySelectorAll("[data-gf-view]").forEach(function (el) {
      const isReadyView = el.getAttribute("data-gf-view") === "ready";
      let visible = ready ? isReadyView : !isReadyView;
      const n = el.getAttribute("data-gf-step");
      if (!ready && n) visible = String(n) === String(step);
      el.classList.toggle("hidden", !visible);
    });
    if (!ready) {
      host.querySelectorAll("#gfProgress .gf-bar span").forEach(function (s, i) { s.classList.toggle("on", i < pos); });
    }
    if ($("vpdFormError")) $("vpdFormError").classList.add("hidden");
    if (review) gfRenderReview();
    // Footer: Back/Close · Next / Review and generate / Confirm
    const back = $("vpdGfBack"), next = $("vpdGfNext"), gen = $("vpdGenerateFormBtn");
    if (back) back.textContent = ready || step === 1 ? "Close" : "Back";
    if (next) {
      next.classList.toggle("hidden", review);
      next.textContent = ready ? "Edit & regenerate" : step === 3 ? "Review and generate" : "Next";
    }
    if (gen) {
      gen.classList.toggle("hidden", !review);
      gen.textContent = "Confirm";
      gen.dataset.idleLabel = "Confirm";
    }
    const body = host.closest(".bsheet-body");
    if (body) body.scrollTop = 0;
  }

  function gfNext() {
    if (gfStep === "ready") return gfGo(1);
    if (gfStep === 2) {
      const problem = gfStep2Problem();
      if (problem) {
        const err = $("vpdFormError");
        if (err) { err.textContent = problem; err.classList.remove("hidden"); }
        return;
      }
    }
    if (gfStep === 3) {
      const titleEl = $("vpdFormTitle");
      if (titleEl && !titleEl.value.trim()) {
        titleEl.classList.add("input-error");
        titleEl.focus();
        return;
      }
      if (titleEl) titleEl.classList.remove("input-error");
      return gfGo("review");
    }
    if (gfStep < 3) gfGo(gfStep + 1);
  }

  function gfBack() {
    if (gfStep === "ready" || gfStep === 1) return closeBSheet("volFormSheet");
    gfGo(gfStep === "review" ? 3 : gfStep - 1);
  }

  function renderVpdFormBuilder(item) {
    const host = $("vpdFormBuilder");
    if (!host) return;

    const existingLink = item.formShortUrl || "";
    const existingTmpl = item.formTemplateId || "";
    const existingFields = item.formFields || [];
    const hasForm = !!item.formId;

    // Load templates async, re-render when done
    if (!formTemplates.length) {
      ensureFormTemplates().then(function () {
        renderVpdFormBuilder(item);
        gfGo(item.formId ? "ready" : 1);
      });
      host.innerHTML = '<p class="vpd-section-sub">Loading templates…</p>';
      return;
    }

    const activeId =
      existingTmpl ||
      (hasForm ? "custom" : formTemplates[0].id);

    // Step 1 — choose a form type (radio cards)
    const describe = function (t) {
      return t.type === "multi-program" ? "Volunteers pick which programs they can support with."
        : "Volunteers pick the time slots they can support with.";
    };
    const card = function (id, name, desc) {
      return (
        '<label class="gf-type"><input type="radio" name="vpdTemplate" value="' + escapeHtml(id) + '"' + (id === activeId ? " checked" : "") + "/>" +
        '<span class="gf-type-card"><b>' + escapeHtml(name) + "</b><small>" + escapeHtml(desc) + "</small></span></label>"
      );
    };
    let cards = formTemplates.map(function (t) { return card(t.id, t.name, describe(t)); }).join("");
    cards += card("custom", "Custom", "A simple form: name and WhatsApp number, plus any extras you tick.");

    // Step 2 — one panel per type showing fixed vs editable questions
    let panels = "";
    formTemplates.forEach(function (t) {
      const isActive = t.id === activeId;
      let editable;
      if (t.type === "multi-program") {
        const allNeeds = (volunteerNeeds || []).filter(function (p) { return p.open; });
        let picks;
        if (!allNeeds.length) {
          picks = '<p class="gf-hint">No open programs found.</p>';
        } else {
          picks = '<p class="gf-hint">Tick the programs to offer, and add each one’s timings (required).</p><div class="vpd-prog-checks">';
          allNeeds.forEach(function (p) {
            const isCurrent = p.id === currentVolNeedId;
            const linked = !!(p.formId && p.formId === (vnFindItem(currentVolNeedId) || {}).formId);
            const safeId = escapeHtml(p.id);
            picks +=
              '<div class="vpd-prog-row"><label class="vpd-check-label">' +
              '<input type="checkbox" class="vpd-prog-pick" value="' + safeId + '" ' + (isCurrent || linked ? "checked" : "") + "/>" +
              "<span><strong>" + escapeHtml(p.title) + '</strong> <span class="vpd-check-hint">· ' + escapeHtml(listingDateLabel(p)) + "</span></span></label>" +
              '<input type="text" class="admin-input vpd-timing-input" data-prog-id="' + safeId + '" placeholder="Timings * (e.g. 6am-9am)" ' +
              'title="Required. Appended after the program name as \'Program | Timings\'"/></div>';
          });
          picks += "</div>";
        }
        editable = picks;
      } else {
        const seed = String(t.slotPlaceholder || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
        editable =
          '<p class="gf-hint">Add the options volunteers can choose from.</p>' +
          '<div class="gf-opts" data-gf-opts="' + escapeHtml(t.id) + '">' +
          (seed.length ? seed : [""]).map(function (s, i) { return gfOptionRow(i + 1, s); }).join("") +
          "</div>" +
          '<button type="button" class="gf-addopt" data-gf-addopt="' + escapeHtml(t.id) + '">+ Add option</button>';
      }
      panels +=
        '<div class="vpd-tmpl-slots ' + (isActive ? "" : "hidden") + '" data-tmpl-slots="' + escapeHtml(t.id) + '">' +
        '<ul class="gf-fields" data-gf-fixed="' + escapeHtml(t.id) + '">' + gfQuestionRows(t) + "</ul>" +
        '<div class="gf-field gf-field--edit gf-field--block"><div class="gf-fhead"><span class="gf-ico">' + GF_PEN + "</span>" +
        '<span class="gf-fmain"><b>' + escapeHtml(t.slotQuestion || (t.type === "multi-program" ? "Programs" : "Options")) + "</b>" +
        "<small>" + (t.type === "multi-program" ? "Checkboxes · you choose the programs" : "Checkboxes · you write the options") + "</small></span>" +
        '<span class="gf-badge is-edit">You edit</span></div>' + editable + "</div></div>";
    });
    const customActive = activeId === "custom";
    const sw = function (id, value, label, hint, on) {
      return (
        '<label class="gf-field gf-field--edit gf-switch"><span class="gf-ico">' + GF_PEN + "</span>" +
        '<span class="gf-fmain"><b>' + label + "</b><small>" + hint + "</small></span>" +
        '<input type="checkbox" id="' + id + '" value="' + value + '" ' + (on ? "checked" : "") + '/><span class="gf-toggle" aria-hidden="true"></span></label>'
      );
    };
    const sfRow = function (switchHtml, reqId) {
      return '<div class="gf-sf">' + switchHtml +
        '<label class="gf-req"><input type="checkbox" id="' + reqId + '"/> Required</label></div>';
    };
    panels +=
      '<div class="vpd-tmpl-slots ' + (customActive ? "" : "hidden") + '" data-tmpl-slots="custom">' +
      '<ul class="gf-fields">' +
      gfFixedRow("Name", "Short answer", true, "") +
      gfFixedRow("WhatsApp number", "Short answer", true, "") +
      "</ul>" +
      '<p class="gf-subhead">Suggested fields <span>- Select any to add in the form</span></p>' +
      '<div class="gf-switches">' +
      sfRow(sw("vpdFieldArea", "area_of_stay", "Area of stay", "Short answer · optional", existingFields.indexOf("area_of_stay") >= 0), "vpdReqArea") +
      sfRow(sw("vpdFieldIe", "ie_completion", "IE completion date", "Short answer · e.g. May-2024", existingFields.indexOf("ie_completion") >= 0), "vpdReqIe") +
      sfRow(sw("vpdFieldRemarks", "volunteer_remarks", "Remarks if any", "Paragraph · optional", existingFields.indexOf("volunteer_remarks") >= 0), "vpdReqRemarks") +
      "</div>" +
      '<div class="gf-cq">' +
      '<label class="gf-cq-label" for="vpdCustomQuestion">Question</label>' +
      '<input type="text" class="admin-input" id="vpdCustomQuestion" value="How would you like to volunteer?" placeholder="Type your question" />' +
      '<span class="gf-cq-label">Checkbox options</span>' +
      '<div class="gf-opts" data-gf-opts="custom">' + gfOptionRow(1, "") + "</div>" +
      '<button type="button" class="gf-addopt" data-gf-addopt="custom">+ Add option</button></div>' +
      "</div>";

    // Existing link + share
    const btns =
      '<div class="vpd-form-link-btns"><button type="button" class="btn btn-outline vpd-btn-sm" id="vpdCopyLinkBtn">Copy link</button>' +
      '<button type="button" class="btn btn-gold vpd-btn-sm" id="vpdShareWaBtn">Share on WhatsApp</button></div>';
    const linkHtml =
      '<div class="vpd-form-link' + (existingLink ? "" : " hidden") + '" id="vpdFormLinkRow">' +
      '<span class="gf-ready">Form ready — share this link</span>' +
      '<a class="vpd-form-url" id="vpdFormUrl" href="' + escapeHtml(existingLink) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(existingLink) + "</a>" +
      btns + "</div>";

    const stepHead = function (n, title) {
      return '<p class="gf-step-title">' + title + "</p>";
    };
    host.innerHTML =
      '<div class="gf-ready-view" data-gf-view="ready">' + linkHtml.replace(' hidden"', '"') + "</div>" +
      '<div class="gf-progress" id="gfProgress" data-gf-view="wizard"><div class="gf-bar"><span></span><span></span><span></span></div>' +
      '</div>' +
      '<section class="gf-step" data-gf-step="1" data-gf-view="wizard">' + stepHead(1, "What kind of form?") +
      '<div class="gf-types" role="radiogroup" aria-label="Form type">' + cards + "</div></section>" +
      '<section class="gf-step" data-gf-step="2" data-gf-view="wizard">' + stepHead(2, "What will volunteers fill in?") +
panels +
      '<p class="gf-subhead">Your own fields <span>- add anything else you need</span></p>' +
      '<div class="gf-xfs" id="gfCustomFields"></div>' +
      '<button type="button" class="gf-addopt" data-gf-addfield>+ Add custom field</button></section>' +
      '<section class="gf-step" data-gf-step="3" data-gf-view="wizard">' + stepHead(3, "Name your form") +
      '<label class="gf-label" for="vpdFormTitle">Will appear on top of the form</label>' +
      '<input type="text" class="admin-input" id="vpdFormTitle" value="' + escapeHtml((item.title || "") + " — volunteer sign-up") + '" placeholder="Form name" /></section>' +
      '<section class="gf-step" data-gf-step="review" data-gf-view="wizard">' + stepHead("", "Review") +
      '<div class="gf-review" id="gfReview"></div></section>';

    const loadActive = function (value) {
      const t = formTemplates.filter(function (x) { return x.id === value; })[0];
      if (t) gfLoadQuestions(t);
    };
    // Wire type switching (show that type's panel, fetch its fixed questions)
    host.querySelectorAll("input[name='vpdTemplate']").forEach(function (radio) {
      radio.addEventListener("change", function () {
        host.querySelectorAll("[data-tmpl-slots]").forEach(function (el) {
          el.classList.toggle("hidden", el.getAttribute("data-tmpl-slots") !== radio.value);
        });
        loadActive(radio.value);
      });
    });
    loadActive(activeId);
  }

  /* ── Generate Form ───────────────────────────────────────────────────── */

  /** Hero button + drawer footer reflect whether this program already has a form. */
  function vpdSyncFormBtn(item) {
    const has = !!(item && item.formId);
    if ($("vpdFormBtnTitle")) $("vpdFormBtnTitle").textContent = has ? "Google form ready" : "Create Google form";
    if ($("vpdFormBtn")) $("vpdFormBtn").classList.toggle("is-ready", has);
    const gen = $("vpdGenerateFormBtn");
    if (gen) {
      const label = has ? "Regenerate form" : "Generate Google Form";
      gen.textContent = label;
      gen.dataset.idleLabel = label;
    }
    if ($("volFormSheetLede")) {
      $("volFormSheetLede").textContent = has
        ? "Your form is ready. Share the link in your WhatsApp groups, or regenerate it below."
        : "Create a sign-up form for volunteers, then post its link in your WhatsApp groups.";
    }
  }

  /* ── Connect existing Google form ─────────────────────────────────────
   * Step 1: pick one of the site account's forms (or paste its link).
   * Step 2: confirm which question is the name / WhatsApp / area / IE /
   * remarks. Connecting imports existing answers and keeps syncing new ones. */
  const CF_FIELDS = [
    { key: "name", label: "Name", required: true },
    { key: "phone", label: "WhatsApp number", required: true },
    { key: "area", label: "Area of stay" },
    { key: "ie", label: "IE completion date" },
    { key: "remarks", label: "Remarks" },
  ];
  let cfForms = null;
  let cfInspect = null; // { formId, title, responses, questions, guess, usedBy, acceptingResponses }

  function cfSetError(msg) {
    const el = $("cfError");
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
  }

  function cfStep(step) {
    show($("cfPickStep"), step === "pick");
    show($("cfMapStep"), step === "map");
    show($("cfConnect"), step === "map");
    $("cfBack").textContent = step === "map" ? "Back" : "Close";
    cfSetError("");
  }

  async function openConnectFormSheet() {
    const item = vnFindItem(currentVolNeedId);
    if (!item) return;
    $("cfTitle").textContent = item.title || "Program";
    const note = $("cfReplaceNote");
    note.textContent = item.formId
      ? "This program already has a form. Connecting another replaces its link here; volunteers already added stay."
      : "";
    note.classList.toggle("hidden", !item.formId);
    $("cfSearch").value = "";
    $("cfLink").value = "";
    cfInspect = null;
    cfStep("pick");
    openBSheet("cfSheet");
    if (cfForms) {
      renderCfList();
      return;
    }
    $("cfList").innerHTML = '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading forms…</div>';
    try {
      const data = await apiPost({ formType: "adminListVolunteerForms", token: token() });
      if (data.error) throw new Error(data.error);
      cfForms = data.forms || [];
      renderCfList();
    } catch (err) {
      $("cfList").innerHTML = '<div class="admin-empty">' + escapeHtml(friendlyError(err.message)) + "</div>";
    }
  }

  function renderCfList() {
    const q = $("cfSearch").value.trim().toLowerCase();
    const rows = (cfForms || []).filter(function (f) { return !q || f.title.toLowerCase().indexOf(q) >= 0; });
    if (!rows.length) {
      $("cfList").innerHTML = '<div class="admin-empty">' + (cfForms && cfForms.length ? "No forms match." : "No forms in the website's Google account yet.") + "</div>";
      return;
    }
    $("cfList").innerHTML = rows.map(function (f) {
      const here = f.linkedEventId && String(f.linkedEventId) === String(currentVolNeedId);
      const elsewhere = f.linkedEventId && !here;
      const when = new Date(f.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      return '<button type="button" class="cf-item" data-cf-form="' + escapeHtml(f.formId) + '"' + (elsewhere || here ? " disabled" : "") + ">" +
        '<span class="cf-item-main"><b>' + escapeHtml(f.title) + "</b><span>Edited " + escapeHtml(when) + "</span></span>" +
        (here ? '<span class="cf-tag cf-tag--here">Connected here</span>'
          : elsewhere ? '<span class="cf-tag">Used by ' + escapeHtml(f.linkedTitle || "another program") + "</span>" : "") +
        "</button>";
    }).join("");
  }

  async function cfInspectForm(link, btn) {
    cfSetError("");
    // A list row has rich content, so it only dims; the link button says "Checking…".
    const isRow = !!(btn && btn.classList.contains("cf-item"));
    const sub = isRow ? btn.querySelector(".cf-item-main span") : null;
    const subText = sub ? sub.textContent : "";
    if (isRow) {
      btn.classList.add("is-loading");
      btn.disabled = true;
      btn.insertAdjacentHTML("beforeend", '<span class="admin-spinner cf-item-spin" aria-hidden="true"></span>');
      if (sub) sub.textContent = "Reading questions and responses…";
    } else {
      setButtonBusy(btn, true, "Checking…");
    }
    try {
      const request = apiPost({ formType: "adminInspectVolunteerForm", token: token(), link: link, eventId: currentVolNeedId });
      // The rest of the picker waits too, so nothing else can be started meanwhile.
      if (window.sectionLoading) window.sectionLoading($("cfPickStep"), request);
      const data = await request;
      if (data.error) throw new Error(data.error);
      if (data.usedBy) throw new Error("That form is already connected to " + data.usedBy + ".");
      cfInspect = data;
      renderCfMap();
      cfStep("map");
    } catch (err) {
      cfSetError(friendlyError(err.message));
    } finally {
      if (isRow) {
        btn.classList.remove("is-loading");
        btn.disabled = false;
        const spin = btn.querySelector(".cf-item-spin");
        if (spin) spin.remove();
        if (sub) sub.textContent = subText;
      } else {
        setButtonBusy(btn, false);
      }
    }
  }

  function renderCfMap() {
    const d = cfInspect;
    $("cfFormName").textContent = d.title;
    $("cfFormMeta").textContent = d.responses + (d.responses === 1 ? " response so far" : " responses so far") +
      (d.acceptingResponses ? "" : " · not accepting responses");
    const options = function (selected) {
      return '<option value="">— Not in this form —</option>' + d.questions.map(function (q) {
        return '<option value="' + escapeHtml(q.id) + '"' + (q.id === selected ? " selected" : "") + ">" + escapeHtml(q.title) + "</option>";
      }).join("");
    };
    $("cfMapFields").innerHTML = CF_FIELDS.map(function (f) {
      return '<div class="form-group cf-map-row"><label for="cfMap_' + f.key + '">' + escapeHtml(f.label) + (f.required ? " *" : "") + "</label>" +
        '<select id="cfMap_' + f.key + '" data-cf-map="' + f.key + '">' + options((d.guess || {})[f.key] || "") + "</select></div>";
    }).join("");
    cfSkipped = {};
    renderCfExtras();
  }

  let cfSkipped = {}; // question id → true when unticked

  /** Questions not picked above: listed by name, ticked = kept in remarks. */
  function renderCfExtras() {
    const used = {};
    document.querySelectorAll("[data-cf-map]").forEach(function (sel) { if (sel.value) used[sel.value] = true; });
    const rest = (cfInspect.questions || []).filter(function (q) { return !used[q.id]; });
    $("cfExtras").innerHTML = rest.map(function (q) {
      return '<label class="cf-extra"><input type="checkbox" data-cf-extra="' + escapeHtml(q.id) + '"' +
        (cfSkipped[q.id] ? "" : " checked") + "/><span>" + escapeHtml(q.title) + "</span></label>";
    }).join("");
    show($("cfExtrasWrap"), rest.length > 0);
  }

  async function cfConnect() {
    const map = {};
    document.querySelectorAll("[data-cf-map]").forEach(function (sel) {
      if (sel.value) map[sel.getAttribute("data-cf-map")] = sel.value;
    });
    if (!map.name || !map.phone) {
      cfSetError("Pick the questions for the name and the WhatsApp number.");
      return;
    }
    const btn = $("cfConnect");
    setButtonBusy(btn, true, "Importing…");
    cfSetError("");
    try {
      const skip = [];
      document.querySelectorAll("[data-cf-extra]").forEach(function (cb) {
        if (!cb.checked) skip.push(cb.getAttribute("data-cf-extra"));
      });
      const data = await apiPost({
        formType: "adminConnectProgramVolunteerForm", token: token(),
        eventId: currentVolNeedId, link: cfInspect.formId, map: map, skip: skip,
      });
      if (data.error) throw new Error(data.error);
      cfForms = null; // "Connected here" tags changed
      closeBSheet("cfSheet");
      const bits = [data.imported + (data.imported === 1 ? " volunteer" : " volunteers") + " imported"];
      if (data.duplicates) bits.push(data.duplicates + " already here");
      if (data.skipped) bits.push(data.skipped + " without a name or number skipped");
      toastMsg("Form connected — " + bits.join(", ") + "." +
        (data.liveSync === false ? " New answers won't sync automatically; reconnect later." : " New answers will come in automatically."));
      const fresh = await apiGet("volunteerNeeds", true);
      if (!fresh.error) volunteerNeeds = fresh.items || volunteerNeeds;
      renderVolProgramDetail();
    } catch (err) {
      cfSetError(friendlyError(err.message));
    } finally {
      setButtonBusy(btn, false);
    }
  }

  function initConnectForm() {
    if (!$("cfSheet")) return;
    $("cfSearch").addEventListener("input", renderCfList);
    $("cfList").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-cf-form]");
      if (btn && !btn.disabled) cfInspectForm(btn.getAttribute("data-cf-form"), btn);
    });
    $("cfLinkGo").addEventListener("click", function () {
      cfInspectForm($("cfLink").value.trim(), $("cfLinkGo"));
    });
    $("cfLink").addEventListener("keydown", function (e) {
      if (e.key === "Enter") cfInspectForm($("cfLink").value.trim(), $("cfLinkGo"));
    });
    $("cfBack").addEventListener("click", function () {
      if (!$("cfMapStep").classList.contains("hidden")) cfStep("pick");
      else closeBSheet("cfSheet");
    });
    $("cfConnect").addEventListener("click", cfConnect);
    $("cfMapFields").addEventListener("change", function (e) {
      if (e.target.closest("[data-cf-map]")) renderCfExtras();
    });
    $("cfExtras").addEventListener("change", function (e) {
      const cb = e.target.closest("[data-cf-extra]");
      if (cb) cfSkipped[cb.getAttribute("data-cf-extra")] = !cb.checked;
    });
  }

  /** Remarks from a form read "Q: A | Q: A"; show one answer per line, question in bold. */
  function volunteerRemarksHtml(text, cls) {
    const parts = String(text || "").split(" | ").map(function (p) { return p.trim(); }).filter(Boolean);
    if (!parts.length) return "";
    return '<span class="' + cls + ' vol-remarks-list">' + parts.map(function (p) {
      const m = p.match(/^([^:]{2,140}):\s+([\s\S]+)$/);
      return '<span class="vol-remark">' + (m
        ? "<b>" + escapeHtml(m[1]) + ":</b> " + escapeHtml(m[2])
        : escapeHtml(p)) + "</span>";
    }).join("") + "</span>";
  }

  function openVolFormSheet() {
    const item = vnFindItem(currentVolNeedId);
    if (!item) return;
    vpdSyncFormBtn(item);
    renderVpdFormBuilder(item);
    gfGo(item.formId ? "ready" : 1);
    openBSheet("volFormSheet");
  }

  function shareVolFormOnWhatsApp() {
    const urlEl = $("vpdFormUrl");
    const url = urlEl && urlEl.href;
    if (!url) return;
    const item = vnFindItem(currentVolNeedId) || {};
    const text = "Namaskaram 🙏\nVolunteers are needed for " + (item.title || "our upcoming program") +
      ". Please sign up here:\n" + url;
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener,noreferrer");
  }

  async function generateFormForProgram() {
    const btn = $("vpdGenerateFormBtn");
    if (!currentVolNeedId) return;
    const item = vnFindItem(currentVolNeedId);
    const errEl = $("vpdFormError");
    if (errEl) { errEl.textContent = ""; errEl.classList.add("hidden"); }

    const titleEl = $("vpdFormTitle");
    const formTitle = titleEl ? titleEl.value.trim() : "";
    if (!formTitle) {
      if (titleEl) { titleEl.classList.add("input-error"); titleEl.focus(); }
      toastMsg("Please enter a form title.");
      return;
    }
    if (titleEl) titleEl.classList.remove("input-error");

    const chosenTemplate = selectedTemplateId();
    let payload;

    if (chosenTemplate && chosenTemplate !== "custom") {
      const tmplMeta = formTemplates.find(function (t) { return t.id === chosenTemplate; }) || {};

      if (tmplMeta.type === "multi-program") {
        // Collect checked programs from the program picker
        const checkedEls = document.querySelectorAll(".vpd-prog-pick:checked");
        const programIds = [];
        const programLabels = {}; // id → display label with timing
        let missingTiming = [];
        checkedEls.forEach(function (el) {
          if (!el.value) return;
          programIds.push(el.value);
          const row = el.closest(".vpd-prog-row");
          const timingEl = row && row.querySelector(".vpd-timing-input");
          const timing = timingEl ? timingEl.value.trim() : "";
          if (!timing) {
            // Highlight the missing field
            if (timingEl) { timingEl.classList.add("input-error"); timingEl.focus(); }
            const label = row && row.querySelector(".vpd-check-label strong");
            missingTiming.push(label ? label.textContent : "a program");
          } else {
            if (timingEl) timingEl.classList.remove("input-error");
            programLabels[el.value] = timing;
          }
        });
        if (!programIds.length) {
          toastMsg("Select at least one program.");
          return;
        }
        if (missingTiming.length) {
          const msg = "Enter timings for: " + missingTiming.join(", ");
          if (errEl) { errEl.textContent = msg; errEl.classList.remove("hidden"); errEl.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
          toastMsg(msg);
          return;
        }
        const additionalIds = programIds.filter(function (id) { return id !== currentVolNeedId; });
        payload = {
          formType: "adminCreateProgramVolunteerForm",
          token: token(),
          eventId: currentVolNeedId,
          templateId: chosenTemplate,
          customFields: gfCollectCustomFields(),
          additionalProgramIds: additionalIds,
          programTimings: programLabels,
          formTitle: formTitle,
          regenerate: true,
        };
      } else {
        // Single-program template — collect slots from textarea
        const slots = gfCollectOptions(chosenTemplate);
        if (!slots.length) {
          toastMsg("Please add at least one option.");
          return;
        }
        payload = {
          formType: "adminCreateProgramVolunteerForm",
          token: token(),
          eventId: currentVolNeedId,
          templateId: chosenTemplate,
          customFields: gfCollectCustomFields(),
          slots: slots,
          formTitle: formTitle,
          regenerate: true,
        };
      }
    } else {
      // Custom path — collect field checkboxes
      const fields = [];
      if ($("vpdFieldArea") && $("vpdFieldArea").checked) fields.push("area_of_stay");
      if ($("vpdFieldIe") && $("vpdFieldIe").checked) fields.push("ie_completion");
      if ($("vpdFieldRemarks") && $("vpdFieldRemarks").checked) fields.push("volunteer_remarks");
      payload = {
        formType: "adminCreateProgramVolunteerForm",
        token: token(),
        eventId: currentVolNeedId,
        templateId: "",
        fields: fields,
        fieldRequired: {
          area_of_stay: !!($("vpdReqArea") && $("vpdReqArea").checked),
          ie_completion: !!($("vpdReqIe") && $("vpdReqIe").checked),
          volunteer_remarks: !!($("vpdReqRemarks") && $("vpdReqRemarks").checked),
        },
        customFields: gfCollectCustomFields(),
        slots: gfCollectOptions("custom"),
        slotQuestionTitle: ($("vpdCustomQuestion") && $("vpdCustomQuestion").value.trim()) || "",
        formTitle: formTitle,
        regenerate: true,
      };
    }

    setButtonBusy(btn, true, "Creating form…");
    try {
      const data = await apiPost(payload);
      if (data.error) throw new Error(data.error);

      console.log("[vpd-form] API response:", data);

      // Update local cache
      const cached = vnFindItem(currentVolNeedId);
      if (cached) {
        cached.formId = data.formId || "";
        cached.formShortUrl = data.shortUrl || "";
        cached.formFields = Array.isArray(data.formFields) ? data.formFields : (data.formFields || "").split(",").filter(Boolean);
        cached.formTemplateId = data.templateId || chosenTemplate || "";
      }

      // Show link row
      const formLinkRow = $("vpdFormLinkRow");
      const formUrlEl = $("vpdFormUrl");
      if (data.shortUrl) {
        if (formLinkRow && formUrlEl) {
          formUrlEl.textContent = data.shortUrl;
          formUrlEl.href = data.shortUrl;
          show(formLinkRow, true);
          if (errEl) errEl.classList.add("hidden");
        }
        toastMsg("Form ready! Link: " + data.shortUrl);
      } else {
        toastMsg("Form created — no URL returned. Check Apps Script logs.");
      }
      // Update idle label BEFORE setButtonBusy restores it
      if (btn) btn.dataset.idleLabel = "Regenerate form";
      vpdSyncFormBtn(vnFindItem(currentVolNeedId));
      gfGo("ready");
    } catch (err) {
      const msg = friendlyError(err.message);
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove("hidden");
        errEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      toastMsg(msg);
    } finally {
      setButtonBusy(btn, false);
    }
  }

  /** Copies text without ever showing a dialog: the Clipboard API where it exists
   * (secure pages), otherwise a hidden textarea + execCommand, which also works on http. */
  async function copyTextQuietly(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(box);
      box.focus();
      box.select();
      box.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      box.remove();
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  async function copyVolFormLink() {
    const urlEl = $("vpdFormUrl");
    const url = urlEl && urlEl.href;
    if (!url) return;
    const btn = $("vpdCopyLinkBtn");
    const ok = await copyTextQuietly(url);
    if (ok) {
      showToast("Link copied");
      if (btn) {
        btn.textContent = "Copied ✓";
        setTimeout(function () { btn.textContent = "Copy link"; }, 1600);
      }
    } else {
      // Last resort, still no dialog: highlight the link so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(urlEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      showToast("Couldn’t copy automatically — the link is selected, copy it manually");
    }
  }

  /* ── VPD: mark handled ───────────────────────────────────────────────── */

  async function vpdMarkHandled() {
    const btn = $("vpdMarkHandledBtn");
    setButtonBusy(btn, true, "Saving…");
    try {
      const data = await apiPost({
        formType: "adminSaveVolunteerNeed",
        token: token(),
        eventId: currentVolNeedId,
        handled: true,
        remarks: "",
      });
      if (data.error) throw new Error(data.error);
      await refreshCurrentNeedItem();
      renderVolProgramDetail();
    } catch (err) {
      toastMsg(err.message || "Could not save.");
    } finally {
      setButtonBusy(btn, false);
    }
  }

  /* ── VPD: add volunteer inline ───────────────────────────────────────── */

  async function vpdAddVolunteer() {
    const item = vnFindItem(currentVolNeedId);
    if (!item) return;
    // Re-use existing pvAddOverlay or vnAddForm inside the detail panel
    // For now open the legacy vnHandleEventId flow; volunteer addition is handled via
    // the inline form that we inject at the bottom of the roster section.
    openVnAddForm(currentVolNeedId);
  }

  /* ── VPD: attendance/flag in detail ─────────────────────────────────── */

  async function vpdSetAttended(rowId, val) {
    try {
      const data = await apiPost({
        formType: "adminUpdateEventVolunteer",
        token: token(),
        rowId: rowId,
        attended: val,
      });
      if (data.error) throw new Error(data.error);
      await refreshCurrentNeedItem();
      renderVolProgramDetail();
    } catch (err) {
      toastMsg(err.message || "Could not save attendance.");
    }
  }

  async function vpdToggleFlag(rowId, field) {
    const vol = vnFindVolunteer(rowId);
    if (!vol) return;
    const newVal = field === "inGroup" ? !vol.inGroup : !vol.inviteSent;
    try {
      const payload = {
        formType: "adminUpdateEventVolunteer",
        token: token(),
        rowId: rowId,
      };
      if (field === "inGroup") payload.inGroup = newVal;
      else payload.inviteSent = newVal;
      const data = await apiPost(payload);
      if (data.error) throw new Error(data.error);
      await refreshCurrentNeedItem();
      renderVolProgramDetail();
    } catch (err) {
      toastMsg(err.message || "Could not save.");
    }
  }

  async function vpdDeleteVolunteer(rowId) {
    try {
      const data = await apiPost({
        formType: "adminDeleteEventVolunteer",
        token: token(),
        rowId: rowId,
      });
      if (data.error) throw new Error(data.error);
      await refreshCurrentNeedItem();
      renderVolProgramDetail();
    } catch (err) {
      toastMsg(err.message || "Could not delete.");
    }
  }

  /* ── VPD: inline add-volunteer form ─────────────────────────────────── */

  let vpdAddEventId = "";

  function openVnAddForm(eventId) {
    vpdAddEventId = String(eventId || "");
    const item = vnFindItem(vpdAddEventId);
    ["vpdAddName", "vpdAddPhone", "vpdAddArea", "vpdAddIe", "vpdAddRemarks"].forEach(function (id) {
      if ($(id)) $(id).value = "";
    });
    if ($("vpdAddError")) $("vpdAddError").classList.add("hidden");
    if ($("volAddSheetTitle")) $("volAddSheetTitle").textContent = (item && item.title) || "Program";
    openBSheet("volAddSheet");
    setTimeout(function () { if ($("vpdAddName")) $("vpdAddName").focus(); }, 250);
  }

  async function saveVpdAddVolunteer(keepOpen) {
    const eventId = vpdAddEventId;
    const errEl = $("vpdAddError");
    const fail = function (msg) {
      if (errEl) { errEl.textContent = msg; errEl.classList.remove("hidden"); }
    };
    const name = $("vpdAddName").value.trim();
    const phone = digitsLookLikePhone($("vpdAddPhone").value);
    const area = $("vpdAddArea").value.trim();
    if (!name) return fail("Name is required.");
    if (!phone) return fail("Enter a valid phone number.");
    if (!area) return fail("Area of stay is required.");
    if (errEl) errEl.classList.add("hidden");
    const btn = keepOpen ? $("vpdAddNextBtn") : $("vpdAddSaveBtn");
    setButtonBusy(btn, true, "Adding…");
    try {
      const data = await apiPost({
        formType: "adminAddEventVolunteer",
        token: token(),
        eventId: eventId,
        name: name,
        phone: phone,
        area: area,
        ieCompletion: $("vpdAddIe").value.trim(),
        remarks: $("vpdAddRemarks").value.trim(),
      });
      if (data.error) throw new Error(data.error);
      await refreshCurrentNeedItem();
      renderVolProgramDetail();
      showToast(name + " added");
      if (keepOpen) {
        ["vpdAddName", "vpdAddPhone", "vpdAddArea", "vpdAddIe", "vpdAddRemarks"].forEach(function (id) {
          $(id).value = "";
        });
        $("vpdAddName").focus();
      } else {
        closeBSheet("volAddSheet");
      }
    } catch (err) {
      fail(friendlyError(err.message));
    } finally {
      setButtonBusy(btn, false);
    }
  }

  /* ── refresh helper ──────────────────────────────────────────────────── */

  async function refreshCurrentNeedItem() {
    try {
      const data = await apiGet("volunteerNeeds", true);
      if (!data.error) {
        volunteerNeeds = data.items || [];
        setHubStat("volunteer-needs", (data.counts && data.counts.unmet) || 0);
      }
    } catch (e) {}
  }

  function openVnHandle(eventId) {
    const item = vnFindItem(eventId);
    if (!item) return;
    vnHandleEventId = eventId;
    if ($("vnHandleSub")) {
      $("vnHandleSub").textContent = item.title + " — " + (item.needed || 0) + " volunteer(s) needed";
    }
    if ($("vnHandleRemarks")) $("vnHandleRemarks").value = item.handledRemarks || "";
    if ($("vnHandleError")) $("vnHandleError").textContent = "";
    const overlay = $("vnHandleOverlay");
    if (overlay) overlay.classList.add("open");
  }

  function closeVnHandle() {
    const overlay = $("vnHandleOverlay");
    if (overlay) overlay.classList.remove("open");
    vnHandleEventId = "";
  }

  async function saveVnHandle() {
    if (!vnHandleEventId) return;
    const btn = $("vnHandleSave");
    setButtonBusy(btn, true, "Saving…");
    try {
      const data = await apiPost({
        formType: "adminSaveVolunteerNeed",
        token: token(),
        eventId: vnHandleEventId,
        handled: true,
        remarks: ($("vnHandleRemarks") && $("vnHandleRemarks").value) || "",
      });
      if (data.error) throw new Error(data.error);
      closeVnHandle();
      await loadVolunteerNeeds();
    } catch (err) {
      if ($("vnHandleError")) $("vnHandleError").textContent = err.message || "Could not save.";
    } finally {
      setButtonBusy(btn, false);
    }
  }

  async function vnAddVolunteer(eventId, card) {
    const nameEl = card.querySelector("[data-vn-add-name]");
    const phoneEl = card.querySelector("[data-vn-add-phone]");
    const remarksEl = card.querySelector("[data-vn-add-remarks]");
    const btn = card.querySelector("[data-vn-add-save]");
    const name = (nameEl && nameEl.value.trim()) || "";
    const phone = digitsLookLikePhone(phoneEl && phoneEl.value);
    if (!name) { toastMsg("Enter the volunteer's name"); return; }
    if (!phone) { toastMsg("Enter a valid phone number"); return; }
    setButtonBusy(btn, true, "Adding…");
    try {
      const data = await apiPost({
        formType: "adminAddEventVolunteer",
        token: token(),
        eventId: eventId,
        name: name,
        phone: phone,
        remarks: (remarksEl && remarksEl.value.trim()) || "",
      });
      if (data.error) throw new Error(data.error);
      await loadVolunteerNeeds();
    } catch (err) {
      toastMsg(err.message || "Could not add volunteer");
    } finally {
      setButtonBusy(btn, false);
    }
  }

  async function vnSetAttended(rowId, value) {
    const v = vnFindVolunteer(rowId);
    const next = v && v.attended === value ? "" : value; // tap again to clear
    try {
      const data = await apiPost({
        formType: "adminUpdateEventVolunteer",
        token: token(),
        rowId: rowId,
        attended: next,
      });
      if (data.error) throw new Error(data.error);
      await loadVolunteerNeeds();
    } catch (err) {
      toastMsg(err.message || "Could not update attendance");
    }
  }

  async function vnToggleFlag(rowId, field) {
    const v = vnFindVolunteer(rowId);
    if (!v) return;
    const payload = { formType: "adminUpdateEventVolunteer", token: token(), rowId: rowId };
    payload[field] = !v[field];
    try {
      const data = await apiPost(payload);
      if (data.error) throw new Error(data.error);
      await loadVolunteerNeeds();
    } catch (err) {
      toastMsg(err.message || "Could not update");
    }
  }

  async function vnDeleteVolunteer(rowId) {
    if (!window.confirm("Remove this volunteer from the list?")) return;
    try {
      const data = await apiPost({ formType: "adminDeleteEventVolunteer", token: token(), rowId: rowId });
      if (data.error) throw new Error(data.error);
      await loadVolunteerNeeds();
    } catch (err) {
      toastMsg(err.message || "Could not remove volunteer");
    }
  }

  function vnBridgeReady() {
    return !!(window.VjnVol && window.VjnVol.isReady && window.VjnVol.isReady());
  }

  /* ── Program volunteers (Programs team) ──────────────────────────────
     Same EventVolunteers backend/endpoints as Nurturing's vn-card above,
     just a simpler, Programs-themed view: no WhatsApp-group/invite
     tracking, no "mark handled" step (the server auto-handles it), one
     card per program that expands into its roster inline. ── */

  function pvToast(message) {
    const el = $("pvStatus");
    if (el) el.textContent = message || "";
  }

  function pvFindItem(id) {
    return pvItems.find(function (it) {
      return String(it.id) === String(id);
    });
  }

  function pvFindVolunteer(rowId) {
    for (let i = 0; i < pvItems.length; i++) {
      const vols = pvItems[i].volunteers || [];
      for (let j = 0; j < vols.length; j++) {
        if (String(vols[j].rowId) === String(rowId)) return vols[j];
      }
    }
    return null;
  }

  function setPvView(view) {
    pvView = view === "closed" ? "closed" : "open";
    document.querySelectorAll("[data-pv-view]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-pv-view") === pvView);
    });
    renderProgramVolunteers();
  }

  /* ── Volunteers roster (Nurturing) — rows come from a linked Google Sheet ── */
  let rosterData = { headers: [], rows: [] };

  async function loadRoster() {
    const host = $("rosterList");
    if (!host) return;
    host.innerHTML =
      '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading volunteers…</div>';
    try {
      const data = await apiGet("volunteerRoster", true);
      if (data.error) throw new Error(data.error);
      if (data.configured === false) {
        rosterData = { headers: [], rows: [] };
        host.innerHTML = '<div class="admin-empty">No volunteer sheet linked yet.</div>';
        return;
      }
      rosterData = { headers: data.headers || [], rows: data.rows || [] };
      setHubStat("roster", rosterData.rows.length);
      renderRoster();
    } catch (err) {
      if (!(cached && cached.items)) {
        host.innerHTML =
          '<div class="admin-empty">' + escapeHtml(friendlyError(err.message) || "Could not load volunteers.") + "</div>";
      }
    }
  }

  function renderRoster() {
    const host = $("rosterList");
    if (!host) return;
    const q = (($("rosterSearch") && $("rosterSearch").value) || "").trim().toLowerCase();
    const rows = rosterData.rows.filter(function (r) {
      return !q || r.join(" ").toLowerCase().indexOf(q) >= 0;
    });
    if ($("rosterMeta")) {
      $("rosterMeta").textContent = rows.length + " of " + rosterData.rows.length + " volunteers";
    }
    if (!rows.length) {
      host.innerHTML = '<div class="admin-empty">No volunteers found.</div>';
      return;
    }
    const H = rosterData.headers;
    host.innerHTML = rows.map(function (r) {
      const details = r.map(function (cell, i) {
        if (i === 0 || !String(cell).trim()) return "";
        return '<div class="vnc-meta"><strong>' + escapeHtml(H[i] || "") + ":</strong> " + escapeHtml(cell) + "</div>";
      }).join("");
      return '<article class="inquiry-card"><div class="vnc-title">' + escapeHtml(r[0] || "—") + "</div>" + details + "</article>";
    }).join("");
  }

  async function loadProgramVolunteers() {
    const host = $("pvList");
    if (!host) return;
    pvToast("");
    const cached = readCached("volunteerNeeds");
    if (cached && cached.items) {
      pvItems = cached.items;
      setPvView("open");
    } else if (!pvLoading) {
      host.innerHTML =
        '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading…</div>';
    }
    pvLoading = true;
    try {
      const data = await apiGet("volunteerNeeds", true);
      if (data.error) throw new Error(data.error);
      pvItems = data.items || [];
      setHubStat("pv-unmet", (data.counts && data.counts.unmet) || 0);
      setPvView("open");
    } catch (err) {
      host.innerHTML =
        '<div class="admin-empty">' + escapeHtml(friendlyError(err.message) || "Could not load volunteers.") + "</div>";
    } finally {
      pvLoading = false;
    }
  }

  function pvPipsHtml(added, needed) {
    const total = Math.max(needed, added, 1);
    let out = '<span class="pg-pips" role="img" aria-label="' + added + " of " + needed + ' volunteers assigned">';
    for (let i = 0; i < total; i++) {
      out += '<span class="pg-pip' + (i < added ? " is-filled" : "") + '"></span>';
    }
    out += "</span>";
    return out;
  }

  function pvAttendBadgeHtml(attended) {
    if (attended === "yes") return '<span class="pv-attend-badge is-yes">Attended</span>';
    if (attended === "no") return '<span class="pv-attend-badge is-no">No-show</span>';
    return '<span class="pv-attend-badge">Not marked</span>';
  }

  function pvVolRowHtml(item, v) {
    const trailing = !item.open
      ? pvAttendBadgeHtml(v.attended)
      : '<svg class="pv-vol-arrow" viewBox="0 0 24 12" aria-hidden="true"><path d="M1 6h20M16 1l5 5-5 5"/></svg>';
    return (
      '<div class="pv-vol-row" data-pv-vol="' + escapeHtml(v.rowId) + '">' +
      '<span class="pv-vol-name">' +
      escapeHtml(v.name || "(No name)") +
      "</span>" +
      trailing +
      "</div>"
    );
  }

  function pvExpandedHtml(item) {
    const vols = item.volunteers || [];
    const rows = vols.length
      ? vols.map(function (v) { return pvVolRowHtml(item, v); }).join("")
      : '<p class="pv-empty">No volunteers yet.</p>';
    return (
      '<div class="pv-roster">' +
      rows +
      "</div>" +
      (item.open
        ? '<button type="button" class="btn btn-outline pv-add-btn" data-pv-add="' + escapeHtml(item.id) + '">Add volunteer</button>'
        : "")
    );
  }

  function pvCardHtml(item) {
    const dateLabel = listingDateLabel(item);
    const needed = item.needed || 0;
    const added = item.addedCount || 0;
    const vols = item.volunteers || [];
    const attendedCount = vols.filter(function (v) { return v.attended === "yes"; }).length;
    const expanded = pvExpandedId === item.id;
    const initial = (item.title || "?").trim().charAt(0).toUpperCase() || "?";
    const statLine = item.open
      ? added + " of " + needed + " volunteer" + (needed === 1 ? "" : "s") + " assigned"
      : attendedCount + " volunteer" + (attendedCount === 1 ? "" : "s") + " attended";

    return (
      '<article class="pv-card' + (item.open ? "" : " is-closed") + (expanded ? " is-expanded" : "") +
      '" data-pv-id="' + escapeHtml(item.id) + '">' +
      '<button type="button" class="pv-card-head" data-pv-toggle="' + escapeHtml(item.id) + '">' +
      '<span class="inquiry-avatar" aria-hidden="true">' + escapeHtml(initial) + "</span>" +
      '<span class="pv-card-title-wrap">' +
      '<span class="pv-card-title">' + escapeHtml(item.title || "(Untitled)") + "</span>" +
      '<span class="pv-card-meta">' + escapeHtml(dateLabel) + "</span>" +
      "</span>" +
      '<span class="inquiry-badge' + (item.open ? "" : " is-closed") + '">' + (item.open ? "Open" : "Closed") + "</span>" +
      '<svg class="pv-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
      "</button>" +
      '<div class="pv-stat-row">' +
      (item.open ? pvPipsHtml(added, needed) : "") +
      '<span class="pv-stat-line">' + escapeHtml(statLine) + "</span>" +
      "</div>" +
      (expanded ? pvExpandedHtml(item) : "") +
      "</article>"
    );
  }

  function renderProgramVolunteers() {
    const host = $("pvList");
    if (!host) return;
    const openCount = pvItems.filter(function (it) { return it.open; }).length;
    const closedCount = pvItems.length - openCount;
    document.querySelectorAll("[data-pv-view]").forEach(function (btn) {
      const key = btn.getAttribute("data-pv-view");
      const label = key === "closed" ? "Past programs" : "Open";
      const n = key === "closed" ? closedCount : openCount;
      btn.textContent = label + (btn.classList.contains("active") ? " " + n : "");
    });
    const filtered = pvItems.filter(function (it) {
      return pvView === "closed" ? !it.open : it.open;
    });
    if (!filtered.length) {
      host.innerHTML =
        '<div class="admin-empty">' +
        (pvView === "closed" ? "No past programs yet." : "No programs are asking for volunteers right now.") +
        "</div>";
      return;
    }
    host.innerHTML = filtered.map(pvCardHtml).join("");
  }

  function pvToggleCard(id) {
    pvExpandedId = pvExpandedId === id ? "" : id;
    renderProgramVolunteers();
  }

  /* Drag a bottom sheet by its handle: 1:1 with the finger while dragging,
     resisted (rubber-banded) past the fully-open position, and decided
     shut-or-snap-back at release by how far *and how fast* it moved —
     not position alone. Shared by every .sheet-overlay dialog (add a
     volunteer, choose a flyer, ...); pass the handle/overlay ids and the
     function that plays the close animation. */
  function bindSheetDrag(handleId, overlayId, onClose) {
    const handle = $(handleId);
    const overlay = $(overlayId);
    if (!handle || !overlay) return;
    let sheet = null;
    let dragging = false;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;

    handle.addEventListener("pointerdown", function (e) {
      sheet = overlay.querySelector(".sheet");
      if (!sheet) return;
      dragging = true;
      startY = e.clientY;
      lastY = e.clientY;
      lastT = Date.now();
      velocity = 0;
      sheet.style.transition = "none";
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener("pointermove", function (e) {
      if (!dragging || !sheet) return;
      const now = Date.now();
      const dt = Math.max(1, now - lastT);
      velocity = (e.clientY - lastY) / dt; // px/ms, +down / -up
      lastY = e.clientY;
      lastT = now;
      const delta = e.clientY - startY;
      const y = delta < 0 ? delta * 0.3 : delta; // rubber-band past fully open
      sheet.style.transform = "translateY(" + y + "px)";
    });

    function endDrag(e) {
      if (!dragging || !sheet) return;
      dragging = false;
      const delta = e.clientY - startY;
      sheet.style.transition = "";
      sheet.style.transform = "";
      const shouldClose = delta > 110 || velocity > 0.6;
      if (shouldClose) onClose();
    }

    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  /* Two rAFs: the first lets the browser paint the off-screen (closed)
     state we just switched to (display:none -> flex); only then does
     adding "is-shown" register as a change the transition can animate,
     instead of jumping straight to the open state. */
  function openSheet(overlayId) {
    const overlay = $(overlayId);
    if (!overlay) return;
    overlay.classList.add("open");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add("is-shown");
      });
    });
  }

  function closeSheet(overlayId) {
    const overlay = $(overlayId);
    if (!overlay || !overlay.classList.contains("open")) return;
    overlay.classList.remove("is-shown");
    const sheet = overlay.querySelector(".sheet");
    let done = false;
    const finish = function () {
      if (done) return;
      done = true;
      overlay.classList.remove("open");
      if (sheet) sheet.removeEventListener("transitionend", finish);
    };
    if (sheet) sheet.addEventListener("transitionend", finish);
    setTimeout(finish, 380); // fallback if transitionend doesn't fire
  }

  function clearPvAddFieldErrors() {
    document.querySelectorAll("#pvAddOverlay .form-group.has-error").forEach(function (group) {
      group.classList.remove("has-error");
      const note = group.querySelector(".admin-field-err");
      if (note) note.remove();
    });
  }

  function openPvAdd(eventId) {
    $("pvAddEventId").value = eventId;
    $("pvAddName").value = "";
    $("pvAddPhone").value = "";
    $("pvAddArea").value = "";
    $("pvAddRemarks").value = "";
    $("pvAddError").textContent = "";
    $("pvAddError").style.display = "none";
    clearPvAddFieldErrors();
    openSheet("pvAddOverlay");
    // iOS keyboard-open-on-focus fights the slide-up animation, so wait
    // for it to settle before focusing the first field.
    setTimeout(function () {
      $("pvAddName").focus();
    }, 260);
  }

  function closePvAdd() {
    closeSheet("pvAddOverlay");
    if (window.DraftKeeper) DraftKeeper.clear("pvAdd");
  }

  async function savePvAdd() {
    const btn = $("savePvAddBtn");
    const err = $("pvAddError");
    err.textContent = "";
    err.style.display = "none";
    clearPvAddFieldErrors();
    const eventId = $("pvAddEventId").value;
    const name = $("pvAddName").value.trim();
    const phoneRaw = $("pvAddPhone").value;
    const phone = strictIndianMobile(phoneRaw);
    const area = $("pvAddArea").value.trim();
    const remarks = $("pvAddRemarks").value.trim();

    let firstError = null;
    if (!name) firstError = firstError || setFieldError("pvAddName", "Enter the volunteer's name.");
    if (!phoneRaw.trim()) firstError = firstError || setFieldError("pvAddPhone", "Mobile number is required.");
    else if (!phone) firstError = firstError || setFieldError("pvAddPhone", "Enter a valid 10-digit mobile number (starts 6–9).");
    if (!area) firstError = firstError || setFieldError("pvAddArea", "Enter their area of stay.");
    if (firstError) {
      focusFieldError(firstError);
      return;
    }

    setButtonBusy(btn, true, "Adding…");
    try {
      const data = await apiPost({
        formType: "adminAddEventVolunteer",
        token: token(),
        eventId: eventId,
        name: name,
        phone: phone,
        area: area,
        remarks: remarks,
      });
      if (data.error) throw new Error(data.error);
      closePvAdd();
      pvExpandedId = eventId;
      await loadProgramVolunteers();
    } catch (e) {
      err.textContent = friendlyError(e.message);
      err.style.display = "block";
    } finally {
      setButtonBusy(btn, false);
    }
  }

  function pvFindItemForVolunteer(rowId) {
    return pvItems.find(function (it) {
      return (it.volunteers || []).some(function (v) {
        return String(v.rowId) === String(rowId);
      });
    });
  }

  function renderPvDetailAttend(item) {
    const wrap = $("pvDetailAttendWrap");
    if (!wrap) return;
    if (!item || item.open) {
      show(wrap, false);
      return;
    }
    show(wrap, true);
    document.querySelectorAll("[data-pv-detail-attend]").forEach(function (btn) {
      btn.classList.toggle("is-on", btn.getAttribute("data-pv-detail-attend") === pvDetailPendingAttended);
    });
  }

  /* Tapping a segment only updates the pending local choice — nothing is
     saved (and the roster behind the popup doesn't reload) until Save. */
  function pvSelectAttend(value) {
    pvDetailPendingAttended = pvDetailPendingAttended === value ? "" : value;
    renderPvDetailAttend(pvFindItemForVolunteer(pvDetailRowId));
  }

  /* Numbers added via this page are stored as bare 10-digit; older ones
     (added through Nurturing's flow) may already carry the "91" country
     code. wa.me needs the country code either way. */
  function pvWaNumber(phone) {
    const d = String(phone || "").replace(/\D/g, "");
    return d.length === 10 ? "91" + d : d;
  }

  function openPvDetail(rowId) {
    const v = pvFindVolunteer(rowId);
    if (!v) return;
    pvDetailRowId = rowId;
    pvDetailPendingAttended = v.attended || "";
    $("pvDetailName").textContent = v.name || "(No name)";
    $("pvDetailPhone").textContent = v.phone || "—";
    $("pvDetailPhone").href = v.phone ? "https://wa.me/" + pvWaNumber(v.phone) : "#";
    $("pvDetailArea").textContent = v.area || "—";
    $("pvDetailRemarks").value = v.remarks || "";
    $("pvCopyPhoneBtn").classList.remove("is-copied");
    $("pvDetailError").textContent = "";
    $("pvDetailError").style.display = "none";
    renderPvDetailAttend(pvFindItemForVolunteer(rowId));
    $("pvVolunteerOverlay").classList.add("open");
  }

  function closePvDetail() {
    $("pvVolunteerOverlay").classList.remove("open");
    pvDetailRowId = "";
    pvDetailPendingAttended = "";
  }

  let pvCopyResetTimer = null;
  async function pvCopyPhone() {
    const text = $("pvDetailPhone").textContent || "";
    if (!text || text === "—") return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Fallback for contexts without the async Clipboard API.
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      try { document.execCommand("copy"); } catch (err) {}
      document.body.removeChild(helper);
    }
    const btn = $("pvCopyPhoneBtn");
    btn.classList.add("is-copied");
    clearTimeout(pvCopyResetTimer);
    pvCopyResetTimer = setTimeout(function () {
      btn.classList.remove("is-copied");
    }, 1500);
  }

  async function savePvDetail() {
    if (!pvDetailRowId) return;
    const btn = $("savePvDetailBtn");
    const err = $("pvDetailError");
    err.textContent = "";
    err.style.display = "none";
    setButtonBusy(btn, true, "Saving…");
    try {
      const payload = {
        formType: "adminUpdateEventVolunteer",
        token: token(),
        rowId: pvDetailRowId,
        remarks: $("pvDetailRemarks").value.trim(),
      };
      // Attendance only applies (and only shows) once a program has closed.
      if (!$("pvDetailAttendWrap").classList.contains("hidden")) {
        payload.attended = pvDetailPendingAttended;
      }
      const data = await apiPost(payload);
      if (data.error) throw new Error(data.error);
      closePvDetail();
      await loadProgramVolunteers();
    } catch (e) {
      err.textContent = friendlyError(e.message);
      err.style.display = "block";
    } finally {
      setButtonBusy(btn, false);
    }
  }

  /* ── Nurturing notifications (Web Push via the Sandesha bridge) ── */

  async function updateVolunteerPushBtn() {
    const btns = [$("volunteerPushBtn"), $("oppPushBtn")].filter(Boolean);
    const ok = window.VjnVol && window.VjnVol.pushSupported && window.VjnVol.pushSupported();
    if (!ok) {
      btns.forEach(function (b) { b.classList.add("hidden"); });
      return;
    }
    btns.forEach(function (b) { b.classList.remove("hidden"); });
    try {
      const s = await window.VjnVol.pushState();
      btns.forEach(function (b) {
        b.textContent = s === "on" ? "Notifications on" : "Notify me";
        b.classList.toggle("is-busy", false);
        b.classList.toggle("is-on", s === "on");
      });
    } catch (e) {}
  }

  async function toggleVolunteerPush(e) {
    const btn = (e && e.currentTarget) || $("volunteerPushBtn");
    setButtonBusy(btn, true, "…");
    try {
      const s = await window.VjnVol.pushState();
      if (s === "on") await window.VjnVol.disablePush();
      else await window.VjnVol.enablePush();
    } catch (err) {
      toastMsg(err.message || "Could not change notifications");
    } finally {
      setButtonBusy(btn, false);
      updateVolunteerPushBtn();
    }
  }

  /** admin.html has no toast surface outside the promo panel — use the status line. */
  let toastTimer = 0;
  /** Small floating message — visible on every page, unlike the toolbar status line. */
  const TOAST_ICONS = {
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v5M12 16.5h.01"/></svg>',
    progress: '<span class="admin-toast-spin" aria-hidden="true"></span>',
  };

  /** Floating status card. opts: { tone: info|success|warn|progress, title, ms }.
   * With a title, `message` becomes the smaller detail line under it. */
  function showToast(message, opts) {
    if (!message) return;
    const o = opts || {};
    const tone = TOAST_ICONS[o.tone] ? o.tone : "info";
    let el = $("adminToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "adminToast";
      el.className = "admin-toast";
      el.setAttribute("role", "status");
      el.addEventListener("click", function () { el.classList.remove("show"); });
      document.body.appendChild(el);
    }
    el.className = "admin-toast is-" + tone;
    el.innerHTML =
      '<span class="admin-toast-ico">' + TOAST_ICONS[tone] + "</span>" +
      '<span class="admin-toast-text">' +
      (o.title ? "<b>" + escapeHtml(o.title) + "</b><span>" + escapeHtml(message) + "</span>" : "<b>" + escapeHtml(message) + "</b>") +
      "</span>";
    void el.offsetWidth; // restart the entrance when a toast replaces another
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, o.ms || (o.title ? 5200 : 3200));
  }

  function toastMsg(message) {
    setStatus(message, true);
    showToast(message);
  }

  /* ── Bottom drawers ────────────────────────────────────────────────── */

  function openBSheet(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("bsheet-lock");
  }

  function closeBSheet(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("open");
    el.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".bsheet-overlay.open")) {
      document.documentElement.classList.remove("bsheet-lock");
    }
  }

  function initBSheets() {
    document.querySelectorAll(".bsheet-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay || e.target.closest("[data-bsheet-close]")) closeBSheet(overlay.id);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      document.querySelectorAll(".bsheet-overlay.open").forEach(function (o) { closeBSheet(o.id); });
    });
    // Swipe down on the grip / header to dismiss, following the finger.
    document.querySelectorAll(".bsheet").forEach(function (sheet) {
      const overlay = sheet.closest(".bsheet-overlay");
      const zone = [sheet.querySelector(".bsheet-grip"), sheet.querySelector(".bsheet-head")];
      let startY = 0;
      let dy = 0;
      let dragging = false;
      const onMove = function (e) {
        if (!dragging) return;
        dy = Math.max(0, e.clientY - startY);
        sheet.style.transform = "translateY(" + dy + "px)";
      };
      const onEnd = function () {
        if (!dragging) return;
        dragging = false;
        sheet.style.transition = "";
        sheet.style.transform = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        if (dy > 90) closeBSheet(overlay.id);
        dy = 0;
      };
      zone.forEach(function (el) {
        if (!el) return;
        el.classList.add("bsheet-drag");
        el.addEventListener("pointerdown", function (e) {
          if (e.target.closest("button")) return;
          dragging = true;
          startY = e.clientY;
          sheet.style.transition = "none";
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onEnd);
          window.addEventListener("pointercancel", onEnd);
        });
      });
    });
  }

  const FREE_OFFERING_TITLES = [
    "sannidhi pooja",
    "satsang",
    "devi divya pooja",
    "daily guru pooja",
    "guru pooja",
  ];

  function offeringTitleKey(title) {
    return String(title || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function titleLooksFreeOffering(title) {
    const key = offeringTitleKey(title);
    if (!key) return false;
    return FREE_OFFERING_TITLES.some(function (name) {
      return key === name || key.indexOf(name) !== -1;
    });
  }

  function isNoOfferingValue(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase();
    return s === "no" || s === "false" || s === "0" || s === "n";
  }

  function isFreeOfferingItem(item) {
    const flag = item && (item.free_offering || item.freeoffering || item["free offering"]);
    if (isVolunteerAvailableValue(flag)) return true;
    if (isNoOfferingValue(flag)) return false;
    return !!(item && titleLooksFreeOffering(item.title));
  }

  function setFreeOfferingChecked(on) {
    if ($("fFreeOffering")) $("fFreeOffering").checked = !!on;
  }

  function syncVolunteerNeededField() {
    const on = $("fVolunteerAvailable") && $("fVolunteerAvailable").checked;
    show($("volunteerNeededWrap"), !!on);
    show($("volunteerRequirementsWrap"), !!on);
    if (!on && $("fVolunteersNeeded")) $("fVolunteersNeeded").value = "";
    if (!on && $("fVolunteerRequirements")) $("fVolunteerRequirements").value = "";
  }

  function toggleProgramFields(on) {
    document.querySelectorAll("[data-program-only]").forEach(function (el) {
      el.style.display = on ? "" : "none";
    });
    document.querySelectorAll("[data-volunteer-only]").forEach(function (el) {
      el.style.display = on ? "none" : "";
    });
    if (on) syncVolunteerNeededField();
  }

  function titleEl() {
    return currentResource === "programs" ? $("fTitleProgram") : $("fTitle");
  }

  function getTitleValue() {
    const el = titleEl();
    return el ? el.value.trim() : "";
  }

  async function loadProgramTitles() {
    try {
      const data = await apiGet("programTitles");
      if (!data.error) programTitlesCache = data.titles || [];
    } catch (e) {}
    if (currentResource === "programs" && $("editorOverlay") && $("editorOverlay").classList.contains("open")) {
      populateTitleProgramSelect($("fTitleProgram").value, titleSelectSilent);
    }
  }

  /** `silent`: skip the "(not in ProgramTitles list)" flag — for values the
   * app itself is suggesting (e.g. the Sannidhi quick-fill default), where
   * an unmatched title isn't a user mistake worth warning about. */
  function populateTitleProgramSelect(selected, silent) {
    const select = $("fTitleProgram");
    if (!select) return;
    const opts = ['<option value="">Select a program</option>'];
    programTitlesCache.forEach(function (t) {
      opts.push('<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + "</option>");
    });
    select.innerHTML = opts.join("");
    const val = (selected || "").toString().trim();
    if (!val) {
      select.value = "";
      return;
    }
    const match = programTitlesCache.find(function (t) {
      return t.toLowerCase() === val.toLowerCase();
    });
    if (match) {
      select.value = match;
      return;
    }
    const extra = document.createElement("option");
    extra.value = val;
    extra.textContent = silent ? val : val + " (not in ProgramTitles list)";
    select.appendChild(extra);
    select.value = val;
  }

  function setFlyerResultPreview(url) {
    const img = $("flyerResultPreview");
    if (!img) return;
    const src = url ? fixDriveUrl(url) : "";
    img.src = src || "";
    img.referrerPolicy = "no-referrer";
    img.style.display = src ? "block" : "none";
  }

  function resetFlyerManualUpload() {
    if ($("fFlyerManualFile")) $("fFlyerManualFile").value = "";
    if ($("fFlyerManualFileName")) $("fFlyerManualFileName").textContent = "Choose a flyer";
    if ($("flyerManualPreview")) {
      $("flyerManualPreview").src = "";
      $("flyerManualPreview").style.display = "none";
    }
  }

  function resetFlyerPicker() {
    selectedFlyerTemplateId = "";
    generatedFlyerUrl = "";
    pendingManualFlyer = null;
    flyerTemplatesCache = [];
    if ($("flyerGrid")) $("flyerGrid").innerHTML = "";
    show($("flyerGrid"), false);
    if ($("flyerFieldsList")) $("flyerFieldsList").innerHTML = "";
    show($("flyerFieldsWrap"), false);
    show($("flyerFieldsError"), false);
    resetFlyerManualUpload();
    setFlyerResultPreview("");
    show($("flyerResultWrap"), false);
    if ($("flyerPickerOverlay")) $("flyerPickerOverlay").classList.remove("open", "is-shown");
    show($("selectFlyerBtn"), false);
    setSelectFlyerBtnLoading(false);
    if ($("flyerPickHint")) {
      $("flyerPickHint").textContent = "Choose a program above to see its flyers.";
      show($("flyerPickHint"), true);
    }
  }

  /** Opens the flyer picker sheet (gallery + manual upload). */
  function openFlyerPicker() {
    openSheet("flyerPickerOverlay");
  }

  /** Closes the picker sheet, returning to whichever state matches the current selection. */
  function closeFlyerPicker() {
    closeSheet("flyerPickerOverlay");
    if (generatedFlyerUrl || pendingManualFlyer) {
      show($("flyerResultWrap"), true);
      show($("selectFlyerBtn"), false);
    } else {
      show($("flyerResultWrap"), false);
      show($("selectFlyerBtn"), true);
    }
  }

  /** Shows a chosen/uploaded flyer in the result preview and closes the picker. */
  function showFlyerResult(url, isRealUrl) {
    setFlyerResultPreview(url);
    show($("downloadFlyerBtn"), !!isRealUrl);
    if (isRealUrl) {
      $("downloadFlyerBtn").href = flyerDownloadUrl(url);
      $("flyerResultHint").textContent = "This flyer will be attached to the event when you save.";
    } else {
      $("flyerResultHint").textContent = "This flyer will be uploaded and attached when you save.";
    }
    closeFlyerPicker();
  }

  /** User deliberately picked a different program — clears any staged/attached flyer too,
   * and fills in the official description for that program, if we have one. */
  function onProgramTitleChanged() {
    resetFlyerPicker();
    const desc = findProgramDescription(getTitleValue());
    if (desc && $("fDescription")) $("fDescription").value = desc;
    return loadFlyerGalleryForTitle(getTitleValue());
  }

  /** Fetches the flyer gallery and reveals the "Select a flyer" button, without touching an already-attached flyer. */
  function setSelectFlyerBtnLoading(on) {
    const btn = $("selectFlyerBtn");
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle("is-busy", on);
    if ($("selectFlyerBtnLabel")) {
      $("selectFlyerBtnLabel").textContent = on ? "Loading flyers…" : "Select a flyer";
    }
  }

  async function loadFlyerGalleryForTitle(title) {
    if (!title) {
      show($("flyerPickHint"), true);
      $("flyerPickHint").textContent = "Choose a program above to see its flyers.";
      show($("selectFlyerBtn"), false);
      return;
    }
    show($("flyerPickHint"), false);
    show($("selectFlyerBtn"), true);
    setSelectFlyerBtnLoading(true);
    try {
      const data = await apiGet("flyerTemplates", true, { title: title });
      flyerTemplatesCache = data.error ? [] : data.templates || [];
    } catch (e) {
      flyerTemplatesCache = [];
    }
    setSelectFlyerBtnLoading(false);
    renderFlyerGrid();
  }

  function renderFlyerGrid(gridId, templates, deletable) {
    const grid = $(gridId || "flyerGrid");
    templates = templates || flyerTemplatesCache;
    if (!grid) return;
    if (!templates.length) {
      grid.innerHTML = "";
      show(grid, false);
      return;
    }
    grid.innerHTML = templates
      .map(function (t) {
        const slideNote =
          t.slide_index && Number(t.slide_index) > 0
            ? '<span class="admin-flyer-card-meta">Slide ' + escapeHtml(String(t.slide_index)) + "</span>"
            : "";
        const delBtn = deletable
          ? '<button type="button" class="admin-flyer-delete" data-flyer-delete="' +
            escapeHtml(t.template_id) +
            '" aria-label="Delete ' +
            escapeHtml(t.label || "flyer") +
            '" title="Delete template">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>' +
            "</button>"
          : "";
        return (
          (deletable ? '<div class="admin-flyer-item">' : "") +
          '<button type="button" class="admin-flyer-card" data-flyer-id="' +
          escapeHtml(t.template_id) +
          '">' +
          '<span class="admin-flyer-card-thumb-wrap is-busy">' +
          '<img class="admin-flyer-card-thumb" src="' +
          escapeHtml(t.thumbnail_url ? fixDriveUrl(t.thumbnail_url) : "") +
          '" alt="" referrerpolicy="no-referrer"/>' +
          "</span>" +
          '<span class="admin-flyer-card-label">' +
          escapeHtml(t.label || "Flyer") +
          "</span>" +
          slideNote +
          "</button>" +
          delBtn +
          (deletable ? "</div>" : "")
        );
      })
      .join("");
    grid.querySelectorAll(".admin-flyer-card-thumb").forEach(function (img) {
      const wrap = img.closest(".admin-flyer-card-thumb-wrap");
      const clear = function () {
        if (wrap) wrap.classList.remove("is-busy");
      };
      if (img.complete) clear();
      else {
        img.addEventListener("load", clear, { once: true });
        img.addEventListener("error", clear, { once: true });
      }
    });
    show(grid, true);
  }

  function flyerTemplateById(id) {
    return (
      flyerTemplatesCache.find(function (t) {
        return String(t.template_id) === String(id);
      }) || null
    );
  }

  function selectFlyerTemplate(id) {
    selectedFlyerTemplateId = id || "";
    document.querySelectorAll("#flyerGrid [data-flyer-id]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-flyer-id") === selectedFlyerTemplateId);
    });
    show($("flyerFieldsError"), false);
    const template = flyerTemplateById(selectedFlyerTemplateId);
    if (!template) {
      show($("flyerFieldsWrap"), false);
      return;
    }
    renderFlyerFieldsForm(template);
    show($("flyerFieldsWrap"), true);
  }

  function flyerFieldInputType(kind) {
    if (kind === "url" || kind === "time") return kind;
    return "text";
  }

  function renderFlyerFieldsForm(template, listId, idPrefix) {
    const list = $(listId || "flyerFieldsList");
    idPrefix = idPrefix || "flyerField_";
    if (!list) return;
    list.innerHTML = (template.fields || [])
      .map(function (f, idx) {
        return (
          '<div class="form-group admin-flyer-field-group">' +
          '<label for="' +
          idPrefix +
          idx +
          '">' +
          escapeHtml(f.label || f.key) +
          "</label>" +
          '<input type="' +
          flyerFieldInputType(f.type) +
          '" id="' +
          idPrefix +
          idx +
          '" data-flyer-field-key="' +
          escapeHtml(f.key) +
          '" required/></div>'
        );
      })
      .join("");
  }

  function collectFlyerFieldValues(listId) {
    const values = {};
    document.querySelectorAll("#" + (listId || "flyerFieldsList") + " [data-flyer-field-key]").forEach(function (input) {
      values[input.getAttribute("data-flyer-field-key")] = input.value.trim();
    });
    return values;
  }

  function clearFlyerFieldErrors(listId) {
    document.querySelectorAll("#" + (listId || "flyerFieldsList") + " .form-group.has-error").forEach(function (group) {
      group.classList.remove("has-error");
      const note = group.querySelector(".admin-field-err");
      if (note) note.remove();
    });
  }

  /* ── Auto-save a freshly generated flyer to the device ───────────────────
   * A browser only allows a fully silent file write via the File System
   * Access API, and only once a Pictures folder has already been granted —
   * the same handle admin-promotions.js saves the first time someone uses
   * its Download button, shared here through the same IndexedDB entry.
   * Without that, the best we can do without popping our own dialog is a
   * plain browser download (no picker, no share sheet) — it lands wherever
   * the browser normally saves downloads instead of the gallery, but still
   * needs no extra tap from the admin. */
  const FLYER_GALLERY_DB = "vjn-promo-gallery";
  const FLYER_GALLERY_STORE = "handles";
  const FLYER_GALLERY_KEY = "dir";

  function openFlyerGalleryDb() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(FLYER_GALLERY_DB, 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(FLYER_GALLERY_STORE)) {
          db.createObjectStore(FLYER_GALLERY_STORE);
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

  async function loadFlyerGalleryHandle() {
    try {
      const db = await openFlyerGalleryDb();
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(FLYER_GALLERY_STORE, "readonly");
        const getReq = tx.objectStore(FLYER_GALLERY_STORE).get(FLYER_GALLERY_KEY);
        getReq.onsuccess = function () {
          resolve(getReq.result || null);
        };
        getReq.onerror = function () {
          reject(getReq.error);
        };
      });
    } catch (e) {
      return null;
    }
  }

  /** Only ever *checks* permission — never requests it — so this stays silent. */
  async function trySilentFlyerGalleryDir() {
    if (typeof window.showDirectoryPicker !== "function") return null;
    const handle = await loadFlyerGalleryHandle();
    if (!handle) return null;
    try {
      const perm = await handle.queryPermission({ mode: "readwrite" });
      return perm === "granted" ? handle : null;
    } catch (e) {
      return null;
    }
  }

  function base64ToBlob(base64, mime) {
    const bin = atob(String(base64 || ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "image/png" });
  }

  function triggerFlyerAnchorDownload(blob, filename) {
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

  function flyerAutoSaveName(label, mime) {
    const base =
      String(label || "flyer")
        .replace(/[^\w\s-]+/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 40) || "flyer";
    const ext = /png/i.test(mime || "") ? ".png" : /webp/i.test(mime || "") ? ".webp" : ".jpg";
    return base + "-" + Date.now() + ext;
  }

  /** Fire-and-forget: saves the just-generated flyer to the device without
   * waiting on or blocking the generate button. Never throws — the manual
   * Download button is still there if this can't find a silent path. */
  async function autoSaveGeneratedFlyer(url, label) {
    try {
      const data = await apiPost({ formType: "adminGetImage", token: token(), url: url });
      if (data.error || !data.base64) return;
      const mime = data.mimeType || "image/png";
      const blob = base64ToBlob(data.base64, mime);
      const filename = data.filename || flyerAutoSaveName(label, mime);
      const dir = await trySilentFlyerGalleryDir();
      const hint = $("flyerResultHint");
      if (dir) {
        const fileHandle = await dir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        if (hint) hint.textContent = "Saved to your gallery folder — also attached when you save this event.";
        return;
      }
      triggerFlyerAnchorDownload(blob, filename);
      if (hint) hint.textContent = "Downloaded to your device — also attached when you save this event.";
    } catch (e) {
      // Best-effort only.
    }
  }

  async function generateFlyer() {
    const template = flyerTemplateById(selectedFlyerTemplateId);
    if (!template) return;
    const fields = collectFlyerFieldValues();
    clearFlyerFieldErrors();
    const errEl = $("flyerFieldsError");
    show(errEl, false);

    // Every field is required, regardless of the template's own flag —
    // a flyer with a blank date/name slot is never actually usable.
    let firstError = null;
    (template.fields || []).forEach(function (f, idx) {
      if (!String(fields[f.key] || "").trim()) {
        const target = setFieldError("flyerField_" + idx, "This field is required.");
        if (!firstError) firstError = target;
      }
    });
    if (firstError) {
      focusFieldError(firstError);
      return;
    }

    const btn = $("generateFlyerBtn");
    const label = btn.querySelector("span");
    const idleLabel = label ? label.textContent : btn.textContent;
    const progress = $("flyerGenerateProgress");
    btn.disabled = true;
    if (label) label.textContent = "Generating…";
    else btn.textContent = "Generating…";
    show(progress, true);
    if (progress) progress.setAttribute("aria-hidden", "false");
    try {
      const data = await apiPost({
        formType: "adminGenerateFlyer",
        token: token(),
        templateId: selectedFlyerTemplateId,
        fields: fields,
      });
      if (data.error) throw new Error(data.error);
      pendingManualFlyer = null;
      generatedFlyerUrl = data.url;
      showFlyerResult(data.url, true);
      autoSaveGeneratedFlyer(data.url, template.label);
    } catch (e) {
      errEl.textContent = friendlyError(e.message);
      show(errEl, true);
    } finally {
      btn.disabled = false;
      if (label) label.textContent = idleLabel;
      else btn.textContent = idleLabel;
      show(progress, false);
      if (progress) progress.setAttribute("aria-hidden", "true");
    }
  }


  /* ── Program names (Admin → Settings) — the list Programs picks from ── */
  function renderProgramTitlesList() {
    const host = $("ptList");
    if (!host) return;
    if ($("ptMeta")) $("ptMeta").textContent = programTitlesCache.length + (programTitlesCache.length === 1 ? " program" : " programs");
    host.innerHTML = programTitlesCache.length
      ? programTitlesCache.map(function (t) {
          return '<li class="pt-item">' + escapeHtml(t) + "</li>";
        }).join("")
      : '<li class="admin-empty">No program names yet.</li>';
  }

  /* ── Settings → Sandesha activities (admin) ──────────────────────────────
   * Every team's WhatsApp activity from Sandesha's server-side log: who started
   * it, when, whether it worked and why not. Rows sharing a corrId (one
   * broadcast's or schedule's per-chat sends) collapse into one entry; opening
   * it shows the full record plus every related step.
   */
  const SA_TEAM_LABEL = { admin: "Admin", promotions: "Promotions", nurturing: "Nurturing", programs: "Programs", system: "System" };
  const SA_CATEGORY_LABEL = {
    send: "Message send", schedule: "Scheduled message", members: "Add members to group",
    group: "Group", set: "Group set", contact: "Contact", system: "System", auth: "Login",
  };
  const SA_VIA_LABEL = {
    manual: "Sent by hand", bulk: "Bulk send", broadcast: "Broadcast to all groups",
    scheduled: "Sent automatically on schedule", api: "Sandesha app",
  };
  const SA_STATUS = {
    ok: { label: "Success", cls: "ok" },
    info: { label: "Done", cls: "ok" },
    warn: { label: "Partly failed", cls: "warn" },
    err: { label: "Failed", cls: "err" },
  };
  let saEntries = [];
  let saTeam = "all";
  let saStatus = "all";
  let saGroupNames = null;

  function saTeamOf(row) {
    const r = row.actor && row.actor.role;
    return SA_TEAM_LABEL[r] ? r : "system";
  }

  function saWho(row) {
    if (row.actor && row.actor.name) return row.actor.name;
    return row.via === "scheduled" ? "Scheduler (creator not recorded)" : "System / WhatsApp bot";
  }

  function saTargetName(target) {
    if (!target) return "";
    if (saGroupNames && saGroupNames[target]) return saGroupNames[target];
    const m = String(target).match(/^(\d{10,13})@(c\.us|s\.whatsapp\.net)$/);
    if (m) return "+" + m[1];
    return String(target);
  }

  function saFmtDate(iso, withSeconds) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("en-IN", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", second: withSeconds ? "2-digit" : undefined,
    });
  }

  function saDayLabel(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yst = new Date();
    yst.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yst.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }

  /** One Sandesha action fans out into a row per chat; show it once. */
  function saCollapse(rows) {
    const out = [];
    const byCorr = {};
    rows.forEach(function (r, i) {
      r._key = r.id || (r.at + "-" + i);
      if (!r.corrId) { out.push(r); return; }
      (byCorr[r.corrId] = byCorr[r.corrId] || []).push(r);
    });
    Object.keys(byCorr).forEach(function (k) {
      const group = byCorr[k].sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); });
      const isPerChat = function (r) { return r.category === "send" && r.meta && "chars" in r.meta; };
      const head = group.find(function (r) { return !isPerChat(r); }) || group[0];
      const entry = Object.assign({}, head, { _related: group.length > 1 ? group : null });
      if (!entry.actor) {
        const withActor = group.find(function (r) { return r.actor; });
        if (withActor) entry.actor = withActor.actor;
      }
      out.push(entry);
    });
    return out.sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); });
  }

  function saMatches(row, q) {
    if (saTeam !== "all" && saTeamOf(row) !== saTeam) return false;
    if (saStatus === "ok" && (row.type === "err" || row.type === "warn")) return false;
    if (saStatus === "fail" && row.type !== "err" && row.type !== "warn") return false;
    if (!q) return true;
    const m = row.meta || {};
    const hay = [row.title, row.detail, saWho(row), saTargetName(row.target), m.message, m.caption, m.group, m.set]
      .join(" ").toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function renderSandeshaActivity() {
    const list = $("saList");
    if (!list) return;
    const q = ($("saSearch") && $("saSearch").value || "").trim().toLowerCase();
    const rows = saEntries.filter(function (r) { return saMatches(r, q); });
    const failed = rows.filter(function (r) { return r.type === "err" || r.type === "warn"; }).length;
    if ($("saMeta")) {
      $("saMeta").textContent = saEntries.length
        ? rows.length + (rows.length === 1 ? " activity" : " activities") + (failed ? " · " + failed + " with failures" : "")
        : "";
    }
    if (!rows.length) {
      list.innerHTML = '<div class="admin-empty">' + (saEntries.length ? "Nothing matches these filters." : "No Sandesha activity yet.") + "</div>";
      return;
    }
    let lastDay = "";
    list.innerHTML = rows.map(function (r) {
      const st = SA_STATUS[r.type] || SA_STATUS.ok;
      const day = saDayLabel(r.at);
      const head = day !== lastDay ? '<div class="sa-day">' + escapeHtml(day) + "</div>" : "";
      lastDay = day;
      const target = r.meta && r.meta.group ? r.meta.group : saTargetName(r.target);
      const time = new Date(r.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
      return head +
        '<button type="button" class="sa-row" data-sa-key="' + escapeHtml(r._key) + '">' +
          '<span class="sa-dot ' + st.cls + '" aria-hidden="true"></span>' +
          '<span class="sa-row-main">' +
            '<span class="sa-row-title">' + escapeHtml(r.title || SA_CATEGORY_LABEL[r.category] || "Activity") + "</span>" +
            (target ? '<span class="sa-row-target">' + escapeHtml(target) + "</span>" : "") +
            (r.detail ? '<span class="sa-row-detail">' + escapeHtml(r.detail) + "</span>" : "") +
            '<span class="sa-row-meta">' + escapeHtml(saWho(r)) + " · " +
              '<span class="sa-team sa-team-' + saTeamOf(r) + '">' + escapeHtml(SA_TEAM_LABEL[saTeamOf(r)]) + "</span> · " +
              escapeHtml(time) + "</span>" +
          "</span>" +
          '<span class="sa-status ' + st.cls + '">' + escapeHtml(st.label) + "</span>" +
        "</button>";
    }).join("");
  }

  async function loadSandeshaActivity() {
    const list = $("saList");
    if (!list) return;
    // Only admin sees every team; other teams get just their own rows (the
    // server filters), so the team chips would be noise.
    const isAdmin = role() === "admin";
    show($("saTeamFilters"), isAdmin);
    if (!isAdmin) saTeam = "all";
    list.innerHTML = '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading…</div>';
    if ($("saMeta")) $("saMeta").textContent = "";
    try {
      if (!window.VjnVol) throw new Error("Messaging is unavailable right now.");
      await window.VjnVol.ready;
      if (!vnBridgeReady()) throw new Error("Could not connect to the Sandesha server.");
      const results = await Promise.all([
        window.VjnVol.listActivity(500),
        saGroupNames ? Promise.resolve(null) : window.VjnVol.listGroups().catch(function () { return null; }),
      ]);
      if (results[1]) {
        saGroupNames = {};
        results[1].forEach(function (g) { saGroupNames[g.jid] = g.name; });
      }
      saEntries = saCollapse(results[0]);
      renderSandeshaActivity();
    } catch (err) {
      list.innerHTML = '<div class="admin-empty">' + escapeHtml(err.message || "Could not load activity.") + "</div>";
    }
  }

  function saField(label, value, cls) {
    if (value === undefined || value === null || value === "") return "";
    return '<div class="sa-field' + (cls ? " " + cls : "") + '"><dt>' + escapeHtml(label) + "</dt><dd>" + value + "</dd></div>";
  }

  function saText(v) {
    return escapeHtml(String(v));
  }

  /** Per-recipient outcome, whatever shape the action recorded it in. */
  function saResultsTable(m) {
    let rows = [];
    if (Array.isArray(m.results)) {
      rows = m.results.map(function (r) {
        return { who: "+" + String(r.number).replace(/^\+/, ""), ok: !!r.ok, text: r.ok ? "Sent" : (r.error || "Failed") };
      });
    } else if (m.results && typeof m.results === "object") {
      const errs = Array.isArray(m.errors) ? m.errors : [];
      rows = Object.keys(m.results).map(function (num) {
        const res = m.results[num];
        const why = errs.find(function (e) { return String(e).indexOf(num + ":") === 0; });
        const text = res === "added" ? "Added" : res === "invited" ? "Sent a join link" : "Failed" + (why ? " — " + String(why).slice(num.length + 1).trim() : "");
        return { who: "+" + num, ok: res !== "failed", text: text };
      });
    }
    if (Array.isArray(m.failures)) {
      m.failures.forEach(function (f) {
        rows.push({ who: saTargetName(f.target), ok: false, text: f.error || "Failed" });
      });
    }
    if (!rows.length) return "";
    rows.sort(function (a, b) { return Number(a.ok) - Number(b.ok); });
    return '<h3 class="sa-sub">Recipients</h3><ul class="sa-results">' + rows.map(function (r) {
      return '<li class="' + (r.ok ? "ok" : "err") + '"><span>' + escapeHtml(r.who) + "</span><span>" + escapeHtml(r.text) + "</span></li>";
    }).join("") + "</ul>";
  }

  function openSandeshaActivity(key) {
    const r = saEntries.find(function (e) { return e._key === key; });
    if (!r) return;
    const m = r.meta || {};
    const st = SA_STATUS[r.type] || SA_STATUS.ok;
    const hasPerRecipient = !!(m.results || (Array.isArray(m.failures) && m.failures.length));
    const reason = m.error || m.reason || (m.stopped ? "Stopped: " + m.stopped : "") ||
      ((r.type === "err" || r.type === "warn") && !hasPerRecipient ? r.detail : "");
    const generalErrors = Array.isArray(m.errors)
      ? m.errors.filter(function (e) { return !/^\d{6,}:/.test(String(e)); })
      : [];
    const target = m.group || m.set || saTargetName(r.target || m.target);

    $("saDetailTitle").textContent = r.title || SA_CATEGORY_LABEL[r.category] || "Activity";
    let html = '<dl class="sa-fields">' +
      saField("Result", '<span class="sa-status ' + st.cls + '">' + escapeHtml(st.label) + "</span>") +
      saField("Date & time", saText(saFmtDate(r.at, true))) +
      saField("Team", saText(SA_TEAM_LABEL[saTeamOf(r)])) +
      saField("Started by", saText(saWho(r))) +
      saField("Activity", saText(SA_CATEGORY_LABEL[r.category] || r.category)) +
      saField("How", r.via ? saText(SA_VIA_LABEL[r.via] || r.via) : "") +
      saField("To", target ? saText(target) : "") +
      saField("Failure reason", reason ? saText(reason) : "", "sa-field-err") +
      saField("Summary", r.detail && r.detail !== reason ? saText(r.detail) : "") +
      saField("Total", m.total != null ? saText(m.total) : "") +
      saField("Succeeded", m.sent != null ? saText(m.sent) : (m.added != null ? saText(m.added) : "")) +
      saField("Join link sent", m.invited ? saText(m.invited) : "") +
      saField("Failed", m.failed ? saText(m.failed) : (Array.isArray(m.failures) && m.failures.length ? saText(m.failures.length) : "")) +
      saField("Scheduled for", m.runAt ? saText(saFmtDate(m.runAt)) : "") +
      saField("Scheduled on", m.createdAt ? saText(saFmtDate(m.createdAt)) : "") +
      saField("Attachment", m.file ? saText(m.file) : "") +
      saField("Already sent to", Array.isArray(m.sentTo) && m.sentTo.length
        ? saText(m.sentTo.map(saTargetName).join(", ")) : "") +
      "</dl>";
    const message = m.message || m.caption;
    if (message) html += '<h3 class="sa-sub">Message</h3><div class="sa-message">' + escapeHtml(message) + "</div>";
    if (generalErrors.length) {
      html += '<h3 class="sa-sub">Errors</h3><ul class="sa-errors">' + generalErrors.map(function (e) {
        return "<li>" + escapeHtml(e) + "</li>";
      }).join("") + "</ul>";
    }
    html += saResultsTable(m);
    if (r._related) {
      html += '<h3 class="sa-sub">Every step (' + r._related.length + ')</h3><ul class="sa-steps">' +
        r._related.slice().reverse().map(function (s) {
          const sst = SA_STATUS[s.type] || SA_STATUS.ok;
          return '<li><span class="sa-dot ' + sst.cls + '" aria-hidden="true"></span><span>' +
            escapeHtml(s.title) + (s.detail ? " — " + escapeHtml(s.detail) : "") +
            '<small>' + escapeHtml(saFmtDate(s.at, true)) + "</small></span></li>";
        }).join("") + "</ul>";
    }
    html += '<details class="sa-raw"><summary>Technical details</summary><pre>' +
      escapeHtml(JSON.stringify(Object.assign({}, r, { _related: undefined, _key: undefined }), null, 2)) +
      "</pre></details>";
    $("saDetailBody").innerHTML = html;
    $("saDetailOverlay").classList.add("open");
  }

  function closeSandeshaActivity() {
    $("saDetailOverlay").classList.remove("open");
  }

  function initSandeshaActivity() {
    if (!$("sandeshaActivityPanel")) return;
    function bindChips(attr, set) {
      document.querySelectorAll("[" + attr + "]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          set(btn.getAttribute(attr));
          document.querySelectorAll("[" + attr + "]").forEach(function (b) {
            b.classList.toggle("active", b === btn);
          });
          renderSandeshaActivity();
        });
      });
    }
    bindChips("data-sa-team", function (v) { saTeam = v; });
    bindChips("data-sa-status", function (v) { saStatus = v; });
    $("saSearch").addEventListener("input", renderSandeshaActivity);
    $("saRefresh").addEventListener("click", function () {
      if (window.sectionLoading) window.sectionLoading($("sandeshaActivityPanel"), loadSandeshaActivity());
      else loadSandeshaActivity();
    });
    $("saList").addEventListener("click", function (e) {
      const row = e.target.closest("[data-sa-key]");
      if (row) openSandeshaActivity(row.getAttribute("data-sa-key"));
    });
    $("saDetailClose").addEventListener("click", closeSandeshaActivity);
    $("saDetailOverlay").addEventListener("click", function (e) {
      if (e.target === $("saDetailOverlay")) closeSandeshaActivity();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("saDetailOverlay").classList.contains("open")) closeSandeshaActivity();
    });
  }

  /* ── Settings → Sandesha WhatsApp status (admin + nurturing) ─────────────
   * Reads Sandesha's public /health, so it works before any login exchange,
   * and re-checks every 20s while Settings is open. */
  let sxTimer = null;

  function sandeshaBase() {
    let base = "";
    try { base = localStorage.getItem("sandesha_api") || ""; } catch (e) {}
    return String(base || window.SANDESHA_API_URL || "").replace(/\/$/, "");
  }

  function sandeshaStatusView(health) {
    const wa = (health && health.whatsapp) || {};
    const state = String(wa.state || "");
    const since = wa.updatedAt
      ? "Since " + new Date(wa.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
      : "";
    if (wa.connected) {
      return { tone: "ok", line: "Connected — messages and group adds will go out", sub: since };
    }
    if (wa.pairingCode || wa.qrAvailable || wa.needsPairing || state === "pairing") {
      return {
        tone: "err",
        line: "Logged out — WhatsApp needs to be linked again",
        sub: role() === "admin" ? "Open Tools to link it." : "Ask the admin to relink Sandesha. Nothing can be sent until then.",
        qr: true,
      };
    }
    if (/connecting|authenticated|loading|starting/.test(state)) {
      return { tone: "warn", line: "Connecting…", sub: "Usually ready within a minute." };
    }
    const why = String(wa.reason || "").split(":")[0].replace(/_/g, " ");
    return {
      tone: "err",
      line: "Disconnected — nothing can be sent right now",
      sub: [since, role() === "admin" ? (why ? "Reason: " + why : "") : "Let the admin know."].filter(Boolean).join(" · "),
    };
  }

  function renderSandeshaStatus(view) {
    const card = $("sandeshaStatus");
    if (!card) return;
    card.setAttribute("data-tone", view.tone);
    $("sandeshaStatusLine").textContent = view.line;
    const checked = "Checked " + new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" });
    $("sandeshaStatusSub").textContent = [view.sub, checked].filter(Boolean).join(" · ");
    show($("sandeshaStatusSub"), true);
    show($("sandeshaQrMail"), Boolean(view.qr));
  }

  /** Asks the Sandesha server to mail the current QR to its notify address. */
  async function emailSandeshaQr() {
    const btn = $("sandeshaQrMail");
    const base = sandeshaBase();
    if (!btn || btn.disabled || !base) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const res = await fetch(base + "/pairing/email-qr", { method: "POST" });
      const data = await res.json().catch(function () { return {}; });
      btn.textContent = res.ok ? "QR sent to email" : (data.error || "Could not send");
    } catch (e) {
      btn.textContent = "Can't reach the server";
    }
    setTimeout(function () { btn.disabled = false; btn.textContent = label; }, 4000);
  }

  /** Manual ↻: spin for at least a beat and flash the card, so a quick
   * answer (or an unchanged one) still visibly registers. */
  async function refreshSandeshaStatus() {
    const btn = $("sandeshaStatusRefresh");
    const card = $("sandeshaStatus");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    card.classList.add("is-checking");
    $("sandeshaStatusLine").textContent = "Checking…";
    try {
      const results = await Promise.all([checkSandeshaStatus(true), new Promise(function (r) { setTimeout(r, 700); })]);
      renderSandeshaStatus(results[0]);
    } finally {
      card.classList.remove("is-checking");
      btn.disabled = false;
      card.classList.remove("is-refreshed");
      void card.offsetWidth; // restart the flash animation
      card.classList.add("is-refreshed");
    }
  }

  /** Fetches and shows the status; with `manual`, returns the view instead
   * so the caller can show it once its spinner has had its moment. */
  async function checkSandeshaStatus(manual) {
    const base = sandeshaBase();
    let view;
    if (!base) {
      view = { tone: "err", line: "Sandesha server not set", sub: "" };
      if (manual) return view;
      renderSandeshaStatus(view);
      return;
    }
    const card = $("sandeshaStatus");
    if (card && !manual) card.classList.add("is-checking");
    try {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const t = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
      const res = await fetch(base + "/health", { cache: "no-store", signal: ctrl ? ctrl.signal : undefined });
      if (t) clearTimeout(t);
      if (!res.ok) throw new Error("HTTP " + res.status);
      view = sandeshaStatusView(await res.json());
    } catch (e) {
      view = {
        tone: "err",
        line: "Can't reach the Sandesha server",
        sub: role() === "admin" ? "The laptop or Pi running it may be off or offline." : "Let the admin know. Nothing can be sent until it's back.",
      };
    } finally {
      if (card && !manual) card.classList.remove("is-checking");
    }
    if (manual) return view;
    renderSandeshaStatus(view);
  }

  function startSandeshaStatus() {
    const card = $("sandeshaStatus");
    const r = role();
    const allowed = r === "admin" || r === "nurturing";
    show(card, allowed);
    stopSandeshaStatus();
    if (!allowed) return;
    checkSandeshaStatus();
    sxTimer = setInterval(function () {
      if (document.hidden) return;
      checkSandeshaStatus();
    }, 20000);
  }

  function stopSandeshaStatus() {
    if (sxTimer) clearInterval(sxTimer);
    sxTimer = null;
  }

  /** Settings lists only what the role may open; say so when that's nothing. */
  function updateSettingsEmpty() {
    const saSub = document.querySelector("[data-sa-sub]");
    if (saSub) {
      saSub.textContent = role() === "admin"
        ? "Everything every team did on WhatsApp: sends, schedules and member adds."
        : "Everything your team did on WhatsApp: messages and group adds.";
    }
    const list = document.querySelector("#settingsPanel .settings-list");
    const empty = $("settingsEmpty");
    if (!list || !empty) return;
    const any = Array.prototype.some.call(list.querySelectorAll(".settings-item"), function (el) {
      return !el.classList.contains("hidden");
    });
    show(list, any);
    show(empty, !any);
  }

  async function loadProgramTitlesPage() {
    if ($("ptList")) {
      $("ptList").innerHTML =
        '<li class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading…</li>';
    }
    await loadProgramTitles();
    renderProgramTitlesList();
  }

  async function submitProgramTitle(ev) {
    ev.preventDefault();
    const input = $("ptInput");
    const err = $("ptError");
    const btn = $("ptAddBtn");
    const title = input.value.replace(/\s+/g, " ").trim();
    err.textContent = "";
    err.style.display = "none";
    if (!title) {
      err.textContent = "Enter a program name.";
      err.style.display = "block";
      input.focus();
      return;
    }
    setButtonBusy(btn, true);
    try {
      const data = await apiPost({ formType: "adminAddProgramTitle", token: token(), title: title });
      if (data.error) throw new Error(data.error);
      programTitlesCache = data.titles || programTitlesCache;
      input.value = "";
      renderProgramTitlesList();
      $("ptMeta").textContent = "Added “" + title + "”. " + $("ptMeta").textContent;
    } catch (e) {
      err.textContent = friendlyError(e.message) || "Could not add the program name.";
      err.style.display = "block";
    } finally {
      setButtonBusy(btn, false);
    }
  }

  /* ── Generate flyer page (Settings → Generate flyer) ─────────────────────
   * Standalone version of the event editor's flyer picker: pick a program,
   * pick one of its flyer templates, fill the fields, generate. */
  let gfTemplates = [];
  let gfSelectedId = "";

  /** Delete is only offered on the admin Flyer templates page. */
  function gfDeletable() {
    return role() === "admin" && (location.hash || "").replace(/^#/, "").toLowerCase() === "flyertemplates";
  }

  function gfTemplateById(id) {
    return gfTemplates.find(function (t) { return String(t.template_id) === String(id); }) || null;
  }

  async function loadGenerateFlyerPage() {
    const select = $("gfProgram");
    if (!select) return;
    if (!programTitlesCache.length) {
      select.innerHTML = '<option value="">Loading programs…</option>';
      await loadProgramTitles();
    }
    const prev = select.value;
    select.innerHTML = ['<option value="">Select a program</option>']
      .concat(programTitlesCache.map(function (t) {
        return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + "</option>";
      }))
      .join("");
    select.value = programTitlesCache.indexOf(prev) >= 0 ? prev : "";
    gfLoadTemplates(select.value);
  }

  function gfResetSelection() {
    gfSelectedId = "";
    if ($("gfFieldsList")) $("gfFieldsList").innerHTML = "";
    show($("gfFieldsWrap"), false);
    show($("gfFieldsError"), false);
    show($("gfResultWrap"), false);
  }

  async function gfLoadTemplates(title) {
    gfTemplates = [];
    gfResetSelection();
    renderFlyerGrid("gfGrid", gfTemplates, gfDeletable());
    const hint = $("gfHint");
    if (!title) {
      hint.textContent = "Choose a program to see its flyers.";
      show(hint, true);
      return;
    }
    hint.textContent = "Loading flyers…";
    show(hint, true);
    try {
      const data = await apiGet("flyerTemplates", true, { title: title });
      if ($("gfProgram").value !== title) return;
      gfTemplates = data.error ? [] : data.templates || [];
    } catch (e) {
      gfTemplates = [];
    }
    if (gfTemplates.length) {
      hint.textContent = gfTemplates.length + (gfTemplates.length === 1 ? " flyer" : " flyers") + " — pick one to fill in.";
    } else {
      hint.textContent = "No flyers for this program yet.";
    }
    renderFlyerGrid("gfGrid", gfTemplates, gfDeletable());
  }

  async function gfDeleteTemplate(id, btn) {
    const t = gfTemplateById(id);
    if (!t) return;
    if (!window.confirm('Delete the "' + (t.label || "flyer") + '" template? It will no longer appear for any program.')) return;
    btn.disabled = true;
    try {
      const data = await apiPost({ formType: "adminDeleteFlyerTemplate", token: token(), templateId: id });
      if (data.error) throw new Error(data.error);
      gfLoadTemplates($("gfProgram").value);
    } catch (e) {
      btn.disabled = false;
      $("gfHint").textContent = friendlyError(e.message) || "Could not delete the template.";
    }
  }

  function gfSelectTemplate(id) {
    gfSelectedId = id || "";
    document.querySelectorAll("#gfGrid [data-flyer-id]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-flyer-id") === gfSelectedId);
    });
    show($("gfFieldsError"), false);
    show($("gfResultWrap"), false);
    const template = gfTemplateById(gfSelectedId);
    if (!template) {
      show($("gfFieldsWrap"), false);
      return;
    }
    renderFlyerFieldsForm(template, "gfFieldsList", "gfField_");
    show($("gfFieldsWrap"), true);
  }

  async function gfGenerate() {
    const template = gfTemplateById(gfSelectedId);
    if (!template) return;
    const fields = collectFlyerFieldValues("gfFieldsList");
    clearFlyerFieldErrors("gfFieldsList");
    const errEl = $("gfFieldsError");
    show(errEl, false);
    let firstError = null;
    (template.fields || []).forEach(function (f, idx) {
      if (!String(fields[f.key] || "").trim()) {
        const target = setFieldError("gfField_" + idx, "This field is required.");
        if (!firstError) firstError = target;
      }
    });
    if (firstError) {
      focusFieldError(firstError);
      return;
    }
    const btn = $("gfGenerateBtn");
    const label = btn.querySelector("span");
    const progress = $("gfProgress");
    btn.disabled = true;
    label.textContent = "Generating…";
    show(progress, true);
    progress.setAttribute("aria-hidden", "false");
    try {
      const data = await apiPost({
        formType: "adminGenerateFlyer",
        token: token(),
        templateId: gfSelectedId,
        fields: fields,
      });
      if (data.error) throw new Error(data.error);
      $("gfResultPreview").src = fixDriveUrl(data.url);
      $("gfResultPreview").style.display = "block";
      $("gfDownloadBtn").href = flyerDownloadUrl(data.url);
      show($("gfResultWrap"), true);
      $("gfResultWrap").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      errEl.textContent = friendlyError(e.message);
      show(errEl, true);
    } finally {
      btn.disabled = false;
      label.textContent = "Generate flyer";
      show(progress, false);
      progress.setAttribute("aria-hidden", "true");
    }
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || "");
        const base64 = result.split(",")[1] || "";
        if (!base64) reject(new Error("Could not read the file."));
        else resolve(base64);
      };
      reader.onerror = function () {
        reject(new Error("Could not read the file."));
      };
      reader.readAsDataURL(file);
    });
  }

  function renderFlyerImportFields() {
    const wrap = $("flyerImportFieldsWrap");
    const list = $("flyerImportFieldsList");
    if (!wrap || !list) return;
    if (!flyerImportPlaceholders.length) {
      list.innerHTML = "";
      show(wrap, false);
      return;
    }
    list.innerHTML = flyerImportPlaceholders
      .map(function (f, idx) {
        return (
          '<div class="flyer-import-field-card">' +
          '<p class="flyer-import-token" title="Text on slide">' +
          escapeHtml(f.token || "") +
          "</p>" +
          '<label class="flyer-import-field-label" for="flyerImportKey_' +
          idx +
          '">Key</label>' +
          '<input type="text" class="admin-input flyer-import-input" id="flyerImportKey_' +
          idx +
          '" data-fi-key="' +
          idx +
          '" value="' +
          escapeHtml(f.key || "") +
          '" autocomplete="off"/>' +
          '<label class="flyer-import-field-label" for="flyerImportLabel_' +
          idx +
          '">Label in form</label>' +
          '<input type="text" class="admin-input flyer-import-input" id="flyerImportLabel_' +
          idx +
          '" data-fi-label="' +
          idx +
          '" value="' +
          escapeHtml(f.label || "") +
          '" autocomplete="off"/>' +
          '<label class="flyer-import-req" for="flyerImportReq_' +
          idx +
          '">' +
          '<input type="checkbox" id="flyerImportReq_' +
          idx +
          '" data-fi-req="' +
          idx +
          '"' +
          (f.required !== false ? " checked" : "") +
          "/>" +
          "<span>Required</span>" +
          "</label>" +
          "</div>"
        );
      })
      .join("");
    show(wrap, true);
  }

  function collectFlyerImportFieldsFromDom() {
    return flyerImportPlaceholders.map(function (f, idx) {
      const keyEl = document.querySelector('[data-fi-key="' + idx + '"]');
      const labelEl = document.querySelector('[data-fi-label="' + idx + '"]');
      const reqEl = document.querySelector('[data-fi-req="' + idx + '"]');
      return {
        token: f.token,
        key: keyEl ? keyEl.value.trim() : f.key,
        label: labelEl ? labelEl.value.trim() : f.label,
        required: reqEl ? reqEl.checked : f.required !== false,
        type: f.type || "text",
      };
    });
  }

  async function loadFlyerImportPage() {
    const err = $("flyerImportError");
    const ok = $("flyerImportSuccess");
    if (err) {
      err.textContent = "";
      err.style.display = "none";
    }
    if (ok) ok.textContent = "";
    try {
      const cfg = await apiGet("flyerImportConfig", true);
      const hint = $("flyerImportMasterHint");
      if (hint && !cfg.error) {
        if (cfg.masterConfigured && cfg.masterUrl) {
          hint.innerHTML =
            "Master deck: " +
            cfg.slideCount +
            ' slide(s). <a href="' +
            escapeHtml(cfg.masterUrl) +
            '" target="_blank" rel="noopener">Open in Google Slides</a>';
        } else {
          hint.textContent =
            "Could not open the square master deck. Confirm the Apps Script account can access that Slides file, then redeploy.";
        }
        if (cfg.driveApiRequired) {
          hint.textContent +=
            " Enable Drive API in Apps Script (Services) before importing.";
        }
      }
      const titles = await apiGet("programTitles", true);
      const host = $("flyerImportPrograms");
      const search = $("flyerImportProgramSearch");
      if (search) search.value = "";
      if (host && !titles.error) {
        const list = titles.titles || [];
        if (!list.length) {
          host.innerHTML = '<p class="admin-field-hint">No programs in ProgramTitles yet.</p>';
        } else {
          host.innerHTML = list
            .map(function (t, idx) {
              const id = "flyerImportProg_" + idx;
              return (
                '<label class="flyer-import-program-option" for="' +
                id +
                '" data-program-search="' +
                escapeHtml(t.toLowerCase()) +
                '">' +
                '<input type="checkbox" id="' +
                id +
                '" data-flyer-program-title value="' +
                escapeHtml(t) +
                '"/>' +
                "<span>" +
                escapeHtml(t) +
                "</span>" +
                "</label>"
              );
            })
            .join("");
        }
        filterFlyerImportPrograms();
      }
    } catch (e) {
      if (err) {
        err.textContent = friendlyError(e.message);
        err.style.display = "block";
      }
    }
  }

  function collectFlyerImportPrograms() {
    const picked = [];
    document.querySelectorAll("#flyerImportPrograms [data-flyer-program-title]").forEach(function (input) {
      if (input.checked) picked.push(input.value.trim());
    });
    return picked.filter(Boolean);
  }

  function filterFlyerImportPrograms() {
    const q = (($("flyerImportProgramSearch") && $("flyerImportProgramSearch").value) || "")
      .trim()
      .toLowerCase();
    const options = document.querySelectorAll("#flyerImportPrograms .flyer-import-program-option");
    let visible = 0;
    options.forEach(function (el) {
      const hay = el.getAttribute("data-program-search") || "";
      const show = !q || hay.indexOf(q) >= 0;
      el.classList.toggle("hidden", !show);
      if (show) visible++;
    });
    const hint = $("flyerImportProgramsHint");
    if (hint && options.length) {
      hint.textContent = q
        ? visible
          ? visible + " program(s) match. Selected programs stay selected even if hidden."
          : "No programs match that search."
        : "Select every program this flyer should appear for.";
    }
  }

  function isFlyerImportImageFile(file) {
    return /\.(png|jpe?g|webp)$/i.test((file && file.name) || "");
  }

  async function onFlyerImportPptxSelected(file) {
    const err = $("flyerImportError");
    const ok = $("flyerImportSuccess");
    if (err) {
      err.textContent = "";
      err.style.display = "none";
    }
    if (ok) ok.textContent = "";
    flyerImportPptxFile = file || null;
    flyerImportPlaceholders = [];
    renderFlyerImportFields();
    if (!file) return;
    if ($("flyerImportPptxName")) $("flyerImportPptxName").textContent = file.name || "File chosen";
    const maxBytes = 8 * 1024 * 1024;
    if (file.size > maxBytes) {
      if (err) {
        err.textContent = "File is too large (max 8 MB).";
        err.style.display = "block";
      }
      flyerImportPptxFile = null;
      return;
    }
    // Images have no editable text to scan — they're imported as a static
    // flyer with no fields, skipping the placeholder-detection round trip.
    if (isFlyerImportImageFile(file)) return;
    setPageBusy(true, "Reading placeholders…");
    try {
      const base64 = await readFileAsBase64(file);
      const data = await apiPost({
        formType: "adminPreviewFlyerPptx",
        token: token(),
        base64: base64,
        filename: file.name,
      });
      if (data.error) throw new Error(data.error);
      flyerImportPlaceholders = data.placeholders || [];
      renderFlyerImportFields();
    } catch (e) {
      flyerImportPptxFile = null;
      if (err) {
        err.textContent = friendlyError(e.message);
        err.style.display = "block";
      }
    } finally {
      setPageBusy(false);
    }
  }

  async function submitFlyerImport(ev) {
    if (ev) ev.preventDefault();
    const err = $("flyerImportError");
    const ok = $("flyerImportSuccess");
    if (err) {
      err.textContent = "";
      err.style.display = "none";
    }
    if (ok) ok.textContent = "";
    if (!flyerImportPptxFile) {
      if (err) {
        err.textContent = "Choose a flyer file first.";
        err.style.display = "block";
      }
      return;
    }
    const templateId = ($("flyerImportTemplateId") && $("flyerImportTemplateId").value.trim()) || "";
    const programTitles = collectFlyerImportPrograms();
    const label = ($("flyerImportLabel") && $("flyerImportLabel").value.trim()) || "";
    if (!templateId || !programTitles.length || !label) {
      if (err) {
        err.textContent = "Fill in template id, label, and select at least one program.";
        err.style.display = "block";
      }
      return;
    }
    const fields = collectFlyerImportFieldsFromDom();
    const btn = $("flyerImportSubmitBtn");
    setButtonBusy(btn, true, "Importing…");
    try {
      const base64 = await readFileAsBase64(flyerImportPptxFile);
      const data = await apiPost({
        formType: "adminImportFlyerTemplate",
        token: token(),
        base64: base64,
        filename: flyerImportPptxFile.name,
        templateId: templateId,
        program_titles: programTitles,
        label: label,
        fields: fields,
      });
      if (data.error) throw new Error(data.error);
      flyerTemplatesCache = [];
      const programsLabel = (data.program_titles || programTitles).join(", ");
      if (ok) {
        ok.textContent =
          "Imported as “" +
          templateId +
          "” (slide " +
          data.slide_index +
          " in master deck). It will appear under Select a flyer for: " +
          programsLabel +
          ".";
      }
      if (data.masterUrl && ok) {
        ok.innerHTML =
          ok.textContent +
          ' <a href="' +
          escapeHtml(data.masterUrl) +
          '" target="_blank" rel="noopener">Open master deck</a>';
      }
      flyerImportPptxFile = null;
      flyerImportPlaceholders = [];
      if ($("flyerImportPptx")) $("flyerImportPptx").value = "";
      if ($("flyerImportPptxName")) $("flyerImportPptxName").textContent = "Choose file";
      renderFlyerImportFields();
      loadFlyerImportPage();
    } catch (e) {
      if (err) {
        err.textContent = friendlyError(e.message);
        err.style.display = "block";
      }
    } finally {
      setButtonBusy(btn, false);
    }
  }

  function setEditorMode(mode) {
    editorMode = mode === "bulk" ? "bulk" : "single";
    document.querySelectorAll("[data-editor-mode]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-editor-mode") === editorMode);
    });
    show($("singleEditorFields"), editorMode === "single");
    show($("bulkEditorFields"), editorMode === "bulk");
    show($("programVolunteerSection"), editorMode === "single" && currentResource === "programs");
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
    row.starttime3 = parsedSlots[2] ? parsedSlots[2].start : "";
    row.endtime3 = parsedSlots[2] ? parsedSlots[2].end : "";

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
        if (parsed[2]) {
          row.starttime3 = parsed[2].start;
          row.endtime3 = parsed[2].end;
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
        row.starttime3 && row.endtime3
          ? { start: row.starttime3, end: row.endtime3 }
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
    const titleValue = (item && item.title) || "";
    $("fTitle").value = titleValue;
    titleSelectSilent = false;
    populateTitleProgramSelect(titleValue);
    resetFlyerPicker();
    if (currentResource === "programs") {
      const attachedFlyerUrl = (item && item.flyer_image) || "";
      const galleryPromise = titleValue ? loadFlyerGalleryForTitle(titleValue) : Promise.resolve();
      if (attachedFlyerUrl) {
        showAttachedFlyer(attachedFlyerUrl);
        galleryPromise.then(function () {
          show($("selectFlyerBtn"), false);
        });
      }
    }
    $("fDescription").value = (item && item.description) || "";
    $("fStartDate").value = parseToInputDate(
      (item && (item.startdate || item["start date"])) || (item && item.date) || ""
    );
    $("fEndDate").value = parseToInputDate(
      (item && (item.enddate || item["end date"])) || (item && item.date) || ""
    );
    loadSlotsIntoForm(item);
    $("fLocation").value = (item && item.location) || DEFAULT_LOCATION;
    setFrequencySelect(item && item.frequency);
    $("fLanguage").value = (item && item.language) || "";
    const registerValue = (item && (item.registerlink || item.registerLink)) || "";
    $("fRegister").value = registerValue;
    setNoRegister(!!item && !String(registerValue).trim());
    setFreeOfferingChecked(isFreeOfferingItem(item));
    $("fImageUrl").value = (item && item.image) || "";
    $("fImageFile").value = "";
    setListingImagePreview((item && item.image) || "");
    setImageFileLabel(item && item.image ? "Replace " + photoWord() : "");
    setImageUrlOpen(false);
    if ($("fBulkPaste")) $("fBulkPaste").value = "";
    show($("bulkPreview"), false);

    if ($("fVolunteerAvailable")) {
      $("fVolunteerAvailable").checked = isVolunteerAvailableValue(
        item && (item.volunteering_available || item.volunteeringavailable)
      );
    }
    if ($("fVolunteersNeeded")) {
      const needed = item && (item.volunteers_needed || item.volunteersneeded);
      $("fVolunteersNeeded").value = needed ? String(needed) : "";
    }
    if ($("fVolunteerRequirements")) {
      $("fVolunteerRequirements").value = (item && item.volunteer_requirements) || "";
    }
    if ($("volunteerProgressNote")) {
      const added = item && Number(item.volunteers_added);
      const note = $("volunteerProgressNote");
      if (added > 0) {
        note.textContent = "Nurturing has recruited " + added + " volunteer" + (added === 1 ? "" : "s") + " so far.";
        note.classList.remove("hidden");
      } else {
        note.classList.add("hidden");
      }
    }
    syncVolunteerNeededField();

    toggleProgramFields(currentResource === "programs");
    const titleLabel = $("fTitleLabel");
    if (titleLabel) titleLabel.textContent = currentResource === "programs" ? "Program name" : "Title";
    const status = ((item && item.status) || "").toString();
    if (currentResource === "programs") {
      $("fStatus").innerHTML = '<option value="Open">Open</option><option value="Closed">Closed</option>';
      $("fStatus").value = /^closed$/i.test(status) ? "Closed" : "Open";
    } else {
      $("fStatus").innerHTML = '<option value="active">Active</option><option value="inactive">Inactive</option>';
      $("fStatus").value = /^inactive$/i.test(status) ? "inactive" : "active";
    }
    $("editorError").style.display = "none";
    clearFieldErrors();
    const isNew = !editingId;
    show($("editorModeTabs"), isNew);
    setEditorMode("single");
    updateTemplateCards();
    setTemplateActive("");
    $("templateHint").textContent = isNew ? templateIdleHint() : "";
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

  /** Show an already-uploaded flyer as the one this event will save with. */
  function showAttachedFlyer(url) {
    generatedFlyerUrl = url;
    setFlyerResultPreview(url);
    $("downloadFlyerBtn").href = flyerDownloadUrl(url);
    show($("downloadFlyerBtn"), true);
    $("flyerResultHint").textContent = "This flyer will be attached to the event when you save.";
    show($("flyerPickHint"), false);
    show($("selectFlyerBtn"), false);
    show($("flyerResultWrap"), true);
  }

  /** keepDraft: true when the editor closes for a reason other than the person
   * finishing with it (signed out), so their typing comes back after login. */
  function closeEditor(keepDraft) {
    $("editorOverlay").classList.remove("open");
    if (keepDraft !== true && window.DraftKeeper) DraftKeeper.clear("editor");
  }

  function waitMs(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /**
   * Android Chrome reloads a tab it discarded in the background, which used to
   * empty a half-filled editor. drafts.js keeps the fields; these say how to
   * reopen the pop-up they live in.
   */
  function watchDrafts() {
    if (!window.DraftKeeper) return;
    DraftKeeper.watch("editor", {
      root: function () { return $("editorOverlay"); },
      isOpen: function () { return $("editorOverlay").classList.contains("open"); },
      meta: function () {
        return {
          resource: currentResource,
          id: editingId,
          hash: location.hash,
          mode: editorMode,
          slots: visibleSlotCount(),
          flyer: generatedFlyerUrl || "",
          hadFile: !!(pendingManualFlyer || pendingImage),
        };
      },
      reopen: async function (meta) {
        if (!meta || !meta.resource) return false;
        const page = pageFromHash(String(meta.hash || "").replace(/^#/, "").toLowerCase());
        if (meta.hash && location.hash !== meta.hash && page) openAdminPage(page, true);
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline && !(listLoadedFor === meta.resource && currentResource === meta.resource)) {
          await waitMs(250);
        }
        if (currentResource !== meta.resource || listLoadedFor !== meta.resource) return false;
        const item = meta.id
          ? items.find(function (it) { return String(it.id) === String(meta.id); })
          : null;
        if (meta.id && !item) return false;
        openEditor(item);
        if (meta.mode === "bulk" && !meta.id) setEditorMode("bulk");
        setVisibleSlotCount(meta.slots || 1);
        return true;
      },
      restored: function (meta) {
        // Picking the title reloads its flyer gallery, so put the flyer back last.
        if (meta && meta.flyer) showAttachedFlyer(meta.flyer);
      },
    });
    DraftKeeper.watch("pvAdd", {
      root: function () { return $("pvAddOverlay"); },
      isOpen: function () { return $("pvAddOverlay") && $("pvAddOverlay").classList.contains("open"); },
      meta: function () { return { eventId: $("pvAddEventId").value, hash: location.hash }; },
      reopen: async function (meta) {
        if (!meta || !meta.eventId || location.hash !== meta.hash || !$("pvAddOverlay")) return false;
        openPvAdd(meta.eventId);
        return true;
      },
    });
  }

  function readFileAsImagePayload(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);

      function finish(imgWidth, imgHeight, draw) {
        try {
          const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(imgWidth || 1, imgHeight || 1));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round((imgWidth || 1) * scale));
          canvas.height = Math.max(1, Math.round((imgHeight || 1) * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Could not prepare that image.");
          draw(ctx, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          resolve({
            mimeType: "image/jpeg",
            filename: (file.name || "upload").replace(/\.[^.]+$/, "") + ".jpg",
            base64: dataUrl.split(",")[1],
            preview: dataUrl,
          });
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err instanceof Error ? err : new Error("Could not read that image."));
        }
      }

      const img = new Image();
      img.onload = function () {
        finish(img.naturalWidth || img.width, img.naturalHeight || img.height, function (ctx, w, h) {
          ctx.drawImage(img, 0, 0, w, h);
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

  /* ── Homepage promo banner (form lives in banner-form.js) ── */

  let bannerUi = null;

  function loadBannerPage() {
    if (bannerUi) return bannerUi.reload();
    bannerUi = window.VjnBanner.mount($("bannerHost"), { token: token });
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
        if (row.starttime3 && row.endtime3) {
          bulkSlots.push({ start: row.starttime3, end: row.endtime3 });
        }
        applySlotsToItem(item, bulkSlots);
        if (currentResource === "programs") {
          item.frequency = (row.frequency || "Scheduled").trim() || "Scheduled";
          item.registerlink = (row.registerlink || "").trim();
          item.language = "English";
          item.free_offering = titleLooksFreeOffering(row.title) ? "yes" : "no";
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
        closeEditor(true);
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
    const title = getTitleValue();
    const titleFieldId = currentResource === "programs" ? "fTitleProgram" : "fTitle";
    const startDate = $("fStartDate").value.trim();
    const endDate = $("fEndDate").value.trim();
    const location = $("fLocation").value.trim() || DEFAULT_LOCATION;
    const slots = collectSlotsFromForm();
    const slotErr = validateSlots(slots);
    const status = $("fStatus").value.trim();
    const imageUrl = $("fImageUrl").value.trim();
    const frequency = $("fFrequency").value.trim();
    const language = $("fLanguage").value.trim();
    const noRegister = isNoRegister();
    const registerlink = noRegister ? "" : $("fRegister").value.trim();
    const problems = [];
    if (!title) problems.push([titleFieldId, "Add a title."]);
    if (!startDate) problems.push(["fStartDate", "Pick a start date."]);
    if (!endDate) problems.push(["fEndDate", "Pick an end date."]);
    else if (startDate && endDate < startDate) {
      problems.push(["fEndDate", "End date must be on or after the start date."]);
    }
    if (slotErr.message) problems.push([slotErr.field, slotErr.message]);
    if (!location) problems.push(["fLocation", "Add a location."]);
    if (!status) problems.push(["fStatus", "Choose a status."]);
    if (currentResource === "programs") {
      if (!generatedFlyerUrl && !pendingManualFlyer) problems.push(["selectFlyerBtn", "Add a flyer."]);
      if (!frequency) problems.push(["fFrequency", "Choose how often this repeats."]);
      if (!language) problems.push(["fLanguage", "Choose a language."]);
      if (!noRegister && !registerlink && !/^sannidhi pooja$/i.test(title)) {
        problems.push(["fRegister", "Add a register link, or tick “Registration not required”."]);
      }
      if ($("fVolunteerAvailable") && $("fVolunteerAvailable").checked) {
        const needed = (($("fVolunteersNeeded") && $("fVolunteersNeeded").value) || "").trim();
        if (!needed || parseInt(needed, 10) < 1) {
          problems.push(["fVolunteersNeeded", "Enter how many volunteers you need."]);
        }
      }
    }
    $("editorError").style.display = "none";
    if (showFieldErrors(problems)) return;
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
      let savedFlyer = generatedFlyerUrl;
      if (pendingManualFlyer) {
        btn.textContent = "Uploading flyer…";
        savedFlyer = await uploadPayload(pendingManualFlyer);
      }
      btn.textContent = "Saving…";
      const item = {
        title: title,
        description: $("fDescription").value.trim(),
        startdate: startDate,
        enddate: endDate,
        date: startDate === endDate ? startDate : startDate + " – " + endDate,
        location: location,
        duration: "",
        image: savedImage,
        status: status,
      };
      applySlotsToItem(item, slots);
      if (currentResource === "programs") {
        item.image = savedFlyer;
        item.frequency = frequency;
        item.language = language;
        item.registerlink = registerlink;
        item.flyer_image = savedFlyer;
        item.free_offering = $("fFreeOffering") && $("fFreeOffering").checked ? "yes" : "no";
        const volunteerOn = $("fVolunteerAvailable") && $("fVolunteerAvailable").checked;
        item.volunteering_available = volunteerOn ? "yes" : "no";
        item.volunteers_needed = volunteerOn
          ? String((($("fVolunteersNeeded") && $("fVolunteersNeeded").value) || "").trim())
          : "";
        item.volunteer_requirements = volunteerOn
          ? (($("fVolunteerRequirements") && $("fVolunteerRequirements").value) || "").trim()
          : "";
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
        closeEditor(true);
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

  /** "Mar-2024" as typed on the form. Sheets sometimes stores it as a date,
   * which comes back as a long date string — turn that back into "Mar 2024". */
  function inquiryIeCompletion(item) {
    const raw = inquiryField(item, "ie completion");
    if (!raw) return "";
    const typed = raw.match(/^([A-Za-z]{3})[-\s](\d{4})$/);
    if (typed) return typed[1] + " " + typed[2];
    const d = new Date(raw);
    if (!isNaN(d)) return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    return raw;
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

  function scopeGroupKeys() {
    return inquiryScope === "attendance" ? [ATTENDANCE_GROUP_KEY] : QUERY_GROUP_KEYS;
  }

  function scopeGroups() {
    const keys = scopeGroupKeys();
    return inquiryGroups.filter(function (g) {
      return keys.indexOf(g.key) >= 0;
    });
  }

  function totalOpenInquiries() {
    return scopeGroups().reduce(function (n, g) {
      return n + openCountForGroup(g);
    }, 0);
  }

  /** Whichever field best summarizes this inquiry, tagged with its label so
   * the expanded body (inquiryDetailRows) can skip re-showing it — that
   * skip is what stops the collapsed preview and the expanded detail row
   * from saying the exact same thing twice. */
  /** The one type-specific field this inquiry carries — every type also has
   * its own "area", shown as its own row, so it's excluded here. */
  function inquiryPreviewField(item) {
    const candidates = [
      ["Query", inquiryField(item, "query")],
      ["Program", inquiryField(item, "program name")],
      ["Opportunity", inquiryField(item, "opportunity name")],
      ["Search", inquiryField(item, "search keyword")],
    ];
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i][1]) return { label: candidates[i][0], value: candidates[i][1] };
    }
    return null;
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

  function waMeUrl(digits, text) {
    const d = String(digits || "").replace(/\D/g, "");
    let phone = "";
    if (d.length === 10) phone = "91" + d;
    else if (d.length >= 11 && d.length <= 15) phone = d;
    if (!phone) return "";
    const url = "https://wa.me/" + phone;
    if (text) return url + "?text=" + encodeURIComponent(text);
    return url;
  }

  function inquiryPersonWaUrl(item) {
    return waMeUrl(inquiryWhatsAppDigits(item));
  }

  function formatInquiryPhone(digits) {
    const d = String(digits || "").replace(/\D/g, "").slice(-10);
    if (d.length !== 10) return digits || "";
    return "+91 " + d.slice(0, 5) + " " + d.slice(5);
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
    add("IE completed", inquiryIeCompletion(item));
    add("Received", formatInquiryTime(inquiryField(item, "timestamp")));
    add("CTA", inquiryField(item, "remarks"));
    return lines.join("\n");
  }

  function inquiryWhatsAppUrl(item, groupTitle) {
    const text = inquiryShareMessage(item, groupTitle);
    return "https://wa.me/?text=" + encodeURIComponent(text);
  }

  /** Topic and area already show up in the collapsed header (always, for
   * every type), so the expanded grid only needs what isn't visible yet:
   * the phone number and when it came in. */
  function inquiryDetailRows(item) {
    const cells = [];
    function cell(label, valueHtml) {
      cells.push(
        '<div class="inquiry-detail-cell"><div class="inquiry-detail-label">' +
          escapeHtml(label) +
          '</div><div class="inquiry-detail-value">' +
          valueHtml +
          "</div></div>"
      );
    }
    const personUrl = inquiryPersonWaUrl(item);
    const phoneLabel = formatInquiryPhone(inquiryWhatsAppDigits(item)) || inquiryField(item, "whatsapp");
    if (phoneLabel) {
      cell(
        "WhatsApp",
        personUrl
          ? '<a class="inquiry-number-link" href="' +
            escapeHtml(personUrl) +
            '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(phoneLabel) +
            "</a>"
          : escapeHtml(phoneLabel)
      );
    }
    const ieDone = inquiryIeCompletion(item);
    if (ieDone) cell("IE completed", escapeHtml(ieDone));
    const received = formatInquiryTime(inquiryField(item, "timestamp"));
    if (received) cell("Received", escapeHtml(received));
    if (!cells.length) return "";
    return '<div class="inquiry-detail-grid">' + cells.join("") + "</div>";
  }

  /** Short label for the per-card source badge in the merged queries list. */
  function shortTypeLabel(title) {
    const t = (title || "").toString();
    if (/^home/i.test(t)) return "General query";
    if (/program interest/i.test(t)) return "Program interest";
    if (/program volunteer/i.test(t)) return "Program volunteering";
    if (/volunteering/i.test(t)) return "General volunteering";
    return t;
  }

  /** A distinct color per source, keyed by sheet — makes the four mixed
   * types easy to tell apart at a glance in the merged list. */
  function inquiryBadgeClass(key) {
    if (key === "homeQueries") return "inquiry-badge-home";
    if (key === "programInterest") return "inquiry-badge-proginterest";
    if (key === "programVolunteer") return "inquiry-badge-progvol";
    if (key === "volunteeringInterest") return "inquiry-badge-genvol";
    return "";
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
      '<svg class="inquiry-topic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' +
      '<path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' +
      "</svg>"
    );
  }

  function areaIconSvg() {
    return (
      '<svg class="inquiry-topic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>' +
      "</svg>"
    );
  }

  const AVATAR_COLORS_ = ["#7A2331", "#B8860B", "#5B4636", "#6E7B4F", "#A15C3B"];

  // Program-interest leads get a "Send invite" action using the message the
  // Promotions team wrote for that program (programId -> text).
  let inviteMessages = {};

  async function loadInviteMessages() {
    if (role() !== "nurturing" && role() !== "admin") return;
    try {
      const data = await apiGet("inviteMessages", true);
      if (!data.error) inviteMessages = data.messages || {};
    } catch (e) {}
  }

  function inviteMessageFor(group, item) {
    if (!group || group.key !== "programInterest") return "";
    return inviteMessages[inquiryField(item, "program id")] || "";
  }

  let inviteTarget = null; // { card, item, sheet }

  function setInviteStep(step) {
    show($("inviteStepSend"), step === "send");
    show($("inviteStepConfirm"), step === "confirm");
    show($("inviteMsgGroup"), step === "send");
    show($("inviteAsk"), step === "confirm");
  }

  function openInviteSheet(card) {
    const sheet = card.getAttribute("data-sheet");
    const item = findInquiry(sheet, card.getAttribute("data-id"));
    const group = inquiryGroups.find(function (g) { return g.key === sheet; });
    const msg = inviteMessageFor(group, item);
    if (!item || !msg) return;
    inviteTarget = { card: card, item: item, sheet: sheet };
    const digits = inquiryWhatsAppDigits(item);
    $("inviteSub").textContent =
      "To " + (inquiryField(item, "name") || "this person") + (digits ? " · " + formatInquiryPhone(digits) : "") +
      " — review, then open WhatsApp and press send.";
    $("inviteMsg").value = msg;
    $("inviteError").textContent = "";
    setInviteStep("send");
    $("inviteOverlay").classList.add("open");
  }

  function closeInviteSheet() {
    $("inviteOverlay").classList.remove("open");
    inviteTarget = null;
  }

  async function markInviteSent() {
    if (!inviteTarget) return;
    const item = inviteTarget.item;
    const btn = $("inviteMarkSent");
    setButtonBusy(btn, true, "Saving…");
    try {
      const data = await apiPost({
        formType: "adminUpdateInquiry",
        token: token(),
        sheet: inviteTarget.sheet,
        id: item.id,
        status: inquiryField(item, "status") || "Open",
        remarks: inquiryField(item, "remarks"),
        inviteSent: true,
      });
      if (data.error) throw new Error(data.error);
      item["invite sent"] = data.inviteSent || new Date().toISOString();
      closeInviteSheet();
      renderInquiries();
    } catch (err) {
      $("inviteError").textContent = err.message || "Could not save.";
    } finally {
      setButtonBusy(btn, false);
    }
  }

  function initInviteSheet() {
    initInquiryCtaFields();
    initInqGroup();
    initVatGroup();
    $("inviteCancel").addEventListener("click", closeInviteSheet);
    $("inviteNotYet").addEventListener("click", closeInviteSheet);
    $("inviteMarkSent").addEventListener("click", markInviteSent);
    $("inviteOverlay").addEventListener("click", function (e) {
      if (e.target === $("inviteOverlay")) closeInviteSheet();
    });
    $("inviteOpenWa").addEventListener("click", function () {
      if (!inviteTarget) return;
      const text = $("inviteMsg").value.trim();
      const url = waMeUrl(inquiryWhatsAppDigits(inviteTarget.item), text);
      if (!url) {
        $("inviteError").textContent = "This lead has no valid WhatsApp number.";
        return;
      }
      $("inviteError").textContent = "";
      window.open(url, "_blank", "noopener,noreferrer");
      setInviteStep("confirm");
    });
  }

  /** Volunteer enquiry types that can be added straight to a WhatsApp group. */
  function inquiryCanGroup(groupKey) {
    return groupKey === "volunteeringInterest" || groupKey === "programVolunteer";
  }

  const INQ_ICON = {
    group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    reopen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>',
  };

  /** One main action (by enquiry type), WhatsApp + resolve as icons, the rest under "More". */
  function inquiryActionsHtml(group, item, resolved, invited, inGroup) {
    const digits = inquiryWhatsAppDigits(item);
    const personWa = inquiryPersonWaUrl(item);
    const forwardUrl = inquiryWhatsAppUrl(item, group.title);
    // Any enquiry with a number can go into a group; volunteer types make it the main action.
    const canGroup = !!digits;
    const groupIsPrimary = canGroup && inquiryCanGroup(group.key) && !inGroup;
    const canInvite = !!(inviteMessageFor(group, item) && digits);
    let primary = "";
    let waIsPrimary = false;
    if (groupIsPrimary) {
      primary = '<button type="button" class="inquiry-action inq-primary" data-inq-group>' + INQ_ICON.group + "Add to group</button>";
    } else if (canInvite) {
      primary = '<button type="button" class="inquiry-action inq-primary inquiry-action-invite" data-invite-open>' + INQ_ICON.send +
        (invited ? "Resend invite" : "Send invite") + "</button>";
    } else if (personWa) {
      waIsPrimary = true;
      primary = '<a class="inquiry-action inq-primary inq-primary--wa" href="' + escapeHtml(personWa) +
        '" target="_blank" rel="noopener noreferrer">' + waIconSvg() + "WhatsApp</a>";
    }
    const waIcon = personWa && !waIsPrimary
      ? '<a class="inq-icon-btn inq-icon-btn--wa" href="' + escapeHtml(personWa) + '" target="_blank" rel="noopener noreferrer" aria-label="Message on WhatsApp" title="Message on WhatsApp">' + waIconSvg() + "</a>"
      : "";
    const statusIcon = resolved
      ? '<button type="button" class="inq-icon-btn inquiry-action-reopen" data-inquiry-status="Open" aria-label="Reopen" title="Reopen">' + INQ_ICON.reopen + "</button>"
      : '<button type="button" class="inq-icon-btn inq-icon-btn--done inquiry-action-resolve" data-inquiry-status="Resolved" aria-label="Mark resolved" title="Mark resolved">' + INQ_ICON.check + "</button>";
    const menu =
      (canGroup && !groupIsPrimary
        ? '<button type="button" class="inq-menu-item" data-inq-group>' + INQ_ICON.group + (inGroup ? "Add to another group" : "Add to group") + "</button>"
        : "") +
      (digits ? '<button type="button" class="inq-menu-item" data-inq-msg>Send message</button>' : "") +
      (digits ? '<a class="inq-menu-item" href="tel:+91' + digits + '">Call ' + escapeHtml(formatInquiryPhone(digits)) + "</a>" : "") +
      (digits ? '<button type="button" class="inq-menu-item" data-inq-copy="' + digits + '">Copy number</button>' : "") +
      (forwardUrl ? '<a class="inq-menu-item" href="' + escapeHtml(forwardUrl) + '" target="_blank" rel="noopener noreferrer">Forward on WhatsApp</a>' : "");
    return (
      '<div class="inquiry-quick-actions inq-actions">' +
      primary + waIcon + statusIcon +
      (menu
        ? '<span class="inq-more"><button type="button" class="inq-icon-btn" data-inq-more aria-haspopup="true" aria-expanded="false" aria-label="More actions" title="More">' +
          INQ_ICON.more + '</button><span class="inq-menu" role="menu" hidden>' + menu + "</span></span>"
        : "") +
      "</div>"
    );
  }

  function renderInquiryCard(group, item, showTypeBadge, index) {
    const resolved = isInquiryResolved(item);
    const title = inquiryField(item, "name") || "(No name)";
    const previewField = inquiryPreviewField(item);
    const area = inquiryField(item, "area");
    const remarks = inquiryField(item, "remarks");
    const invited = !!inquiryField(item, "invite sent");
    const inGroup = inquiryField(item, "in group");
    const ieDone = inquiryIeCompletion(item);
    const actions = inquiryActionsHtml(group, item, resolved, invited, inGroup);
    const avatarColor = AVATAR_COLORS_[index % AVATAR_COLORS_.length];
    const detailGrid = inquiryDetailRows(item);
    return (
      '<article class="inquiry-card' +
      (resolved ? " is-resolved" : "") +
      '" data-sheet="' +
      escapeHtml(group.key) +
      '" data-id="' +
      escapeHtml(item.id) +
      '">' +
      '<div class="inquiry-ticket-main" data-inquiry-toggle role="button" tabindex="0" aria-expanded="false">' +
      '<span class="inquiry-avatar" aria-hidden="true" style="background:' +
      avatarColor +
      '">' +
      escapeHtml(inquiryInitial(item)) +
      "</span>" +
      '<span class="inquiry-ticket-copy">' +
      '<span class="inquiry-ticket-top">' +
      '<span class="inquiry-ticket-who">' +
      '<strong>' +
      escapeHtml(title) +
      "</strong>" +
      (showTypeBadge
        ? '<span class="inquiry-badge inquiry-badge-type ' +
          inquiryBadgeClass(group.key) +
          '">' +
          escapeHtml(shortTypeLabel(group.title)) +
          "</span>"
        : "") +
      "</span>" +
      '<span class="inquiry-ticket-status">' +
      '<span class="inquiry-status-pill' +
      (resolved ? " is-resolved" : " is-open") +
      '">' +
      (resolved ? "Resolved" : "Open") +
      "</span>" +
      '<svg class="inquiry-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
      "</span>" +
      "</span>" +
      '<span class="inquiry-meta-row">' +
      (previewField
        ? '<span class="inquiry-topic">' + topicIconSvg() + "<span>" + escapeHtml(previewField.value) + "</span></span>"
        : "") +
      (area
        ? '<span class="inquiry-topic">' + areaIconSvg() + "<span>" + escapeHtml(area) + "</span></span>"
        : "") +
      (ieDone
        ? '<span class="inquiry-topic inquiry-ie" title="Inner Engineering completed"><span>IE · ' + escapeHtml(ieDone) + "</span></span>"
        : "") +
      (invited
        ? '<span class="inquiry-topic inquiry-invited"><span>&#10003; Invite sent</span></span>'
        : "") +
      (inGroup
        ? '<span class="inquiry-topic inquiry-invited"><span>&#10003; In group: ' + escapeHtml(inGroup.split(" · ")[0]) + "</span></span>"
        : "") +
      "</span>" +
      (remarks
        ? '<span class="inquiry-remarks-preview">' + escapeHtml(remarks) + "</span>"
        : "") +
      "</span>" +
      "</div>" +
      '<div class="inquiry-body" hidden>' +
      detailGrid +
      '<div class="inquiry-cta">' +
      '<span class="inquiry-cta-label">Call to action</span>' +
      '<div class="inquiry-cta-field">' +
      '<textarea data-inquiry-remarks rows="1" aria-label="Call to action" placeholder="Next step, e.g. call back Saturday">' +
      escapeHtml(inquiryField(item, "remarks")) +
      "</textarea>" +
      '<button type="button" class="inquiry-cta-save" data-inquiry-save>Save</button>' +
      "</div></div>" +
      actions +
      "</div></article>"
    );
  }

  function inquiryTimestampMs(item) {
    const t = Date.parse(inquiryField(item, "timestamp"));
    return isNaN(t) ? 0 : t;
  }

  /** Flattens every group in the current scope into one timestamp-sorted
   * list of {group, item} pairs — merging is what lets the Enquiries page
   * show all four query types together instead of one tab at a time. */
  function mergedScopeItems() {
    const pairs = [];
    scopeGroups().forEach(function (group) {
      (group.items || []).forEach(function (item) {
        pairs.push({ group: group, item: item });
      });
    });
    pairs.sort(function (a, b) {
      return inquiryTimestampMs(b.item) - inquiryTimestampMs(a.item);
    });
    return pairs;
  }

  function inquiryMatchesSearch(item) {
    const q = inquirySearchQuery.trim().toLowerCase();
    if (!q) return true;
    return [
      inquiryField(item, "name"),
      inquiryField(item, "whatsapp"),
      inquiryField(item, "area"),
      inquiryField(item, "query"),
      inquiryField(item, "program name"),
      inquiryField(item, "opportunity name"),
      inquiryField(item, "search keyword"),
    ].some(function (h) {
      return String(h || "").toLowerCase().indexOf(q) >= 0;
    });
  }

  function updateInquiryTabCounts(counts) {
    document.querySelectorAll("[data-inquiry-count]").forEach(function (el) {
      const key = el.getAttribute("data-inquiry-count");
      el.textContent = counts[key] != null ? counts[key] : "";
    });
  }

  /** Type filter beside the search bar — only useful when several types are merged.
   * Counts follow the search and the All/Open/Resolved tab, so each number
   * matches what picking that option would list. */
  function renderInquiryTypeMenu(groups) {
    const wrap = $("inquiryTypeFilter");
    const menu = $("inquiryTypeMenu");
    if (!wrap || !menu) return;
    show(wrap, groups.length > 1);
    if (inquiryTypeFilter && !groups.some(function (g) { return g.key === inquiryTypeFilter; })) {
      inquiryTypeFilter = "";
    }
    const counts = {};
    let total = 0;
    mergedScopeItems().forEach(function (p) {
      if (!inquiryMatchesSearch(p.item) || !inquiryMatchesFilter(p.item)) return;
      counts[p.group.key] = (counts[p.group.key] || 0) + 1;
      total++;
    });
    const opts = [{ key: "", label: "All Queries", n: total }].concat(
      groups.map(function (g) {
        return { key: g.key, label: shortTypeLabel(g.title), n: counts[g.key] || 0 };
      })
    );
    menu.innerHTML = opts
      .map(function (o) {
        return (
          '<button type="button" role="menuitemradio" class="inquiry-typefilter-opt' +
          (o.key === inquiryTypeFilter ? " active" : "") +
          '" aria-checked="' + (o.key === inquiryTypeFilter) +
          '" data-inquiry-type="' + escapeHtml(o.key) + '"><span>' + escapeHtml(o.label) +
          '</span><span class="inquiry-typefilter-count">' + o.n + "</span></button>"
        );
      })
      .join("");
    show($("inquiryTypeDot"), !!inquiryTypeFilter);
    const active = opts.filter(function (o) { return o.key === inquiryTypeFilter; })[0];
    show($("inquiryTypePillRow"), !!inquiryTypeFilter);
    if ($("inquiryTypePillLabel")) $("inquiryTypePillLabel").textContent = inquiryTypeFilter && active ? active.label : "";
  }

  let inqViewPairs = []; // everything the current tab + type + search shows (all pages)

  function renderInquiries() {
    const host = $("inquiryList");
    if (!host) return;
    const groups = scopeGroups();
    if (!groups.length) {
      host.innerHTML = '<div class="admin-empty">No queries yet.</div>';
      setInquiryStatusLine();
      return;
    }
    renderInquiryTypeMenu(groups);
    const searched = mergedScopeItems().filter(function (p) {
      return (!inquiryTypeFilter || p.group.key === inquiryTypeFilter) && inquiryMatchesSearch(p.item);
    });
    const openCount = searched.filter(function (p) {
      return !isInquiryResolved(p.item);
    }).length;
    updateInquiryTabCounts({ all: searched.length, open: openCount, resolved: searched.length - openCount });
    const pairs = searched.filter(function (p) {
      return inquiryMatchesFilter(p.item);
    });
    inqViewPairs = pairs;
    if (!pairs.length) {
      host.innerHTML =
        '<div class="admin-empty">' +
        (inquirySearchQuery.trim() ? "No queries match your search." : "None in this filter.") +
        "</div>";
      setInquiryStatusLine();
      return;
    }
    const visible = pairs.slice(0, inquiryShowLimit);
    const remaining = pairs.length - visible.length;
    // Only worth badging the source when several types are mixed together —
    // pointless (and noisy) on the single-type attendance list.
    const showTypeBadge = groups.length > 1;
    host.innerHTML =
      inqGroupBarHtml() +
      visible
        .map(function (p, idx) {
          return renderInquiryCard(p.group, p.item, showTypeBadge, idx);
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

  /** Loads every group the current scope needs, in parallel. */
  function loadInquiryScopeGroups(force) {
    return Promise.all(
      scopeGroupKeys().map(function (key) {
        return loadInquiryGroup(key, force);
      })
    );
  }

  /** Queries from the read cache, if every group this scope shows is there. */
  function inquiriesFromCache() {
    const meta = readCached("inquiries");
    if (!meta || !meta.groups) return null;
    const groups = meta.groups.map(function (g) {
      const one = readCached("inquiries", { group: g.key });
      const loaded = one && one.group;
      return {
        key: g.key,
        title: (loaded && loaded.title) || g.title,
        openCount: loaded ? loaded.openCount : g.openCount || 0,
        total: loaded ? loaded.total : g.total || 0,
        items: (loaded && loaded.items) || g.items || [],
        loaded: !!loaded || !!g.loaded,
      };
    });
    const keys = scopeGroupKeys();
    const complete = keys.every(function (key) {
      return groups.some(function (g) { return g.key === key && g.loaded; });
    });
    return complete ? groups : null;
  }

  async function loadInquiries() {
    setPageBusy(true);
    setStatus("");
    const cachedGroups = inquiriesFromCache();
    if (cachedGroups) {
      inquiryGroups = cachedGroups;
      renderInquiries();
    } else {
      $("inquiryList").innerHTML =
        '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading queries…</div>';
    }
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
      await Promise.all([loadInquiryScopeGroups(true), loadInviteMessages()]);
      renderInquiries();
    } catch (err) {
      if (!cachedGroups) {
        inquiryGroups = [];
        renderInquiries();
      }
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

  /* ── Queries → More → Send message ──────────────────────────────────
   * Sends one WhatsApp message to the person from the Sandesha number (not
   * the admin's own phone — that's the WhatsApp icon). */
  let inqMsgItem = null;
  let inqMsgBulk = null; // [{ name, digits }] when messaging everyone in view
  const INQ_MSG_MAX = 30; // Sandesha's hourly send cap
  const INQ_MSG_JOB_KEY = "vjn_inq_msg_job";
  let inqMsgJob = null; // { jobId, total, done }
  let inqMsgTimer = null;

  function inqMsgLoadJob() {
    try {
      const raw = localStorage.getItem(INQ_MSG_JOB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function inqMsgSaveJob(job) {
    try {
      if (job) localStorage.setItem(INQ_MSG_JOB_KEY, JSON.stringify(job));
      else localStorage.removeItem(INQ_MSG_JOB_KEY);
    } catch (e) {}
  }

  function openInqBulkMessage(list) {
    if (inqMsgJob) {
      showToast("Wait for the current bulk message to finish.");
      return;
    }
    if (!list.length) return;
    const capped = list.slice(0, INQ_MSG_MAX);
    inqMsgItem = null;
    inqMsgBulk = capped;
    const names = capped.map(function (c) { return c.name || formatInquiryPhone(c.digits); });
    $("inqMsgTitle").textContent = "Message " + capped.length + " people";
    $("inqMsgTo").textContent = "To " + names.slice(0, 3).join(", ") +
      (names.length > 3 ? " and " + (names.length - 3) + " more" : "") + ", from the Sandesha WhatsApp number.";
    const hint = $("inqMsgHint");
    hint.textContent = "Fields like {name} or {area} fill in for each person. Sent about one a minute, so you can leave this page." +
      (list.length > capped.length ? " Only the newest " + INQ_MSG_MAX + " of " + list.length + " are included — Sandesha sends at most " + INQ_MSG_MAX + " an hour." : "");
    hint.classList.remove("hidden");
    $("inqMsgText").value = "Namaskaram {name},\n\n";
    updateInqMsgFieldWarning();
    setInqMsgError("");
    $("inqMsgSend").disabled = false;
    $("inqMsgSend").textContent = "Send";
    $("inqMsgOverlay").classList.add("open");
    const ta = $("inqMsgText");
    setTimeout(function () {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 50);
  }

  async function startInqMsgJob(text) {
    const list = inqMsgBulk;
    const res = await window.VjnVol.bulkMessage(list.map(function (c) {
      return { number: "91" + c.digits, name: c.name, fields: c.fields };
    }), text);
    inqMsgJob = {
      jobId: res.jobId, total: res.total || list.length, done: 0,
      targets: list.map(function (c) { return { digits: c.digits, refs: c.refs || [] }; }),
    };
    inqMsgSaveJob(inqMsgJob);
    closeInqMessage();
    showToast("Sending to " + inqMsgJob.total + " people — about a minute each.");
    refreshInqGroupBar();
    pollInqMsgJob();
  }

  function pollInqMsgJob() {
    clearTimeout(inqMsgTimer);
    if (!inqMsgJob) return;
    inqMsgTimer = setTimeout(async function () {
      if (!inqMsgJob) return;
      let job;
      try {
        await window.VjnVol.ready;
        if (!vnBridgeReady()) throw new Error("offline");
        job = await window.VjnVol.pollMessageJob(inqMsgJob.jobId);
      } catch (err) {
        if (/not found|404/i.test(String(err && err.message))) {
          finishInqMsgJob(null);
          return;
        }
        inqMsgTimer = setTimeout(pollInqMsgJob, 15000);
        return;
      }
      inqMsgJob.done = job.done || 0;
      inqMsgJob.total = job.total || inqMsgJob.total;
      inqMsgSaveJob(inqMsgJob);
      if (["done", "cancelled", "error", "stopped"].indexOf(job.status) < 0) {
        refreshInqGroupBar();
        pollInqMsgJob();
        return;
      }
      finishInqMsgJob(job);
    }, 8000);
  }

  function finishInqMsgJob(job) {
    clearTimeout(inqMsgTimer);
    const finishedTargets = inqMsgJob && inqMsgJob.targets;
    inqMsgJob = null;
    inqMsgSaveJob(null);
    refreshInqGroupBar();
    if (!job) {
      showToast("Check Settings → Sandesha activities for who got it.", { tone: "warn", title: "Bulk message interrupted" });
      return;
    }
    const reached = [];
    (finishedTargets || []).forEach(function (t) {
      if ((job.results || {})["91" + t.digits] === "sent") reached.push.apply(reached, t.refs || []);
    });
    if (reached.length) noteInquiriesContacted(reached);
    const notSent = (job.total || 0) - (job.sent || 0);
    const why = job.status === "stopped" ? " Stopped: " + job.stopReason + "." : job.status === "cancelled" ? " Stopped by you." : "";
    showToast(
      "Sent to " + job.sent + " of " + job.total + "." + (notSent ? " " + notSent + " not sent." : "") + why,
      notSent ? { tone: "warn", title: "Bulk message finished" } : { title: "Bulk message sent" }
    );
  }

  async function cancelInqMsgJob() {
    if (!inqMsgJob) return;
    try {
      await window.VjnVol.cancelMessageJob(inqMsgJob.jobId);
      showToast("Stopping after the current message…");
    } catch (e) {
      showToast((e && e.message) || "Could not stop it.");
    }
  }

  /** Per-person values for {area}, {program}, {ie} (name comes separately). */
  function inqMsgFieldValues(item) {
    return {
      area: inquiryField(item, "area"),
      program: inquiryField(item, "program name") || inquiryField(item, "opportunity name"),
      ie: inquiryIeCompletion(item),
    };
  }

  /** Same fill as Sandesha's bulk job, for a single message sent from here. */
  function fillInqMsgFields(text, item) {
    const full = inquiryField(item, "name");
    const values = Object.assign(inqMsgFieldValues(item), { fullname: full, name: full.split(/\s+/)[0] || "" });
    return text
      .replace(/\{(name|fullname|area|program|ie)\}/gi, function (_m, key) { return values[key.toLowerCase()] || ""; })
      .replace(/ +([,.!?])/g, "$1")
      .replace(/ {2,}/g, " ");
  }

  /** In bulk mode, say how many people lack a field the message uses. */
  function updateInqMsgFieldWarning() {
    const el = $("inqMsgMissing");
    if (!el) return;
    const list = inqMsgBulk;
    if (!list) { el.textContent = ""; el.classList.add("hidden"); return; }
    const used = {};
    ($("inqMsgText").value.match(/\{(name|fullname|area|program|ie)\}/gi) || []).forEach(function (t) {
      used[t.slice(1, -1).toLowerCase()] = true;
    });
    const labels = { name: "a name", fullname: "a name", area: "an area", program: "a program", ie: "an IE date" };
    const notes = [];
    ["name", "area", "program", "ie"].forEach(function (key) {
      if (!used[key] && !(key === "name" && used.fullname)) return;
      const missing = list.filter(function (c) {
        return key === "name" ? !c.name : !(c.fields && c.fields[key]);
      }).length;
      if (missing) notes.push(missing + " of " + list.length + " have no " + labels[key].replace(/^an? /, ""));
    });
    el.textContent = notes.length ? notes.join(" · ") + " — that part will be left blank for them." : "";
    el.classList.toggle("hidden", !notes.length);
  }

  function insertInqMsgField(key) {
    const ta = $("inqMsgText");
    const token = "{" + key + "}";
    const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    const end = ta.selectionEnd != null ? ta.selectionEnd : start;
    ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
    ta.focus();
    ta.setSelectionRange(start + token.length, start + token.length);
    updateInqMsgFieldWarning();
  }

  /** "Contacted via WhatsApp (20 Oct)" in the query's Call to action, saved to the
   * sheet. Other notes stay; an earlier "Contacted via WhatsApp" just gets the new date.
   * Status is left as it is. Runs in the background, one save at a time. */
  async function noteInquiriesContacted(refs) {
    const stamp = "Contacted via WhatsApp (" +
      new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + ")";
    let failed = 0;
    for (let i = 0; i < refs.length; i++) {
      const item = findInquiry(refs[i].sheet, refs[i].id);
      if (!item) continue;
      const prev = inquiryField(item, "remarks");
      const next = /Contacted via WhatsApp( \([^)]*\))?/.test(prev)
        ? prev.replace(/Contacted via WhatsApp( \([^)]*\))?/, stamp)
        : (prev ? prev + " · " : "") + stamp;
      try {
        const data = await apiPost({
          formType: "adminUpdateInquiry",
          token: token(),
          sheet: refs[i].sheet,
          id: item.id,
          status: inquiryField(item, "status") || "Open",
          remarks: next,
        });
        if (data.error) throw new Error(data.error);
        item.remarks = next;
        // Patch just this card (no full re-render), so open cards and half-typed notes elsewhere survive.
        const card = document.querySelector('.inquiry-card[data-sheet="' + refs[i].sheet + '"][data-id="' + item.id + '"]');
        if (card) {
          const ta = card.querySelector("[data-inquiry-remarks]");
          if (ta && document.activeElement !== ta) ta.value = next;
          let preview = card.querySelector(".inquiry-remarks-preview");
          if (!preview) {
            const copy = card.querySelector(".inquiry-ticket-copy");
            if (copy) {
              copy.insertAdjacentHTML("beforeend", '<span class="inquiry-remarks-preview"></span>');
              preview = copy.querySelector(".inquiry-remarks-preview");
            }
          }
          if (preview) preview.textContent = next;
        }
      } catch (e) {
        failed += 1;
      }
    }
    if (failed) showToast("Couldn't note \"Contacted via WhatsApp\" on " + failed + (failed === 1 ? " query." : " queries."), { tone: "warn" });
  }

  function setInqMsgError(text) {
    const el = $("inqMsgError");
    el.textContent = text || "";
    el.style.display = text ? "block" : "none";
  }

  function openInqMessage(item) {
    inqMsgItem = item;
    inqMsgBulk = null;
    $("inqMsgTitle").textContent = "Send WhatsApp message";
    $("inqMsgHint").classList.add("hidden");
    updateInqMsgFieldWarning();
    const name = inquiryField(item, "name");
    const digits = inquiryWhatsAppDigits(item);
    $("inqMsgTo").textContent = "To " + (name ? name + " · " : "") + formatInquiryPhone(digits) + ", from the Sandesha WhatsApp number.";
    $("inqMsgText").value = name ? "Namaskaram " + name.split(" ")[0] + ",\n\n" : "Namaskaram,\n\n";
    setInqMsgError("");
    $("inqMsgSend").disabled = false;
    $("inqMsgSend").textContent = "Send";
    $("inqMsgOverlay").classList.add("open");
    const ta = $("inqMsgText");
    setTimeout(function () {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 50);
  }

  function closeInqMessage() {
    $("inqMsgOverlay").classList.remove("open");
    inqMsgItem = null;
    inqMsgBulk = null;
  }

  async function sendInqMessage() {
    const item = inqMsgItem;
    if (!item && !inqMsgBulk) return;
    const text = $("inqMsgText").value.trim();
    if (!text || /^Namaskaram[^,]*,$/.test(text)) {
      setInqMsgError("Please write a message.");
      return;
    }
    const btn = $("inqMsgSend");
    btn.disabled = true;
    btn.textContent = "Sending…";
    setInqMsgError("");
    try {
      if (!window.VjnVol) throw new Error("Messaging is unavailable right now.");
      await window.VjnVol.ready;
      if (!vnBridgeReady()) throw new Error("Could not connect to the messaging server.");
      if (inqMsgBulk) {
        await startInqMsgJob(text);
        return;
      }
    } catch (e) {
      setInqMsgError((e && e.message) || "Could not send the message.");
      btn.disabled = false;
      btn.textContent = "Send";
      return;
    }
    // One message: close straight away and send behind it. WhatsApp on the
    // Pi can take several seconds; nobody should sit watching "Sending…".
    const who = inquiryField(item, "name") || "them";
    closeInqMessage();
    showToast("Sending to " + who + "…", { tone: "progress", ms: 30000 });
    try {
      await window.VjnVol.sendMessage(inquiryWhatsAppDigits(item), fillInqMsgFields(text, item));
      noteInquiriesContacted([{ sheet: item.sheet, id: String(item.id) }]);
      showToast("Message sent to " + who, { tone: "success" });
    } catch (e) {
      // Reopen with their words intact so a retry is one tap.
      openInqMessage(item);
      $("inqMsgText").value = text;
      setInqMsgError((e && e.message) || "Could not send the message.");
    }
  }

  function initInqMessage() {
    if (!$("inqMsgOverlay")) return;
    $("inqMsgCancel").addEventListener("click", closeInqMessage);
    $("inqMsgText").addEventListener("input", updateInqMsgFieldWarning);
    $("inqMsgFields").addEventListener("mousedown", function (e) {
      // Keep the textarea's cursor where it is while the button is pressed.
      if (e.target.closest("[data-msg-field]")) e.preventDefault();
    });
    $("inqMsgFields").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-msg-field]");
      if (btn) insertInqMsgField(btn.getAttribute("data-msg-field"));
    });
    $("inqMsgSend").addEventListener("click", sendInqMessage);
    $("inqMsgOverlay").addEventListener("click", function (e) {
      if (e.target === $("inqMsgOverlay")) closeInqMessage();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("inqMsgOverlay").classList.contains("open")) closeInqMessage();
    });
  }

  /* ── Enquiries → WhatsApp group (via the Sandesha bridge) ────────────
   * One card ("Add to group") or every open volunteer enquiry in view
   * (bulk bar). Sandesha paces adds ~75–150s apart and caps a job at 50, so
   * a bulk run takes a while: the job is kept in localStorage and polling
   * resumes after a reload. Whoever made it in (added, or sent a join link
   * when a direct add was refused) is marked Resolved with the group noted.
   * Only one job at a time — two parallel jobs would double the add rate. */

  const INQ_GROUP_JOB_KEY = "vjn_inq_group_job";
  const INQ_GROUP_MAX = 50;
  let inqGroupGroups = null;
  let inqGroupPicked = null; // { jid, name }
  let inqGroupCandidates = []; // [{ sheet, id, name, digits, checked }]
  let inqGroupJob = null; // { jobId, group, targets, done, total, status }
  let inqGroupTimer = null;

  function inqGroupLoadJob() {
    try {
      const raw = localStorage.getItem(INQ_GROUP_JOB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function inqGroupSaveJob(job) {
    try {
      if (job) localStorage.setItem(INQ_GROUP_JOB_KEY, JSON.stringify(job));
      else localStorage.removeItem(INQ_GROUP_JOB_KEY);
    } catch (e) {}
  }

  /** Open volunteer enquiries the bulk bar acts on: the list as filtered now. */
  function inqBulkCandidates() {
    if (inquiryFilter !== "open" || !inquiryCanGroup(inquiryTypeFilter)) return [];
    return mergedScopeItems()
      .filter(function (p) {
        return p.group.key === inquiryTypeFilter && inquiryMatchesSearch(p.item) && !isInquiryResolved(p.item);
      })
      .map(function (p) {
        return {
          sheet: p.group.key,
          id: String(p.item.id),
          name: inquiryField(p.item, "name") || "(No name)",
          digits: inquiryWhatsAppDigits(p.item),
        };
      });
  }

  /** Everyone in the current view with a WhatsApp number, once each. */
  function inqMessageCandidates() {
    const seen = {};
    const out = [];
    inqViewPairs.forEach(function (p) {
      const digits = inquiryWhatsAppDigits(p.item);
      if (!digits) return;
      const ref = { sheet: p.group.key, id: String(p.item.id) };
      if (seen[digits]) {
        seen[digits].refs.push(ref); // same person, several queries: note it on each
        return;
      }
      seen[digits] = { name: inquiryField(p.item, "name"), digits: digits, fields: inqMsgFieldValues(p.item), refs: [ref] };
      out.push(seen[digits]);
    });
    return out;
  }

  /** Bars above the list: bulk entry points, or running jobs' progress. */
  function inqGroupBarHtml() {
    const bars = [inqGroupJob ? inqGroupJobBarHtml() : "", inqMsgJob ? inqMsgJobBarHtml() : ""].join("");
    if (bars) return '<div class="inq-bulk-wrap">' + bars + "</div>";
    const groupList = inqBulkCandidates().filter(function (c) { return c.digits; });
    const msgList = inqMessageCandidates();
    const canGroup = groupList.length >= 2;
    const canMsg = msgList.length >= 2;
    if (!canGroup && !canMsg) return "";
    const n = canGroup ? groupList.length : msgList.length;
    return (
      '<div class="inq-bulk-wrap"><div class="inq-bulk">' +
      '<span class="inq-bulk-text"><b>' + n + (canGroup ? " open" : " in this view") + "</b><span>" +
      (canGroup ? "Add them to a group or message them" : "Send them all a WhatsApp message") + "</span></span>" +
      '<span class="inq-bulk-actions">' +
      (canMsg ? '<button type="button" class="inq-bulk-btn inq-bulk-btn--ghost" data-inq-bulk-msg>' + INQ_ICON.send + "Message all</button>" : "") +
      (canGroup ? '<button type="button" class="inq-bulk-btn" data-inq-bulk>' + INQ_ICON.group + "Add all</button>" : "") +
      "</span></div></div>"
    );
  }

  function inqMsgJobBarHtml() {
    const total = inqMsgJob.total || 0;
    const done = Math.min(inqMsgJob.done || 0, total);
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      '<div class="inq-bulk is-running">' +
      '<span class="inq-bulk-text"><b>Messaging ' + total + " " + (total === 1 ? "person" : "people") + "</b>" +
      "<span>" + done + " of " + total + " sent · about a minute each, you can leave this page</span></span>" +
      '<button type="button" class="inq-bulk-btn inq-bulk-btn--ghost" data-inq-msg-cancel>Stop</button>' +
      '<span class="inq-bulk-meter" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
      "</div>"
    );
  }

  function inqGroupJobBarHtml() {
    const total = inqGroupJob.total || inqGroupJob.targets.length;
    const done = Math.min(inqGroupJob.done || 0, total);
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      '<div class="inq-bulk is-running">' +
      '<span class="inq-bulk-text"><b>Adding to ' + escapeHtml(inqGroupJob.group) + "</b>" +
      "<span>" + done + " of " + total + " · about 2 min each, you can leave this page</span></span>" +
      '<span class="inq-bulk-meter" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
      "</div>"
    );
  }

  /** Progress ticks touch only the bar, so open cards and half-typed notes survive. */
  function refreshInqGroupBar() {
    const host = $("inquiryList");
    if (!host || !$("inquiriesPanel") || $("inquiriesPanel").classList.contains("hidden")) return;
    const html = inqGroupBarHtml();
    const bar = host.querySelector(".inq-bulk-wrap");
    if (bar) {
      if (html) bar.outerHTML = html;
      else bar.remove();
    } else if (html) {
      host.insertAdjacentHTML("afterbegin", html);
    }
  }

  async function openInqGroupSheet(candidates) {
    if (inqGroupJob || vatGroupJob) {
      showToast("Wait for the current group add to finish.");
      return;
    }
    inqGroupCandidates = candidates.map(function (c, i) {
      return Object.assign({}, c, { checked: !!c.digits && i < INQ_GROUP_MAX });
    });
    inqGroupPicked = null;
    $("inqGroupTitle").textContent = "Add to a WhatsApp group";
    $("inqGroupWho").innerHTML = inqGroupWhoHtml(candidates);
    $("inqGroupSearch").value = "";
    $("inqGroupError").textContent = "";
    show($("inqGroupPickStep"), true);
    show($("inqGroupReviewStep"), false);
    $("inqGroupOverlay").classList.add("open");
    const listEl = $("inqGroupList");
    if (!window.VjnVol) {
      listEl.innerHTML = '<div class="admin-empty">Messaging is unavailable right now.</div>';
      return;
    }
    if (inqGroupGroups) {
      renderInqGroupList("");
      return;
    }
    listEl.innerHTML = '<div class="inq-group-skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>';
    try {
      await window.VjnVol.ready;
      if (!vnBridgeReady()) throw new Error("Could not connect to the messaging server.");
      inqGroupGroups = await window.VjnVol.listGroups();
      inqGroupGroups.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      renderInqGroupList("");
    } catch (err) {
      listEl.innerHTML = '<div class="admin-empty">' + escapeHtml(err.message || "Could not load groups.") + "</div>";
    }
  }

  function closeInqGroupSheet() {
    $("inqGroupOverlay").classList.remove("open");
  }

  const INQ_GROUP_RECENT_KEY = "vjn_inq_group_recent";
  const INQ_GROUP_TINTS = [["#fbefe2", "#a3531a"], ["#e3efd9", "#3f6b2a"], ["#e6eef7", "#2f5f8f"], ["#f1e6f3", "#7a3f84"], ["#f7ecd0", "#8a6a12"], ["#e2f1ef", "#26776c"]];

  function inqGroupRecent() {
    try { return JSON.parse(localStorage.getItem(INQ_GROUP_RECENT_KEY) || "[]"); } catch (e) { return []; }
  }

  function inqGroupRemember(jid) {
    try {
      const list = inqGroupRecent().filter(function (j) { return j !== jid; });
      list.unshift(jid);
      localStorage.setItem(INQ_GROUP_RECENT_KEY, JSON.stringify(list.slice(0, 3)));
    } catch (e) {}
  }

  /** Initials avatar, tinted by the name so each group keeps its colour. */
  function inqGroupAvatar(name) {
    const words = String(name || "?").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
    const initials = ((words[0] || "?").charAt(0) + (words[1] ? words[1].charAt(0) : "")).toUpperCase();
    let h = 0;
    for (let i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) >>> 0;
    const t = INQ_GROUP_TINTS[h % INQ_GROUP_TINTS.length];
    return '<span class="inq-group-av" style="background:' + t[0] + ";color:" + t[1] + '" aria-hidden="true">' + escapeHtml(initials) + "</span>";
  }

  /** "Adding" strip: stacked initials + who. */
  function inqGroupWhoHtml(candidates) {
    const n = candidates.length;
    const avs = candidates.slice(0, 3).map(function (c, i) {
      return '<span class="inq-who-av" style="background:' + AVATAR_COLORS_[i % AVATAR_COLORS_.length] + '">' +
        escapeHtml(String(c.name || "?").trim().charAt(0).toUpperCase()) + "</span>";
    }).join("");
    const label = n === 1 ? escapeHtml(candidates[0].name) : n + " people";
    return '<span class="inq-who-avs">' + avs + "</span><span>Adding <b>" + label + "</b></span>";
  }

  function inqGroupRowHtml(g, attr, pickedJid) {
    const picked = pickedJid && g.jid === pickedJid;
    return (
      '<button type="button" class="inq-group-item' + (picked ? " is-picked" : "") + '" ' + (attr || "data-inq-pick") + '="' + escapeHtml(g.jid) + '"' +
      (attr ? ' aria-pressed="' + !!picked + '"' : "") + ">" +
      inqGroupAvatar(g.name) +
      '<span class="inq-group-main"><span class="inq-group-name">' + escapeHtml(g.name) + "</span>" +
      (g.participants != null ? '<span class="inq-group-meta">' + g.participants + " members</span>" : "") +
      "</span>" +
      (picked
        ? '<svg class="inq-group-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
        : '<svg class="inq-group-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>') +
      "</button>"
    );
  }

  /** Recent + all WhatsApp groups, filtered by `query`. Shared by the
   * Enquiries and Attendance group drawers. */
  function waGroupListHtml(query, attr, pickedJid) {
    const q = String(query || "").trim().toLowerCase();
    const all = inqGroupGroups || [];
    const groups = all.filter(function (g) {
      return !q || String(g.name || "").toLowerCase().indexOf(q) >= 0;
    });
    if (!groups.length) {
      return '<div class="inq-group-empty">' + (q ? "No group matches “" + escapeHtml(String(query).trim()) + "”." : "No WhatsApp groups found.") + "</div>";
    }
    const row = function (g) { return inqGroupRowHtml(g, attr, pickedJid); };
    let html = "";
    if (!q) {
      const recent = inqGroupRecent()
        .map(function (jid) { return all.find(function (g) { return g.jid === jid; }); })
        .filter(Boolean);
      if (recent.length) {
        html += '<p class="inq-group-section">Recent</p>' + recent.map(row).join("");
      }
      html += '<p class="inq-group-section">All groups <span>' + all.length + "</span></p>";
    }
    return html + groups.slice(0, 100).map(row).join("");
  }

  function renderInqGroupList(query) {
    $("inqGroupList").innerHTML = waGroupListHtml(query);
  }

  function renderInqGroupReview() {
    const picked = inqGroupCandidates.filter(function (c) { return c.checked; });
    $("inqGroupChosen").innerHTML =
      inqGroupAvatar(inqGroupPicked.name) +
      '<span class="inq-group-main"><span class="inq-group-meta">Adding to</span>' +
      '<span class="inq-group-name">' + escapeHtml(inqGroupPicked.name) + "</span></span>" +
      '<span class="inq-group-change">Change</span>';
    const many = inqGroupCandidates.length > 1;
    show($("inqGroupToggleAll"), many);
    $("inqGroupCount").textContent = many ? picked.length + " of " + inqGroupCandidates.length + " selected" : "Adding";
    $("inqGroupToggleAll").textContent = picked.length ? "Clear all" : "Select all";
    $("inqGroupPeople").innerHTML = inqGroupCandidates.map(function (c, i) {
      const disabled = !c.digits;
      return (
        '<label class="inq-person' + (disabled ? " is-disabled" : "") + '">' +
        (many ? '<input type="checkbox" data-inq-person="' + i + '"' + (c.checked ? " checked" : "") + (disabled ? " disabled" : "") + "/>" : "") +
        '<span class="inq-person-name">' + escapeHtml(c.name) + "</span>" +
        '<span class="inq-person-phone">' + (disabled ? "No valid number" : escapeHtml(formatInquiryPhone(c.digits))) + "</span>" +
        "</label>"
      );
    }).join("");
    const n = picked.length;
    const mins = Math.max(1, Math.round(((n - 1) * 112) / 60));
    $("inqGroupNote").textContent =
      (n > 1 ? "Sandesha adds people about 2 minutes apart so WhatsApp doesn't block the number — " + n + " people ≈ " + mins + " min. " : "") +
      "Anyone who can't be added directly gets a join link instead. Each enquiry is marked resolved once they're in." +
      (n > INQ_GROUP_MAX ? " Max " + INQ_GROUP_MAX + " per batch." : "");
    const start = $("inqGroupStart");
    start.disabled = !n || n > INQ_GROUP_MAX;
    start.textContent = n === 1 ? "Add " + picked[0].name : "Add " + n + " people";
  }

  async function startInqGroupJob() {
    const targets = inqGroupCandidates.filter(function (c) { return c.checked && c.digits; });
    if (!targets.length || !inqGroupPicked) return;
    const btn = $("inqGroupStart");
    setButtonBusy(btn, true, "Starting…");
    $("inqGroupError").textContent = "";
    try {
      await window.VjnVol.ready;
      if (!vnBridgeReady()) throw new Error("Could not connect to the messaging server.");
      const jobId = await window.VjnVol.addToGroup(
        inqGroupPicked.jid,
        targets.map(function (t) { return "91" + t.digits; })
      );
      inqGroupJob = {
        jobId: jobId,
        group: inqGroupPicked.name,
        targets: targets.map(function (t) { return { sheet: t.sheet, id: t.id, name: t.name, digits: t.digits }; }),
        done: 0,
        total: targets.length,
      };
      inqGroupSaveJob(inqGroupJob);
      closeInqGroupSheet();
      showToast(
        targets.length === 1 ? targets[0].name : targets.length + " people · about 2 min each",
        { tone: "progress", title: "Adding to " + inqGroupPicked.name }
      );
      renderInquiries();
      pollInqGroupJob();
    } catch (err) {
      $("inqGroupError").textContent = err.message || "Could not start.";
    } finally {
      setButtonBusy(btn, false);
    }
  }

  function pollInqGroupJob() {
    clearTimeout(inqGroupTimer);
    if (!inqGroupJob) return;
    inqGroupTimer = setTimeout(async function () {
      if (!inqGroupJob) return;
      let job;
      try {
        await window.VjnVol.ready;
        if (!vnBridgeReady()) throw new Error("offline");
        job = await window.VjnVol.pollJob(inqGroupJob.jobId);
      } catch (err) {
        // Job gone (server restarted / expired) → give up; otherwise retry later.
        if (/not found|404/i.test(String(err && err.message))) {
          inqGroupJob = null;
          inqGroupSaveJob(null);
          showToast("Check the enquiries and try again.", { tone: "warn", title: "Group add interrupted" });
          if ($("inquiriesPanel") && !$("inquiriesPanel").classList.contains("hidden")) renderInquiries();
          return;
        }
        inqGroupTimer = setTimeout(pollInqGroupJob, 15000);
        return;
      }
      inqGroupJob.done = job.done || 0;
      inqGroupJob.total = job.total || inqGroupJob.total;
      inqGroupSaveJob(inqGroupJob);
      const terminal = ["done", "completed", "cancelled", "error", "failed", "stopped"].indexOf(job.status) >= 0;
      if (!terminal) {
        refreshInqGroupBar();
        pollInqGroupJob();
        return;
      }
      await finishInqGroupJob(job);
    }, inqGroupJob && inqGroupJob.total === 1 ? 2500 : 8000);
  }

  /** Marks everyone who made it in as Resolved + "In group", leaves the rest open. */
  /** digits(last 10) -> "added" | "invited" | "failed". Uses Sandesha's per-number
   * results; an older Sandesha without them falls back to its error list. */
  function inqGroupOutcome(job, targets) {
    const outcome = {};
    const results = job.results || {};
    const keys = Object.keys(results);
    if (keys.length) {
      keys.forEach(function (d) { outcome[String(d).replace(/\D/g, "").slice(-10)] = results[d]; });
      return outcome;
    }
    if (job.status !== "done") return outcome; // stopped early: can't tell who was reached
    targets.forEach(function (t) { outcome[t.digits] = "added"; });
    (job.errors || []).forEach(function (line) {
      const d = String(line).split(":")[0].replace(/\D/g, "").slice(-10);
      if (!outcome[d]) return;
      outcome[d] = /join link instead/i.test(line) ? "invited" : "failed";
    });
    return outcome;
  }

  /** Marks everyone who made it in as Resolved with the CTA "Added to <group>"; the rest stay open. */
  async function finishInqGroupJob(job) {
    const run = inqGroupJob;
    const outcome = inqGroupOutcome(job, run.targets);
    const ok = run.targets.filter(function (t) { return outcome[t.digits] === "added" || outcome[t.digits] === "invited"; });
    const failed = run.targets.length - ok.length;
    const cta = "Added to " + run.group;
    let saveErrors = 0;
    // Same call as the card's own Save + Resolve, a few at a time.
    for (let i = 0; i < ok.length; i += 4) {
      await Promise.all(ok.slice(i, i + 4).map(async function (t) {
        try {
          const data = await apiPost({
            formType: "adminUpdateInquiry",
            token: token(),
            sheet: t.sheet,
            id: t.id,
            status: "Resolved",
            remarks: cta,
            inGroup: run.group,
          });
          if (data.error) throw new Error(data.error);
          const item = findInquiry(t.sheet, t.id);
          if (item) {
            item.status = "Resolved";
            item.remarks = cta;
            item["in group"] = data.inGroup || run.group;
          }
        } catch (err) {
          saveErrors += 1;
        }
      }));
    }
    inquiryGroups.forEach(refreshGroupOpenCount);
    if (saveErrors) {
      showToast(saveErrors + " couldn't be saved — mark them resolved by hand.", { tone: "warn", title: "Added, but not all marked resolved" });
    }
    inqGroupJob = null;
    inqGroupSaveJob(null);
    const invited = ok.filter(function (t) { return outcome[t.digits] === "invited"; }).length;
    const single = run.targets.length === 1;
    let title;
    let detail;
    if (!ok.length) {
      title = single ? "Couldn't add " + run.targets[0].name : "Couldn't add anyone";
      detail = "Still open — try again later.";
    } else if (single) {
      title = invited ? "Join link sent" : "Added to " + run.group;
      detail = ok[0].name + (invited ? " can join " + run.group : "") + " · marked resolved";
    } else {
      title = ok.length + " of " + run.targets.length + " added to " + run.group;
      detail =
        "Marked resolved" +
        (invited ? " · " + invited + " via join link" : "") +
        (failed ? " · " + failed + " still open" : "");
    }
    if (job.status === "stopped") detail += ". WhatsApp paused adds — retry the rest in 30 min.";
    if (!saveErrors) showToast(detail, { tone: !ok.length || failed ? "warn" : "success", title: title });
    if ($("inquiriesPanel") && !$("inquiriesPanel").classList.contains("hidden")) renderInquiries();
  }

  function initInqGroup() {
    if (!$("inqGroupOverlay")) return;
    $("inqGroupClose").addEventListener("click", closeInqGroupSheet);
    $("inqGroupOverlay").addEventListener("click", function (e) {
      if (e.target === this) closeInqGroupSheet();
    });
    $("inqGroupSearch").addEventListener("input", function () { renderInqGroupList(this.value); });
    // The whole pill is the hit area, not just the text box.
    $("inqGroupSearchBox").addEventListener("click", function (e) {
      if (e.target !== $("inqGroupSearch")) $("inqGroupSearch").focus();
    });
    $("inqGroupList").addEventListener("click", function (e) {
      const pick = e.target.closest("[data-inq-pick]");
      if (!pick) return;
      const jid = pick.getAttribute("data-inq-pick");
      const g = (inqGroupGroups || []).find(function (x) { return x.jid === jid; });
      inqGroupPicked = { jid: jid, name: g ? g.name : "the group" };
      inqGroupRemember(jid);
      show($("inqGroupPickStep"), false);
      show($("inqGroupReviewStep"), true);
      renderInqGroupReview();
    });
    $("inqGroupChosen").addEventListener("click", function () {
      show($("inqGroupReviewStep"), false);
      show($("inqGroupPickStep"), true);
    });
    $("inqGroupPeople").addEventListener("change", function (e) {
      const box = e.target.closest("[data-inq-person]");
      if (!box) return;
      inqGroupCandidates[Number(box.getAttribute("data-inq-person"))].checked = box.checked;
      renderInqGroupReview();
    });
    $("inqGroupToggleAll").addEventListener("click", function () {
      const anyOn = inqGroupCandidates.some(function (c) { return c.checked; });
      let n = 0;
      inqGroupCandidates.forEach(function (c) {
        c.checked = !anyOn && !!c.digits && n++ < INQ_GROUP_MAX;
      });
      renderInqGroupReview();
    });
    $("inqGroupStart").addEventListener("click", startInqGroupJob);
    // Close any open "More" menu on an outside tap.
    document.addEventListener("click", function (e) {
      if (e.target.closest(".inq-more")) return;
      document.querySelectorAll(".inq-menu:not([hidden])").forEach(function (m) {
        m.hidden = true;
        const b = m.parentNode.querySelector("[data-inq-more]");
        if (b) b.setAttribute("aria-expanded", "false");
      });
    });
    // Resume a job that was running before a reload.
    inqGroupJob = inqGroupLoadJob();
    if (inqGroupJob) pollInqGroupJob();
    inqMsgJob = inqMsgLoadJob();
    if (inqMsgJob) pollInqMsgJob();
  }

  /* ── Attendance → WhatsApp group (bottom drawer) ─────────────────────
   * Once a program's attendance is all marked, Nurturing can add the
   * volunteers to a WhatsApp group. Step 1 picks people (everyone present is
   * ticked; absentees sit in an optional, unticked list), step 2 picks the
   * group. The job runs in the background like the Enquiries one — kept in
   * localStorage so polling resumes after a reload — and each volunteer who
   * made it in is flagged "In WA group" (or "Invite sent" for a join link). */

  const VAT_GROUP_JOB_KEY = "vjn_vat_group_job";
  let vgEventId = "";
  let vgCands = []; // [{ rowId, name, digits, present, already, checked }]
  let vgPicked = null; // { jid, name }
  let vgStep = "people";
  let vatGroupJob = null; // { jobId, eventId, group, targets, done, total }
  let vatGroupTimer = null;

  function vatGroupSaveJob(job) {
    try {
      if (job) localStorage.setItem(VAT_GROUP_JOB_KEY, JSON.stringify(job));
      else localStorage.removeItem(VAT_GROUP_JOB_KEY);
    } catch (e) {}
  }

  function vatGroupLoadJob() {
    try {
      const raw = localStorage.getItem(VAT_GROUP_JOB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /** Strip under the roster: the entry point, or this program's running job. */
  function vatGroupBarHtml(item) {
    if (vatGroupJob && String(vatGroupJob.eventId) === String(item.id)) {
      const total = vatGroupJob.total || vatGroupJob.targets.length;
      const done = Math.min(vatGroupJob.done || 0, total);
      const pct = total ? Math.round((done / total) * 100) : 0;
      return (
        '<div class="vat-group-bar is-running">' +
        '<span class="vat-group-bar-text"><b>Adding to ' + escapeHtml(vatGroupJob.group) + "</b>" +
        "<span>" + done + " of " + total + " · about 2 min each, you can leave this page</span></span>" +
        '<span class="vat-group-meter" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
        "</div>"
      );
    }
    const vols = item.volunteers || [];
    if (!vols.length) return "";
    if (!vatIsDone(item)) {
      return (
        '<p class="vat-group-hint">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>' +
        "Mark attendance to add them to a group for future communication</p>"
      );
    }
    const present = vols.filter(function (v) { return v.attended === "yes"; }).length;
    return (
      '<button type="button" class="vat-group-bar" data-vat-group-open="' + escapeHtml(item.id) + '">' +
      '<span class="vat-group-bar-ico" aria-hidden="true">' + INQ_ICON.group + "</span>" +
      '<span class="vat-group-bar-text"><b>Add to WhatsApp group</b>' +
      "<span>" + present + " present · " + (vols.length - present) + " absent</span></span>" +
      '<span class="vat-group-bar-btn" aria-hidden="true">Add</span>' +
      "</button>"
    );
  }

  function vatRefreshIfShowing(eventId) {
    if (!$("vatMark") || $("vatMark").classList.contains("hidden")) return;
    if (String(vatMarkId) === String(eventId)) vatRenderMark();
  }

  async function openVatGroupSheet(eventId) {
    if (vatGroupJob || inqGroupJob) {
      showToast("Wait for the current group add to finish.");
      return;
    }
    const item = vnFindItem(eventId) || vatFindItem(eventId);
    if (!item) return;
    vgEventId = String(item.id);
    vgPicked = null;
    vgCands = (item.volunteers || []).map(function (v) {
      const digits = vatDigits(v.phone);
      const present = v.attended === "yes";
      const already = !!(v.inGroup || v.inviteSent);
      return {
        rowId: v.rowId,
        name: v.name || "(No name)",
        digits: digits.length === 10 ? digits : "",
        present: present,
        already: v.inGroup ? "In group" : v.inviteSent ? "Link sent" : "",
        checked: present && !already && digits.length === 10,
      };
    });
    $("vgTitle").textContent = item.title || "(Untitled)";
    $("vgSearch").value = "";
    $("vgError").textContent = "";
    vgShowStep("people");
    openBSheet("vatGroupSheet");
  }

  function vgShowStep(step) {
    vgStep = step;
    show($("vgPeopleStep"), step === "people");
    show($("vgPickStep"), step === "pick");
    show($("vgBack"), step === "pick");
    $("vgEyebrow").textContent = step === "pick" ? "Step 2 of 2 · Choose a group" : "Step 1 of 2 · Choose volunteers";
    $("vgError").textContent = "";
    if (step === "people") vgRenderPeople();
    else vgLoadGroups();
    vgRenderFoot();
  }

  function vgPersonHtml(c, i) {
    const disabled = !c.digits;
    return (
      '<label class="vg-person' + (disabled ? " is-disabled" : "") + '">' +
      '<span class="inquiry-avatar" aria-hidden="true" style="background:' + AVATAR_COLORS_[i % AVATAR_COLORS_.length] + '">' +
      escapeHtml(c.name.trim().charAt(0).toUpperCase() || "?") + "</span>" +
      '<span class="vg-person-main"><span class="vg-person-name">' + escapeHtml(c.name) + "</span>" +
      '<span class="vg-person-sub">' + (disabled ? "No valid number" : escapeHtml(formatInquiryPhone(c.digits))) +
      (c.already ? ' <span class="vat-tag">' + c.already + "</span>" : "") +
      "</span></span>" +
      '<input type="checkbox" class="vg-check" data-vg-person="' + i + '"' + (c.checked ? " checked" : "") + (disabled ? " disabled" : "") +
      ' aria-label="Add ' + escapeHtml(c.name) + '"/>' +
      "</label>"
    );
  }

  function vgRenderPeople() {
    const picked = vgCands.filter(function (c) { return c.checked; }).length;
    $("vgCount").textContent = picked + " selected";
    $("vgToggleAll").textContent = picked ? "Deselect all" : "Select all present";
    const present = [];
    const absent = [];
    vgCands.forEach(function (c, i) { (c.present ? present : absent).push(vgPersonHtml(c, i)); });
    $("vgPeople").innerHTML =
      '<p class="vg-section is-present">Present <span>' + present.length + "</span></p>" +
      (present.length ? present.join("") : '<p class="vg-empty">Nobody was marked present.</p>') +
      (absent.length
        ? '<p class="vg-section is-absent">Absent <span>' + absent.length + "</span><em>Tick to add them too</em></p>" + absent.join("")
        : "");
  }

  async function vgLoadGroups() {
    const listEl = $("vgGroupList");
    if (inqGroupGroups) {
      vgRenderGroups($("vgSearch").value);
      return;
    }
    if (!window.VjnVol) {
      listEl.innerHTML = '<div class="inq-group-empty">Messaging is unavailable right now.</div>';
      return;
    }
    listEl.innerHTML = '<div class="inq-group-skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>';
    try {
      await window.VjnVol.ready;
      if (!vnBridgeReady()) throw new Error("Could not connect to the messaging server.");
      inqGroupGroups = await window.VjnVol.listGroups();
      inqGroupGroups.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      if (vgStep === "pick") vgRenderGroups($("vgSearch").value);
    } catch (err) {
      listEl.innerHTML = '<div class="inq-group-empty">' + escapeHtml(err.message || "Could not load groups.") + "</div>";
    }
  }

  function vgRenderGroups(query) {
    $("vgGroupList").innerHTML = waGroupListHtml(query, "data-vg-pick", vgPicked && vgPicked.jid);
  }

  function vgRenderFoot() {
    const n = vgCands.filter(function (c) { return c.checked; }).length;
    const btn = $("vgNext");
    const note = $("vgNote");
    if (vgStep === "people") {
      show(note, n > INQ_GROUP_MAX);
      note.textContent = "Max " + INQ_GROUP_MAX + " per batch — untick a few.";
      btn.disabled = !n || n > INQ_GROUP_MAX;
      btn.textContent = n ? "Next: choose group (" + n + ")" : "Select at least one volunteer";
      return;
    }
    const mins = Math.max(1, Math.round(((n - 1) * 112) / 60));
    show(note, !!vgPicked);
    if (vgPicked) {
      note.innerHTML =
        '<b class="vg-note-group">' + escapeHtml(vgPicked.name) + "</b>" +
        "<span>" + (n > 1 ? "≈ " + mins + " min · added 2 min apart. " : "") + "Others get a join link.</span>";
    }
    btn.disabled = !vgPicked;
    btn.textContent = vgPicked
      ? "Add " + (n === 1 ? vgCands.find(function (c) { return c.checked; }).name : n + " volunteers")
      : "Pick a group above";
  }

  async function vgStart() {
    const targets = vgCands
      .filter(function (c) { return c.checked && c.digits; })
      .map(function (c) { return { rowId: c.rowId, name: c.name, digits: c.digits }; });
    if (!targets.length || !vgPicked) return;
    const btn = $("vgNext");
    setButtonBusy(btn, true, "Starting…");
    $("vgError").textContent = "";
    try {
      await window.VjnVol.ready;
      if (!vnBridgeReady()) throw new Error("Could not connect to the messaging server.");
      const jobId = await window.VjnVol.addToGroup(
        vgPicked.jid,
        targets.map(function (t) { return "91" + t.digits; })
      );
      inqGroupRemember(vgPicked.jid);
      vatGroupJob = { jobId: jobId, eventId: vgEventId, group: vgPicked.name, targets: targets, done: 0, total: targets.length };
      vatGroupSaveJob(vatGroupJob);
      closeBSheet("vatGroupSheet");
      showToast(
        targets.length === 1 ? targets[0].name : targets.length + " volunteers · about 2 min each",
        { tone: "progress", title: "Adding to " + vgPicked.name }
      );
      vatRefreshIfShowing(vgEventId);
      pollVatGroupJob();
    } catch (err) {
      $("vgError").textContent = err.message || "Could not start.";
    } finally {
      setButtonBusy(btn, false);
      if (!vatGroupJob) vgRenderFoot();
    }
  }

  function pollVatGroupJob() {
    clearTimeout(vatGroupTimer);
    if (!vatGroupJob) return;
    vatGroupTimer = setTimeout(async function () {
      if (!vatGroupJob) return;
      let job;
      try {
        await window.VjnVol.ready;
        if (!vnBridgeReady()) throw new Error("offline");
        job = await window.VjnVol.pollJob(vatGroupJob.jobId);
      } catch (err) {
        if (/not found|404/i.test(String(err && err.message))) {
          const eventId = vatGroupJob.eventId;
          vatGroupJob = null;
          vatGroupSaveJob(null);
          showToast("Check the roster and try again.", { tone: "warn", title: "Group add interrupted" });
          vatRefreshIfShowing(eventId);
          return;
        }
        vatGroupTimer = setTimeout(pollVatGroupJob, 15000);
        return;
      }
      vatGroupJob.done = job.done || 0;
      vatGroupJob.total = job.total || vatGroupJob.total;
      vatGroupSaveJob(vatGroupJob);
      const terminal = ["done", "completed", "cancelled", "error", "failed", "stopped"].indexOf(job.status) >= 0;
      if (!terminal) {
        vatRefreshIfShowing(vatGroupJob.eventId);
        pollVatGroupJob();
        return;
      }
      await finishVatGroupJob(job);
    }, vatGroupJob && vatGroupJob.total === 1 ? 2500 : 8000);
  }

  /** Flags who made it in: "In WA group" when added, "Invite sent" for a join link. */
  async function finishVatGroupJob(job) {
    const run = vatGroupJob;
    const outcome = inqGroupOutcome(job, run.targets);
    const added = run.targets.filter(function (t) { return outcome[t.digits] === "added"; });
    const invited = run.targets.filter(function (t) { return outcome[t.digits] === "invited"; });
    let saveFailed = false;
    const mark = async function (list, field) {
      if (!list.length) return;
      try {
        const data = await apiPost({
          formType: "adminMarkVolunteersInGroup",
          token: token(),
          rowIds: list.map(function (t) { return t.rowId; }),
          field: field,
        });
        if (data.error) throw new Error(data.error);
        list.forEach(function (t) {
          const v = vnFindVolunteer(t.rowId);
          if (v) v[field] = true;
        });
      } catch (err) {
        saveFailed = true;
      }
    };
    await mark(added, "inGroup");
    await mark(invited, "inviteSent");
    vatGroupJob = null;
    vatGroupSaveJob(null);
    const ok = added.length + invited.length;
    const failed = run.targets.length - ok;
    const single = run.targets.length === 1;
    let title;
    let detail;
    if (!ok) {
      title = single ? "Couldn't add " + run.targets[0].name : "Couldn't add anyone";
      detail = "Try again later.";
    } else if (single) {
      title = invited.length ? "Join link sent" : "Added to " + run.group;
      detail = run.targets[0].name + (invited.length ? " can join " + run.group : "");
    } else {
      title = ok + " of " + run.targets.length + " added to " + run.group;
      detail = (invited.length ? invited.length + " via join link" : "All added directly") + (failed ? " · " + failed + " couldn't be added" : "");
    }
    if (job.status === "stopped") detail += ". WhatsApp paused adds — retry the rest in 30 min.";
    if (saveFailed) detail += " (Couldn't save the “in group” tags.)";
    showToast(detail, { tone: !ok || failed || saveFailed ? "warn" : "success", title: title });
    vatRefreshIfShowing(run.eventId);
  }

  function initVatGroup() {
    if (!$("vatGroupSheet")) return;
    $("vgBack").addEventListener("click", function () { vgShowStep("people"); });
    $("vgToggleAll").addEventListener("click", function () {
      const anyOn = vgCands.some(function (c) { return c.checked; });
      vgCands.forEach(function (c) {
        c.checked = !anyOn && c.present && !c.already && !!c.digits;
      });
      vgRenderPeople();
      vgRenderFoot();
    });
    $("vgPeople").addEventListener("change", function (e) {
      const box = e.target.closest("[data-vg-person]");
      if (!box) return;
      vgCands[Number(box.getAttribute("data-vg-person"))].checked = box.checked;
      $("vgCount").textContent = vgCands.filter(function (c) { return c.checked; }).length + " selected";
      $("vgToggleAll").textContent = vgCands.some(function (c) { return c.checked; }) ? "Deselect all" : "Select all present";
      vgRenderFoot();
    });
    $("vgSearch").addEventListener("input", function () { vgRenderGroups(this.value); });
    $("vgGroupList").addEventListener("click", function (e) {
      const pick = e.target.closest("[data-vg-pick]");
      if (!pick) return;
      const jid = pick.getAttribute("data-vg-pick");
      const g = (inqGroupGroups || []).find(function (x) { return x.jid === jid; });
      vgPicked = { jid: jid, name: g ? g.name : "the group" };
      vgRenderGroups($("vgSearch").value);
      vgRenderFoot();
    });
    $("vgNext").addEventListener("click", function () {
      if (vgStep === "people") vgShowStep("pick");
      else vgStart();
    });
    // Resume a job that was running before a reload.
    vatGroupJob = vatGroupLoadJob();
    if (vatGroupJob) pollVatGroupJob();
  }

  /** One line by default; grows with the note up to a few lines. */
  function autosizeInquiryCta(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }

  function initInquiryCtaFields() {
    const list = $("inquiryList");
    if (!list) return;
    list.addEventListener("input", function (e) {
      const el = e.target.closest("[data-inquiry-remarks]");
      if (!el) return;
      autosizeInquiryCta(el);
      const card = el.closest(".inquiry-card");
      const item = card && findInquiry(card.getAttribute("data-sheet"), card.getAttribute("data-id"));
      const saved = item ? inquiryField(item, "remarks") : "";
      if (card) card.classList.toggle("is-cta-dirty", el.value.trim() !== String(saved || "").trim());
    });
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

  let promoItems = [];
  let promoView = "today";
  let promoComposeDateYmd = "";
  let promoOpenId = "";
  let editingPromoId = "";
  let pendingPromoFlyer = null;
  let promoFlyerOverrideUrl = "";
  let promoToastTimer = null;
  let promoUndoFn = null;
  let teamUsers = [];
  const MAX_PROMO_SLOTS = 4;
  const PROMO_SLOT_DEFAULTS = ["10:00", "13:00", "17:00", "20:00"];
  const PROMO_IMG_ICON =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
  const PROMO_CHEV =
    '<svg class="promo-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  function promoStatusLabel(status) {
    if (status === "ready") return "Ready";
    if (status === "due") return "Due";
    if (status === "sent") return "Sent";
    return "Pending";
  }

  function normalizePromoClientStatus(status) {
    const s = String(status || "").trim().toLowerCase();
    if (s === "needs_copy") return "pending";
    return s || "pending";
  }

  function setPromoStatus(message, isError) {
    if (isError) showPromoToast(message || "", null);
    else if (message) showPromoToast(message, null);
  }

  function showPromoToast(msg, undoFn, opts) {
    const o = opts || {};
    const toast = $("promoToast");
    const msgEl = $("promoToastMsg");
    const undoBtn = $("promoToastUndo");
    if (!toast || !msgEl) return;
    msgEl.textContent = msg || "";
    promoUndoFn = typeof undoFn === "function" ? undoFn : null;
    if (undoBtn) {
      undoBtn.classList.toggle("hidden", !promoUndoFn);
      undoBtn.textContent = o.label || "Undo";
    }
    toast.classList.add("show");
    clearTimeout(promoToastTimer);
    promoToastTimer = setTimeout(function () {
      toast.classList.remove("show");
      promoUndoFn = null;
    }, o.ms || 4200);
  }

  function flyerDownloadUrl(url) {
    const id = driveFileId(url);
    if (id) return "https://drive.google.com/uc?export=download&id=" + id;
    return url || "";
  }

  function promoFlyerUrl(item) {
    if (!item) return "";
    return String(item.flyer_url || item.event_image || "").trim();
  }

  function pad2Promo(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function shiftYmd(ymd, days) {
    const parts = String(ymd || "").split("-");
    if (parts.length !== 3) return "";
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + days);
    return (
      dt.getFullYear() +
      "-" +
      pad2Promo(dt.getMonth() + 1) +
      "-" +
      pad2Promo(dt.getDate())
    );
  }

  function promoTodayYmd() {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch (err) {
      const d = new Date();
      return d.getFullYear() + "-" + pad2Promo(d.getMonth() + 1) + "-" + pad2Promo(d.getDate());
    }
  }

  function promoViewYmd() {
    const today = promoTodayYmd();
    return promoView === "tomorrow" ? shiftYmd(today, 1) : today;
  }

  function promoViewForYmd(ymd) {
    const today = promoTodayYmd();
    if (ymd === today) return "today";
    if (ymd === shiftYmd(today, 1)) return "tomorrow";
    return "library";
  }

  function readPromoComposeDate() {
    const el = $("promoComposeDate");
    const val = el && el.value ? String(el.value).trim() : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(val) && val >= promoTodayYmd()) return val;
    return promoComposeDateYmd || promoTodayYmd();
  }

  function promoComposeYmd() {
    return readPromoComposeDate();
  }

  function splitSendAt(sendAt) {
    const key = String(sendAt || "").replace("T", " ").trim();
    const m = key.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    if (!m) return { date: "", hm: "" };
    return { date: m[1], hm: m[2] };
  }

  function formatPromoWhen(sendAt) {
    const parts = splitSendAt(sendAt);
    if (!parts.date || !parts.hm) return "";
    return parts.date.split("-").reverse().join("/") + " · " + formatHmAmPm(parts.hm);
  }

  function splitHmDisplay(hm) {
    const label = formatHmAmPm(hm);
    const m = String(label).match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
    if (!m) return { time: label || "--", mer: "" };
    return { time: m[1], mer: m[2].toUpperCase() };
  }

  function formatPromoDayTitle(view) {
    const ymd = view === "tomorrow" ? shiftYmd(promoTodayYmd(), 1) : promoTodayYmd();
    const parts = ymd.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayNum = parseInt(parts[2], 10);
    const mon = months[parseInt(parts[1], 10) - 1] || "";
    if (view === "library") return "Events";
    const weekday = new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
    return weekday + ", " + dayNum + " " + mon;
  }

  function promoNowLabel() {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).formatToParts(new Date());
      let hour = "";
      let minute = "";
      let dayPeriod = "";
      parts.forEach(function (p) {
        if (p.type === "hour") hour = p.value;
        if (p.type === "minute") minute = p.value;
        if (p.type === "dayPeriod") dayPeriod = p.value.toUpperCase();
      });
      return hour + ":" + minute + " " + dayPeriod;
    } catch (err) {
      return "";
    }
  }

  function promosForDay(ymd, opts) {
    opts = opts || {};
    const includeSent = !!opts.includeSent;
    return promoItems
      .filter(function (item) {
        if (!includeSent && normalizePromoClientStatus(item.status) === "sent") return false;
        return splitSendAt(item.send_at).date === ymd;
      })
      .sort(function (a, b) {
        return String(a.send_at || "").localeCompare(String(b.send_at || ""));
      });
  }

  function nextFreeSlotHm(ymd) {
    const used = {};
    promosForDay(ymd, { includeSent: true }).forEach(function (item) {
      const hm = splitSendAt(item.send_at).hm;
      if (hm) used[hm] = true;
    });
    for (let i = 0; i < PROMO_SLOT_DEFAULTS.length; i++) {
      if (!used[PROMO_SLOT_DEFAULTS[i]]) return PROMO_SLOT_DEFAULTS[i];
    }
    return "10:00";
  }

  function openLibraryPromos() {
    return promoItems
      .filter(function (item) {
        return item.event_open !== false;
      })
      .filter(function (item) {
        const s = normalizePromoClientStatus(item.status);
        return s === "pending" || s === "ready" || s === "due";
      })
      .sort(function (a, b) {
        const order = { pending: 0, ready: 1, due: 2 };
        const sa = normalizePromoClientStatus(a.status);
        const sb = normalizePromoClientStatus(b.status);
        const da = order[sa] != null ? order[sa] : 9;
        const db = order[sb] != null ? order[sb] : 9;
        if (da !== db) return da - db;
        return String(a.event_title || "").localeCompare(String(b.event_title || ""));
      });
  }

  function annotatePromoUi(list) {
    let nextMarked = false;
    return list.map(function (item) {
      const status = normalizePromoClientStatus(item.status);
      let ui = "upcoming";
      if (status === "sent") ui = "sent";
      else if (status === "due") ui = "late";
      else if (!nextMarked) {
        ui = "next";
        nextMarked = true;
      }
      return { item: item, ui: ui };
    });
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
    if (!parts.date || !parts.hm) return "Up next";
    const target = new Date(parts.date.replace(/-/g, "/") + " " + parts.hm);
    if (isNaN(target.getTime())) return "Up next";
    const mins = Math.round((target.getTime() - Date.now()) / 60000);
    if (mins <= 0) return "Due now";
    if (mins < 60) return "in " + mins + " min";
    const hrs = Math.round(mins / 60);
    return "in " + hrs + (hrs === 1 ? " hr" : " hrs");
  }

  function formatPromoPickScheduleWhen(sendAt) {
    const parts = splitSendAt(sendAt);
    if (!parts.date || !parts.hm) return "";
    const dp = parts.date.split("-");
    const dt = new Date(Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]));
    if (isNaN(dt.getTime())) return "";
    const day = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const clock = formatHmAmPm(parts.hm);
    if (!clock) return "";
    return day + " · " + clock;
  }

  function promoPickStatusMarkup(item) {
    const status = normalizePromoClientStatus(item.status);
    const when = formatPromoPickScheduleWhen(item.send_at);
    if (status === "pending") {
      return (
        '<span class="promo-pick-status promo-pick-status--pending">' +
        '<span class="promo-pick-status-kind">Pending</span></span>'
      );
    }
    if (when) {
      const mod = status === "due" ? "due" : "scheduled";
      const kind = status === "due" ? "Overdue" : "Scheduled";
      const sub = status === "due" ? formatLateBy(item.send_at) : when;
      return (
        '<span class="promo-pick-status promo-pick-status--' +
        escapeHtml(mod) +
        '">' +
        '<span class="promo-pick-status-kind">' +
        kind +
        '</span><span class="promo-pick-status-when">' +
        escapeHtml(sub) +
        "</span></span>"
      );
    }
    return (
      '<span class="promo-pick-status promo-pick-status--ready">' +
      '<span class="promo-pick-status-kind">Ready</span></span>'
    );
  }

  function formatSentAt(item) {
    const raw = String(item.sent_at || "").trim();
    if (!raw) return "";
    const m = raw.match(/(\d{1,2}):(\d{2})/);
    if (!m) return "";
    return formatHmAmPm(pad2Promo(parseInt(m[1], 10) % 24) + ":" + m[2]);
  }

  function setPromoView(view) {
    if (view === "library" || view === "messages") promoView = "library";
    else if (view === "tomorrow") promoView = "tomorrow";
    else promoView = "today";
    document.querySelectorAll("[data-promo-view]").forEach(function (btn) {
      const on = btn.getAttribute("data-promo-view") === promoView;
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const title = $("promoDayTitle");
    if (title) title.textContent = formatPromoDayTitle(promoView);
    const progress = $("promoProgress");
    if (progress) progress.style.visibility = promoView === "library" ? "hidden" : "visible";
    renderPromotions();
  }

  function setPromoMainTab(tab) {
    if (tab === "library" || tab === "messages") setPromoView("library");
    else setPromoView(promoView === "tomorrow" ? "tomorrow" : "today");
  }

  function setPromoDayTab(day) {
    setPromoView(day === "tomorrow" ? "tomorrow" : "today");
  }

  function promoUiPill(entry) {
    const item = entry.item;
    if (entry.ui === "sent") {
      const at = formatSentAt(item);
      return '<span class="promo-pill sent">Sent' + (at ? " " + escapeHtml(at) : "") + "</span>";
    }
    if (entry.ui === "late") {
      return '<span class="promo-pill late">' + escapeHtml(formatLateBy(item.send_at)) + "</span>";
    }
    if (entry.ui === "next") {
      return '<span class="promo-pill next">Next · ' + escapeHtml(formatDueIn(item.send_at)) + "</span>";
    }
    return "";
  }

  function renderPromoCard(entry) {
    const item = entry.item;
    const id = String(item.id);
    const isOpen = String(promoOpenId) === id;
    const hm = splitSendAt(item.send_at).hm || "10:00";
    const clock = splitHmDisplay(hm);
    const flyer = promoFlyerUrl(item);
    const thumb = flyer
      ? '<img src="' +
        escapeHtml(fixDriveUrl(flyer)) +
        '" alt="" loading="lazy" referrerpolicy="no-referrer"/>'
      : PROMO_IMG_ICON;
    const whereBits = [item.event_location, item.event_date].filter(Boolean).join(" · ");
    const caption = String(item.message || "").trim();
    let actions = "";
    if (entry.ui === "sent") {
      actions =
        '<button type="button" class="promo-btn done" data-promo-unsend="' +
        escapeHtml(id) +
        '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>Sent' +
        (formatSentAt(item) ? " at " + escapeHtml(formatSentAt(item)) : "") +
        " · Undo</button>";
    } else {
      actions =
        '<div class="promo-pair">' +
        '<button type="button" class="promo-btn ghost" data-promo-copy="' +
        escapeHtml(id) +
        '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy text</button>' +
        (flyer
          ? '<a class="promo-btn ghost" href="' +
            escapeHtml(flyerDownloadUrl(flyer)) +
            '" target="_blank" rel="noopener noreferrer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>Open flyer</a>'
          : '<button type="button" class="promo-btn ghost" disabled>No flyer</button>') +
        "</div>" +
        '<button type="button" class="promo-btn primary" data-promo-sent="' +
        escapeHtml(id) +
        '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>Mark as sent</button>';
    }
    return (
      '<article class="promo-row is-' +
      escapeHtml(entry.ui) +
      (isOpen ? " open" : "") +
      '" data-promo-id="' +
      escapeHtml(id) +
      '">' +
      '<div class="promo-rail">' +
      '<div class="promo-rail-time">' +
      escapeHtml(clock.time) +
      "</div>" +
      (clock.mer ? '<div class="promo-rail-mer">' + escapeHtml(clock.mer) + "</div>" : "") +
      '<span class="promo-node" aria-hidden="true"></span></div>' +
      '<div class="promo-card">' +
      '<button type="button" class="promo-head" data-promo-toggle="' +
      escapeHtml(id) +
      '" aria-expanded="' +
      (isOpen ? "true" : "false") +
      '">' +
      '<span class="promo-thumb">' +
      thumb +
      "</span>" +
      '<span class="promo-head-txt"><span class="promo-title">' +
      escapeHtml(item.event_title || "Untitled") +
      "</span>" +
      '<span class="promo-meta">' +
      promoUiPill(entry) +
      (whereBits ? "<span>" + escapeHtml(whereBits) + "</span>" : "") +
      "</span></span>" +
      PROMO_CHEV +
      "</button>" +
      '<div class="promo-body">' +
      '<div class="promo-caption-lbl">Message<button type="button" class="promo-link-btn" data-promo-open="' +
      escapeHtml(id) +
      '">Edit</button></div>' +
      '<div class="promo-caption">' +
      (caption ? escapeHtml(caption) : "No message yet") +
      "</div>" +
      actions +
      '<div class="promo-more"><button type="button" data-promo-unschedule="' +
      escapeHtml(id) +
      '">Remove from day</button></div>' +
      "</div></div></article>"
    );
  }

  function renderPromoProgress(list, isToday) {
    const meter = $("promoMeter");
    const txt = $("promoProgressTxt");
    if (!meter || !txt) return;
    const annotated = annotatePromoUi(list);
    meter.innerHTML = annotated
      .map(function (entry) {
        const cls =
          entry.ui === "sent" ? "done" : entry.ui === "late" ? "late" : "";
        return '<span class="promo-seg' + (cls ? " " + cls : "") + '"></span>';
      })
      .join("");
    if (!list.length) {
      txt.innerHTML = "<b>0 posts</b> scheduled · up to " + MAX_PROMO_SLOTS;
      return;
    }
    if (!isToday) {
      const first = splitHmDisplay(splitSendAt(list[0].send_at).hm);
      txt.innerHTML =
        "<b>" +
        list.length +
        " post" +
        (list.length === 1 ? "" : "s") +
        "</b> scheduled · first at " +
        escapeHtml(first.time + (first.mer ? " " + first.mer : ""));
      return;
    }
    const sent = list.filter(function (item) {
      return normalizePromoClientStatus(item.status) === "sent";
    }).length;
    const late = list.filter(function (item) {
      return normalizePromoClientStatus(item.status) === "due";
    }).length;
    txt.innerHTML =
      "<b>" +
      sent +
      " of " +
      list.length +
      " sent</b>" +
      (late ? " · " + late + " overdue" : "");
  }

  function renderPromoLibrary() {
    const host = $("promoScroll");
    if (!host) return;
    const openItems = openLibraryPromos();
    if (!openItems.length) {
      host.innerHTML =
        '<div class="promo-empty"><h3>No events yet</h3><p>Open programs appear here. Tap New post after Programs publishes an event.</p></div>';
      return;
    }
    host.innerHTML =
      '<div class="promo-grid">' +
      openItems
        .map(function (item) {
          const flyer = promoFlyerUrl(item);
          const status = normalizePromoClientStatus(item.status);
          const art = flyer
            ? '<img src="' +
              escapeHtml(fixDriveUrl(flyer)) +
              '" alt="" loading="lazy" referrerpolicy="no-referrer"/>'
            : PROMO_IMG_ICON;
          return (
            '<button type="button" class="promo-lib" data-promo-open="' +
            escapeHtml(item.id) +
            '"><span class="promo-lib-art">' +
            art +
            '</span><span class="promo-lib-cap"><b>' +
            escapeHtml(item.event_title || "Untitled") +
            "</b><span>" +
            (status === "pending" ? "Pending" : "Ready") +
            (item.send_at ? " · scheduled" : "") +
            "</span></span></button>"
          );
        })
        .join("") +
      "</div>";
  }

  function renderPromoSchedule() {
    const host = $("promoScroll");
    if (!host) return;
    const isToday = promoView === "today";
    const ymd = promoViewYmd();
    const list = promosForDay(ymd, { includeSent: true });
    renderPromoProgress(list, isToday);

    if (!list.length) {
      host.innerHTML =
        '<div class="promo-empty"><h3>Nothing scheduled for ' +
        (isToday ? "today" : "tomorrow") +
        "</h3><p>Create a post, write the message, add a flyer, and pick a time.</p></div>";
      return;
    }

    const annotated = annotatePromoUi(list);
    let html = "";
    let placedNow = false;
    annotated.forEach(function (entry) {
      if (isToday && !placedNow && (entry.ui === "next" || entry.ui === "upcoming")) {
        const now = promoNowLabel();
        if (now) {
          html +=
            '<div class="promo-now"><div class="promo-now-lbl">' +
            escapeHtml(now) +
            '</div><div class="promo-now-line"></div></div>';
        }
        placedNow = true;
      }
      html += renderPromoCard(entry);
    });
    host.innerHTML = html;
  }

  function renderPromotions() {
    if (promoView === "library") renderPromoLibrary();
    else renderPromoSchedule();
  }

  async function loadPromotions() {
    const host = $("promoScroll");
    const cached = readCached("promotions");
    if (cached && cached.items) {
      promoItems = cached.items.map(function (item) {
        item.status = normalizePromoClientStatus(item.status);
        return item;
      });
      renderPromotions();
    } else if (host) {
      host.innerHTML =
        '<div class="promo-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading…</div>';
    }
    setPageBusy(true);
    try {
      const data = await apiGet("promotions", true);
      if (data.error && /Unauthorized/i.test(data.error)) {
        logout();
        loginError(data.error);
        return;
      }
      if (data.error) throw new Error(data.error);
      promoItems = (data.items || []).map(function (item) {
        item.status = normalizePromoClientStatus(item.status);
        return item;
      });
      promoCacheDirty = false;
      renderPromotions();
    } catch (err) {
      if (!(cached && cached.items)) {
        promoItems = [];
        renderPromotions();
      }
      showPromoToast(err.message || "Could not load promotions.", null);
    } finally {
      setPageBusy(false);
    }
  }

  function findPromo(id) {
    return promoItems.find(function (item) {
      return String(item.id) === String(id);
    });
  }

  function syncPromoWhenFields() {
    const scheduleOn = $("promoWhenSchedule") && $("promoWhenSchedule").checked;
    show($("promoWhenFields"), !!scheduleOn);
    const btn = $("savePromoBtn");
    if (btn && !btn.classList.contains("is-busy")) {
      btn.textContent = scheduleOn ? "Schedule" : "Save";
    }
    if (scheduleOn) syncPromoComposeDateHint();
  }

  function syncPromoComposeDateHint() {
    const item = findPromo(editingPromoId);
    const ymd = readPromoComposeDate();
    const used = promosForDay(ymd, { includeSent: true }).filter(function (p) {
      return !item || String(p.id) !== String(item.id);
    }).length;
    const left = Math.max(0, MAX_PROMO_SLOTS - used);
    const hint = $("promoComposeDateHint");
    if (hint) {
      hint.textContent = left
        ? left + (left === 1 ? " slot free on this day" : " slots free on this day")
        : "Day is full — pick another date";
    }
  }

  function setPromoComposeDate(ymd) {
    const today = promoTodayYmd();
    let next = String(ymd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next < today) next = today;
    promoComposeDateYmd = next;
    const dateEl = $("promoComposeDate");
    if (dateEl) {
      dateEl.min = today;
      dateEl.value = next;
    }
    fillTimeSelects();
    const timeEl = $("promoComposeTime");
    if (timeEl) timeEl.value = snapHm(nextFreeSlotHm(next)) || "10:00";
    syncPromoComposeDateHint();
  }

  async function pastePromoMessage() {
    const box = $("promoMessage");
    const err = $("promoEditorError");
    if (!box) return;
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        throw new Error("Clipboard not available in this browser.");
      }
      const text = await navigator.clipboard.readText();
      if (!String(text || "").trim()) {
        if (err) {
          err.textContent = "Clipboard is empty.";
          err.style.display = "block";
        }
        return;
      }
      box.value = text;
      if (err) {
        err.textContent = "";
        err.style.display = "none";
      }
      box.focus();
    } catch (e) {
      if (err) {
        err.textContent = "Could not paste — tap the message field and paste manually.";
        err.style.display = "block";
      }
    }
  }

  function syncPromoFlyerResetBtn(item) {
    const btn = $("promoFlyerResetBtn");
    if (!btn || !item) return;
    const programs = String(item.event_image || "").trim();
    if (!programs) {
      btn.classList.add("hidden");
      return;
    }
    const current = pendingPromoFlyer
      ? "__pending__"
      : promoFlyerOverrideUrl || String(item.flyer_url || "").trim() || programs;
    btn.classList.toggle("hidden", current === programs);
  }

  function setPromoFlyerPreview(url) {
    const img = $("promoFlyerPreview");
    const missing = $("promoFlyerMissing");
    const hint = $("promoFlyerHint");
    if (!img) return;
    if (!url) {
      img.removeAttribute("src");
      img.style.display = "none";
      if (missing) missing.classList.remove("hidden");
      if (hint) hint.classList.add("hidden");
      return;
    }
    img.src = fixDriveUrl(url);
    img.style.display = "block";
    if (missing) missing.classList.add("hidden");
    if (hint) hint.classList.remove("hidden");
  }

  function openPromoEditor(item, opts) {
    opts = opts || {};
    editingPromoId = item.id;
    pendingPromoFlyer = null;
    promoFlyerOverrideUrl = "";
    if ($("promoFlyerFile")) $("promoFlyerFile").value = "";
    if ($("promoFlyerFileName")) $("promoFlyerFileName").textContent = "Choose flyer";
    $("promoEditorTitle").textContent = item.event_title || "Compose post";
    const bits = [item.event_date, item.event_location].filter(Boolean);
    $("promoEventMeta").textContent = bits.join(" · ");
    $("promoMessage").value = item.message || "";
    setPromoFlyerPreview(promoFlyerUrl(item));
    syncPromoFlyerResetBtn(item);
    $("promoEditorError").textContent = "";
    $("promoEditorError").style.display = "none";

    fillTimeSelects();
    const preferSchedule = !!opts.preferSchedule || !String(item.message || "").trim();
    if ($("promoWhenSchedule")) $("promoWhenSchedule").checked = preferSchedule;
    if ($("promoWhenSaveOnly")) $("promoWhenSaveOnly").checked = !preferSchedule;
    const sendParts = splitSendAt(item.send_at);
    const today = promoTodayYmd();
    const initialDate =
      sendParts.date && sendParts.date >= today ? sendParts.date : today;
    setPromoComposeDate(initialDate);
    syncPromoWhenFields();

    const actions = $("promoEditorActions");
    if (actions) {
      actions.innerHTML =
        '<button type="button" class="btn btn-outline" id="cancelPromoEditorBtn">Cancel</button>' +
        '<button type="button" class="btn btn-gold" id="savePromoBtn">' +
        (preferSchedule ? "Schedule" : "Save") +
        "</button>";
    }
    $("promoOverlay").classList.add("open");
    const body = $("promoOverlay").querySelector(".admin-editor-body");
    if (body) body.scrollTop = 0;
    if (!String(item.message || "").trim() && $("promoMessage")) {
      setTimeout(function () {
        $("promoMessage").focus();
      }, 50);
    }
  }

  function closePromoEditor() {
    $("promoOverlay").classList.remove("open");
    editingPromoId = "";
    pendingPromoFlyer = null;
    promoFlyerOverrideUrl = "";
  }

  function renderPromoPickList(filter) {
    const host = $("promoPickList");
    if (!host) return;
    const q = String(filter || "")
      .trim()
      .toLowerCase();
    const items = openLibraryPromos().filter(function (item) {
      if (!q) return true;
      return (
        String(item.event_title || "")
          .toLowerCase()
          .indexOf(q) >= 0 ||
        String(item.event_location || "")
          .toLowerCase()
          .indexOf(q) >= 0
      );
    });
    if (!items.length) {
      host.innerHTML =
        '<div class="admin-empty">No open programs found. Ask Programs to publish an event first.</div>';
      return;
    }
    host.innerHTML = items
      .map(function (item) {
        const flyer = promoFlyerUrl(item);
        const thumb = flyer
          ? '<img src="' +
            escapeHtml(fixDriveUrl(flyer)) +
            '" alt="" loading="lazy" referrerpolicy="no-referrer"/>'
          : '<span class="promo-pick-thumb-empty" aria-hidden="true"></span>';
        return (
          '<button type="button" class="promo-pick-row" data-promo-pick="' +
          escapeHtml(item.id) +
          '">' +
          '<span class="promo-pick-thumb">' +
          thumb +
          "</span>" +
          '<span class="promo-pick-copy">' +
          "<strong>" +
          escapeHtml(item.event_title || "Untitled") +
          "</strong>" +
          (item.event_date
            ? '<span class="promo-pick-date">' + escapeHtml(item.event_date) + "</span>"
            : "") +
          "</span>" +
          promoPickStatusMarkup(item) +
          "</button>"
        );
      })
      .join("");
  }

  function openPromoPicker() {
    if ($("promoPickSearch")) $("promoPickSearch").value = "";
    renderPromoPickList("");
    $("promoPickOverlay").classList.add("open");
  }

  function closePromoPicker() {
    $("promoPickOverlay").classList.remove("open");
  }

  async function copyPromoMessage(id) {
    const item = findPromo(id);
    if (!item || !item.message) {
      showPromoToast("No message to copy.", null);
      return;
    }
    try {
      await navigator.clipboard.writeText(item.message);
      showPromoToast("Message copied", null);
    } catch (err) {
      showPromoToast("Could not copy. Select the message and copy it yourself.", null);
    }
  }

  /* Answers at once: the editor closes and a toast says it's on its way;
     the upload and Apps Script save run behind it. A failure comes back as
     a toast with Retry, which re-runs the same save. */
  function savePromoEditor() {
    const item = findPromo(editingPromoId);
    if (!item) return;
    const err = $("promoEditorError");
    const message = ($("promoMessage").value || "").trim();
    const wantSchedule = $("promoWhenSchedule") && $("promoWhenSchedule").checked;
    err.textContent = "";
    err.style.display = "none";
    const fail = function (text) {
      err.textContent = text;
      err.style.display = "block";
    };
    if (!message) return fail("Write a message.");

    const job = {
      id: item.id,
      message: message,
      wantSchedule: wantSchedule,
      flyerUrl: promoFlyerOverrideUrl || String(item.flyer_url || "").trim() || String(item.event_image || "").trim(),
      pendingFlyer: pendingPromoFlyer,
      sendAt: "",
      ymd: "",
    };
    if (wantSchedule) {
      if (!job.flyerUrl && !job.pendingFlyer) {
        return fail("Add a flyer before scheduling, or ask Programs to upload an event photo.");
      }
      job.ymd = promoComposeYmd();
      if (
        promosForDay(job.ymd, { includeSent: true }).filter(function (p) {
          return String(p.id) !== String(item.id);
        }).length >= MAX_PROMO_SLOTS
      ) {
        return fail("Only " + MAX_PROMO_SLOTS + " posts can be scheduled on one day.");
      }
      const hm =
        normalizeHm(($("promoComposeTime") && $("promoComposeTime").value) || "") ||
        nextFreeSlotHm(job.ymd);
      job.sendAt = job.ymd + " " + hm;
    }
    closePromoEditor();
    if (wantSchedule) setPromoView(promoViewForYmd(job.ymd));
    runPromoSave(job);
  }

  async function runPromoSave(job) {
    showPromoToast(job.wantSchedule ? "Scheduling… you can keep working" : "Saving…", null);
    try {
      let flyerUrl = job.flyerUrl;
      if (job.pendingFlyer) flyerUrl = await uploadPayload(job.pendingFlyer);
      const payload = {
        formType: "adminSavePromotion",
        token: token(),
        id: job.id,
        message: job.message,
        flyer_url: flyerUrl,
      };
      if (job.sendAt) payload.send_at = job.sendAt;
      const data = await apiPost(payload);
      if (data.error) throw new Error(data.error);
      showPromoToast(job.wantSchedule ? "Scheduled" : "Saved to Events", null);
      await loadPromotions();
    } catch (e) {
      showPromoToast(
        "Couldn't " + (job.wantSchedule ? "schedule" : "save") + ": " + friendlyError(e.message),
        function () { runPromoSave(job); },
        { label: "Retry", ms: 15000 }
      );
    }
  }

  async function clearPromoSlot(id) {
    const data = await apiPost({
      formType: "adminSavePromotion",
      token: token(),
      id: id,
      send_at: "",
    });
    if (data.error) throw new Error(data.error);
    promoOpenId = "";
    await loadPromotions();
  }

  async function markPromoSent(id) {
    const item = findPromo(id);
    const title = item ? item.event_title || "Post" : "Post";
    const data = await apiPost({
      formType: "adminMarkPromotionSent",
      token: token(),
      id: id,
    });
    if (data.error) throw new Error(data.error);
    closePromoEditor();
    promoOpenId = "";
    await loadPromotions();
    showPromoToast(title + " marked as sent", function () {
      unmarkPromoSent(id);
    });
  }

  async function unmarkPromoSent(id) {
    const data = await apiPost({
      formType: "adminSavePromotion",
      token: token(),
      id: id,
      clear_sent: true,
    });
    if (data.error) {
      if (/Unknown formType/i.test(data.error)) {
        throw new Error("Redeploy Apps Script: paste latest apps-script.js → Deploy → New version.");
      }
      throw new Error(data.error);
    }
    if (data.item && normalizePromoClientStatus(data.item.status) === "sent") {
      throw new Error("Redeploy Apps Script: paste latest apps-script.js → Deploy → New version.");
    }
    await loadPromotions();
    showPromoToast("Restored to schedule", null);
  }

  async function addPromoPost(eventType, eventId) {
    const data = await apiPost({
      formType: "adminAddPromotion",
      token: token(),
      event_type: eventType,
      event_id: eventId,
    });
    if (data.error) throw new Error(data.error);
    await loadPromotions();
    if (data.item) openPromoEditor(data.item, { preferSchedule: true });
  }

  function readPromoDueStamp() {
    try {
      return localStorage.getItem(PROMO_DUE_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function writePromoDueStamp(stamp) {
    try {
      if (stamp) localStorage.setItem(PROMO_DUE_KEY, stamp);
    } catch (e) {}
  }

  async function showPromoNotification(item) {
    if (!queryNotifyEnabled() || !navigator.serviceWorker) return;
    const title = "Time to share";
    const body = (item && item.event_title) || "A promotion is due.";
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body: "Time to share: " + body,
        icon: "assets/icon-192.png",
        badge: "assets/icon-192.png",
        tag: "vjn-promo-due",
        renotify: true,
        data: { url: "admin-promotions.html", type: "promo" },
      });
      return;
    } catch (err) {}
    try {
      new Notification(title, { body: "Time to share: " + body, icon: "assets/icon-192.png" });
    } catch (err) {}
  }

  async function checkDuePromos() {
    if (promoWatchBusy || !token() || !queryNotifyEnabled() || !canNotifyPromos()) return;
    promoWatchBusy = true;
    try {
      const data = await apiGet("promotions", true, { due: "1" });
      if (data && data.error && /Unauthorized/i.test(data.error)) {
        stopAlertWatch();
        logout();
        loginError(data.error);
        return;
      }
      if (!data || data.error) return;
      const nextStamp = data.stamp || "";
      const prevStamp = readPromoDueStamp();
      if (!prevStamp) {
        writePromoDueStamp(nextStamp || "empty");
        return;
      }
      if (nextStamp === prevStamp) return;
      const prevIds = prevStamp === "empty" ? [] : prevStamp.split("|").filter(Boolean);
      const nextIds = nextStamp.split("|").filter(Boolean);
      const added = nextIds.filter(function (id) {
        return prevIds.indexOf(id) < 0;
      });
      writePromoDueStamp(nextStamp || "empty");
      if (!added.length) return;
      const dueItem = (data.due || data.items || []).find(function (item) {
        return added.indexOf(item.id) >= 0;
      });
      await showPromoNotification(dueItem);
      hubStatsDirty = true;
      const app = $("adminApp");
      if (app && app.classList.contains("is-hub")) loadHubStats(true);
      else if (app && app.classList.contains("is-promotions")) loadPromotions();
    } catch (err) {
    } finally {
      promoWatchBusy = false;
    }
  }

  function setTeamStatus(message, isError) {
    const el = $("teamStatus");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", !!isError);
  }

  function renderTeam() {
    const host = $("teamList");
    if (!host) return;
    if (!teamUsers.length) {
      host.innerHTML = '<div class="admin-empty">No people yet.</div>';
      return;
    }
    const me = currentUser();
    host.innerHTML = teamUsers
      .map(function (user) {
        const disabled = String(user.status || "").toLowerCase() === "disabled";
        const self = me && String(me.id) === String(user.id);
        return (
          '<article class="inquiry-card team-card' +
          (disabled ? " is-resolved" : "") +
          '" data-user-id="' +
          escapeHtml(user.id) +
          '">' +
          '<div class="inquiry-ticket-main">' +
          '<span class="inquiry-avatar" aria-hidden="true">' +
          escapeHtml((user.displayName || user.username || "?").slice(0, 1).toUpperCase()) +
          "</span>" +
          '<span class="inquiry-ticket-copy">' +
          '<span class="inquiry-ticket-top">' +
          '<span class="inquiry-ticket-who"><strong>' +
          escapeHtml(user.displayName || ROLE_LABELS[user.role] || user.role) +
          "</strong></span>" +
          '<span class="inquiry-badge">' +
          escapeHtml(ROLE_LABELS[user.role] || user.role) +
          "</span></span>" +
          '<span class="inquiry-topic"><span>' +
          (disabled ? "Disabled" : "Active") +
          (self ? " · you" : "") +
          "</span></span></span></div>" +
          '<div class="promo-card-foot">' +
          '<button type="button" class="btn btn-outline" data-user-edit="' +
          escapeHtml(user.id) +
          '">Edit</button>' +
          (self
            ? ""
            : '<button type="button" class="btn btn-outline" data-user-status="' +
              escapeHtml(user.id) +
              '" data-status="' +
              (disabled ? "active" : "disabled") +
              '">' +
              (disabled ? "Enable" : "Disable") +
              "</button>") +
          "</div></article>"
        );
      })
      .join("");
  }

  async function loadTeam() {
    const host = $("teamList");
    const cached = readCached("users");
    if (cached && cached.users) {
      teamUsers = cached.users;
      renderTeam();
    } else if (host) {
      host.innerHTML =
        '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading people…</div>';
    }
    setPageBusy(true);
    try {
      let data;
      if (isPiToken(token())) {
        data = await piCall("/vjn/users", { auth: true });
        if (!data.error) writeCached("users", undefined, data);
      } else {
        data = await apiGet("users", true);
      }
      if (data.error && /Unauthorized/i.test(data.error)) {
        logout();
        loginError(data.error);
        return;
      }
      if (data.error) throw new Error(data.error);
      teamUsers = data.users || [];
      renderTeam();
      setTeamStatus("");
    } catch (err) {
      if (!(cached && cached.users)) {
        teamUsers = [];
        renderTeam();
      }
      setTeamStatus(err.message, true);
    } finally {
      setPageBusy(false);
    }
  }

  function teamAddError(message) {
    const el = $("teamAddError");
    if (!el) return;
    el.textContent = message || "";
    el.style.display = message ? "block" : "none";
  }

  async function handleAddTeamUser(e) {
    if (e) e.preventDefault();
    teamAddError("");
    const btn = $("teamAddBtn");
    setButtonBusy(btn, true, "Adding…");
    try {
      const data = await saveUserAnywhere({
        displayName: $("teamDisplayName").value,
        role: $("teamRole").value,
        password: $("teamPassword").value,
      });
      if (data.error) throw new Error(data.error);
      $("teamDisplayName").value = "";
      $("teamPassword").value = "";
      setPasswordVisible($("teamPassword"), false);
      await loadTeam();
      setTeamStatus("Person added.");
    } catch (err) {
      teamAddError(friendlyError(err.message));
    } finally {
      setButtonBusy(btn, false);
    }
  }

  function openTeamUserEditor(user) {
    $("teamEditId").value = user.id;
    $("teamEditDisplayName").value = user.displayName || "";
    $("teamEditRole").value = user.role || "programs";
    $("teamEditPassword").value = "";
    setPasswordVisible($("teamEditPassword"), false);
    $("teamUserError").textContent = "";
    $("teamUserError").style.display = "none";
    $("teamUserTitle").textContent = user.displayName || ROLE_LABELS[user.role] || "Edit person";
    $("teamUserOverlay").classList.add("open");
  }

  function closeTeamUserEditor() {
    $("teamUserOverlay").classList.remove("open");
  }

  async function saveTeamUser() {
    const btn = $("saveTeamUserBtn");
    const err = $("teamUserError");
    err.textContent = "";
    err.style.display = "none";
    setButtonBusy(btn, true, "Saving…");
    try {
      const payload = {
        id: $("teamEditId").value,
        displayName: $("teamEditDisplayName").value,
        role: $("teamEditRole").value,
      };
      const password = $("teamEditPassword").value;
      if (password) payload.password = password;
      const data = await saveUserAnywhere(payload);
      if (data.error) throw new Error(data.error);
      closeTeamUserEditor();
      await loadTeam();
    } catch (e) {
      err.textContent = e.message;
      err.style.display = "block";
    } finally {
      setButtonBusy(btn, false);
    }
  }

  /** Team writes go to Sandesha for Pi logins, to the Sheet for older ones. */
  async function saveUserAnywhere(fields) {
    if (!isPiToken(token())) {
      return apiPost(Object.assign({ formType: "adminSaveUser", token: token() }, fields));
    }
    const data = await piCall("/vjn/users", { method: "POST", auth: true, body: JSON.stringify(fields) });
    // Changing your own password signs out your other devices; this one gets a new login.
    if (data && data.token) setToken(data.token);
    return data;
  }

  async function setTeamUserStatus(id, status) {
    const data = isPiToken(token())
      ? await piCall("/vjn/users/status", {
          method: "POST",
          auth: true,
          body: JSON.stringify({ id: id, status: status }),
        })
      : await apiPost({
          formType: "adminSetUserStatus",
          token: token(),
          id: id,
          status: status,
        });
    if (data.error) throw new Error(data.error);
    await loadTeam();
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("loginBtn").addEventListener("click", handleLogin);
    document.querySelectorAll("[data-login-role]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showLoginPassword(btn.getAttribute("data-login-role"));
      });
    });
    if ($("loginChangeTeam")) {
      $("loginChangeTeam").addEventListener("click", resetLoginForm);
    }
    $("adminPassword").addEventListener("keydown", function (e) {
      if (e.key === "Enter") handleLogin();
    });
    const notifyBtn = $("queryNotifyBtn");
    if (notifyBtn) notifyBtn.addEventListener("click", onNotifyButton);
    $("cancelNotifyOffBtn").addEventListener("click", closeNotifyOffConfirm);
    $("confirmNotifyOffBtn").addEventListener("click", turnOffQueryAlerts);
    $("notifyOffOverlay").addEventListener("click", function (e) {
      if (e.target === this) closeNotifyOffConfirm();
    });
    // No backdrop-click-to-close here on purpose — dismissing needs the
    // explicit X (or addressing it via the CTA), not a stray tap outside.
    if ($("hubAlertCloseBtn")) $("hubAlertCloseBtn").addEventListener("click", dismissCurrentHubAlert);
    if ($("hubAlertLaterBtn")) $("hubAlertLaterBtn").addEventListener("click", dismissCurrentHubAlert);
    if ($("hubAlertActionBtn")) $("hubAlertActionBtn").addEventListener("click", addressCurrentHubAlert);
    if ($("hubNeeds")) {
      $("hubNeeds").addEventListener("click", function () {
        openAdminPage("volunteering", true);
        openVolNeedsList();
      });
    }
    if ($("hubAlertStackToggle")) {
      $("hubAlertStackToggle").addEventListener("click", function () {
        setHubAlertStackCollapsed(!$("hubAlertStack").classList.contains("is-collapsed"));
      });
    }
    if ($("hubAlertStackCards")) {
      $("hubAlertStackCards").addEventListener("click", function (e) {
        const host = $("hubAlertStack");
        if (host.classList.contains("is-collapsed") && host.querySelectorAll(".hub-alert-stack-card").length > 1) {
          setHubAlertStackCollapsed(false);
          return;
        }
        const dismissBtn = e.target.closest("[data-stack-dismiss]");
        if (dismissBtn) {
          removeFromHubAlertStack(dismissBtn.getAttribute("data-stack-dismiss"));
          return;
        }
        if (e.target.closest("[data-stack-needs]")) {
          openAdminPage("volunteering", true);
          openVolNeedsList();
          return;
        }
        const openBtn = e.target.closest("[data-stack-open]");
        if (openBtn) openHubAlertStackItem(openBtn.getAttribute("data-stack-open"));
      });
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || !queryNotifyEnabled()) return;
      if (canNotifyQueries()) checkNewQueries();
      if (canNotifyPromos()) checkDuePromos();
    });
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", function (event) {
        const data = event.data || {};
        if (!token()) return;
        if (data.type === "OPEN_QUERIES") openAdminPage("queries", true);
        if (data.type === "OPEN_PROMOS") window.location.href = "admin-promotions.html";
        if (data.type === "OPEN_VOLUNTEERING") {
          openAdminPage("volunteering", true);
          if (role() === "nurturing") openVolNeedsList();
          else setVolunteerView("needs");
        }
      });
    }
    window.addEventListener("appinstalled", function () {
      if (token()) startAlertWatch();
    });
    $("logoutBtn").addEventListener("click", openLogoutConfirm);
    if ($("settingsBtn")) {
      $("settingsBtn").addEventListener("click", function () {
        openAdminPage("settings");
      });
    }
    if ($("ptForm")) $("ptForm").addEventListener("submit", submitProgramTitle);
    initSandeshaActivity();
    initInqMessage();
    initConnectForm();
    if ($("sandeshaStatusRefresh")) $("sandeshaStatusRefresh").addEventListener("click", refreshSandeshaStatus);
    if ($("sandeshaQrMail")) $("sandeshaQrMail").addEventListener("click", emailSandeshaQr);
    if ($("gfProgram")) {
      $("gfProgram").addEventListener("change", function () {
        gfLoadTemplates($("gfProgram").value);
      });
      $("gfGrid").addEventListener("click", function (e) {
        const del = e.target.closest("[data-flyer-delete]");
        if (del) return gfDeleteTemplate(del.getAttribute("data-flyer-delete"), del);
        const card = e.target.closest("[data-flyer-id]");
        if (card) gfSelectTemplate(card.getAttribute("data-flyer-id"));
      });
      $("gfGenerateBtn").addEventListener("click", gfGenerate);
    }
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
    // Team password fields: eye button shows / hides what was typed.
    document.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-pw-toggle]");
      if (!btn) return;
      const input = $(btn.getAttribute("data-pw-toggle"));
      if (input) setPasswordVisible(input, input.type === "password");
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
      const next = visibleSlotCount() + 1;
      if (next > MAX_SLOTS) return;
      setVisibleSlotCount(next);
      const d = SLOT_DEFAULTS[next];
      setSlotFields(next, d.start, d.end, "");
      const nameEl = $(slotFieldPrefix(next) + "Label");
      if (nameEl) nameEl.focus();
    });
    for (let slotNum = 1; slotNum <= MAX_SLOTS; slotNum++) {
      const nameEl = $(slotFieldPrefix(slotNum) + "Label");
      if (!nameEl) continue;
      nameEl.addEventListener(
        "input",
        (function (n) {
          return function () {
            syncSlotTitle(n);
          };
        })(slotNum)
      );
    }
    if ($("imageUrlToggle")) {
      $("imageUrlToggle").addEventListener("click", function () {
        const wrap = $("imageUrlWrap");
        const willOpen = !!(wrap && wrap.classList.contains("hidden"));
        setImageUrlOpen(willOpen);
        if (willOpen && $("fImageUrl")) $("fImageUrl").focus();
      });
    }
    if ($("editorBody")) {
      ["input", "change"].forEach(function (evt) {
        $("editorBody").addEventListener(evt, function (e) {
          const group = e.target.closest ? e.target.closest(".form-group.has-error") : null;
          if (!group) return;
          group.classList.remove("has-error");
          const note = group.querySelector(".admin-field-err");
          if (note) note.remove();
        });
      });
    }
    if ($("pvAddOverlay")) {
      ["input", "change"].forEach(function (evt) {
        $("pvAddOverlay").addEventListener(evt, function (e) {
          const group = e.target.closest ? e.target.closest(".form-group.has-error") : null;
          if (!group) return;
          group.classList.remove("has-error");
          const note = group.querySelector(".admin-field-err");
          if (note) note.remove();
        });
      });
    }
    if ($("removeSlot2Btn")) {
      $("removeSlot2Btn").addEventListener("click", function () {
        setVisibleSlotCount(1);
      });
    }
    if ($("removeSlot3Btn")) {
      $("removeSlot3Btn").addEventListener("click", function () {
        setVisibleSlotCount(2);
      });
    }
    $("listingTemplates").addEventListener("click", function (e) {
      if (e.target.closest("#clearTemplateBtn")) {
        clearTemplateFill();
        return;
      }
      const btn = e.target.closest("[data-template]");
      if (!btn) return;
      if (btn.getAttribute("data-template") === "sannidhi") {
        if (btn.classList.contains("active")) {
          clearTemplateFill();
          return;
        }
        applySannidhiTemplate();
      }
    });
    if ($("fNoRegister")) {
      $("fNoRegister").addEventListener("change", function () {
        setNoRegister(this.checked);
        if (!this.checked) $("fRegister").focus();
      });
    }
    if ($("fTitle")) {
      $("fTitle").addEventListener("change", function () {
        if (titleLooksFreeOffering(this.value)) setFreeOfferingChecked(true);
      });
    }
    if ($("fTitleProgram")) {
      $("fTitleProgram").addEventListener("change", function () {
        // A quick-fill template's other fields (description, location,
        // timings, image...) were filled in for that specific program —
        // switching to a different one makes all of that stale, so start
        // over, but keep the program the user just picked.
        if (document.querySelector("[data-template].active")) {
          clearTemplateFill(true);
          titleSelectSilent = false;
          if (titleLooksFreeOffering(this.value)) setFreeOfferingChecked(true);
          onProgramTitleChanged();
          return;
        }
        titleSelectSilent = false;
        if (titleLooksFreeOffering(this.value)) setFreeOfferingChecked(true);
        onProgramTitleChanged();
      });
    }
    if ($("flyerGrid")) {
      $("flyerGrid").addEventListener("click", function (e) {
        const card = e.target.closest("[data-flyer-id]");
        if (!card) return;
        const id = card.getAttribute("data-flyer-id");
        // No Cancel button on the fields step, so tapping the already-picked
        // template again is the way back out to "no template chosen".
        selectFlyerTemplate(id === selectedFlyerTemplateId ? "" : id);
      });
    }
    if ($("generateFlyerBtn")) $("generateFlyerBtn").addEventListener("click", generateFlyer);
    if ($("selectFlyerBtn")) $("selectFlyerBtn").addEventListener("click", openFlyerPicker);
    if ($("changeFlyerBtn")) {
      $("changeFlyerBtn").addEventListener("click", function () {
        generatedFlyerUrl = "";
        pendingManualFlyer = null;
        selectFlyerTemplate("");
        resetFlyerManualUpload();
        openFlyerPicker();
      });
    }
    if ($("fFlyerManualFile")) {
      $("fFlyerManualFile").addEventListener("change", async function () {
        const file = this.files && this.files[0];
        if (!file) return;
        try {
          const payload = await readFileAsImagePayload(file);
          pendingManualFlyer = payload;
          generatedFlyerUrl = "";
          $("fFlyerManualFileName").textContent = "Replace flyer";
          showFlyerResult(payload.preview, false);
        } catch (err) {
          $("flyerFieldsError").textContent = friendlyError(err.message);
          show($("flyerFieldsError"), true);
        }
      });
    }
    if ($("flyerImportForm")) {
      $("flyerImportForm").addEventListener("submit", submitFlyerImport);
    }
    if ($("flyerImportProgramSearch")) {
      $("flyerImportProgramSearch").addEventListener("input", filterFlyerImportPrograms);
    }
    if ($("flyerImportPptx")) {
      $("flyerImportPptx").addEventListener("change", function () {
        const file = this.files && this.files[0];
        onFlyerImportPptxSelected(file || null);
      });
    }
    if ($("flyerPickerOverlay")) {
      $("flyerPickerOverlay").addEventListener("click", function (e) {
        if (e.target === this || e.target.closest("#closeFlyerPickerBtn")) {
          closeFlyerPicker();
        }
      });
    }
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
      if ($("promoOverlay") && $("promoOverlay").classList.contains("open")) closePromoEditor();
      if ($("teamUserOverlay") && $("teamUserOverlay").classList.contains("open")) closeTeamUserEditor();
      if ($("pvAddOverlay") && $("pvAddOverlay").classList.contains("open")) closePvAdd();
      if ($("pvVolunteerOverlay") && $("pvVolunteerOverlay").classList.contains("open")) closePvDetail();
      if ($("flyerPickerOverlay") && $("flyerPickerOverlay").classList.contains("open")) closeFlyerPicker();
      if ($("avatarPreviewOverlay") && $("avatarPreviewOverlay").classList.contains("open")) closeAvatarPreview();
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

    document.querySelectorAll("[data-hub-copy-link]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        // These sit on a "stretched link" card (the rest of the card
        // opens the page in a new tab) — don't let the click reach it.
        e.preventDefault();
        e.stopPropagation();
        copyHubLink(btn.getAttribute("data-hub-copy-link"), btn);
      });
    });

    document.querySelectorAll("[data-hub-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const action = btn.getAttribute("data-hub-action");
        if (action === "add-volunteering") {
          currentResource = "volunteering";
          openAdminPage("volunteering");
        } else {
          currentResource = "programs";
          openAdminPage("events");
        }
        openEditor(null);
      });
    });
    $("backToHubBtn").addEventListener("click", function () {
      // Inside Volunteering (Nurturing), back steps up one level, not all the way home.
      const sub = role() === "nurturing" ? (location.hash || "").toLowerCase().replace(/^#/, "") : "";
      if (sub.startsWith("volunteering/need/")) return openVolNeedsList();
      if (sub.startsWith("volunteering/attendance/")) return openVolAttendance();
      if (sub.startsWith("volunteering/")) return openAdminPage("volunteering");
      const here = (location.hash || "").replace(/^#/, "");
      if (here === "generateFlyer" || here === "programTitles") return openAdminPage("settings");
      if (here === "newFlyerTemplate") return openAdminPage("flyerTemplates");
      showAdminHub(false);
    });
    window.addEventListener("popstate", function () {
      if (!token()) return;
      const hash = (location.hash || "").replace(/^#/, "").toLowerCase();
      // Sub-routes: volunteering/needs, volunteering/need/{id}
      if (routeVolunteeringHash(hash)) {
      } else if (hash && pageFromHash(hash)) {
        openAdminPage(pageFromHash(hash), true);
      } else {
        showAdminHub(true);
      }
    });

    if ($("fVolunteerAvailable")) {
      $("fVolunteerAvailable").addEventListener("change", syncVolunteerNeededField);
    }

    document.querySelectorAll("[data-listing-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setListingFilter(btn.getAttribute("data-listing-filter"));
      });
    });

    $("itemList").addEventListener("click", function (e) {
      const avatarPreview = e.target.closest("[data-avatar-preview]");
      if (avatarPreview) {
        openAvatarPreview(avatarPreview.getAttribute("data-avatar-preview"));
        return;
      }
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

    $("itemList").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      const avatarPreview = e.target.closest("[data-avatar-preview]");
      if (!avatarPreview) return;
      e.preventDefault();
      openAvatarPreview(avatarPreview.getAttribute("data-avatar-preview"));
    });

    if ($("closeAvatarPreviewBtn")) {
      $("closeAvatarPreviewBtn").addEventListener("click", closeAvatarPreview);
    }
    if ($("avatarPreviewOverlay")) {
      $("avatarPreviewOverlay").addEventListener("click", function (e) {
        if (e.target === this) closeAvatarPreview();
      });
    }

    document.querySelectorAll("[data-volunteer-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setVolunteerView(btn.getAttribute("data-volunteer-view"));
      });
    });

    if ($("volunteerPushBtn")) {
      $("volunteerPushBtn").addEventListener("click", toggleVolunteerPush);
    }

    if ($("volunteerNeedsList")) {
      $("volunteerNeedsList").addEventListener("click", function (e) {
        const handleBtn = e.target.closest("[data-vn-handle]");
        if (handleBtn) { openVnHandle(handleBtn.getAttribute("data-vn-handle")); return; }

        const addBtn = e.target.closest("[data-vn-add-save]");
        if (addBtn) {
          const card = addBtn.closest(".vn-card");
          if (card) vnAddVolunteer(addBtn.getAttribute("data-vn-add-save"), card);
          return;
        }

        const attendBtn = e.target.closest("[data-vn-attend]");
        if (attendBtn) {
          vnSetAttended(attendBtn.getAttribute("data-vn-attend"), attendBtn.getAttribute("data-val"));
          return;
        }

        const flagBtn = e.target.closest("[data-vn-flag]");
        if (flagBtn) {
          vnToggleFlag(flagBtn.getAttribute("data-vn-flag"), flagBtn.getAttribute("data-field"));
          return;
        }

        const delBtn = e.target.closest("[data-vn-del]");
        if (delBtn) { vnDeleteVolunteer(delBtn.getAttribute("data-vn-del")); return; }

        const groupBtn = e.target.closest("[data-vn-group]");
        if (groupBtn) { openVatGroupSheet(groupBtn.getAttribute("data-vn-group")); }

        // Nurturing compact card click → open detail
        const compactCard = e.target.closest("[data-vnc-id]");
        if (compactCard) {
          openVolProgramDetail(compactCard.getAttribute("data-vnc-id"));
        }
      });
    }

    // Volunteering chooser panel buttons
    if ($("volChooserOpportunities")) {
      $("volChooserOpportunities").addEventListener("click", function () {
        openVolOpportunities();
      });
    }
    if ($("volChooserNeeds")) {
      $("volChooserNeeds").addEventListener("click", function () {
        openVolNeedsList();
      });
    }
    if ($("volChooserAttendance")) {
      $("volChooserAttendance").addEventListener("click", function () {
        openVolAttendance();
      });
    }
    initBSheets();
    if ($("vpdRosterSearch")) {
      $("vpdRosterSearch").addEventListener("input", function () {
        vpdRosterQuery = this.value;
        renderVolProgramDetail();
      });
    }
    if ($("volAddSheet")) {
      $("vpdAddSaveBtn").addEventListener("click", function () { saveVpdAddVolunteer(false); });
      $("vpdAddNextBtn").addEventListener("click", function () { saveVpdAddVolunteer(true); });
      $("volAddSheet").addEventListener("keydown", function (e) {
        if (e.key === "Enter" && e.target.tagName === "INPUT") {
          e.preventDefault();
          saveVpdAddVolunteer(false);
        }
      });
    }
    if ($("volFormSheet")) {
      $("volFormSheet").addEventListener("keydown", function (e) {
        if (e.key !== "Enter" || !e.target.classList.contains("gf-opt-input")) return;
        e.preventDefault();
        const row = e.target.closest(".gf-opt");
        if (e.target.value.trim()) gfAddOption(row.parentNode, row);
      });
      $("volFormSheet").addEventListener("change", function (e) {
        if (!e.target.classList.contains("gf-xf-type")) return;
        const o = e.target.closest(".gf-xf").querySelector(".gf-xf-opts");
        o.classList.toggle("hidden", !GF_XF_CHOICE[e.target.value]);
        if (!o.classList.contains("hidden")) o.focus();
      });
      $("volFormSheet").addEventListener("click", function (e) {
        const addOpt = e.target.closest("[data-gf-addopt]");
        const rmOpt = e.target.closest(".gf-opt-x:not(.gf-xf-x)");
        if (e.target.closest("[data-gf-addfield]")) {
          gfAddCustomField();
        } else if (e.target.closest(".gf-xf-x")) {
          e.target.closest(".gf-xf").remove();
        } else if (addOpt) {
          gfAddOption(document.querySelector('[data-gf-opts="' + addOpt.getAttribute("data-gf-addopt") + '"]'));
        } else if (rmOpt) {
          const row = rmOpt.closest(".gf-opt");
          const box = row.parentNode;
          if (box.querySelectorAll(".gf-opt").length > 1) {
            row.remove();
            gfRenumber(box);
          } else {
            row.querySelector("input").value = "";
            row.querySelector("input").focus();
          }
        } else if (e.target.closest("#vpdGfNext")) gfNext();
        else if (e.target.closest("#vpdGfBack")) gfBack();
        else if (e.target.closest("#vpdGenerateFormBtn")) generateFormForProgram();
        else if (e.target.closest("#vpdCopyLinkBtn")) copyVolFormLink();
        else if (e.target.closest("#vpdShareWaBtn")) shareVolFormOnWhatsApp();
      });
    }
    if ($("rosterSearch")) $("rosterSearch").addEventListener("input", renderRoster);
    if ($("volOppsPanel")) {
      $("oppAddBtn").addEventListener("click", function () {
        openEditor(null);
      });
      $("oppPushBtn").addEventListener("click", toggleVolunteerPush);
      $("oppSearchInput").addEventListener("input", function () {
        oppQuery = this.value;
        oppRender();
      });
      $("volOppsPanel").addEventListener("click", function (e) {
        const tab = e.target.closest("[data-opp-tab]");
        if (tab) {
          oppTab = tab.getAttribute("data-opp-tab");
          oppRender();
          return;
        }
        const avatarPreview = e.target.closest("[data-avatar-preview]");
        if (avatarPreview) {
          openAvatarPreview(avatarPreview.getAttribute("data-avatar-preview"));
          return;
        }
        if (e.target.closest("[data-clear-closed]")) {
          clearClosedListings();
          return;
        }
        const edit = e.target.closest("[data-edit]");
        if (edit) {
          const id = edit.getAttribute("data-edit");
          const item = items.find(function (it) { return String(it.id) === String(id); });
          openEditor(item || { id: id });
          return;
        }
        const del = e.target.closest("[data-delete]");
        if (del) openDeleteConfirm(del.getAttribute("data-delete"));
      });
    }
    if ($("vnlSearchInput")) {
      $("vnlSearchInput").addEventListener("input", function () {
        vnlQuery = this.value;
        vnlRender();
      });
    }
    if ($("volNeedsPanel")) {
      $("volNeedsPanel").addEventListener("click", function (e) {
        const tab = e.target.closest("[data-vnl-tab]");
        if (tab) {
          vnlTab = tab.getAttribute("data-vnl-tab") === "closed" ? "closed" : "open";
          vnlRender();
          return;
        }
        const open = e.target.closest("[data-vnl-open]");
        if (open) openVolProgramDetail(open.getAttribute("data-vnl-open"));
      });
    }
    if ($("vatConfirmOverlay")) {
      $("vatConfirmCancel").addEventListener("click", vatCloseConfirm);
      $("vatConfirmYes").addEventListener("click", vatConfirmAllSignins);
      $("vatConfirmOverlay").addEventListener("click", function (e) {
        if (e.target === $("vatConfirmOverlay")) vatCloseConfirm();
      });
    }
    if ($("volAttendancePanel")) {
      $("volAttendancePanel").addEventListener("click", function (e) {
        const groupOpen = e.target.closest("[data-vat-group-open]");
        if (groupOpen) {
          openVatGroupSheet(groupOpen.getAttribute("data-vat-group-open"));
          return;
        }
        const tab = e.target.closest("[data-vat-tab]");
        if (tab) {
          vatTab = tab.getAttribute("data-vat-tab") === "done" ? "done" : "todo";
          vatRenderList();
          return;
        }
        const open = e.target.closest("[data-vat-open]");
        if (open) {
          openVolAttendanceMark(open.getAttribute("data-vat-open"));
          return;
        }
        if (e.target.closest("#vatConfirmAllBtn")) {
          vatOpenConfirmAll();
          return;
        }
        const retry = e.target.closest("[data-vat-retry]");
        if (retry) {
          vatRetry(retry.getAttribute("data-vat-retry"));
          return;
        }
        const set = e.target.closest("[data-vat-set]");
        if (set) {
          vatSet(set.getAttribute("data-vat-set"), set.getAttribute("data-val"));
          return;
        }
        const bulk = e.target.closest("[data-vat-bulk]");
        if (bulk) vatBulk(bulk.getAttribute("data-vat-bulk"));
      });
    }

    // Program detail panel event delegation
    if ($("volProgramDetailPanel")) {
      // Clear timing error highlight as user types
      $("volProgramDetailPanel").addEventListener("input", function (e) {
        if (e.target.classList.contains("vpd-timing-input")) {
          if (e.target.value.trim()) e.target.classList.remove("input-error");
        }
      });
      $("volProgramDetailPanel").addEventListener("click", function (e) {
        // Generate form
        if (e.target.closest("#vpdGenerateFormBtn")) {
          generateFormForProgram();
          return;
        }
        // Copy link
        if (e.target.closest("#vpdCopyLinkBtn")) {
          copyVolFormLink();
          return;
        }
        // Mark handled
        if (e.target.closest("#vpdMarkHandledBtn")) {
          vpdMarkHandled();
          return;
        }
        // Add volunteer button (also the empty-state shortcut)
        if (e.target.closest("#vpdAddVolBtn, [data-vpd-add]")) {
          openVnAddForm(currentVolNeedId);
          return;
        }
        if (e.target.closest("#vpdFormBtn")) {
          openVolFormSheet();
          return;
        }
        if (e.target.closest("#vpdConnectFormBtn")) {
          openConnectFormSheet();
          return;
        }
        // Attendance chips
        const attendBtn = e.target.closest("[data-vn-attend]");
        if (attendBtn) {
          vpdSetAttended(attendBtn.getAttribute("data-vn-attend"), attendBtn.getAttribute("data-val"));
          return;
        }
        // Flag chips
        const flagBtn = e.target.closest("[data-vn-flag]");
        if (flagBtn) {
          vpdToggleFlag(flagBtn.getAttribute("data-vn-flag"), flagBtn.getAttribute("data-field"));
          return;
        }
        // Volunteer row: tap to show / hide its details (call + WhatsApp links act on their own)
        const vprToggle = e.target.closest("[data-vpr-toggle]");
        if (vprToggle && !e.target.closest("a")) {
          vprToggleRow(vprToggle);
          return;
        }
        // Delete volunteer
        const delBtn = e.target.closest("[data-vn-del]");
        if (delBtn) {
          vpdDeleteVolunteer(delBtn.getAttribute("data-vn-del"));
          return;
        }
        // Back buttons (header link + error state)
        if (e.target.closest("#vpdBackBtn")) {
          openVolNeedsList();
          return;
        }
        if (e.target.closest("#vpdAttendBtn")) {
          openVolAttendanceMark(currentVolNeedId);
        }
      });
    }

    if ($("vnHandleCancel")) $("vnHandleCancel").addEventListener("click", closeVnHandle);
    if ($("vnHandleSave")) $("vnHandleSave").addEventListener("click", saveVnHandle);
    if ($("vnHandleOverlay")) {
      $("vnHandleOverlay").addEventListener("click", function (e) {
        if (e.target === this) closeVnHandle();
      });
    }

    $("fImageFile").addEventListener("change", async function () {
      const file = this.files && this.files[0];
      if (!file) return;
      // Blur so the browser does not scroll the visually-hidden input into view.
      if (typeof this.blur === "function") this.blur();
      const preview = $("fImagePreview");
      if (preview) {
        preview.style.display = "block";
        preview.classList.add("is-busy");
      }
      try {
        pendingImage = await readFileAsImagePayload(file);
        if (preview) {
          preview.src = pendingImage.preview;
          preview.style.display = "block";
        }
        setImageFileLabel(file.name);
        clearFieldErrors();
        const err = $("editorError");
        if (err) err.style.display = "none";
      } catch (err) {
        pendingImage = null;
        setImageFileLabel("");
        if (preview) {
          preview.removeAttribute("src");
          preview.style.display = "none";
        }
        const box = $("editorError");
        if (box) {
          box.textContent = err.message || "Could not read that image.";
          box.style.display = "block";
        }
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

    if ($("inquirySearchInput")) {
      $("inquirySearchInput").addEventListener("input", function () {
        inquirySearchQuery = this.value;
        inquiryShowLimit = 12;
        show($("inquirySearchClear"), !!this.value);
        renderInquiries();
      });
    }
    initInviteSheet();
    if ($("inquiryTypeBtn")) {
      const closeTypeMenu = function () {
        show($("inquiryTypeMenu"), false);
        $("inquiryTypeBtn").setAttribute("aria-expanded", "false");
      };
      $("inquiryTypeBtn").addEventListener("click", function (e) {
        e.stopPropagation();
        const open = $("inquiryTypeMenu").classList.contains("hidden");
        show($("inquiryTypeMenu"), open);
        this.setAttribute("aria-expanded", String(open));
      });
      $("inquiryTypeMenu").addEventListener("click", function (e) {
        const opt = e.target.closest("[data-inquiry-type]");
        if (!opt) return;
        inquiryTypeFilter = opt.getAttribute("data-inquiry-type") || "";
        inquiryShowLimit = 12;
        closeTypeMenu();
        renderInquiries();
      });
      document.addEventListener("click", function (e) {
        if (!e.target.closest("#inquiryTypeFilter")) closeTypeMenu();
      });
    }
    if ($("inquiryTypePillClear")) {
      $("inquiryTypePillClear").addEventListener("click", function () {
        inquiryTypeFilter = "";
        inquiryShowLimit = 12;
        renderInquiries();
      });
    }
    if ($("inquirySearchClear")) {
      $("inquirySearchClear").addEventListener("click", function () {
        inquirySearchQuery = "";
        if ($("inquirySearchInput")) $("inquirySearchInput").value = "";
        show($("inquirySearchClear"), false);
        inquiryShowLimit = 12;
        renderInquiries();
        if ($("inquirySearchInput")) $("inquirySearchInput").focus();
      });
    }


    $("inquiryList").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest(".inquiry-number-link, a, button, textarea, input")) return;
      const itemToggle = e.target.closest("[data-inquiry-toggle]");
      if (!itemToggle) return;
      e.preventDefault();
      itemToggle.click();
    });

    $("inquiryList").addEventListener("click", function (e) {
      if (e.target.closest(".inquiry-action-wa, .inquiry-quick-actions a, .inquiry-number-link")) return;
      const moreBtn = e.target.closest("[data-inquiry-more]");
      if (moreBtn) {
        inquiryShowLimit += 12;
        renderInquiries();
        return;
      }
      if (e.target.closest("[data-inq-bulk-msg]")) {
        openInqBulkMessage(inqMessageCandidates());
        return;
      }
      if (e.target.closest("[data-inq-msg-cancel]")) {
        cancelInqMsgJob();
        return;
      }
      if (e.target.closest("[data-inq-bulk]")) {
        openInqGroupSheet(inqBulkCandidates());
        return;
      }
      const moreBtn2 = e.target.closest("[data-inq-more]");
      if (moreBtn2) {
        const menu = moreBtn2.parentNode.querySelector(".inq-menu");
        const willOpen = menu.hidden;
        document.querySelectorAll(".inq-menu:not([hidden])").forEach(function (m) { m.hidden = true; });
        menu.hidden = !willOpen;
        moreBtn2.setAttribute("aria-expanded", String(willOpen));
        return;
      }
      const copyBtn = e.target.closest("[data-inq-copy]");
      if (copyBtn) {
        const num = "+91" + copyBtn.getAttribute("data-inq-copy");
        copyBtn.closest(".inq-menu").hidden = true;
        if (navigator.clipboard) navigator.clipboard.writeText(num).then(function () { showToast("Number copied"); }, function () { showToast(num); });
        else showToast(num);
        return;
      }
      const msgBtn = e.target.closest("[data-inq-msg]");
      if (msgBtn) {
        const card = msgBtn.closest(".inquiry-card");
        msgBtn.closest(".inq-menu").hidden = true;
        const item = findInquiry(card.getAttribute("data-sheet"), card.getAttribute("data-id"));
        if (item) openInqMessage(item);
        return;
      }
      const groupBtn = e.target.closest("[data-inq-group]");
      if (groupBtn) {
        const card = groupBtn.closest(".inquiry-card");
        const menu = groupBtn.closest(".inq-menu");
        if (menu) menu.hidden = true;
        const sheet = card.getAttribute("data-sheet");
        const id = card.getAttribute("data-id");
        const item = findInquiry(sheet, id);
        if (item) {
          openInqGroupSheet([{ sheet: sheet, id: String(id), name: inquiryField(item, "name") || "(No name)", digits: inquiryWhatsAppDigits(item) }]);
        }
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
        if (open) autosizeInquiryCta(card.querySelector("[data-inquiry-remarks]"));
        itemToggle.setAttribute("aria-expanded", open ? "true" : "false");
        return;
      }
      const inviteBtn = e.target.closest("[data-invite-open]");
      if (inviteBtn) {
        openInviteSheet(inviteBtn.closest(".inquiry-card"));
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

    if ($("promoViewTabs")) {
      $("promoViewTabs").addEventListener("click", function (e) {
        const btn = e.target.closest("[data-promo-view]");
        if (!btn) return;
        promoOpenId = "";
        setPromoView(btn.getAttribute("data-promo-view"));
      });
    }
    if ($("promoNotifyProxy")) $("promoNotifyProxy").addEventListener("click", onNotifyButton);
    if ($("promoLogoutProxy")) {
      $("promoLogoutProxy").addEventListener("click", function () {
        const btn = $("logoutBtn");
        if (btn) btn.click();
      });
    }
    if ($("promoNewBtn")) {
      $("promoNewBtn").addEventListener("click", function () {
        openPromoPicker();
      });
    }
    if ($("promoToastUndo")) {
      $("promoToastUndo").addEventListener("click", function () {
        const fn = promoUndoFn;
        promoUndoFn = null;
        const toast = $("promoToast");
        if (toast) toast.classList.remove("show");
        if (fn) fn();
      });
    }

    async function handlePromoListClick(e) {
      const toggle = e.target.closest("[data-promo-toggle]");
      if (toggle) {
        const id = toggle.getAttribute("data-promo-toggle");
        promoOpenId = String(promoOpenId) === String(id) ? "" : id;
        renderPromotions();
        return;
      }
      if (e.target.closest("[data-promo-new]")) {
        openPromoPicker();
        return;
      }
      const copyBtn = e.target.closest("[data-promo-copy]");
      if (copyBtn) {
        copyPromoMessage(copyBtn.getAttribute("data-promo-copy"));
        return;
      }
      const sentBtn = e.target.closest("[data-promo-sent]");
      if (sentBtn) {
        setButtonBusy(sentBtn, true, "Saving…");
        try {
          await markPromoSent(sentBtn.getAttribute("data-promo-sent"));
        } catch (err) {
          showPromoToast(err.message, null);
          setButtonBusy(sentBtn, false);
        }
        return;
      }
      const unsendBtn = e.target.closest("[data-promo-unsend]");
      if (unsendBtn) {
        setButtonBusy(unsendBtn, true, "Saving…");
        try {
          await unmarkPromoSent(unsendBtn.getAttribute("data-promo-unsend"));
        } catch (err) {
          showPromoToast(err.message, null);
          setButtonBusy(unsendBtn, false);
        }
        return;
      }
      const unscheduleBtn = e.target.closest("[data-promo-unschedule]");
      if (unscheduleBtn) {
        setButtonBusy(unscheduleBtn, true, "Saving…");
        try {
          await clearPromoSlot(unscheduleBtn.getAttribute("data-promo-unschedule"));
          showPromoToast("Removed from day", null);
        } catch (err) {
          showPromoToast(err.message, null);
          setButtonBusy(unscheduleBtn, false);
        }
        return;
      }
      const openBtn = e.target.closest("[data-promo-open]");
      if (openBtn) {
        const item = findPromo(openBtn.getAttribute("data-promo-open"));
        if (item) openPromoEditor(item, { preferSchedule: false });
      }
    }

    if ($("promoScroll")) {
      $("promoScroll").addEventListener("click", handlePromoListClick);
    }

    if ($("promoFlyerFile")) {
      $("promoFlyerFile").addEventListener("change", async function () {
        const file = this.files && this.files[0];
        if (!file) return;
        if (typeof this.blur === "function") this.blur();
        const preview = $("promoFlyerPreview");
        if (preview) {
          preview.style.display = "block";
          preview.classList.add("is-busy");
        }
        try {
          pendingPromoFlyer = await readFileAsImagePayload(file);
          if (preview) {
            preview.src = pendingPromoFlyer.preview;
            preview.style.display = "block";
          }
          if ($("promoFlyerFileName")) $("promoFlyerFileName").textContent = file.name || "Replace flyer";
          if ($("promoFlyerMissing")) $("promoFlyerMissing").classList.add("hidden");
          if ($("promoFlyerHint")) $("promoFlyerHint").classList.remove("hidden");
          const item = findPromo(editingPromoId);
          if (item) syncPromoFlyerResetBtn(item);
        } catch (err) {
          pendingPromoFlyer = null;
          const box = $("promoEditorError");
          if (box) {
            box.textContent = err.message || "Could not read that image.";
            box.style.display = "block";
          }
        } finally {
          if (preview) preview.classList.remove("is-busy");
        }
      });
    }

    if ($("promoFlyerResetBtn")) {
      $("promoFlyerResetBtn").addEventListener("click", function () {
        const item = findPromo(editingPromoId);
        if (!item) return;
        pendingPromoFlyer = null;
        promoFlyerOverrideUrl = String(item.event_image || "").trim();
        if ($("promoFlyerFile")) $("promoFlyerFile").value = "";
        if ($("promoFlyerFileName")) $("promoFlyerFileName").textContent = "Choose flyer";
        setPromoFlyerPreview(promoFlyerOverrideUrl);
        item.flyer_url = promoFlyerOverrideUrl;
        syncPromoFlyerResetBtn(item);
      });
    }

    document.querySelectorAll('input[name="promoWhenMode"]').forEach(function (radio) {
      radio.addEventListener("change", syncPromoWhenFields);
    });
    if ($("promoComposeDate")) {
      $("promoComposeDate").addEventListener("change", function () {
        setPromoComposeDate(this.value);
      });
    }
    if ($("promoPasteBtn")) {
      $("promoPasteBtn").addEventListener("click", pastePromoMessage);
    }

    if ($("promoOverlay")) {
      $("promoOverlay").addEventListener("click", async function (e) {
        if (e.target === this) {
          closePromoEditor();
          return;
        }
        if (e.target.closest("#cancelPromoEditorBtn") || e.target.closest("#closePromoEditorBtn")) {
          closePromoEditor();
          return;
        }
        if (e.target.closest("#savePromoBtn")) savePromoEditor();
      });
    }

    if ($("promoPickOverlay")) {
      $("promoPickOverlay").addEventListener("click", function (e) {
        if (e.target === this || e.target.closest("#closePromoPickBtn")) {
          closePromoPicker();
          return;
        }
        const pick = e.target.closest("[data-promo-pick]");
        if (pick) {
          const item = findPromo(pick.getAttribute("data-promo-pick"));
          closePromoPicker();
          if (item) openPromoEditor(item, { preferSchedule: true });
        }
      });
    }
    if ($("promoPickSearch")) {
      $("promoPickSearch").addEventListener("input", function () {
        renderPromoPickList(this.value);
      });
    }

    if ($("closePromoEditorBtn")) $("closePromoEditorBtn").addEventListener("click", closePromoEditor);
    if ($("teamAddForm")) $("teamAddForm").addEventListener("submit", handleAddTeamUser);
    if ($("teamList")) {
      $("teamList").addEventListener("click", async function (e) {
        const editBtn = e.target.closest("[data-user-edit]");
        if (editBtn) {
          const user = teamUsers.find(function (u) {
            return String(u.id) === String(editBtn.getAttribute("data-user-edit"));
          });
          if (user) openTeamUserEditor(user);
          return;
        }
        const statusBtn = e.target.closest("[data-user-status]");
        if (statusBtn) {
          setButtonBusy(statusBtn, true, "Saving…");
          try {
            await setTeamUserStatus(
              statusBtn.getAttribute("data-user-status"),
              statusBtn.getAttribute("data-status")
            );
          } catch (err) {
            setTeamStatus(err.message, true);
            setButtonBusy(statusBtn, false);
          }
        }
      });
    }
    if ($("closeTeamUserBtn")) $("closeTeamUserBtn").addEventListener("click", closeTeamUserEditor);
    if ($("cancelTeamUserBtn")) $("cancelTeamUserBtn").addEventListener("click", closeTeamUserEditor);
    if ($("saveTeamUserBtn")) $("saveTeamUserBtn").addEventListener("click", saveTeamUser);
    if ($("teamUserOverlay")) {
      $("teamUserOverlay").addEventListener("click", function (e) {
        if (e.target === this) closeTeamUserEditor();
      });
    }

    document.querySelectorAll("[data-pv-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setPvView(btn.getAttribute("data-pv-view"));
      });
    });
    if ($("pvList")) {
      $("pvList").addEventListener("click", function (e) {
        const toggle = e.target.closest("[data-pv-toggle]");
        if (toggle) {
          pvToggleCard(toggle.getAttribute("data-pv-toggle"));
          return;
        }
        const addBtn = e.target.closest("[data-pv-add]");
        if (addBtn) {
          openPvAdd(addBtn.getAttribute("data-pv-add"));
          return;
        }
        const volName = e.target.closest("[data-pv-vol]");
        if (volName) {
          openPvDetail(volName.getAttribute("data-pv-vol"));
        }
      });
    }
    if ($("closePvAddBtn")) $("closePvAddBtn").addEventListener("click", closePvAdd);
    if ($("cancelPvAddBtn")) $("cancelPvAddBtn").addEventListener("click", closePvAdd);
    if ($("savePvAddBtn")) $("savePvAddBtn").addEventListener("click", savePvAdd);
    if ($("pvAddPhone")) {
      $("pvAddPhone").addEventListener("input", function () {
        const digits = this.value.replace(/\D/g, "").slice(0, 10);
        if (this.value !== digits) this.value = digits;
      });
    }
    if ($("pvAddOverlay")) {
      $("pvAddOverlay").addEventListener("click", function (e) {
        if (e.target === this) closePvAdd();
      });
    }
    bindSheetDrag("pvAddHandle", "pvAddOverlay", closePvAdd);
    bindSheetDrag("flyerPickerHandle", "flyerPickerOverlay", closeFlyerPicker);
    if ($("closePvDetailBtn")) $("closePvDetailBtn").addEventListener("click", closePvDetail);
    if ($("savePvDetailBtn")) $("savePvDetailBtn").addEventListener("click", savePvDetail);
    if ($("pvCopyPhoneBtn")) $("pvCopyPhoneBtn").addEventListener("click", pvCopyPhone);
    if ($("pvVolunteerOverlay")) {
      $("pvVolunteerOverlay").addEventListener("click", function (e) {
        if (e.target === this) {
          closePvDetail();
          return;
        }
        const seg = e.target.closest("[data-pv-detail-attend]");
        if (seg) {
          pvSelectAttend(seg.getAttribute("data-pv-detail-attend"));
        }
      });
    }

    if (token()) enterApp();
    else if (window.endPageLoad) endPageLoad();

    initPullToRefresh();
  });

  /* Refresh whichever screen is actually on show. */
  function initPullToRefresh() {
    if (!window.PullToRefresh) return;
    window.PullToRefresh.init({
      scroller: window,
      onRefresh: function () {
        if (!token()) return Promise.resolve();
        const app = $("adminApp");
        if (!app || app.classList.contains("is-hub")) return loadHubStats(true);
        if (app.classList.contains("is-events")) return loadList();
        if (app.classList.contains("is-promotions")) return loadPromotions();
        if (app.classList.contains("is-queries")) return loadInquiries();
        if (app.classList.contains("is-team")) return loadTeam();
        if (app.classList.contains("is-pv")) return loadProgramVolunteers();
        return Promise.resolve();
      }
    });
  }
})();

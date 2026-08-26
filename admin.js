(function () {
  const TOKEN_KEY = "vjn_admin_token";
  const USER_KEY = "vjn_admin_user";
  const INQUIRY_STAMP_KEY = "vjn_inquiry_stamp";
  const PROMO_DUE_KEY = "vjn_promo_due_stamp";
  const QUERY_NOTIFY_KEY = "vjn_query_notify";
  const QUERY_WATCH_MS = 45000;
  const ROLE_PAGES = {
    admin: ["events", "volunteering", "promotions", "queries", "team"],
    programs: ["events"],
    promotions: ["promotions"],
    nurturing: ["queries", "volunteering"],
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
  let promoCacheDirty = true;

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

  function applyRoleUi() {
    const r = role();
    document.body.setAttribute("data-role", r || "");
    document.querySelectorAll("[data-admin-page]").forEach(function (card) {
      const page = card.getAttribute("data-admin-page");
      card.classList.toggle("hidden", !canAccess(page));
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

  async function apiGet(type, asAdmin, extra) {
    const payload = { formType: "adminGet", type: type, token: token() };
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        if (extra[key] === undefined || extra[key] === null || extra[key] === "") return;
        payload[key] = extra[key];
      });
    }
    return apiPost(payload);
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
    const canNotify = canNotifyQueries() || canNotifyPromos();
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
      ensureInquiryType();
      renderInquiryTypeTabs();
      await loadInquiryGroup(inquiryType, true);
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

  async function enterApp() {
    document.documentElement.classList.add("admin-authed");
    show($("loginScreen"), false);
    show($("adminApp"), true);
    const session = await loadSessionUser();
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
    applyRoleUi();
    const hash = (location.hash || "").replace(/^#/, "").toLowerCase();
    if (role() === "promotions" || hash === "promotions") {
      window.location.replace("admin-promotions.html");
      return;
    }
    if (hash && canAccess(hash)) {
      openAdminPage(hash, true);
    } else {
      showAdminHub(true);
      if (window.endPageLoad) endPageLoad();
    }
    startAlertWatch();
  }

  function setAdminTitle(title) {
    const el = $("adminPageTitle");
    if (el) el.textContent = title;
    document.title = title + " – Isha Place, Vijayanagar";
  }

  function renderHubIntro() {
    const user = currentUser();
    const greet = $("hubGreeting");
    const name = user && (user.displayName || user.username);
    if (greet) greet.textContent = name ? "Namaskaram, " + name : "Namaskaram";
    const date = $("hubDate");
    if (date) {
      date.textContent = new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
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
  }

  function defaultHubLead() {
    const lead = $("hubLead");
    if (!lead) return;
    const r = role();
    if (r === "programs") {
      lead.textContent = "Schedule centre programs.";
      return;
    }
    if (r === "promotions") {
      lead.textContent = "Prepare the next post below.";
      return;
    }
    if (r === "nurturing") {
      lead.textContent = "Respond to enquiries and volunteering.";
      return;
    }
    if (r === "admin") {
      lead.textContent = "Overlook the centre below.";
      return;
    }
    lead.textContent = "";
  }

  function setHubLead(openQueries, promoCounts) {
    const lead = $("hubLead");
    if (!lead) return;
    const r = role();
    if (r === "programs") {
      lead.textContent = "Schedule centre programs.";
      return;
    }
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
      if (openQueries > 0) {
        lead.innerHTML =
          openQueries === 1
            ? "There is <b>1</b> enquiry waiting for a reply."
            : "There are <b>" + openQueries + "</b> enquiries waiting for a reply.";
        return;
      }
      lead.textContent = "All quiet for now. Enquiries and volunteering are below.";
      return;
    }
    if (r === "admin") {
      if (openQueries > 0) {
        lead.innerHTML =
          openQueries === 1
            ? "There is <b>1</b> enquiry waiting for a reply."
            : "There are <b>" + openQueries + "</b> enquiries waiting for a reply.";
        return;
      }
      lead.textContent = "All quiet for now. Choose a path below.";
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
      const fetches = [];
      const keys = [];
      if (canAccess("events")) {
        keys.push("programs");
        fetches.push(apiGet("programs", true));
      }
      if (canAccess("volunteering")) {
        keys.push("volunteering");
        fetches.push(apiGet("volunteering", true));
      }
      if (canAccess("queries")) {
        keys.push("inquiries");
        fetches.push(apiGet("inquiries", true));
      }
      if (canAccess("promotions")) {
        keys.push("promotions");
        fetches.push(apiGet("promotions", true));
      }
      if (canAccess("team")) {
        keys.push("users");
        fetches.push(apiGet("users", true));
      }
      const results = await Promise.all(fetches);
      const byKey = {};
      keys.forEach(function (key, i) {
        byKey[key] = results[i];
      });
      const unauthorized = results.find(function (res) {
        return res && res.error && /Unauthorized/i.test(res.error);
      });
      if (unauthorized) {
        logout();
        loginError(unauthorized.error);
        return;
      }
      if (byKey.programs) {
        const programItems = byKey.programs.items || [];
        listingPrefetch.programs = { items: programItems, at: Date.now() };
        setHubStat("programs", countOpenListings(programItems));
      }
      if (byKey.volunteering) {
        const volunteerItems = byKey.volunteering.items || [];
        listingPrefetch.volunteering = { items: volunteerItems, at: Date.now() };
        setHubStat("volunteering", countOpenListings(volunteerItems));
      }
      let openQueries = 0;
      if (byKey.inquiries) {
        const groups = byKey.inquiries.groups || [];
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
      setHubLead(openQueries, promoCounts);
      hubStatsAt = Date.now();
      hubStatsDirty = false;
    } catch (err) {
      setHubStat("programs", null);
      setHubStat("volunteering", null);
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
    setAdminTitle("Team");
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

  function workspaceTitle(page) {
    if (page === "queries") return "Queries";
    if (page === "promotions") return "Promotions";
    if (page === "team") return "Team";
    if (page === "volunteering") return "Volunteering";
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
    const isTeam = page === "team";
    const app = $("adminApp");
    if (app) {
      app.classList.remove("is-hub");
      app.classList.add("is-workspace");
      app.classList.toggle("is-queries", isQueries);
      app.classList.toggle("is-events", isListings);
      app.classList.toggle("is-promotions", isPromos);
      app.classList.toggle("is-team", isTeam);
    }
    show($("adminHub"), false);
    show($("adminWorkspace"), true);
    const promotionsOnly = role() === "promotions";
    show($("backToHubBtn"), !promotionsOnly);
    show($("logoutBtn"), promotionsOnly);
    show($("listingsPanel"), isListings);
    show($("inquiriesPanel"), isQueries);
    show($("promotionsPanel"), isPromos);
    show($("teamPanel"), isTeam);
    if ($("addItemBtn")) $("addItemBtn").classList.toggle("hidden", !isListings);
    show($("adminOpenBadge"), false);
    setAdminTitle(workspaceTitle(page));
    const hash = "#" + page;
    if (replaceHash) history.replaceState(null, "", hash);
    else if (location.hash !== hash) history.pushState(null, "", hash);
    if (isQueries) {
      inquiryShowLimit = 12;
      loadInquiries();
    } else if (isEvents) {
      setTab("programs");
    } else if (isVolunteering) {
      setTab("volunteering");
    } else if (isPromos) {
      setPromoView("today");
      loadPromotions();
    } else if (isTeam) {
      loadTeam();
    }
    if (window.endPageLoad) endPageLoad();
  }

  function logout() {
    const current = token();
    stopAlertWatch();
    setToken("");
    setCurrentUser(null);
    updateNotifyButton();
    document.body.removeAttribute("data-role");
    document.documentElement.classList.remove("admin-authed");
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
    const toggle = $("togglePassword");
    if (toggle && $("adminPassword")) {
      $("adminPassword").type = "password";
      toggle.setAttribute("aria-pressed", "false");
      toggle.setAttribute("aria-label", "Show password");
      toggle.classList.remove("is-visible");
    }
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
      const data = await apiPost({
        formType: "adminLogin",
        role: selectedLoginRole,
        password: password,
      });
      if (data.error || !data.token) {
        loginError(data.error || "Login failed.");
        return;
      }
      setToken(data.token);
      if (data.user) setCurrentUser(data.user);
      else
        setCurrentUser({
          role: selectedLoginRole,
          displayName: ROLE_LABELS[selectedLoginRole] || selectedLoginRole,
          username: selectedLoginRole,
        });
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

  function setImageFileLabel(text) {
    const el = $("fImageFileName");
    if (el) el.textContent = text || "Choose a photo";
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
    $("fTitle").value = defaults.title;
    $("fDescription").value = defaults.description;
    $("fStartDate").value = ymd;
    $("fEndDate").value = ymd;
    $("fLocation").value = defaults.location || DEFAULT_LOCATION;
    setVisibleSlotCount(1);
    setSlotFields(1, "18:00", "18:45", "");
    $("fRegister").value = defaults.registerlink || "";
    setNoRegister(!String(defaults.registerlink || "").trim());
    $("fImageUrl").value = defaults.image || "";
    $("fImageFile").value = "";
    pendingImage = null;
    setListingImagePreview(defaults.image);
    setImageFileLabel(defaults.image ? "Replace photo" : "");
    setFrequencySelect(defaults.frequency);
    $("fStatus").value = currentResource === "programs" ? "Open" : "active";
    clearFieldErrors();
    setTemplateActive("sannidhi");
    $("templateHint").textContent =
      "Filled for " + dateLabel + ", 6:00 PM – 6:45 PM. Edit anything below, or tap the card again to clear.";
  }

  /** Empties the single-event fields without touching the editor mode or overlay. */
  function resetSingleFields() {
    $("fTitle").value = "";
    $("fDescription").value = "";
    $("fStartDate").value = "";
    $("fEndDate").value = "";
    loadSlotsIntoForm(null);
    $("fLocation").value = DEFAULT_LOCATION;
    setFrequencySelect("");
    $("fRegister").value = "";
    setNoRegister(false);
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

  function clearTemplateFill() {
    resetSingleFields();
    setTemplateActive("");
    $("templateHint").textContent = templateIdleHint();
    const body = $("editorBody");
    if (body) body.scrollTop = 0;
  }

  function templateIdleHint() {
    return currentResource === "programs"
      ? "Fills the title, description, location, photo and timings for you."
      : "";
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
      "</span>" +
      (currentResource === "programs" &&
      isVolunteerAvailableValue(item.volunteering_available || item.volunteeringavailable)
        ? '<span class="inquiry-badge inquiry-badge-soft">Volunteers</span>'
        : "") +
      "</span></span></div>" +
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
    delete listingPrefetch[currentResource];
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
    loadList();
  }

  function isVolunteerAvailableValue(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase();
    return s === "yes" || s === "true" || s === "1" || s === "y";
  }

  function syncVolunteerNeededField() {
    const on = $("fVolunteerAvailable") && $("fVolunteerAvailable").checked;
    show($("volunteerNeededWrap"), !!on);
    if (!on && $("fVolunteersNeeded")) $("fVolunteersNeeded").value = "";
  }

  function toggleProgramFields(on) {
    document.querySelectorAll("[data-program-only]").forEach(function (el) {
      el.style.display = on ? "" : "none";
    });
    if (on) syncVolunteerNeededField();
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
    setFrequencySelect(item && item.frequency);
    const registerValue = (item && (item.registerlink || item.registerLink)) || "";
    $("fRegister").value = registerValue;
    setNoRegister(!!item && !String(registerValue).trim());
    $("fImageUrl").value = (item && item.image) || "";
    $("fImageFile").value = "";
    setListingImagePreview((item && item.image) || "");
    setImageFileLabel(item && item.image ? "Replace photo" : "");
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
    syncVolunteerNeededField();

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

  function closeEditor() {
    $("editorOverlay").classList.remove("open");
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
    const noRegister = isNoRegister();
    const registerlink = noRegister ? "" : $("fRegister").value.trim();
    const problems = [];
    if (!title) problems.push(["fTitle", "Add a title."]);
    if (!startDate) problems.push(["fStartDate", "Pick a start date."]);
    if (!endDate) problems.push(["fEndDate", "Pick an end date."]);
    else if (startDate && endDate < startDate) {
      problems.push(["fEndDate", "End date must be on or after the start date."]);
    }
    if (slotErr.message) problems.push([slotErr.field, slotErr.message]);
    if (!location) problems.push(["fLocation", "Add a location."]);
    if (!status) problems.push(["fStatus", "Choose a status."]);
    if (!imageUrl && !pendingImage) problems.push(["fImageFile", "Add a photo."]);
    if (currentResource === "programs") {
      if (!frequency) problems.push(["fFrequency", "Choose how often this repeats."]);
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
        item.frequency = frequency;
        item.registerlink = registerlink;
        const volunteerOn = $("fVolunteerAvailable") && $("fVolunteerAvailable").checked;
        item.volunteering_available = volunteerOn ? "yes" : "no";
        item.volunteers_needed = volunteerOn
          ? String((($("fVolunteersNeeded") && $("fVolunteersNeeded").value) || "").trim())
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
    const personUrl = inquiryPersonWaUrl(item);
    const phoneLabel = formatInquiryPhone(inquiryWhatsAppDigits(item)) || inquiryField(item, "whatsapp");
    if (phoneLabel) {
      rows.push(
        personUrl
          ? "<p><strong>WhatsApp:</strong> <a class=\"inquiry-number-link\" href=\"" +
            escapeHtml(personUrl) +
            "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
            escapeHtml(phoneLabel) +
            "</a></p>"
          : "<p><strong>WhatsApp:</strong> " + escapeHtml(phoneLabel) + "</p>"
      );
    }
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
    const personUrl = inquiryPersonWaUrl(item);
    const phoneLabel = formatInquiryPhone(inquiryWhatsAppDigits(item));
    const phoneLink = personUrl
      ? '<a class="inquiry-number-link" href="' +
        escapeHtml(personUrl) +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(phoneLabel) +
        "</a>"
      : "";
    const waBtn = waUrl
      ? '<a class="inquiry-action inquiry-action-wa" href="' +
        escapeHtml(waUrl) +
        '" target="_blank" rel="noopener noreferrer">' +
        waIconSvg() +
        "WhatsApp</a>"
      : '<span class="inquiry-action inquiry-action-wa is-disabled">' +
        waIconSvg() +
        "WhatsApp</span>";
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
      '<div class="inquiry-ticket-main" data-inquiry-toggle role="button" tabindex="0" aria-expanded="false">' +
      '<span class="inquiry-avatar" aria-hidden="true">' +
      escapeHtml(inquiryInitial(item)) +
      "</span>" +
      '<span class="inquiry-ticket-copy">' +
      '<span class="inquiry-ticket-top">' +
      '<span class="inquiry-ticket-who"><strong>' +
      escapeHtml(title) +
      '</strong><span class="inquiry-time">' +
      escapeHtml(formatInquiryTime(inquiryField(item, "timestamp"))) +
      "</span>" +
      phoneLink +
      "</span>" +
      '<span class="inquiry-badge">' +
      (resolved ? "Resolved" : "Open") +
      "</span></span>" +
      (preview
        ? '<span class="inquiry-topic">' + topicIconSvg() + "<span>" + escapeHtml(preview) + "</span></span>"
        : "") +
      (remarks
        ? '<span class="inquiry-remarks-preview">' + escapeHtml(remarks) + "</span>"
        : "") +
      "</span></div>" +
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

  let promoItems = [];
  let promoView = "today";
  let promoComposeDay = "today";
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

  function showPromoToast(msg, undoFn) {
    const toast = $("promoToast");
    const msgEl = $("promoToastMsg");
    const undoBtn = $("promoToastUndo");
    if (!toast || !msgEl) return;
    msgEl.textContent = msg || "";
    promoUndoFn = typeof undoFn === "function" ? undoFn : null;
    if (undoBtn) undoBtn.classList.toggle("hidden", !promoUndoFn);
    toast.classList.add("show");
    clearTimeout(promoToastTimer);
    promoToastTimer = setTimeout(function () {
      toast.classList.remove("show");
      promoUndoFn = null;
    }, 4200);
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

  function promoComposeYmd() {
    const today = promoTodayYmd();
    return promoComposeDay === "tomorrow" ? shiftYmd(today, 1) : today;
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
    if (host) {
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
      promoItems = [];
      renderPromotions();
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
  }

  function setPromoComposeDay(day) {
    promoComposeDay = day === "tomorrow" ? "tomorrow" : "today";
    document.querySelectorAll("[data-promo-compose-day]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-promo-compose-day") === promoComposeDay);
    });
    fillTimeSelects();
    const timeEl = $("promoComposeTime");
    if (timeEl) timeEl.value = snapHm(nextFreeSlotHm(promoComposeYmd())) || "10:00";
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
    $("promoEditorEyebrow").textContent = promoStatusLabel(normalizePromoClientStatus(item.status));
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
    setPromoComposeDay(promoView === "tomorrow" ? "tomorrow" : "today");
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
        const status = normalizePromoClientStatus(item.status);
        const badge = status === "pending" ? "Pending" : "Ready";
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
          '<span class="promo-pick-meta">' +
          escapeHtml(badge) +
          (item.event_date ? " · " + escapeHtml(item.event_date) : "") +
          "</span></span>" +
          '<svg class="promo-pick-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' +
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

  async function savePromoEditor() {
    const item = findPromo(editingPromoId);
    if (!item) return;
    const btn = $("savePromoBtn");
    const err = $("promoEditorError");
    const message = ($("promoMessage").value || "").trim();
    const wantSchedule = $("promoWhenSchedule") && $("promoWhenSchedule").checked;
    err.textContent = "";
    err.style.display = "none";
    if (!message) {
      err.textContent = "Write a message.";
      err.style.display = "block";
      return;
    }

    let flyerUrl = promoFlyerOverrideUrl || String(item.flyer_url || "").trim() || String(item.event_image || "").trim();
    setButtonBusy(btn, true, wantSchedule ? "Scheduling…" : "Saving…");
    try {
      if (pendingPromoFlyer) {
        flyerUrl = await uploadPayload(pendingPromoFlyer);
      }

      const payload = {
        formType: "adminSavePromotion",
        token: token(),
        id: item.id,
        message: message,
        flyer_url: flyerUrl,
      };

      if (wantSchedule) {
        if (!flyerUrl) {
          err.textContent = "Add a flyer before scheduling, or ask Programs to upload an event photo.";
          err.style.display = "block";
          setButtonBusy(btn, false);
          return;
        }
        const ymd = promoComposeYmd();
        if (
          promosForDay(ymd, { includeSent: true }).filter(function (p) {
            return String(p.id) !== String(item.id);
          }).length >= MAX_PROMO_SLOTS
        ) {
          err.textContent = "Only " + MAX_PROMO_SLOTS + " posts can be scheduled on one day.";
          err.style.display = "block";
          setButtonBusy(btn, false);
          return;
        }
        const hm =
          normalizeHm(($("promoComposeTime") && $("promoComposeTime").value) || "") ||
          nextFreeSlotHm(ymd);
        payload.send_at = ymd + " " + hm;
      }

      const data = await apiPost(payload);
      if (data.error) throw new Error(data.error);
      closePromoEditor();
      await loadPromotions();
      if (wantSchedule) {
        setPromoView(promoComposeDay);
        showPromoToast("Scheduled", null);
      } else {
        showPromoToast("Saved to Events", null);
      }
    } catch (e) {
      err.textContent = friendlyError(e.message);
      err.style.display = "block";
    } finally {
      setButtonBusy(btn, false);
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
    if (host) {
      host.innerHTML =
        '<div class="admin-empty admin-loading"><span class="admin-spinner" aria-hidden="true"></span> Loading people…</div>';
    }
    setPageBusy(true);
    try {
      const data = await apiGet("users", true);
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
      teamUsers = [];
      renderTeam();
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
      const data = await apiPost({
        formType: "adminSaveUser",
        token: token(),
        displayName: $("teamDisplayName").value,
        role: $("teamRole").value,
        password: $("teamPassword").value,
      });
      if (data.error) throw new Error(data.error);
      $("teamDisplayName").value = "";
      $("teamPassword").value = "";
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
        formType: "adminSaveUser",
        token: token(),
        id: $("teamEditId").value,
        displayName: $("teamEditDisplayName").value,
        role: $("teamEditRole").value,
      };
      const password = $("teamEditPassword").value;
      if (password) payload.password = password;
      const data = await apiPost(payload);
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

  async function setTeamUserStatus(id, status) {
    const data = await apiPost({
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
    if (notifyBtn) {
      notifyBtn.addEventListener("click", function () {
        if (queryNotifyEnabled()) openNotifyOffConfirm();
        else turnOnQueryAlerts();
      });
    }
    $("cancelNotifyOffBtn").addEventListener("click", closeNotifyOffConfirm);
    $("confirmNotifyOffBtn").addEventListener("click", turnOffQueryAlerts);
    $("notifyOffOverlay").addEventListener("click", function (e) {
      if (e.target === this) closeNotifyOffConfirm();
    });
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
      });
    }
    window.addEventListener("appinstalled", function () {
      if (token()) startAlertWatch();
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
      showAdminHub(false);
    });
    window.addEventListener("popstate", function () {
      if (!token()) return;
      const hash = (location.hash || "").replace(/^#/, "").toLowerCase();
      if (hash && canAccess(hash)) openAdminPage(hash, true);
      else showAdminHub(true);
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

    if ($("promoViewTabs")) {
      $("promoViewTabs").addEventListener("click", function (e) {
        const btn = e.target.closest("[data-promo-view]");
        if (!btn) return;
        promoOpenId = "";
        setPromoView(btn.getAttribute("data-promo-view"));
      });
    }
    if ($("promoNotifyProxy")) {
      $("promoNotifyProxy").addEventListener("click", function () {
        const btn = $("queryNotifyBtn");
        if (btn) btn.click();
      });
    }
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
    document.querySelectorAll("[data-promo-compose-day]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setPromoComposeDay(btn.getAttribute("data-promo-compose-day"));
      });
    });

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
        return Promise.resolve();
      }
    });
  }
})();

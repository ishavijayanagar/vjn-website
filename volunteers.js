/* Volunteers data page: filter everyone who has shown interest, volunteered or checked in; export the result as a
   CSV or a Google Sheet; or turn it into a campaign (a Google Sheet with only name, phone and IE completion date).
   Talks to Sandesha (the Pi) with the admin login already stored by admin.html. */
(function () {
  var TOKEN_KEY = "vjn_admin_token";
  var PAGE = 100;

  function $(id) { return document.getElementById(id); }
  function token() {
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function base() { return String(window.SANDESHA_API_URL || "").replace(/\/$/, ""); }

  async function api(payload, timeoutMs) {
    var res;
    var ctl = new AbortController();
    var timedOut = false;
    var timer = timeoutMs ? setTimeout(function () { timedOut = true; ctl.abort(); }, timeoutMs) : 0;
    try {
      res = await fetch(base() + "/vjn/api", {
        method: "POST",
        headers: { Authorization: "Bearer " + token() },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new Error(e && e.name === "AbortError" && timedOut
        ? "That took too long. Try again in a minute."
        : "Sandesha is not reachable right now. Try again in a minute.");
    } finally { clearTimeout(timer); }
    var out = await res.json().catch(function () { return { error: "Sandesha replied HTTP " + res.status }; });
    if (res.status === 401) { $("vdAuth").hidden = false; throw new Error("Please sign in again on the admin page."); }
    if (!res.ok || out.error) throw new Error(out.error || "Something went wrong.");
    return out;
  }

  function showErr(msg, retry) {
    $("vdErrText").textContent = msg || "";
    $("vdRetry").hidden = !retry;
    $("vdErr").hidden = !msg;
  }
  $("vdRetry").addEventListener("click", function () { showErr(""); load(); });

  var toastTimer = 0;
  function toast(msg) {
    var el = $("vdToast");
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-on"); }, 2400);
  }

  function defaults() {
    return {
      programs: [], stages: [], sources: [], program_from: "", program_to: "", added_from: "", added_to: "", area: "", search: "",
      ie: "any", ie_from: "", ie_to: "", in_group: "any", attended: "any", unique: false, min_checkins: "",
    };
  }

  var state = { filters: defaults(), options: null, rows: [], total: 0, people: 0, shown: PAGE, seq: 0, truncated: false };

  /* The filters as the server wants them: numbers as numbers. */
  function wire(f) {
    var out = {};
    Object.keys(f).forEach(function (k) { out[k] = f[k]; });
    out.ie_from = Number(f.ie_from) || 0;
    out.ie_to = Number(f.ie_to) || 0;
    out.min_checkins = Number(f.min_checkins) || 0;
    return out;
  }

  /* ───────── controls ───────── */
  function monthLabel(ymd) {
    var m = String(ymd || "").match(/^(\d{4})-(\d{2})/);
    if (!m) return "";
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1] + " " + m[1];
  }

  function programChoices() {
    var o = state.options;
    if (!o) return [];
    var list = [{ id: "", title: o.general.title, date: "", records: o.general.records }];
    return list.concat(o.programs);
  }

  function renderProgramList() {
    var find = $("fProgramFind").value.trim().toLowerCase();
    var host = $("fProgramList");
    host.textContent = "";
    programChoices().forEach(function (p) {
      if (find && p.title.toLowerCase().indexOf(find) < 0) return;
      var row = document.createElement("label");
      row.className = "vd-opt";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state.filters.programs.indexOf(p.id) >= 0;
      cb.addEventListener("change", function () {
        var at = state.filters.programs.indexOf(p.id);
        if (cb.checked && at < 0) state.filters.programs.push(p.id);
        if (!cb.checked && at >= 0) state.filters.programs.splice(at, 1);
        programLabel();
        reload();
      });
      var main = document.createElement("span");
      main.className = "vd-opt-main";
      main.textContent = p.title + (p.date ? "  ·  " + monthLabel(p.date) : "");
      var n = document.createElement("small");
      n.textContent = String(p.records);
      row.appendChild(cb); row.appendChild(main); row.appendChild(n);
      host.appendChild(row);
    });
    if (!host.children.length) {
      var none = document.createElement("p");
      none.className = "vi-empty";
      none.textContent = "No match.";
      host.appendChild(none);
    }
  }

  function programLabel() {
    var ids = state.filters.programs;
    var label = "All programs";
    if (ids.length === 1) {
      var hit = programChoices().filter(function (p) { return p.id === ids[0]; })[0];
      label = hit ? hit.title : "1 program";
    } else if (ids.length > 1) label = ids.length + " programs";
    $("fProgramLabel").textContent = label;
  }

  function chip(host, key, label, list) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "vd-chip";
    b.textContent = label;
    b.setAttribute("aria-pressed", list.indexOf(key) >= 0 ? "true" : "false");
    b.addEventListener("click", function () {
      var at = list.indexOf(key);
      if (at >= 0) list.splice(at, 1); else list.push(key);
      b.setAttribute("aria-pressed", at >= 0 ? "false" : "true");
      updateBadge();
      reload();
    });
    host.appendChild(b);
  }

  function renderChips() {
    var o = state.options;
    $("fStages").textContent = "";
    $("fSources").textContent = "";
    o.stages.forEach(function (s) { chip($("fStages"), s.key, s.label, state.filters.stages); });
    o.sources.forEach(function (s) { chip($("fSources"), s.key, s.label, state.filters.sources); });
    var dl = $("fAreaList");
    dl.textContent = "";
    o.areas.forEach(function (a) { var opt = document.createElement("option"); opt.value = a; dl.appendChild(opt); });
    if (o.ie_years) {
      $("fIeFrom").placeholder = String(o.ie_years.min);
      $("fIeTo").placeholder = String(o.ie_years.max);
    }
  }

  /* How many of the "more filters" are in use, shown on the button so a folded panel never hides a filter. */
  function updateBadge() {
    var f = state.filters;
    var n = 0;
    if (f.program_from || f.program_to) n++;
    if (f.added_from || f.added_to) n++;
    if (f.area) n++;
    if (f.ie !== "any" || f.ie_from || f.ie_to) n++;
    if (f.in_group !== "any") n++;
    if (f.attended !== "any") n++;
    if (Number(f.min_checkins)) n++;
    if (f.sources.length) n++;
    if (f.unique) n++;
    $("vdBadge").hidden = !n;
    $("vdBadge").textContent = String(n);
  }

  function bind(id, key, event, parse) {
    $(id).addEventListener(event || "change", function () {
      state.filters[key] = parse ? parse(this) : this.value;
      updateBadge();
      reload(key === "search" || key === "area" ? 300 : 0);
    });
  }

  function syncInputs() {
    var f = state.filters;
    $("fSearch").value = f.search;
    $("fProgFrom").value = f.program_from; $("fProgTo").value = f.program_to;
    $("fAddedFrom").value = f.added_from; $("fAddedTo").value = f.added_to;
    $("fArea").value = f.area; $("fIe").value = f.ie; $("fIeFrom").value = f.ie_from; $("fIeTo").value = f.ie_to;
    $("fGroup").value = f.in_group; $("fAttended").value = f.attended; $("fMin").value = f.min_checkins; $("fUnique").checked = f.unique;
    $("fProgramFind").value = "";
    programLabel();
    renderProgramList();
    if (state.options) renderChips();
    updateBadge();
  }

  bind("fSearch", "search", "input");
  bind("fProgFrom", "program_from"); bind("fProgTo", "program_to");
  bind("fAddedFrom", "added_from"); bind("fAddedTo", "added_to");
  bind("fArea", "area", "input");
  bind("fIe", "ie"); bind("fIeFrom", "ie_from"); bind("fIeTo", "ie_to");
  bind("fGroup", "in_group"); bind("fAttended", "attended"); bind("fMin", "min_checkins");
  bind("fUnique", "unique", "change", function (el) { return el.checked; });

  function resetFilters() {
    state.filters = defaults();
    syncInputs();
    reload();
  }
  $("vdReset").addEventListener("click", resetFilters);

  /* ───────── menus and popovers ───────── */
  /* A menu grows from its button when it opens and eases away when it closes; while closed it cannot take focus or clicks. */
  function togglePop(btn, pop, on) {
    var open = on === undefined ? !pop.classList.contains("is-open") : on;
    pop.classList.toggle("is-open", open);
    if (open) pop.removeAttribute("inert"); else pop.setAttribute("inert", "");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function closePops() {
    togglePop($("fProgramBtn"), $("fProgramPop"), false);
    togglePop($("vdExportBtn"), $("vdExportMenu"), false);
  }

  $("fProgramBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    togglePop(this, $("fProgramPop"));
    togglePop($("vdExportBtn"), $("vdExportMenu"), false);
    if (!$("fProgramPop").hidden) $("fProgramFind").focus();
  });
  $("fProgramFind").addEventListener("input", renderProgramList);
  $("fProgramClear").addEventListener("click", function () { state.filters.programs = []; programLabel(); renderProgramList(); reload(); });
  $("vdExportBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    togglePop(this, $("vdExportMenu"));
    togglePop($("fProgramBtn"), $("fProgramPop"), false);
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".vd-pop-wrap") && !e.target.closest(".vd-menu-wrap")) closePops();
  });
  /* More filters: a panel that opens in place on a wide screen, and a bottom sheet on a phone. */
  function isPhone() { return !!(window.matchMedia && window.matchMedia("(max-width: 700px)").matches); }
  function setMore(open) {
    $("vdMore").classList.toggle("is-open", open);
    if (open) $("vdMore").removeAttribute("inert"); else $("vdMore").setAttribute("inert", "");
    $("vdMoreBtn").setAttribute("aria-expanded", open ? "true" : "false");
    if (isPhone()) {
      var bd = $("vdMoreBackdrop");
      if (open) { bd.hidden = false; requestAnimationFrame(function () { bd.classList.add("is-open"); }); $("vdSheetTitle").focus({ preventScroll: true }); }
      else { bd.classList.remove("is-open"); setTimeout(function () { bd.hidden = true; }, 250); }
    }
  }
  $("vdMoreBtn").addEventListener("click", function () { setMore(!$("vdMore").classList.contains("is-open")); });
  $("vdMoreDone").addEventListener("click", function () { setMore(false); $("vdMoreBtn").focus({ preventScroll: true }); });
  $("vdMoreBackdrop").addEventListener("click", function () { setMore(false); });

  /* ───────── results ───────── */
  function ymd(s) { return String(s || "").slice(0, 10); }

  function cell(tr, text, cls) {
    var td = document.createElement("td");
    if (cls) td.className = cls;
    td.textContent = text || "";
    tr.appendChild(td);
    return td;
  }

  /* Nothing matched: say so, and offer the way back when filters are on. */
  function emptyState() {
    var box = document.createElement("div");
    box.className = "vd-empty";
    var msg = document.createElement("span");
    msg.textContent = "No one matches these filters.";
    box.appendChild(msg);
    if (anyFilter()) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "vi-btn";
      b.textContent = "Reset filters";
      b.addEventListener("click", resetFilters);
      box.appendChild(b);
    }
    return box;
  }

  function renderTable() {
    var body = $("vdRows");
    body.textContent = "";
    if (!state.rows.length) {
      var tr0 = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.colSpan = 9;
      td0.appendChild(emptyState());
      tr0.appendChild(td0);
      body.appendChild(tr0);
    }
    state.rows.slice(0, state.shown).forEach(function (r) {
      var tr = document.createElement("tr");
      cell(tr, r.name, "vd-name");
      cell(tr, r.phone);
      cell(tr, r.area, "vd-dim");
      cell(tr, r.ie_completion, "vd-dim");
      var prog = r.program ? r.program + (r.program_date ? "  ·  " + monthLabel(r.program_date) : "") : "";
      cell(tr, prog, "vd-dim");
      var td = document.createElement("td");
      var pill = document.createElement("span");
      pill.className = "vd-pill vd-pill--" + r.stage;
      pill.textContent = r.stage_label;
      td.appendChild(pill);
      tr.appendChild(td);
      cell(tr, r.source_label, "vd-dim");
      cell(tr, r.in_group, "vd-dim");
      cell(tr, ymd(r.added_at), "vd-dim");
      body.appendChild(tr);
    });
    $("vdShowMore").hidden = state.rows.length <= state.shown;
    renderCards();
  }

  /* On a phone the same rows are shown as cards: name and stage, tap-to-call and WhatsApp, the program, then the rest. */
  function renderCards() {
    var host = $("vdCards");
    host.textContent = "";
    if (!state.rows.length) {
      var empty = document.createElement("li");
      empty.className = "vd-card vd-card--empty";
      empty.appendChild(emptyState());
      host.appendChild(empty);
      return;
    }
    state.rows.slice(0, state.shown).forEach(function (r) {
      var li = document.createElement("li");
      li.className = "vd-card";

      var top = document.createElement("div");
      top.className = "vd-card-top";
      var name = document.createElement("strong");
      name.textContent = r.name || "(no name)";
      var pill = document.createElement("span");
      pill.className = "vd-pill vd-pill--" + r.stage;
      pill.textContent = r.stage_label;
      top.appendChild(name);
      top.appendChild(pill);
      li.appendChild(top);

      var digits = String(r.phone || "").replace(/\D/g, "");
      if (r.phone) {
        var contact = document.createElement("div");
        contact.className = "vd-card-contact";
        var call = document.createElement("a");
        call.href = "tel:" + r.phone.replace(/[^\d+]/g, "");
        call.textContent = r.phone;
        contact.appendChild(call);
        if (/^91\d{10}$/.test(digits)) {
          var wa = document.createElement("a");
          wa.href = "https://wa.me/" + digits;
          wa.target = "_blank";
          wa.rel = "noopener";
          wa.textContent = "WhatsApp";
          contact.appendChild(wa);
        }
        li.appendChild(contact);
      }

      if (r.program) {
        var prog = document.createElement("div");
        prog.className = "vd-card-prog";
        prog.textContent = r.program + (r.program_date ? "  ·  " + monthLabel(r.program_date) : "");
        li.appendChild(prog);
      }

      var meta = [r.area, r.ie_completion ? "IE " + r.ie_completion : "", r.source_label, r.in_group === "Yes" ? "In group" : "", ymd(r.added_at)].filter(Boolean);
      if (meta.length) {
        var m = document.createElement("div");
        m.className = "vd-card-meta";
        m.textContent = meta.join("  ·  ");
        li.appendChild(m);
      }
      host.appendChild(li);
    });
  }

  function renderSummary() {
    var f = state.filters;
    var count = f.unique
      ? state.total + (state.total === 1 ? " person" : " people")
      : state.people + (state.people === 1 ? " person" : " people") + "  ·  " + state.total + (state.total === 1 ? " record" : " records");
    $("vdCount").textContent = count + (state.truncated ? " (showing the first 5,000)" : "");
    $("vdMoreDone").textContent = "Show " + state.total.toLocaleString("en-IN") + (state.total === 1 ? " result" : " results");
    var s = state.byStage || {};
    var legend = $("vdStageCounts");
    legend.textContent = "";
    var total = (s.interest || 0) + (s.volunteered || 0) + (s.checked_in || 0);
    $("vdBar").hidden = f.unique || !total;
    if (f.unique) return;
    [["interest", "Showed interest"], ["volunteered", "Volunteered"], ["checked_in", "Checked in"]].forEach(function (k, i) {
      $("vdBar").children[i].style.flexGrow = String(s[k[0]] || 0);
      var item = document.createElement("span");
      var dot = document.createElement("i");
      dot.className = "s-" + k[0];
      item.appendChild(dot);
      item.appendChild(document.createTextNode(k[1] + " " + (s[k[0]] || 0)));
      legend.appendChild(item);
    });
  }

  /* The last filters are remembered for next time, and "Reset filters" shows only while some filter is on. */
  var STORE_KEY = "vjn_vd_filters";
  function anyFilter() {
    var f = state.filters;
    return !!(f.programs.length || f.stages.length || f.sources.length || f.search || f.program_from || f.program_to || f.added_from || f.added_to ||
      f.area || f.ie !== "any" || f.ie_from || f.ie_to || f.in_group !== "any" || f.attended !== "any" || Number(f.min_checkins) || f.unique);
  }
  function saveFilters() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state.filters)); } catch (e) { /* remembering is a convenience */ } }
  function restoreFilters() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!saved || typeof saved !== "object") return;
      var base = defaults();
      Object.keys(base).forEach(function (k) {
        if (saved[k] === undefined || typeof saved[k] !== typeof base[k]) return;
        state.filters[k] = Array.isArray(base[k]) ? saved[k].filter(function (x) { return typeof x === "string"; }) : saved[k];
      });
    } catch (e) { /* start clean */ }
  }

  var reloadTimer = 0;
  function reload(delay) {
    clearTimeout(reloadTimer);
    saveFilters();
    $("vdFoot").hidden = !anyFilter();
    reloadTimer = setTimeout(load, delay || 0);
  }

  async function load() {
    var seq = ++state.seq;
    showErr("");
    // Results already on screen stay put; they only dim if the answer takes longer than 300ms.
    clearTimeout(state.dimTimer);
    state.dimTimer = setTimeout(function () { $("vdResults").classList.add("is-loading"); }, 300);
    try {
      var out = await api({ formType: "adminGet", type: "volunteerData", filters: wire(state.filters) });
      if (seq !== state.seq) return; // a newer filter change is already loading
      state.rows = out.rows || [];
      state.total = out.total || 0;
      state.people = out.people || 0;
      state.byStage = out.by_stage || {};
      state.truncated = !!out.truncated;
      state.shown = PAGE;
      renderSummary();
      renderTable();
    } catch (e) {
      if (seq !== state.seq) return;
      showErr(e.message, true);
      $("vdCount").textContent = "";
    } finally {
      if (seq === state.seq) { clearTimeout(state.dimTimer); $("vdResults").classList.remove("is-loading"); }
    }
  }

  $("vdShowMore").addEventListener("click", function () { state.shown += PAGE; renderTable(); });

  /* ───────── export ───────── */
  var CSV_COLUMNS = [
    ["Name", "name"], ["Phone", "phone"], ["Area", "area"], ["IE Completion Date", "ie_completion"], ["Program", "program"],
    ["Program Date", "program_date"], ["Stage", "stage_label"], ["Source", "source_label"], ["In WhatsApp Group", "in_group"],
    ["Attended", "attended"], ["Remarks", "remarks"], ["Added", "added_at"],
  ];

  /* A cell that starts with = @ or - could run as a formula when the file is opened in a spreadsheet, so it gets a
     leading apostrophe. A phone number (+91…) is left as it is. */
  function csvCell(v) {
    var s = String(v === undefined || v === null ? "" : v);
    if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^\+\d{6,15}$/.test(s))) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  $("vdCsv").addEventListener("click", function () {
    closePops();
    if (!state.rows.length) { toast("Nothing to export yet"); return; }
    var lines = [CSV_COLUMNS.map(function (c) { return csvCell(c[0]); }).join(",")];
    state.rows.forEach(function (r) { lines.push(CSV_COLUMNS.map(function (c) { return csvCell(r[c[1]]); }).join(",")); });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "volunteers-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast("Downloaded " + state.rows.length + " rows");
  });

  $("vdSheet").addEventListener("click", async function () {
    closePops();
    if (!state.rows.length) { toast("Nothing to export yet"); return; }
    showErr("");
    // The loader only appears if the wait passes 300ms.
    var session = 0;
    var slow = setTimeout(function () { openDrawer("making"); session = drawerSession; startMaking("Making your Google Sheet"); }, 300);
    try {
      var out = await api({ formType: "adminVolunteerSheetExport", filters: wire(state.filters) }, 120000);
      clearTimeout(slow);
      await finishMaking();
      if (session && (!drawerOpen || session !== drawerSession)) { toast("Your Google Sheet is ready. Find it in Campaigns."); return; }
      if (session) { setLink(out.sheet.sheet_url); $("vdDrawerTitle").textContent = "Your sheet is ready"; setView("result"); }
      else openDrawer("result", out.sheet.sheet_url, "Your sheet is ready");
    } catch (e) {
      clearTimeout(slow);
      await finishMaking();
      if (session && drawerOpen && session === drawerSession) closeDrawer();
      showErr(e.message);
    }
  });

  /* ───────── the sheet drawer: "making it", then the result (Google Sheets export) ───────── */
  var drawer = $("vdDrawer");
  var backdrop = $("vdBackdrop");
  var lastFocus = null;
  var drawerOpen = false;
  var drawerSession = 0;

  var campaignPeople = 0;

  function setView(view, showPeople) {
    var form = view === "campaign";
    $("vdCampaignFields").hidden = !form;
    $("vdCallerBox").hidden = !form;
    $("vdPeople").hidden = !(form || showPeople);
    $("vdCampaignFoot").hidden = !form;
    $("vdCampaignErr").hidden = true;
    $("vdMaking").hidden = view !== "making";
    $("vdCampaignDone").hidden = view !== "result";
    var shown = view === "making" ? $("vdMaking") : view === "result" ? $("vdCampaignDone") : null;
    if (shown) {
      shown.classList.remove("vd-view-in");
      requestAnimationFrame(function () { shown.classList.add("vd-view-in"); });
    }
  }

  /* ───────── callers ───────── */
  function callerNames() {
    var seen = {};
    var out = [];
    document.querySelectorAll("#vdCallers .vd-caller-wrap:not(.is-gone) input").forEach(function (inp) {
      var n = inp.value.trim().slice(0, 60);
      if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = true; out.push(n); }
    });
    return out;
  }

  function updateSplit() {
    var names = callerNames();
    var box = $("vdSplit");
    if (!names.length || !campaignPeople) { box.hidden = true; return; }
    var base = Math.floor(campaignPeople / names.length);
    var extra = campaignPeople % names.length;
    box.hidden = false;
    box.textContent = names.length === 1
      ? "All " + campaignPeople + " people go to " + names[0] + "."
      : "Shared evenly: " + names.map(function (n, i) { return n + " " + (base + (i < extra ? 1 : 0)); }).join("  \u00b7  ");
  }

  function callerCount() { return document.querySelectorAll("#vdCallers .vd-caller-wrap:not(.is-gone)").length; }

  function callerButton() {
    var n = callerCount();
    $("vdAddCaller").textContent = n ? "+ Add another caller" : "+ Add callers";
    $("vdAddCaller").hidden = n >= 20;
  }

  function addCaller() {
    if (callerCount() >= 20) return;
    var wrap = document.createElement("div");
    wrap.className = "vd-caller-wrap";
    var inner = document.createElement("div");
    inner.className = "vd-caller-inner";
    var row = document.createElement("div");
    row.className = "vd-caller";
    var inp = document.createElement("input");
    inp.type = "text"; inp.maxLength = 60; inp.placeholder = "Caller name"; inp.autocomplete = "off";
    inp.setAttribute("aria-label", "Caller name");
    inp.addEventListener("input", updateSplit);
    var del = document.createElement("button");
    del.type = "button";
    del.className = "vi-icon-btn";
    del.setAttribute("aria-label", "Remove caller");
    del.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener("click", function () {
      wrap.classList.add("is-gone");
      wrap.classList.remove("is-in");
      wrap.setAttribute("inert", "");
      setTimeout(function () { wrap.remove(); }, 300);
      callerButton();
      updateSplit();
    });
    row.appendChild(inp); row.appendChild(del);
    inner.appendChild(row); wrap.appendChild(inner);
    $("vdCallers").appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add("is-in"); });
    callerButton();
    inp.focus();
  }
  $("vdAddCaller").addEventListener("click", addCaller);

  function fieldErr(msg) {
    $("cNameErr").textContent = msg || "";
    $("cNameErr").hidden = !msg;
    if (msg) $("cName").setAttribute("aria-invalid", "true"); else $("cName").removeAttribute("aria-invalid");
  }

  function syncCreate() {
    var named = !!$("cName").value.trim();
    $("cNameReq").classList.toggle("is-met", named);
    $("vdCampaignCreate").disabled = !named || !campaignPeople;
  }
  $("cName").addEventListener("input", function () { fieldErr(""); syncCreate(); });

  async function countPeople() {
    campaignPeople = 0;
    $("vdPeople").textContent = "Counting the people…";
    var session = drawerSession;
    try {
      var f = wire(state.filters);
      f.unique = true;
      var out = await api({ formType: "adminGet", type: "volunteerData", filters: f });
      if (session !== drawerSession) return;
      campaignPeople = out.rows.filter(function (r) { return /^\+91\d{10}$/.test(String(r.phone || "")); }).length;
      $("vdPeople").textContent = campaignPeople
        ? campaignPeople + (campaignPeople === 1 ? " person" : " people") + " will be in this campaign."
        : "No one with a phone number matches these filters.";
    } catch (e) {
      if (session !== drawerSession) return;
      $("vdPeople").textContent = "";
      $("vdCampaignErr").textContent = e.message;
      $("vdCampaignErr").hidden = false;
    }
    updateSplit();
    syncCreate();
  }

  function openDrawer(mode, url, title) {
    lastFocus = document.activeElement;
    drawerSession++;
    $("vdDrawerTitle").textContent = title || (mode === "campaign" ? "Create campaign" : "Your sheet");
    $("vdCallers").textContent = "";
    $("vdSplit").hidden = true;
    callerButton();
    fieldErr("");
    if (mode === "result") { setLink(url); setView("result"); }
    else if (mode === "campaign") { setView("campaign"); $("cName").value = ""; syncCreate(); countPeople(); }
    else setView("making");
    backdrop.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    drawer.removeAttribute("inert");
    drawerOpen = true;
    requestAnimationFrame(function () { backdrop.classList.add("is-open"); drawer.classList.add("is-open"); });
    if (mode === "campaign") setTimeout(function () { $("cName").focus({ preventScroll: true }); }, 200);
  }

  function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;
    backdrop.classList.remove("is-open");
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    drawer.setAttribute("inert", "");
    setTimeout(function () { backdrop.hidden = true; }, 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function setLink(url) {
    $("vdCampaignLink").href = url;
    $("vdCampaignLink").textContent = url;
    // The check draws itself each time the confirmation appears.
    var done = $("vdCampaignDone");
    done.classList.remove("is-in");
    requestAnimationFrame(function () { done.classList.add("is-in"); });
  }

  /* making the sheet: a line that keeps changing, a bar that creeps and never claims to be done until it is */
  var making = { timer: 0, started: 0, shownAt: 0 };
  var LINES = ["Gathering the people…", "Writing the rows…", "Setting up sharing…"];

  function makingTick() {
    var ms = Date.now() - making.started;
    var line = ms > 15000 ? "Still on it. Google is taking a moment…" : LINES[Math.min(LINES.length - 1, Math.floor(ms / 2200))];
    var el = $("vdMakingLine");
    if (el.textContent !== line) {
      el.textContent = line;
      el.classList.remove("is-swap");
      requestAnimationFrame(function () { el.classList.add("is-swap"); });
    }
    $("vdMakingBar").value = Math.min(95, 90 * (1 - Math.exp(-ms / 9000)));
  }

  function startMaking(title) {
    making.started = Date.now();
    making.shownAt = making.started;
    $("vdMakingTitle").textContent = title;
    $("vdDrawerTitle").textContent = "Just a moment";
    $("vdMakingLine").textContent = "";
    makingTick();
    clearInterval(making.timer);
    making.timer = setInterval(makingTick, 400);
    setView("making");
    $("vdMakingTitle").focus({ preventScroll: true });
  }

  /* When the reply arrives the bar fills; if the loader had shown, it stays at least 600ms so it never flashes. */
  function finishMaking() {
    clearInterval(making.timer);
    making.timer = 0;
    var shown = making.shownAt;
    making.shownAt = 0;
    if (!shown) return Promise.resolve();
    $("vdMakingBar").value = 100;
    return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, 600 - (Date.now() - shown))); });
  }

  $("vdDrawerClose").addEventListener("click", function () { closeDrawer(); });
  backdrop.addEventListener("click", function () { closeDrawer(); });

  $("vdCampaignBtn").addEventListener("click", function () { openDrawer("campaign"); });

  $("vdCampaignForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var name = $("cName").value.trim();
    if (!name) { fieldErr("Give the campaign a name."); $("cName").focus(); return; }
    var btn = $("vdCampaignCreate");
    btn.disabled = true;
    $("vdCampaignErr").hidden = true;
    var session = drawerSession;
    // The loader replaces the form only if the wait passes 300ms, so a quick reply never flashes it.
    var slow = setTimeout(function () { if (drawerOpen && session === drawerSession) startMaking("Making your campaign sheet"); }, 300);
    try {
      var out = await api({ formType: "adminVolunteerCampaign", name: name, filters: wire(state.filters), callers: callerNames() }, 120000);
      clearTimeout(slow);
      await finishMaking();
      if (!drawerOpen || session !== drawerSession) { toast("Campaign \u201c" + name + "\u201d is ready. Find it in Campaigns."); return; }
      var shared = (out.assignments || []).length
        ? " Callers: " + out.assignments.map(function (a) { return a.caller + " " + a.count; }).join("  \u00b7  ") + "."
        : "";
      $("vdPeople").textContent = out.campaign.people + (out.campaign.people === 1 ? " person" : " people") + " in " + out.campaign.name + "." + shared;
      $("vdDrawerTitle").textContent = "Campaign created";
      setLink(out.campaign.sheet_url);
      setView("result", true);
    } catch (err) {
      clearTimeout(slow);
      await finishMaking();
      if (drawerOpen && session === drawerSession) {
        setView("campaign");
        $("vdDrawerTitle").textContent = "Create campaign";
        $("vdCampaignErr").textContent = err.message;
        $("vdCampaignErr").hidden = false;
        btn.disabled = false;
      }
    }
  });

  $("vdOpenSheet").addEventListener("click", function () { window.open($("vdCampaignLink").href, "_blank", "noopener"); });
  $("vdCopyLink").addEventListener("click", async function () {
    var url = $("vdCampaignLink").href;
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch (e) {
      var tmp = document.createElement("textarea");
      tmp.value = url; document.body.appendChild(tmp); tmp.select();
      try { document.execCommand("copy"); toast("Link copied"); } catch (e2) { toast("Press Ctrl+C to copy"); }
      tmp.remove();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (isPhone() && $("vdMore").classList.contains("is-open")) { setMore(false); return; }
      if (drawerOpen) closeDrawer();
      else {
        var wasOpen = $("fProgramPop").classList.contains("is-open") ? $("fProgramBtn") : $("vdExportMenu").classList.contains("is-open") ? $("vdExportBtn") : null;
        closePops();
        if (wasOpen) wasOpen.focus();
      }
    }
    if (e.key === "Tab" && drawerOpen) {
      var items = drawer.querySelectorAll("button:not([disabled]):not([hidden]), input:not([hidden]), a[href]");
      var vis = Array.prototype.filter.call(items, function (n) { return n.offsetParent !== null; });
      if (!vis.length) return;
      var first = vis[0];
      var last = vis[vis.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  window.addEventListener("scroll", function () { $("vdHead").classList.toggle("is-scrolled", window.scrollY > 4); }, { passive: true });

  /* ───────── start ───────── */
  async function start() {
    if (!token()) { $("vdAuth").hidden = false; return; }
    try {
      state.options = await api({ formType: "adminGet", type: "volunteerFilters" });
    } catch (e) { showErr(e.message); return; }
    restoreFilters();
    syncInputs();
    $("vdFoot").hidden = !anyFilter();
    load();
  }
  start();
})();

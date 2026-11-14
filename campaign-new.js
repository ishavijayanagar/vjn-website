/* New campaign: three short steps. The audience comes from the filters on the Volunteers page; then a name and (optionally)
   callers; then a review. The result is a Google Sheet with one row per person. */
(function () {
  var $ = VD.$;
  var DRAFT_KEY = "vjn_cn_draft";
  var PHONE = /^\+91\d{10}$/;
  var BASE_COLS = ["Name", "Phone Number", "IE Completion Date"];
  var MORE_COLS = ["Area of Stay", "Vol Type", "Availability", "Profession", "Skills", "Remarks", "Call Status", "Call Notes"];
  var LINES = ["Gathering your volunteers…", "Writing the rows…", "Adding the dropdowns…", "Setting up sharing…"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var state = { options: null, filters: {}, people: [], total: 0, step: 1, madeAt: 0, timer: 0, started: 0, busy: false };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ───────── the audience ───────── */
  function wire(f) {
    var o = {};
    Object.keys(f).forEach(function (k) { o[k] = f[k]; });
    o.ie_from = Number(f.ie_from) || 0; o.ie_to = Number(f.ie_to) || 0; o.min_checkins = Number(f.min_checkins) || 0;
    o.unique = true;
    return o;
  }

  function showAudience() {
    var n = state.people.length;
    $("cnCount").textContent = n.toLocaleString("en-IN");
    $("cnCount").classList.add("is-ready");
    $("cnCountLabel").textContent = n === 1 ? "person" : "people";
    var skipped = state.total - n;
    $("cnFine").textContent = skipped > 0 ? plural(skipped, "person", "people") + " without a usable number " + (skipped === 1 ? "is" : "are") + " left out" : "";
    var words = VD.summaryOf(state.filters, state.options);
    [$("cnPills"), $("asPills")].forEach(function (host) {
      host.textContent = "";
      words.forEach(function (w) { host.appendChild(el("span", "cn-pill", w)); });
    });
    $("asCount").textContent = n.toLocaleString("en-IN");
    var list = $("cnPeople");
    list.textContent = "";
    state.people.slice(0, 5).forEach(function (r, i) {
      var li = el("li", "cn-person");
      var av = el("span", "cn-av", VD.initial(r.name));
      av.style.background = VD.color(i);
      var main = el("span", "cn-person-main");
      main.appendChild(el("b", "", r.name));
      main.appendChild(el("small", "", [r.stage_label, r.program].filter(Boolean).join("  ·  ")));
      li.appendChild(av);
      li.appendChild(main);
      list.appendChild(li);
    });
    $("cnPreviewBox").hidden = !n;
    $("cnNoOne").hidden = !!n;
    $("cnBig").hidden = !n;
    $("cnFine").hidden = !n;
    updateActions();
    suggest();
  }

  /* ───────── name suggestions: what can be known is filled in ───────── */
  function suggest() {
    var f = state.filters;
    var o = state.options || {};
    var prog = {};
    (o.programs || []).forEach(function (p) { prog[p.id] = p.title; });
    var stage = {};
    (o.stages || []).forEach(function (s) { stage[s.key] = s.label; });
    var parts = [];
    if ((f.programs || []).length === 1) parts.push(f.programs[0] === "" ? "General interests" : prog[f.programs[0]] || "");
    if ((f.stages || []).length === 1) parts.push(stage[f.stages[0]] || "");
    var a = parts.filter(Boolean).join(" · ") || "Volunteers";
    var d = new Date();
    var withDate = a + " · " + MONTHS[d.getMonth()] + " " + d.getFullYear();
    var box = $("cnSuggest");
    box.textContent = "";
    [a, withDate].forEach(function (s) {
      var b = el("button", "cn-chip", s);
      b.type = "button";
      b.addEventListener("click", function () { $("cnName").value = s; onName(); $("cnName").focus(); });
      box.appendChild(b);
    });
  }

  /* ───────── callers ───────── */
  function liveCallers() { return Array.prototype.slice.call(document.querySelectorAll("#cnCallers .cn-caller-wrap:not(.is-gone)")); }
  function names() {
    var seen = {};
    var out = [];
    liveCallers().forEach(function (w) {
      var n = w.querySelector("input").value.trim().slice(0, 60);
      if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = true; out.push(n); }
    });
    return out;
  }

  function addCaller(value) {
    if (liveCallers().length >= 20) return;
    var wrap = el("div", "cn-caller-wrap");
    var inner = el("div", "cn-caller-inner");
    var row = el("div", "cn-caller");
    var av = el("span", "cn-av", "?");
    var inp = document.createElement("input");
    inp.type = "text"; inp.maxLength = 60; inp.placeholder = "Caller name"; inp.autocomplete = "off";
    inp.setAttribute("aria-label", "Caller name");
    inp.value = value || "";
    inp.addEventListener("input", onCallers);
    var del = el("button", "vi-icon-btn");
    del.type = "button";
    del.setAttribute("aria-label", "Remove caller");
    del.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener("click", function () {
      wrap.classList.add("is-gone");
      wrap.classList.remove("is-in");
      wrap.setAttribute("inert", "");
      setTimeout(function () { wrap.remove(); }, 260);
      onCallers();
    });
    row.appendChild(av); row.appendChild(inp); row.appendChild(del);
    inner.appendChild(row); wrap.appendChild(inner);
    $("cnCallers").appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add("is-in"); });
    onCallers();
    if (!value) inp.focus();
  }

  /* Each caller's avatar follows their name and colour; the split is drawn as one bar. */
  function onCallers() {
    liveCallers().forEach(function (w, i) {
      var av = w.querySelector(".cn-av");
      av.textContent = VD.initial(w.querySelector("input").value);
      av.style.background = VD.color(i);
    });
    var list = names();
    $("cnAdd").textContent = liveCallers().length ? "+ Add another caller" : "+ Add callers";
    $("cnAdd").hidden = liveCallers().length >= 20;
    var n = state.people.length;
    $("cnSplit").hidden = !list.length || !n;
    var bar = $("cnSplitBar");
    var legend = $("cnLegend");
    bar.textContent = ""; legend.textContent = "";
    if (list.length && n) {
      VD.split(n, list).forEach(function (s, i) {
        var seg = document.createElement("i");
        seg.style.background = VD.color(i);
        seg.style.flexGrow = String(s.count);
        bar.appendChild(seg);
        var li = el("li");
        var dot = document.createElement("i");
        dot.style.background = VD.color(i);
        li.appendChild(dot);
        li.appendChild(document.createTextNode(s.caller + " " + s.count));
        legend.appendChild(li);
      });
    }
    $("asCallers").textContent = list.length ? plural(list.length, "caller", "callers") + ": " + list.join(", ") : "None";
    $("asCallers").classList.toggle("is-empty", !list.length);
    saveDraft();
  }

  /* ───────── name ───────── */
  function nameErr(msg) {
    $("cnNameErr").textContent = msg || "";
    $("cnNameErr").hidden = !msg;
    if (msg) $("cnName").setAttribute("aria-invalid", "true"); else $("cnName").removeAttribute("aria-invalid");
  }
  function onName() {
    var v = $("cnName").value.trim();
    $("cnReq").classList.toggle("is-met", !!v);
    if (v) nameErr("");
    $("asName").textContent = v || "Not named yet";
    $("asName").classList.toggle("is-empty", !v);
    saveDraft();
  }
  $("cnName").addEventListener("input", onName);
  $("cnName").addEventListener("blur", function () { if (state.step === 2 && !$("cnName").value.trim()) nameErr("Give the campaign a name."); });
  $("cnName").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); next(); } });
  $("cnAdd").addEventListener("click", function () { addCaller(""); });

  /* The name and callers are kept for this visit, so going to change the filters does not lose them. */
  function saveDraft() { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name: $("cnName").value, callers: names() })); } catch (e) { /* a convenience */ } }
  function loadDraft() {
    try {
      var d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      if (!d) return;
      $("cnName").value = d.name || "";
      (d.callers || []).forEach(function (n) { addCaller(n); });
    } catch (e) { /* start clean */ }
    onName();
  }

  /* ───────── steps ───────── */
  var PANELS = { 1: "cnP1", 2: "cnP2", 3: "cnP3" };

  function updateActions() {
    var n = state.people.length;
    $("cnBack").hidden = state.step === 1;
    $("cnNext").textContent = state.step === 3 ? "Create campaign" : state.step === 2 ? "Review" : "Continue";
    $("cnNext").disabled = state.busy || (state.step === 1 && !n);
    $("cnMini").textContent = n ? plural(n, "person", "people") : "";
  }

  function setStepper(step) {
    document.querySelectorAll("#cnSteps .cn-step").forEach(function (li) {
      var k = Number(li.getAttribute("data-step"));
      li.classList.toggle("is-now", k === step);
      li.classList.toggle("is-done", k < step);
      var dot = li.querySelector(".cn-dot");
      dot.innerHTML = k < step ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : String(k);
      if (k === step) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
    document.querySelectorAll("#cnSteps .cn-link").forEach(function (l, i) { l.classList.toggle("is-done", i + 1 < step); });
  }

  function show(id) {
    ["cnP1", "cnP2", "cnP3", "cnMaking", "cnDone"].forEach(function (p) { $(p).hidden = p !== id; });
    var panel = $(id);
    panel.classList.remove("vd-view-in");
    requestAnimationFrame(function () { panel.classList.add("vd-view-in"); });
  }

  function go(step) {
    state.step = step;
    setStepper(step);
    show(PANELS[step]);
    if (step === 3) review();
    updateActions();
    var h = $(PANELS[step]).querySelector(".cn-h");
    if (h) h.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
    // On a phone the keyboard would jump up over the page, so the name box is only focused for a mouse or keyboard.
    var touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (step === 2 && !touch) setTimeout(function () { $("cnName").focus({ preventScroll: true }); }, 220);
  }

  function next() {
    if (state.busy) return;
    if (state.step === 1) { if (state.people.length) go(2); return; }
    if (state.step === 2) {
      if (!$("cnName").value.trim()) { nameErr("Give the campaign a name."); $("cnName").focus(); return; }
      go(3); return;
    }
    create();
  }
  $("cnNext").addEventListener("click", next);
  $("cnBack").addEventListener("click", function () { if (state.step > 1 && !state.busy) go(state.step - 1); });

  function review() {
    var list = names();
    $("rvName").textContent = $("cnName").value.trim();
    var n = state.people.length;
    $("rvPeople").textContent = plural(n, "person", "people");
    $("rvCallersRow").hidden = !list.length;
    $("rvCallers").textContent = list.length ? VD.split(n, list).map(function (s) { return s.caller + " " + s.count; }).join("  ·  ") : "";
    var cols = BASE_COLS.concat(list.length ? ["Caller Name"] : [], MORE_COLS);
    var host = $("rvCols");
    host.textContent = "";
    cols.forEach(function (c) { host.appendChild(el("span", "cn-pill", c)); });
    $("cnErr").hidden = true;
  }

  /* ───────── making it ───────── */
  function tick() {
    var ms = Date.now() - state.started;
    var line = ms > 15000 ? "Still on it. Google is taking a moment…" : LINES[Math.min(LINES.length - 1, Math.floor(ms / 2200))];
    var e = $("cnMakingLine");
    if (e.textContent !== line) { e.textContent = line; e.classList.remove("is-swap"); requestAnimationFrame(function () { e.classList.add("is-swap"); }); }
    $("cnMakingBar").value = Math.min(95, 90 * (1 - Math.exp(-ms / 9000)));
  }

  function startLoader() {
    state.started = Date.now();
    state.madeAt = state.started;
    $("cnMakingLine").textContent = "";
    tick();
    clearInterval(state.timer);
    state.timer = setInterval(tick, 400);
    show("cnMaking");
    $("cnActions").hidden = true;
    $("cnMakingTitle").focus({ preventScroll: true });
  }

  /* The bar fills when the reply lands; if the loader had shown, it stays at least 600ms so it never flashes. */
  function endLoader() {
    clearInterval(state.timer);
    state.timer = 0;
    var shown = state.madeAt;
    state.madeAt = 0;
    if (!shown) return Promise.resolve();
    $("cnMakingBar").value = 100;
    return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, 600 - (Date.now() - shown))); });
  }

  async function create() {
    state.busy = true;
    updateActions();
    $("cnNext").setAttribute("aria-busy", "true");
    $("cnErr").hidden = true;
    var callers = names();
    var slow = setTimeout(startLoader, 300); // the loader only appears if the wait passes 300ms
    try {
      var out = await VD.api({ formType: "adminVolunteerCampaign", name: $("cnName").value.trim(), filters: wire(state.filters), callers: callers }, 120000);
      clearTimeout(slow);
      await endLoader();
      done(out);
    } catch (err) {
      clearTimeout(slow);
      await endLoader();
      $("cnActions").hidden = false;
      go(3);
      $("cnErr").textContent = err.message;
      $("cnErr").hidden = false;
    } finally {
      state.busy = false;
      $("cnNext").removeAttribute("aria-busy");
      updateActions();
    }
  }

  function done(out) {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* fine */ }
    var c = out.campaign;
    var shared = (out.assignments || []).length ? "  ·  " + out.assignments.map(function (a) { return a.caller + " " + a.count; }).join("  ·  ") : "";
    $("cnDoneTitle").textContent = "“" + c.name + "” is ready";
    $("cnDoneSub").textContent = plural(c.people, "person", "people") + shared;
    $("cnLink").href = c.sheet_url; $("cnLink").textContent = c.sheet_url;
    $("cnOpen").href = c.sheet_url;
    $("cnActions").hidden = true;
    setStepper(4);
    show("cnDone");
    $("cnDone").classList.remove("is-in");
    requestAnimationFrame(function () { $("cnDone").classList.add("is-in"); });
    $("cnDoneTitle").focus({ preventScroll: true });
  }

  $("cnCopy").addEventListener("click", async function () {
    var url = $("cnLink").href;
    try { await navigator.clipboard.writeText(url); VD.toast("cnToast", "Link copied"); }
    catch (e) {
      var tmp = document.createElement("textarea");
      tmp.value = url; document.body.appendChild(tmp); tmp.select();
      try { document.execCommand("copy"); VD.toast("cnToast", "Link copied"); } catch (e2) { VD.toast("cnToast", "Press Ctrl+C to copy"); }
      tmp.remove();
    }
  });

  window.addEventListener("scroll", function () { $("cnHead").classList.toggle("is-scrolled", window.scrollY > 4); }, { passive: true });

  /* ───────── start ───────── */
  async function start() {
    if (!VD.token()) { $("cnAuth").hidden = false; return; }
    state.filters = VD.loadFilters();
    try {
      state.options = await VD.api({ formType: "adminGet", type: "volunteerFilters" });
    } catch (e) { state.options = null; if (e.auth) { $("cnAuth").hidden = false; return; } }
    loadDraft();
    try {
      var out = await VD.api({ formType: "adminGet", type: "volunteerData", filters: wire(state.filters) });
      var rows = out.rows || [];
      state.total = rows.length;
      state.people = rows.filter(function (r) { return PHONE.test(r.phone); });
    } catch (e) {
      $("cnCount").classList.add("is-ready");
      $("cnCount").textContent = "–";
      $("cnFine").textContent = e.message;
      return;
    }
    showAudience();
    onCallers();
  }
  start();
})();

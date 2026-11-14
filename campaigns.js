/* Campaigns: the Google Sheets made from the Volunteers page, newest first. Each row opens to show the filters used and how
   the callers were given their people. Talks to Sandesha (the Pi) with the admin login already stored by admin.html. */
(function () {
  var $ = VD.$;
  var PAGE = 20;
  var state = { items: [], kind: "all", search: "", sort: "new", shown: PAGE, options: null, entered: false, open: 0 };

  /* ───────── helpers ───────── */
  function ago(iso) {
    var t = Date.parse(String(iso || "").replace(" ", "T"));
    if (Number.isNaN(t)) return "–";
    var days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return days + " days ago";
    return VD.monthWord(String(iso).slice(0, 10));
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function avatar(name, i) {
    var a = el("span", "cp-av", VD.initial(name));
    a.style.background = VD.color(i);
    a.title = name;
    return a;
  }

  var CHEV = '<svg class="cp-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  /* ───────── a row ───────── */
  function row(r, i, enter) {
    var li = el("li", "cp-row" + (enter ? " is-enter" : ""));
    if (enter) li.style.setProperty("--i", String(i));
    var callers = (r.filters && r.filters.callers) || [];
    var words = VD.summaryOf(r.filters, state.options);

    var main = el("button", "cp-main");
    main.type = "button";
    main.setAttribute("aria-expanded", "false");

    var title = el("span", "cp-title");
    var name = el("span", "cp-name");
    name.appendChild(el("b", "", r.name));
    name.appendChild(el("span", "cp-kind cp-kind--" + r.kind, r.kind === "campaign" ? "Campaign" : "Export"));
    if (r.kind === "campaign") name.appendChild(el("span", "cp-state cp-state--" + (r.status === "closed" ? "closed" : "open"), r.status === "closed" ? "Closed" : "Open"));
    title.appendChild(name);
    title.appendChild(el("span", "cp-sub", words.join("  ·  ")));
    main.appendChild(title);

    main.appendChild(el("span", "cp-num", String(r.people)));

    var av = el("span", "cp-callers cp-avatars");
    if (callers.length) {
      callers.slice(0, 3).forEach(function (c, k) { av.appendChild(avatar(c, k)); });
      if (callers.length > 3) av.appendChild(el("span", "cp-av cp-av--more", "+" + (callers.length - 3)));
    } else av.appendChild(el("span", "cp-none", "–"));
    main.appendChild(av);

    var made = el("span", "cp-made", ago(r.created_at));
    if (r.created_by) made.appendChild(el("small", "", "by " + r.created_by));
    main.appendChild(made);

    var chev = el("span", "cp-chev-wrap");
    chev.innerHTML = CHEV;
    main.appendChild(chev.firstChild);
    li.appendChild(main);

    var ex = el("div", "cp-expand");
    ex.setAttribute("inert", "");
    var inner = el("div", "cp-expand-inner");
    inner.appendChild(detail(r, callers, words));
    ex.appendChild(inner);
    li.appendChild(ex);

    main.addEventListener("click", function () { toggle(li, main, ex); });
    return li;
  }

  function detail(r, callers, words) {
    var box = el("div", "cp-detail");

    var f = el("div", "cp-sec");
    f.appendChild(el("h3", "", "Filters used"));
    var pills = el("div", "cp-pills");
    words.forEach(function (w) { pills.appendChild(el("span", "cp-pill", w)); });
    f.appendChild(pills);
    box.appendChild(f);

    if (callers.length) {
      var c = el("div", "cp-sec");
      c.appendChild(el("h3", "", "Callers"));
      var share = el("div", "cp-share");
      var split = VD.split(r.people, callers);
      var most = Math.max.apply(null, split.map(function (s) { return s.count; })) || 1;
      split.forEach(function (s, k) {
        var line = el("div", "cp-share-row");
        line.appendChild(avatar(s.caller, k));
        line.appendChild(el("span", "", s.caller));
        var bar = el("div", "cp-bar");
        var fill = document.createElement("i");
        fill.style.background = VD.color(k);
        fill.style.width = Math.round((s.count / most) * 100) + "%";
        bar.appendChild(fill);
        line.appendChild(bar);
        line.appendChild(el("b", "", String(s.count)));
        share.appendChild(line);
      });
      c.appendChild(share);
      box.appendChild(c);
    }

    var actions = el("div", "cp-actions");
    var open = el("a", "vi-btn vi-btn--primary", "Open sheet");
    open.href = r.sheet_url; open.target = "_blank"; open.rel = "noopener";
    var copy = el("button", "vi-btn", "Copy link");
    copy.type = "button";
    copy.addEventListener("click", function () { copyLink(r.sheet_url); });
    actions.appendChild(open);
    actions.appendChild(copy);
    if (r.kind === "campaign" && r.status === "closed") {
      box.appendChild(closedNote(r));
    } else if (r.kind === "campaign") {
      var close = el("button", "vi-btn cp-close-btn", "Close campaign");
      close.type = "button";
      actions.appendChild(close);
      var panel = el("div", "cp-confirm");
      panel.hidden = true;
      panel.setAttribute("role", "group");
      panel.setAttribute("aria-label", "Close campaign");
      panel.appendChild(el("p", "cp-confirm-text", "Save what callers entered and lock the sheet. This can't be undone."));
      var row2 = el("div", "cp-confirm-actions");
      var no = el("button", "vi-btn", "Cancel"); no.type = "button";
      var yes = el("button", "vi-btn vi-btn--primary", "Close campaign"); yes.type = "button";
      row2.appendChild(no); row2.appendChild(yes);
      panel.appendChild(row2);
      var status = el("p", "cp-working", ""); status.hidden = true; status.setAttribute("role", "status");
      close.addEventListener("click", function () { actions.hidden = true; panel.hidden = false; no.focus(); });
      no.addEventListener("click", function () { panel.hidden = true; actions.hidden = false; close.focus(); });
      yes.addEventListener("click", function () { closeIt(r, box, actions, panel, status); });
      box.appendChild(panel);
      box.appendChild(status);
    }
    box.insertBefore(actions, box.querySelector(".cp-confirm") || box.querySelector(".cp-closed") || null);
    return box;
  }

  function closedNote(r) {
    var res = r.result || {};
    var note = el("div", "cp-closed");
    var bits = [];
    if (r.closed_at) bits.push("Closed " + ago(r.closed_at) + (r.closed_by ? " by " + r.closed_by : ""));
    var n = res.updated || 0;
    bits.push(n + (n === 1 ? " person updated" : " people updated"));
    if (res.new_people) bits.push(res.new_people + " added to Interests");
    if (res.call_notes) bits.push(res.call_notes + (res.call_notes === 1 ? " call note" : " call notes"));
    if (res.locked === false) bits.push("Sheet not locked");
    note.textContent = bits.join("  ·  ");
    return note;
  }

  var STEPS = ["Reading the sheet…", "Saving what callers entered…", "Locking the sheet…"];
  async function closeIt(r, box, actions, panel, status) {
    panel.hidden = true;
    status.hidden = false;
    var k = 0;
    status.textContent = STEPS[0];
    var timer = setInterval(function () { k = Math.min(k + 1, STEPS.length - 1); status.textContent = STEPS[k]; }, 1800);
    try {
      var out = await VD.api({ formType: "adminVolunteerCampaignClose", id: r.id });
      clearInterval(timer);
      r.status = "closed"; r.result = out.result || {}; r.closed_at = new Date().toISOString().slice(0, 19); r.closed_by = "";
      status.remove();
      var old = box.querySelector(".cp-actions");
      if (old) old.querySelectorAll(".cp-close-btn").forEach(function (b) { b.remove(); });
      actions.hidden = false;
      box.appendChild(closedNote(r));
      var tag = box.closest(".cp-row").querySelector(".cp-state");
      if (tag) { tag.textContent = "Closed"; tag.className = "cp-state cp-state--closed"; }
      VD.toast("cpToast", "Campaign closed");
    } catch (e) {
      clearInterval(timer);
      status.hidden = true;
      actions.hidden = false;
      showErr(e.message || "Could not close the campaign.");
    }
  }

  /* One row open at a time; a closed row cannot take focus. */
  function toggle(li, main, ex) {
    var willOpen = !li.classList.contains("is-open");
    document.querySelectorAll(".cp-row.is-open").forEach(function (o) {
      o.classList.remove("is-open");
      o.querySelector(".cp-main").setAttribute("aria-expanded", "false");
      o.querySelector(".cp-expand").setAttribute("inert", "");
    });
    if (willOpen) {
      li.classList.add("is-open");
      main.setAttribute("aria-expanded", "true");
      ex.removeAttribute("inert");
    }
  }

  async function copyLink(url) {
    try { await navigator.clipboard.writeText(url); VD.toast("cpToast", "Link copied"); }
    catch (e) {
      var tmp = document.createElement("textarea");
      tmp.value = url; document.body.appendChild(tmp); tmp.select();
      try { document.execCommand("copy"); VD.toast("cpToast", "Link copied"); } catch (e2) { VD.toast("cpToast", "Press Ctrl+C to copy"); }
      tmp.remove();
    }
  }

  /* ───────── list ───────── */
  function matches(r) {
    if (state.kind !== "all" && r.kind !== state.kind) return false;
    if (!state.search) return true;
    var hay = [r.name, r.created_by].concat((r.filters && r.filters.callers) || []).join(" ").toLowerCase();
    return hay.indexOf(state.search.toLowerCase()) >= 0;
  }

  function sorted(list) {
    var by = { new: function (a, b) { return a.created_at < b.created_at ? 1 : -1; }, old: function (a, b) { return a.created_at > b.created_at ? 1 : -1; }, people: function (a, b) { return b.people - a.people; } };
    return list.slice().sort(by[state.sort] || by.new);
  }

  function empty(none) {
    var box = el("li", "cp-empty");
    box.innerHTML = '<svg class="cp-empty-ico" viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="6" width="30" height="36" rx="5"/><path d="M16 17h16M16 24h16M16 31h9"/></svg>';
    box.appendChild(el("h2", "", none ? "No campaigns yet" : "Nothing matches"));
    box.appendChild(el("p", "", none ? "Filter your volunteers, pick who will call, and a ready-to-use Google Sheet is made for you." : "Try a different word, or clear the filters."));
    var b = el(none ? "a" : "button", "vi-btn" + (none ? " vi-btn--primary" : ""), none ? "Make the first campaign" : "Clear filters");
    if (none) b.href = "volunteers.html";
    else {
      b.type = "button";
      b.addEventListener("click", function () { state.kind = "all"; state.search = ""; $("cpSearch").value = ""; syncKinds(); render(); });
    }
    box.appendChild(b);
    return box;
  }

  function stats() {
    var camps = state.items.filter(function (r) { return r.kind === "campaign"; });
    $("stCampaigns").textContent = String(camps.length);
    $("stPeople").textContent = camps.reduce(function (n, r) { return n + r.people; }, 0).toLocaleString("en-IN");
    var newest = state.items.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })[0];
    $("stLast").textContent = newest ? ago(newest.created_at) : "–";
    $("nAll").textContent = String(state.items.length);
    $("nCampaign").textContent = String(camps.length);
    $("nExport").textContent = String(state.items.length - camps.length);
  }

  function render() {
    var host = $("cpList");
    host.textContent = "";
    var list = sorted(state.items.filter(matches));
    if (!list.length) {
      host.appendChild(empty(!state.items.length));
      $("cpMore").hidden = true;
      return;
    }
    var enter = !state.entered;
    list.slice(0, state.shown).forEach(function (r, i) { host.appendChild(row(r, Math.min(i, 5), enter && i < 6)); });
    state.entered = true;
    $("cpMore").hidden = list.length <= state.shown;
  }

  function syncKinds() {
    document.querySelectorAll("#cpKinds .vd-chip").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-kind") === state.kind ? "true" : "false");
    });
  }

  document.querySelectorAll("#cpKinds .vd-chip").forEach(function (b) {
    b.addEventListener("click", function () { state.kind = b.getAttribute("data-kind"); state.shown = PAGE; syncKinds(); render(); });
  });
  var searchTimer = 0;
  $("cpSearch").addEventListener("input", function () {
    clearTimeout(searchTimer);
    var v = this.value.trim();
    searchTimer = setTimeout(function () { state.search = v; state.shown = PAGE; render(); }, 150);
  });
  $("cpSort").addEventListener("change", function () { state.sort = this.value; render(); });
  $("cpMore").addEventListener("click", function () { state.shown += PAGE; render(); });

  /* ───────── load ───────── */
  function showErr(msg) { $("cpErrText").textContent = msg || ""; $("cpErr").hidden = !msg; }
  $("cpRetry").addEventListener("click", function () { showErr(""); start(); });
  window.addEventListener("scroll", function () { $("cpHead").classList.toggle("is-scrolled", window.scrollY > 4); }, { passive: true });

  async function start() {
    if (!VD.token()) { $("cpAuth").hidden = false; return; }
    try {
      var out = await VD.api({ formType: "adminGet", type: "volunteerSheets", limit: 200 });
      // The words for program and source names are a nicety: the list still shows without them.
      try { state.options = await VD.api({ formType: "adminGet", type: "volunteerFilters" }); } catch (e) { state.options = null; }
      state.items = out.items || [];
      state.entered = false;
      stats();
      render();
    } catch (e) {
      if (e.auth) $("cpAuth").hidden = false;
      $("cpList").textContent = "";
      showErr(e.message);
    }
  }
  start();
})();

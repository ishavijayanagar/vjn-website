/* Volunteer interests: paste / photo / manual -> preview -> add. Talks to Sandesha (the Pi) with the
   admin login already stored by admin.html. Nothing is saved until "Add" is pressed. */
(function () {
  var TOKEN_KEY = "vjn_admin_token";
  var COLS = ["name", "whatsapp", "area", "ie_completion", "vol_type", "availability", "profession", "skill", "volunteer_remarks"];
  var LABELS = { whatsapp: "WhatsApp number", area: "Area of stay", ie_completion: "IE completion date", vol_type: "Volunteering type", availability: "Availability", profession: "Profession", skill: "Skills", volunteer_remarks: "Remarks" };
  /* The choices the dropdowns offer (the volunteering quiz's own lists). */
  var CHOICES = {
    vol_type: ["In-Person Volunteering", "Online Volunteering", "Both"],
    availability: ["Weekdays", "Weekends", "Both"],
    profession: ["Student", "IT / Tech / Design", "Teacher / Educator", "Business / Management", "Homemaker", "Retired", "Other"],
  };

  function $(id) { return document.getElementById(id); }
  function token() {
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function base() { return String(window.SANDESHA_API_URL || "").replace(/\/$/, ""); }

  /* timeoutMs gives up after that long; `ctl` (optional) lets the person cancel from outside. */
  async function api(payload, timeoutMs, ctl) {
    var res;
    ctl = ctl || new AbortController();
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
      if (e && e.name === "AbortError") {
        var err = new Error(timedOut ? "That took too long. Try again, or paste the details instead." : "Cancelled.");
        err.cancelled = !timedOut;
        throw err;
      }
      throw new Error("Sandesha is not reachable right now. Try again in a minute.");
    } finally { clearTimeout(timer); }
    var out = await res.json().catch(function () { return { error: "Sandesha replied HTTP " + res.status }; });
    if (res.status === 401) { $("viAuth").hidden = false; throw new Error("Please sign in again on the admin page."); }
    if (!res.ok || out.error) throw new Error(out.error || "Something went wrong.");
    return out;
  }

  var state = { rows: [], source: "paste" };

  function showErr(msg) {
    var el = $("viErr");
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function busy(btn, on, label) {
    btn.disabled = on;
    if (label !== undefined) btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.textContent = on ? (label || "Working…") : (btn.dataset.label || btn.textContent);
  }

  /* ───────── tabs ───────── */
  document.querySelectorAll(".vi-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".vi-tab").forEach(function (t) { t.classList.toggle("is-on", t === tab); });
      document.querySelectorAll(".vi-pane").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== tab.getAttribute("data-tab"); });
      showErr("");
    });
  });

  /* ───────── preview ───────── */
  function rowIssues(r) { return (r.issues || []).join("; "); }

  function render() {
    var body = $("viRows");
    body.textContent = "";
    state.rows.forEach(function (r, i) {
      var tr = document.createElement("tr");
      if (r.blocked) tr.className = "is-bad";
      else if (r.duplicate) tr.className = "is-dup";

      var tdAdd = document.createElement("td");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!r.add;
      cb.disabled = !!r.blocked;
      cb.setAttribute("aria-label", "Add this row");
      cb.addEventListener("change", function () { r.add = cb.checked; updateSummary(); });
      tdAdd.appendChild(cb);
      tr.appendChild(tdAdd);
      r._tr = tr; r._cb = cb; r._inps = {};

      COLS.forEach(function (c) {
        var td = document.createElement("td");
        var inp;
        if (CHOICES[c]) {
          // A dropdown. A value read from a photo or pasted text that is not one of the choices is kept as an extra option, not lost.
          inp = document.createElement("select");
          var opts = [""].concat(CHOICES[c]);
          if (r[c] && opts.indexOf(r[c]) < 0) opts.push(r[c]);
          opts.forEach(function (v) {
            var o = document.createElement("option");
            o.value = v;
            o.textContent = v || "—";
            inp.appendChild(o);
          });
          inp.value = r[c] || "";
        } else {
          inp = document.createElement("input");
          inp.type = "text";
          inp.value = r[c] || "";
        }
        inp.setAttribute("aria-label", LABELS[c] || c.replace(/_/g, " "));
        // Editing a cell re-checks the rows on its own, so a fixed number can be ticked straight away.
        inp.addEventListener("input", function () { r[c] = inp.value; scheduleRecheck(); });
        inp.addEventListener("change", function () { r[c] = inp.value; clearTimeout(recheckTimer); recheck(); });
        r._inps[c] = inp;
        td.appendChild(inp);
        tr.appendChild(td);
      });

      var tdIssue = document.createElement("td");
      tdIssue.className = "vi-issue";
      tdIssue.textContent = rowIssues(r);
      tr.appendChild(tdIssue);
      r._issue = tdIssue;
      body.appendChild(tr);
    });
    updateSummary();
  }

  function updateSummary() {
    var total = state.rows.length;
    var bad = state.rows.filter(function (r) { return r.blocked; }).length;
    var dup = state.rows.filter(function (r) { return r.duplicate && !r.blocked; }).length;
    var picked = state.rows.filter(function (r) { return r.add && !r.blocked; }).length;
    var parts = [total + " row" + (total === 1 ? "" : "s")];
    if (bad) parts.push(bad + " to fix");
    if (dup) parts.push(dup + " repeated");
    $("viSummary").textContent = parts.join(" · ");
    $("viAdd").textContent = "Add " + picked;
    $("viAdd").disabled = picked === 0;
  }

  function load(rows, source) {
    state.rows = rows.map(function (r) {
      var copy = {};
      COLS.forEach(function (c) { copy[c] = r[c] || ""; });
      copy.issues = r.issues || [];
      copy.blocked = !!r.blocked;
      copy.duplicate = !!r.duplicate;
      copy.add = !r.blocked && !r.duplicate;
      return copy;
    });
    state.source = source;
    $("viReview").hidden = false;
    $("viDone").hidden = true;
    render();
    $("viReview").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function previewText(text, source, btn) {
    showErr("");
    if (!String(text || "").trim()) { showErr("There is nothing to preview yet."); return; }
    busy(btn, true, "Reading…");
    try {
      var out = await api({ formType: "adminVolInterestPreview", text: text });
      load(out.rows, source);
    } catch (e) { showErr(e.message); } finally { busy(btn, false); }
  }

  $("viPreviewText").addEventListener("click", function () { previewText($("viText").value, "paste", this); });

  /* ───────── photo ───────── */
  function readImage(file) {
    // Shrink big phone photos: it uploads faster and the AI reads them just as well.
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 2000;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
          var fr = new FileReader();
          fr.onload = function () { URL.revokeObjectURL(url); resolve({ base64: String(fr.result).split(",")[1], mimeType: file.type }); };
          fr.onerror = reject;
          fr.readAsDataURL(file);
          return;
        }
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({ base64: canvas.toDataURL("image/jpeg", 0.9).split(",")[1], mimeType: "image/jpeg" });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That file could not be opened as an image.")); };
      img.src = url;
    });
  }

  $("viImage").addEventListener("change", function () {
    var f = this.files && this.files[0];
    var thumb = $("viImagePreview");
    $("viImageName").textContent = f ? f.name : "Choose a photo";
    if (!f) { thumb.hidden = true; return; }
    thumb.src = URL.createObjectURL(f);
    thumb.hidden = false;
  });

  /* One button: the photo is read by AI (an admin switches it on, and the server needs a key). */
  var aiReady = false;

  /* What is happening, so the wait never looks frozen: the step it is on, a running clock, a bar that keeps creeping
     forward while the reply is awaited (it never claims to be finished until it is), and a way to cancel. */
  var progress = { timer: 0, started: 0, stepStart: 0, step: "", label: "", ctl: null, offset: 0 };

  function showStep(step, label) {
    progress.step = step;
    progress.label = label;
    tick();
  }

  /* While the AI reads, the line changes every few seconds so the wait feels alive. */
  var READING_LINES = [
    "Squinting at the handwriting…",
    "Deciphering the scribbles…",
    "Counting the volunteers…",
    "Untangling the phone numbers…",
    "Asking the AI very nicely…",
    "Reading between the lines…",
    "Hunting for IE dates…",
    "Spotting the names…",
    "Dotting the i's and crossing the t's…",
    "Making sense of the ink…",
    "Gathering the good souls…",
  ];
  var LINE_EVERY_MS = 2800;

  function tick() {
    var text = progress.label;
    if (progress.step === "read") {
      // Each wait starts at a different line. After a long wait it says so plainly instead of looping on.
      var ms = Date.now() - progress.stepStart;
      text = ms > 45000
        ? "Still on it. Thanks for your patience…"
        : READING_LINES[(progress.offset + Math.floor(ms / LINE_EVERY_MS)) % READING_LINES.length];
    }
    $("viStatus").textContent = text;
    // Eases toward 90% over about a minute; the real finish snaps it to 100%.
    var base = { prepare: 0, read: 8, check: 92 }[progress.step] || 0;
    var span = { prepare: 8, read: 82, check: 7 }[progress.step] || 0;
    var stepSecs = (Date.now() - progress.stepStart) / 1000;
    $("viOcrBar").value = Math.min(99, base + span * (1 - Math.exp(-stepSecs / 25)));
  }

  function beginProgress(ctl) {
    progress.started = Date.now();
    progress.stepStart = progress.started;
    progress.offset = Math.floor(Math.random() * (READING_LINES.length - 1));
    progress.ctl = ctl;
    $("viProgress").hidden = false;
    clearInterval(progress.timer);
    progress.timer = setInterval(tick, 500);
  }

  function setStep(step, label) {
    progress.stepStart = Date.now();
    showStep(step, label);
  }

  function endProgress() {
    clearInterval(progress.timer);
    progress.ctl = null;
    $("viProgress").hidden = true;
    $("viStatus").textContent = "";
  }

  $("viCancelExtract").addEventListener("click", function () { if (progress.ctl) progress.ctl.abort(); });

  $("viExtract").addEventListener("click", async function () {
    var btn = this;
    var f = $("viImage").files && $("viImage").files[0];
    showErr("");
    if (!f) { showErr("Choose a photo first."); return; }
    if (!aiReady) { showErr("Reading photos is not switched on. Ask an admin, or paste the details instead."); return; }
    var ctl = new AbortController();
    busy(btn, true, "Extracting…");
    beginProgress(ctl);
    try {
      setStep("prepare", "Unpacking your photo…");
      var img = await readImage(f);
      setStep("read", "");
      var out = await api({ formType: "adminVolInterestExtract", base64: img.base64, mimeType: img.mimeType }, 120000, ctl);
      setStep("check", "Tidying up the rows…");
      $("viOcrBar").value = 100;
      load(out.rows, "image");
    } catch (e) { if (!e.cancelled) showErr(e.message); } finally { endProgress(); busy(btn, false); }
  });

  /* AI reading is used only when an admin has switched it on (and the server has a key). */
  function applyConfig(cfg) {
    aiReady = !!(cfg && cfg.aiEnabled && cfg.aiConfigured);
  }

  async function loadConfig() {
    try { applyConfig(await api({ formType: "adminGet", type: "volInterestsConfig" })); } catch (e) { /* the photo-on-device option still works */ }
  }

  /* ───────── re-check, add, start over ───────── */
  /* Re-check in the background after an edit. Rows are updated in place so the cursor stays where it is. */
  var recheckTimer = 0;
  var recheckSeq = 0;

  function scheduleRecheck() {
    clearTimeout(recheckTimer);
    recheckTimer = setTimeout(recheck, 500);
  }

  function applyFlags(r) {
    r._tr.className = r.blocked ? "is-bad" : r.duplicate ? "is-dup" : "";
    r._cb.disabled = !!r.blocked;
    r._cb.checked = !!r.add;
    r._issue.textContent = rowIssues(r);
  }

  async function recheck() {
    var seq = ++recheckSeq;
    var sent = state.rows.map(function (r) {
      var o = {};
      COLS.forEach(function (c) { o[c] = r[c]; });
      return o;
    });
    var out;
    try { out = await api({ formType: "adminVolInterestPreview", rows: sent }); } catch (e) { return; }
    if (seq !== recheckSeq) return; // a newer edit is already being checked
    out.rows.forEach(function (n, i) {
      var r = state.rows[i];
      if (!r || !r._tr) return;
      var wasBlocked = r.blocked;
      r.issues = n.issues || [];
      r.blocked = !!n.blocked;
      r.duplicate = !!n.duplicate;
      if (r.blocked) r.add = false;
      else if (wasBlocked && !r.duplicate) r.add = true; // just fixed: ready to add
      // Show the tidied number (+91…) unless the person is still typing in that cell.
      if (n.whatsapp && n.whatsapp !== r.whatsapp && document.activeElement !== r._inps.whatsapp) {
        r.whatsapp = n.whatsapp;
        r._inps.whatsapp.value = n.whatsapp;
      }
      applyFlags(r);
    });
    updateSummary();
  }

  $("viAdd").addEventListener("click", async function () {
    var btn = this;
    var picked = state.rows.filter(function (r) { return r.add && !r.blocked; });
    if (!picked.length) return;
    btn.disabled = true;
    showErr("");
    try {
      var out = await api({ formType: "adminVolInterestsAdd", rows: picked, source: state.source, allowDuplicates: true });
      $("viReview").hidden = true;
      $("viDone").hidden = false;
      $("viDoneTitle").textContent = out.added + " volunteer interest" + (out.added === 1 ? "" : "s") + " added";
      var ul = $("viSkipped");
      ul.textContent = "";
      (out.skipped || []).forEach(function (s) {
        var li = document.createElement("li");
        li.textContent = "Skipped " + (s.name || "row " + s.row) + ": " + s.reason;
        ul.appendChild(li);
      });
      $("viText").value = "";
      toast(out.added + " added");
      loadList();
    } catch (e) { showErr(e.message); btn.disabled = false; }
  });

  function reset() {
    state.rows = [];
    $("viReview").hidden = true;
    $("viDone").hidden = true;
    showErr("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $("viCancel").addEventListener("click", reset);
  $("viAgain").addEventListener("click", reset);

  /* ───────── recently added ───────── */
  async function loadList() {
    var body = $("viList");
    try {
      var out = await api({ formType: "adminGet", type: "volInterests", limit: 50 });
      // Nothing added yet: the whole section stays out of sight.
      $("viRecent").hidden = !out.items.length;
      if (!out.items.length) return;
      $("viTotal").textContent = out.total ? "(" + out.total + " in all)" : "";
      body.textContent = "";
      out.items.forEach(function (r) {
        var tr = document.createElement("tr");
        [String(r.timestamp || "").replace("T", " ").slice(0, 16), r.name, r.whatsapp, r.area, r.status, r.added_by].forEach(function (v) {
          var td = document.createElement("td");
          td.textContent = v || "";
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
    } catch (e) {
      // Could not load: show the reason rather than hiding a problem.
      $("viRecent").hidden = false;
      body.innerHTML = '<tr><td colspan="6" class="vi-empty"></td></tr>';
      body.querySelector("td").textContent = e.message;
    }
  }

  /* ───────── add manually (drawer) ───────── */
  var drawer = $("viDrawer");
  var drawerHead = $("viDrawerHead");
  var backdrop = $("viBackdrop");
  var lastFocus = null;
  var dupAck = false;
  var isOpen = false;
  var motion = { raf: 0, pos: 0, vel: 0 };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* The drawer arrives from, and leaves to, the same edge: the right on a wide screen, the bottom on a phone. */
  function axis() { return window.matchMedia("(max-width: 600px)").matches ? "y" : "x"; }
  function extent() { return (axis() === "x" ? drawer.offsetWidth : drawer.offsetHeight) || 1; }

  function renderDrawer() {
    var p = motion.pos;
    drawer.style.transform = axis() === "x" ? "translate3d(" + p + "px,0,0)" : "translate3d(0," + p + "px,0)";
    backdrop.style.opacity = String(1 - Math.min(1, Math.max(0, p / extent())));
  }

  /* A spring that always starts from where the drawer is now, with the speed it has now, so it can be grabbed
     and turned around at any moment. damping 1 = settles without bounce; below 1 it overshoots a little. */
  function springTo(target, velocity, damping, response, done) {
    cancelAnimationFrame(motion.raf);
    if (reduceMotion.matches) { motion.pos = target; motion.vel = 0; renderDrawer(); if (done) done(); return; }
    var k = Math.pow((2 * Math.PI) / response, 2);
    var c = 2 * damping * Math.sqrt(k);
    motion.vel = velocity || 0;
    var last = performance.now();
    function step(now) {
      var dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      var n = Math.max(1, Math.ceil(dt * 240));
      var h = dt / n;
      for (var i = 0; i < n; i++) {
        motion.vel += (-k * (motion.pos - target) - c * motion.vel) * h;
        motion.pos += motion.vel * h;
      }
      renderDrawer();
      if (Math.abs(motion.pos - target) < 0.3 && Math.abs(motion.vel) < 5) {
        motion.pos = target; motion.vel = 0; renderDrawer();
        if (done) done();
        return;
      }
      motion.raf = requestAnimationFrame(step);
    }
    motion.raf = requestAnimationFrame(step);
  }

  function openDrawer() {
    if (!isOpen) {
      lastFocus = document.activeElement;
      resetForm();
      motion.pos = extent();
      renderDrawer();
      backdrop.hidden = false;
      drawer.style.visibility = "visible";
      drawer.setAttribute("aria-hidden", "false");
      isOpen = true;
    }
    springTo(0, motion.vel, 1, 0.4);
    setTimeout(function () { if (isOpen) $("mName").focus({ preventScroll: true }); }, 160);
  }

  function hideDrawer() {
    drawer.style.visibility = "hidden";
    drawer.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    isOpen = false;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  function closeDrawer(velocity) {
    if (!isOpen) return;
    springTo(extent(), velocity || motion.vel, 1, 0.35, hideDrawer);
  }

  /* Dragging the header moves the drawer 1:1 with the pointer. Pulling the wrong way resists (rubber band).
     On release the throw is projected forward: where it would come to rest decides whether it closes. */
  function rubberband(over, dim) { return (over * dim * 0.55) / (dim + 0.55 * Math.abs(over)); }
  var drag = null;
  drawerHead.addEventListener("pointerdown", function (e) {
    if (e.target.closest("button")) return;
    cancelAnimationFrame(motion.raf);
    drawerHead.setPointerCapture(e.pointerId);
    var a = axis();
    var start = a === "x" ? e.clientX : e.clientY;
    drag = { a: a, start: start, base: motion.pos, samples: [{ t: e.timeStamp, p: start }] };
  });
  drawerHead.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var cur = drag.a === "x" ? e.clientX : e.clientY;
    var raw = drag.base + (cur - drag.start);
    motion.pos = raw < 0 ? -rubberband(-raw, extent()) : raw;
    renderDrawer();
    drag.samples.push({ t: e.timeStamp, p: cur });
    if (drag.samples.length > 6) drag.samples.shift();
  });
  function endDrag(e) {
    if (!drag) return;
    var s = drag.samples;
    var first = s[0];
    var lastS = s[s.length - 1];
    var v = lastS.t > first.t && e.timeStamp - lastS.t < 100 ? ((lastS.p - first.p) / (lastS.t - first.t)) * 1000 : 0;
    drag = null;
    var projected = motion.pos + ((v / 1000) * 0.99) / (1 - 0.99);
    if (projected > extent() / 2) springTo(extent(), v, 1, 0.35, hideDrawer);
    else springTo(0, v, 0.8, 0.35);
  }
  drawerHead.addEventListener("pointerup", endDrag);
  drawerHead.addEventListener("pointercancel", endDrag);

  window.addEventListener("resize", function () { if (!isOpen) { motion.pos = extent(); renderDrawer(); } });
  motion.pos = extent();
  renderDrawer();

  /* Tab stays inside the open drawer. */
  drawer.addEventListener("keydown", function (e) {
    if (e.key !== "Tab") return;
    var items = drawer.querySelectorAll("button:not([disabled]), input, textarea");
    if (!items.length) return;
    var first = items[0];
    var lastItem = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastItem.focus(); }
    else if (!e.shiftKey && document.activeElement === lastItem) { e.preventDefault(); first.focus(); }
  });

  /* A short confirmation when something was saved. */
  var toastTimer = 0;
  function toast(msg) {
    var el = $("viToast");
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-on"); }, 2400);
  }

  /* The header gets its hairline once the page scrolls beneath it. */
  window.addEventListener("scroll", function () { $("viHead").classList.toggle("is-scrolled", window.scrollY > 4); }, { passive: true });

  function formErr(msg) {
    var el = $("viFormErr");
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function resetForm() {
    $("viForm").reset();
    $("viExtras").textContent = "";
    dupAck = false;
    $("viSave").textContent = "Add";
    formErr("");
    clearValidation();
  }

  /* An extra field is a label and a value. The table has fixed columns, so extras are kept with the remarks as "Label: value". */
  function addExtra() {
    var row = document.createElement("div");
    row.className = "vi-extra";
    var label = document.createElement("input");
    label.type = "text";
    label.placeholder = "Field name";
    label.setAttribute("aria-label", "Field name");
    var value = document.createElement("input");
    value.type = "text";
    value.placeholder = "Value";
    value.setAttribute("aria-label", "Field value");
    var del = document.createElement("button");
    del.type = "button";
    del.className = "vi-icon-btn";
    del.setAttribute("aria-label", "Remove field");
    del.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener("click", function () { row.remove(); });
    row.appendChild(label);
    row.appendChild(value);
    row.appendChild(del);
    $("viExtras").appendChild(row);
    label.focus();
  }

  function manualRow() {
    var remarks = [$("mRemarks").value.trim()];
    $("viExtras").querySelectorAll(".vi-extra").forEach(function (r) {
      var inputs = r.querySelectorAll("input");
      var k = inputs[0].value.trim();
      var v = inputs[1].value.trim();
      if (k && v) remarks.push(k + ": " + v);
    });
    return {
      name: $("mName").value.trim(),
      whatsapp: $("mWhatsapp").value.trim(),
      area: $("mArea").value.trim(),
      ie_completion: normalizeIe($("mIe").value).value || "",
      vol_type: $("mVolType").value,
      availability: $("mAvailability").value,
      profession: $("mProfession").value,
      skill: $("mSkill").value.trim(),
      volunteer_remarks: remarks.filter(Boolean).join(" | "),
    };
  }

  /* ───────── manual form validation ───────── */
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* "May 2024", "may-2024", "5/2024", "May, 2024" -> "May 2024". Not in the future, not before 1990. */
  function normalizeIe(raw) {
    var t = String(raw || "").trim().toLowerCase().replace(/[,.]/g, " ").replace(/\s+/g, " ");
    if (!t) return { ok: true, value: "" };
    var m = t.match(/^([a-z]{3,9})[\s\-\/]*(\d{4})$/);
    var month = -1;
    var year = 0;
    if (m) {
      month = MONTHS.findIndex(function (x) { return m[1].indexOf(x.toLowerCase()) === 0; });
      year = parseInt(m[2], 10);
    } else {
      m = t.match(/^(\d{1,2})[\s\-\/](\d{4})$/);
      if (m) { month = parseInt(m[1], 10) - 1; year = parseInt(m[2], 10); }
    }
    if (month < 0 || month > 11 || !year) return { ok: false, msg: "Use a month and year, like May 2024." };
    var now = new Date();
    if (year < 1990 || year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth())) return { ok: false, msg: "That date is not possible. Check the year." };
    return { ok: true, value: MONTHS[month] + " " + year };
  }

  /* A mobile number: 10 digits starting 6-9, with or without +91 or a leading 0. */
  function phoneOk(raw) {
    var d = String(raw || "").replace(/\D/g, "");
    if (d.length === 12 && d.indexOf("91") === 0) d = d.slice(2);
    else if (d.length === 11 && d.charAt(0) === "0") d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d);
  }

  var RULES = {
    mName: { err: "eName", check: function (v) {
      v = v.trim();
      if (!v) return "Enter a name.";
      if (v.length < 2) return "The name is too short.";
      if (v.length > 80) return "The name is too long.";
      if (/^[\d\s+()-]+$/.test(v)) return "Enter a name, not a number.";
      return "";
    } },
    mWhatsapp: { err: "eWhatsapp", check: function (v) {
      v = v.trim();
      if (!v) return "Enter a WhatsApp number.";
      return phoneOk(v) ? "" : "Enter a 10-digit mobile number, like 98450 12345.";
    } },
    mArea: { err: "eArea", check: function (v) { return v.trim().length > 80 ? "That is too long." : ""; } },
    mIe: { err: "eIe", check: function (v) { var r = normalizeIe(v); return r.ok ? "" : r.msg; } },
    mSkill: { err: "eSkill", check: function (v) { return v.trim().length > 100 ? "That is too long." : ""; } },
    mRemarks: { err: "eRemarks", check: function (v) { return v.trim().length > 800 ? "Keep remarks under 800 characters." : ""; } },
  };

  function validateField(id) {
    var rule = RULES[id];
    var input = $(id);
    var msg = rule.check(input.value);
    var el = $(rule.err);
    el.textContent = msg;
    el.hidden = !msg;
    if (msg) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    return !msg;
  }

  function clearValidation() {
    Object.keys(RULES).forEach(function (id) {
      $(RULES[id].err).hidden = true;
      $(id).removeAttribute("aria-invalid");
    });
  }

  /* Checks every field; the first problem takes the focus. */
  function validateAll() {
    var firstBad = "";
    Object.keys(RULES).forEach(function (id) {
      if (!validateField(id) && !firstBad) firstBad = id;
    });
    if (firstBad) $(firstBad).focus();
    return !firstBad;
  }

  Object.keys(RULES).forEach(function (id) {
    // Tell the person when they leave a field; once a field shows an error, clear it as soon as it is fixed.
    $(id).addEventListener("blur", function () {
      if (id === "mIe") { var n = normalizeIe($(id).value); if (n.ok && n.value) $(id).value = n.value; }
      validateField(id);
    });
    $(id).addEventListener("input", function () { if ($(id).getAttribute("aria-invalid") === "true") validateField(id); });
  });

  async function saveManual(keepOpen) {
    var btns = [$("viSave"), $("viSaveNext")];
    formErr("");
    if (!validateAll()) return;
    btns.forEach(function (b) { b.disabled = true; });
    try {
      var checked = (await api({ formType: "adminVolInterestPreview", rows: [manualRow()] })).rows[0];
      if (checked.blocked) { formErr(checked.issues.join(". ") + "."); return; }
      if (checked.duplicate && !dupAck) {
        dupAck = true;
        $("viSave").textContent = "Add anyway";
        formErr("Already in the list. Add anyway?");
        return;
      }
      await api({ formType: "adminVolInterestsAdd", rows: [checked], source: "manual", allowDuplicates: true });
      loadList();
      toast("Added " + (checked.name || "volunteer"));
      if (keepOpen) { resetForm(); $("mName").focus(); } else closeDrawer();
    } catch (e) { formErr(e.message); } finally { btns.forEach(function (b) { b.disabled = false; }); }
  }

  $("viOpenDrawer").addEventListener("click", openDrawer);
  $("viCloseDrawer").addEventListener("click", function () { closeDrawer(); });
  backdrop.addEventListener("click", function () { closeDrawer(); });
  $("viAddField").addEventListener("click", addExtra);
  $("viSaveNext").addEventListener("click", function () { saveManual(true); });
  $("viForm").addEventListener("submit", function (e) { e.preventDefault(); saveManual(false); });
  // Editing after a "repeated" warning starts the check again.
  ["mName", "mWhatsapp"].forEach(function (id) {
    $(id).addEventListener("input", function () { if (dupAck) { dupAck = false; $("viSave").textContent = "Add"; formErr(""); } });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen) closeDrawer(); });

  if (!token()) $("viAuth").hidden = false;
  else { loadList(); loadConfig(); }
})();

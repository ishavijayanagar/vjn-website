/* Shared by the campaigns pages: signing in with the admin login, calling Sandesha, the words for a set of filters,
   the even split between callers, and a toast. */
(function () {
  var TOKEN_KEY = "vjn_admin_token";
  var STORE_KEY = "vjn_vd_filters"; // the Volunteers page remembers its filters here
  var VD = {};

  VD.$ = function (id) { return document.getElementById(id); };
  VD.token = function () {
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  };

  /* timeoutMs gives up after that long. An error carries .auth when the login has ended. */
  VD.api = async function (payload, timeoutMs) {
    var base = String(window.SANDESHA_API_URL || "").replace(/\/$/, "");
    var ctl = new AbortController();
    var timedOut = false;
    var timer = timeoutMs ? setTimeout(function () { timedOut = true; ctl.abort(); }, timeoutMs) : 0;
    var res;
    try {
      res = await fetch(base + "/vjn/api", { method: "POST", headers: { Authorization: "Bearer " + VD.token() }, body: JSON.stringify(payload), signal: ctl.signal });
    } catch (e) {
      throw new Error(e && e.name === "AbortError" && timedOut ? "That took too long. Try again in a minute." : "Sandesha is not reachable right now. Try again in a minute.");
    } finally { clearTimeout(timer); }
    var out = await res.json().catch(function () { return { error: "Sandesha replied HTTP " + res.status }; });
    if (res.status === 401) { var a = new Error("Please sign in again on the admin page."); a.auth = true; throw a; }
    if (!res.ok || out.error) throw new Error(out.error || "Something went wrong.");
    return out;
  };

  var toastTimer = 0;
  VD.toast = function (id, msg) {
    var el = VD.$(id);
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-on"); }, 2400);
  };

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  VD.monthWord = function (ymd) {
    var m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] : ymd;
  };
  VD.when = function (iso) {
    var m = String(iso || "").match(/^(\d{4}-\d{2}-\d{2})T?(\d{2}:\d{2})?/);
    return m ? VD.monthWord(m[1]) + (m[2] ? ", " + m[2] : "") : "";
  };

  VD.loadFilters = function () {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null") || {}; } catch (e) { return {}; }
  };

  /* What a set of filters was, in short phrases. `options` is the Volunteers page's filter list (names for ids), optional. */
  VD.summaryOf = function (f, options) {
    f = f || {};
    var o = options || {};
    var prog = { "": "General interests" };
    (o.programs || []).forEach(function (p) { prog[p.id] = p.title; });
    var src = {}; (o.sources || []).forEach(function (s) { src[s.key] = s.label; });
    var stage = {}; (o.stages || []).forEach(function (s) { stage[s.key] = s.label; });
    var out = [];
    (f.programs || []).forEach(function (id) { out.push(prog[id] !== undefined ? prog[id] : "Program " + id); });
    (f.stages || []).forEach(function (k) { out.push(stage[k] || k); });
    (f.sources || []).forEach(function (k) { out.push(src[k] || k); });
    function span(label, from, to) { return label + (from ? " from " + VD.monthWord(from) : "") + (to ? " to " + VD.monthWord(to) : ""); }
    if (f.program_from || f.program_to) out.push(span("Program", f.program_from, f.program_to));
    if (f.added_from || f.added_to) out.push(span("Added", f.added_from, f.added_to));
    if (f.area) out.push("Area: " + f.area);
    if (f.ie === "has") out.push("Has an IE date");
    if (f.ie === "none") out.push("No IE date");
    if (f.ie_from || f.ie_to) out.push("IE " + (f.ie_from || "…") + "–" + (f.ie_to || "…"));
    if (f.in_group === "yes") out.push("In the group");
    if (f.in_group === "no") out.push("Not in the group");
    if (f.attended && f.attended !== "any") out.push({ yes: "Marked present", no: "Marked absent", unmarked: "Not marked yet" }[f.attended] || f.attended);
    if (Number(f.min_checkins)) out.push("Checked in " + f.min_checkins + "+ times");
    if (f.search) out.push("Search: " + f.search);
    return out.length ? out : ["Everyone"];
  };

  /* The same even split the server makes: blocks in order, the first callers taking any extra. */
  VD.split = function (count, names) {
    var base = Math.floor(count / names.length);
    var extra = count % names.length;
    return names.map(function (n, i) { return { caller: n, count: base + (i < extra ? 1 : 0) }; });
  };

  /* A name's first letter, and one colour per caller, from the page's own palette. */
  VD.initial = function (name) { return String(name || "?").trim().charAt(0).toUpperCase() || "?"; };
  VD.COLORS = ["#4a3527", "#a8893e", "#7a8b6f", "#8a5a44", "#5f7a8a", "#9a7a9a"];
  VD.color = function (i) { return VD.COLORS[i % VD.COLORS.length]; };

  window.VD = VD;
})();

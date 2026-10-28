/* What the public pages read and send.

   Programs, volunteering and site text live in the Sandesha Pi's database
   (sandesha-server/). The Pi answers fast, so it is asked first; the Google
   Sheet holds a copy it keeps up to date, and Apps Script serves that copy if
   the Pi cannot be reached. A visitor's form goes the same way: to the Pi if
   it answers, otherwise to the Sheet (the Pi collects those rows when it is
   back).

   vjnPublic.get(type, id)  → the same JSON the Apps Script doGet returned
   vjnPublic.post(payload)  → resolves once either side has the form */
(function () {
  var TIMEOUT_MS = 4000;
  var BACKOFF_MS = 60 * 1000;
  var piDownUntil = 0;

  function piBase() {
    return String(window.SANDESHA_API_URL || "").replace(/\/$/, "");
  }

  function usePi() {
    return !!piBase() && Date.now() >= piDownUntil;
  }

  function timed(url, opts) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctl) ctl.abort();
    }, TIMEOUT_MS);
    var o = Object.assign({}, opts || {});
    if (ctl) o.signal = ctl.signal;
    return fetch(url, o).finally(function () {
      clearTimeout(timer);
    });
  }

  async function get(type, id, opts) {
    var qs = id ? "?id=" + encodeURIComponent(id) : "";
    var fresh = opts && opts.fresh ? (qs ? "&" : "?") + "t=" + Date.now() : "";
    if (usePi()) {
      try {
        var res = await timed(piBase() + "/public/" + type + qs + fresh);
        if (res.ok) return await res.json();
        if (res.status !== 404) throw new Error("HTTP " + res.status);
      } catch (e) {
        piDownUntil = Date.now() + BACKOFF_MS;
      }
    }
    var sheet = await fetch(APPS_SCRIPT_URL + "?type=" + type + (id ? "&id=" + encodeURIComponent(id) : "") + (opts && opts.fresh ? "&t=" + Date.now() : ""));
    return sheet.json();
  }

  async function post(payload) {
    var body = JSON.stringify(payload);
    if (usePi()) {
      try {
        var res = await timed(piBase() + "/public/submit", { method: "POST", body: body });
        if (res.ok) return await res.json();
        // 404: the Pi has not been given the Sheet's data yet — the Sheet takes it.
        if (res.status !== 404 && res.status < 500) throw new Error("HTTP " + res.status);
      } catch (e) {
        piDownUntil = Date.now() + BACKOFF_MS;
      }
    }
    return fetch(APPS_SCRIPT_URL, { method: "POST", body: body });
  }

  window.vjnPublic = { get: get, post: post };
})();

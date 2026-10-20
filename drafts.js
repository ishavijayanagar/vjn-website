/**
 * Draft keeper — what someone has typed survives the page being reloaded.
 *
 * Android Chrome throws away a background tab to save memory (opening the
 * gallery for a flyer, answering WhatsApp…) and reloads it from scratch on
 * return, so a half-filled form came back empty. Every field is saved to this
 * tab's sessionStorage as it changes, and put back on load.
 *
 * Static <form id> elements are covered on their own (opt out with
 * data-no-draft, or data-draft="manual" to register it yourself). A form that lives in a
 * pop-up registers itself so it can be reopened first:
 *
 *   DraftKeeper.watch("editor", {
 *     root: () => document.getElementById("editorOverlay"),
 *     isOpen: () => overlay.classList.contains("open"),
 *     meta: () => ({ id: editingId }),            // saved alongside the fields
 *     reopen: async (meta) => openEditor(…),      // before fields are filled
 *     restored: (meta) => {…},                    // after fields are filled
 *   });
 *   DraftKeeper.clear("editor");                  // on save, or when closed on purpose
 *
 * Passwords and file pickers are never stored; a draft that had a file chosen
 * says so, since the file has to be picked again. Drafts expire after 12 hours.
 */
(function () {
  "use strict";

  var PREFIX = "vjn-draft:" + location.pathname + ":";
  var MAX_AGE_MS = 12 * 60 * 60 * 1000;
  var SKIP_TYPES = /^(password|file|hidden|submit|button|reset|image)$/i;

  var scopes = {};
  var dirty = {};
  var saveTimer = null;
  var userTypedAt = 0;

  function store() {
    try {
      var s = window.sessionStorage;
      s.setItem("vjn-draft-probe", "1");
      s.removeItem("vjn-draft-probe");
      return s;
    } catch (e) {
      return null;
    }
  }

  function read(name) {
    var s = store();
    if (!s) return null;
    try {
      var d = JSON.parse(s.getItem(PREFIX + name) || "null");
      if (!d || !d.fields) return null;
      if (Date.now() - (d.at || 0) > MAX_AGE_MS) {
        s.removeItem(PREFIX + name);
        return null;
      }
      return d;
    } catch (e) {
      return null;
    }
  }

  function write(name, data) {
    var s = store();
    if (!s) return;
    try {
      s.setItem(PREFIX + name, JSON.stringify(data));
    } catch (e) { /* full — nothing to do */ }
  }

  function visible(el) {
    return !!(el && el.isConnected && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function fieldsOf(root) {
    var out = [];
    if (!root) return out;
    var seen = {};
    var els = root.querySelectorAll("input, textarea, select");
    for (var i = 0; i < els.length; i += 1) {
      var el = els[i];
      var key = keyOf(el, seen);
      if (key) out.push({ el: el, key: key });
    }
    return out;
  }

  function keyOf(el, seen) {
    if (el.hasAttribute("data-no-draft") || el.closest("[data-no-draft]")) return "";
    if (el.tagName === "INPUT" && SKIP_TYPES.test(el.type || "")) return "";
    if (/^(cc-|one-time-code|current-password|new-password)/.test(el.autocomplete || "")) return "";
    var base = el.id ? "#" + el.id : el.name ? "@" + el.name + (el.type === "radio" ? "=" + el.value : "") : "";
    if (!base) return "";
    // Same name more than once (rows of a list): number them in page order.
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] > 1 ? base + "~" + seen[base] : base;
  }

  function valueOf(el) {
    if (el.type === "checkbox" || el.type === "radio") return !!el.checked;
    if (el.tagName === "SELECT" && el.multiple) {
      return Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
    }
    return el.value;
  }

  function hasChosenFile(root) {
    var files = root ? root.querySelectorAll('input[type="file"]') : [];
    for (var i = 0; i < files.length; i += 1) {
      if (files[i].files && files[i].files.length) return true;
    }
    return false;
  }

  function isOpen(scope) {
    var root = scope.root();
    if (!root) return false;
    return scope.isOpen ? !!scope.isOpen() : visible(root);
  }

  function snapshot(name) {
    var scope = scopes[name];
    if (!scope || scope.restoring || !isOpen(scope)) return;
    var root = scope.root();
    var fields = fieldsOf(root).map(function (f) { return [f.key, valueOf(f.el)]; });
    if (!fields.length) return;
    var meta = null;
    try { meta = scope.meta ? scope.meta() : null; } catch (e) { meta = null; }
    write(name, {
      at: Date.now(),
      meta: meta,
      fields: fields,
      hadFile: hasChosenFile(root) || !!(meta && meta.hadFile),
    });
  }

  function flush() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    Object.keys(dirty).forEach(snapshot);
    dirty = {};
  }

  function onEdit(e) {
    if (e.isTrusted) userTypedAt = Date.now();
    var target = e.target;
    if (!target || !target.closest) return;
    Object.keys(scopes).forEach(function (name) {
      var root = scopes[name].root();
      if (root && root.contains(target)) dirty[name] = true;
    });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }

  function setValue(el, value) {
    if (el.type === "checkbox" || el.type === "radio") {
      if (el.checked === !!value) return true;
      el.checked = !!value;
    } else if (el.tagName === "SELECT" && el.multiple && Array.isArray(value)) {
      Array.prototype.forEach.call(el.options, function (o) { o.selected = value.indexOf(o.value) !== -1; });
    } else {
      if (el.value === value) return true;
      if (el.tagName === "SELECT") {
        var has = Array.prototype.some.call(el.options, function (o) { return o.value === value; });
        if (!has) return false; // options may still be loading
      }
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /** Fill saved values in page order; returns the keys still waiting for their field. */
  function apply(root, fields) {
    var byKey = {};
    fieldsOf(root).forEach(function (f) { byKey[f.key] = f.el; });
    var left = [];
    fields.forEach(function (pair) {
      var el = byKey[pair[0]];
      if (!el || !setValue(el, pair[1])) left.push(pair);
    });
    return left;
  }

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function restore(name) {
    var scope = scopes[name];
    var draft = read(name);
    if (!scope || !draft) return;
    scope.restoring = true;
    var started = Date.now();
    Promise.resolve()
      .then(function () { return scope.reopen ? scope.reopen(draft.meta || null) : null; })
      .then(function (ok) {
        if (ok === false) throw new Error("not restorable");
        return fillWithRetries(scope, draft.fields);
      })
      .then(function () {
        // Change handlers can refill fields a beat later (a picked title
        // loading its template). Put the draft back once more, unless the
        // person has started typing since.
        return wait(1500).then(function () {
          if (userTypedAt < started) apply(scope.root(), draft.fields);
        });
      })
      .then(function () {
        scope.restoring = false;
        try { if (scope.restored) scope.restored(draft.meta || null); } catch (e) { /* ignore */ }
        snapshot(name);
        notify(draft.hadFile);
      })
      .catch(function () {
        scope.restoring = false;
      });
  }

  function fillWithRetries(scope, fields) {
    var left = fields;
    var tries = 0;
    function step() {
      left = apply(scope.root(), left);
      tries += 1;
      if (!left.length || tries >= 20) return null;
      return wait(300).then(step);
    }
    return step();
  }

  function notify(hadFile) {
    var old = document.getElementById("draftToast");
    if (old) old.remove();
    var el = document.createElement("div");
    el.id = "draftToast";
    el.setAttribute("role", "status");
    el.textContent = hadFile
      ? "We kept what you were typing. Please attach the photo again."
      : "We kept what you were typing.";
    el.style.cssText = [
      "position:fixed", "left:50%", "bottom:calc(24px + env(safe-area-inset-bottom, 0px))",
      "transform:translateX(-50%)", "z-index:2147483000", "max-width:calc(100vw - 32px)",
      "padding:11px 16px", "border-radius:12px", "background:#1b1917", "color:#f7f4ee",
      "font:500 14px/1.35 system-ui,-apple-system,sans-serif", "box-shadow:0 10px 30px rgba(0,0,0,.25)",
      "text-align:center", "pointer-events:none", "opacity:0", "transition:opacity .2s ease",
    ].join(";");
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = "1"; });
    setTimeout(function () {
      el.style.opacity = "0";
      setTimeout(function () { el.remove(); }, 300);
    }, hadFile ? 6000 : 4000);
  }

  function watch(name, options) {
    if (!name || !options || typeof options.root !== "function") return;
    var first = !scopes[name];
    scopes[name] = {
      root: options.root,
      isOpen: options.isOpen,
      meta: options.meta,
      reopen: options.reopen,
      restored: options.restored,
      restoring: false,
    };
    if (first) restore(name);
  }

  function clear(name) {
    delete dirty[name];
    var s = store();
    if (s) {
      try { s.removeItem(PREFIX + name); } catch (e) { /* ignore */ }
    }
  }

  /** Save now — e.g. right before opening the camera or a file picker. */
  function saveNow(name) {
    if (name) snapshot(name);
    else Object.keys(scopes).forEach(snapshot);
  }

  function has(name) {
    return !!read(name);
  }

  document.addEventListener("input", onEdit, true);
  document.addEventListener("change", onEdit, true);
  // The tab can be thrown away at any point after it goes to the background.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
  document.addEventListener("freeze", flush);

  // Plain forms on the page look after themselves. A form whose fields arrive
  // later (data-draft="manual") registers itself once they are there.
  function autoForms() {
    var forms = document.querySelectorAll('form[id]:not([data-no-draft]):not([data-draft="manual"])');
    Array.prototype.forEach.call(forms, function (form) {
      var name = "form:" + form.id;
      if (scopes[name]) return;
      watch(name, {
        root: function () { return document.getElementById(form.id); },
        isOpen: function () { return !!document.getElementById(form.id); },
      });
      form.addEventListener("submit", function () {
        // Let the page's own submit handler read the values first.
        setTimeout(function () { clear(name); }, 0);
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoForms);
  else autoForms();

  window.DraftKeeper = { watch: watch, clear: clear, saveNow: saveNow, has: has };
})();

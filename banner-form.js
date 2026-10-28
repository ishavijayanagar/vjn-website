/* Homepage promo banner editor, shared by admin.html and admin-promotions.html.
   VjnBanner.mount(host, { token: () => string }) builds the form into host and loads
   the current banner. Saves through adminSaveSite; the image goes up via adminUploadImage. */
(function () {
  var MAX_EDGE = 1600;
  var TEXT_MAX = 120;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function driveId(url) {
    var m = String(url || "").match(/[?&]id=([\w-]+)|\/d\/([\w-]+)/);
    return m ? m[1] || m[2] : "";
  }

  function previewSrc(url) {
    if (!url || url.indexOf("data:") === 0) return url;
    var id = driveId(url);
    return id ? "https://drive.google.com/thumbnail?id=" + id + "&sz=w800" : url;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toLocalInput(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function fmt(d) {
    return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }

  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.round(w * scale);
        c.height = Math.round(h * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL("image/jpeg", 0.85);
        resolve({
          mimeType: "image/jpeg",
          filename: (file.name || "banner").replace(/\.[^.]+$/, "") + ".jpg",
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

  async function post(payload) {
    var data = window.PiPromos ? await window.PiPromos.route(payload) : undefined;
    if (data === undefined) {
      var res = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
      try {
        data = JSON.parse(await res.text());
      } catch (e) {
        throw new Error("Could not read the server response. Redeploy Apps Script and try again.");
      }
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  function mount(host, opts) {
    var token = opts.token;
    var imageUrl = "";
    var pending = null;

    host.innerHTML =
      '<form class="bf" novalidate>' +
      '<div class="bf-stage">' +
      '<label class="bf-drop" for="bfFile">' +
      '<img class="bf-img" alt="" hidden/>' +
      '<span class="bf-empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-5-5L5 21"/></svg><strong>Add flyer</strong><small>Tap to choose an image</small></span>' +
      '<span class="bf-replace" hidden>Replace</span>' +
      "</label>" +
      '<p class="bf-cap" hidden></p>' +
      '<input type="file" id="bfFile" accept="image/*" hidden/>' +
      "</div>" +
      '<div class="bf-card">' +
      '<label class="bf-row bf-switch"><span><strong>Show on homepage</strong><small class="bf-state"></small></span><input type="checkbox" class="bf-on"/><i aria-hidden="true"></i></label>' +
      "</div>" +
      '<div class="bf-card">' +
      '<div class="bf-field"><label for="bfLink">Registration link</label><input id="bfLink" type="url" inputmode="url" autocapitalize="off" autocomplete="off" placeholder="https://…"/></div>' +
      '<div class="bf-field"><label for="bfText">Line below flyer <em>optional</em></label><input id="bfText" type="text" maxlength="' + TEXT_MAX + '" placeholder="Last day to register: 20 Oct"/><small class="bf-count"></small></div>' +
      '<div class="bf-field"><label for="bfUntil">Open till</label><input id="bfUntil" type="datetime-local"/>' +
      '<div class="bf-chips" role="group" aria-label="Quick pick"><button type="button" data-days="0">Tonight</button><button type="button" data-days="3">3 days</button><button type="button" data-days="7">1 week</button><button type="button" data-days="14">2 weeks</button></div></div>' +
      "</div>" +
      '<p class="bf-err" role="alert"></p>' +
      '<div class="bf-bar"><span class="bf-msg" role="status"></span><button type="submit" class="bf-save">Save banner</button></div>' +
      "</form>";

    function $(sel) {
      return host.querySelector(sel);
    }
    var form = $(".bf"), fileEl = $("#bfFile"), imgEl = $(".bf-img"), capEl = $(".bf-cap");
    var onEl = $(".bf-on"), linkEl = $("#bfLink"), textEl = $("#bfText"), untilEl = $("#bfUntil");
    var errEl = $(".bf-err"), msgEl = $(".bf-msg"), saveEl = $(".bf-save");

    function setImage(url) {
      imageUrl = url || "";
      imgEl.hidden = !url;
      if (url) imgEl.src = previewSrc(url);
      $(".bf-empty").hidden = !!url;
      $(".bf-replace").hidden = !url;
    }

    function paintText() {
      var t = textEl.value.trim();
      capEl.textContent = t;
      capEl.hidden = !t;
      $(".bf-count").textContent = textEl.value.length ? textEl.value.length + "/" + TEXT_MAX : "";
    }

    function paintState() {
      var el = $(".bf-state");
      var until = untilEl.value ? new Date(untilEl.value) : null;
      form.classList.toggle("is-live", onEl.checked);
      if (!onEl.checked) el.textContent = "Hidden from visitors";
      else if (!until || isNaN(until)) el.textContent = "Set an end time";
      else if (until <= new Date()) el.textContent = "Expired — pick a later time";
      else el.textContent = "Live till " + fmt(until);
    }

    function clearMsg() {
      errEl.textContent = "";
      msgEl.textContent = "";
    }

    fileEl.addEventListener("change", async function () {
      var f = fileEl.files[0];
      if (!f) return;
      clearMsg();
      try {
        pending = await readImage(f);
        setImage(pending.preview);
      } catch (e) {
        errEl.textContent = e.message;
      }
    });
    [onEl, untilEl].forEach(function (el) {
      el.addEventListener("input", paintState);
    });
    textEl.addEventListener("input", paintText);
    $(".bf-chips").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var d = new Date();
      d.setDate(d.getDate() + Number(b.dataset.days));
      d.setHours(23, 59, 0, 0);
      untilEl.value = toLocalInput(d);
      paintState();
    });

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      clearMsg();
      var link = linkEl.value.trim();
      var until = untilEl.value ? new Date(untilEl.value) : null;
      if (onEl.checked && !imageUrl) return (errEl.textContent = "Add the flyer image first.");
      if (link && !/^https?:\/\//i.test(link)) return (errEl.textContent = "The link must start with http:// or https://");
      if (onEl.checked && (!until || isNaN(until))) return (errEl.textContent = "Set when the banner closes.");
      saveEl.disabled = true;
      try {
        var url = imageUrl;
        if (pending) {
          msgEl.textContent = "Uploading flyer…";
          var up = await post({ formType: "adminUploadImage", token: token(), base64: pending.base64, mimeType: pending.mimeType, filename: pending.filename });
          if (!up.url) throw new Error("Image upload failed.");
          url = up.url;
        }
        msgEl.textContent = "Saving…";
        await post({
          formType: "adminSaveSite",
          token: token(),
          content: {
            banner_enabled: onEl.checked ? "1" : "",
            banner_image: url,
            banner_link: link,
            banner_text: textEl.value.trim(),
            banner_until: until && !isNaN(until) ? until.toISOString() : "",
          },
        });
        pending = null;
        fileEl.value = "";
        setImage(url);
        msgEl.textContent = "Saved ✓ Visitors see it within a couple of minutes.";
      } catch (ex) {
        msgEl.textContent = "";
        errEl.textContent = ex.message || "Could not save.";
      } finally {
        saveEl.disabled = false;
      }
    });

    async function load() {
      clearMsg();
      try {
        var c = ((await window.vjnPublic.get("site", "", { fresh: true })) || {}).content || {};
        var d = c.banner_until ? new Date(c.banner_until) : null;
        onEl.checked = c.banner_enabled === "1";
        linkEl.value = c.banner_link || "";
        textEl.value = c.banner_text || "";
        untilEl.value = d && !isNaN(d) ? toLocalInput(d) : "";
        pending = null;
        fileEl.value = "";
        setImage(c.banner_image || "");
      } catch (e) {
        errEl.textContent = "Could not load the current banner.";
      }
      paintText();
      paintState();
    }

    load();
    return { reload: load };
  }

  window.VjnBanner = { mount: mount };
})();

(function () {
  var deferredInstallPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function textWithBreaks(str) {
    return escapeHtml(str).replace(/\n/g, "<br/>");
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

  function applyImage(el, url) {
    if (!url) return;
    const src = fixDriveUrl(url);
    if (el.tagName === "SOURCE") {
      el.setAttribute("srcset", src);
    } else if (el.tagName === "IMG") {
      el.referrerPolicy = "no-referrer";
      el.src = src;
    } else {
      el.style.backgroundImage = "url('" + src.replace(/'/g, "\\'") + "')";
    }
  }

  /* ---- Homepage promo banner (set in admin > Homepage banner) ---- */
  function showPromoBanner(c) {
    if (!document.body.classList.contains("home-page")) return;
    if (c.banner_enabled !== "1" || !c.banner_image) return;
    var until = new Date(c.banner_until);
    if (isNaN(until) || until.getTime() <= Date.now()) return;
    var key = "vjn_banner_closed:" + c.banner_image;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch (e) {}

    var id = driveFileId(c.banner_image);
    var src = id ? "https://drive.google.com/thumbnail?id=" + id + "&sz=w1200" : c.banner_image;
    var link = /^https?:\/\//i.test(c.banner_link || "") ? c.banner_link : "";

    var text = String(c.banner_text || "").trim();
    var overlay = document.createElement("div");
    overlay.className = "promo-banner";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Promotion");
    overlay.innerHTML =
      '<div class="promo-banner-card">' +
      '<button type="button" class="promo-banner-close" aria-label="Close">&times;</button>' +
      (link ? '<a class="promo-banner-link" target="_blank" rel="noopener"></a>' : '<span class="promo-banner-link"></span>') +
      '<p class="promo-banner-text"></p></div>';
    var holder = overlay.querySelector(".promo-banner-link");
    if (link) holder.href = link;
    var line = overlay.querySelector(".promo-banner-text");
    line.textContent = text;
    line.hidden = !text;
    var img = new Image();
    img.alt = "Promotion flyer";
    img.referrerPolicy = "no-referrer";
    img.onload = function () {
      holder.appendChild(img);
      document.body.appendChild(overlay);
      document.documentElement.classList.add("promo-banner-lock");
      requestAnimationFrame(function () { overlay.classList.add("open"); });
    };
    img.src = src;

    function close() {
      overlay.classList.remove("open");
      document.documentElement.classList.remove("promo-banner-lock");
      setTimeout(function () { overlay.remove(); }, 200);
      try { sessionStorage.setItem(key, "1"); } catch (e) {}
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest(".promo-banner-close")) close();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  async function applySiteContent() {
    if (typeof APPS_SCRIPT_URL === "undefined" || !APPS_SCRIPT_URL) return;
    try {
      const res = await fetch(APPS_SCRIPT_URL + "?type=site");
      const data = await res.json();
      const content = (data && data.content) || {};

      document.querySelectorAll("[data-site]").forEach(function (el) {
        const key = el.getAttribute("data-site");
        if (!key || content[key] === undefined || content[key] === "") return;
        if (el.getAttribute("data-site-mode") === "html") {
          el.innerHTML = textWithBreaks(content[key]);
        } else {
          el.textContent = content[key];
        }
      });

      // Keep tap-to-call links in step with an edited phone number.
      document.querySelectorAll("a[data-tel]").forEach(function (a) {
        const digits = a.textContent.replace(/[^\d+]/g, "");
        if (digits) a.href = "tel:" + digits;
      });

      showPromoBanner(content);

      document.querySelectorAll("[data-site-src]").forEach(function (el) {
        const key = el.getAttribute("data-site-src");
        if (!key || !content[key]) return;
        applyImage(el, content[key]);
      });
    } catch (err) {
      // Keep the HTML defaults if the sheet is unreachable.
    }
  }

  /* ---- Modal background scroll lock (all pages) ---- */
  var modalScrollY = 0;
  var modalScrollListenersBound = false;
  var modalTouchLastY = 0;

  function isVerticallyScrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    var style = window.getComputedStyle(el);
    var overflowY = style.overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll" && el.tagName !== "TEXTAREA") {
      return false;
    }
    return el.scrollHeight > el.clientHeight + 1;
  }

  function findModalScrollParent(target) {
    if (!target || !target.closest) return null;
    var node = target.nodeType === 3 ? target.parentElement : target;
    while (node && node !== document.body) {
      if (isVerticallyScrollable(node)) return node;
      if (node.classList && node.classList.contains("admin-editor")) break;
      if (node.classList && node.classList.contains("modal-overlay")) break;
      node = node.parentElement;
    }
    if (target.closest && target.closest(".admin-editor")) {
      var body = target.closest(".admin-editor-body");
      if (body && isVerticallyScrollable(body)) return body;
      return null;
    }
    return target.closest
      ? target.closest(".modal, .query-modal, .program-volunteer-modal, .mobile-menu")
      : null;
  }

  function canScrollFurther(el, deltaY) {
    if (!el || !deltaY) return false;
    if (!isVerticallyScrollable(el)) return false;
    var max = el.scrollHeight - el.clientHeight;
    if (deltaY < 0) return el.scrollTop > 0;
    return el.scrollTop < max - 1;
  }

  function anyOverlayOpen() {
    return (
      document.documentElement.classList.contains("nav-open") ||
      !!document.querySelector(
        ".modal-overlay.open, .program-volunteer-overlay.open"
      )
    );
  }

  function onModalTouchStart(e) {
    if (!document.documentElement.classList.contains("modal-scroll-locked")) return;
    if (!e.touches || !e.touches.length) return;
    modalTouchLastY = e.touches[0].clientY;
  }

  function onModalTouchMove(e) {
    if (!document.documentElement.classList.contains("modal-scroll-locked")) return;
    if (!e.touches || !e.touches.length) return;
    /* Block pinch-zoom while a modal is open. */
    if (e.touches.length > 1) {
      e.preventDefault();
      return;
    }
    var y = e.touches[0].clientY;
    var deltaY = modalTouchLastY - y;
    modalTouchLastY = y;
    var scrollParent = findModalScrollParent(e.target);
    if (scrollParent && canScrollFurther(scrollParent, deltaY)) return;
    e.preventDefault();
  }

  function onModalWheel(e) {
    if (!document.documentElement.classList.contains("modal-scroll-locked")) return;
    var scrollParent = findModalScrollParent(e.target);
    if (scrollParent && canScrollFurther(scrollParent, e.deltaY)) return;
    e.preventDefault();
  }

  function lockBodyForModal() {
    if (document.documentElement.classList.contains("modal-scroll-locked")) return;
    modalScrollY = window.scrollY || window.pageYOffset || 0;
    var scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.classList.add("modal-scroll-locked");
    document.body.style.position = "fixed";
    document.body.style.top = "-" + modalScrollY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    if (scrollbar > 0) {
      document.body.style.paddingRight = scrollbar + "px";
    }
    if (!modalScrollListenersBound) {
      document.addEventListener("touchstart", onModalTouchStart, { passive: true });
      document.addEventListener("touchmove", onModalTouchMove, { passive: false });
      document.addEventListener("wheel", onModalWheel, { passive: false });
      modalScrollListenersBound = true;
    }
  }

  function unlockBodyForModal() {
    if (!document.documentElement.classList.contains("modal-scroll-locked")) return;
    document.documentElement.classList.remove("modal-scroll-locked");
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    document.body.style.paddingRight = "";
    window.scrollTo(0, modalScrollY);
  }

  function syncModalScrollLock() {
    if (anyOverlayOpen()) lockBodyForModal();
    else unlockBodyForModal();
  }

  function initModalScrollLock() {
    syncModalScrollLock();
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === "attributes" && m.attributeName === "class") {
          var el = m.target;
          if (el === document.documentElement) {
            syncModalScrollLock();
            return;
          }
          if (
            el.classList &&
            (el.classList.contains("modal-overlay") ||
              el.classList.contains("program-volunteer-overlay"))
          ) {
            syncModalScrollLock();
            return;
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  function initMobileNav() {
    var toggle = document.querySelector(".nav-toggle");
    var menu = document.querySelector(".mobile-menu");
    var backdrop = document.querySelector("[data-nav-backdrop]");
    if (!toggle || !menu) return;

    function setOpen(on) {
      document.documentElement.classList.toggle("nav-open", !!on);
      toggle.setAttribute("aria-expanded", on ? "true" : "false");
      toggle.setAttribute("aria-label", on ? "Close menu" : "Open menu");
      menu.setAttribute("aria-hidden", on ? "false" : "true");
      if (backdrop) backdrop.setAttribute("aria-hidden", on ? "false" : "true");
      syncModalScrollLock();
    }

    toggle.addEventListener("click", function () {
      setOpen(!document.documentElement.classList.contains("nav-open"));
    });

    if (backdrop) {
      backdrop.addEventListener("click", function () {
        setOpen(false);
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.documentElement.classList.contains("nav-open")) {
        setOpen(false);
      }
    });

    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setOpen(false);
      });
    });

    var adminHold = menu.querySelector("[data-admin-longpress]");
    if (adminHold) {
      var holdTimer = null;
      var holdMs = 900;
      var openedAdmin = false;

      function clearHold() {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      }

      function clearSelection() {
        var sel = window.getSelection && window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
      }

      function startHold(e) {
        openedAdmin = false;
        clearHold();
        clearSelection();
        if (e && e.cancelable) e.preventDefault();
        holdTimer = setTimeout(function () {
          openedAdmin = true;
          clearSelection();
          window.location.href = "admin.html";
        }, holdMs);
      }

      function cancelHold(e) {
        clearHold();
        clearSelection();
        if (openedAdmin && e && e.cancelable) e.preventDefault();
      }

      adminHold.addEventListener("touchstart", startHold, { passive: false });
      adminHold.addEventListener("touchend", cancelHold);
      adminHold.addEventListener("touchcancel", clearHold);
      adminHold.addEventListener("touchmove", clearHold, { passive: true });
      adminHold.addEventListener("mousedown", startHold);
      adminHold.addEventListener("mouseup", cancelHold);
      adminHold.addEventListener("mouseleave", clearHold);
      adminHold.addEventListener("selectstart", function (e) {
        e.preventDefault();
      });
      adminHold.addEventListener("contextmenu", function (e) {
        e.preventDefault();
      });
    }
  }

  function formatYmdLabel(ymd) {
    const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(ymd || "").trim();
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const month = months[parseInt(m[2], 10) - 1];
    if (!month) return String(ymd).trim();
    return parseInt(m[3], 10) + " " + month + " " + m[1];
  }

  function listingDateLabel(item) {
    if (!item) return "";
    const startRaw = (item.startdate || item["start date"] || "").toString().trim();
    const endRaw = (item.enddate || item["end date"] || "").toString().trim();
    const startIso = (startRaw.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
    const endIso = (endRaw.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
    if (startIso && endIso && startIso !== endIso) {
      return formatYmdLabel(startIso) + " – " + formatYmdLabel(endIso);
    }
    if (endIso || startIso) return formatYmdLabel(endIso || startIso);
    return (item.date || "").toString().trim();
  }

  function formatHmAmPm(hm) {
    const m = String(hm || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return String(hm || "").trim();
    let h = parseInt(m[1], 10);
    const min = m[2];
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return h + ":" + min + " " + ap;
  }

  function formatSlotRange(slot) {
    if (!slot) return "";
    const a = formatHmAmPm(slot.start);
    const b = formatHmAmPm(slot.end);
    let range = "";
    if (a && b) range = a + " – " + b;
    else range = a || b || "";
    const label = String(slot.label || "").trim();
    if (label && range) return label + " " + range;
    return label || range || "";
  }

  function collectEventSlots(item) {
    if (!item) return [];
    if (item.slots && item.slots.length) {
      return item.slots.filter(function (s) {
        return s && (s.start || s.end || s.label);
      });
    }
    const slots = [];
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
    return slots;
  }

  /** Compact one-line (or joined) slots for cards. */
  function formatEventSlots(item) {
    const slots = collectEventSlots(item);
    if (slots.length) {
      return slots
        .map(formatSlotRange)
        .filter(Boolean)
        .join(" · ");
    }
    return (item && item.timings ? String(item.timings).trim() : "")
      .split(/\n+/)
      .map(function (l) {
        return l.trim();
      })
      .filter(Boolean)
      .join(" · ");
  }

  /** Array of slot label strings for detail page rows. */
  function formatEventSlotLines(item) {
    const slots = collectEventSlots(item);
    if (slots.length) {
      return slots.map(formatSlotRange).filter(Boolean);
    }
    const raw = item && item.timings ? String(item.timings).trim() : "";
    if (!raw) return [];
    return raw
      .split(/\n+/)
      .map(function (l) {
        return l.trim();
      })
      .filter(Boolean);
  }

  window.listingDateLabel = listingDateLabel;
  window.formatYmdLabel = formatYmdLabel;
  window.formatEventSlots = formatEventSlots;
  window.formatEventSlotLines = formatEventSlotLines;

  function isStandaloneApp() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function showPwaHelp(ios) {
    var existing = document.getElementById("pwaHelpOverlay");
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.id = "pwaHelpOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "pwaHelpTitle");
    overlay.innerHTML =
      '<div class="pwa-help-card">' +
        '<button type="button" class="modal-close" data-pwa-close aria-label="Close">✕</button>' +
        '<h2 id="pwaHelpTitle">Install this app</h2>' +
        (ios
          ? '<ol class="pwa-help-steps">' +
              '<li>Tap the <strong>Share</strong> button in Safari.</li>' +
              '<li>Scroll and tap <strong>Add to Home Screen</strong>.</li>' +
              '<li>Tap <strong>Add</strong>.</li>' +
            '</ol>'
          : '<p>Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</p>') +
        '<button type="button" class="btn btn-outline" data-pwa-close>Close</button>' +
      '</div>';

    function closeHelp() {
      overlay.remove();
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest("[data-pwa-close]")) closeHelp();
    });
    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", onEsc);
        closeHelp();
      }
    });
    document.body.appendChild(overlay);
  }

  function initPwa() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
      // When a new service worker takes over (a fresh deploy activated), the
      // page already loaded is still running on old, possibly-stale logic.
      // Reload once so it picks up the new one — but never under someone who
      // has started typing: that would wipe a half-filled form. They get the
      // new version on their next page load instead.
      var swRefreshing = false;
      var typedSinceLoad = false;
      // First visit: the worker taking control is not a new version, and
      // the page is already current, so don't pay for a second load.
      var hadController = !!navigator.serviceWorker.controller;
      document.addEventListener("input", function () { typedSinceLoad = true; }, true);
      document.addEventListener("change", function () { typedSinceLoad = true; }, true);
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (swRefreshing || typedSinceLoad || !hadController) return;
        swRefreshing = true;
        window.location.reload();
      });
    }
    if (isStandaloneApp()) return;

    var footer = document.querySelector(".footer-bottom");
    if (!footer) return;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pwa-install-btn";
    btn.textContent = "Install app";
    footer.appendChild(btn);

    window.addEventListener("appinstalled", function () {
      deferredInstallPrompt = null;
      btn.remove();
      var help = document.getElementById("pwaHelpOverlay");
      if (help) help.remove();
    });

    btn.addEventListener("click", function () {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.finally(function () {
          deferredInstallPrompt = null;
        });
        return;
      }
      showPwaHelp(isIosDevice());
    });
  }

  /* ---- Share (native share sheet, else copy link + toast) ---- */
  function showToast(msg) {
    var el = document.getElementById("siteToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "siteToast";
      el.className = "site-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }
  window.showToast = showToast;

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy") ? resolve() : reject(); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  window.shareLink = function (opts) {
    var url = new URL(opts.url, window.location.href).href;
    var data = { title: opts.title || document.title, text: opts.text || "", url: url };
    if (navigator.share) {
      return navigator.share(data).catch(function (err) {
        if (err && err.name === "AbortError") return; // user closed the sheet
        return copyText(url).then(function () { showToast("Link copied"); });
      });
    }
    return copyText(url).then(
      function () { showToast("Link copied"); },
      function () { window.prompt("Copy this link", url); }
    );
  };

  window.beginPageLoad = function () {
    if (document.body && document.body.classList.contains("home-page")) return;
    document.documentElement.classList.add("is-page-loading");
    document.documentElement.setAttribute("aria-busy", "true");
  };

  window.endPageLoad = function () {
    document.documentElement.classList.remove("is-page-loading");
    document.documentElement.removeAttribute("aria-busy");
  };

  /**
   * Section-level loading, for pages that fill in piece by piece: while
   * `work` (a promise) runs, `el` is marked busy and its controls are greyed
   * out and unclickable (style.css `[data-loading]`); everything outside it
   * stays usable. Overlapping loads on the same section: the latest wins.
   */
  window.sectionLoading = function (el, work) {
    if (!el || !work || typeof work.then !== "function") return work;
    const seq = (el._loadSeq || 0) + 1;
    el._loadSeq = seq;
    el.setAttribute("data-loading", "");
    el.setAttribute("aria-busy", "true");
    const done = function () {
      if (el._loadSeq !== seq) return;
      el.removeAttribute("data-loading");
      el.removeAttribute("aria-busy");
    };
    work.then(done, done);
    return work;
  };

  async function boot() {
    // Wire up the page first: the site-content call below goes to Apps Script
    // and takes ~2s, and the menu must not wait for it.
    initModalScrollLock();
    initMobileNav();
    initPwa();
    initPullToRefresh();
    try {
      await applySiteContent();
    } catch (err) {
      // Keep HTML defaults if the sheet is unreachable.
    } finally {
      if (!document.body || !document.body.hasAttribute("data-wait-load")) {
        endPageLoad();
      }
    }
  }

  /* Pages register their own loader; anything that doesn't just re-pulls the
     shared site content. */
  let pageRefresh = null;
  window.registerRefresh = function (fn) {
    if (typeof fn === "function") pageRefresh = fn;
  };

  function initPullToRefresh() {
    if (!window.PullToRefresh) return;
    // admin.js installs its own screen-aware handler; two would double-refresh.
    if (document.body && document.body.classList.contains("admin-page")) return;
    window.PullToRefresh.init({
      scroller: window,
      onRefresh: function () {
        // Don't pull the whole page out from under an open modal.
        if (anyOverlayOpen()) return Promise.resolve();
        return Promise.resolve(
          pageRefresh ? pageRefresh() : applySiteContent()
        );
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

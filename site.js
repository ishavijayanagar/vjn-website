(function () {
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

  function collectEventSlots(item) {
    if (!item) return [];
    if (item.slots && item.slots.length) {
      return item.slots.filter(function (s) {
        return s && (s.start || s.end);
      });
    }
    const slots = [];
    if (item.starttime || item.endtime) {
      slots.push({ start: item.starttime || "", end: item.endtime || "" });
    }
    if (item.starttime2 || item.endtime2) {
      slots.push({ start: item.starttime2 || "", end: item.endtime2 || "" });
    }
    return slots;
  }

  function formatSlotRange(slot) {
    if (!slot) return "";
    const a = formatHmAmPm(slot.start);
    const b = formatHmAmPm(slot.end);
    if (a && b) return a + " – " + b;
    return a || b || "";
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

  window.beginPageLoad = function () {
    document.documentElement.classList.add("is-page-loading");
    document.documentElement.setAttribute("aria-busy", "true");
  };

  window.endPageLoad = function () {
    document.documentElement.classList.remove("is-page-loading");
    document.documentElement.removeAttribute("aria-busy");
  };

  async function boot() {
    try {
      await applySiteContent();
    } catch (err) {
      // Keep HTML defaults if the sheet is unreachable.
    } finally {
      if (!document.body || !document.body.hasAttribute("data-wait-load")) {
        endPageLoad();
      }
    }
    initModalScrollLock();
    initMobileNav();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/* Pull to refresh — shared across every page.
 *
 * Touch only, and only ever engages when the scroller is already at the top, so
 * it never competes with normal scrolling. Horizontal gestures (the promotions
 * row swipe) axis-lock away from it. Chrome on Android has its own native pull
 * to refresh, which is suppressed via overscroll-behavior-y in CSS so the two
 * can't both fire.
 *
 * Usage:
 *   PullToRefresh.init({
 *     scroller: window | Element,   // what actually scrolls
 *     content:  Element | null,     // optional: follows the finger. Never pass
 *                                   // an ancestor of a position:fixed element,
 *                                   // a transform on it becomes their containing
 *                                   // block and drags them along too.
 *     onRefresh: function () { return Promise; }
 *   });
 */
(function (global) {
  "use strict";

  var COMMIT = 68; // pull past this and it refreshes
  var REST = 56; // where the indicator parks while refreshing
  var MAX = 104; // damping kicks in past here
  var RESIST = 0.5; // finger travel -> pull travel, before damping

  var SPIN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
    '<path d="M12 3a9 9 0 1 1-9 9"/></svg>';

  function reduced() {
    return !!(
      global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function isWindowScroller(s) {
    return s === global || s === document || s === document.documentElement || s === document.body;
  }

  function scrollTopOf(s) {
    if (isWindowScroller(s)) {
      return global.scrollY || document.documentElement.scrollTop || 0;
    }
    return s.scrollTop || 0;
  }

  function init(opts) {
    opts = opts || {};
    var onRefresh = opts.onRefresh;
    if (typeof onRefresh !== "function") return null;

    var scroller = opts.scroller || global;
    var events = isWindowScroller(scroller) ? document : scroller;
    var content = opts.content || null;
    var mount = opts.mount || (isWindowScroller(scroller) ? document.body : scroller.parentNode);

    var el = document.createElement("div");
    el.className = "ptr";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = '<span class="ptr-circle">' + SPIN + "</span>";
    mount.appendChild(el);

    var live = document.createElement("span");
    live.className = "ptr-live";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    mount.appendChild(live);

    var startY = 0;
    var pull = 0;
    var tracking = false; // finger down at the top, not yet committed to an axis
    var pulling = false; // committed: this is a downward pull
    var busy = false;
    var touchId = null;

    function render(y, animate) {
      var p = Math.max(0, Math.min(1, y / COMMIT));
      el.style.transition = animate
        ? "transform 240ms cubic-bezier(0.23,1,0.32,1), opacity 200ms cubic-bezier(0.23,1,0.32,1)"
        : "none";
      el.style.transform = "translate3d(-50%," + y + "px,0) scale(" + (0.9 + p * 0.1) + ")";
      el.style.opacity = String(Math.min(1, y / 24));
      if (!busy) {
        // Only spin the glyph with the drag; once refreshing, CSS owns it.
        el.style.setProperty("--ptr-rotate", p * 270 + "deg");
      }
      el.classList.toggle("is-armed", y >= COMMIT);
      if (content) {
        content.style.transition = el.style.transition;
        content.style.transform = y ? "translate3d(0," + y * 0.5 + "px,0)" : "";
      }
    }

    function reset(animate) {
      pull = 0;
      render(0, animate !== false);
    }

    function finish() {
      busy = false;
      el.classList.remove("is-refreshing");
      reset(true);
      live.textContent = "";
    }

    function commit() {
      busy = true;
      el.classList.add("is-refreshing");
      el.classList.remove("is-armed");
      live.textContent = "Refreshing";
      render(REST, true);

      var done = false;
      var settle = function () {
        if (done) return;
        done = true;
        // Hold the spinner briefly so a fast refresh doesn't just blink.
        global.setTimeout(finish, 260);
      };

      var out;
      try {
        out = onRefresh();
      } catch (e) {
        settle();
        return;
      }
      if (out && typeof out.then === "function") {
        out.then(settle, settle);
        // Never leave the spinner stuck if a request hangs.
        global.setTimeout(settle, 12000);
      } else {
        settle();
      }
    }

    events.addEventListener(
      "touchstart",
      function (e) {
        if (busy || e.touches.length !== 1) return;
        // The scroll-lock technique pins body position:fixed with a negative
        // top offset, which reports window.scrollY as 0 while any modal is
        // open — indistinguishable from "really at the top of the page" to
        // scrollTopOf() below. Without this guard, pulling down at the top
        // of a modal's own content (e.g. a form) both fights that modal's
        // scrolling and can fire a background refresh underneath it.
        if (document.documentElement.classList.contains("modal-scroll-locked")) return;
        // Bottom drawers (admin) scroll their own content; a downward drag inside
        // one must never be taken as a page pull-to-refresh.
        if (document.documentElement.classList.contains("bsheet-lock")) return;
        if (scrollTopOf(scroller) > 0) return;
        var t = e.touches[0];
        touchId = t.identifier;
        startY = t.clientY;
        tracking = true;
        pulling = false;
      },
      { passive: true }
    );

    events.addEventListener(
      "touchmove",
      function (e) {
        if (!tracking || busy) return;
        // A second finger mid-gesture would make the pull jump.
        if (e.touches.length !== 1 || e.touches[0].identifier !== touchId) {
          tracking = false;
          pulling = false;
          reset(true);
          return;
        }
        var dy = e.touches[0].clientY - startY;

        if (!pulling) {
          if (dy <= 0) {
            // Scrolling up/away — hand it back to the browser.
            tracking = false;
            return;
          }
          if (dy < 8) return; // wait for intent
          if (scrollTopOf(scroller) > 0) {
            tracking = false;
            return;
          }
          pulling = true;
        }

        if (dy <= 0) {
          pulling = false;
          reset(true);
          return;
        }

        // Stop the page scrolling (and Chrome's native PTR) while we own it.
        if (e.cancelable) e.preventDefault();

        var y = dy * RESIST;
        if (y > MAX) y = MAX + (y - MAX) * 0.25; // friction, not a wall
        pull = y;
        render(y, false);
      },
      { passive: false }
    );

    function end() {
      if (!tracking) return;
      tracking = false;
      touchId = null;
      if (!pulling) return;
      pulling = false;
      if (pull >= COMMIT) commit();
      else reset(true);
    }

    events.addEventListener("touchend", end, { passive: true });
    events.addEventListener("touchcancel", end, { passive: true });

    reset(false);

    return {
      refresh: function () {
        if (!busy) commit();
      },
      destroy: function () {
        events.removeEventListener("touchend", end);
        events.removeEventListener("touchcancel", end);
        if (el.parentNode) el.parentNode.removeChild(el);
        if (live.parentNode) live.parentNode.removeChild(live);
      }
    };
  }

  global.PullToRefresh = { init: init, reduced: reduced };
})(window);

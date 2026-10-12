(function () {
  // Home is usable from first paint; don't lock nav/buttons while sheet content loads.
  if (!(document.body && document.body.classList.contains("home-page"))) {
    document.documentElement.classList.add("is-page-loading");
  }

  function isProtectedTarget(el) {
    if (!el) return false;
    if (el.closest && el.closest("input, textarea, select, [contenteditable='true']")) {
      return false;
    }
    return !!(el.closest && (el.closest("img") || el.tagName === "IMG" || el.closest("picture")));
  }

  document.addEventListener(
    "contextmenu",
    function (e) {
      if (isProtectedTarget(e.target)) e.preventDefault();
    },
    { capture: true }
  );

  document.addEventListener(
    "dragstart",
    function (e) {
      if (isProtectedTarget(e.target) || (e.target && e.target.tagName === "IMG")) {
        e.preventDefault();
      }
    },
    { capture: true }
  );

  document.addEventListener(
    "selectstart",
    function (e) {
      if (
        e.target &&
        e.target.closest &&
        e.target.closest("input, textarea, select, [contenteditable='true'], [data-selectable]")
      ) {
        return;
      }
      e.preventDefault();
    },
    { capture: true }
  );
})();

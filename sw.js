const CACHE_NAME = "isha-vjn-v182";
// Only unversioned files here: pages ask for "style.css?v=…" and each of
// those is cached the first time it is fetched (see the fetch handler).
const PRECACHE = [
  "./",
  "./index.html",
  "./programs.html",
  "./volunteering.html",
  "./detail.html",
  "./admin.html",
  "./admin-promotions.html",
  "./admin-messaging.html",
  "./config.js",
  "./public-data.js",
  "./whatsapp-validate.js",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/sadhguru-hero.jpg",
  "./assets/sg.jpg",
  "./assets/signature-40159.png"
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "static.sadhguru.org"];
// A page waits this long for the network before falling back to its cached copy.
const NAV_TIMEOUT_MS = 3000;

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(
        PRECACHE.map(function (url) {
          return cache.add(url).catch(function () {});
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key !== CACHE_NAME;
        }).map(function (key) {
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type !== "NOTIFY_QUERY" && data.type !== "NOTIFY_PROMO") return;
  var isPromo = data.type === "NOTIFY_PROMO";
  event.waitUntil(
    self.registration.showNotification(data.title || (isPromo ? "Time to share" : "New query"), {
      body: data.body || (isPromo ? "A promotion is due." : "A new query was submitted."),
      icon: "assets/icon-192.png",
      badge: "assets/icon-192.png",
      tag: data.tag || (isPromo ? "vjn-promo-due" : "vjn-new-query"),
      renotify: true,
      data: {
        url: data.url || (isPromo ? "admin-promotions.html" : "admin.html#queries"),
        type: isPromo ? "promo" : "query",
      },
    })
  );
});

// Classify a notification's target page from its url: "promo" (admin-promotions.html),
// "sandesha" (admin-messaging.html), or "admin" (admin.html — queries/volunteering).
function vjnNotifyKind(url) {
  var u = String(url || "");
  if (u.indexOf("admin-promotions") !== -1) return "promo";
  if (u.indexOf("admin-messaging") !== -1) return "sandesha";
  return "admin";
}

// Web Push from the Sandesha server (job results, scheduled-send heads-ups,
// and Apps Script's attendance reminders relayed via /push/notify-internal).
self.addEventListener("push", function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (err) { d = {}; }
  event.waitUntil(
    self.registration.showNotification(d.title || "Sandesha", {
      body: d.body || "",
      icon: "assets/icon-192.png",
      badge: "assets/icon-192.png",
      tag: d.tag || "sandesha",
      renotify: true,
      data: {
        url: d.url || "admin-messaging.html",
        kind: d.kind || "",
        corrId: d.corrId || "",
        type: vjnNotifyKind(d.url),
      },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var payload = event.notification.data || {};
  var url = payload.url || "";
  var kind = payload.type || vjnNotifyKind(url);
  var isPromo = kind === "promo";
  var isSandesha = kind === "sandesha";
  var isVolunteering = !isPromo && !isSandesha && url.indexOf("#volunteering") !== -1;
  var target = url || (isPromo ? "admin-promotions.html" : isSandesha ? "admin-messaging.html" : "admin.html#queries");
  var matchPart = isPromo ? "admin-promotions.html" : isSandesha ? "admin-messaging.html" : "admin.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if (client.url.indexOf(matchPart) !== -1 && "focus" in client) {
          if (!isPromo && !isSandesha) {
            client.postMessage({ type: isVolunteering ? "OPEN_VOLUNTEERING" : "OPEN_QUERIES" });
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

function putInCache(request, res) {
  if (!res || !(res.ok || res.type === "opaque")) return Promise.resolve();
  var copy = res.clone();
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.put(request, copy);
  });
}

/* Pages: network first so a deploy shows up straight away, but give up after
   NAV_TIMEOUT_MS and show the cached copy instead of a blank screen. */
function networkFirst(event) {
  var request = event.request;
  var network = fetch(request).then(function (res) {
    event.waitUntil(putInCache(request, res));
    return res;
  });
  var timeout = new Promise(function (resolve) {
    setTimeout(resolve, NAV_TIMEOUT_MS);
  }).then(function () {
    return caches.match(request);
  });
  return Promise.race([
    network.catch(function () { return null; }),
    timeout,
  ]).then(function (res) {
    if (res) return res;
    // Timed out with nothing cached, or the network failed: keep waiting on
    // the network, then fall back to any cached copy, then the home page.
    return network.catch(function () {
      return caches.match(request).then(function (cached) {
        return cached || caches.match("./index.html");
      });
    });
  });
}

/* Scripts, styles, images, fonts: answer from cache at once and refresh the
   copy in the background (stale-while-revalidate). A file changed without a
   new ?v= shows up on the next load; bumping ?v= shows it immediately. */
function staleWhileRevalidate(event) {
  var request = event.request;
  return caches.match(request).then(function (cached) {
    var network = fetch(request).then(function (res) {
      return putInCache(request, res).then(function () {
        return res;
      });
    });
    if (cached) {
      event.waitUntil(network.catch(function () {}));
      return cached;
    }
    return network.catch(function () {
      return Response.error();
    });
  });
}

/* Web fonts never change at a given URL, so cache them for good. */
function cacheFirst(event) {
  var request = event.request;
  return caches.match(request).then(function (cached) {
    return cached || fetch(request).then(function (res) {
      event.waitUntil(putInCache(request, res));
      return res;
    });
  });
}

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var url;
  try {
    url = new URL(event.request.url);
  } catch (err) {
    return;
  }
  if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(event));
    return;
  }
  // Apps Script, the Sandesha API and other hosts always go to the network.
  if (url.origin !== self.location.origin) return;
  // Local dev server: always fresh, so an edit shows on the very next reload.
  if (/^(localhost|127\.0\.0\.1|192\.168\.|10\.|100\.)/.test(url.hostname)) return;

  var isNavigation = event.request.mode === "navigate" || event.request.destination === "document";
  event.respondWith(isNavigation ? networkFirst(event) : staleWhileRevalidate(event));
});


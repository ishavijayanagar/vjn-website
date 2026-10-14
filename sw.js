const CACHE_NAME = "isha-vjn-v161";
const PRECACHE = [
  "./",
  "./index.html",
  "./programs.html",
  "./volunteering.html",
  "./detail.html",
  "./admin-promotions.html",
  "./admin-messaging.html",
  "./admin-promotions.css?v=promo-cta",
  "./admin-promotions.js?v=promo-search",
  "./admin-messaging.css?v=1",
  "./sandesha/css/embedded.css?v=5",
  "./style.css?v=inquiry-card-redesign-v1",
  "./site.js?v=home-nav",
  "./config.js",
  "./protect.js?v=selectable-v1",
  "./whatsapp-validate.js",
  "./ie-gate.js?v=1",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/sadhguru-hero.jpg",
  "./assets/sg.jpg",
  "./assets/signature-40159.png"
];

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

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var url;
  try {
    url = new URL(event.request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  var isNavigation = event.request.mode === "navigate" || event.request.destination === "document";

  event.respondWith(
    fetch(event.request)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(event.request).then(function (cached) {
          if (cached) return cached;
          // Only a page navigation should ever fall back to index.html —
          // an image/script/style with no cached copy must stay a failed
          // request, not silently become the wrong content type.
          return isNavigation ? caches.match("./index.html") : Response.error();
        });
      })
  );
});

const CACHE_NAME = "isha-vjn-v3";
const PRECACHE = [
  "./",
  "./index.html",
  "./programs.html",
  "./volunteering.html",
  "./detail.html",
  "./style.css?v=pwa-install",
  "./site.js?v=pwa-install",
  "./config.js",
  "./protect.js",
  "./whatsapp-validate.js",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
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
  if (data.type !== "NOTIFY_QUERY") return;
  event.waitUntil(
    self.registration.showNotification(data.title || "New query", {
      body: data.body || "A new query was submitted.",
      icon: "assets/icon-192.png",
      badge: "assets/icon-192.png",
      tag: data.tag || "vjn-new-query",
      renotify: true,
      data: { url: data.url || "admin.html#queries" },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "admin.html#queries";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if (client.url.indexOf("admin.html") !== -1 && "focus" in client) {
          client.postMessage({ type: "OPEN_QUERIES" });
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
          return cached || caches.match("./index.html");
        });
      })
  );
});

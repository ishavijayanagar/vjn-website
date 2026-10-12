/* Local preview stub — fakes the Sandesha API so the Promotions panels can be
   rendered without a server. Not part of the site; delete after review. */
(function () {
  var bits = (location.hash || "").replace("#", "").split(":");
  var mode = bits[0] || "";
  var scene = bits[1] || "";

  try {
    sessionStorage.setItem("vjn_admin_token", "dev-token");
    sessionStorage.setItem("vjn_admin_user", JSON.stringify({ name: "Dev", role: "promotions" }));
    if (mode) sessionStorage.setItem("promo_sandesha_mode", mode);
    else sessionStorage.removeItem("promo_sandesha_mode");
  } catch (e) {}

  function fire(el, type) {
    if (el) el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  if (scene) {
    setTimeout(function () {
      var aud = document.getElementById("pcAud");
      if (scene === "later") {
        var tab = document.querySelector('#pcMode [data-later="1"]');
        if (tab) tab.click();
      }
      if (scene === "emptygo") {
        var go = document.querySelector("[data-goto-compose]");
        if (go) go.click();
      }
      if (scene === "jump") {
        var day = document.querySelectorAll(".week button:not([disabled])")[1];
        if (day) day.click();
        setTimeout(function () {
          var sc = document.querySelector("#sandeshaSchedule");
          var pressed = sc.querySelector('[data-jump][aria-pressed="true"]');
          var keys = [].map.call(sc.querySelectorAll(".groupline[data-day]"), function (g) {
            return g.dataset.day;
          });
          document.title =
            "top=" + Math.round(sc.scrollTop) +
            " max=" + Math.round(sc.scrollHeight - sc.clientHeight) +
            " pressed=" + (pressed ? pressed.dataset.jump : "none") +
            " days=" + keys.join(",");
        }, 1200);
      }
      if (scene === "sheet" || scene === "filled" || scene === "later") {
        var ta = document.getElementById("pcMsg");
        if (ta) {
          ta.value =
            "Sadhguru's *Sunday satsang* is on at 6.30pm in the main hall.\n\nDoors close at 6.25 — come a few minutes early and we will find you a seat.";
          fire(ta, "input");
        }
        if (aud) aud.click();
      }
      if (scene === "filled" || scene === "later") {
        setTimeout(function () {
          var rows = document.querySelectorAll(".aud-row");
          if (rows[0]) rows[0].click();
          if (rows[2]) rows[2].click();
          var done = document.getElementById("promoAudDone");
          if (done) done.click();
        }, 500);
      }
    }, 1600);
  }

  var now = Date.now();
  function at(hoursFromNow, hour, min) {
    var d = new Date(now + hoursFromNow * 3600000);
    if (hour != null) d.setHours(hour, min || 0, 0, 0);
    return d.toISOString();
  }


  function ymd(offset) {
    var d = new Date(now + (offset || 0) * 86400000);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  var PROMOS = [
    {
      id: "p1", status: "sent", send_at: ymd(0) + " 09:15", sent_at: "09:18",
      event_title: "Morning Hatha Yoga", event_location: "Main hall",
      message: "Morning Hatha starts at 6.30. Mats are provided, come ten minutes early.",
      event_open: true, flyer_url: "assets/logo.png"
    },
    {
      id: "p2", status: "due", send_at: ymd(0) + " 13:00",
      event_title: "Isha Kriya session", event_location: "Vijayanagar",
      message: "Free Isha Kriya guided session at 5pm today. Nothing to bring, just come.",
      event_open: true, flyer_url: "assets/logo.png"
    },
    {
      id: "p3", status: "ready", send_at: ymd(0) + " 17:30",
      event_title: "Sunday satsang", event_location: "Satsang group",
      target: JSON.stringify([
        { type: "group", label: "Isha Sadhguru Satsang", value: "g1@g.us" },
        { type: "set", label: "Weekend crowd", value: "Weekend crowd" }
      ]),
      wa_schedule_ids: "s1,s2",
      message: "Sadhguru's satsang is on at 6.30pm in the main hall. Doors close at 6.25.",
      event_open: true, flyer_url: "assets/logo.png"
    },
    {
      id: "p4", status: "ready", send_at: ymd(0) + " 20:00",
      event_title: "Angamardana batch", event_location: "Yoga batch",
      message: "Last day to register for the Angamardana batch starting Monday.",
      event_open: true, flyer_url: "assets/logo.png"
    },
    {
      id: "p5",
      status: "ready",
      send_at: scene === "posted" ? ymd(0) + " 00:05" : ymd(1) + " 10:00",
      event_title: "Volunteer cleanup", event_location: "Volunteers",
      target: JSON.stringify([{ type: "set", label: "Weekend crowd", value: "Weekend crowd" }]),
      wa_schedule_ids: "s5",
      message: "Volunteers needed for the Saturday cleanup — reply if you can make it.",
      event_open: true, flyer_url: "assets/logo.png"
    },
    {
      id: "p6", status: "pending", send_at: "",
      event_title: "Isha Vidhya parents meet", event_location: "Parents group",
      message: "", event_open: true, flyer_url: "assets/logo.png"
    }
  ];

  var GROUPS = [
    { jid: "g1@g.us", name: "Isha Sadhguru Satsang", participants: 214, type: "group" },
    { jid: "g2@g.us", name: "Vijayanagar Volunteers", participants: 128, type: "group" },
    { jid: "g3@g.us", name: "Yoga Batch Announcements", participants: 64, announcement: true },
    { jid: "g4@g.us", name: "Isha Vidhya Parents", participants: 96, type: "group" },
    { jid: "g5@g.us", name: "Bhava Spandana Alumni", participants: 41, type: "group" }
  ];

  var ROUTES = {
    "/auth/vjn-exchange": { token: "sandesha-dev", role: "promotions", user: { name: "Dev" } },
    "/health": { ok: true, whatsapp: { connected: true, state: "open" } },
    "/groups": GROUPS,
    "/sets": { sets: { "Weekend crowd": ["Isha Sadhguru Satsang", "Vijayanagar Volunteers"] } },
    "/contacts": { contacts: { "Anitha R.": "919876543210", "Suresh K.": "919812345678", "Radhika S.": "919363802383" } },
    "/contacts/search": function (q) {
      var needle = (q || "").toLowerCase();
      var all = [
        { name: "Anitha R.", phone: "919876543210" },
        { name: "Suresh K.", phone: "919812345678" },
        { name: "Radhika S.", phone: "919363802383" }
      ];
      return {
        results: all.filter(function (c) {
          return c.name.toLowerCase().indexOf(needle) !== -1 || c.phone.indexOf(needle.replace(/\D/g, "")) !== -1;
        })
      };
    },
    "/chats": { chats: [{ jid: "919876543210@s.whatsapp.net", name: "Anitha R.", isGroup: false }] },
    "/schedules": {
      schedules: (scene.indexOf("empty") === 0 || scene === "posted") ? [] : [
        {
          id: "s1",
          runAt: at(4),
          target: "g1@g.us",
          isSet: false,
          filePath: "/media/upload_dev.jpg",
          sourceId: "p3",
          message: "Evening satsang starts at 6.30 in the main hall. Doors close at 6.25 — please come a few minutes early."
        },
        {
          id: "s2",
          runAt: at(20, 8, 0),
          target: "Weekend crowd",
          isSet: true,
          filePath: "/media/upload_dev.jpg",
          sourceId: "p3",
          message: "Sunday Hatha Yoga is on from 7am. Bring a mat if you have one, we have spares otherwise."
        },
        {
          id: "s3",
          runAt: at(30, 19, 0),
          target: "g3@g.us",
          isSet: false,
          filePath: "/media/upload_dev.jpg",
          message: "Last day to register for the *Angamardana* batch starting Monday. Reply YES and we will hold a place."
        },
        {
          id: "s4",
          runAt: at(76, 11, 0),
          target: "g4@g.us",
          isSet: false,
          message: "Isha Vidhya parents meeting moved to Tuesday 11am. Same room as last time."
        },
        {
          id: "s5",
          runAt: at(-2),
          target: "g2@g.us",
          isSet: false,
          message: "Volunteers needed for the Saturday cleanup — reply if you can make it."
        }
      ]
    }
  };

  var realFetch = window.fetch.bind(window);
  var fakeScheduleId = 900;

  /** Writes the board now makes against Sandesha when a post is scheduled. */
  function writeRoute(path, method) {
    if (path === "/upload" && method === "POST") {
      return { filePath: "/media/upload_dev.jpg", filename: "upload_dev.jpg" };
    }
    if (path === "/schedules" && method === "POST") {
      fakeScheduleId += 1;
      return { ok: true, schedule: { id: fakeScheduleId } };
    }
    if (/^\/schedules\/[^/]+$/.test(path) && method === "DELETE") return { ok: true };
    return null;
  }

  window.fetch = function (input, init) {
    var url = String(typeof input === "string" ? input : (input && input.url) || "");
    var path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var written = writeRoute(path, method);
    if (written) {
      return Promise.resolve(
        new Response(JSON.stringify(written), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
    if (/^\/media\/[^/]+$/.test(path) && method === "GET") {
      return realFetch("assets/logo.png");
    }
    if (path === "/contacts/search" && method === "GET") {
      var qMatch = url.match(/[?&]q=([^&]+)/);
      var q = qMatch ? decodeURIComponent(qMatch[1].replace(/\+/g, " ")) : "";
      var searchPayload = typeof ROUTES["/contacts/search"] === "function"
        ? ROUTES["/contacts/search"](q)
        : ROUTES["/contacts/search"];
      return Promise.resolve(
        new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
    if (Object.prototype.hasOwnProperty.call(ROUTES, path)) {
      var routePayload = ROUTES[path];
      if (typeof routePayload === "function") routePayload = routePayload();
      return Promise.resolve(
        new Response(JSON.stringify(routePayload), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
    if (url.indexOf("script.google.com") !== -1) {
      var sent = null;
      try {
        sent = JSON.parse(String((init && init.body) || "{}"));
      } catch (e) {}
      if (sent && sent.formType === "adminMarkPromotionSent") {
        PROMOS.forEach(function (p) {
          if (String(p.id) === String(sent.id)) {
            p.status = "sent";
            p.sent_by = sent.source || "Dev";
            p.wa_schedule_ids = "";
          }
        });
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, items: scene === "empty" ? [] : PROMOS }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
    return realFetch(input, init);
  };
})();

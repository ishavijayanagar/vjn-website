/* Promotion posts live on the Sandesha Pi (sandesha-server/promos.js) for
   people signed in with a Pi login ("v1." token). This sends the same
   requests the pages already make — adminGet "promotions", adminSavePromotion
   and friends — to the Pi instead of Apps Script, and hands back the same
   shapes, so the pages need no other change.

   route(payload) resolves to the reply, or to undefined when the request is
   not one of these, the login is an older one, or the Pi has not been updated
   yet — the caller then goes to Apps Script as before. */
(function () {
  var WRITE_PATHS = {
    adminSavePromotion: "/vjn/promos/save",
    adminAddPromotion: "/vjn/promos/add",
    adminMarkPromotionSent: "/vjn/promos/mark-sent",
    adminUnmarkPromotionSent: "/vjn/promos/unmark-sent",
  };

  function base() {
    return String(window.SANDESHA_API_URL || "").replace(/\/$/, "");
  }

  function isPiToken(t) {
    return /^v1\./.test(String(t || ""));
  }

  async function call(path, token, body) {
    var opts = { headers: { Authorization: "Bearer " + token } };
    if (body) {
      opts.method = "POST";
      opts.body = JSON.stringify(body);
    }
    var res;
    try {
      res = await fetch(base() + path, opts);
    } catch (e) {
      throw new Error("Sandesha is offline — promotions need it. Try again in a minute.");
    }
    if (res.status === 404) return undefined;
    return res.json().catch(function () {
      return { error: "Sandesha replied HTTP " + res.status };
    });
  }

  async function route(payload) {
    var token = payload && payload.token;
    if (!isPiToken(token) || !base()) return undefined;
    var type = payload.formType;
    if (WRITE_PATHS[type]) {
      var body = Object.assign({}, payload);
      delete body.token;
      delete body.formType;
      return call(WRITE_PATHS[type], token, body);
    }
    if (type === "adminGet" && payload.type === "promotions") {
      return call("/vjn/promos" + (payload.due ? "?due=1" : ""), token);
    }
    if (type === "adminGet" && payload.type === "inviteMessages") {
      return call("/vjn/promos/invite-messages", token);
    }
    return undefined;
  }

  window.PiPromos = { route: route, isPiToken: isPiToken };
})();

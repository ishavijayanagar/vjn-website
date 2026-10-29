/* Promotion posts, programs, volunteering, site text, enquiries and event
   volunteers live on the Sandesha Pi (sandesha-server/) for people signed in
   with a Pi login ("v1." token). This sends the same requests the pages
   already make — adminGet "promotions", adminSaveItem and friends — to the Pi
   instead of Apps Script, and hands back the same shapes, so the pages need
   no other change. New photos are stored on the Pi. Google Forms, Slides
   flyers, and photos already on Drive stay where they are.

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

  // Handled by the Pi's copy of the admin API (POST /vjn/api).
  var API_WRITES = {
    adminSaveItem: 1, adminDeleteItem: 1, adminClearClosed: 1, adminSaveSite: 1, adminUpdateInquiry: 1,
    adminInquiriesAddedToGroup: 1, adminAddProgramTitle: 1, adminSaveVolunteerNeed: 1, adminAddEventVolunteer: 1,
    adminUpdateEventVolunteer: 1, adminDeleteEventVolunteer: 1, adminMarkVolunteersInGroup: 1, adminSetVolunteerForm: 1, adminSession: 1,
    adminUploadImage: 1,
  };
  var API_READS = { programs: 1, volunteering: 1, inquiries: 1, volunteerNeeds: 1, programTitles: 1 };
  var PROMO_READS = { promotions: 1, inviteMessages: 1 };

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

  /** The same request, answered by the Pi's copy of the Apps Script API. */
  async function callApi(payload) {
    var body = Object.assign({}, payload);
    delete body.token;
    var res;
    try {
      res = await fetch(base() + "/vjn/api", {
        method: "POST",
        headers: { Authorization: "Bearer " + payload.token },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return undefined; // Sandesha is unreachable: Apps Script answers from its copy (and refuses edits)
    }
    if (res.status === 404) return undefined;
    return res.json().catch(function () {
      return { error: "Sandesha replied HTTP " + res.status };
    });
  }

  /** True when the Pi answers this read (so a batch can be split). */
  function readsOnPi(type, token) {
    return isPiToken(token) && !!base() && !!(API_READS[type] || PROMO_READS[type]);
  }

  async function route(payload) {
    var token = payload && payload.token;
    if (!isPiToken(token) || !base()) return undefined;
    var type = payload.formType;
    if (API_WRITES[type] || (type === "adminGet" && API_READS[payload.type])) return callApi(payload);
    if (WRITE_PATHS[type]) {
      var body = Object.assign({}, payload);
      delete body.token;
      delete body.formType;
      return call(WRITE_PATHS[type], token, body);
    }
    if (type === "adminGet" && payload.type === "promotions") {
      var qs = [];
      if (payload.due) qs.push("due=1");
      if (payload.knownStamp) qs.push("known=" + encodeURIComponent(payload.knownStamp));
      return call("/vjn/promos" + (qs.length ? "?" + qs.join("&") : ""), token);
    }
    if (type === "adminGet" && payload.type === "inviteMessages") {
      return call("/vjn/promos/invite-messages", token);
    }
    return undefined;
  }

  window.PiPromos = { route: route, isPiToken: isPiToken, readsOnPi: readsOnPi };
})();

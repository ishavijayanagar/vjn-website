'use strict';

/**
 * The Pi's copy of the Apps Script admin API. The pages send the same
 * requests (formType + fields) here as they used to send to Apps Script, and
 * get the same replies, so the pages barely change. A formType not listed
 * here is not handled — the page then asks Apps Script as before.
 *
 * Also the public side: listings and site text for the website, and the
 * visitor forms (enquiries).
 */

const ROLES = {
  adminSaveItem: (d) => (String(d.resource || 'programs') === 'volunteering' ? ['admin', 'nurturing'] : ['admin', 'programs']),
  adminDeleteItem: (d) => (String(d.resource || 'programs') === 'volunteering' ? ['admin', 'nurturing'] : ['admin', 'programs']),
  adminClearClosed: (d) => (String(d.resource || 'programs') === 'volunteering' ? ['admin', 'nurturing'] : ['admin', 'programs']),
  adminSaveSite: () => ['admin', 'promotions'],
  adminUpdateInquiry: () => ['admin', 'nurturing'],
  adminInquiriesAddedToGroup: () => ['admin', 'nurturing'],
  adminAddProgramTitle: () => ['admin'],
  adminSaveVolunteerNeed: () => ['admin', 'nurturing'],
  adminAddEventVolunteer: () => ['admin', 'nurturing', 'programs'],
  adminUpdateEventVolunteer: () => ['admin', 'nurturing', 'programs'],
  adminDeleteEventVolunteer: () => ['admin', 'nurturing', 'programs'],
  adminMarkVolunteersInGroup: () => ['admin', 'nurturing'],
  // The page hands over the sign-up form Apps Script just made or connected.
  adminSetVolunteerForm: () => ['admin', 'nurturing'],
  // The team adds general volunteering interests (pasted, from a file, or read from a photo).
  adminVolInterestsAdd: () => ['admin', 'nurturing'],
  // Only an admin decides whether photos may be sent to the AI service.
  adminVolInterestsAiSet: () => ['admin'],
  // The volunteers data page: a Google Sheet made from the filtered people (a campaign, or a full export).
  adminVolunteerCampaign: () => ['admin', 'nurturing'],
  adminVolunteerCampaignClose: () => ['admin', 'nurturing'],
  adminVolunteerSheetExport: () => ['admin', 'nurturing'],
};

const PUBLIC_FORMS = ['homeQuery', 'programInterest', 'programVolunteer', 'volunteeringInterest', 'volunteerAttendance'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createVjnApi({ listings, content, inquiries, ev, volInterests = null, volunteersData = null, roster = null, notify = null, audit = null, ready = () => true }) {
  function need(session, roles) {
    if (!roles.includes(session.role)) throw new HttpError(403, 'You do not have access to this.');
  }

  /** adminGet types served here, with who may read them. */
  const READS = {
    programs: { roles: ['admin', 'programs', 'promotions'], run: (d) => (d.id ? listings.get('programs', d.id, { includeHidden: true }) : listings.list('programs', { includeHidden: true })) },
    volunteering: { roles: ['admin', 'nurturing'], run: (d) => (d.id ? listings.get('volunteering', d.id, { includeHidden: true }) : listings.list('volunteering', { includeHidden: true })) },
    inquiries: { roles: ['admin', 'nurturing'], run: (d) => {
      if (String(d.group || '').trim()) return inquiries.group(String(d.group).trim());
      const meta = inquiries.meta();
      if (d.knownStamp && String(d.knownStamp) === String(meta.stamp || '')) return { stamp: meta.stamp, unchanged: true };
      return meta;
    } },
    volunteerNeeds: { roles: ['admin', 'nurturing', 'programs'], run: () => ev.needs() },
    programTitles: { roles: ['admin', 'programs'], run: () => ({ titles: content.titles() }) },
    volInterests: { roles: ['admin', 'nurturing'], run: (d) => (volInterests ? volInterests.list(d.limit) : undefined) },
    volunteerFilters: { roles: ['admin', 'nurturing'], run: () => (volunteersData ? volunteersData.options() : undefined) },
    volunteerData: { roles: ['admin', 'nurturing'], run: (d) => (volunteersData ? volunteersData.query(d.filters) : undefined) },
    volunteerSheets: { roles: ['admin', 'nurturing'], run: (d) => (volunteersData ? volunteersData.campaigns(d.limit) : undefined) },
    volInterestsConfig: { roles: ['admin', 'nurturing'], run: () => (volInterests ? volInterests.config() : undefined) },
    volunteerRoster: { roles: ['admin', 'nurturing'], run: () => (roster ? roster.read() : undefined) },
  };

  function read(session, data) {
    const spec = READS[String(data.type || '')];
    if (!spec) return undefined;
    need(session, spec.roles);
    return spec.run(data);
  }

  /** Returns the reply, or undefined when this formType is not handled here
   * (or the Sheet's data has not been copied in yet — see scripts/import-data.js). */
  function admin(session, data) {
    const out = adminInner(session, data);
    // A change that went through is recorded: who, what, which item.
    if (audit && out !== undefined && ROLES[String(data.formType || '')]) audit(session, String(data.formType), data);
    return out;
  }

  function adminInner(session, data) {
    const type = String(data.formType || '');
    // Who is signed in: answered here whether or not the data has moved, so the page opens without a trip to Apps Script.
    if (type === 'adminSession') {
      return { user: { id: session.id, username: session.username, displayName: session.displayName || session.username, role: session.role } };
    }
    if (!ready()) return undefined;
    if (type === 'adminGet') return read(session, data);
    if (type === 'adminGetMany') {
      const reads = Array.isArray(data.reads) ? data.reads.slice(0, 12) : [];
      return {
        results: reads.map((r) => {
          try {
            const out = read(session, r);
            return out === undefined ? { error: 'Unknown type' } : out;
          } catch (err) {
            return { error: err.message };
          }
        }),
      };
    }
    // New photos live on this Pi. No public address yet means the page still
    // uploads to Drive, the way it always has.
    if (type === 'adminUploadImage') {
      const siteMedia = require('./site-media');
      const base = String(data.publicBase || siteMedia.publicBase() || '').replace(/\/$/, '');
      if (!base) return undefined;
      need(session, ['admin', 'programs', 'promotions', 'nurturing']);
      let saved;
      try {
        saved = siteMedia.saveImage(data);
      } catch (err) {
        throw new HttpError(err.status || 400, err.message);
      }
      return { success: true, url: `${base}/public/media/${saved.name}`, fileId: saved.name };
    }
    // Previews change nothing; they only read what was pasted or photographed.
    if (type === 'adminVolInterestPreview' && volInterests) {
      need(session, ['admin', 'nurturing']);
      return volInterests.preview(data);
    }
    // Reading a photo calls an AI service, so this answers later (a promise).
    if (type === 'adminVolInterestExtract' && volInterests) {
      need(session, ['admin', 'nurturing']);
      return volInterests.previewImage(data);
    }
    const roles = ROLES[type];
    if (!roles) return undefined;
    need(session, roles(data));

    switch (type) {
      case 'adminSaveItem': {
        const out = listings.save(String(data.resource || 'programs'), data.id ? String(data.id).trim() : '', data.item || {});
        return { success: true, id: out.id };
      }
      case 'adminDeleteItem':
        listings.remove(String(data.resource || 'programs'), data.id);
        return { success: true };
      case 'adminClearClosed':
        return { success: true, deleted: listings.clearClosed(String(data.resource || 'programs')).deleted };
      case 'adminSaveSite':
        content.saveSite(data.content || {});
        return { success: true };
      case 'adminUpdateInquiry':
        return inquiries.update(data);
      case 'adminInquiriesAddedToGroup':
        return inquiries.addedToGroup(data);
      case 'adminAddProgramTitle':
        return { success: true, titles: content.addTitle(data.title) };
      case 'adminSaveVolunteerNeed':
        return ev.saveNeed(session, data);
      case 'adminAddEventVolunteer':
        return ev.addVolunteer(session, data);
      case 'adminUpdateEventVolunteer':
        return ev.updateVolunteer(data);
      case 'adminDeleteEventVolunteer':
        return ev.deleteVolunteer(data);
      case 'adminMarkVolunteersInGroup':
        return ev.markInGroup(data);
      case 'adminSetVolunteerForm':
        return ev.setForm(session, data.needs);
      case 'adminVolunteerCampaign':
        return volunteersData ? volunteersData.createCampaign(session, data) : undefined;
      case 'adminVolunteerCampaignClose':
        return volunteersData ? volunteersData.closeCampaign(session, data) : undefined;
      case 'adminVolunteerSheetExport':
        return volunteersData ? volunteersData.exportSheet(session, data) : undefined;
      case 'adminVolInterestsAiSet':
        if (!volInterests) return undefined;
        return volInterests.setAi(!!data.enabled);
      case 'adminVolInterestsAdd':
        if (!volInterests) return undefined;
        return volInterests.add(session, data);
      default:
        return undefined;
    }
  }

  function publicGet(type, id) {
    if (!ready()) return undefined;
    if (type === 'site') return content.site();
    if (type === 'programs' || type === 'volunteering') {
      return id ? listings.get(type, id, { includeHidden: false }) : listings.list(type, { includeHidden: false });
    }
    return undefined;
  }

  function publicSubmit(data) {
    if (!ready()) return undefined;
    const type = String(data.formType || '');
    if (!PUBLIC_FORMS.includes(type)) return undefined;
    if (type === 'volunteerAttendance') {
      // A check-in lives in event_vols only (marked on the volunteer's row, or added as a walk-in).
      const r = ev.checkIn(data);
      if (r.error) throw new HttpError(400, r.error);
      if (!r.matched && !r.added) throw new HttpError(400, 'A program and a phone number are required.');
      return { success: true };
    }
    inquiries.submit(type, data);
    // Tell Nurturing right away instead of waiting for the app to be opened.
    if (notify) {
      try {
        Promise.resolve(notify('nurturing', {
          title: 'New website enquiry',
          body: 'Someone just sent a message from the website.',
          url: 'admin.html#queries',
          tag: 'vjn-new-query',
          kind: 'inquiry',
          urgency: 'high',
        })).catch(() => {});
      } catch { /* a push failure must never fail the visitor's form */ }
    }
    return { success: true };
  }

  return { admin, publicGet, publicSubmit, HttpError, READS };
}

module.exports = { createVjnApi, HttpError, PUBLIC_FORMS };

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
};

const PUBLIC_FORMS = ['homeQuery', 'programInterest', 'programVolunteer', 'volunteeringInterest', 'volunteerAttendance'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createVjnApi({ listings, content, inquiries, ev, ready = () => true }) {
  function need(session, roles) {
    if (!roles.includes(session.role)) throw new HttpError(403, 'You do not have access to this.');
  }

  /** adminGet types served here, with who may read them. */
  const READS = {
    programs: { roles: ['admin', 'programs', 'promotions'], run: (d) => (d.id ? listings.get('programs', d.id, { includeHidden: true }) : listings.list('programs', { includeHidden: true })) },
    volunteering: { roles: ['admin', 'nurturing'], run: (d) => (d.id ? listings.get('volunteering', d.id, { includeHidden: true }) : listings.list('volunteering', { includeHidden: true })) },
    inquiries: { roles: ['admin', 'nurturing'], run: (d) => (String(d.group || '').trim() ? inquiries.group(String(d.group).trim()) : inquiries.meta()) },
    volunteerNeeds: { roles: ['admin', 'nurturing', 'programs'], run: () => ev.needs() },
    programTitles: { roles: ['admin', 'programs'], run: () => ({ titles: content.titles() }) },
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
    inquiries.submit(type, data);
    return { success: true };
  }

  return { admin, publicGet, publicSubmit, HttpError, READS };
}

module.exports = { createVjnApi, HttpError, PUBLIC_FORMS };

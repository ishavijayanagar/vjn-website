'use strict';

const ERROR_CODES = {
  default: 'An unknown error occurred while adding a participant',
  isGroupEmpty: "AddParticipantsError: The participant can't be added to an empty group",
  iAmNotAdmin: 'AddParticipantsError: You have no admin rights to add a participant to a group',
  /** Raised when one of WhatsApp's own modules throws; %s names the call. */
  internal: 'AddParticipantsError: WhatsApp rejected the call at %s',
  200: 'The participant was added successfully',
  400: 'WhatsApp rejected the add (not necessarily a rate limit — check rpc name in logs)',
  401: 'Not allowed to add this participant',
  403: 'The participant can be added by sending private invitation only',
  404: 'The phone number is not registered on WhatsApp',
  408: 'You cannot add this participant because they recently left the group',
  409: 'The participant is already a group member',
  412: 'Cannot add — linked community/group restriction',
  417: "The participant can't be added to the community. You can invite them privately to join this group through its invite link",
  419: "The participant can't be added because the group is full",
  429: 'Too many adds too fast — wait 15–30 minutes and retry',
  500: 'WhatsApp server error — try again later',
  /** Never came from WhatsApp — our call into their bundle threw. */
  599: 'Internal error talking to WhatsApp Web',
};

/** Participant code used when a WhatsApp Web internal threw instead of answering. */
const INTERNAL_CODE = 599;

/**
 * addParticipants, with three departures from whatsapp-web.js:
 *  - Chat.find is replaced by findOrCreateLatestChat (fixes findImpl errors).
 *  - participants are addressed as @lid or as phone wids to match the group's
 *    addressing mode, instead of always converting @lid back to a phone number.
 *  - every call into WhatsApp's bundle is named, so a TypeError from their code
 *    reports which call broke rather than a bare "reading 'id'".
 */
async function addParticipantsFixed(client, groupId, participantIds, options = {}) {
  const ids = Array.isArray(participantIds) ? participantIds : [participantIds];
  const opts = { ...options };
  if (opts.forceLidMode === undefined) {
    // Off by default — phone-wid addressing is what has always worked here.
    opts.forceLidMode = process.env.SANDESHA_ADD_MEMBERS_LID === '1';
  }
  return client.pupPage.evaluate(
    async (groupId, participantIds, options, errorCodes, internalCode) => {
      // WhatsApp's own modules throw bare TypeErrors when their bundle changes
      // shape, which surface as an unattributable "reading 'id'". Naming every
      // call we make into them turns that into an actionable message.
      const failures = [];
      const guard = async (name, fn) => {
        try {
          return await fn();
        } catch (err) {
          failures.push(`${name} — ${(err && err.message) || err}`);
          return undefined;
        }
      };
      const lastFailure = () => failures[failures.length - 1] || 'unknown call';
      const internalError = () => errorCodes.internal.replace('%s', lastFailure());
      const brokeSince = (count) => failures.length > count;

      const resolveChat = async (wid) => {
        let chat = await guard('Chat.get', () =>
          window.require('WAWebCollections').Chat.get(wid),
        );
        if (!chat) {
          const result = await guard('findOrCreateLatestChat', () =>
            window.require('WAWebFindChatAction').findOrCreateLatestChat(wid),
          );
          chat = result?.chat;
        }
        return chat;
      };

      /**
       * Address every participant as a phone wid for the add RPC.
       *
       * An earlier revision tried to match `group.groupMetadata.isLidAddressingMode`
       * and convert phone → @lid for LID-addressed groups. On this account that
       * made `getAddParticipantsRpcResult` answer a bare 400 for people who can
       * be added by hand in the app — freshly created groups now report
       * `isLidAddressingMode: true` but still expect the phone wid here. The
       * long-working behaviour is: only ever convert @lid → phone, never the
       * other way. Set SANDESHA_ADD_MEMBERS_LID=1 to opt back into @lid form.
       */
      const makeAddressableWid = (lidMode) => async (wid) => {
        if (!wid) return wid;
        const contactApi = window.require('WAWebApiContact');
        if (lidMode) {
          if (wid.server === 'lid') return wid;
          const lid = await guard('getCurrentLid', () => contactApi.getCurrentLid(wid));
          return lid || wid;
        }
        if (wid.server !== 'lid') return wid;
        const pn = await guard('getPhoneNumber', () => contactApi.getPhoneNumber(wid));
        return pn || wid;
      };

      const {
        sleep = [250, 500],
        autoSendInviteV4 = true,
        comment = '',
        // Runs every check and conversion but never sends the add RPC, so a
        // list can be validated without spending WhatsApp's add allowance.
        dryRun = false,
      } = options;
      const participantData = {};
      const groupWid = await guard('createWid(group)', () =>
        window.require('WAWebWidFactory').createWid(groupId),
      );
      if (!groupWid) return internalError();

      let mark = failures.length;
      const group = await resolveChat(groupWid);
      if (!group) return brokeSince(mark) ? internalError() : errorCodes.isGroupEmpty;

      mark = failures.length;
      await guard('queryAndUpdateGroupMetadataById', () =>
        window.require('WAWebGroupQueryJob').queryAndUpdateGroupMetadataById({ id: groupId }),
      );
      if (brokeSince(mark)) return internalError();

      mark = failures.length;
      const groupParticipants = await guard('groupMetadata.participants.serialize', () =>
        group.groupMetadata?.participants?.serialize?.(),
      );
      if (!groupParticipants?.length) {
        return brokeSince(mark) ? internalError() : errorCodes.isGroupEmpty;
      }

      if (typeof group.iAmAdmin === 'function') {
        const iAmAdmin = await guard('iAmAdmin', () => group.iAmAdmin());
        if (iAmAdmin === false) return errorCodes.iAmNotAdmin;
      }

      // Phone-wid addressing by default (see makeAddressableWid). Opt into
      // matching the group's LID mode only when explicitly forced.
      const toAddressableWid = makeAddressableWid(options.forceLidMode === true);

      mark = failures.length;
      const participantWids = [];
      for (const p of participantIds) {
        const wid = await guard('createWid(participant)', () =>
          window.require('WAWebWidFactory').createWid(p),
        );
        if (wid) participantWids.push(wid);
      }
      if (!participantWids.length) return brokeSince(mark) ? internalError() : errorCodes.default;

      const _getSleepTime = (sleepVal) => {
        if (!Array.isArray(sleepVal) || (sleepVal.length === 2 && sleepVal[0] === sleepVal[1])) {
          return sleepVal;
        }
        if (sleepVal.length === 1) return sleepVal[0];
        if (sleepVal[1] - sleepVal[0] < 100) {
          sleepVal[0] = sleepVal[1];
          sleepVal[1] += 100;
        }
        return Math.floor(Math.random() * (sleepVal[1] - sleepVal[0] + 1)) + sleepVal[0];
      };

      const isAlreadyMember = (pId) =>
        groupParticipants.some((p) => {
          const id = p.id?._serialized || p._serialized;
          return id === pId;
        });

      for (let i = 0; i < participantWids.length; i++) {
        const pId = participantWids[i]._serialized;
        const failuresBefore = failures.length;
        const pWid = await toAddressableWid(participantWids[i]);

        participantData[pId] = {
          code: undefined,
          message: undefined,
          isInviteV4Sent: false,
        };

        // Membership is recorded in the group's own addressing form, so compare
        // against the converted wid rather than whatever the caller passed in.
        if (isAlreadyMember(pWid?._serialized || pId)) {
          participantData[pId].code = 409;
          participantData[pId].message = errorCodes[409];
          continue;
        }

        const exists = await guard('queryWidExists', () =>
          window.require('WAWebQueryExistsJob').queryWidExists(pWid),
        );
        if (!exists?.wid) {
          const broke = failures.length > failuresBefore;
          participantData[pId].code = broke ? internalCode : 404;
          participantData[pId].message = broke ? internalError() : errorCodes[404];
          continue;
        }

        if (dryRun) {
          participantData[pId].dryRun = true;
          participantData[pId].addressedAs = pWid?._serialized || null;
          participantData[pId].message = 'Dry run — the add RPC was not sent';
          continue;
        }

        const rpcResult = await guard('getAddParticipantsRpcResult', () =>
          window.WWebJS.getAddParticipantsRpcResult(groupWid, pWid),
        );
        if (!rpcResult) {
          participantData[pId].code = internalCode;
          participantData[pId].message = internalError();
          continue;
        }
        const rpcResultCode = rpcResult.code;
        participantData[pId].code = rpcResultCode;
        participantData[pId].rpcName = rpcResult.name;
        participantData[pId].message = errorCodes[rpcResultCode] || errorCodes.default;
        if (rpcResult.name === 'IQErrorRateOverlimit' || rpcResultCode === 429) {
          participantData[pId].message = errorCodes[429];
        }

        if (autoSendInviteV4 && rpcResultCode === 403) {
          let isInviteV4Sent = false;
          await guard('Contact.gadd', () =>
            window.require('WAWebCollections').Contact.gadd(pWid, { silent: true }),
          );

          if (rpcResult.name === 'ParticipantRequestCodeCanBeSent') {
            const userChat = await resolveChat(pWid);
            if (userChat) {
              const groupName = group.formattedTitle || group.name;
              const res = await guard('sendGroupInviteMessage', async () =>
                window
                  .require('WAWebChatSendMessages')
                  .sendGroupInviteMessage(
                    userChat,
                    group.id._serialized,
                    groupName,
                    rpcResult.inviteV4Code,
                    rpcResult.inviteV4CodeExp,
                    comment,
                    await window.WWebJS.getProfilePicThumbToBase64(groupWid),
                  ),
              );
              isInviteV4Sent = res?.messageSendResult === 'OK';
            }
          }

          participantData[pId].isInviteV4Sent = isInviteV4Sent;
        }

        // A direct add that won't work for policy reasons — a bare 400 (no
        // error subname) after the number passed the "exists on WhatsApp"
        // check, a 403 where the private invite never actually went out, or a
        // 417 (community/invite-only). The caller should fall back to a
        // shareable group invite link. Rate limits (429 / IQErrorRateOverlimit)
        // are deliberately excluded — those mean "stop", not "use a link".
        const rateLimited =
          rpcResult.name === 'IQErrorRateOverlimit' || rpcResultCode === 429;
        const namelessReject = !rpcResult.name || rpcResult.name === 'IQError';
        if (
          !rateLimited &&
          ((rpcResultCode === 400 && namelessReject) ||
            (rpcResultCode === 403 && !participantData[pId].isInviteV4Sent) ||
            rpcResultCode === 417)
        ) {
          participantData[pId].inviteLinkNeeded = true;
        }

        if (sleep && i < participantWids.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, _getSleepTime(sleep)));
        }
      }

      return participantData;
    },
    groupId,
    ids,
    opts,
    ERROR_CODES,
    INTERNAL_CODE,
  );
}

/**
 * DM a shareable group invite link to someone a direct add couldn't reach.
 * Unlike an add RPC this is not rate-limited and carries no account risk —
 * the person taps the link and joins themselves.
 *
 * @returns {Promise<string>} the invite link that was sent
 */
async function sendGroupInviteLink(client, groupJid, toDigits, options = {}) {
  const group = await client.getChatById(groupJid);
  if (!group || typeof group.getInviteCode !== 'function') {
    throw new Error('Not a group, or invite links are unavailable');
  }
  const code = await group.getInviteCode();
  if (!code) throw new Error('Could not fetch the group invite link');
  const link = `https://chat.whatsapp.com/${code}`;
  const digits = String(toDigits || '').replace(/\D/g, '');
  if (digits.length < 10) throw new Error('Invalid number for invite link');
  const name = options.groupName || group.name || 'the group';
  const text =
    `> Namaskaram 🙏,\n` +
    `You've been invited to join *${name}*.\n` +
    `Tap to join: ${link}`;
  await client.sendMessage(`${digits}@c.us`, text);
  return link;
}

/** Just fetch the link, for a "copy invite link" button. */
async function getGroupInviteLink(client, groupJid) {
  const group = await client.getChatById(groupJid);
  if (!group || typeof group.getInviteCode !== 'function') {
    throw new Error('Not a group, or invite links are unavailable');
  }
  const code = await group.getInviteCode();
  if (!code) throw new Error('Could not fetch the group invite link');
  return `https://chat.whatsapp.com/${code}`;
}

module.exports = {
  addParticipantsFixed,
  sendGroupInviteLink,
  getGroupInviteLink,
  ERROR_CODES,
  INTERNAL_CODE,
};

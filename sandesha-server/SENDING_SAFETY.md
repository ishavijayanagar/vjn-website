# Sandesha — Sending Safety & Account Protection

How to keep the WhatsApp number Sandesha is linked to from being throttled,
disconnected, or banned.

This document covers **sending**. Adding people to groups is a separate action
with its own rate limits and a much lower daily ceiling — see
[ADDING_MEMBERS.md](ADDING_MEMBERS.md).

> **Read this first.** Sandesha drives WhatsApp Web through Puppeteer. That is an
> *unofficial client*, which WhatsApp's terms prohibit regardless of how politely
> it behaves. Nothing in this document makes Sandesha compliant. What it does is
> remove the *behavioural* signals — burst velocity, robotic timing, identical
> payloads, cold recipients — that actually cause enforcement in practice. The
> only sanctioned way to automate is the
> [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).
> See [The real fix](#12-the-real-fix) at the end.

---

## 1. What WhatsApp actually says

| Source | Relevant wording |
|--------|------------------|
| [Terms of Service](https://www.whatsapp.com/legal/terms-of-service) | Prohibits automated or bulk messaging and non-personal use of the consumer app |
| [Acceptable Use](https://www.whatsapp.com/legal/commerce-policy/) | Bans spam, unsolicited messages, and misuse of the service |
| [About linked devices](https://faq.whatsapp.com/378279804439436) | "Linking your account to an unofficial app or website, now or in the past, may result in a temporary or permanent account ban." |
| [Unauthorized use of WhatsApp](https://faq.whatsapp.com/5957850572559800) | Unofficial clients may be banned; official app is the only supported path |

Two mechanics from that page matter operationally:

- Linked devices are **automatically disconnected after 30 days of inactivity**.
- A linked device **logs out if the primary phone is unused for over 14 days**.

So the phone holding the account must stay in normal use, not sit in a drawer.

---

## 2. What actually gets accounts restricted

Enforcement is pattern-based, not rule-based. Ranked roughly by how strongly
each signal correlates with restriction:

1. **Recipient blocks and spam reports.** The single strongest signal. A block
   rate around 1–2% is the point where marketing sends should stop entirely.
2. **Messaging people who never saved your number.** Cold contact-graph distance
   is the biggest flag for one-to-one sends.
3. **Velocity.** Many messages in a short window, especially to distinct chats.
4. **Robotic timing.** A send exactly every 2000 ms is a machine fingerprint that
   no human produces. Fixed intervals are easier to detect than high volume.
5. **Identical payloads.** The same byte-for-byte text and media fanned out to
   many chats at once.
6. **One-way traffic.** Messages that never receive replies. Vendor reporting
   suggests unanswered-message thresholds feed into throttling.
7. **New or cold numbers** sending at volume from day one.
8. **Datacenter IPs.** See [§10](#10-infrastructure).

Note what is *not* on this list: total message count in isolation. A number
sending 200 messages a day into engaged groups is safer than one sending 30 to
strangers.

---

## 3. Where VJN actually stands

This matters, because most anti-ban advice online is written for cold sales
outreach and is far stricter than this project needs.

| Factor | VJN's situation | Risk |
|--------|-----------------|------|
| Recipients | The centre's own WhatsApp groups | **Low** — members joined voluntarily |
| Contact graph | Group sends, not DMs to strangers | **Low** |
| Volume | A few flyers per day across a handful of groups | **Low** |
| Content | Event flyers with a caption | Low, but repetitive |
| Number age | Existing, in normal human use | **Low** |
| Client | Unofficial (whatsapp-web.js) | **This is the real exposure** |
| Timing | Fixed 2 s intervals, burst at slot time | **Fixable — see below** |

The audience is the strongest protection here and it is already good. The two
things worth fixing are **timing** and **payload uniformity**.

---

## 4. Current behaviour in the code

**Implemented.** Everything in §5–§9 now lives in
[`send-safety.js`](send-safety.js) and applies to every send path. The table
below is what each path does today; the historical fixed delays it replaced are
kept in the right-hand column, because knowing what *not* to go back to is the
point of this section.

| Path | Location | Pacing today | Was |
|------|----------|--------------|-----|
| Scheduled fan-out to a set | `listen.js` | `sendGap()` 45–90 s, shuffled | fixed 2000 ms |
| `!send` to a set (text or media) | `listen.js` | `sendGap()`, shuffled, varied caption | fixed 2000 ms |
| `!send` to *all* groups | `listen.js` | `broadcastGap()` 60–120 s, shuffled | fixed 2000 ms |
| `sendToTarget` set expansion | `listen.js` | `sendGap()`, shuffled | **no delay at all** |
| `POST /send` with a set target | `listen.js` | `sendGap()`, shuffled, answers before fanning out | **no delay at all** |
| Bulk send (API) | `api-handlers.js` | `sendGap()`, shuffled, stops on cap | fixed 2500 ms |
| Bulk send (WhatsApp wizard) | `bulk-send.js` | `sendGap()`, shuffled, stops on cap | fixed 2500 ms |
| Broadcast to all groups | `api-handlers.js` | `broadcastGap()`, shuffled, stops on cap | fixed 2000 ms |
| Add participants | `api-handlers.js` | `participantGap()` 75–150 s | fixed 90000 ms |
| Interactive "Send now" | `sandesha/js/pages/promo-compose.js` | 20–40 s jittered, shuffled | fixed 1500 ms |

Two paths deliberately stay fast:

- **Bot replies** (`botReply` → `msg.reply`) — conversational, two-way, and
  §2 counts that as protective rather than risky. They also do not draw on the
  send budget.
- **Single-recipient sends** — there is no fan-out to spread and nothing to
  cluster against.

---

## 5. Strategy 1 — Randomised pacing (highest value, lowest effort)

Replace every fixed delay with a jittered one. This is the single most valuable
change in this document.

Add next to the existing `delay` helper in `listen.js`:

```js
/**
 * Randomised pause between sends. Fixed intervals are a machine fingerprint,
 * so every gap is drawn fresh from [minMs, maxMs].
 */
function jitter(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return delay(Math.round(ms));
}
```

Recommended ranges by operation:

| Operation | Replace | With |
|-----------|---------|------|
| Between groups in a scheduled fan-out | `delay(2000)` | `jitter(45000, 90000)` |
| Between DMs in a bulk send | `delay(2500)` | `jitter(45000, 90000)` |
| Broadcast to all groups | `delay(2000)` | `jitter(60000, 120000)` |
| Media-bearing sends | — | add `jitter(3000, 5000)` after upload |
| Add participants | `delay(90000)` | `jitter(75000, 150000)` |

45–90 seconds per group sounds slow, and it is: twelve groups becomes roughly
twelve minutes instead of twenty-four seconds. That is the point. A flyer that
lands across the centre's groups over ten minutes looks like a volunteer
posting; the same flyer landing in twenty seconds does not.

If a slot genuinely cannot spread, drop to `jitter(20000, 40000)` — still far
better than a constant. Never go below ~5 seconds between distinct chats.

**Do not** implement this as `2000 + Math.random() * 200`. Jitter that narrow is
still periodic. The range should be wide enough that consecutive gaps differ by
tens of seconds.

---

## 6. Strategy 2 — Spread the slot, don't burst it

Right now a scheduled promo fires all its groups the moment `runAt` passes. A
better model is a **delivery window**: the slot time is when sending *starts*,
and the groups are spread across the following N minutes in random order.

```js
/** Fisher–Yates. Sending in a different group order each time removes a
 *  second periodic signal — the fan-out sequence itself. */
function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

Then iterate `shuffled(setGroups)` instead of `setGroups`. Combined with §5,
a twelve-group promo spreads over roughly ten to eighteen minutes in an order
that changes every time.

The scheduler tick already guards against overlap via `schedulerRunning`, so a
long-running fan-out will simply cause the next tick to skip — which is correct
behaviour, not a bug to work around.

---

## 7. Strategy 3 — Quiet hours and daily caps

Humans do not post flyers at 03:00. Enforce a window and a ceiling.

```js
const QUIET_START_HOUR = 22;  // 22:00 IST — stop sending
const QUIET_END_HOUR = 8;     // 08:00 IST — resume
const MAX_SENDS_PER_DAY = 120;
const MAX_SENDS_PER_HOUR = 30;

function inQuietHours(d = new Date()) {
  const hour = Number(
    d.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false })
  );
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}
```

Rules to apply in the scheduler:

- A schedule due during quiet hours **defers to the next allowed hour**; it does
  not send and does not drop.
- Never exceed roughly **30 sends per hour** or **one per minute sustained**.
- Keep all activity inside an **eight-hour daily window** where practical.
- Counters reset at IST midnight and live in `state.json` so a restart cannot
  reset the budget.

The promotions board already caps slots per day (`MAX_SLOTS` in
`admin-promotions.js`), which limits this at the source. A server-side cap is
still worth having, because the board is not the only way in.

---

## 8. Strategy 4 — Human-like send behaviour

whatsapp-web.js exposes presence APIs that Sandesha does not currently use. The
codebase has **no** `sendStateTyping` calls anywhere.

```js
/** Brief typing presence before a send. Instant messages with no lead-in are
 *  a behavioural flag; the pause also scales with message length like a human. */
async function sendLikeAHuman(chat, payload, opts) {
  await chat.sendStateTyping();
  const text = typeof payload === 'string' ? payload : (opts?.caption || '');
  const thinkMs = Math.min(9000, 3000 + text.length * 35);
  await jitter(thinkMs * 0.7, thinkMs * 1.3);
  await chat.clearState();
  return chat.sendMessage(payload, opts);
}
```

Also worth doing, in rough order of value:

- **Mark chats as read** occasionally instead of leaving hundreds unread.
- **Reply to real messages** from the Me Commands group — two-way traffic is
  protective.
- **Vary activity**: the account should not *only* ever send flyers on a timer.
- Avoid sending the same media file object repeatedly; re-encode or vary it
  (see §9).

---

## 9. Strategy 5 — Vary the payload

Identical text plus identical media across many chats is trivially clusterable.

**Caption variation.** Keep one message body, vary the framing:

```js
const OPENERS = ['', '🙏 ', 'Namaskaram 🙏\n\n', 'Sharing below —\n\n'];
const CLOSERS = [
  '',
  '\n\nAll are welcome.',
  '\n\nDo join us.',
  '\n\nShare with anyone who may be interested.',
];

function vary(message) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return pick(OPENERS) + message + pick(CLOSERS);
}
```

Keep the meaning identical — this is presentation variety, not deception. The
group name can also be interpolated where it reads naturally.

**Media variation.** Re-encoding the flyer per group changes its hash. A single
byte of EXIF or a 1-pixel dimension change is enough. Weigh this against upload
cost; caption variation alone captures most of the benefit.

**Links.** Avoid URL shorteners — they correlate with spam. Link to the
GitHub Pages site directly.

---

## 10. Infrastructure

| Choice | Guidance |
|--------|----------|
| **Where it runs** | Home broadband (Pi, laptop) — an IP consistent with the phone's location |
| **Datacenter VPS** | Avoid. Oracle/AWS/DigitalOcean ranges are heavily associated with unofficial clients |
| **Proxies** | Do **not** bother. Advice to route through SOCKS5 residential proxies targets people running many accounts; for one legitimate community number a proxy adds a mismatch signal rather than removing one |
| **Sessions** | Exactly one `listen.js` process. Two fighting over the session causes disconnect loops. Already documented in [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md) |
| **Session persistence** | Keep `.wwebjs_auth/` backed up. Re-linking repeatedly is itself a signal |
| **Uptime** | A device that connects and disconnects all day looks worse than one that stays linked |
| **Primary phone** | Must stay in normal use — a linked device logs out after 14 days of primary inactivity |

---

## 11. Audience hygiene

The strongest protection, and mostly not a code problem:

- **Only send to groups the centre owns** and whose members joined knowingly.
- **Never** buy, scrape, or import number lists. The bulk-send-to-numbers path
  (`bulk-send.js`, up to 100 numbers) is the riskiest surface in Sandesha —
  restrict it to people who have contacted the centre.
- **Offer an exit.** A periodic "reply STOP to leave this list" costs nothing and
  converts would-be blocks into quiet exits. A block is a scored event; leaving
  a group is not.
- **Watch reply rate.** Groups that never respond are candidates for lower
  frequency.
- **Frequency discipline.** More than one or two flyers per group per day is
  where members start muting and blocking.

### Warning signs — stop immediately

| Signal | Action |
|--------|--------|
| Members report being unable to see messages | Stop all sends for 48 h |
| Sends silently fail or hang | Stop; check for a soft restriction |
| Session disconnects repeatedly after re-link | Stop automated sending for a week |
| Any "temporarily banned" notice | Stop entirely; do not re-link; wait out the timer |
| Block/report complaints from members | Cut frequency, audit content |

Recovery: send nothing automated for one to two weeks, use the number normally
by hand, then resume at a fraction of previous volume. A VPN or a new number
does **not** reset a temporary ban and can escalate it.

---

## 12. The real fix

Every technique above is risk reduction, not a guarantee. If WhatsApp posting
becomes something the centre depends on, migrate the send path to the
[WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api):

- Sanctioned — no ban risk from automation as such
- Free tier covers a meaningful monthly conversation volume
- Runs on Meta's infrastructure, so no Pi and no home-IP requirement
- Provides a **quality rating** that warns before enforcement

Trade-offs: it needs a Meta Business account and a dedicated number, message
templates require pre-approval, and — the blocker for this project — **the Cloud
API cannot post to ordinary WhatsApp groups**. It is built for one-to-one
conversations with opted-in contacts.

That is precisely why Sandesha exists. A realistic split:

- **Groups** → Sandesha, paced per this document
- **Individual notifications** → Cloud API, if that need ever arises

---

## 13. Implementation checklist

All implemented in [`send-safety.js`](send-safety.js), covered by
`npm run test:safety`.

- [x] Add `jitter(min, max)` beside `delay()` — `send-safety.js`, shared by every path
- [x] Replace the fixed `delay(2000)` in the scheduler fan-out with `jitter(45000, 90000)`
- [x] Shuffle group order per fan-out
- [x] Replace `SEND_DELAY_MS` in `bulk-send.js` and the `delay(2500)` in `api-handlers.js`
- [x] Add quiet hours; defer rather than drop
- [x] Add daily and hourly send counters, persisted in `state.json`
- [x] Add `sendStateTyping()` + think-time before each send
- [x] Add caption variation
- [x] Log every send with a timestamp so the actual interval distribution can be audited
- [x] Document the group opt-out line for admins — [README.md](README.md#give-members-a-way-out)

Two things worth knowing about how the deferral works:

- A fan-out interrupted by quiet hours or a spent budget records **who has
  already received it** on the schedule row (`sentTo`) and is pushed back onto
  the queue. The next allowed tick continues with the remainder, so a pause
  can neither drop a group nor message one twice.
- The scheduler's `schedulerRunning` guard means a long fan-out simply causes
  the next 30-second tick to skip. That is correct, not a bug to work around.

Suggested defaults, all overridable from `.env` (see `.env.example`):

```env
SANDESHA_SEND_JITTER_MIN_MS=45000
SANDESHA_SEND_JITTER_MAX_MS=90000
SANDESHA_QUIET_START_HOUR=22
SANDESHA_QUIET_END_HOUR=8
SANDESHA_MAX_SENDS_PER_HOUR=30
SANDESHA_MAX_SENDS_PER_DAY=120
SANDESHA_TYPING_SIMULATION=1
SANDESHA_CAPTION_VARIATION=1
SANDESHA_SEND_AUDIT=1
```

Ranges not in the original list, also overridable: `SANDESHA_BROADCAST_JITTER_*`
(60–120 s), `SANDESHA_PARTICIPANT_JITTER_*` (75–150 s), and
`SANDESHA_MEDIA_JITTER_*` (3–5 s settling pause after an upload).

---

## References

- [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service)
- [About linked devices](https://faq.whatsapp.com/378279804439436)
- [About temporarily banned accounts](https://faq.whatsapp.com/1231374923011130)
- [Unauthorized use of WhatsApp](https://faq.whatsapp.com/5957850572559800)
- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [whatsapp-web.js — best practices](https://deepwiki.com/pedroslopez/whatsapp-web.js/10-best-practices-and-troubleshooting)

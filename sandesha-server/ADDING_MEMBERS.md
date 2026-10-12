# Sandesha — Adding People to Groups

How many members you can add per day, why adding is riskier than sending, and
what Sandesha actually does today.

Companion to [SENDING_SAFETY.md](SENDING_SAFETY.md), which covers *sending*.
Adding is a separate and more heavily policed action, so it gets its own limits.

---

## 1. The short answer

**WhatsApp publishes no daily limit for adding members.** Anyone who quotes you
an exact number is guessing.

What WhatsApp *does* document is the penalty. Add too many people too quickly
and you see:

> "You've added too many contacts to groups too quickly. Try again later."

That is roughly a **24-hour cooldown** on adding anyone to any group, and on
creating new groups.

For this centre's number — established, in normal human use — treat
**20–30 adds per day as comfortable and 50 as a hard ceiling**, spread across
the day rather than in one run.

Better still: **use an invite link instead** wherever possible. See [§5](#5-invite-links-the-safer-default).

---

## 2. The limits that are published

| Surface | Cap |
|---------|-----|
| Members per group | **1,024** (1,025 counting the creator) |
| Adds per day | **Not published** — enforced by throttling, not a stated number |
| Communities | Caps differ across sources; check the [Help Center](https://faq.whatsapp.com/) before planning around a figure |

The group cap rose from 256 → 512 → 1,024 over the years, so verify it before
building anything that depends on it.

Practical note: engagement collapses long before 1,024. Groups get noisy past
about 50 members and effectively become announcement-only past 200. If a VJN
group is approaching those sizes, the answer is a second group or a Community,
not a fuller group.

---

## 3. A working daily budget

No official source exists for these. They come from community and vendor
reporting and should be treated as **informed guesses, not thresholds**. The
consistent finding across sources is that account age matters more than volume.

| Account age | Per hour | Per day |
|-------------|----------|---------|
| Under 7 days | 2–3 | 15–20 |
| 8–30 days | ~5 | ~30 |
| **Over 30 days (VJN's number)** | **~8** | **~50** |

Recommended operating point for VJN:

- **20–30 adds per day** as routine
- **50 per day** as an absolute ceiling
- Never more than **8–10 in any single hour**
- Spread across the day; do not run one long job
- Do not add on consecutive days at the ceiling

---

## 4. Why adding is riskier than sending

Sending a flyer into a group whose members opted in is low-risk. Adding someone
to a group is not, for reasons that are structural rather than about volume:

1. **It acts on someone else's account without their consent.** Mass-adding
   strangers to groups is the defining spam-group pattern, so it is policed hard.
2. **It is a distinct RPC with its own rate limiter.** WhatsApp returns explicit
   rate-limit codes (400, 429) for adds — see [§7](#7-what-the-error-codes-mean).
   Sending has no comparable per-call rejection.
3. **The people added can report you.** Someone dropped into an unfamiliar group
   is far more likely to tap Report than someone who joined via a link.
4. **The penalty blocks a capability, not just one message.** A cooldown stops
   *all* adds and new group creation for 24 hours.

Recipients who never saved your number are the strongest single flag. Adding
such people is worse than messaging them.

---

## 5. Invite links: the safer default

Sharing a group invite link is **not rate-limited and carries essentially no
account risk**, because the person taps it and joins themselves. No add RPC
fires. There is nothing to throttle and nothing to report.

It also solves cases where a direct add is simply impossible:

- The person has not saved your number
- The person has restricted who can add them to groups
- WhatsApp returns code 403 or 417 (invite-only)

For a centre growing its groups, invite links belong on the website, on flyers,
and in the WhatsApp bio. They scale without limit.

> **Not implemented.** Sandesha has no invite-link support today — there are no
> `getInviteCode` calls anywhere in the backend. Adding a "get invite link"
> action to the Messaging UI would be a small change and would remove most of
> the reason to use bulk add at all.

Reserve direct adds for the handful of people who specifically ask to be put in.

---

## 6. What Sandesha does today

There are **two** add paths with **different pacing**. This is a discrepancy,
not a design.

### Path A — WhatsApp wizard (`bulk-add-members.js`)

The careful one. Configured by these constants:

```19:30:vjn-website/sandesha-server/bulk-add-members.js
/** Base wait between add RPCs (multiplied adaptively on rate limits). */
const ADD_DELAY_MS = [
  envMs('ADD_MEMBERS_DELAY_MIN_MS', 90_000),
  envMs('ADD_MEMBERS_DELAY_MAX_MS', 150_000),
];
/** Extra pause after every N WhatsApp add RPCs (WhatsApp allows ~3–4 per window). */
const BATCH_SIZE = envInt('ADD_MEMBERS_BATCH_SIZE', 3);
const BATCH_COOLDOWN_MS = envMs('ADD_MEMBERS_BATCH_COOLDOWN_MS', 5 * 60_000);
const RATE_LIMIT_BACKOFF_MS = envMs('ADD_MEMBERS_RATE_LIMIT_BACKOFF_MS', 3 * 60_000);
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_DELAY_MULTIPLIER = 4;
```

| Behaviour | Value |
|-----------|-------|
| Gap between adds | 90–150 s, randomised |
| Batch cooldown | 5 min after every 3 add RPCs |
| Rate-limit backoff | 3 min, with delay multiplier up to 4× |
| Retries on 400/429 | 2 |
| Max numbers per job | 50 |

It also does something subtle and correct: outcomes that never reached
WhatsApp's RPC — already-a-member, or number-not-on-WhatsApp — **do not count
toward the batch quota**, so the cooldown budget is spent only on real adds.

**Throughput: roughly 16 adds/hour.** A full 50-number job takes about
**3 hours**. That is intentional.

### Path B — Web UI (`api-handlers.js`)

Faster, and missing the protections:

```234:250:vjn-website/sandesha-server/api-handlers.js
    for (const entry of entries) {
      if (job.cancelled) break;
      try {
        const result = await addParticipantsFixed(client, groupJid, [entry.wid], {
          sleep: 0,
          autoSendInviteV4: true,
        });
        job.done += 1;
        if (typeof result === 'string') {
          job.errors.push(`${entry.digits}: ${result}`);
        }
      } catch (err) {
        job.done += 1;
        job.errors.push(`${entry.digits}: ${err.message}`);
      }
      await safety.participantGap();
    }
```

`safety.participantGap()` is 75–150 s jittered, which is reasonable on its own.
What is missing:

- **No batch cooldown** — adds continue indefinitely at the same pace
- **No rate-limit backoff** — a 400 or 429 is pushed onto `job.errors` and the
  loop carries on at full speed, which is exactly how a soft rate limit becomes
  a 24-hour block
- **No retry** on a recoverable rejection

**Throughput: roughly 32 adds/hour** — about double Path A.

### The gap that affects both

**There is no daily cap on adds anywhere.** The send budget in `send-safety.js`
(`maxSendsPerDay`, default 120) governs *sends only*. Nothing prevents four
consecutive 50-number jobs in one day — 200 adds, comfortably into ban range.

---

## 7. What the error codes mean

`add-participants.js` already maps WhatsApp's responses. The codes that matter
operationally:

| Code | Meaning | What to do |
|------|---------|------------|
| 200 | Added | — |
| **400** | Rejected, often rate limit | **Stop. Wait 15–30 min.** Do not retry immediately |
| 401 | Not allowed to add this person | Skip; use an invite link |
| 403 | Private invitation only | Send the invite link |
| 404 | Not registered on WhatsApp | Skip; does not count toward quota |
| 408 | Recently left the group | Do not re-add — they left deliberately |
| 409 | Already a member | Skip; does not count toward quota |
| 417 | Cannot add to community; invite via link | Send the invite link |
| 419 | Group is full | Stop; the group is at 1,024 |
| **429** | Too many adds too fast | **Stop for 15–30 min minimum** |

Codes 400 and 429 are WhatsApp telling you directly that you are over the line.
Treat either as a signal to stop the whole job, not to skip one number.

Code 408 deserves attention: re-adding someone who left is a reliable way to
earn a report.

---

## 8. If you hit the cooldown

You will see *"You've added too many contacts to groups too quickly."*

1. **Stop every add job immediately.** Cancel anything running.
2. **Wait a full 24 hours.** Do not test whether it has lifted.
3. **Do not re-link the session**, switch numbers, or use a VPN. None of these
   reset the timer and all can escalate it.
4. Keep sending normally if sends still work — the cooldown is add-specific.
5. When it lifts, resume at **half** your previous rate for a week.
6. Switch the affected growth to invite links.

---

## 9. Recommended settings

Current defaults are sound for Path A. Tighten Path B to match:

```env
# Between individual adds (wizard path)
ADD_MEMBERS_DELAY_MIN_MS=90000
ADD_MEMBERS_DELAY_MAX_MS=150000
ADD_MEMBERS_BATCH_SIZE=3
ADD_MEMBERS_BATCH_COOLDOWN_MS=300000
ADD_MEMBERS_RATE_LIMIT_BACKOFF_MS=180000

# Web UI path — raise to match the wizard
SANDESHA_PARTICIPANT_JITTER_MIN_MS=90000
SANDESHA_PARTICIPANT_JITTER_MAX_MS=150000
```

---

## 10. Fixes worth making

Ordered by value.

- [ ] **Add an invite-link action** to the Messaging UI (`chat.getInviteCode()`).
      Removes most of the need for bulk add entirely
- [ ] **Add a daily add budget** — mirror `createSendBudget` in `send-safety.js`
      with a separate counter, default 30/day, hard stop at 50
- [ ] **Give Path B the batch cooldown and rate-limit backoff** from Path A, or
      better, have both call one shared add-pacing helper
- [ ] **Abort the job on 400/429** rather than logging and continuing
- [ ] **Never auto-retry code 408** (recently left)
- [ ] **Warn in the UI** before a job that would exceed the daily budget, with
      the estimated runtime — a 50-number job is three hours, and admins should
      know that before starting it
- [ ] **Log every add** with timestamp and result code so the real rate can be
      audited, as `send-audit.jsonl` already does for sends

---

## References

- [WhatsApp Help Center](https://faq.whatsapp.com/)
- [About linked devices](https://faq.whatsapp.com/378279804439436)
- [SENDING_SAFETY.md](SENDING_SAFETY.md) — pacing and safety for sending
- `add-participants.js` — error code map
- `bulk-add-members.js` — wizard pacing implementation

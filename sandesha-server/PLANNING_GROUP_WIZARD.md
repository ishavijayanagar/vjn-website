# Planning group — `@sandesha send` wizard

Sandesha listens in one **planning / promotions** WhatsApp group when an allowed operator mentions **@sandesha** and sends **`send`** on a **reply** to a draft.

## Configure (Pi or laptop)

**Recommended:** Promotions → **Settings** (gear) → **Planning group** — choose the WhatsApp group and operator phone(s). Saves to `planning-config.json` and applies immediately.

**Or** use `.env` (`SANDESHA_PLANNING_OPERATOR`, `SANDESHA_PLANNING_GROUP_JID`, …) until someone saves in the UI.

1. Ensure `groups.json` has the sets you want in the menu.
2. After `.env`-only changes, restart Sandesha:
   ```bash
   cd ~/apps/vjn-website/sandesha-server   # or your path
   ./sandesha.sh restart
   ./sandesha.sh logs | grep -i planning
   ```
   Log should show either `Planning-group @sandesha send wizard enabled` or a clear reason the feature is inactive.

## Manual test checklist

| Step | Who | Action | Expected |
|------|-----|--------|----------|
| 1 | Non-operator | In planning group: `@sandesha send` (no reply) | **No** bot message |
| 2 | Operator | Reply to a draft, then `@sandesha send` | Numbered **sets** menu |
| 3 | Operator | Reply `1` or a set name | **Send now / Schedule** prompt |
| 4 | Operator | Reply `2`, then `10am tomorrow` | **Scheduled** confirmation; row in dashboard / `schedules.json` |
| 5 | Operator | New reply `@sandesha send` → set → `1` | Groups receive quoted content (paced) |
| 6 | Anyone | `cancel` mid-wizard | “Planning send cancelled.” |
| 7 | Operator | `@sandesha queue` (or `list` / `schedules`) | Numbered list of upcoming scheduled sends |
| 8 | Operator | `@sandesha cancel 2` | Item **#2** removed from `schedules.json` (same as dashboard cancel) |

**Cancel vs queue:** plain **`cancel`** stops the active send wizard only. **`cancel 1`**, **`cancel 2`**, … remove that numbered row from the schedule queue (use **`queue`** first to see numbers).

## Troubleshooting

- **No menu:** Sender must be one of the numbers in `SANDESHA_PLANNING_OPERATOR` (country code, e.g. `91…`). For a team member, Sandesha uses their **group sender id**, not the linked device’s “you”.
- **Mention to start:** `@sandesha` or `@sv` is needed to start a send (`@sandesha send`), and for `@sandesha queue` / `@sandesha cancel 2`. Once the wizard is running, plain replies work (`1`, `2`, a set name, `9am`, `cancel`); a mention is still accepted. Plain `send` or `2` with no wizard running is ignored. A reply that does not fit the current step gets a short message saying exactly what to type (the numbered set list, `1` or `2`, or example times such as `9am`, `9:30am`, `14:30`, `9am tomorrow`) and the wizard keeps waiting. A new flyer or sticker with no text posted mid-wizard is left alone.
- **Natural language (reply to draft):** `@sandesha send this now` · `@sandesha send this at 6pm today` · optional `to vjn_sub_center_grps` to skip the set menu.
- **Board “Sent”:** If the quoted draft text matches an open promotions post, **Send now** marks it sent; **Schedule** links the queue row (`sourceId` + `wa_schedule_ids`) and marks sent when the scheduler delivers.
- **Group not found:** Set `SANDESHA_PLANNING_GROUP_JID` from `node send.js --list`.
- **Flyer/video sends text only:** Post the image or video **in the planning group** and wait a few seconds before `@sandesha send`. After deploy, run `npm install` once (applies the `whatsapp-web.js` media patch). Logs like `Unexpected mimetype application/octet-stream` mean WA Web needed `mimetype` on download — fixed in Sandesha’s downloader + `postinstall` patch. Use a **fresh** flyer post if an old one was already tested many times (WA caches successful downloads).

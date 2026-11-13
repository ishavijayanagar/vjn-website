# Sandesha database (sandesha.db)

**The database is the record. The Google Sheet is a backup copy.**
Everything that does not need a Google service lives in SQLite on the Pi; every
change is copied to the Sheet in the background, so the Sheet is always a recent
copy and the public pages can read it if the Pi is down.

| Table | What | Sheet copy |
|---|---|---|
| `team_users` | VJN admin logins (salted password hashes) | *Users* (frozen at the move; passwords are not re-copied) |
| `promotional_msgs` | Promotion posts | *Promotions* |
| `event_listings` | Programs and volunteering | *Programs*, *Volunteering* |
| `site_content` | Site text and the banner | *Site* |
| `program_names` | The fixed list of program names | *ProgramTitles* |
| `website_inquiries` | Website enquiries and what Nurturing did with them | *HomeQueries*, *ProgramInterest*, *ProgramVolunteer*, *VolunteeringInterest*, *VolunteerAttendance* |
| `event_vols` | Event-volunteer pipeline (needs and volunteers) | *EventVolunteers* |
| `sheet_sync_queue` | Changes not yet copied to the Sheet | — |
| `app_setting` | Small settings and flags (e.g. `data_on_pi`, the volunteer roster copy) | — |
| `id_counters` | Next ID numbers, so deleted IDs are never reused | — |
| `checkins` | Volunteer check-ins (to be folded into `event_vols`) | *monthly tabs* |

Sandesha's own state also lives in the database now (nothing is kept in loose JSON files any more):

| Table | What |
|---|---|
| `login_sessions` | Signed-in sessions (stored as a hash of the token; people sign in again after a restart only once) |
| `scheduled_sends` | Scheduled WhatsApp sends |
| `delivered_sends` | Which scheduled sends were delivered (so a post is never sent twice) |
| `group_sets`, `group_set_members` | Named sets of WhatsApp groups |
| `whatsapp_contacts` | Saved contact names and numbers |
| `push_subscriptions` | Phones that get push notifications |
| `promo_send_jobs` | Promotion send jobs (48 hours) |
| `activity_log`, `send_audit_log` | The Activity log and the send audit (90 days) |
| `message_reach` | How far each post travelled |
| `volunteer_roster` | The volunteer roster, one row per person (refreshed from its Sheet every 10 minutes) |
| `admin_audit_log` | Who changed what in the admin (1 year; no contents) |
| `app_setting` | Small settings: poll cursor and send budget (`bot_state`), planning group (`planning_config`), last group list (`groups_cache`), push heads-up memory, flags |

The first time the new version starts, the old files (`schedules.json`, `groups.json`, `contacts.json`,
`state.json`, `planning-config.json`, `groups-cache.json`, `push-prewarned.json`, `push-subscriptions.json`,
`reach.json`) are copied in once and renamed to `.migrated`; nothing is overwritten. `activity.jsonl` and
`send-audit.jsonl` are left where they are and no longer written. Every hour the server folds the write-ahead
log back into the database file and removes expired logins.

Still in Apps Script, because they need Google: **Google Forms** (making,
connecting, responses), **Slides flyers** (templates, rendering, thumbnails),
**Drive uploads**, and the external volunteer-roster sheet.

## How it works

- The pages send the same requests as before. For a Pi login they go to
  `POST /vjn/api` on the Pi (`vjn-api.js`); anything the Pi does not handle
  (flyers, forms, uploads) goes to Apps Script as before.
- The public website reads `GET /public/programs|volunteering|site` from the Pi
  first and falls back to Apps Script (the Sheet copy) if the Pi cannot be
  reached (`public-data.js`).
- A visitor's form goes to the Pi; if the Pi is down it goes to the Sheet, and the
  Pi collects those rows when it is back (every 5 minutes, or at once when Apps
  Script pokes it).
- Google Form responses are written to the Sheet by Apps Script, then collected
  by the Pi the same way.
- Programs/volunteering close themselves when their first slot starts; the
  attendance and "program in 2 days" push reminders run on the Pi.

## Going live (once)

Do the earlier SQLITE steps first if you have not (logins, promotions): `VJN_AUTH_SECRET` in `.env`, same value as Script Property, `node scripts/import-users.js`, `node scripts/import-promos.js`.

1. Pi: `git pull && npm install`, restart Sandesha. (Nothing changes yet: the Pi answers
   nothing about programs/enquiries until step 4, so the site keeps using the Sheet.)
2. Apps Script: paste `apps-script.js`; Script Property `SANDESHA_API_URL` = the Pi's funnel URL
   (`https://sandesha-vjn-pi.tail2677db.ts.net`, no trailing slash); Deploy → New version.
3. Pi: `node scripts/import-data.js` — copies Programs, Volunteering, Site, ProgramTitles, the five
   enquiry tabs and EventVolunteers into the database, and switches the Pi on for them.
   From this moment the Sheet takes no admin edits for these tabs (it says "Sandesha is offline…").
4. Hard-refresh the site once (the service worker is `isha-vjn-v172`).
5. Check: `curl https://<funnel>/public/programs` shows your programs; in Admin, edit a program and
   see it appear in the Programs tab of the Sheet within a minute.
6. Nightly backup (as before): `0 3 * * * cd ~/apps/vjn-website/sandesha-server && node scripts/backup-db.js`

`GET /vjn/sync-status` (admin token) shows how many changes are still waiting to be copied to the Sheet.

## If the Pi is offline

- The public site keeps working from the Sheet copy (programs, volunteering, site text);
  form submissions are saved in the Sheet and collected later.
- Signing in and every admin edit need the Pi.
- Changes made on the Pi while Google is unreachable wait in `sheet_sync_queue` and are copied
  as soon as it is reachable again.

## Everyday commands

```bash
sandesha db                # size, rows per table, latest backup, changes waiting for the Sheet
sandesha backup            # safe copy into backups/ (newest 14 kept)
sandesha install-backup    # nightly 3am backup (cron)
sandesha restore <file>    # put a backup back
```
(`sandesha` is `./sandesha.sh` after `./sandesha.sh install-command`.)

## Restore

Stop Sandesha, copy a file from `backups/` over `sandesha.db` (and delete
`sandesha.db-wal` / `sandesha.db-shm`), start Sandesha. If the database is lost
entirely, the Sheet copy holds everything except logins: re-run
`node scripts/import-data.js` against a fresh database (the Sheet's ids are kept).

# Sandesha database (sandesha.db)

**The database is the record. The Google Sheet is a backup copy.**
Everything that does not need a Google service lives in SQLite on the Pi; every
change is copied to the Sheet in the background, so the Sheet is always a recent
copy and the public pages can read it if the Pi is down.

| Table | What | Sheet copy |
|---|---|---|
| `users` | VJN admin logins (salted password hashes) | *Users* (frozen at the move; passwords are not re-copied) |
| `promos` | Promotion posts | *Promotions* |
| `listings` | Programs and volunteering | *Programs*, *Volunteering* |
| `site_content` | Site text and the banner | *Site* |
| `program_titles` | The fixed list of program names | *ProgramTitles* |
| `inquiries` | Website enquiries and what Nurturing did with them | *HomeQueries*, *ProgramInterest*, *ProgramVolunteer*, *VolunteeringInterest*, *VolunteerAttendance* |
| `ev_rows` | Event-volunteer pipeline (needs and volunteers) | *EventVolunteers* |
| `sync_queue` | Changes not yet copied to the Sheet | — |

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
- Changes made on the Pi while Google is unreachable wait in `sync_queue` and are copied
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

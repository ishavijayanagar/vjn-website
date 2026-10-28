# Sandesha database (sandesha.db)

Logins and promotion posts live in SQLite on the Pi, not the Google Sheet.
Form submissions, programs, volunteering and everything else stay in the Sheet.

| Table | What | Replaces |
|---|---|---|
| `users` | VJN admin logins (salted password hashes) | Sheet tab *Users* |
| `promos` | Promotion posts: copy, flyer link, slot, audience, queue ids, sent state | Sheet tab *Promotions* |

Programs and volunteering listings are still read from the Sheet (Apps Script
`vjnListings`); the Pi makes one post per open listing and keeps a copy of the
listing fields on it, so the board still draws if the Sheet is unreachable.

## Going live (once)

1. Pi: `git pull && npm install`
2. Pi: put `VJN_AUTH_SECRET=<64 hex chars>` in `.env`
   (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), restart Sandesha.
3. Apps Script: paste `apps-script.js`; Script Property `VJN_AUTH_SECRET` = the same value; Deploy → New version.
4. Pi: `node scripts/import-users.js` then `node scripts/import-promos.js`
   (the second one also tells Apps Script to stop taking promotion writes).
5. Pi: nightly backup — `crontab -e` → `0 3 * * * cd ~/apps/vjn-website/sandesha-server && node scripts/backup-db.js`

Do steps 3–4 back to back: between them nobody can sign in. Everyone signs in
again once (older sign-ins from the Sheet are told to).

## If the Pi is offline

Already signed-in people keep working on everything that only needs the Sheet
(programs, volunteering, enquiries, banner). Signing in, Team and Promotions
need the Pi.

## Restore

Stop Sandesha, copy a file from `backups/` over `sandesha.db` (and delete
`sandesha.db-wal` / `sandesha.db-shm`), start Sandesha.

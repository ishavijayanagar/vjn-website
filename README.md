# Isha Place – Vijayanagar

This repo holds two pieces:

| Folder | What it is |
|--------|------------|
| this folder | The public static site plus the admin pages, published by GitHub Pages |
| `sandesha-server/` | The Sandesha WhatsApp backend (Node). Runs on a local machine, reached over a Tailscale funnel. Excluded from the Pages build by `_config.yml` |

## Run everything

From this folder:

```bash
chmod +x dev.sh   # first time only
./dev.sh
```

That starts the static site on http://localhost:8765 and the WhatsApp backend on port 42620 with its public tunnel, and stops both on Ctrl+C. Useful variants:

| Command | What it does |
|---------|--------------|
| `./dev.sh --restart` | Stop whatever is already running, then start fresh |
| `./dev.sh --stop` | Stop both and exit |
| `./dev.sh --no-tunnel` | Backend on localhost only, no public URL |
| `./dev.sh --site-only` | Just the website |
| `./dev.sh --backend-only` | Just the backend |
| `./dev.sh --reset` | Re-link WhatsApp (new QR); implies `--restart` |
| `PORT=8080 ./dev.sh` | Serve the site on another port |
| `HOST=127.0.0.1 ./dev.sh` | Site on this laptop only (no phone/LAN) |

By default anything already running is left alone, so a plain `./dev.sh` is safe to
re-run. Use `--restart` after changing backend code, or when a previous session was
killed abruptly and left a port occupied.

Stopping is always graceful: the backend gets SIGTERM so it can close WhatsApp
cleanly and keep its login, so `--restart` will not make you scan a new QR code.
Combine flags as needed, e.g. `./dev.sh --restart --no-tunnel`.

## Run the site on its own

From this folder:

```bash
chmod +x serve.sh   # first time only
./serve.sh
```

Then open [http://localhost:8765/](http://localhost:8765/).

Use another port if this one is busy:

```bash
PORT=8080 ./serve.sh
```

Set your Apps Script web app URL in `config.js` (see `setup-guide.md`) so programs, volunteering, forms, and the admin page work against your Google Sheet.

Admins can sign in at `admin.html` to update listings, photos, and home-page text without opening the spreadsheet.

The standalone promotions board is available at `admin-promotions.html` after signing in through the admin page. It includes **Board** (flyer planning), **Schedule** (WhatsApp queued sends), and **Send** (instant WhatsApp).

### How a scheduled post gets sent

Scheduling a post on the **Board** hands it to Sandesha rather than leaving it for
someone to post by hand:

1. Pick a day, a time slot and an **Audience** (WhatsApp groups or a saved set).
2. The board uploads the flyer to Sandesha and creates one queued row per list,
   recording their ids on the promotion (`wa_schedule_ids` in the sheet).
3. Sandesha's scheduler fires at the slot time and sends the flyer with the
   message as its caption — the backend must be running for this to happen.
4. Next time the board is opened it sees those rows are gone, and marks the post
   **Sent** (`sent_by` = `sandesha`).

Editing the copy, snoozing, or taking a post off the day re-queues or cancels the
Sandesha rows to match, so the board and WhatsApp never disagree. Marking a post
sent by hand cancels its queued rows so it cannot go out twice.

Sends are paced deliberately — a flyer spreads across the centre's groups over
ten to twenty minutes rather than landing all at once, and anything due between
22:00 and 08:00 waits for morning. See
[`sandesha-server/SENDING_SAFETY.md`](sandesha-server/SENDING_SAFETY.md).

### Editing or posting a queued message by hand

Tapping a card on the **Schedule** tab opens it. From there:

- **Edit** — changes a message that has not gone out yet. A post the Board
  created reopens in the Board's editor, which owns its copy, flyer and slot;
  anything written in Compose reopens there with its audience, time and flyer
  already filled in. Saving replaces the queued rows rather than adding a
  second copy, and an unchanged flyer is not re-uploaded.
- **Save flyer to Photos** and **Copy text** — for posting it in WhatsApp
  yourself when it cannot wait for the pacing, or the backend is down.
- **I posted this** — cancels the queued send and marks the post Sent.

Edit is hidden once a message is past its slot, because the scheduler may
already be fanning it out.

**Admin only:** open the **Messaging** card → **Settings** tab for full Sandesha tools. Set the Sandesha server URL under **Settings** (stored on your device) or use the gear icon on the Promotions page. `config.js` still provides the default URL.

## Run the WhatsApp backend

The Schedule, Send, and Messaging features need `sandesha-server/` running:

```bash
cd sandesha-server
npm install        # first time only
./start.sh
```

It listens on `http://127.0.0.1:42620` and publishes a funnel URL that `config.js` points at. Its own configuration (`.env`), WhatsApp session (`.wwebjs_auth/`), and logs stay untracked — see `sandesha-server/.gitignore`. Full details in [`sandesha-server/README.md`](sandesha-server/README.md).

# Sandesha - WhatsApp Group Messaging Bot

A WhatsApp bot for sending messages to groups, scheduling messages, and automation.

**Where this lives:** this folder is the Sandesha backend inside the [VJN website](../) repo. `listen.js` is the API and WhatsApp process; it runs on a local machine and is reached over a Tailscale funnel. It is excluded from the GitHub Pages build via [`../_config.yml`](../_config.yml) and is never published as part of the site.

**Web UI:** the dashboard is integrated into the VJN website admin (Promotions → Schedule/Send; Admin → Messaging). `docs/index.html` is a retire notice only.

## Features

- 📢 Send messages to multiple groups
- ⏰ Schedule messages for later delivery
- 🤖 AI-powered natural language processing
- 📱 Works with WhatsApp Web
- 🔄 Automatic reconnection
- 💾 State persistence (survives restarts)
- ✅ 172 tests passing

## Requirements

- Node.js 18+
- WhatsApp account
- Internet connection

## Installation

```bash
# From a clone of the vjn-website repo
cd vjn-website/sandesha-server

# Install dependencies
npm install
```

## Setup

### 1. Configure Groups

**Web dashboard** (after `./start.sh`): open **http://127.0.0.1:42620/** — search groups, save sets.

**WhatsApp:** send `!settings` in Me Commands — guided add/edit/delete.

**Manual:** edit `groups.json` (see [SETUP_GUIDE.md](SETUP_GUIDE.md)).

### 2. Configure Contacts (Optional)

Edit `contacts.json`:

```json
{
  "contacts": {
    "John": "919844400000",
    "Jane": "919844411111"
  }
}
```

### 3. Start the Bot

```bash
# Development
node listen.js

# Or use the convenience script
start-fresh.bat
```

### 4. Scan QR Code

1. Open WhatsApp on your phone
2. Go to Settings → Linked Devices
3. Tap "Link a Device"
4. Scan the QR code shown in terminal

### 5. Commands Group

The bot listens to a specific group (default: "Me Commands"). Add the bot to that group and send commands there.

## Web dashboard & GitHub Pages

- **Local UI:** http://127.0.0.1:42620/ (while `listen.js` is running) — serves `docs/`, now just a redirect to the VJN admin
- **Admin UI:** the VJN website admin pages, which call this API over the funnel URL in [`../config.js`](../config.js)
- **WhatsApp:** `!settings` in Me Commands for the same features in chat

## Commands

### Settings & sets

```
!settings    # menu: add / edit / delete sets
!sets        # list current sets
```

### Help Command

```
!help
```

Shows all available commands.

### List Groups

```
!groups
```

Lists all configured groups and their last activity.

### Send Message

#### Using Natural Language

```
send hello to family
hi to work
broadcast message to all
```

#### Using Command

```
!send Hello family
!broadcast Hello everyone
```

### Schedule Message

#### Natural Language

```
hello everyone !schedule to family at 9am
good morning !schedule to all at tomorrow 8am
```

#### Using Command

```
!schedule Hello to family at 9am
```

### Time Formats Supported

| Format | Example |
|--------|---------|
| Time | 9am, 2pm, 14:30 |
| Relative | tomorrow, today |
| Days | monday, tuesday, friday |
| Specific | march 30, january 15 |

### AI Chat

Simply send a message without a command:

```
how are you?
tell me a joke
what is the weather?
```

The bot will respond using AI.

## API Endpoints

The bot runs a local HTTP server on port 42620:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /groups` | List all groups |
| `POST /send` | Send message |

### API Examples

```bash
# Health check
curl http://127.0.0.1:42620/health

# List groups
curl http://127.0.0.1:42620/groups

# Send message
curl -X POST http://127.0.0.1:42620/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "target": "family"}'
```

## Troubleshooting

### Bot not responding?

1. Check if bot is running: `node listen.js`
2. Make sure you're in the "Me Commands" group
3. Wait up to 5 seconds (polling interval)

### Stuck on QR Code?

1. Delete session: `rm -rf .wwebjs_auth`
2. Restart: `node listen.js`
3. Scan new QR code

### Duplicate messages?

Check logs - may be running multiple instances:

```bash
taskkill /F /IM node.exe
node listen.js
```

### Check Logs

```bash
# View all logs
type sandesha.log

# View recent errors
findstr /i "error" sandesha.log
```

## Testing

```bash
# Run all tests
npm test

# Run specific tests
npm run test:unit      # Unit tests only
npm run test:poller    # Poller logic tests
npm run test:mock      # Integration tests
```

## Files

| File | Description |
|------|-------------|
| `listen.js` | Main bot application |
| `send.js` | CLI for sending messages |
| `groups.json` | Group configurations |
| `contacts.json` | Contact list |
| `schedules.json` | Scheduled messages |
| `state.json` | Bot state (auto-generated) |
| `sandesha.log` | Activity log |

## Deployment

### Local (Development)

```bash
node listen.js
```

### 24/7 Server

For 24/7 operation, use a VPS:

1. **DigitalOcean** - $4/month (recommended)
2. **Railway** - $5/month
3. **Oracle Cloud** - Free (requires credit card)

See deployment guides for more details.

A VPS runs on a datacenter IP, which WhatsApp associates with unofficial clients
and often drops the linked session. Home broadband (see
[RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md)) is the more reliable choice.

## Sending safely

Sandesha is an unofficial WhatsApp client, so pacing and audience discipline are
what keep the linked number healthy. Before increasing volume or adding new send
paths, read [SENDING_SAFETY.md](SENDING_SAFETY.md) — it covers randomised send
intervals, quiet hours, daily caps, payload variation, and what to do if the
account is restricted.

The protections live in [`send-safety.js`](send-safety.js) and apply to every
send path automatically:

| Protection | Behaviour |
|------------|-----------|
| Randomised pacing | 45–90 s between chats in a fan-out, 60–120 s on a broadcast. Never a fixed interval |
| Shuffled order | The fan-out sequence changes every send |
| Quiet hours | 22:00–08:00 IST. A due schedule is **held**, never dropped, and resumes in the morning |
| Daily / hourly caps | 120 a day, 30 an hour. Counted in `state.json`, so a restart does not hand out a fresh budget |
| Partial resume | A fan-out stopped by quiet hours or a cap remembers who already received it and continues later — no duplicates |
| Typing presence | A short, length-scaled typing indicator before each send |
| Caption variation | Opener and closer vary per chat when one message goes to many. The body is never altered |
| Audit log | One JSON line per send in `send-audit.jsonl`, so the real interval distribution can be checked |

Every value is overridable from `.env` — see `.env.example`. A twelve-group flyer
now takes roughly ten to eighteen minutes to land rather than twenty seconds.
**That slowness is the feature**; do not tune it down to make a send feel snappy.

To see where the budget stands:

```bash
# what has been sent today, and the real gaps between sends
python3 -c "import json;[print(json.loads(l)['at'], json.loads(l)['target']) for l in open('send-audit.jsonl')]" | tail -20
```

### Posting by hand

Pacing means a flyer can be ten minutes from landing, quiet hours can hold one
until morning, and nothing sends at all while WhatsApp is unlinked. When
something has to go out now, tap the card on the **Schedule** tab:

1. **Save flyer to Photos** — the queued attachment, fetched back from the
   server over the authenticated `GET /media/:name` route
2. **Copy text** — the exact message, onto the clipboard
3. Post it in WhatsApp yourself
4. **I posted this** — cancels the queued row so Sandesha does not send it
   again, and marks the post Sent on the Board

Step 4 matters. A Board post holds one queued row per audience list, and all of
them are cancelled together — leaving a sibling row queued would send the same
flyer twice.

### Give members a way out

The single cheapest protection is an exit. A block is a scored event against the
number; someone quietly leaving a group is not. Periodically — roughly monthly,
or whenever a group is added to — post a line like:

> _You are receiving centre updates here. If you would rather not, you can leave
> this group at any time, or reply STOP and we will remove you._

Then honour it: remove anyone who replies, same day. Members who know they can
leave rarely block, and the ones who do leave were never going to attend.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 42620 | HTTP server port |
| `SANDESHA_PAIRING_PHONE` | — | Digits-only phone; use pairing code instead of QR |
| `SANDESHA_NOTIFY_EMAIL` | — | Email address to receive pairing codes |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | — | SMTP for pairing-code emails |
| `SANDESHA_SEND_JITTER_MIN_MS` / `_MAX_MS` | 45000 / 90000 | Gap between chats in a fan-out |
| `SANDESHA_BROADCAST_JITTER_MIN_MS` / `_MAX_MS` | 60000 / 120000 | Gap when broadcasting to every group |
| `SANDESHA_QUIET_START_HOUR` / `_END_HOUR` | 22 / 8 | Do-not-send window, IST. Equal values disable it |
| `SANDESHA_MAX_SENDS_PER_HOUR` / `_PER_DAY` | 30 / 120 | Send ceilings; 0 disables |
| `SANDESHA_TYPING_SIMULATION` | 1 | Typing indicator before a send |
| `SANDESHA_CAPTION_VARIATION` | 1 | Vary opener/closer across a fan-out |
| `SANDESHA_SEND_AUDIT` | 1 | Write `send-audit.jsonl` |

### Commands Group

The bot listens to messages in a specific group. Default: "Me Commands"

To change, edit `COMMANDS_GROUP_JID` in `listen.js`:

```javascript
const COMMANDS_GROUP_JID = 'your-group-jid@g.us';
```

## License

MIT

## Support

For issues and questions, check the logs or open an issue on GitHub.

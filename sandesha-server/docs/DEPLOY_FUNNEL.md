# Tailscale Funnel — stable public URL (no domain needed)

Sandesha can expose `http://127.0.0.1:42620` to the internet as:

`https://YOUR-MACHINE.tailXXXX.ts.net`

That hostname **stays the same** across restarts (unlike Cloudflare Quick Tunnel).

## Prerequisites

1. [Install Tailscale](https://tailscale.com/download) (already present on many Linux setups)
2. Log in once:

```bash
sudo tailscale up
```

3. In the [Tailscale admin console](https://login.tailscale.com/admin/acls):
   - Enable **MagicDNS**
   - Enable **HTTPS certificates**
   - Allow **Funnel** (first `tailscale funnel` run often opens a browser prompt to approve this)

## Enable in Sandesha

Add to `.env`:

```env
SANDESHA_TUNNEL_MODE=funnel
SANDESHA_ADMIN_PASSWORD=your-strong-password
# Do NOT leave SANDESHA_AUTH_DISABLED=1 when Funnel is public
```

Start:

```bash
./sandesha.sh start
```

You should see a stable Public URL. It is also emailed when `SANDESHA_NOTIFY_EMAIL` + SMTP are set, and written to `docs/config.js`.

## First-time Funnel approval

`./sandesha.sh start` may print a link like `https://login.tailscale.com/f/funnel?node=…`. That page often returns **404 node not found** if the browser is signed into a different Google/Tailscale account than the laptop.

**Skip that link** and enable Funnel from the admin console, signed in as the same account as `tailscale status` (this laptop: `prakash16180@gmail.com`):

1. [DNS](https://login.tailscale.com/admin/dns) → **Enable HTTPS Certificates** (MagicDNS is already on)
2. [Access controls](https://login.tailscale.com/admin/acls) → add a Funnel node attribute if it is missing:

```json
"nodeAttrs": [
  {
    "target": ["autogroup:member"],
    "attr": ["funnel"]
  }
]
```

3. On this laptop:

```bash
tailscale funnel --bg --yes 42620
./sandesha.sh start
```

Run that as your user, not with `sudo`. Right after Wi-Fi reconnects, Tailscale is briefly in `NoState`, and both `sudo tailscale funnel` and a too-early `tailscale funnel` exit with `unexpected state: NoState`. Wait until `tailscale status` shows this machine, then run it again. `./sandesha.sh start` waits for that state itself.

You can also start Funnel interactively once (`tailscale funnel 42620`) after HTTPS is enabled.

## Useful commands

```bash
tailscale status
tailscale funnel status
tailscale funnel reset          # turn Funnel off
```

## Security

Funnel is **public on the internet**. Always set `SANDESHA_ADMIN_PASSWORD` and remove `SANDESHA_AUTH_DISABLED`.

## Your machine (example)

After setup, this laptop’s URL looks like:

`https://prakash-lenovo-ideapad-s340-14iil.tail2677db.ts.net`

(Exact name comes from `tailscale status --json` → `Self.DNSName`.)

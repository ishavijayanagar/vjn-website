#!/usr/bin/env bash
# Sandesha — start the WhatsApp bot (+ optional public tunnel)
#
# Usage:
#   ./start.sh              Start bot + tunnel (SANDESHA_TUNNEL_MODE; default funnel)
#   ./start.sh --no-tunnel  Start bot only (localhost)
#   ./start.sh --tunnel     Require a public tunnel
#   ./start.sh --reset      Clear WhatsApp session and force new pairing / QR
#   ./start.sh --help

set -euo pipefail

cd "$(dirname "$0")"
SESSION_DIR="$(pwd)/.wwebjs_auth/session"
LOCK_FILE="$(pwd)/.lock"
LISTEN_PORT=42620
TUNNEL_QUICK_CONFIG="$(pwd)/scripts/sandesha-tunnel.yml"
TUNNEL_NAMED_CONFIG="$(pwd)/scripts/sandesha-named-tunnel.yml"
TUNNEL_LOG="$(pwd)/.tunnel.log"
TUNNEL_URL_FILE="$(pwd)/.tunnel-url"
API_URL="http://127.0.0.1:${LISTEN_PORT}"

NODE_PID=""
TUNNEL_PID=""
SHUTTING_DOWN=0

env_get() {
  local key="$1"
  local line
  [[ -f .env ]] || return 0
  line="$(grep -E "^[[:space:]]*${key}=" .env | tail -1 || true)"
  [[ -n "$line" ]] || return 0
  line="${line#*=}"
  line="${line%%$'\r'}"
  line="${line#\"}"
  line="${line%\"}"
  line="${line#\'}"
  line="${line%\'}"
  printf '%s' "$line"
}

usage() {
  cat <<'EOF'
Sandesha start script

  ./start.sh              Start bot + public tunnel (per SANDESHA_TUNNEL_MODE)
  ./start.sh --no-tunnel  Start bot only on http://127.0.0.1:42620
  ./start.sh --tunnel     Require a public tunnel
  ./start.sh --reset      Delete WhatsApp session and pair / scan QR again
  ./start.sh --help       Show this help

Tunnel modes (.env SANDESHA_TUNNEL_MODE):
  funnel   Tailscale Funnel — stable https://*.ts.net (no domain needed) [recommended]
  quick    Cloudflare Quick Tunnel — random URL each restart
  named    Cloudflare named tunnel — needs your own domain

See docs/DEPLOY_FUNNEL.md for Tailscale Funnel setup.

Only one instance can run at a time.
Tip: Do NOT use --reset for normal restarts — that forces a new WhatsApp login.
EOF
}

wait_for_pids_gone() {
  local pattern="$1"
  local seconds="${2:-15}"
  local i
  for ((i = 0; i < seconds; i++)); do
    if ! pgrep -f "$pattern" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

stop_tunnel() {
  # Match Sandesha cloudflared (quick or named) — not unrelated cloudflared services
  if pgrep -f "cloudflared.*(sandesha-tunnel|sandesha-named-tunnel|127\.0\.0\.1:${LISTEN_PORT})" >/dev/null 2>&1; then
    echo "      Stopping existing Cloudflare tunnel..."
    pkill -TERM -f "cloudflared.*sandesha-tunnel" 2>/dev/null || true
    pkill -TERM -f "cloudflared.*sandesha-named-tunnel" 2>/dev/null || true
    pkill -TERM -f "cloudflared.*127\.0\.0\.1:${LISTEN_PORT}" 2>/dev/null || true
    wait_for_pids_gone "cloudflared.*(sandesha-tunnel|sandesha-named-tunnel|127\.0\.0\.1:${LISTEN_PORT})" 8 || \
      pkill -9 -f "cloudflared.*(sandesha-tunnel|sandesha-named-tunnel|127\.0\.0\.1:${LISTEN_PORT})" 2>/dev/null || true
  fi
  rm -f "$TUNNEL_URL_FILE"
}

stop_existing() {
  echo "[1/4] Stopping any existing Sandesha processes..."

  stop_tunnel

  # Prefer graceful SIGTERM so listen.js can client.destroy() and flush LocalAuth.
  if pgrep -f "node listen.js" >/dev/null 2>&1; then
    pkill -TERM -f "node listen.js" 2>/dev/null || true
    if ! wait_for_pids_gone "node listen.js" 20; then
      echo "      listen.js still running — forcing stop"
      pkill -9 -f "node listen.js" 2>/dev/null || true
      sleep 1
    fi
  fi

  if pgrep -f "user-data-dir=${SESSION_DIR}" >/dev/null 2>&1; then
    echo "      Stopping leftover Chromium (session profile)..."
    pkill -TERM -f "user-data-dir=${SESSION_DIR}" 2>/dev/null || true
    if ! wait_for_pids_gone "user-data-dir=${SESSION_DIR}" 10; then
      echo "      WARNING: force-killing Chromium may corrupt the saved login"
      pkill -9 -f "user-data-dir=${SESSION_DIR}" 2>/dev/null || true
      sleep 1
    fi
  fi

  rm -f "$LOCK_FILE"

  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${LISTEN_PORT}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti ":${LISTEN_PORT}" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  fi
  sleep 1
}

reset_session() {
  echo "[2/4] Clearing WhatsApp session (.wwebjs_auth)..."
  echo "      You will need a new pairing code / QR."
  echo "      Your phone may still list the old linked device — remove it under"
  echo "      Linked devices if it stays after re-login."
  rm -rf "$(pwd)/.wwebjs_auth"
  rm -f "$(pwd)/qr-code.png"
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Error: node not found. Install Node.js 18+ and try again."
    exit 1
  fi
}

load_env_auth_hint() {
  if [[ -f .env ]] && grep -Eq '^[[:space:]]*SANDESHA_AUTH_DISABLED=(1|true)' .env; then
    echo "WARNING: SANDESHA_AUTH_DISABLED is set — a public tunnel would be open without a password."
    echo "         Set SANDESHA_ADMIN_PASSWORD and remove AUTH_DISABLED before exposing the tunnel."
  fi
}

wait_for_api() {
  local i
  echo "      Waiting for API on ${API_URL} ..."
  for ((i = 1; i <= 90; i++)); do
    if curl -sf "${API_URL}/health" >/dev/null 2>&1; then
      echo "      API is up."
      return 0
    fi
    if [[ -n "$NODE_PID" ]] && ! kill -0 "$NODE_PID" 2>/dev/null; then
      echo "Error: listen.js exited before API became ready. Check sandesha.log"
      return 1
    fi
    sleep 1
  done
  echo "WARNING: API not ready after 90s — starting tunnel anyway (may 502 until WhatsApp connects)"
  return 0
}

extract_tunnel_url() {
  # cloudflared prints the trycloudflare URL once the edge assigns it
  if [[ -f "$TUNNEL_LOG" ]]; then
    grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -1 || true
  fi
}

# Write public URL into docs/config.js (the local dashboard served by listen.js).
update_docs_config_url() {
  local url="$1"
  local config_file="$(pwd)/docs/config.js"
  mkdir -p "$(pwd)/docs"
  cat > "$config_file" <<EOF
window.SANDESHA_CONFIG = {
  apiUrl: '${url}',
};
EOF
  echo "      Updated docs/config.js → apiUrl: ${url}"
}

# Write public URL into the VJN site's config.js — this is the one GitHub Pages
# serves, so it must be committed and pushed for the live site to follow.
update_site_config_url() {
  local url="$1"
  local config_file="$(pwd)/../config.js"

  if [[ ! -f "$config_file" ]]; then
    echo "      Skipped site config.js (not found at ${config_file})"
    return 0
  fi

  local current
  current="$(node -e '
    const fs = require("fs");
    const m = fs.readFileSync(process.argv[1], "utf8")
      .match(/const SANDESHA_API_URL = "([^"]*)"/);
    process.stdout.write(m ? m[1] : "");
  ' "$config_file" 2>/dev/null || true)"

  if [[ -z "$current" ]]; then
    echo "      WARNING: no SANDESHA_API_URL found in ../config.js — set it manually to ${url}"
    return 0
  fi

  if [[ "$current" == "$url" ]]; then
    echo "      Site config.js already points at ${url}"
    return 0
  fi

  node -e '
    const fs = require("fs");
    const [file, url] = process.argv.slice(1);
    const src = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, src.replace(
      /const SANDESHA_API_URL = "[^"]*";/,
      `const SANDESHA_API_URL = "${url}";`
    ));
  ' "$config_file" "$url"

  echo "      Updated ../config.js → SANDESHA_API_URL: ${url}"
  echo "      (was: ${current})"
  echo "      ACTION NEEDED: commit and push config.js so the GitHub Pages site uses the new URL."
}

email_dashboard_url() {
  local url="$1"
  echo "      Emailing dashboard URL..."
  if node notify-email.js dashboard "$url"; then
    :
  else
    echo "      WARNING: could not email dashboard URL (check SMTP_* in .env)"
  fi
}

publish_public_url() {
  local url="$1"
  local mode_label="${2:-tunnel}"
  url="${url%/}"
  printf '%s\n' "$url" > "$TUNNEL_URL_FILE"
  update_docs_config_url "$url"
  update_site_config_url "$url"
  email_dashboard_url "$url"
  echo
  echo "========================================"
  echo " Public URL:  $url"
  echo " Local UI:    ${API_URL}/"
  echo " Mode:        ${mode_label}"
  echo "========================================"
  echo
}

get_tailscale_dns_url() {
  local dns
  dns="$(tailscale status --json 2>/dev/null | node -e '
    let d=""; process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(d);
        const name = (j.Self && j.Self.DNSName) ? String(j.Self.DNSName).replace(/\.$/, "") : "";
        if (name) process.stdout.write("https://" + name);
      } catch {}
    });
  ')"
  printf '%s' "$dns"
}

get_funnel_url() {
  # Prefer current MagicDNS name (hostname renames leave old Funnel URLs in status).
  local dns url
  dns="$(get_tailscale_dns_url)"
  if [[ -n "$dns" ]]; then
    printf '%s' "$dns"
    return 0
  fi
  url="$(tailscale funnel status 2>/dev/null | grep -oE 'https://[a-zA-Z0-9.-]+\.ts\.net' | head -1 || true)"
  printf '%s' "$url"
}

# True if Funnel already proxies our local API (sudo not needed to read status).
funnel_already_serving() {
  tailscale funnel status 2>/dev/null | grep -qE "http://127\.0\.0\.1:${LISTEN_PORT}|http://localhost:${LISTEN_PORT}"
}

# `tailscale funnel --bg --yes` waits forever if Funnel isn't allowed on the
# tailnet, and hides the enable URL when stdout is captured. Cap the wait.
run_funnel_cmd() {
  local rc=0
  if command -v timeout >/dev/null 2>&1; then
    timeout 20 "$@" 2>&1 || rc=$?
  else
    "$@" 2>&1 || rc=$?
  fi
  return "$rc"
}

enable_funnel() {
  # Prefer non-sudo; fall back to passwordless sudo if operator isn't set.
  local out rc=0
  out="$(run_funnel_cmd tailscale funnel --bg --yes "${LISTEN_PORT}")" || rc=$?
  if [[ "$rc" -ne 0 ]] && echo "$out" | grep -qiE 'Access denied|serve config denied|Use '\''sudo'; then
    if sudo -n true 2>/dev/null; then
      out="$(run_funnel_cmd sudo -n tailscale funnel --bg --yes "${LISTEN_PORT}")" || rc=$?
    fi
  fi
  printf '%s\n' "$out"
  return "$rc"
}

print_local_dashboard() {
  echo
  echo "========================================"
  echo " Local UI:    ${API_URL}/"
  echo " Public URL:  not ready (Funnel not enabled)"
  echo "========================================"
  echo
}

start_funnel_tunnel() {
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "Error: tailscale not found. Install: https://tailscale.com/download"
    exit 1
  fi
  if ! tailscale status >/dev/null 2>&1; then
    echo "Error: Tailscale is not connected. Run: sudo tailscale up"
    echo "  Then enable Funnel (first time): sudo tailscale funnel --bg --yes ${LISTEN_PORT}"
    echo "  Docs: docs/DEPLOY_FUNNEL.md"
    exit 1
  fi

  load_env_auth_hint
  : > "$TUNNEL_LOG"
  rm -f "$TUNNEL_URL_FILE"

  echo "[4/4] Starting Tailscale Funnel (stable *.ts.net URL)..."

  # Funnel may already be running from a prior `sudo tailscale funnel ...`.
  if funnel_already_serving; then
    echo "      Funnel already proxying :${LISTEN_PORT} — reusing it."
    publish_public_url "$(get_funnel_url)" "Tailscale Funnel (stable across restarts)"
    return 0
  fi

  local funnel_out="" funnel_rc=0
  set +e
  funnel_out="$(enable_funnel)"
  funnel_rc=$?
  set -e
  printf '%s\n' "$funnel_out" >>"$TUNNEL_LOG"
  # Show Tailscale's enable URL instead of swallowing it in the log.
  if [[ -n "$funnel_out" ]]; then
    echo "$funnel_out" | sed 's/^/      /'
  fi

  # Race / permission: enable failed but Funnel is already up — treat as OK.
  if funnel_already_serving; then
    echo "      Funnel is serving :${LISTEN_PORT}."
    publish_public_url "$(get_funnel_url)" "Tailscale Funnel (stable across restarts)"
    return 0
  fi

  if [[ "$funnel_rc" -ne 0 ]] || echo "$funnel_out" | grep -qiE 'not enabled|To enable, visit|access denied|HTTPS must be enabled|serve config denied'; then
    echo "WARNING: Funnel is not enabled yet — continuing with localhost only."
    echo
    echo "If the Funnel link 404s (\"node not found\"), skip it. In a browser signed in as"
    echo "the same Tailscale account as this laptop:"
    echo "  1. https://login.tailscale.com/admin/dns  → Enable HTTPS Certificates"
    echo "  2. https://login.tailscale.com/admin/acls → add Funnel (see docs/DEPLOY_FUNNEL.md)"
    echo "  3. Then: sudo tailscale funnel --bg --yes ${LISTEN_PORT}"
    echo "     and run ./start.sh again"
    echo "Optional (so start.sh can manage Funnel without sudo):"
    echo "  sudo tailscale set --operator=\$USER"
    print_local_dashboard
    return 0
  fi

  local i url=""
  for ((i = 1; i <= 20; i++)); do
    url="$(get_funnel_url)"
    if [[ -n "$url" ]] && funnel_already_serving; then
      publish_public_url "$url" "Tailscale Funnel (stable across restarts)"
      return 0
    fi
    if [[ -n "$url" && "$i" -ge 5 ]]; then
      if tailscale funnel status 2>/dev/null | grep -qv 'No serve config'; then
        publish_public_url "$url" "Tailscale Funnel (stable across restarts)"
        return 0
      fi
    fi
    sleep 1
  done

  if [[ -n "$(get_funnel_url)" ]] && ! tailscale funnel status 2>/dev/null | grep -q 'No serve config'; then
    publish_public_url "$(get_funnel_url)" "Tailscale Funnel (stable across restarts)"
    return 0
  fi

  echo "WARNING: Funnel command ran but serve config is empty."
  echo "  Enable Funnel in admin, then: sudo tailscale funnel --bg --yes ${LISTEN_PORT}"
  echo "  Status: $(tailscale funnel status 2>&1 | tr '\n' ' ')"
  print_local_dashboard
  return 0
}

start_named_tunnel() {
  local public_url
  public_url="$(env_get SANDESHA_PUBLIC_URL)"
  if [[ -z "$public_url" ]]; then
    echo "Error: SANDESHA_TUNNEL_MODE=named requires SANDESHA_PUBLIC_URL in .env"
    echo "  Example: SANDESHA_PUBLIC_URL=https://sandesha.yourdomain.com"
    exit 1
  fi
  if [[ ! -f "$TUNNEL_NAMED_CONFIG" ]]; then
    echo "Error: missing $TUNNEL_NAMED_CONFIG"
    echo "  Copy scripts/sandesha-named-tunnel.yml.example → sandesha-named-tunnel.yml and fill in."
    echo "  Full steps: docs/DEPLOY_CLOUDFLARE.md (Option B)"
    exit 1
  fi
  if grep -q 'REPLACE_WITH_TUNNEL_UUID\|YOURDOMAIN\|REPLACE_USER' "$TUNNEL_NAMED_CONFIG"; then
    echo "Error: $TUNNEL_NAMED_CONFIG still has placeholder values — edit it first."
    exit 1
  fi
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "Error: cloudflared not found (needed for named mode)"
    exit 1
  fi

  load_env_auth_hint
  : > "$TUNNEL_LOG"
  rm -f "$TUNNEL_URL_FILE"

  echo "[4/4] Starting Cloudflare named tunnel (stable URL)..."
  cloudflared tunnel --config "$TUNNEL_NAMED_CONFIG" run >>"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  sleep 2
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "Error: named tunnel exited early. Last log lines:"
    tail -n 40 "$TUNNEL_LOG" || true
    exit 1
  fi

  publish_public_url "$public_url" "Cloudflare named tunnel (stable)"
}

start_quick_tunnel() {
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "Error: cloudflared not found. Use SANDESHA_TUNNEL_MODE=funnel instead."
    exit 1
  fi
  if [[ ! -f "$TUNNEL_QUICK_CONFIG" ]]; then
    echo "Error: missing $TUNNEL_QUICK_CONFIG"
    exit 1
  fi

  load_env_auth_hint
  : > "$TUNNEL_LOG"
  rm -f "$TUNNEL_URL_FILE"

  echo "[4/4] Starting Cloudflare Quick Tunnel (URL changes every restart)..."
  echo "      Tip: prefer SANDESHA_TUNNEL_MODE=funnel for a stable URL without a domain."
  cloudflared tunnel --config "$TUNNEL_QUICK_CONFIG" --url "$API_URL" >>"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!

  local i url=""
  for ((i = 1; i <= 45; i++)); do
    url="$(extract_tunnel_url)"
    if [[ -n "$url" ]]; then
      publish_public_url "$url" "Cloudflare Quick Tunnel (changes on restart)"
      return 0
    fi
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      echo "Error: cloudflared exited early. Last log lines:"
      tail -n 30 "$TUNNEL_LOG" || true
      exit 1
    fi
    sleep 1
  done

  echo "WARNING: tunnel started but URL not parsed yet — check:"
  echo "  tail -f $TUNNEL_LOG"
}

start_public_tunnel() {
  local mode
  mode="$(env_get SANDESHA_TUNNEL_MODE)"
  mode="$(echo "${mode:-funnel}" | tr '[:upper:]' '[:lower:]')"

  case "$mode" in
    funnel|tailscale) start_funnel_tunnel ;;
    named) start_named_tunnel ;;
    quick|cloudflare) start_quick_tunnel ;;
    *)
      echo "Unknown SANDESHA_TUNNEL_MODE='$mode' (use funnel, quick, or named)"
      exit 1
      ;;
  esac
}

cleanup() {
  if [[ "$SHUTTING_DOWN" -eq 1 ]]; then
    return
  fi
  SHUTTING_DOWN=1
  echo
  echo "[SHUTDOWN] Stopping Sandesha..."

  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill -TERM "$TUNNEL_PID" 2>/dev/null || true
  fi
  stop_tunnel

  if [[ -n "$NODE_PID" ]] && kill -0 "$NODE_PID" 2>/dev/null; then
    # Graceful — listen.js destroys Puppeteer and keeps WhatsApp login
    kill -TERM "$NODE_PID" 2>/dev/null || true
    local i
    for ((i = 0; i < 25; i++)); do
      kill -0 "$NODE_PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$NODE_PID" 2>/dev/null; then
      echo "[SHUTDOWN] listen.js still running — forcing stop"
      kill -9 "$NODE_PID" 2>/dev/null || true
    fi
  fi

  rm -f "$LOCK_FILE"
  echo "[SHUTDOWN] Done."
}

main() {
  local reset=false
  local tunnel_mode=auto   # auto | on | off

  for arg in "$@"; do
    case "$arg" in
      --reset|-r) reset=true ;;
      --tunnel) tunnel_mode=on ;;
      --no-tunnel) tunnel_mode=off ;;
      --help|-h) usage; exit 0 ;;
      *)
        echo "Unknown option: $arg"
        usage
        exit 1
        ;;
    esac
  done

  if [[ "$tunnel_mode" == "auto" ]]; then
    local preferred
    preferred="$(env_get SANDESHA_TUNNEL_MODE)"
    preferred="$(echo "${preferred:-funnel}" | tr '[:upper:]' '[:lower:]')"
    if [[ "$preferred" == "funnel" || "$preferred" == "tailscale" ]] && command -v tailscale >/dev/null 2>&1; then
      tunnel_mode=on
    elif [[ "$preferred" == "named" || "$preferred" == "quick" || "$preferred" == "cloudflare" ]] && command -v cloudflared >/dev/null 2>&1; then
      tunnel_mode=on
    elif command -v tailscale >/dev/null 2>&1; then
      tunnel_mode=on
    elif command -v cloudflared >/dev/null 2>&1; then
      tunnel_mode=on
    else
      tunnel_mode=off
      echo "Note: neither Tailscale nor cloudflared found — localhost only."
      echo "      Install Tailscale for Funnel (recommended): https://tailscale.com/download"
      echo
    fi
  fi

  echo "========================================"
  echo " Sandesha Bot — Starting"
  echo "========================================"
  echo

  check_node
  stop_existing

  if $reset; then
    reset_session
  else
    if [[ -d "$(pwd)/.wwebjs_auth/session" ]]; then
      echo "[2/4] Keeping saved WhatsApp session (login will restore automatically)"
    else
      echo "[2/4] No saved session yet — pairing / QR required on first connect"
    fi
    echo "      (Use ./start.sh --reset only when you intentionally want to re-link)"
  fi

  if [[ ! -d node_modules ]]; then
    echo "Installing dependencies..."
    npm install
  fi

  trap cleanup EXIT INT TERM

  echo "[3/4] Starting listen.js..."
  echo "      Pairing / QR only appears if there is no valid saved session"
  echo "      Press Ctrl+C to stop (saves WhatsApp login)"
  echo

  node listen.js &
  NODE_PID=$!

  wait_for_api

  if [[ "$tunnel_mode" == "on" ]]; then
    start_public_tunnel
  else
    echo "[4/4] Tunnel skipped (--no-tunnel). Dashboard: ${API_URL}/"
  fi

  # Keep script alive until listen.js exits; cleanup trap stops cloudflared if used
  wait "$NODE_PID"
  NODE_PID=""
}

main "$@"

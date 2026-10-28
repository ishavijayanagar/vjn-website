#!/usr/bin/env bash
# Sandesha — run the WhatsApp backend on the Pi.
#
#   ./sandesha.sh start            Start in the background (and make sure the public URL is on)
#   ./sandesha.sh stop             Stop it gracefully (keeps the WhatsApp login)
#   ./sandesha.sh restart          Stop, then start
#   ./sandesha.sh status           Running? WhatsApp connected? public URL?
#   ./sandesha.sh logs             Follow the output (pairing code / QR appear here)
#   ./sandesha.sh reset-whatsapp   Forget the WhatsApp login and link a new phone
#
# Always stop with this script (SIGTERM), never kill -9: a hard kill can corrupt
# the saved WhatsApp login and force a re-link.

set -uo pipefail
cd "$(dirname "$0")"

PORT=42620
API="http://127.0.0.1:${PORT}"
PID_FILE=".sandesha.pid"
OUT_FILE="sandesha.out"
SESSION_DIR="$(pwd)/.wwebjs_auth/session"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# PID of the running backend, whoever started it.
running_pid() {
  local pid=""
  [[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE" 2>/dev/null)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    printf '%s' "$pid"
    return 0
  fi
  pgrep -f "^([^ ]*/)?node ([^ ]*/)?listen\.js$" | head -1
}

check_prereqs() {
  command -v node >/dev/null 2>&1 || die "node not found. Install Node.js 18+."
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet sandesha 2>/dev/null; then
    die "a systemd service called 'sandesha' is running and would fight this script. Run: sudo systemctl disable --now sandesha"
  fi
  if [[ -z "${PUPPETEER_EXECUTABLE_PATH:-}" ]]; then
    for c in /usr/bin/chromium /usr/bin/chromium-browser; do
      if [[ -x "$c" ]]; then export PUPPETEER_EXECUTABLE_PATH="$c"; break; fi
    done
  fi
}

wait_gone() { # wait_gone <pid> <seconds>
  local i
  for ((i = 0; i < $2; i++)); do
    kill -0 "$1" 2>/dev/null || return 0
    sleep 1
  done
  return 1
}

public_url() {
  command -v tailscale >/dev/null 2>&1 || return 0
  tailscale status --json 2>/dev/null | node -e '
    let d = ""; process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => { try {
      const n = String(JSON.parse(d).Self.DNSName || "").replace(/\.$/, "");
      if (n) process.stdout.write("https://" + n);
    } catch {} });'
}

ensure_funnel() {
  command -v tailscale >/dev/null 2>&1 || { say "  (tailscale not installed — local only)"; return 0; }
  if ! tailscale funnel status 2>/dev/null | grep -q "127.0.0.1:${PORT}\|localhost:${PORT}"; then
    say "  Turning the public URL on (tailscale funnel)..."
    timeout 20 tailscale funnel --bg --yes "$PORT" >/dev/null 2>&1 \
      || timeout 20 sudo -n tailscale funnel --bg --yes "$PORT" >/dev/null 2>&1 \
      || say "  Could not enable Funnel automatically. Run once: sudo tailscale funnel --bg --yes ${PORT}"
  fi
  local url; url="$(public_url)"
  [[ -n "$url" ]] && say "  Public URL: ${url}"
}

do_start() {
  check_prereqs
  local pid; pid="$(running_pid)"
  if [[ -n "$pid" ]]; then
    say "Already running (pid ${pid}). Use './sandesha.sh restart' to restart."
    return 0
  fi
  [[ -d node_modules ]] || { say "Installing dependencies..."; npm install || die "npm install failed"; }
  rm -f .lock   # a power cut leaves a stale lock; nothing is running, so it is safe

  say "Starting Sandesha..."
  nohup node listen.js >>"$OUT_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  disown 2>/dev/null || true

  local i
  for ((i = 1; i <= 90; i++)); do
    if curl -sf "${API}/health" >/dev/null 2>&1; then
      say "  Up (pid $(cat "$PID_FILE")). Local: ${API}/"
      ensure_funnel
      return 0
    fi
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      say "Error: it exited while starting. Last lines of ${OUT_FILE}:"
      tail -n 25 "$OUT_FILE"
      rm -f "$PID_FILE"
      return 1
    fi
    sleep 1
  done
  say "Started, but the API is not answering after 90s. WhatsApp may still be connecting — check './sandesha.sh logs'."
}

do_stop() {
  local pid; pid="$(running_pid)"
  if [[ -z "$pid" ]]; then
    say "Not running."
  else
    say "Stopping (pid ${pid}) — letting it save the WhatsApp login..."
    kill -TERM "$pid" 2>/dev/null || true
    if ! wait_gone "$pid" 30; then
      say "  Still running after 30s — forcing stop."
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  # A leftover Chromium would hold the login profile and block the next start.
  if pgrep -f "user-data-dir=${SESSION_DIR}" >/dev/null 2>&1; then
    pkill -TERM -f "user-data-dir=${SESSION_DIR}" 2>/dev/null || true
    sleep 3
    pkill -9 -f "user-data-dir=${SESSION_DIR}" 2>/dev/null || true
  fi
  rm -f "$PID_FILE" .lock
  say "Stopped."
}

do_status() {
  local pid; pid="$(running_pid)"
  if [[ -z "$pid" ]]; then
    say "Sandesha: NOT running"
    return 1
  fi
  say "Sandesha: running (pid ${pid})"
  local health; health="$(curl -sf --max-time 5 "${API}/health" 2>/dev/null)"
  if [[ -z "$health" ]]; then
    say "  API: not answering yet"
  else
    printf '%s' "$health" | node -e '
      let d = ""; process.stdin.on("data", c => d += c);
      process.stdin.on("end", () => { try {
        const h = JSON.parse(d); const w = h.whatsapp || {};
        console.log("  API: ok");
        console.log("  WhatsApp: " + (w.connected ? "connected" : "NOT connected" + (w.state ? " (" + w.state + ")" : "")));
      } catch { console.log("  API: " + d.slice(0, 120)); } });'
  fi
  local url; url="$(public_url)"
  [[ -n "$url" ]] && say "  Public URL: ${url}"
  return 0
}

do_reset_whatsapp() {
  local yes=false
  [[ "${1:-}" == "-y" || "${1:-}" == "--yes" ]] && yes=true
  say "This forgets the current WhatsApp login. You will have to link a phone again,"
  say "and Sandesha cannot send or read messages until you do."
  if ! $yes; then
    read -r -p "Continue? [y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || { say "Cancelled."; return 0; }
  fi
  do_stop
  rm -rf .wwebjs_auth qr-code.png
  say "WhatsApp login cleared."
  do_start || return 1
  cat <<'EOF2'

Now link the phone:
  1. Watch for the pairing code / QR:   ./sandesha.sh logs
     (or open Messaging in the admin site — it shows the pairing state)
  2. On the phone: WhatsApp → Settings → Linked devices → Link a device.
     With SANDESHA_PAIRING_PHONE set in .env you get a code to type in
     ("Link with phone number instead"); otherwise scan the QR.
  3. Remove the old "Sandesha" entry under Linked devices if it is still listed.
The QR expires in about a minute; if it does, run this again.
EOF2
}

case "${1:-help}" in
  start)            do_start ;;
  stop)             do_stop ;;
  restart)          do_stop; do_start ;;
  status)           do_status ;;
  logs)             touch "$OUT_FILE"; exec tail -n 60 -f "$OUT_FILE" ;;
  reset-whatsapp)   shift; do_reset_whatsapp "$@" ;;
  help|-h|--help|*) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' ;;
esac

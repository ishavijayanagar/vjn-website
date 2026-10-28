#!/usr/bin/env bash
# Sandesha — run the WhatsApp backend on the Pi.
#
# Works two ways, picked automatically:
#   • systemd  — if a "sandesha" service is installed (starts on boot, restarts on crash)
#   • direct   — otherwise runs in the background itself
#
# After `./sandesha.sh install-command` you can run it from ANY directory as `sandesha`.

set -uo pipefail
SCRIPT="$(readlink -f "${BASH_SOURCE[0]}")"
cd "$(dirname "$SCRIPT")"

NAME="$(basename "$0")"
PORT=42620
API="http://127.0.0.1:${PORT}"
PID_FILE=".sandesha.pid"
OUT_FILE="sandesha.out"
SESSION_DIR="$(pwd)/.wwebjs_auth/session"
UNIT="sandesha"
DB_FILE="${SANDESHA_DB_FILE:-$(pwd)/sandesha.db}"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOT
Sandesha — WhatsApp backend

  ${NAME} start             Start it (and make sure the public URL is on)
  ${NAME} stop              Stop it gracefully (keeps the WhatsApp login)
  ${NAME} restart           Stop, then start (use after pulling new code)
  ${NAME} status            Running? WhatsApp connected? public URL? starts on boot?
  ${NAME} logs              Follow the output (pairing code / QR appear here)
  ${NAME} reset-whatsapp    Forget the WhatsApp login and link a new phone  [-y to skip the prompt]
  ${NAME} db                Database: size, rows per table, latest backup, changes waiting for the Sheet
  ${NAME} backup            Safe copy of the database into backups/ (keeps the newest 14)
  ${NAME} install-backup    Back up automatically every night at 3am (cron)
  ${NAME} restore <file>    Put a backup back (stops Sandesha, restores, starts it)
  ${NAME} install-command   Make 'sandesha' work from any directory
  ${NAME} install-service   Start on boot and restart on crash (systemd)
  ${NAME} help              This list

Always stop with this script (SIGTERM), never kill -9: a hard kill can corrupt the
saved WhatsApp login and force a re-link.
EOT
}

use_systemd() {
  command -v systemctl >/dev/null 2>&1 && systemctl cat "$UNIT" >/dev/null 2>&1
}

svc() { # svc <systemctl verb>
  if [[ "$(id -u)" -eq 0 ]]; then systemctl "$1" "$UNIT"; else sudo systemctl "$1" "$UNIT"; fi
}

# PID of the running backend, whoever started it.
running_pid() {
  local pid=""
  if use_systemd; then
    pid="$(systemctl show -p MainPID --value "$UNIT" 2>/dev/null)"
    [[ -n "$pid" && "$pid" != "0" ]] && printf '%s' "$pid"
    return 0
  fi
  [[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE" 2>/dev/null)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    printf '%s' "$pid"
    return 0
  fi
  pgrep -f "^([^ ]*/)?node ([^ ]*/)?listen\.js$" | head -1
}

check_prereqs() {
  command -v node >/dev/null 2>&1 || die "node not found. Install Node.js 18+."
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

wait_for_api() { # wait_for_api <still-alive-check command...>
  local i
  for ((i = 1; i <= 90; i++)); do
    if curl -sf "${API}/health" >/dev/null 2>&1; then return 0; fi
    "$@" || return 2
    sleep 1
  done
  return 1
}

do_start() {
  check_prereqs
  local pid; pid="$(running_pid)"
  if [[ -n "$pid" ]]; then
    say "Already running (pid ${pid}). Use '${NAME} restart' to restart."
    return 0
  fi
  [[ -d node_modules ]] || { say "Installing dependencies..."; npm install || die "npm install failed"; }

  if use_systemd; then
    say "Starting Sandesha (systemd service)..."
    svc start || die "could not start the service"
    wait_for_api systemctl is-active --quiet "$UNIT"
  else
    rm -f .lock   # a power cut leaves a stale lock; nothing is running, so it is safe
    say "Starting Sandesha..."
    nohup node listen.js >>"$OUT_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    disown 2>/dev/null || true
    wait_for_api kill -0 "$(cat "$PID_FILE")"
  fi
  case $? in
    0) say "  Up (pid $(running_pid)). Local: ${API}/"; ensure_funnel ;;
    2) say "Error: it exited while starting."
       if use_systemd; then journalctl -u "$UNIT" -n 25 --no-pager 2>/dev/null; else tail -n 25 "$OUT_FILE"; rm -f "$PID_FILE"; fi
       return 1 ;;
    *) say "Started, but the API is not answering after 90s. WhatsApp may still be connecting — check '${NAME} logs'." ;;
  esac
}

do_stop() {
  local pid; pid="$(running_pid)"
  if [[ -z "$pid" ]]; then
    say "Not running."
  elif use_systemd; then
    say "Stopping the service — letting it save the WhatsApp login..."
    svc stop || true
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
  if use_systemd; then
    say "Managed by: systemd ($(systemctl is-enabled "$UNIT" 2>/dev/null || echo unknown) on boot)"
  else
    say "Managed by: this script (NOT started on boot — run '${NAME} install-service')"
  fi
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

do_logs() {
  if use_systemd; then
    journalctl -u "$UNIT" -n 60 -f 2>/dev/null || exec sudo journalctl -u "$UNIT" -n 60 -f
  else
    touch "$OUT_FILE"
    exec tail -n 60 -f "$OUT_FILE"
  fi
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
  cat <<EOT

Now link the phone:
  1. Watch for the pairing code / QR:   ${NAME} logs
     (or open Messaging in the admin site — it shows the pairing state)
  2. On the phone: WhatsApp → Settings → Linked devices → Link a device.
     With SANDESHA_PAIRING_PHONE set in .env you get a code to type in
     ("Link with phone number instead"); otherwise scan the QR.
  3. Remove the old "Sandesha" entry under Linked devices if it is still listed.
The QR expires in about a minute; if it does, run this again.
EOT
}

do_db() {
  [[ -f "$DB_FILE" ]] || die "no database at ${DB_FILE} (it is created the first time Sandesha starts)."
  node scripts/db-status.js || return 1
  local last; last="$(ls -1t "$(dirname "$DB_FILE")"/backups/sandesha-*.db 2>/dev/null | head -1)"
  if [[ -n "$last" ]]; then say "Latest backup: ${last}"; else say "Latest backup: none yet — run '${NAME} backup'"; fi
  crontab -l 2>/dev/null | grep -q "backup-db.js" && say "Nightly backup: on" || say "Nightly backup: OFF — run '${NAME} install-backup'"
}

do_backup() {
  check_prereqs
  node scripts/backup-db.js
}

do_install_backup() {
  local line="0 3 * * * cd $(pwd) && node scripts/backup-db.js >> $(pwd)/backups.log 2>&1"
  if crontab -l 2>/dev/null | grep -q "scripts/backup-db.js"; then
    say "Nightly backup is already set up."
    return 0
  fi
  ( crontab -l 2>/dev/null; echo "$line" ) | crontab - || die "could not write the crontab"
  say "Done: the database is backed up every night at 3am into $(pwd)/backups/"
}

do_restore() {
  local f="${1:-}"
  [[ -n "$f" ]] || { say "Usage: ${NAME} restore <backup file>   (see: ls backups/)"; return 1; }
  [[ -f "$f" ]] || die "no such file: ${f}"
  say "This replaces the current database with ${f}."
  say "Anything saved since that backup is lost (a safety copy of the current one is kept)."
  read -r -p "Continue? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { say "Cancelled."; return 0; }
  local was_running=false
  [[ -n "$(running_pid)" ]] && was_running=true
  if $was_running; then do_stop; fi
  [[ -f "$DB_FILE" ]] && cp "$DB_FILE" "${DB_FILE}.before-restore"
  cp "$f" "$DB_FILE"
  rm -f "${DB_FILE}-wal" "${DB_FILE}-shm"
  say "Restored."
  if $was_running; then do_start; fi
}

do_install_command() {
  local target=/usr/local/bin/sandesha
  if [[ "$(id -u)" -eq 0 ]]; then ln -sf "$SCRIPT" "$target"; else sudo ln -sf "$SCRIPT" "$target"; fi
  say "Done. From any directory you can now run:  sandesha help"
  say "(It cannot be called 'help' — that is a built-in shell command.)"
}

do_install_service() {
  command -v systemctl >/dev/null 2>&1 || die "systemd not found on this machine."
  local user chrome unit_file=/etc/systemd/system/${UNIT}.service
  user="$(id -un)"
  chrome="${PUPPETEER_EXECUTABLE_PATH:-}"
  [[ -z "$chrome" ]] && for c in /usr/bin/chromium /usr/bin/chromium-browser; do [[ -x "$c" ]] && chrome="$c" && break; done
  if use_systemd; then
    say "A '${UNIT}' service is already installed (${unit_file}); leaving it as it is."
    say "To replace it: sudo systemctl disable --now ${UNIT} && sudo rm ${unit_file}, then run this again."
    return 0
  fi
  # Stop a directly-run copy first so the two do not fight over the WhatsApp session.
  [[ -n "$(running_pid)" ]] && do_stop
  local body
  body="[Unit]
Description=Sandesha WhatsApp backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=$(pwd)
EnvironmentFile=-$(pwd)/.env
Environment=NODE_ENV=production
$([[ -n "$chrome" ]] && echo "Environment=PUPPETEER_EXECUTABLE_PATH=${chrome}")
# A hard power cut leaves a stale lock behind and the bot refuses to start.
ExecStartPre=-/bin/rm -f $(pwd)/.lock
ExecStart=$(command -v node) $(pwd)/listen.js
Restart=on-failure
RestartSec=15
TimeoutStopSec=30
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sandesha

[Install]
WantedBy=multi-user.target"
  printf '%s\n' "$body" | sudo tee "$unit_file" >/dev/null || die "could not write ${unit_file}"
  sudo systemctl daemon-reload
  sudo systemctl enable "$UNIT"
  say "Service installed and enabled for boot. Starting it..."
  do_start
}

case "${1:-help}" in
  start)            do_start ;;
  stop)             do_stop ;;
  restart)          do_stop; do_start ;;
  status)           do_status ;;
  logs)             do_logs ;;
  reset-whatsapp)   shift; do_reset_whatsapp "$@" ;;
  db)               do_db ;;
  backup)           do_backup ;;
  install-backup)   do_install_backup ;;
  restore)          shift; do_restore "$@" ;;
  install-command)  do_install_command ;;
  install-service)  do_install_service ;;
  help|-h|--help)   usage ;;
  *)                usage; exit 1 ;;
esac

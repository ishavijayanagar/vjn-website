#!/usr/bin/env bash
# Run the website and Sandesha on this laptop, so a change can be tried here
# before it is pulled onto the Pi.
#
#   ./dev.sh            start both and print the local address
#   ./dev.sh stop       stop the local site and the local Sandesha
#   ./dev.sh status     say what is up
#
# config.js stays pointed at the Pi. This writes config.local.js, which the
# pages load only from localhost, so the installed app on the phone is unchanged.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_PORT=8765
API_PORT=42620
SITE_PID_FILE="${ROOT}/.dev-site.pid"
SANDESHA="${ROOT}/sandesha-server/sandesha.sh"
API="http://127.0.0.1:${API_PORT}"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

site_pid() {
  local pid=""
  [[ -f "$SITE_PID_FILE" ]] && pid="$(cat "$SITE_PID_FILE" 2>/dev/null)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    printf '%s' "$pid"
  fi
}

write_local_config() {
  cat >"${ROOT}/config.local.js" <<EOF
// Written by dev.sh. Git-ignored. Delete it, or run ./dev.sh stop, to talk to the Pi again.
(function () {
  var url = "${API}";
  window.SANDESHA_API_URL = url;
  window.SANDESHA_CONFIG = { apiUrl: url };
})();
EOF
}

start_site() {
  local pid
  pid="$(site_pid)"
  if [[ -n "$pid" ]]; then
    say "Website already running (pid ${pid})."
    return 0
  fi
  if ss -ltnH "sport = :${SITE_PORT}" 2>/dev/null | grep -q .; then
    die "Port ${SITE_PORT} is already in use. Stop that server, or run ./dev.sh stop."
  fi
  say "Starting the website on http://127.0.0.1:${SITE_PORT}/ ..."
  nohup python3 -m http.server "$SITE_PORT" --bind 127.0.0.1 --directory "$ROOT" >/tmp/vjn-dev-site.log 2>&1 &
  echo $! >"$SITE_PID_FILE"
  disown 2>/dev/null || true
  local i
  for ((i = 1; i <= 20; i++)); do
    curl -sf -o /dev/null "http://127.0.0.1:${SITE_PORT}/" && return 0
    kill -0 "$(cat "$SITE_PID_FILE")" 2>/dev/null || die "The website server exited. See /tmp/vjn-dev-site.log"
    sleep 0.2
  done
  die "The website did not answer on port ${SITE_PORT}."
}

stop_site() {
  local pid
  pid="$(site_pid)"
  if [[ -n "$pid" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    say "Website stopped."
  else
    say "Website was not running."
  fi
  rm -f "$SITE_PID_FILE"
  rm -f "${ROOT}/config.local.js"
}

cmd_start() {
  [[ -x "$SANDESHA" ]] || die "Cannot find ${SANDESHA}"
  write_local_config
  say "Starting Sandesha on this laptop (the Pi is not touched)..."
  "$SANDESHA" start || die "Sandesha did not start. Try: ${SANDESHA} logs"
  start_site
  say ""
  say "Open this in the laptop browser:"
  say "  http://127.0.0.1:${SITE_PORT}/admin-promotions.html"
  say ""
  say "These pages talk to Sandesha at ${API}"
  say "The phone app still uses the Pi."
  say "WhatsApp pairing, if this laptop is not linked yet: ${SANDESHA} logs"
  say "Stop with: ./dev.sh stop"
}

cmd_status() {
  local pid
  pid="$(site_pid)"
  if [[ -n "$pid" ]]; then
    say "Website:  http://127.0.0.1:${SITE_PORT}/  (pid ${pid})"
  else
    say "Website:  stopped"
  fi
  if curl -sf -o /dev/null "${API}/health"; then
    say "Sandesha: ${API}  (answering)"
  else
    say "Sandesha: not answering on ${API}"
  fi
  if [[ -f "${ROOT}/config.local.js" ]]; then
    say "Pages on localhost use the laptop. config.js still points at the Pi."
  fi
}

cmd_stop() {
  stop_site
  say "Stopping the laptop Sandesha..."
  "$SANDESHA" stop || true
}

case "${1:-start}" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  *)      die "Use: ./dev.sh [start|stop|status]" ;;
esac

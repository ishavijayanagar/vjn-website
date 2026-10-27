#!/usr/bin/env bash
# Start the VJN website and the Sandesha WhatsApp backend together.
#
# Ctrl+C stops both. The backend is stopped with SIGTERM so start.sh can run
# its own shutdown, which keeps the WhatsApp login intact.

set -uo pipefail
cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
Start the VJN website and the Sandesha WhatsApp backend together.

  ./dev.sh                 Site + backend + public tunnel
  ./dev.sh --restart       Stop whatever is already running, then start fresh
  ./dev.sh --no-tunnel     Site + backend on localhost only
  ./dev.sh --site-only     Just the static site
  ./dev.sh --backend-only  Just the backend
  ./dev.sh --stop          Stop both and exit
  ./dev.sh --reset         Backend re-links WhatsApp (new QR)
  PORT=8080 ./dev.sh       Serve the site on another port
  HOST=127.0.0.1 ./dev.sh  Site on this laptop only (no LAN/phone)

Without --restart, anything already running is left alone.
Stopping is always graceful, so the WhatsApp login survives.
EOF
}

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8765}"
API_PORT=42620
# 192.168/16, 10/8, or 172.16/12 (phone-hotspot subnets); skip Docker's 172.17/18.
LOCAL_IP="$(hostname -I 2>/dev/null | tr ' ' '\n' \
  | grep -E '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' \
  | grep -vE '^172\.(17|18)\.' | head -1 || true)"
BACKEND_DIR="sandesha-server"
LOG_DIR="${TMPDIR:-/tmp}"
SITE_LOG="$LOG_DIR/vjn-site.log"
BACKEND_LOG="$LOG_DIR/vjn-sandesha.log"

run_site=true
run_backend=true
restart=false
stop_only=false
backend_args=()

for arg in "$@"; do
  case "$arg" in
    --site-only)    run_backend=false ;;
    --backend-only) run_site=false ;;
    --restart)      restart=true ;;
    --stop)         stop_only=true ;;
    --no-tunnel|--tunnel|--reset|-r) backend_args+=("$arg") ;;
    --help|-h)      usage; exit 0 ;;
    *)
      echo "Unknown option: $arg  (try --help)" >&2
      exit 1
      ;;
  esac
done

# --reset re-links WhatsApp, which needs a stopped backend to be meaningful
case " ${backend_args[*]-} " in
  *" --reset "*|*" -r "*) restart=true ;;
esac

SITE_PID=""
BACKEND_PID=""
TAIL_PID=""
SHUTTING_DOWN=0

print_phone_url() {
  if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" && -n "${LOCAL_IP:-}" ]]; then
    echo "  mobile   http://$LOCAL_IP:$PORT/"
    local ts_ip
    ts_ip="$(tailscale ip -4 2>/dev/null || true)"
    if [[ -n "$ts_ip" ]]; then
      echo "  tailnet  http://$ts_ip:$PORT/   (Tailscale on the phone)"
    fi
  fi
}

port_busy() {
  # 0 = something is listening on $1
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&-; return 0; } || return 1
}

health_json() {
  curl -sf "http://127.0.0.1:${API_PORT}/health" 2>/dev/null || true
}

# One-line WhatsApp status from /health (+ log hints for loading % / pairing code).
whatsapp_progress_line() {
  local json log_hint pairing
  json="$(health_json)"
  [[ -z "$json" ]] && return 1

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY' "$json" "$BACKEND_LOG" 2>/dev/null || return 1
import json, re, sys
from pathlib import Path

data = json.loads(sys.argv[1])
log_path = sys.argv[2]
w = data.get("whatsapp") or {}
state = w.get("state") or "unknown"
reason = w.get("reason") or ""

def log_tail(pattern, default=""):
    try:
        text = Path(log_path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return default
    hits = re.findall(pattern, text)
    return hits[-1] if hits else default

if w.get("connected"):
    print("  sandesha WhatsApp connected")
    raise SystemExit(0)

if state == "pairing":
    code = log_tail(r"WhatsApp pairing code:\s*(\S+)")
    if code:
        print(f"  sandesha pairing code: {code}  (WhatsApp → Linked devices → Link with phone number)")
    elif w.get("qrAvailable"):
        try:
            has_qr = "QR saved" in Path(log_path).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            has_qr = False
        if has_qr:
            print("  sandesha scan QR — Messaging page or sandesha-server/qr-code.png")
        else:
            print("  sandesha waiting for WhatsApp link (QR or pairing code)…")
    else:
        print("  sandesha waiting for WhatsApp link (QR or pairing code)…")
elif state == "connecting":
    pct = ""
    if reason.startswith("loading:"):
        pct = reason.split(":", 1)[1]
    if not pct:
        pct = log_tail(r"Loading WhatsApp Web: (\d+)%")
    if reason == "authenticated":
        print("  sandesha authenticated — syncing chats…")
    elif pct:
        print(f"  sandesha loading WhatsApp Web ({pct}%)…")
    else:
        print("  sandesha connecting to WhatsApp…")
elif state == "disconnected":
    extra = f" ({reason})" if reason else ""
    print(f"  sandesha disconnected{extra}")
else:
    print(f"  sandesha {state}…")
PY
    return 0
  fi

  # Fallback without python3
  log_hint="$(grep -oE 'Loading WhatsApp Web: [0-9]+%' "$BACKEND_LOG" 2>/dev/null | tail -1)"
  pairing="$(grep 'WhatsApp pairing code:' "$BACKEND_LOG" 2>/dev/null | tail -1 | sed 's/.*WhatsApp pairing code:[[:space:]]*//')"
  if [[ -n "$pairing" ]]; then
    echo "  sandesha pairing code: $pairing"
  elif [[ -n "$log_hint" ]]; then
    echo "  sandesha $log_hint…"
  elif grep -q 'WhatsApp connected' "$BACKEND_LOG" 2>/dev/null; then
    echo "  sandesha WhatsApp connected"
  else
    echo "  sandesha connecting… (see $BACKEND_LOG)"
  fi
}

show_whatsapp_status_once() {
  local line
  line="$(whatsapp_progress_line 2>/dev/null || true)"
  [[ -n "$line" ]] && echo "$line"
}

# Stream the real Sandesha / listen.js output in this terminal.
# $1 = tail -n value: "+1" from the start of this run, or "80" for last N lines.
follow_sandesha_log() {
  local n="${1:-+1}"
  echo "════════════════════════════════════════"
  echo " sandesha log  (Ctrl+C to stop)"
  echo "────────────────────────────────────────"
  if [[ ! -s "$BACKEND_LOG" && -z "$BACKEND_PID" ]]; then
    echo "  (backend was started outside dev.sh, so there are no logs to show."
    echo "   Run ./dev.sh --restart to start it here and see everything.)"
  fi
  local logs=("$BACKEND_LOG")
  [[ -n "$SITE_PID" ]] && logs+=("$SITE_LOG")
  tail -n "$n" -F "${logs[@]}" &
  TAIL_PID=$!
}

pids_on_port() {
  local port="$1" out=""
  if command -v ss >/dev/null 2>&1; then
    out="$(ss -ltnp 2>/dev/null | grep -E "[:.]${port}[[:space:]]" \
           | grep -oE 'pid=[0-9]+' | cut -d= -f2)"
  fi
  if [[ -z "$out" ]] && command -v lsof >/dev/null 2>&1; then
    out="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)"
  fi
  printf '%s\n' $out | grep -E '^[0-9]+$' | grep -vx "$$" | sort -u
}

wait_for_port_free() {
  local port="$1" secs="${2:-30}"
  for _ in $(seq 1 "$secs"); do
    port_busy "$port" || return 0
    sleep 1
  done
  return 1
}

# Graceful stop. SIGTERM reaches start.sh (which also drops the tunnel) or
# listen.js directly — both save the WhatsApp session on the way out.
stop_backend() {
  local pids
  pids="$( { pgrep -f 'sandesha-server/start\.sh' 2>/dev/null || true
             pgrep -f 'listen\.js' 2>/dev/null || true
             pids_on_port "$API_PORT"; } | grep -E '^[0-9]+$' | grep -vx "$$" | sort -u )"

  [[ -z "$pids" ]] && return 0

  echo "  stop     backend (pid $(echo $pids | tr '\n' ' ')) — saving WhatsApp session…"
  kill -TERM $pids 2>/dev/null || true

  if wait_for_port_free "$API_PORT" 40; then
    echo "  stop     backend stopped"
  else
    echo "  stop     backend did not exit — forcing"
    kill -9 $pids 2>/dev/null || true
    wait_for_port_free "$API_PORT" 10 || true
  fi

  rm -f "$BACKEND_DIR/.lock"
}

stop_site() {
  local pids
  pids="$(pids_on_port "$PORT")"
  [[ -z "$pids" ]] && return 0
  echo "  stop     site (pid $(echo $pids | tr '\n' ' '))"
  kill -TERM $pids 2>/dev/null || true
  wait_for_port_free "$PORT" 10 || kill -9 $pids 2>/dev/null || true
}

# An older dev.sh sitting in `wait` would fire its own cleanup the moment we
# stop its children, and could then kill a service we just restarted. Take
# those out first and let their EXIT trap stop things gracefully.
# Finding other dev.sh instances is fiddlier than it looks:
#   - `pgrep -f dev.sh` also matches any shell whose command line merely
#     mentions the script, so argv[1] must actually be dev.sh.
#   - Our own forked subshells share that exact command line and `$$` still
#     reports the parent, so PID alone will not exclude them. They do share
#     our process group, which does.
MY_PGID="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"

pgid_of() {
  ps -o pgid= -p "$1" 2>/dev/null | tr -d ' '
}

is_dev_wrapper() {
  [[ -r "/proc/$1/cmdline" ]] || return 1
  local argv1
  argv1="$(tr '\0' '\n' < "/proc/$1/cmdline" 2>/dev/null | sed -n '2p')"
  [[ "$argv1" == *dev.sh ]]
}

dev_wrapper_pids() {
  local pid
  for pid in $(pgrep -f '[d]ev\.sh' 2>/dev/null || true); do
    [[ "$pid" == "$$" ]] && continue
    [[ -n "$MY_PGID" && "$(pgid_of "$pid")" == "$MY_PGID" ]] && continue
    is_dev_wrapper "$pid" && echo "$pid"
  done
}

stop_sibling_wrappers() {
  local pids
  pids="$(dev_wrapper_pids)"
  [[ -z "$pids" ]] && return 0
  echo "  stop     previous dev.sh (pid $(echo $pids | tr '\n' ' '))"
  kill -TERM $pids 2>/dev/null || true
  for _ in $(seq 1 40); do
    [[ -z "$(dev_wrapper_pids)" ]] && break
    sleep 1
  done
}

stop_existing() {
  stop_sibling_wrappers
  $run_backend && stop_backend
  $run_site && stop_site
  sleep 1
}

cleanup() {
  [[ "$SHUTTING_DOWN" -eq 1 ]] && return
  SHUTTING_DOWN=1

  if [[ -n "$TAIL_PID" ]] && kill -0 "$TAIL_PID" 2>/dev/null; then
    kill "$TAIL_PID" 2>/dev/null || true
    wait "$TAIL_PID" 2>/dev/null || true
    TAIL_PID=""
  fi

  echo
  echo "Stopping..."

  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    # SIGTERM so start.sh runs its own cleanup (tunnel down, WhatsApp saved)
    kill -TERM "$BACKEND_PID" 2>/dev/null || true
    for _ in $(seq 1 30); do
      kill -0 "$BACKEND_PID" 2>/dev/null || break
      sleep 1
    done
    kill -0 "$BACKEND_PID" 2>/dev/null && kill -9 "$BACKEND_PID" 2>/dev/null || true
  fi

  if [[ -n "$SITE_PID" ]] && kill -0 "$SITE_PID" 2>/dev/null; then
    kill -TERM "$SITE_PID" 2>/dev/null || true
  fi

  echo "Stopped."
}
trap cleanup INT TERM EXIT

echo "════════════════════════════════════════"
echo " VJN — site + Sandesha"
echo "════════════════════════════════════════"

if $stop_only; then
  stop_existing
  echo "════════════════════════════════════════"
  trap - EXIT
  exit 0
fi

$restart && stop_existing

# ── site ────────────────────────────────────
if $run_site; then
  if port_busy "$PORT"; then
    echo "  site     already serving on :$PORT — leaving it alone"
    echo "  site     http://localhost:$PORT"
    print_phone_url
  else
    HOST="$HOST" PORT="$PORT" ./serve.sh > "$SITE_LOG" 2>&1 &
    SITE_PID=$!
    sleep 2
    if kill -0 "$SITE_PID" 2>/dev/null; then
      echo "  site     http://localhost:$PORT"
      print_phone_url
      echo "           (log: $SITE_LOG)"
    else
      echo "  site     FAILED to start — see $SITE_LOG" >&2
      sed 's/^/           /' "$SITE_LOG" >&2
      exit 1
    fi
  fi
fi

# ── backend ─────────────────────────────────
if $run_backend; then
  if [[ ! -x "$BACKEND_DIR/start.sh" ]]; then
    echo "  backend  MISSING $BACKEND_DIR/start.sh" >&2
    exit 1
  fi

  if port_busy "$API_PORT"; then
    echo "  backend  already running on :$API_PORT — leaving it alone"
    echo "  backend  http://127.0.0.1:$API_PORT"
    show_whatsapp_status_once
    follow_sandesha_log 80
  else
    : > "$BACKEND_LOG"
    # Line-buffer so the live tail below shows start.sh banners promptly
    ( cd "$BACKEND_DIR" && stdbuf -oL -eL ./start.sh "${backend_args[@]+"${backend_args[@]}"}" ) \
      >> "$BACKEND_LOG" 2>&1 &
    BACKEND_PID=$!
    echo "  backend  starting…               (log: $BACKEND_LOG)"

    # Stream start.sh / listen.js output as it happens (same clarity as running start.sh alone)
    follow_sandesha_log +1

    # Wait until API is up (or backend dies) — logs keep streaming above
    for _ in $(seq 1 60); do
      kill -0 "$BACKEND_PID" 2>/dev/null || break
      port_busy "$API_PORT" && break
      sleep 1
    done

    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      echo "  backend  FAILED to start — see $BACKEND_LOG" >&2
      exit 1
    fi
    if ! port_busy "$API_PORT"; then
      echo "  backend  FAILED to start — see $BACKEND_LOG" >&2
      exit 1
    fi
  fi
else
  echo "════════════════════════════════════════"
  echo "Ctrl+C to stop."
fi

# Wait for whichever we started; if neither, exit cleanly.
if [[ -n "$BACKEND_PID" ]]; then
  wait "$BACKEND_PID"
elif [[ -n "$TAIL_PID" ]]; then
  # Backend was already up — keep streaming until Ctrl+C
  wait "$TAIL_PID"
elif [[ -n "$SITE_PID" ]]; then
  wait "$SITE_PID"
else
  echo "Nothing new to run — both were already up."
  trap - EXIT
fi

#!/usr/bin/env bash
# Serve static files over HTTP — required for fetch() to Apps Script (not file://).
# HOST=0.0.0.0 (default) is reachable on the LAN. HOST=127.0.0.1 is laptop only.
#
# Port 8765 speaks HTTP and HTTPS. Chrome on phones often upgrades
# http://192.168.x.x:8765 to https:// on the same port ("Always use secure
# connections"). Funnel is slower because it leaves the LAN.
#
# Laptop Chrome trusts mkcert. Phones do not — open the http:// URL there.
set -euo pipefail
cd "$(dirname "$0")"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8765}"
CERT_DIR=".local-certs"

# Pick a LAN-ish IPv4 for phone testing: 192.168/16, 10/8, or 172.16/12
# (the last covers phone-hotspot subnets like 172.20.10.x). Docker's 172.17/18
# bridge addresses are filtered out. Never fails the pipeline — no match is fine.
lan_ipv4() {
  hostname -I 2>/dev/null | tr ' ' '\n' \
    | grep -E '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' \
    | grep -vE '^172\.(17|18)\.' \
    | head -1 || true
}

LOCAL_IP="$(lan_ipv4)"
CERT=""
KEY=""
STAMP=""
[[ -n "${LOCAL_IP:-}" ]] && STAMP="mkcert:${LOCAL_IP}"

if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" ]]; then
  mkdir -p "$CERT_DIR"
  CERT="$CERT_DIR/cert.pem"
  KEY="$CERT_DIR/key.pem"
  if [[ ! -f "$CERT" || ! -f "$KEY" || "$(cat "$CERT_DIR/stamp" 2>/dev/null || true)" != "$STAMP" ]]; then
    if command -v mkcert >/dev/null 2>&1; then
      mkcert -install >/dev/null 2>&1 || true
      names=(localhost 127.0.0.1 ::1)
      [[ -n "${LOCAL_IP:-}" ]] && names+=("$LOCAL_IP")
      mkcert -cert-file "$CERT" -key-file "$KEY" "${names[@]}" >/dev/null 2>&1
    elif command -v openssl >/dev/null 2>&1; then
      SAN="DNS:localhost,IP:127.0.0.1"
      [[ -n "${LOCAL_IP:-}" ]] && SAN="${SAN},IP:${LOCAL_IP}"
      openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
        -keyout "$KEY" -out "$CERT" \
        -subj "/CN=${LOCAL_IP:-localhost}" \
        -addext "subjectAltName=${SAN}" >/dev/null 2>&1
    else
      CERT=""
      KEY=""
    fi
    [[ -n "$CERT" && -f "$CERT" ]] && printf '%s\n' "$STAMP" > "$CERT_DIR/stamp"
  fi
fi

echo "Laptop  http://localhost:${PORT}/"
if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" && -n "${LOCAL_IP:-}" ]]; then
  echo "Phone   http://${LOCAL_IP}:${PORT}/"
  echo "        same SSID as the laptop; type http:// yourself"
  ts_ip="$(tailscale ip -4 2>/dev/null || true)"
  if [[ -n "$ts_ip" ]]; then
    echo "        or http://${ts_ip}:${PORT}/  (Tailscale app on the phone)"
  fi
fi
echo "Press Ctrl+C to stop."

exec python3 - "$HOST" "$PORT" "${CERT:-}" "${KEY:-}" <<'PY'
import posixpath
import socket
import ssl
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

# This binds to 0.0.0.0, so anything under the site folder is readable by the
# whole LAN. sandesha-server/ holds .env and the WhatsApp session, so it is
# blocked here the same way _config.yml keeps it out of the GitHub Pages build.
# .local-certs/ holds the TLS private key — never serve that.
BLOCKED = ("/sandesha-server", "/.local-certs")


class NoCacheHandler(SimpleHTTPRequestHandler):
    def is_blocked(self):
        path = unquote(self.path.split("?", 1)[0].split("#", 1)[0])
        norm = posixpath.normpath(path)
        return any(norm == b or norm.startswith(b + "/") for b in BLOCKED)

    def do_GET(self):
        if self.is_blocked():
            self.send_error(404, "Not Found")
            return
        super().do_GET()

    def do_HEAD(self):
        if self.is_blocked():
            self.send_error(404, "Not Found")
            return
        super().do_HEAD()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class DualProtocolServer(ThreadingHTTPServer):
    """HTTP and TLS on one port. Chrome upgrades http://LAN-IP:port to https."""

    def __init__(self, addr, handler, ssl_ctx=None):
        super().__init__(addr, handler)
        self.ssl_ctx = ssl_ctx

    def get_request(self):
        conn, addr = self.socket.accept()
        if self.ssl_ctx is None:
            return conn, addr
        conn.settimeout(2)
        try:
            peek = conn.recv(1, socket.MSG_PEEK)
        except OSError:
            peek = b""
        conn.settimeout(None)
        if peek[:1] == b"\x16":
            conn = self.ssl_ctx.wrap_socket(conn, server_side=True)
        return conn, addr


host, port = sys.argv[1], int(sys.argv[2])
cert = sys.argv[3] if len(sys.argv) > 3 else ""
key = sys.argv[4] if len(sys.argv) > 4 else ""
ctx = None
if cert and key:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.check_hostname = False
    ctx.load_cert_chain(certfile=cert, keyfile=key)

DualProtocolServer((host, port), NoCacheHandler, ctx).serve_forever()
PY

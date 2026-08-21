#!/usr/bin/env bash
# Serve static files over http://localhost — required for fetch() to Apps Script (not file://).
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
echo "Open http://localhost:${PORT}/"
echo "Press Ctrl+C to stop."
exec python3 - "$PORT" <<'PY'
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

port = int(sys.argv[1])
server = ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler)
server.serve_forever()
PY

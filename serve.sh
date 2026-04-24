#!/usr/bin/env bash
# Serve static files over http://localhost — required for fetch() to Apps Script (not file://).
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
echo "Open http://localhost:${PORT}/"
echo "Press Ctrl+C to stop."
exec python3 -m http.server "$PORT"

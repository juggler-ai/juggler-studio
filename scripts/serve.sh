#!/usr/bin/env bash
# serve.sh — run a local static server for the juggler-studio site.
# Blocks in the foreground until you Ctrl-C. No build step; just serves files.
#
# Usage:
#   ./serve.sh            # serve on http://localhost:8000/
#   ./serve.sh 3000       # serve on a custom port
set -euo pipefail

cd "$(dirname/.. "$0")"

PORT="${1:-8000}"
PAGE="index.html"
URL="http://localhost:${PORT}/${PAGE}"

echo "Serving juggler-studio at ${URL}"
echo "Press Ctrl-C to stop."

# Synchronous: python3's http.server runs in the foreground and blocks here.
exec python3 -m http.server "${PORT}" --bind 127.0.0.1

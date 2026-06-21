#!/usr/bin/env bash
# Redeploy the juggler-version Worker (uploads code + syncs routes from wrangler.toml).
# Any extra args are passed through to `wrangler deploy`.
set -euo pipefail
cd "$(dirname "$0")"
exec npx wrangler deploy "$@"

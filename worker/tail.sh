#!/usr/bin/env bash
# Stream live logs from the deployed Worker. Each version check prints a
# `version_check {...}` line. Ctrl-C to stop. Extra args pass through to
# `wrangler tail` (e.g. ./tail.sh --format json, ./tail.sh --status error).
set -euo pipefail
cd "$(dirname "$0")"
exec npx wrangler tail "$@"

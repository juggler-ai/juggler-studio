#!/usr/bin/env bash
#
# Dump basic stats about version-check traffic from the Analytics Engine
# dataset (juggler_version_checks) via Cloudflare's SQL API.
#
# Setup (once):
#   cp .env.example .env      # then fill in CF_ANALYTICS_API_TOKEN
#   ./stats.sh                # defaults to the last 7 days
#
# Override the window:  DAYS=30 ./stats.sh
#
# Requires: curl, jq. Reads CLOUDFLARE_ACCOUNT_ID and CF_ANALYTICS_API_TOKEN
# from the environment or a local .env file. (The token is intentionally NOT
# named CLOUDFLARE_API_TOKEN: wrangler auto-loads .env and would treat that
# reserved name as its deploy credential, breaking `./deploy.sh`.)
#
# Column mapping (set in src/worker.js writeDataPoint):
#   index1 = version   blob1 = os   blob2 = arch   blob3 = version
#   blob4 = country     blob5 = colo   blob6 = source
# Only genuine app update-checks (source = "app") are written here; website page
# loads (?from=web) are skipped at the Worker, so these counts are app installs,
# not landing-page traffic. blob6 is always "app" today — kept for forward-compat.
# Counts use SUM(_sample_interval) so they stay accurate if Analytics Engine
# ever samples high-volume traffic (a plain count() would under-report).
set -euo pipefail
cd "$(dirname "$0")"

# Load .env if present.
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID (see .env.example)}"
: "${CF_ANALYTICS_API_TOKEN:?Set CF_ANALYTICS_API_TOKEN (see .env.example)}"

command -v curl >/dev/null 2>&1 || { echo "missing dependency: curl" >&2; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "missing dependency: jq"   >&2; exit 1; }

DATASET="juggler_version_checks"
DAYS="${DAYS:-7}"
API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql"
WHERE="timestamp >= NOW() - INTERVAL '${DAYS}' DAY"

echo "juggler-version stats — last ${DAYS} day(s)"

# run_query TITLE SQL — POST the query and render .data as an aligned table.
# Never aborts the script: prints any error and returns 0 so later queries run.
run_query() {
  local title="$1" sql="$2" resp
  echo
  echo "=== ${title} ==="

  resp=$(curl -sS -X POST "$API" \
    -H "Authorization: Bearer ${CF_ANALYTICS_API_TOKEN}" \
    -H "Content-Type: text/plain" \
    --data "$sql" 2>/dev/null) || { echo "(request failed)"; return 0; }

  if ! echo "$resp" | jq -e '.data' >/dev/null 2>&1; then
    echo "(query error)"
    echo "$resp" | jq . 2>/dev/null || echo "$resp"
    return 0
  fi

  if [ "$(echo "$resp" | jq '.data | length')" = "0" ]; then
    echo "(no data yet)"
    return 0
  fi

  {
    echo "$resp" | jq -r '[.meta[].name] | @tsv'
    echo "$resp" | jq -r '.data[] | [.[] | tostring] | @tsv'
  } | column -t -s "$(printf '\t')"
}

run_query "Totals" "
  SELECT
    SUM(_sample_interval)   AS hits,
    COUNT(DISTINCT blob3)   AS app_versions,
    COUNT(DISTINCT blob1)   AS os_types,
    COUNT(DISTINCT blob4)   AS countries
  FROM ${DATASET}
  WHERE ${WHERE}"

run_query "Hits by OS" "
  SELECT blob1 AS os, SUM(_sample_interval) AS hits
  FROM ${DATASET}
  WHERE ${WHERE}
  GROUP BY os ORDER BY hits DESC"

run_query "Hits by architecture" "
  SELECT blob2 AS arch, SUM(_sample_interval) AS hits
  FROM ${DATASET}
  WHERE ${WHERE}
  GROUP BY arch ORDER BY hits DESC"

run_query "Hits by OS + arch" "
  SELECT blob1 AS os, blob2 AS arch, SUM(_sample_interval) AS hits
  FROM ${DATASET}
  WHERE ${WHERE}
  GROUP BY os, arch ORDER BY hits DESC"

run_query "Hits by reported app version" "
  SELECT blob3 AS app_version, SUM(_sample_interval) AS hits
  FROM ${DATASET}
  WHERE ${WHERE}
  GROUP BY app_version ORDER BY hits DESC"

run_query "Top countries" "
  SELECT blob4 AS country, SUM(_sample_interval) AS hits
  FROM ${DATASET}
  WHERE ${WHERE}
  GROUP BY country ORDER BY hits DESC LIMIT 15"

run_query "Hits per day" "
  SELECT
    toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
    SUM(_sample_interval) AS hits
  FROM ${DATASET}
  WHERE ${WHERE}
  GROUP BY day ORDER BY day"

echo

#!/usr/bin/env sh
# check.sh - run every validation for the juggler-studio site.
# Stylelint (house CSS rules, rem-only lengths) plus the static-site
# architecture checks. This is the single entry point for validation;
# add future checks here rather than calling them separately.
#
# Usage:
#   ./scripts/check.sh
set -eu

# Run from the repo root whatever the caller's working directory, so the
# npm script and the validator's relative path both resolve.
cd "$(dirname "$0")/.."

npm run lint:css
node scripts/validate-static-site.js

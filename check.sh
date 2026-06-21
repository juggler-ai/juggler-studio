#!/usr/bin/env sh
set -eu

npm run lint:css
node scripts/validate-static-site.js

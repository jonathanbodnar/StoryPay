#!/usr/bin/env sh
# Hit the marketing email cron endpoint (campaign sends + automation steps).
# Use on Railway: add a Cron job with schedule */5 * * * * and command:
#   sh scripts/marketing-email-cron.sh
# Required env on that service:
#   MARKETING_CRON_SECRET or CRON_SECRET
#   MARKETING_CRON_BASE_URL=https://your-app.example.com   (full origin, no path)
# On Railway you can set MARKETING_CRON_BASE_URL to your public URL, or rely on
# RAILWAY_PUBLIC_DOMAIN (no scheme) which this script turns into https://...

set -eu

SECRET="${MARKETING_CRON_SECRET:-${CRON_SECRET:-}}"
if [ -z "$SECRET" ]; then
  echo "marketing-email-cron: set MARKETING_CRON_SECRET or CRON_SECRET" >&2
  exit 1
fi

BASE="${MARKETING_CRON_BASE_URL:-}"
if [ -z "$BASE" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  BASE="https://${RAILWAY_PUBLIC_DOMAIN}"
fi
if [ -z "$BASE" ]; then
  echo "marketing-email-cron: set MARKETING_CRON_BASE_URL (e.g. https://app.example.com) or run on Railway with RAILWAY_PUBLIC_DOMAIN set" >&2
  exit 1
fi

BASE="${BASE%/}"
curl -fsS -H "Authorization: Bearer ${SECRET}" "${BASE}/api/cron/marketing-email"

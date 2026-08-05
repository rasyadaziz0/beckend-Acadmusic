#!/bin/bash

# Script to trigger the Discover Weekly cron job on the VPS
# Run this via crontab, e.g.:
# 0 0 * * 0 /path/to/musicLabs/my-app/scripts/cron_discover.sh >> /var/log/discover_cron.log 2>&1

API_URL="http://localhost:4000/api/cron/discover"

# Get absolute path to the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Source the .env file if it exists (safe method)
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  . "$PROJECT_ROOT/.env"
  set +a
fi

# Define CRON_SECRET from env if available, otherwise use a placeholder
CRON_SECRET="${CRON_SECRET:-your_cron_secret_here}"

echo "[$(date -u)] Starting Discover Weekly Cron..."

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $CRON_SECRET" "$API_URL")

HTTP_STATUS=$(echo "$RESPONSE" | tr -d '\n' | sed -e 's/.*HTTP_STATUS://')
BODY=$(echo "$RESPONSE" | sed -e 's/HTTP_STATUS\:.*//g')

echo "Status: $HTTP_STATUS"
echo "Response: $BODY"

if [ "$HTTP_STATUS" -eq 200 ]; then
  echo "[$(date -u)] Cron completed successfully."
else
  echo "[$(date -u)] Cron failed!"
fi

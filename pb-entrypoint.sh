#!/bin/sh
set -e
cd /pb
if [ -n "$POCKETBASE_ADMIN_EMAIL" ] && [ -n "$POCKETBASE_ADMIN_PASSWORD" ]; then
  ./pocketbase superuser upsert "$POCKETBASE_ADMIN_EMAIL" "$POCKETBASE_ADMIN_PASSWORD" --dir=/pb_data 2>/dev/null || true
fi
exec ./pocketbase serve --http=0.0.0.0:8090 --dir=/pb_data

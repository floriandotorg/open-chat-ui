#!/bin/sh
set -e

PB_URL="${POCKETBASE_URL:-http://pocketbase:8090}"
echo "[entrypoint] waiting for PocketBase at $PB_URL ..."
for i in $(seq 1 60); do
  if bun -e "fetch('$PB_URL/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "[entrypoint] PocketBase healthy"
    break
  fi
  sleep 1
done

echo "[entrypoint] applying schema ..."
bun scripts/apply-pb-schema.ts || echo "[entrypoint] schema apply failed — continuing; run it manually if the app errors"

exec bun build/index.js

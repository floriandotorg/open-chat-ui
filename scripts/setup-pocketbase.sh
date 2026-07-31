#!/bin/sh
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PB_DIR="$DIR/pocketbase"
PB_BIN="$PB_DIR/pocketbase"
DATA_DIR="$DIR/pb_data"

# Load .env if present (do not override already-exported vars)
if [ -f "$DIR/.env" ]; then
  set -a
  . "$DIR/.env"
  set +a
fi

PB_URL="${POCKETBASE_URL:-http://127.0.0.1:8090}"
PB_EMAIL="${POCKETBASE_ADMIN_EMAIL:-admin@openchatui.local}"
PB_PASSWORD="${POCKETBASE_ADMIN_PASSWORD}"

if [ -z "$PB_PASSWORD" ]; then
  echo "POCKETBASE_ADMIN_PASSWORD is required (set it in .env)" >&2
  exit 1
fi

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=amd64 ;;
esac

if [ ! -x "$PB_BIN" ]; then
  echo "Downloading PocketBase for ${OS}/${ARCH}..."
  TAG=$(curl -sL https://api.github.com/repos/pocketbase/pocketbase/releases/latest | grep tag_name | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
  URL="https://github.com/pocketbase/pocketbase/releases/download/${TAG}/pocketbase_${TAG#v}_${OS}_${ARCH}.zip"
  mkdir -p "$PB_DIR"
  curl -sL "$URL" -o "$PB_DIR/pb.zip"
  (cd "$PB_DIR" && unzip -o pb.zip pocketbase >/dev/null && chmod +x pocketbase && rm -f pb.zip)
fi

mkdir -p "$DATA_DIR"
"$PB_BIN" superuser upsert "$PB_EMAIL" "$PB_PASSWORD" --dir "$DATA_DIR" >/dev/null 2>&1 || true
echo "PocketBase superuser ready: $PB_EMAIL"

# Apply schema (requires a running PocketBase). Start a temporary instance.
"$PB_BIN" serve --dir "$DATA_DIR" --http "${PB_URL#http://}" >/tmp/pb-setup.log 2>&1 &
PB_PID=$!
# Wait for health
for _ in $(seq 1 30); do
  if curl -sf "$PB_URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

POCKETBASE_URL="$PB_URL" POCKETBASE_ADMIN_EMAIL="$PB_EMAIL" POCKETBASE_ADMIN_PASSWORD="$PB_PASSWORD" \
  bun "$DIR/scripts/apply-pb-schema.ts"

kill "$PB_PID" 2>/dev/null || true
wait "$PB_PID" 2>/dev/null || true
echo "PocketBase setup complete. Run 'bun run pb:serve' to start it."

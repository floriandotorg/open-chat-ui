#!/bin/sh
set -e
bun scripts/migrate-db.ts
exec bun build/index.js

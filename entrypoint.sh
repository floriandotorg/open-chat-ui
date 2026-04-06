#!/bin/sh
set -e
bunx drizzle-kit push --force
exec bun build/index.js

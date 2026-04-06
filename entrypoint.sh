#!/bin/sh
bunx drizzle-kit push --force
exec bun build/index.js

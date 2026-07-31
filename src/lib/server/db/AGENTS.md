# PocketBase schema + record mappers

Applies to `pocketbase/pb_schema.json`, `src/lib/server/db/records.ts`, and `src/lib/server/pb.ts`.

## Schema

The collection schema lives in `pocketbase/pb_schema.json` and is the source of truth. Apply it to a running PocketBase with `bun run pb:schema` (idempotent; creates/updates collections).

- The `users` collection is an auth collection (password auth, no public rules).
- All app collections (`api_keys`, `conversations`, `messages`, `provider_models`, `system_prompts`, `user_settings`) have null API rules — only the superuser can read/write. SvelteKit enforces per-user isolation in app code.
- The `id` primary key on every collection is widened to accept 15–36 chars matching `^[a-zA-Z0-9-]+$` so migrated UUIDs are preserved.

## Never destructive

- Never edit `pb_data/` (the live SQLite store) by hand. Always go through the PocketBase API or admin UI.
- When changing `pb_schema.json`, prefer adding fields/indexes. Removing or renaming fields drops data on `pb:schema` apply — back up `pb_data/` first.

## Record mappers (`records.ts`)

PB rows use relation field names (`user`, `conversation`, `systemPromptRef`) and ISO date strings. The `map*` helpers convert them to the app-facing shapes (`userId`, `conversationId`, `systemPromptId`, `Date` objects, parsed JSON). Always map rows before returning them to route handlers. Write `createdAt`/`updatedAt` explicitly with `now()` — they are not auto-managed.

# Open Chat UI — agent instructions

Self-hosted, multi-provider LLM chat app with built-in tools, code execution, and vision support.

## Code documents itself

Prefer self-documenting names and structure over comments. Don't restate what the code already says; reserve comments for non-obvious cross-system invariants (e.g. the iOS Safari `backdrop-filter` rules documented in `src/routes/layout.css`).

## Stack

- SvelteKit (Svelte 5 runes) on Bun via `svelte-adapter-bun`
- Tailwind CSS 4 (`@tailwindcss/vite`, no config file)
- PocketBase for data + auth (companion process; schema in `pocketbase/pb_schema.json`, applied via `bun run pb:schema`)
- Biome (lint/format), Vitest (unit + Playwright browser tests)

## Architectural invariants

- **Per-user isolation**: every PocketBase query filters by `user`; collections are superuser-only and isolation is enforced in SvelteKit route handlers.
- **Auth guard**: all `/chat`, `/settings`, `/api/*` routes are protected in `hooks.server.ts`. Handlers use `requireUser(locals.user)` — never `locals.user!`.
- **API keys**: encrypted with AES-256-GCM before storage; `ENCRYPTION_SECRET` env var required.
- **Providers**: `LLMProvider` interface in `src/lib/server/providers/types.ts`; each provider is a factory function registered in `providers/index.ts`. Use the provider's official SDK directly (no Vercel AI SDK). `chat` is an `AsyncGenerator<ChatStreamEvent>`; yield `usage` before `done`; catch SDK errors and yield `{ type: 'error', error }` instead of throwing.
- **Streaming**: generation writes delta ops to `stream_events` (~100 ms) and folds snapshots into `messages` (~2 s, `eventSeq` marks the folded prefix); clients subscribe to both via PocketBase realtime and rebuild the live message with `applyStreamOps` (`src/lib/stream-ops.ts`). Heavy data (tool results, raw content blocks, thinking) lives in `message_payloads` and is loaded on expand.
- **Tools**: `ToolDefinition` implementations in `src/lib/server/tools/`; the chat API runs a tool loop (max 10 rounds).
- **State**: `createChatStore()` in `src/lib/stores/chat.svelte.ts` uses `$state` runes; provider/model selection is shared via Svelte `setContext`/`getContext` from the chat layout.

## Svelte 5 conventions

Runes exclusively (`$state`, `$derived`, `$effect`, `$props`, `$bindable`). Event handlers are `onclick`/`onsubmit` (not `on:click`). Slot content uses `{@render children()}` with `Snippet` typing.

## Liquid glass

iOS-style glass aesthetic. Utility classes and their critical iOS Safari `backdrop-filter` constraints — no nested glass, no `overflow: hidden` on glass ancestors, `-webkit-` prefix before unprefixed — are defined and documented in `src/routes/layout.css`. Don't override `backdrop-filter` or the box-shadow stack; add a new utility instead.

## PocketBase schema

`pocketbase/pb_schema.json` is the source of truth (`bun run pb:schema`, idempotent). Never edit `pb_data/` by hand. Prefer adding fields/indexes — removing or renaming drops data. Record mappers in `src/lib/server/db/records.ts` convert PB rows to app shapes; write `createdAt`/`updatedAt` explicitly (not auto-managed).

## Quality

`bun run lint` and `bun run check` must both pass with zero errors and warnings before a task is finished (`bun run lint -- --fix` to auto-fix). Tests via `bun run test`.

## Dev server

`bun run start` serves at http://localhost:5179. Requires PocketBase on http://127.0.0.1:8090 (`bun run pb:serve`) and `POCKETBASE_*` / `ENCRYPTION_SECRET` env vars. Default user `test@example.com`, password `testtest`.

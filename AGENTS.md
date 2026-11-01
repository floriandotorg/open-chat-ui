# Open Chat UI

Self-hosted, multi-provider LLM chat app: SvelteKit (Svelte 5 runes) on Bun, PocketBase, Tailwind 4, Biome, Vitest.

## Commands

- Bun is the runtime and package manager; don't use npm, npx or node.
- Dev: `bun run pb:serve` (PocketBase on http://127.0.0.1:8090), then `bun run start` (http://localhost:5179). Needs `POCKETBASE_*` and `ENCRYPTION_SECRET` env vars. Login: `test@example.com` / `testtest`.
- While iterating: `bun run test <path>` for the affected test file.
- Done means: `bun run lint` and `bun run check` pass with zero errors and warnings (`bun run lint -- --fix` auto-fixes), and tests for touched code pass. Run the full `bun run test` when changing `src/lib/sync/`, `src/lib/stream-ops.ts`, providers or tools.
- Schema: `bun run pb:schema` applies `pocketbase/pb_schema.json` (source of truth, idempotent). Never edit `pb_data/` by hand.

## Ask before

- Removing or renaming PocketBase collections or fields (drops data). Adding fields and indexes is fine.
- Changing API key encryption or anything depending on `ENCRYPTION_SECRET` (stored keys become unreadable).
- Adding dependencies.

## Server

- Auth: `/chat`, `/settings`, `/api/*` are guarded in `hooks.server.ts`. In handlers use `requireUser(locals.user)`, not `locals.user!`.
- Isolation: collections are superuser-only, so the route handler is the only isolation layer. Every PocketBase query filters by `user`.
- Records: mappers in `src/lib/server/db/records.ts` convert PB rows to app shapes. Set `createdAt`/`updatedAt` explicitly; they are not auto-managed.
- API keys are stored only AES-256-GCM encrypted.
- Providers: implement `LLMProvider` (`src/lib/server/providers/types.ts`) as a factory registered in `providers/index.ts`, using the provider's official SDK (not the Vercel AI SDK). `chat` is an `AsyncGenerator<ChatStreamEvent>`: yield `usage` before `done`; catch SDK errors and yield `{ type: 'error', error }` instead of throwing.
- Tools: `ToolDefinition` implementations in `src/lib/server/tools/`; the chat API runs at most 10 tool rounds.

## Client

- Every client write goes through `src/lib/sync/` (`SyncCollection` + `Mutation`), which handles optimistic state, rollback (`keepOnError` keeps failures visible) and folding acknowledged writes. Don't hand-roll optimistic state or reverts in components.
- Generate record ids for new messages and conversations on the client.
- Get a conversation's `ChatStore` (`src/lib/stores/chat.svelte.ts`) synchronously from the `ChatStores` cache; navigation never awaits the network.
- Sidebar and branch state: `src/lib/sync/conversations.svelte.ts`. Provider/model selection: `chatContext`.

## Streaming

- Generation writes deltas to `stream_events` and folds snapshots into `messages` (`eventSeq` marks the folded prefix). Clients rebuild the live message with `applyStreamOps` (`src/lib/stream-ops.ts`).
- Streaming must keep working without SSE: `ChatStore` falls back to REST when realtime is silent.
- Tool results, raw content blocks and thinking go in `message_payloads`, loaded on expand.
- Mechanics, timings and proxy setup: `docs/streaming.md`.

## Svelte 5

Runes only (`$state`, `$derived`, `$effect`, `$props`, `$bindable`). Use `onclick`/`onsubmit`, not `on:click`. Use `{@render children()}` with `Snippet` types instead of slots.

## Styling

- Tailwind 4 via `@tailwindcss/vite`. There is no `tailwind.config.*`; don't create one.
- Liquid glass utilities live in `src/routes/layout.css` together with their iOS Safari `backdrop-filter` constraints: no nested glass, no `overflow: hidden` on glass ancestors, `-webkit-` prefix before unprefixed. Don't override `backdrop-filter` or the box-shadow stack; add a new utility there instead.

## Comments

Use descriptive names instead of comments. Comment only non-obvious cross-system invariants, like the Safari rules in `layout.css`. Never restate what the code already says.

# Open Chat UI — agent instructions

This repository follows the [AGENTS.md](https://agents.md/) convention: root plus nested files; the closest `AGENTS.md` to edited files applies.

## Project overview

Self-hosted, multi-provider LLM chat application with built-in tools, code execution, and vision support.

## Stack

- SvelteKit (Svelte 5 runes) with Bun runtime via `svelte-adapter-bun`
- Tailwind CSS 4 (no config file, `@tailwindcss/vite` plugin)
- Drizzle ORM + SQLite (`bun:sqlite`)
- better-auth for authentication (email/password, sign-up disabled, users created via CLI)
- Biome for linting/formatting
- Vitest for testing (browser tests via Playwright, server tests via Node)

## Directory layout

```
src/lib/server/providers/     # LLM provider adapters (Anthropic, Mistral)
src/lib/server/tools/         # Built-in tools (web search, URL fetch, Reddit)
src/lib/server/db/            # Drizzle schema + client
src/lib/server/auth.ts        # better-auth config
src/lib/server/auth-guard.ts  # requireUser() helper for route handlers
src/lib/server/crypto.ts      # AES-256-GCM encrypt/decrypt for API keys
src/lib/server/prompts.ts     # Post-system-prompt instructions (citations, code execution)
src/lib/components/           # Svelte 5 UI components
src/lib/stores/               # Svelte 5 rune-based stores (chat, pending message)
src/lib/types.ts              # Shared TypeScript types
src/lib/markdown.ts           # Markdown rendering (marked + highlight.js + DOMPurify)
src/lib/citations.ts          # Citation parsing and inline link insertion
src/lib/content-segments.ts   # Interleave text with tool/code blocks
src/routes/login/             # Auth page
src/routes/chat/              # Chat UI (layout, conversation pages)
src/routes/settings/          # User settings (API keys, models, system prompts, tools, account)
src/routes/api/               # JSON + SSE API endpoints
scripts/add-user.ts           # CLI user creation script
```

## Key patterns

- **Provider abstraction**: `LLMProvider` interface in `providers/types.ts`. Each provider is a factory function registered in `providers/index.ts`. Adding a provider = one new file + one registry line.
- **Tools**: Tools in `server/tools/` implement `ToolDefinition`. The chat API runs a tool loop (max 10 rounds) when the model requests tool use. Tool API keys (Kagi, Jina) are stored alongside provider keys.
- **Auth guard**: All `/chat`, `/settings`, `/api/*` routes are protected in `hooks.server.ts`. Server load functions and API handlers use `requireUser(locals.user)` (never `locals.user!`).
- **API key encryption**: User API keys are encrypted with AES-256-GCM before storage. `ENCRYPTION_SECRET` env var required.
- **Streaming**: `POST /api/chat` returns SSE (`text/event-stream`). Provider adapters yield `ChatStreamEvent` via `AsyncGenerator`. Client reads via `ReadableStream`.
- **State management**: `createChatStore()` in `stores/chat.svelte.ts` uses `$state` runes. Provider/model selection passed via Svelte `setContext`/`getContext` from chat layout.
- **Per-user isolation**: All DB queries filter by `userId`. API keys, conversations, messages, and settings are scoped per user.
- **Code execution**: Anthropic provider supports sandboxed code execution with file output. Container IDs are persisted on conversations for session continuity.
- **Model management**: Users can enable/disable specific models per provider and set a dedicated title-generation model via the `provider_models` table and settings.

## Testing and quality

The default username is `test@example.com` and the default password is `test`.

After substantive changes, run `bun run lint -- --fix` and `bun run check`.

## Nested AGENTS.md

| Path | Topic |
|------|--------|
| `src/AGENTS.md` | Svelte 5 components |
| `src/routes/api/AGENTS.md` | API route conventions |
| `src/lib/server/providers/AGENTS.md` | LLM provider adapters |
| `src/lib/server/db/AGENTS.md` | Drizzle / SQLite migrations |
| `drizzle/AGENTS.md` | Generated SQL migrations (safety pointer) |

## Optional agent skills

Scripts and guides for doc lookup and web research live under `.agents/skills/` (Context7, Jina Reader, Kagi Search, frontend design).

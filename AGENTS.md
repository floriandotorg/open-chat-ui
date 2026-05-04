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

## Style guide

The app uses an iOS-style **liquid glass** aesthetic on every surface that floats over content. Solid surfaces (page bodies, message bubbles, sidebar entries, settings cards) stay opaque so the glass surfaces have something to refract.

### Liquid glass utilities (defined in `src/routes/layout.css`)

| Class | Use for |
|-------|---------|
| `.liquid-glass` | Floating cards, popovers, dialogs, dropdown panels, the chat input bar, the mobile sidebar overlay. Pair with a `rounded-*` utility. Auto-adapts to color scheme. |
| `.liquid-glass-bar-top` | Top edge bars hugging the viewport / parent top (chat header, sidebar header). Hairline divider + soft drop shadow on the bottom edge. |
| `.liquid-glass-bar-bottom` | Bottom edge bars hugging the viewport / parent bottom (sidebar footer). Hairline divider + soft drop shadow on the top edge. |
| `.sidebar-surface` | Opaque host for inner glass bars on the desktop sidebar. Provides the contrast the bars need to read as glass. **Has no `backdrop-filter` on purpose** — see the nesting rule below. |
| `.tts-glass` (scoped, `TtsPlayer.svelte`) | Always-dark glass for the TTS player which renders white-on-dark in both color schemes. Don't reuse — prefer `.liquid-glass`. |

All glass variants use `backdrop-filter: blur(40-50px) saturate(1.8)` plus a multi-layer box-shadow stack: a 0.5px outline, a soft drop shadow, an inner top highlight, and an inner bottom shadow. Never override the shadow or `backdrop-filter`; if you need a different look, add a new utility instead of forking values.

**iOS Safari `backdrop-filter` rules (don't break these).** WebKit silently drops the blur and renders only the translucent fill in two situations. Compositing-layer hacks (`transform: translateZ(0)`, `will-change: backdrop-filter`) do NOT fix either; both are structural and must be avoided in markup.

1. *No nested backdrop-filter.* A `.liquid-glass*` element inside another `.liquid-glass*` element loses its blur on iOS Safari 18 because the parent's stacking context collapses the child's filter source. The sidebar shell therefore uses `.sidebar-surface` (no backdrop-filter) on **both** desktop and mobile, so the inner `.liquid-glass-bar-top` / `.liquid-glass-bar-bottom` bars can paint. Don't be tempted to make the mobile sidebar shell `.liquid-glass` to match the overlay aesthetic — it breaks every bar inside it. If you need a translucent overlay on a glass shell, the children must be solid (no backdrop-filter), not the other way around.

2. *No `overflow: hidden` on glass ancestors.* `backdrop-filter` cannot reach past an `overflow: hidden` parent, so any glass element inside such a chain falls back to a flat gauze on iOS. The chat `<main>` and the inner `flex-1` wrapper around `{children}` are therefore `overflow: visible` with `min-h-0` to let the flex children still shrink. Only the actual scroll viewport (the message container's `overflow-y-auto`) owns clipping. If you wrap glass in a new container, never give that container `overflow: hidden`.

**Prefix order (critical).** Always declare `-webkit-backdrop-filter` *before* the unprefixed `backdrop-filter`. Lightning CSS (Tailwind v4's production minifier) dedupes the pair and keeps the last declaration; if `backdrop-filter` comes first, only `-webkit-backdrop-filter` survives the build, Firefox loses the effect entirely, and the surface degrades to a flat semi-transparent fill in production while still looking correct in dev. Same rule applies to any new `backdrop-filter` declaration you add, including in `<style>` blocks of components.

**Nesting rule (important).** A `backdrop-filter` parent creates a containing block that weakens any child `backdrop-filter`. If you want inner glass bars (e.g. a sidebar header that the list scrolls behind), the parent must NOT have `backdrop-filter`. That's why the desktop sidebar uses `.sidebar-surface` (solid background) instead of `.liquid-glass` — the inner `.liquid-glass-bar-top` / `.liquid-glass-bar-bottom` need an opaque-ish backdrop to read as proper glass. Mobile sidebar still uses `.liquid-glass` because it overlays chat content; the inner bars there are intentionally subtler.

### Layering rules

1. **Floating bars sit absolute over scrollable content.** The chat header (`absolute inset-x-0 top-0 z-20`) and the chat input bar (`absolute inset-x-0 bottom-0 z-10`) overlay the message scroll viewport. The viewport gets matching `pt-*` / `pb-*` padding so messages don't sit permanently behind the bars but still scroll under them, which is what makes glass feel alive.
2. **Popovers are `.liquid-glass` with `rounded-xl`.** All three pickers (`ModelPicker`, `SystemPromptPicker`, `ThinkingEffortPicker`) follow the same template: a hover overlay backdrop button (`fixed inset-0 z-40`), a `.liquid-glass` panel (`absolute z-50`), and item hover states using `hover:bg-black/5 dark:hover:bg-white/10` (translucent so the blur stays visible).
3. **Modals dim and blur the page.** `ConfirmDialog` uses `backdrop:bg-black/40 backdrop:backdrop-blur-sm` to fog the page, and the dialog itself is `.liquid-glass`.
4. **Sidebar layering.** Desktop sidebar uses `.sidebar-surface` for the shell (solid, with a hairline right border), `.liquid-glass-bar-top` for the header (logo + actions + search), and `.liquid-glass-bar-bottom` for the footer (user + settings). The conversation list is the sole scroll viewport; its `<nav>` carries `pt-[calc(env(safe-area-inset-top)+6.5rem)]` and `pb-[calc(env(safe-area-inset-bottom)+3.75rem)]` so items can slide behind both bars instead of stopping at them. The resize handle's static divider is transparent (the surface's right border serves it) and turns blue on hover/drag. Mobile sidebar uses `.liquid-glass` for the shell so the chat blurs through it when it slides in.
5. **Login page** uses a multi-radial-gradient page background to give the glass card something colorful to refract.

### Tints and hover states on glass

Never stack `bg-white` / `bg-gray-*` / `dark:bg-neutral-*` on top of `.liquid-glass` — it cancels the blur. Use translucent tints instead:

- Item hover: `hover:bg-black/5 dark:hover:bg-white/10`
- Active tab pill: `bg-white/80 dark:bg-white/10`
- Chips/badges on glass: `bg-black/5 dark:bg-white/10`

### Typography and color

- Default text colors stay the same as the rest of the app (`text-gray-900 dark:text-gray-100`). Glass is light enough in light mode and dark enough in dark mode that body text stays legible without overrides.
- Accent colors are: blue-500/600 (primary action), violet-500/600 (thinking), emerald-500/600 (files, success), red-500/600 (destructive). Avoid introducing new accent hues.

### When NOT to use glass

- Message bubbles, conversation list rows, settings cards, form fields, buttons inside cards. These are content, not chrome.
- Anything that doesn't overlay other content — glass on a solid background just looks like a tinted box and adds GPU cost.

## Testing and quality

The default username is `test@example.com` and the default password is `test`.

Before considering a task finished, `bun run lint` and `bun run check` must both pass with zero errors and zero warnings. Run `bun run lint -- --fix` to auto-fix where possible.

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

## Dev Server

The dev server running at http://localhost:5179/ (if not, ask the user to start it). The user is test@example.com and the password is "test".

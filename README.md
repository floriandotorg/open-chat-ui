# Open Chat UI

Self-hosted, multi-provider LLM chat application. Bring your own API keys, manage conversations, and use built-in tools like web search, URL fetching, and Reddit browsing, all from a single interface.

<img width="2892" height="2148" alt="CleanShot 2026-04-05 at 22 13 13" src="https://github.com/user-attachments/assets/4de56c40-9594-4217-bc5b-ac9b73ea290e" />

## Features

- **Multi-provider support** — Chat with models from Anthropic (Claude) and Mistral from a unified interface. Adding new providers is straightforward.
- **Streaming responses** — Real-time token streaming via Server-Sent Events.
- **Built-in tools** — Web search (Kagi), URL/YouTube fetching (Jina Reader), and Reddit browsing. The assistant can use these tools autonomously during conversations.
- **Code execution** — Anthropic's sandboxed code execution with file output support (Claude models only).
- **Extended thinking** — Configurable thinking effort for Claude models (low / medium / high / max).
- **Vision** — Attach images to messages for multimodal conversations.
- **File attachments** — Upload files to include in conversations.
- **Voice dictation** — Speech-to-text transcription via Mistral's Voxtral model.
- **Citations** — Inline numbered citations from web search results with source links.
- **Markdown rendering** — Full markdown support with syntax-highlighted code blocks and copy buttons.
- **System prompts** — Create, save, and switch between custom system prompts.
- **Model management** — Enable/disable specific models per provider, set a default title-generation model.
- **Conversation management** — Create, rename, and delete conversations with auto-generated titles.
- **Per-user isolation** — All data (API keys, conversations, settings) is scoped per user.
- **API key encryption** — User API keys are encrypted with AES-256-GCM at rest.
- **Authentication** — Email/password authentication via PocketBase (sign-up disabled; users are created via CLI).
- **Dark mode** — Full dark mode support.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit (Svelte 5 runes) |
| Runtime | Bun (via `svelte-adapter-bun`) |
| Styling | Tailwind CSS 4 |
| Database | PocketBase (collections in `pocketbase/pb_schema.json`) |
| Auth | PocketBase (email/password, proxied through SvelteKit) |
| Linting | Biome |
| Testing | Vitest (browser tests via Playwright, server tests via Node) |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1+

### Installation

```bash
git clone https://github.com/your-username/open-chat-ui.git
cd open-chat-ui
bun install
```

### Environment Variables

Copy the example environment file and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `POCKETBASE_URL` | PocketBase server URL — server-side (e.g. `http://127.0.0.1:8090`) |
| `PUBLIC_POCKETBASE_URL` | Browser-reachable PocketBase URL for client-side reads + realtime (same as `POCKETBASE_URL` in dev; reverse-proxy in prod) |
| `POCKETBASE_ADMIN_EMAIL` | PocketBase superuser email (used by the app + scripts) |
| `POCKETBASE_ADMIN_PASSWORD` | PocketBase superuser password |
| `ORIGIN` | Application URL (e.g. `http://localhost:5179` for dev, `http://localhost:3000` for production) |
| `ENCRYPTION_SECRET` | AES-256-GCM key for API key encryption (32+ random characters) |

### PocketBase Setup

Download the PocketBase binary and create the superuser:

```bash
bun run pb:setup
```

Start PocketBase and apply the collection schema:

```bash
bun run pb:serve   # leave running
bun run pb:schema
```

To migrate data from a previous Drizzle/SQLite `local.db` into PocketBase:

```bash
bun run pb:migrate-data -- --password <password>
```

Every migrated user is assigned the given password (better-auth hashes cannot be imported).

### Create a User

Sign-up is disabled in the application. Create users via the CLI:

```bash
bun run user:add user@example.com mypassword "Display Name"
```

The display name is optional and defaults to the part before `@` in the email.

### Run (Development)

```bash
bun start
```

The app runs at `http://localhost:5179` by default.

### Run (Production)

Build and preview:

```bash
bun run build
bun build/index.js
```

The production server runs on port `3000`.

## Docker

`compose.yaml` runs two services: `pocketbase` (the database, exposed on port `8090`) and `open-chat-ui` (the app, port `3000`). Set the required env vars in `.env` first (see `.env.example`): `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`, `ENCRYPTION_SECRET`, and `PUBLIC_POCKETBASE_URL` (browser-reachable PB URL — defaults to `http://localhost:8090`; in production put PocketBase behind a reverse proxy and point this at its public origin).

```bash
docker compose up -d --build
```

On first start the app container waits for PocketBase to be healthy, then applies the collection schema (`scripts/apply-pb-schema.ts`) automatically. The PocketBase superuser is created from `POCKETBASE_ADMIN_EMAIL`/`POCKETBASE_ADMIN_PASSWORD`.

Create a user inside the app container:

```bash
docker compose exec open-chat-ui bun scripts/add-user.ts user@example.com mypassword
```

### Production notes

- Expose/reverse-proxy the `pocketbase` service so the browser can reach `PUBLIC_POCKETBASE_URL` (e.g. `https://pb.example.com`). PocketBase allows all origins by default; tighten CORS in production if needed.
- Both services need persistent volumes (`./pb_data`, `./data`) — already wired in `compose.yaml`.
- The app assumes a single instance (in-process generation hub). Do not horizontally scale `open-chat-ui` without an external hub.

## Configuration

After logging in, go to **Settings** to configure:

- **API Keys** — Add your Anthropic and/or Mistral API keys.
- **Models** — Enable/disable specific models and set a title-generation model.
- **System Prompt** — Create and manage reusable system prompts.
- **Tools** — Add API keys for Kagi (web search) and Jina (URL fetching). These are optional; the tools won't appear without keys.
- **Account** — Change your password.

## Project Structure

```
src/
├── lib/
│   ├── components/          # Svelte 5 UI components
│   ├── server/
│   │   ├── db/              # PocketBase record mappers + types
│   │   ├── providers/       # LLM provider adapters (Anthropic, Mistral)
│   │   └── tools/           # Built-in tools (web search, URL fetch, Reddit)
│   ├── stores/              # Svelte 5 rune-based state management
│   └── types.ts             # Shared TypeScript types
├── routes/
│   ├── api/                 # JSON + SSE API endpoints
│   ├── chat/                # Chat UI
│   ├── login/               # Authentication page
│   └── settings/            # User settings
scripts/
└── add-user.ts              # CLI user creation script
```

## Adding a New LLM Provider

1. Create `src/lib/server/providers/<name>.ts` implementing the `LLMProvider` interface
2. Register it in `src/lib/server/providers/index.ts`

The `LLMProvider` interface requires:

- `id` / `name` — Provider identifier and display name
- `capabilities` — Supported features (`streaming`, `vision`, `tool_use`, `code_interpreter`, `system_prompt`)
- `listModels()` — Fetch available models from the provider's API
- `chat(request)` — `AsyncGenerator` yielding `ChatStreamEvent` objects for streaming

## Scripts

| Command | Description |
|---|---|
| `bun start` | Start dev server |
| `bun run build` | Production build |
| `bun run check` | Type checking |
| `bun run lint` | Lint with Biome |
| `bun run lint -- --fix` | Lint and auto-fix |
| `bun run test` | Run tests |
| `bun run pb:setup` | Download PocketBase binary + create superuser |
| `bun run pb:serve` | Run PocketBase locally |
| `bun run pb:schema` | Apply collection schema to PocketBase |
| `bun run pb:migrate-data` | Migrate old SQLite `local.db` into PocketBase |
| `bun run user:add` | Create a new user |

## License

MIT

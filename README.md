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
- **Authentication** — Email/password authentication via better-auth (sign-up disabled by default; users are created via CLI).
- **Dark mode** — Full dark mode support.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit (Svelte 5 runes) |
| Runtime | Bun (via `svelte-adapter-bun`) |
| Styling | Tailwind CSS 4 |
| Database | SQLite (`bun:sqlite`) with Drizzle ORM |
| Auth | better-auth (email/password) |
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
| `DATABASE_URL` | SQLite database path (e.g. `file:local.db`) |
| `ORIGIN` | Application URL (e.g. `http://localhost:5179` for dev, `http://localhost:3000` for production) |
| `BETTER_AUTH_SECRET` | Auth secret key (32+ random characters for production) |
| `ENCRYPTION_SECRET` | AES-256-GCM key for API key encryption (32+ random characters) |

### Database Setup

Push the schema to the database:

```bash
bun run db:push
```

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

### Docker Compose (recommended)

```bash
docker compose up -d
```

The default `docker-compose.yml` exposes port `3000` and stores the database in `./data/`. Update `BETTER_AUTH_SECRET` and `ENCRYPTION_SECRET` before deploying.

To create a user inside the container:

```bash
docker compose exec open-chat-ui bun scripts/add-user.ts user@example.com mypassword
```

### Docker (manual)

```bash
docker build -t open-chat-ui .
docker run -d \
  -p 3000:3000 \
  -v ./data:/data \
  -e DATABASE_URL=file:/data/chat.db \
  -e ORIGIN=http://localhost:3000 \
  -e BETTER_AUTH_SECRET=change-me \
  -e ENCRYPTION_SECRET=change-me-too \
  open-chat-ui
```

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
│   │   ├── db/              # Drizzle schema + client
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
| `bun run db:push` | Push schema to database |
| `bun run db:studio` | Open Drizzle Studio (database GUI) |
| `bun run user:add` | Create a new user |

## License

MIT

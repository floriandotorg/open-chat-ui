# Plan: Client data layer

Goal: SvelteKit renders the complete shell once on first load. After hydration all data lives in browser memory (Svelte stores) and is kept correct by PocketBase realtime. Navigation never asks the SvelteKit server for data. Sidebar data is slimmed to what the sidebar renders. Creating a chat and sending the first message is a single server request. Fully independent of the other plans.

No IndexedDB, no persistence. A reload starts from SSR again.

Files touched: `src/lib/types.ts`, `src/lib/db-mappers.ts`, `src/lib/server/db/records.ts`, `src/routes/chat/+layout.server.ts`, `src/routes/chat/+layout.svelte`, `src/lib/stores/conversations.svelte.ts`, new `src/lib/stores/chat-stores.svelte.ts`, `src/lib/stores/chat.svelte.ts` (add `dispose`), `src/routes/chat/[conversationId]/+page.server.ts` (deleted), new `src/routes/chat/[conversationId]/+page.ts`, `src/routes/chat/[conversationId]/+page.svelte`, `src/routes/chat/+page.server.ts` (deleted), `src/routes/chat/+page.svelte`, new `src/routes/api/conversations/[id]/detail/+server.ts`, `src/routes/api/chat/+server.ts`, `src/routes/api/conversations/[id]/+server.ts`, `src/lib/components/ConversationList.svelte` (type only).

## Why it is slow today

1. `chat/[conversationId]/+page.server.ts` reads `params.conversationId`, so SvelteKit reruns it on every conversation switch: browser to SvelteKit (`__data.json`) to PocketBase (2 queries) to browser. The previous conversation's messages are thrown away on leave, so coming back pays the same again.
2. `chat/+page.server.ts` exists only for `?q=`, but its existence forces a `__data.json` round trip on every "New chat". `goToNewChat` awaits `goto` before focusing the textarea.
3. First message: `POST /api/conversations` (3 PocketBase queries) then `goto('/chat/{id}')` (server load, 2 queries) then `POST /api/chat`. Three sequential round trips before a token can flow.
4. `chat/+layout.server.ts` ships full conversation rows for the sidebar: `systemPrompt`, `resolvedSystemPrompt`, `activeBranches`, `container`, `defaultModel`. Measured locally: 113 chats, 2.5 KB of titles, about 140 KB of prompt text and branch maps inside the SSR HTML, then parsed again during hydration. The `conversations` realtime subscription delivers the same full rows on every `generating`/`updatedAt` flip during streaming.
5. `+layout.svelte` re-seeds the conversations store from `data.conversations` in an `$effect`; any future layout invalidation would wipe optimistic state.

## Target shape

```
chat/+layout.server.ts   SSR once: ConversationSummary[] (slim), SystemPrompt[], providers, cookies
chat/+layout.svelte      owns stores: conversations (slim), systemPrompts, chatStores (per conversation)
chat/+page.svelte        no load; handles ?q client side
chat/[id]/+page.ts       universal load: browser -> chatStores.acquire(id) (memory, or one PB read on miss)
                                         server  -> fetch('/api/conversations/{id}/detail') for SSR
chat/[id]/+page.svelte   renders chatStores.get(id); realtime as today
```

## Steps

### 1. Slim sidebar records

`src/lib/types.ts`: add

```ts
export interface ConversationSummary {
  id: string
  title: string
  favorite: boolean
  generating: boolean
  systemPromptId: string | null
  createdAt: Date
  updatedAt: Date
}
export const CONVERSATION_SUMMARY_FIELDS = 'id,title,favorite,generating,systemPromptRef,createdAt,updatedAt'
```

`src/lib/db-mappers.ts` and `src/lib/server/db/records.ts`: add `mapConversationSummary(r: RecordModel): ConversationSummary`. Test first (`db-mappers.test.ts`): maps `systemPromptRef` to `systemPromptId`, empty string to null, `generating` undefined to false.

`chat/+layout.server.ts`: the conversations query becomes

```ts
pb.collection('conversations').getFullList({ filter: ..., sort: '-updatedAt', fields: CONVERSATION_SUMMARY_FIELDS }).then(rows => rows.map(mapConversationSummary))
```

Drop the `defaultModel` normalisation for the list (it is not rendered in the sidebar).

`conversations.svelte.ts`: the store type becomes `ConversationSummary`. `subscribe` passes `{ fields: CONVERSATION_SUMMARY_FIELDS }` as the third argument of `pbClient.collection('conversations').subscribe('*', cb, options)` (the SDK supports `fields` on subscriptions). `resync` passes the same `fields`. `mapConversation` calls become `mapConversationSummary`.

`ConversationList.svelte`, `+layout.svelte`, `chat/+page.svelte`: type imports switch to `ConversationSummary`. The layout's `changeSystemPrompt` patch drops `systemPrompt` (content is server side; the list only needs the id).

Everything that needs the full conversation (`activeBranches`, `generating`, `systemPromptId`) reads it from the per conversation detail below.

### 2. Per conversation stores kept in memory: `src/lib/stores/chat-stores.svelte.ts`

The chat store (`createChatStore`) already holds messages, branches, live stream state, queue and optimistic pending state for one conversation. Keep one instance per visited conversation instead of destroying it on navigation.

```ts
export interface ConversationDetail {
  conversation: { id: string; generating: boolean; systemPromptId: string | null; activeBranches: BranchMap }
  messages: Message[]
}

export const createChatStores = (deps: { fetchStreamEvents: FetchStreamEvents }) => {
  const stores = new Map<string, { store: ChatStore; conversation: ConversationDetail['conversation']; loadedAt: number }>()
  const inflight = new Map<string, Promise<ChatStore>>()

  const fetchDetail = async (id: string): Promise<ConversationDetail>  // two parallel pbClient reads: conversations.getOne(id, { fields: 'id,generating,systemPromptRef,activeBranches' }) and messages.getFullList({ filter: conversation = id, sort: 'createdAt' }), mapped with mapClientMessage
  const seedFrom = (id: string, detail: ConversationDetail) => { create store if missing, store.seed(id, detail.messages, detail.conversation.activeBranches), store.setConversationGenerating(...), record conversation + loadedAt, touch LRU }
  const peek = (id: string) => stores.get(id)?.store
  const acquire = async (id: string, initial?: ConversationDetail): Promise<ChatStore>  // initial -> seedFrom; cached -> return, void revalidate(id); miss -> await fetchDetail then seedFrom
  const revalidate = async (id: string) => { const detail = await fetchDetail(id); if the store is not streaming, seedFrom(id, detail) }
  const createEmpty = (id: string, systemPromptId: string | null) => seedFrom(id, { conversation: { id, generating: false, systemPromptId, activeBranches: {} }, messages: [] })
  const evict = () => { keep the 30 most recently touched; call store.dispose() on the rest, never evict the one for page.params.conversationId }
  return { peek, acquire, revalidate, createEmpty, conversationOf: (id) => stores.get(id)?.conversation }
}
```

`chat.svelte.ts`: `createChatStore` currently opens an `$effect.root` and never returns its cleanup. Capture it and expose `dispose()`.

Revalidate merge rule: when the cached store `isStreaming`, do not re-seed (the realtime path already owns updates); otherwise `seed` with the fresh snapshot. Write the tests first (`chat-stores.svelte.test.ts`): acquire miss fetches once and seeds; acquire hit returns synchronously and revalidates in the background; concurrent acquires share one in-flight fetch; revalidate does not clobber a streaming store; eviction disposes and keeps the current id.

Instantiate once in `chat/+layout.svelte` and share via `chatContext.chatStores` (same place `conversationsStore` is shared). Pass `{ fetchStreamEvents }` from `$lib/stream-events-client`.

### 3. Detail endpoint for SSR: `GET /api/conversations/[id]/detail`

Returns `ConversationDetail` as JSON (dates as ISO strings). Two parallel PocketBase reads with the same `fields` as `fetchDetail`, ownership enforced by `user = {:u}` in the filter, 404 when absent. Used only by SSR of the conversation page (internal `event.fetch`, no network hop). `mapClientMessage` runs on the server side of this endpoint so the client receives the client shape directly.

### 4. Universal page load replaces the server load

Delete `chat/[conversationId]/+page.server.ts`. Create `chat/[conversationId]/+page.ts`:

```ts
export const load: PageLoad = async ({ params, fetch }) => {
  const id = params.conversationId
  if (browser) {
    const cached = chatStores.peek(id)
    if (cached) {
      void chatStores.revalidate(id)
      return { conversationId: id, initial: null }
    }
    await chatStores.acquire(id)          // one PocketBase round trip, browser to PB
    return { conversationId: id, initial: null }
  }
  const res = await fetch(`/api/conversations/${id}/detail`)
  if (res.status === 404) error(404, 'Conversation not found')
  return { conversationId: id, initial: reviveDates(await res.json()) as ConversationDetail }
}
```

`chatStores` must be reachable from the load function. The load runs before the layout component tree exists on hard load, so the stores object is a module singleton in `chat-stores.svelte.ts` (created lazily in the browser, `null` on the server). The layout's `onMount` only attaches realtime to it.

Hard load path: `initial` is set, the page component calls `chatStores.acquire(id, data.initial)` on the first run to seed from SSR data (no PocketBase read). Hydration renders the SSR HTML unchanged because the store is seeded from the same data before the first render.

Verification of the "zero server" claim: after hydration, switching conversations must produce no `__data.json` request. The layout server load has no tracked dependencies (`cookies` and `locals` are not tracked), and the page load is universal, so SvelteKit has nothing to ask the server for. Assert this in the Network tab.

Hover preload (`data-sveltekit-preload-data="hover"` in `ConversationList`) now runs the universal load, which warms the store before the click lands. Keep it.

Optional warm up: after layout mount, in `requestIdleCallback`, `acquire` the 5 most recent conversations that are not cached. Cheap (5 parallel PocketBase reads) and makes the common "click the top of the list" case zero latency. Skip on `navigator.connection?.saveData`.

### 5. `chat/[conversationId]/+page.svelte` reads the store

- `const chat = $derived(chatStores.peek(data.conversationId) ?? throwUnreachable())` becomes the store; the local `createChatStore(...)` call is removed. Because the load guarantees the store exists, use an `if (!store) throw new Error(...)` guard, never `!`.
- Remove `mapServerMessages` and the big seeding `$effect`. What remains of it: on `conversationId` change reset `stickToBottom`, run `attachToConversation` once per conversation (queue restore, pending message, `?q`), and `catchUpStreams()`.
- The realtime handlers stay exactly as they are (they mutate `chat`, which is now the shared instance, so background updates while you are on the page keep the cache correct). On the `conversations` slot callback also update `chatStores.conversationOf(id)` (`generating`, `activeBranches`).
- `remoteGenerating` initial value comes from `chatStores.conversationOf(id)?.generating`.
- `data.conversation.id` references become `data.conversationId`.

### 6. `/chat` without a server load

Delete `chat/+page.server.ts`. In `chat/+page.svelte`:

- `onMount`: if `page.url.searchParams.get('q')` is non-empty, call `handleSubmit(q)` and `replaceState` without `q` (same pattern the conversation page already uses in `consumeQueryMessage`).
- `goToNewChat` in the layout: `goto` now completes without network. Keep the focus token but do not await `goto` before focusing; `afterNavigate` in `chat/+page.svelte` already exists for the textarea (`ctx.newChatFocusToken` effect).

### 7. One request to start a chat

`chat/+page.svelte` `handleSubmit`:

```ts
const id = crypto.randomUUID()                            // the id field allows 15 to 36 chars of [a-zA-Z0-9-], messages already use UUIDs
const now = new Date()
ctx.conversationsStore.addPending({ id, title: 'New Chat', favorite: false, generating: false, systemPromptId: ctx.currentSystemPromptId, createdAt: now, updatedAt: now })
chatStores.createEmpty(id, ctx.currentSystemPromptId)
setPendingMessage(content, images, files)
setPendingConversation({ systemPromptId: ctx.currentSystemPromptId })   // small addition to pending-message.ts
await goto(resolve(`/chat/${id}`))                        // universal load hits the cache: no network
```

The conversation page's `attachToConversation` consumes the pending message and calls `chat.sendMessage`, which posts `/api/chat` with a new optional field `createConversation: { systemPromptId }` (read from `consumePendingConversation()` and passed through `sendMessage`'s existing `systemPrompt` slot or a new parameter).

`POST /api/chat`:

- After the conversation lookup returns null and `body.createConversation` is present: resolve the prompt exactly as `POST /api/conversations` does today (one query: `id = {:id} && user = {:u}` when an id is given, else `isDefault = true`), then `createOrRecover('conversations', { id: conversationId, user, title: 'New Chat', systemPrompt, systemPromptRef, createdAt, updatedAt }, filter id = {:id}, {})`. Continue as today. Without `createConversation`, a missing conversation stays a 404.
- Realtime `create` event on `conversations` reaches the sidebar store, `upsert` confirms the pending entry.

Guard in the conversation page: the `conversationSlot` resync path calls `pbClient.collection('conversations').getOne(convId)`; for a pending (not yet created) conversation that 404s. Catch 404 there and keep local state.

`POST /api/conversations` stays for API compatibility but is no longer called by the UI. Delete `pending-message.ts`'s unused exports only if nothing else imports them.

### 8. Trim the write handlers the UI awaits

`PATCH /api/conversations/[id]`: ownership check with `fields: 'id'`; skip the system prompt existence query unless `body.systemPromptId` is provided; single `update`. Two PocketBase calls instead of three. The UI is already optimistic here; this only shortens the realtime echo.

`+layout.svelte` `changeSystemPrompt` and `toggleCurrentConversationFavorite`: do not `await` the fetch inside the handler (fire and forget with `.catch` that reverts the patch via `conversations.patch(id, previous)`).

### 9. Remove the re-seed effect

`+layout.svelte`: delete `$effect(() => { conversations.seed(data.conversations) })`. The store is seeded once in the constructor; realtime and `resync` own it afterwards.

### 10. Verify

- Hard load `/chat/{id}`: HTML contains the slim `conversations` array (under 15 KB for 113 chats), messages rendered by SSR, no flash on hydration.
- Click 5 conversations, then click them again: Network shows PocketBase `records` reads for the first visits only, never `__data.json`; second visits paint in the same frame as the click.
- Hover a conversation, wait, click: no request at click time.
- New chat, type, send: exactly one `POST /api/chat`; sidebar shows the new chat immediately; title arrives via realtime; reload shows the same conversation.
- Start a stream, switch to another conversation and back: the streaming message is intact and still updating (the store survived; the realtime subscription re-attached).
- Toggle favorite and change the system prompt: instant, one PATCH each.
- Disable the network, click cached conversations: they render; uncached ones show the existing error path.
- `bun run lint`, `bun run check`, `bun run test` green.

## Out of scope

Models (see models-cache), CSS and paint (see paint-and-layout), bundle size (see bundle-diet).

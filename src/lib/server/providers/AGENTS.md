# Provider abstraction

## Adding a new provider

1. Create `src/lib/server/providers/<name>.ts`
2. Implement the `LLMProvider` interface via a factory function
3. Register in `src/lib/server/providers/index.ts` registry map

## Interface

```typescript
type ProviderCapability = 'streaming' | 'vision' | 'tool_use' | 'code_interpreter' | 'file_upload' | 'system_prompt'

interface LLMProvider {
  readonly id: string
  readonly name: string
  readonly capabilities: ProviderCapability[]
  listModels(): Promise<ModelInfo[]>
  chat(request: ChatRequest): AsyncGenerator<ChatStreamEvent>
}

type ProviderFactory = (apiKey: string) => LLMProvider
```

## ChatRequest

`ChatRequest` includes: `model`, `messages`, `systemPrompt`, `maxTokens`, `temperature`, `thinkingEffort` (`none` | `low` | `medium` | `high` | `max`), `signal` (AbortSignal), `tools` (ToolSchema[]), `codeExecution` (boolean), `container` (string).

## ChatStreamEvent types

`text_delta`, `thinking_delta`, `tool_call`, `tool_result`, `code_execution_start`, `code_execution_delta`, `code_execution_result`, `code_execution_files`, `raw_assistant_content`, `usage`, `done`, `error`.

## Rules

- Use the provider's official SDK directly (no Vercel AI SDK)
- The `chat` method must be an `AsyncGenerator` yielding `ChatStreamEvent` objects
- Always yield `usage` event before `done` event
- The `done` event must include `stopReason`: `'end'` or `'tool_use'`
- Catch SDK errors and yield `{ type: 'error', error: message }` instead of throwing
- `listModels()` fetches available models from the provider's API using the user's API key
- Model IDs returned by `listModels()` must be formatted with `formatModelRef(providerId, modelId)` from `$lib/model-ref`
- Handle tool calls: accumulate streamed arguments, yield `tool_call` event with parsed JSON arguments on `content_block_stop`
- Handle images/vision via `ChatMessage.images` array (base64 data + mimeType)
- Anthropic adapter additionally handles: extended thinking, code execution, container uploads, and raw content block persistence

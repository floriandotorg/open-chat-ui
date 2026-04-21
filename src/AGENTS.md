# Svelte components

## Runes

Use Svelte 5 syntax exclusively: `$state`, `$derived`, `$effect`, `$props`, `$bindable`.

```svelte
<script lang="ts">
let { value = $bindable(''), onchange }: { value: string; onchange: (v: string) => void } = $props()
let derived = $derived(value.toUpperCase())
</script>
```

## Event handlers

Use `onclick`, `onsubmit`, etc. (not `on:click`).

## Snippets

Use `{@render children()}` for slot content. Type children as `Snippet` from `'svelte'`.

## Context

Chat context is shared from `chat/+layout.svelte` via `setContext('chat-provider', { selectedModel, thinkingEffort })` and consumed in chat pages via `getContext('chat-provider')`.

## Styling

Tailwind CSS 4 utility classes. Use `dark:` variants for dark mode support. Icon-only buttons must include `aria-label`.

## Key components

- `ChatMessage` — Renders user/assistant message bubbles with markdown, images, files, tool blocks, code execution, thinking, and citations.
- `ChatInput` — Message input with file/image attachments and submit handling.
- `ModelPicker` / `ModelManager` — Model selection and per-provider model enable/disable.
- `SystemPromptPicker` / `SystemPromptManager` / `SystemPromptEditor` — System prompt selection, CRUD management, and editing.
- `ThinkingEffortPicker` — Anthropic extended thinking effort selector.
- `ToolCallBlock` / `CodeExecutionBlock` / `SourcesBlock` / `ThinkingBlock` — Inline blocks for tool results, code execution output, citation sources, and thinking content.

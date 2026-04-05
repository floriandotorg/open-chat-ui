import { formatModelRef } from '$lib/model-ref'
import type { ChatMessage, ChatRequest, ChatStreamEvent, LLMProvider, ModelInfo, ProviderCapability, ProviderFactory, ToolCallInfo } from './types'
import Anthropic from '@anthropic-ai/sdk'

type AnyBlock = Record<string, unknown>

const CODE_EXEC_TOOL_NAMES = new Set(['code_execution', 'bash_code_execution', 'text_editor_code_execution'])
const CODE_EXEC_RESULT_TYPES = new Set(['bash_code_execution_tool_result', 'text_editor_code_execution_tool_result', 'code_execution_tool_result'])

const mapCapabilities = (caps: Anthropic.ModelCapabilities | null): ProviderCapability[] => {
  const result: ProviderCapability[] = ['streaming', 'system_prompt']
  if (caps?.image_input?.supported) result.push('vision')
  if (caps?.code_execution?.supported) result.push('code_interpreter')
  return result
}

const buildAnthropicContent = (m: ChatMessage): string | Anthropic.ContentBlockParam[] => {
  if (!m.images?.length && !m.containerUploadFileIds?.length) return m.content
  const parts: Anthropic.ContentBlockParam[] = []
  if (m.images?.length) {
    for (const img of m.images) {
      parts.push({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mimeType as Anthropic.Base64ImageSource['media_type'], data: img.data },
      })
    }
  }
  if (m.containerUploadFileIds?.length) {
    for (const fid of m.containerUploadFileIds) {
      parts.push({ type: 'container_upload', file_id: fid } as unknown as Anthropic.ContentBlockParam)
    }
  }
  if (m.content) {
    parts.push({ type: 'text' as const, text: m.content })
  }
  return parts
}

const buildAnthropicMessages = (messages: ChatMessage[]): Anthropic.MessageParam[] => {
  const result: Anthropic.MessageParam[] = []

  for (const m of messages) {
    if (m.role === 'system') continue

    if (m.role === 'tool') {
      const toolResult = {
        type: 'tool_result' as const,
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
      }
      const last = result[result.length - 1]
      if (last?.role === 'user' && Array.isArray(last.content)) {
        ;(last.content as Anthropic.ContentBlockParam[]).push(toolResult)
      } else {
        result.push({ role: 'user', content: [toolResult] })
      }
      continue
    }

    if (m.role === 'assistant' && m.rawContentBlocks?.length) {
      result.push({ role: 'assistant', content: m.rawContentBlocks as Anthropic.ContentBlockParam[] })
      continue
    }

    if (m.role === 'assistant' && m.toolCalls?.length) {
      const content: Anthropic.ContentBlockParam[] = []
      if (m.content) {
        content.push({ type: 'text', text: m.content })
      }
      for (const tc of m.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })
      }
      result.push({ role: 'assistant', content })
      continue
    }

    result.push({
      role: m.role as 'user' | 'assistant',
      content: buildAnthropicContent(m),
    })
  }

  return result
}

const extractCodeExecResult = (block: AnyBlock): { stdout?: string; stderr?: string; returnCode?: number; error?: string; fileIds?: string[] } => {
  const content = block.content as AnyBlock | undefined
  if (!content) return {}
  if (typeof content.error_code === 'string') {
    return { error: content.error_code as string }
  }
  const fileIds: string[] = []
  if (Array.isArray(content.content)) {
    for (const item of content.content as AnyBlock[]) {
      if (item?.file_id && typeof item.file_id === 'string') {
        fileIds.push(item.file_id)
      }
    }
  }
  return {
    stdout: (content.stdout as string) ?? '',
    stderr: (content.stderr as string) ?? '',
    returnCode: (content.return_code as number) ?? 0,
    ...(fileIds.length ? { fileIds } : {}),
  }
}

const createAnthropicAdapter = (apiKey: string): LLMProvider => ({
  id: 'anthropic',
  name: 'Anthropic',
  capabilities: ['streaming', 'vision', 'tool_use', 'code_interpreter', 'system_prompt'],

  listModels: async () => {
    const client = new Anthropic({ apiKey })
    const models: ModelInfo[] = []
    for await (const model of client.models.list({ limit: 100 })) {
      models.push({
        id: formatModelRef('anthropic', model.id),
        name: model.display_name,
        contextWindow: model.max_input_tokens ?? 200_000,
        maxOutputTokens: model.max_tokens ?? 4096,
        capabilities: mapCapabilities(model.capabilities),
      })
    }
    return models
  },

  async *chat(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const client = new Anthropic({ apiKey })

    const hasContainerUploads = request.messages.some(m => m.containerUploadFileIds?.length)

    const useThinking = request.thinkingEffort && request.thinkingEffort !== 'none'
    const baseMaxTokens = request.maxTokens ?? 4096
    const maxTokens = useThinking ? Math.max(baseMaxTokens, 16000) : baseMaxTokens

    const params: Record<string, unknown> = {
      model: request.model,
      max_tokens: maxTokens,
      temperature: useThinking ? undefined : request.temperature,
      system: request.systemPrompt,
      messages: buildAnthropicMessages(request.messages),
    }

    if (request.container) {
      params.container = request.container
    }

    if (useThinking) {
      params.thinking = { type: 'adaptive' }
      params.output_config = { effort: request.thinkingEffort }
    }

    const tools: Record<string, unknown>[] = []

    if (request.codeExecution) {
      tools.push({ type: 'code_execution_20250825', name: 'code_execution' })
    }

    if (request.tools?.length) {
      for (const t of request.tools) {
        tools.push({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })
      }
    }

    if (tools.length > 0) {
      params.tools = tools
    }

    const streamOptions: Record<string, unknown> = { signal: request.signal }
    if (hasContainerUploads) {
      streamOptions.headers = { 'anthropic-beta': 'files-api-2025-04-14' }
    }
    const stream = client.messages.stream(params as Anthropic.MessageStreamParams, streamOptions)

    const pendingToolCalls = new Map<number, { id: string; name: string; argsJson: string }>()
    const pendingCodeExecs = new Map<number, { id: string; name: string; inputJson: string }>()

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block as unknown as AnyBlock

          if (block.type === 'tool_use') {
            pendingToolCalls.set(event.index, { id: block.id as string, name: block.name as string, argsJson: '' })
          } else if (block.type === 'server_tool_use' && CODE_EXEC_TOOL_NAMES.has(block.name as string)) {
            const id = block.id as string
            const name = block.name as string
            pendingCodeExecs.set(event.index, { id, name, inputJson: '' })
            yield { type: 'code_execution_start', codeExecution: { id, name } }
          } else if (CODE_EXEC_RESULT_TYPES.has(block.type as string)) {
            const toolUseId = block.tool_use_id as string
            const { fileIds: _, ...result } = extractCodeExecResult(block)
            yield {
              type: 'code_execution_result',
              codeExecutionResult: { id: toolUseId, ...result },
            }
          }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'thinking_delta') {
            yield { type: 'thinking_delta', thinking: (event.delta as { thinking: string }).thinking }
          } else if (event.delta.type === 'text_delta') {
            yield { type: 'text_delta', text: event.delta.text }
          } else if (event.delta.type === 'input_json_delta') {
            const partial = (event.delta as { partial_json: string }).partial_json
            const tc = pendingToolCalls.get(event.index)
            if (tc) {
              tc.argsJson += partial
            }
            const ce = pendingCodeExecs.get(event.index)
            if (ce) {
              ce.inputJson += partial
              yield { type: 'code_execution_delta', codeExecutionDelta: { id: ce.id, partialInput: partial } }
            }
          }
        }

        if (event.type === 'content_block_stop') {
          const tc = pendingToolCalls.get(event.index)
          if (tc) {
            const toolCall: ToolCallInfo = {
              id: tc.id,
              name: tc.name,
              arguments: JSON.parse(tc.argsJson || '{}'),
            }
            yield { type: 'tool_call', toolCall }
            pendingToolCalls.delete(event.index)
          }
          const ce = pendingCodeExecs.get(event.index)
          if (ce) {
            pendingCodeExecs.delete(event.index)
          }
        }
      }

      const finalMessage = await stream.finalMessage()

      for (const block of finalMessage.content as unknown as AnyBlock[]) {
        if (CODE_EXEC_RESULT_TYPES.has(block.type as string)) {
          const toolUseId = block.tool_use_id as string
          const { fileIds } = extractCodeExecResult(block)
          if (fileIds?.length) {
            const files = await Promise.all(
              fileIds.map(async fid => {
                try {
                  const meta = await client.beta.files.retrieveMetadata(fid)
                  return { fileId: fid, filename: meta.filename, mimeType: meta.mime_type }
                } catch {
                  return { fileId: fid, filename: fid, mimeType: 'application/octet-stream' }
                }
              }),
            )
            yield { type: 'code_execution_files', codeExecutionFiles: { id: toolUseId, files } }
          }
        }
      }

      yield {
        type: 'raw_assistant_content',
        rawAssistantContent: finalMessage.content as unknown[],
        container: finalMessage.container?.id ?? undefined,
      }

      yield {
        type: 'usage',
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      }
      yield {
        type: 'done',
        stopReason: finalMessage.stop_reason === 'tool_use' ? 'tool_use' : 'end',
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      yield { type: 'error', error: message }
    }
  },
})

export const createAnthropicProvider: ProviderFactory = createAnthropicAdapter

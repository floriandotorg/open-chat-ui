import { readFileSync } from 'node:fs'
import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey } from '$lib/server/api-key'
import { decrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys, conversations, messages, systemPrompts, userSettings } from '$lib/server/db/schema'
import { getPostSystemPrompt } from '$lib/server/prompts'
import { getProviderFactory } from '$lib/server/providers'
import type { ChatMessage, ChatMessageImage, ToolCallInfo } from '$lib/server/providers/types'
import { createHub, emit, finishHub, getHub, type StreamHub } from '$lib/server/stream-hub'
import { generateConversationTitle } from '$lib/server/title'
import { executeTool, getToolSchemas } from '$lib/server/tools'
import { getUploadPath } from '$lib/server/uploads'
import type { FileAttachment, ImageAttachment, ThinkingEffort } from '$lib/types'
import Anthropic, { toFile } from '@anthropic-ai/sdk'
import { and, asc, eq } from 'drizzle-orm'

const MAX_TOOL_ROUNDS = 10
const CODE_EXEC_PROVIDERS = new Set(['anthropic'])

interface PersistedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  textOffset: number
  result: string
}

interface PersistedCodeExecution {
  type: 'code_execution'
  id: string
  name: string
  input: Record<string, unknown>
  textOffset: number
  stdout?: string
  stderr?: string
  returnCode?: number
  error?: string
  files?: { fileId: string; filename: string; mimeType: string }[]
}

const loadImageData = (attachment: ImageAttachment): ChatMessageImage => {
  const filePath = getUploadPath(attachment.id)
  const buffer = readFileSync(filePath)
  return { data: buffer.toString('base64'), mimeType: attachment.mimeType }
}

const parseImages = (raw: string | null): ImageAttachment[] => {
  if (!raw) return []
  return JSON.parse(raw) as ImageAttachment[]
}

const parseFiles = (raw: string | null): FileAttachment[] => {
  if (!raw) return []
  return JSON.parse(raw) as FileAttachment[]
}

const uploadFileToAnthropic = async (client: Anthropic, attachment: FileAttachment): Promise<string> => {
  const filePath = getUploadPath(attachment.id)
  const buffer = readFileSync(filePath)
  const uploaded = await client.beta.files.upload({
    file: await toFile(Buffer.from(buffer), attachment.filename, { type: attachment.mimeType }),
    betas: ['files-api-2025-04-14'],
  })
  return uploaded.id
}

export interface GenerationParams {
  userId: string
  conversationId: string
  modelRef: string
  thinkingEffort?: ThinkingEffort
  assistantMsgId: string
  parentId: string
  historyMessageIds: string[]
  branchParentKey?: string
  titleOnFirst: boolean
}

export const startGeneration = (params: GenerationParams): StreamHub => {
  const existing = getHub(params.conversationId)
  if (existing) return existing
  const hub = createHub(params.conversationId, params.userId)
  runGeneration(hub, params).catch(async err => {
    const msg = err instanceof Error ? err.message : 'Generation error'
    emit(hub, { type: 'error', error: msg })
    try {
      await db.update(conversations).set({ generating: false }).where(eq(conversations.id, params.conversationId))
    } catch {}
    finishHub(hub)
  })
  return hub
}

const runGeneration = async (hub: StreamHub, params: GenerationParams) => {
  const { userId, conversationId, modelRef, thinkingEffort, assistantMsgId, parentId, historyMessageIds, branchParentKey, titleOnFirst } = params
  const { provider, model } = parseModelRef(modelRef)

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
  if (!conversation) {
    throw new Error('Conversation not found')
  }

  const [keyRow] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))
  if (!keyRow) {
    throw new Error(`No API key configured for ${provider}`)
  }
  const decryptedKey = await decrypt(keyRow.encryptedKey, keyRow.iv)

  const allMsgs = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt))
  const byId = new Map(allMsgs.map(m => [m.id, m]))
  const history = historyMessageIds.map(id => byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m)

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  let baseSystemPrompt: string | undefined
  if (conversation.systemPromptId) {
    const [sp] = await db.select().from(systemPrompts).where(eq(systemPrompts.id, conversation.systemPromptId))
    baseSystemPrompt = sp?.content ?? undefined
  }
  if (!baseSystemPrompt) {
    baseSystemPrompt = conversation.systemPrompt ?? settings?.defaultSystemPrompt ?? undefined
  }
  const postSystemPrompt = getPostSystemPrompt(provider)
  const resolvedSystemPrompt = baseSystemPrompt ? `${baseSystemPrompt}\n\n${postSystemPrompt}` : postSystemPrompt

  const anthropicClient = provider === 'anthropic' ? new Anthropic({ apiKey: decryptedKey }) : null
  const allFileIds: string[] = []
  const chatMessages: ChatMessage[] = []
  for (const m of history) {
    const imgs = parseImages(m.images)
    const fls = parseFiles(m.files)
    if (fls.length && anthropicClient) {
      for (const file of fls) {
        if (file.providerFileId) {
          allFileIds.push(file.providerFileId)
        } else {
          const providerFileId = await uploadFileToAnthropic(anthropicClient, file)
          file.providerFileId = providerFileId
          allFileIds.push(providerFileId)
          await db
            .update(messages)
            .set({ files: JSON.stringify(fls) })
            .where(eq(messages.id, m.id))
        }
      }
    }
    chatMessages.push({
      role: m.role as ChatMessage['role'],
      content: m.content,
      ...(imgs.length ? { images: imgs.map(loadImageData) } : {}),
    })
  }

  if (allFileIds.length && chatMessages.length) {
    const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user')
    if (lastUserMsg) {
      lastUserMsg.containerUploadFileIds = allFileIds
    }
  }

  const llm = getProviderFactory(provider)(decryptedKey)
  const toolSchemas = getToolSchemas()
  const useCodeExecution = CODE_EXEC_PROVIDERS.has(provider)
  const toolContext = {
    userId,
    getApiKey: (p: string) => getDecryptedKey(userId, p),
  }

  let fullText = ''
  const totalUsage = { inputTokens: 0, outputTokens: 0 }
  const allToolCalls: (PersistedToolCall | PersistedCodeExecution)[] = []
  let citationCounter = 0
  let container: string | undefined = conversation.container ?? undefined

  emit(hub, { type: 'stream_meta', parentId, assistantMsgId })

  try {
    const codeExecInputs = new Map<string, string>()

    for (let round = 0; round < MAX_TOOL_ROUNDS; ++round) {
      if (hub.abort.signal.aborted) break
      let roundText = ''
      const toolCalls: ToolCallInfo[] = []
      let stopReason: 'end' | 'tool_use' = 'end'
      let rawContentBlocks: unknown[] | undefined

      for await (const event of llm.chat({
        model,
        messages: chatMessages,
        systemPrompt: resolvedSystemPrompt,
        thinkingEffort: thinkingEffort ?? 'none',
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        codeExecution: useCodeExecution,
        container,
        signal: hub.abort.signal,
      })) {
        if (hub.abort.signal.aborted) break
        if (event.type === 'text_delta') {
          roundText += event.text ?? ''
          emit(hub, event)
        } else if (event.type === 'thinking_delta') {
          emit(hub, event)
        } else if (event.type === 'tool_call' && event.toolCall) {
          toolCalls.push(event.toolCall)
          emit(hub, event)
        } else if (event.type === 'code_execution_start' && event.codeExecution) {
          emit(hub, event)
        } else if (event.type === 'code_execution_delta' && event.codeExecutionDelta) {
          const { id, partialInput } = event.codeExecutionDelta
          codeExecInputs.set(id, (codeExecInputs.get(id) ?? '') + partialInput)
          emit(hub, event)
        } else if (event.type === 'code_execution_result' && event.codeExecutionResult) {
          const textOffset = fullText.length + roundText.length
          const { id, ...result } = event.codeExecutionResult
          const inputJson = codeExecInputs.get(id) ?? '{}'
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(inputJson)
          } catch {}
          allToolCalls.push({ type: 'code_execution', id, name: 'bash_code_execution', input, textOffset, ...result })
          codeExecInputs.delete(id)
          emit(hub, event)
        } else if (event.type === 'code_execution_files' && event.codeExecutionFiles) {
          const { id, files } = event.codeExecutionFiles
          const existing = allToolCalls.find((tc): tc is PersistedCodeExecution => 'type' in tc && tc.type === 'code_execution' && tc.id === id)
          if (existing) existing.files = files
          emit(hub, event)
        } else if (event.type === 'raw_assistant_content') {
          rawContentBlocks = event.rawAssistantContent
          if (event.container) container = event.container
        } else if (event.type === 'usage') {
          totalUsage.inputTokens += event.inputTokens ?? 0
          totalUsage.outputTokens += event.outputTokens ?? 0
        } else if (event.type === 'done') {
          stopReason = event.stopReason ?? 'end'
        } else if (event.type === 'error') {
          emit(hub, event)
        }
      }

      const textOffsetForRound = fullText.length + roundText.length
      fullText += roundText

      if (stopReason !== 'tool_use' || toolCalls.length === 0) break

      chatMessages.push({ role: 'assistant', content: roundText, toolCalls, rawContentBlocks })

      const toolResults = await Promise.all(toolCalls.map(async tc => ({ tc, result: await executeTool(tc.name, tc.arguments, toolContext) })))

      for (const { tc, result } of toolResults) {
        let finalResult = result
        if (tc.name === 'web_search') {
          let count = 0
          finalResult = result.replace(/^(\d+)\.\s+/gm, () => {
            ++count
            return `${citationCounter + count}. `
          })
          citationCounter += count
        }
        chatMessages.push({ role: 'tool', content: finalResult, toolCallId: tc.id })
        allToolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          textOffset: textOffsetForRound,
          result: finalResult,
        })
        emit(hub, {
          type: 'tool_result',
          toolResult: { toolCallId: tc.id, toolName: tc.name, result: finalResult },
        })
      }
    }

    emit(hub, { type: 'usage', inputTokens: totalUsage.inputTokens, outputTokens: totalUsage.outputTokens })
    emit(hub, { type: 'done', messageId: assistantMsgId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stream error'
    emit(hub, { type: 'error', error: msg })
  }

  if (fullText || allToolCalls.length) {
    await db.insert(messages).values({
      id: assistantMsgId,
      conversationId,
      parentId,
      role: 'assistant',
      content: fullText,
      provider,
      model: modelRef,
      inputTokens: totalUsage.inputTokens || undefined,
      outputTokens: totalUsage.outputTokens || undefined,
      toolCalls: allToolCalls.length ? JSON.stringify(allToolCalls) : null,
    })

    const existingBranches: Record<string, string> = conversation.activeBranches ? JSON.parse(conversation.activeBranches) : {}
    if (branchParentKey) {
      existingBranches[branchParentKey] = parentId
    }
    existingBranches[parentId] = assistantMsgId

    await db
      .update(conversations)
      .set({
        defaultProvider: provider,
        defaultModel: modelRef,
        updatedAt: new Date(),
        activeBranches: JSON.stringify(existingBranches),
        generating: false,
        ...(container ? { container } : {}),
      })
      .where(eq(conversations.id, conversationId))

    if (titleOnFirst && conversation.title === 'New Chat') {
      generateConversationTitle(userId, conversationId).catch(() => {})
    }
  } else {
    await db.update(conversations).set({ generating: false }).where(eq(conversations.id, conversationId))
  }

  finishHub(hub)
}

import { readFileSync } from 'node:fs'
import { CITATION_TOOL_NAMES, renumberCitations } from '$lib/citations'
import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey, getDecryptedKeys } from '$lib/server/api-key'
import { decrypt } from '$lib/server/crypto'
import { mapApiKey, mapConversation, mapMessage, mapSystemPrompt, mapUserSettings, now } from '$lib/server/db/records'
import { getKnowledgeCutoff } from '$lib/server/knowledge-cutoff'
import { getFirstOrNull, isNotFound, pb } from '$lib/server/pb'
import { formatCurrentDate, getPostSystemPrompt } from '$lib/server/prompts'
import { getProviderFactory } from '$lib/server/providers'
import type { ChatMessage, ChatMessageImage, ToolCallInfo } from '$lib/server/providers/types'
import { createHub, emit, finishHub, getHub, type StreamHub } from '$lib/server/stream-hub'
import { generateConversationTitle } from '$lib/server/title'
import { executeTool, getToolSchemas } from '$lib/server/tools'
import { getUploadPath } from '$lib/server/uploads'
import type { FileAttachment, ImageAttachment, ThinkingEffort } from '$lib/types'
import Anthropic, { toFile } from '@anthropic-ai/sdk'

const MAX_TOOL_ROUNDS = 10
const CODE_EXEC_PROVIDERS = new Set(['anthropic'])

interface PersistedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  textOffset: number
  result: string
  rawResult?: string
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

const parseImages = (raw: unknown[] | null | undefined): ImageAttachment[] => (raw ?? []) as ImageAttachment[]

const parseFiles = (raw: unknown[] | null | undefined): FileAttachment[] => (raw ?? []) as FileAttachment[]

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
  ;(async () => {
    try {
      await pb.collection('conversations').update(params.conversationId, { generating: true })
      await runGeneration(hub, params)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation error'
      emit(hub, { type: 'error', error: msg })
      try {
        await pb.collection('conversations').update(params.conversationId, { generating: false })
      } catch {}
      finishHub(hub)
    }
  })()
  return hub
}

const runGeneration = async (hub: StreamHub, params: GenerationParams) => {
  const { userId, conversationId, modelRef, thinkingEffort, assistantMsgId, parentId, historyMessageIds, branchParentKey, titleOnFirst } = params
  const { provider, model } = parseModelRef(modelRef)

  const conversation = await getFirstOrNull(
    pb
      .collection('conversations')
      .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: conversationId, u: userId }))
      .then(mapConversation),
  )
  if (!conversation) {
    throw new Error('Conversation not found')
  }

  const keyRow = await getFirstOrNull(
    pb
      .collection('api_keys')
      .getFirstListItem(pb.filter('user = {:u} && provider = {:p}', { u: userId, p: provider }), { sort: 'createdAt' })
      .then(mapApiKey),
  )
  if (!keyRow) {
    throw new Error(`No API key configured for ${provider}`)
  }
  const decryptedKey = await decrypt(keyRow.encryptedKey, keyRow.iv)

  const allMsgs = (await pb.collection('messages').getFullList({ filter: pb.filter('conversation = {:c}', { c: conversationId }), sort: 'createdAt' })).map(mapMessage)
  const byId = new Map(allMsgs.map(m => [m.id, m]))
  const history = historyMessageIds.map(id => byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m)

  let resolvedSystemPrompt = conversation.resolvedSystemPrompt ?? undefined
  if (!resolvedSystemPrompt) {
    const settings = await getFirstOrNull(
      pb
        .collection('user_settings')
        .getFirstListItem(pb.filter('user = {:u}', { u: userId }))
        .then(mapUserSettings),
    )
    let baseSystemPrompt: string | undefined
    if (conversation.systemPromptId) {
      try {
        const sp = mapSystemPrompt(await pb.collection('system_prompts').getOne(conversation.systemPromptId))
        baseSystemPrompt = sp.content ?? undefined
      } catch (err) {
        if (!isNotFound(err)) throw err
      }
    }
    if (!baseSystemPrompt) {
      baseSystemPrompt = conversation.systemPrompt ?? settings?.defaultSystemPrompt ?? undefined
    }
    const postSystemPrompt = getPostSystemPrompt(provider)
    const combinedSystemPrompt = baseSystemPrompt ? `${baseSystemPrompt}\n\n${postSystemPrompt}` : postSystemPrompt
    resolvedSystemPrompt = combinedSystemPrompt.replaceAll('{CURRENT_DATE}', formatCurrentDate())
    if (resolvedSystemPrompt.includes('{KNOWLEDGE_CUTOFF}')) {
      const cutoff = (await getKnowledgeCutoff(modelRef)) ?? ''
      resolvedSystemPrompt = resolvedSystemPrompt.replaceAll('{KNOWLEDGE_CUTOFF}', cutoff)
    }
    await pb.collection('conversations').update(conversationId, { resolvedSystemPrompt })
  }

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
          await pb.collection('messages').update(m.id, { files: fls })
        }
      }
    }
    if (imgs.length && anthropicClient) {
      let imagesChanged = false
      await Promise.all(
        imgs.map(async img => {
          if (img.providerFileId) return
          const ext = img.mimeType.split('/')[1] ?? 'png'
          img.providerFileId = await uploadFileToAnthropic(anthropicClient, { ...img, filename: `image.${ext}` })
          imagesChanged = true
        }),
      )
      if (imagesChanged) {
        await pb.collection('messages').update(m.id, { images: imgs })
      }
    }
    const parsedToolCalls = m.toolCalls ? (m.toolCalls as (PersistedToolCall | PersistedCodeExecution)[]) : null
    const allToolCallsParsed = parsedToolCalls ?? []
    const regularToolCalls = allToolCallsParsed.filter((tc): tc is PersistedToolCall => !('type' in tc && tc.type === 'code_execution'))
    const hasCodeExec = allToolCallsParsed.some(tc => 'type' in tc && tc.type === 'code_execution')
    const rawBlocksByOffset = new Map<number, unknown[]>()
    if (m.rawContentBlocks) {
      for (const entry of m.rawContentBlocks as { textOffset: number; blocks: unknown[] }[]) {
        rawBlocksByOffset.set(entry.textOffset, entry.blocks)
      }
    }
    const imgsLoaded = imgs.length ? imgs.map(img => (anthropicClient && img.providerFileId ? { data: '', mimeType: img.mimeType, providerFileId: img.providerFileId } : loadImageData(img))) : undefined

    if (m.role === 'assistant' && (regularToolCalls.length || hasCodeExec)) {
      // The persisted content is the concatenated text from every round; each
      // tool call's textOffset marks the end of its round's text. Split there
      // so tool calls and results are interleaved in their original position,
      // with the final answer text following the last tool round. Rounds with
      // code execution replay their rawContentBlocks verbatim (server-side
      // tool_use/result blocks can't be reconstructed from toolCalls alone).
      const offsets = [...new Set(allToolCallsParsed.map(tc => tc.textOffset))].sort((a, b) => a - b)
      let prev = 0
      let firstSegment = true
      for (const off of offsets) {
        const roundCalls = regularToolCalls.filter(tc => tc.textOffset === off)
        const roundBlocks = rawBlocksByOffset.get(off)
        if (roundBlocks?.length) {
          chatMessages.push({
            role: 'assistant',
            content: m.content.slice(prev, off),
            rawContentBlocks: roundBlocks,
            ...(firstSegment && imgsLoaded ? { images: imgsLoaded } : {}),
          })
        } else {
          chatMessages.push({
            role: 'assistant',
            content: m.content.slice(prev, off),
            toolCalls: roundCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
            ...(firstSegment && imgsLoaded ? { images: imgsLoaded } : {}),
          })
        }
        firstSegment = false
        for (const tc of roundCalls) {
          chatMessages.push({ role: 'tool', content: tc.result, toolCallId: tc.id })
        }
        prev = off
      }
      const tail = m.content.slice(prev)
      const tailBlocks = rawBlocksByOffset.get(m.content.length)
      if (tailBlocks?.length) {
        chatMessages.push({ role: 'assistant', content: tail, rawContentBlocks: tailBlocks })
      } else if (tail) {
        chatMessages.push({ role: 'assistant', content: tail })
      }
    } else {
      chatMessages.push({
        role: m.role as ChatMessage['role'],
        content: m.content,
        ...(imgsLoaded ? { images: imgsLoaded } : {}),
      })
    }
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
    getApiKeys: (p: string) => getDecryptedKeys(userId, p),
  }

  let fullText = ''
  const totalUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }
  const allToolCalls: (PersistedToolCall | PersistedCodeExecution)[] = []
  const allRawContentBlocks: { textOffset: number; blocks: unknown[] }[] = []
  let citationCounter = 0
  let container: string | undefined = conversation.container ?? undefined

  emit(hub, { type: 'stream_meta', parentId, assistantMsgId })

  let placeholderCreated = false
  try {
    await pb.collection('messages').create({
      id: assistantMsgId,
      conversation: conversationId,
      parentId,
      role: 'assistant',
      content: '',
      provider,
      model: modelRef,
      generating: true,
      createdAt: now(),
    })
    placeholderCreated = true
  } catch {}

  let pendingContent = ''
  let lastFlushAt = 0
  let finalized = false
  let flushing = false
  let flushPromise: Promise<void> | null = null
  const FLUSH_INTERVAL = 500
  const flushPartial = () => {
    if (!placeholderCreated || finalized || flushing) return
    if (Date.now() - lastFlushAt < FLUSH_INTERVAL) return
    if (!pendingContent) return
    flushing = true
    lastFlushAt = Date.now()
    const content = pendingContent
    flushPromise = pb
      .collection('messages')
      .update(assistantMsgId, { content, generating: true })
      .then(() => {
        flushing = false
        flushPromise = null
      })
      .catch(() => {
        flushing = false
        flushPromise = null
      })
  }

  let streamSucceeded = false
  try {
    const codeExecInputs = new Map<string, string>()

    for (let round = 0; round < MAX_TOOL_ROUNDS; ++round) {
      if (hub.abort.signal.aborted) break
      let roundText = ''
      const toolCalls: ToolCallInfo[] = []
      const pendingCodeExecResults: { type: 'code_execution'; id: string; name: string; input: Record<string, unknown>; stdout?: string; stderr?: string; returnCode?: number; error?: string; files?: { fileId: string; filename: string; mimeType: string }[] }[] = []
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
          pendingContent = fullText + roundText
          emit(hub, event)
          flushPartial()
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
          const { id, ...result } = event.codeExecutionResult
          const inputJson = codeExecInputs.get(id) ?? '{}'
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(inputJson)
          } catch {}
          pendingCodeExecResults.push({ type: 'code_execution', id, name: 'bash_code_execution', input, ...result })
          codeExecInputs.delete(id)
          emit(hub, event)
        } else if (event.type === 'code_execution_files' && event.codeExecutionFiles) {
          const { id, files } = event.codeExecutionFiles
          const existing = pendingCodeExecResults.find(tc => tc.id === id)
          if (existing) existing.files = files
          emit(hub, event)
        } else if (event.type === 'raw_assistant_content') {
          rawContentBlocks = event.rawAssistantContent
          if (event.container) container = event.container
        } else if (event.type === 'usage') {
          totalUsage.inputTokens += event.inputTokens ?? 0
          totalUsage.outputTokens += event.outputTokens ?? 0
          totalUsage.cacheReadInputTokens += event.cacheReadInputTokens ?? 0
          totalUsage.cacheCreationInputTokens += event.cacheCreationInputTokens ?? 0
        } else if (event.type === 'done') {
          stopReason = event.stopReason ?? 'end'
        } else if (event.type === 'error') {
          emit(hub, event)
        }
      }

      const textOffsetForRound = fullText.length + roundText.length
      fullText += roundText

      for (const ce of pendingCodeExecResults) {
        allToolCalls.push({ ...ce, textOffset: textOffsetForRound })
      }
      if (pendingCodeExecResults.length && rawContentBlocks?.length) {
        allRawContentBlocks.push({ textOffset: textOffsetForRound, blocks: rawContentBlocks })
      }

      if (stopReason !== 'tool_use' || toolCalls.length === 0) break

      chatMessages.push({ role: 'assistant', content: roundText, toolCalls, rawContentBlocks })

      const toolResults = await Promise.all(toolCalls.map(async tc => ({ tc, ...(await executeTool(tc.name, tc.arguments, toolContext)) })))

      for (const { tc, result, rawResult } of toolResults) {
        let finalResult = result
        if (CITATION_TOOL_NAMES.has(tc.name)) {
          const { result: renumbered, count } = renumberCitations(result, citationCounter)
          finalResult = renumbered
          citationCounter += count
        }
        chatMessages.push({ role: 'tool', content: finalResult, toolCallId: tc.id })
        allToolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          textOffset: textOffsetForRound,
          result: finalResult,
          ...(rawResult !== undefined ? { rawResult } : {}),
        })
        emit(hub, {
          type: 'tool_result',
          toolResult: { toolCallId: tc.id, toolName: tc.name, result: finalResult, ...(rawResult !== undefined ? { rawResult } : {}) },
        })
      }
    }

    emit(hub, {
      type: 'usage',
      inputTokens: totalUsage.inputTokens,
      outputTokens: totalUsage.outputTokens,
      cacheReadInputTokens: totalUsage.cacheReadInputTokens,
      cacheCreationInputTokens: totalUsage.cacheCreationInputTokens,
    })
    streamSucceeded = true
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stream error'
    emit(hub, { type: 'error', error: msg })
  }

  const persisted = !!(fullText || allToolCalls.length)

  finalized = true
  if (flushPromise) {
    try {
      await flushPromise
    } catch {}
  }

  if (persisted) {
    if (placeholderCreated) {
      await pb.collection('messages').update(assistantMsgId, {
        parentId,
        role: 'assistant',
        content: fullText,
        provider,
        model: modelRef,
        inputTokens: totalUsage.inputTokens || undefined,
        outputTokens: totalUsage.outputTokens || undefined,
        cacheReadInputTokens: totalUsage.cacheReadInputTokens || undefined,
        cacheCreationInputTokens: totalUsage.cacheCreationInputTokens || undefined,
        toolCalls: allToolCalls.length ? allToolCalls : null,
        rawContentBlocks: allRawContentBlocks.length ? allRawContentBlocks : null,
        generating: false,
      })
    } else {
      await pb.collection('messages').create({
        id: assistantMsgId,
        conversation: conversationId,
        parentId,
        role: 'assistant',
        content: fullText,
        provider,
        model: modelRef,
        inputTokens: totalUsage.inputTokens || undefined,
        outputTokens: totalUsage.outputTokens || undefined,
        cacheReadInputTokens: totalUsage.cacheReadInputTokens || undefined,
        cacheCreationInputTokens: totalUsage.cacheCreationInputTokens || undefined,
        toolCalls: allToolCalls.length ? allToolCalls : null,
        rawContentBlocks: allRawContentBlocks.length ? allRawContentBlocks : null,
        generating: false,
        createdAt: now(),
      })
    }

    const existingBranches: Record<string, string> = conversation.activeBranches ?? {}
    if (branchParentKey) {
      existingBranches[branchParentKey] = parentId
    }
    existingBranches[parentId] = assistantMsgId

    await pb.collection('conversations').update(conversationId, {
      updatedAt: now(),
      activeBranches: existingBranches,
      generating: false,
      ...(container ? { container } : {}),
    })
  } else {
    if (placeholderCreated) {
      try {
        await pb.collection('messages').delete(assistantMsgId)
      } catch {}
    }
    await pb.collection('conversations').update(conversationId, { generating: false })
  }

  if (streamSucceeded) {
    emit(hub, { type: 'done', messageId: persisted ? assistantMsgId : undefined })
  }

  if (persisted && titleOnFirst && conversation.title === 'New Chat') {
    generateConversationTitle(userId, conversationId).catch(() => {})
  }

  finishHub(hub)
}

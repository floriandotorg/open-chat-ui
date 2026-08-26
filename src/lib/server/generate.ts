import { readFileSync } from 'node:fs'
import { CITATION_TOOL_NAMES, renumberCitations } from '$lib/citations'
import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey, getDecryptedKeys } from '$lib/server/api-key'
import { decrypt } from '$lib/server/crypto'
import { mapApiKey, mapConversation, mapMessage, mapSystemPrompt, mapUserSettings, now } from '$lib/server/db/records'
import { type ActiveGeneration, finishGeneration, getGeneration, registerGeneration } from '$lib/server/generations'
import { buildHistoryMessages, type PersistedCodeExecution, type PersistedEntry, type PersistedToolCall } from '$lib/server/history'
import { getKnowledgeCutoff } from '$lib/server/knowledge-cutoff'
import { getFirstOrNull, isNotFound, pb } from '$lib/server/pb'
import { formatCurrentDate, getPostSystemPrompt } from '$lib/server/prompts'
import { getProviderFactory } from '$lib/server/providers'
import { containsServerToolBlocks } from '$lib/server/providers/anthropic'
import type { ChatMessage, ChatMessageImage, ToolCallInfo } from '$lib/server/providers/types'
import { generateConversationTitle } from '$lib/server/title'
import { executeTool, getToolSchemas } from '$lib/server/tools'
import { getUploadPath, hasUpload } from '$lib/server/uploads'
import type { FileAttachment, ImageAttachment, ThinkingEffort } from '$lib/types'
import Anthropic, { toFile } from '@anthropic-ai/sdk'

const MAX_TOOL_ROUNDS = 30
const CODE_EXEC_PROVIDERS = new Set(['anthropic'])

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

type LiveToolCall = (Omit<PersistedToolCall, 'result'> & { result?: string }) | PersistedCodeExecution

export const startGeneration = (params: GenerationParams): ActiveGeneration => {
  const existing = getGeneration(params.conversationId)
  if (existing) return existing
  const generation = registerGeneration(params.conversationId, params.userId)
  ;(async () => {
    try {
      await pb.collection('conversations').update(params.conversationId, { generating: true })
      await runGeneration(generation, params)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation error'
      try {
        await pb.collection('messages').update(params.parentId, { error: message })
      } catch {}
      try {
        await pb.collection('conversations').update(params.conversationId, { generating: false })
      } catch {}
      finishGeneration(params.conversationId)
    }
  })()
  return generation
}

const mergeBranchPointers = async (conversationId: string, entries: Record<string, string | null>) => {
  const row = await pb.collection('conversations').getOne(conversationId, { fields: 'activeBranches' })
  const branches: Record<string, string> = (row.activeBranches as Record<string, string> | null) ?? {}
  for (const [key, value] of Object.entries(entries)) {
    if (value === null) delete branches[key]
    else branches[key] = value
  }
  await pb.collection('conversations').update(conversationId, { activeBranches: branches })
}

const runGeneration = async (generation: ActiveGeneration, params: GenerationParams) => {
  const { userId, conversationId, modelRef, thinkingEffort, assistantMsgId, parentId, historyMessageIds, branchParentKey, titleOnFirst } = params
  const { provider, model } = parseModelRef(modelRef)
  const signal = generation.abort.signal

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
    // Attachments whose file vanished from disk are dropped so replying to
    // old conversations keeps working instead of dying on ENOENT.
    const imgs = parseImages(m.images).filter(img => (!!anthropicClient && !!img.providerFileId) || hasUpload(img.id))
    const fls = parseFiles(m.files).filter(file => !!file.providerFileId || hasUpload(file.id))
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
    const allToolCallsParsed = (m.toolCalls ?? []) as PersistedEntry[]
    const rawEntries = (m.rawContentBlocks ?? []) as { textOffset: number; blocks: unknown[] }[]
    const imgsLoaded = imgs.length ? imgs.map(img => (anthropicClient && img.providerFileId ? { data: '', mimeType: img.mimeType, providerFileId: img.providerFileId } : loadImageData(img))) : undefined

    const segments = buildHistoryMessages(m.role, m.content, allToolCallsParsed, rawEntries)
    if (segments[0] && imgsLoaded) {
      segments[0].images = imgsLoaded
    }
    chatMessages.push(...segments)
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
  let thinkingText = ''
  let thinkingSeconds = 0
  let thinkingStartedAt: number | null = null
  const closeThinkingPhase = () => {
    if (thinkingStartedAt !== null) {
      thinkingSeconds += Math.round((Date.now() - thinkingStartedAt) / 1000)
      thinkingStartedAt = null
    }
  }
  const totalUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cost: 0 }
  const allToolCalls: (PersistedToolCall | PersistedCodeExecution)[] = []
  const allRawContentBlocks: { textOffset: number; blocks: unknown[] }[] = []
  const liveToolCalls: LiveToolCall[] = []
  let citationCounter = 0
  let container: string | undefined = conversation.container ?? undefined

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
    const branchEntries: Record<string, string> = { [parentId]: assistantMsgId }
    if (branchParentKey) {
      branchEntries[branchParentKey] = parentId
    }
    await mergeBranchPointers(conversationId, branchEntries)
  } catch {}

  // Retry of a failed send reuses the parent message; clear its stored
  // error so the banner clears immediately on all attached clients.
  const triggeringMsg = history.at(-1)
  if (triggeringMsg?.id === parentId && triggeringMsg.error) {
    try {
      await pb.collection('messages').update(parentId, { error: null })
    } catch {}
  }

  // Live streaming state is flushed into the placeholder record on every
  // delta; clients render straight from PocketBase realtime events. Flushes
  // are serialized and coalesced: while one write is in flight further
  // deltas only set the dirty flag, so cadence adapts to PB write latency.
  let flushing = false
  let dirty = false
  let finalized = false
  const flush = async (): Promise<void> => {
    if (finalized || !placeholderCreated) return
    if (flushing) {
      dirty = true
      return
    }
    flushing = true
    try {
      await pb.collection('messages').update(assistantMsgId, {
        content: fullText,
        thinking: thinkingText || null,
        toolCalls: liveToolCalls.length ? [...liveToolCalls] : null,
        generating: true,
      })
    } catch {}
    flushing = false
    if (dirty) {
      dirty = false
      await flush()
    }
  }
  const scheduleFlush = () => {
    void flush()
  }

  let streamError: string | undefined
  try {
    const codeExecInputs = new Map<string, string>()

    for (let round = 0; round < MAX_TOOL_ROUNDS; ++round) {
      if (signal.aborted) break
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
        signal,
      })) {
        if (signal.aborted) break
        if (event.type === 'text_delta') {
          closeThinkingPhase()
          roundText += event.text ?? ''
          fullText += event.text ?? ''
          scheduleFlush()
        } else if (event.type === 'thinking_delta') {
          if (thinkingStartedAt === null) thinkingStartedAt = Date.now()
          thinkingText += event.thinking ?? ''
          scheduleFlush()
        } else if (event.type === 'tool_call' && event.toolCall) {
          toolCalls.push(event.toolCall)
          liveToolCalls.push({ id: event.toolCall.id, name: event.toolCall.name, arguments: event.toolCall.arguments, textOffset: fullText.length })
          scheduleFlush()
        } else if (event.type === 'code_execution_start' && event.codeExecution) {
          liveToolCalls.push({ type: 'code_execution', id: event.codeExecution.id, name: event.codeExecution.name, input: {}, textOffset: fullText.length })
          scheduleFlush()
        } else if (event.type === 'code_execution_delta' && event.codeExecutionDelta) {
          const { id, partialInput } = event.codeExecutionDelta
          codeExecInputs.set(id, (codeExecInputs.get(id) ?? '') + partialInput)
          const live = liveToolCalls.find((tc): tc is PersistedCodeExecution => 'type' in tc && tc.type === 'code_execution' && tc.id === id)
          if (live) {
            const raw = codeExecInputs.get(id) ?? ''
            try {
              live.input = JSON.parse(raw)
            } catch {
              live.input = { code: raw }
            }
            scheduleFlush()
          }
        } else if (event.type === 'code_execution_result' && event.codeExecutionResult) {
          const { id, ...result } = event.codeExecutionResult
          const inputJson = codeExecInputs.get(id) ?? '{}'
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(inputJson)
          } catch {}
          pendingCodeExecResults.push({ type: 'code_execution', id, name: 'bash_code_execution', input, ...result })
          codeExecInputs.delete(id)
          const live = liveToolCalls.find((tc): tc is PersistedCodeExecution => 'type' in tc && tc.type === 'code_execution' && tc.id === id)
          if (live) {
            Object.assign(live, { input, ...result })
            scheduleFlush()
          }
        } else if (event.type === 'code_execution_files' && event.codeExecutionFiles) {
          const { id, files } = event.codeExecutionFiles
          const existing = pendingCodeExecResults.find(tc => tc.id === id)
          if (existing) existing.files = files
          const live = liveToolCalls.find((tc): tc is PersistedCodeExecution => 'type' in tc && tc.type === 'code_execution' && tc.id === id)
          if (live) {
            live.files = files
            scheduleFlush()
          }
        } else if (event.type === 'raw_assistant_content') {
          rawContentBlocks = event.rawAssistantContent
          if (event.container) container = event.container
        } else if (event.type === 'usage') {
          totalUsage.inputTokens += event.inputTokens ?? 0
          totalUsage.outputTokens += event.outputTokens ?? 0
          totalUsage.cacheReadInputTokens += event.cacheReadInputTokens ?? 0
          totalUsage.cacheCreationInputTokens += event.cacheCreationInputTokens ?? 0
          totalUsage.cost += event.cost ?? 0
        } else if (event.type === 'done') {
          stopReason = event.stopReason ?? 'end'
        } else if (event.type === 'error') {
          streamError = event.error ?? 'Generation failed'
        }
      }

      const textOffsetForRound = fullText.length

      for (const ce of pendingCodeExecResults) {
        allToolCalls.push({ ...ce, textOffset: textOffsetForRound })
      }
      // A round whose server_tool_use result lands in a later turn (pause_turn,
      // mixed server/client tool turns) still needs its raw blocks persisted —
      // otherwise the later result replays without its partner and Anthropic
      // rejects the request.
      if (rawContentBlocks?.length && containsServerToolBlocks(rawContentBlocks)) {
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
        const live = liveToolCalls.find(entry => entry.id === tc.id)
        if (live && !('type' in live)) {
          live.result = finalResult
          if (rawResult !== undefined) live.rawResult = rawResult
        }
        scheduleFlush()
      }
    }
  } catch (err) {
    streamError = err instanceof Error ? err.message : 'Stream error'
  }

  closeThinkingPhase()
  const persisted = !!(fullText || allToolCalls.length)

  finalized = true
  dirty = false
  while (flushing) {
    await new Promise(r => setTimeout(r, 10))
  }

  if (persisted) {
    const finalFields = {
      parentId,
      role: 'assistant',
      content: fullText,
      provider,
      model: modelRef,
      thinking: thinkingText || null,
      thinkingDuration: thinkingText ? thinkingSeconds : undefined,
      inputTokens: totalUsage.inputTokens || undefined,
      outputTokens: totalUsage.outputTokens || undefined,
      cacheReadInputTokens: totalUsage.cacheReadInputTokens || undefined,
      cacheCreationInputTokens: totalUsage.cacheCreationInputTokens || undefined,
      cost: totalUsage.cost || undefined,
      toolCalls: allToolCalls.length ? allToolCalls : null,
      rawContentBlocks: allRawContentBlocks.length ? allRawContentBlocks : null,
      generating: false,
    }
    if (placeholderCreated) {
      await pb.collection('messages').update(assistantMsgId, finalFields)
    } else {
      await pb.collection('messages').create({
        id: assistantMsgId,
        conversation: conversationId,
        ...finalFields,
        createdAt: now(),
      })
    }

    const branchEntries: Record<string, string> = { [parentId]: assistantMsgId }
    if (branchParentKey) {
      branchEntries[branchParentKey] = parentId
    }
    await mergeBranchPointers(conversationId, branchEntries)

    await pb.collection('conversations').update(conversationId, {
      updatedAt: now(),
      generating: false,
      ...(container ? { container } : {}),
    })
  } else {
    if (placeholderCreated) {
      try {
        await pb.collection('messages').delete(assistantMsgId)
      } catch {}
      const revertEntries: Record<string, string | null> = { [parentId]: null }
      try {
        await mergeBranchPointers(conversationId, revertEntries)
      } catch {}
    }
    // Failure left nothing to persist: record the error on the triggering
    // user message so the client banner survives reloads and re-attaches.
    if (streamError) {
      try {
        await pb.collection('messages').update(parentId, { error: streamError })
      } catch {}
    }
    await pb.collection('conversations').update(conversationId, { generating: false })
  }

  if (persisted && titleOnFirst && conversation.title === 'New Chat') {
    generateConversationTitle(userId, conversationId).catch(() => {})
  }

  finishGeneration(conversationId)
}

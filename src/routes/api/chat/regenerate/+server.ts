import { readFileSync } from 'node:fs'
import { getAncestorPath } from '$lib/message-tree'
import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { decrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys, conversations, messages, systemPrompts, userSettings } from '$lib/server/db/schema'
import { getPostSystemPrompt } from '$lib/server/prompts'
import { getProviderFactory } from '$lib/server/providers'
import type { ChatMessage, ChatMessageImage, ToolCallInfo } from '$lib/server/providers/types'
import { executeTool, getToolSchemas } from '$lib/server/tools'
import { getUploadPath } from '$lib/server/uploads'
import type { FileAttachment, ImageAttachment } from '$lib/types'
import type { RequestHandler } from './$types'
import Anthropic, { toFile } from '@anthropic-ai/sdk'
import { error } from '@sveltejs/kit'
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

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()
  const {
    conversationId,
    messageId,
    model: modelRef,
    thinkingEffort,
  } = body as {
    conversationId: string
    messageId: string
    model: string
    thinkingEffort?: 'none' | 'low' | 'medium' | 'high' | 'max'
  }

  const { provider, model } = parseModelRef(modelRef)

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const allMsgs = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt))
  const targetMsg = allMsgs.find(m => m.id === messageId)
  if (!targetMsg || targetMsg.role !== 'assistant') {
    throw error(400, 'Invalid message for regeneration')
  }

  const userParentId = targetMsg.parentId
  if (!userParentId) {
    throw error(400, 'Cannot regenerate: no parent message')
  }

  const ancestorPath = getAncestorPath(userParentId, allMsgs)

  const [keyRow] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))

  if (!keyRow) {
    throw error(400, `No API key configured for ${provider}`)
  }

  const decryptedKey = await decrypt(keyRow.encryptedKey, keyRow.iv)

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
  for (const m of ancestorPath) {
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
  let clientConnected = true
  const newAssistantId = crypto.randomUUID()

  const enqueue = (controller: ReadableStreamDefaultController, data: Uint8Array) => {
    if (!clientConnected) return
    try {
      controller.enqueue(data)
    } catch {
      clientConnected = false
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: unknown) => enqueue(controller, encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      try {
        const codeExecInputs = new Map<string, string>()

        for (let round = 0; round < MAX_TOOL_ROUNDS; ++round) {
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
          })) {
            if (event.type === 'text_delta') {
              roundText += event.text ?? ''
              send(event)
            } else if (event.type === 'thinking_delta') {
              send(event)
            } else if (event.type === 'tool_call' && event.toolCall) {
              toolCalls.push(event.toolCall)
              send(event)
            } else if (event.type === 'code_execution_start' && event.codeExecution) {
              send(event)
            } else if (event.type === 'code_execution_delta' && event.codeExecutionDelta) {
              const { id, partialInput } = event.codeExecutionDelta
              codeExecInputs.set(id, (codeExecInputs.get(id) ?? '') + partialInput)
              send(event)
            } else if (event.type === 'code_execution_result' && event.codeExecutionResult) {
              const textOffset = fullText.length + roundText.length
              const { id, ...result } = event.codeExecutionResult
              const inputJson = codeExecInputs.get(id) ?? '{}'
              let input: Record<string, unknown> = {}
              try {
                input = JSON.parse(inputJson)
              } catch {}
              allToolCalls.push({
                type: 'code_execution',
                id,
                name: 'bash_code_execution',
                input,
                textOffset,
                ...result,
              })
              codeExecInputs.delete(id)
              send(event)
            } else if (event.type === 'code_execution_files' && event.codeExecutionFiles) {
              const { id, files } = event.codeExecutionFiles
              const existing = allToolCalls.find((tc): tc is PersistedCodeExecution => 'type' in tc && tc.type === 'code_execution' && tc.id === id)
              if (existing) {
                existing.files = files
              }
              send(event)
            } else if (event.type === 'raw_assistant_content') {
              rawContentBlocks = event.rawAssistantContent
              if (event.container) container = event.container
            } else if (event.type === 'usage') {
              totalUsage.inputTokens += event.inputTokens ?? 0
              totalUsage.outputTokens += event.outputTokens ?? 0
            } else if (event.type === 'done') {
              stopReason = event.stopReason ?? 'end'
            } else if (event.type === 'error') {
              send(event)
            }
          }

          const textOffsetForRound = fullText.length + roundText.length
          fullText += roundText

          if (stopReason !== 'tool_use' || toolCalls.length === 0) break

          chatMessages.push({
            role: 'assistant',
            content: roundText,
            toolCalls,
            rawContentBlocks,
          })

          const toolResults = await Promise.all(
            toolCalls.map(async tc => ({
              tc,
              result: await executeTool(tc.name, tc.arguments, toolContext),
            })),
          )

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
            send({
              type: 'tool_result',
              toolResult: { toolCallId: tc.id, toolName: tc.name, result: finalResult },
            })
          }
        }

        send({ type: 'usage', inputTokens: totalUsage.inputTokens, outputTokens: totalUsage.outputTokens })
        send({ type: 'done', messageId: newAssistantId })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream error'
        send({ type: 'error', error: msg })
      }

      if (fullText || allToolCalls.length) {
        await db.insert(messages).values({
          id: newAssistantId,
          conversationId,
          parentId: userParentId,
          role: 'assistant',
          content: fullText,
          provider,
          model: modelRef,
          inputTokens: totalUsage.inputTokens || undefined,
          outputTokens: totalUsage.outputTokens || undefined,
          toolCalls: allToolCalls.length ? JSON.stringify(allToolCalls) : null,
        })

        const existingBranches: Record<string, string> = conversation.activeBranches ? JSON.parse(conversation.activeBranches) : {}
        existingBranches[userParentId] = newAssistantId

        await db
          .update(conversations)
          .set({
            defaultProvider: provider,
            defaultModel: modelRef,
            updatedAt: new Date(),
            activeBranches: JSON.stringify(existingBranches),
            ...(container ? { container } : {}),
          })
          .where(eq(conversations.id, conversationId))
      }

      if (clientConnected) {
        try {
          controller.close()
        } catch {
          clientConnected = false
        }
      }
    },
    cancel() {
      clientConnected = false
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

import { readFileSync } from 'node:fs'
import { parseModelRef } from '$lib/model-ref'
import { getDecryptedKey } from '$lib/server/api-key'
import { requireUser } from '$lib/server/auth-guard'
import { decrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys, conversations, messages, userSettings } from '$lib/server/db/schema'
import { getProviderFactory } from '$lib/server/providers'
import type { ChatMessage, ChatMessageImage, ToolCallInfo } from '$lib/server/providers/types'
import { executeTool, getToolSchemas } from '$lib/server/tools'
import { getUploadPath } from '$lib/server/uploads'
import type { ImageAttachment } from '$lib/types'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'
import { and, asc, eq } from 'drizzle-orm'

const MAX_TOOL_ROUNDS = 10

interface PersistedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  textOffset: number
  result: string
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

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()
  const {
    conversationId,
    model: modelRef,
    message,
    images: imageIds,
    systemPrompt,
    thinkingEffort,
  } = body as {
    conversationId: string
    model: string
    message: string
    images?: ImageAttachment[]
    systemPrompt?: string
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

  await db.insert(messages).values({
    conversationId,
    role: 'user',
    content: message,
    images: imageIds?.length ? JSON.stringify(imageIds) : null,
  })

  const [keyRow] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))

  if (!keyRow) {
    throw error(400, `No API key configured for ${provider}`)
  }

  const decryptedKey = await decrypt(keyRow.encryptedKey, keyRow.iv)

  const history = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt))

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))

  const resolvedSystemPrompt = systemPrompt ?? conversation.systemPrompt ?? settings?.defaultSystemPrompt ?? undefined

  const chatMessages: ChatMessage[] = history.map(m => {
    const imgs = parseImages(m.images)
    return {
      role: m.role as ChatMessage['role'],
      content: m.content,
      ...(imgs.length ? { images: imgs.map(loadImageData) } : {}),
    }
  })

  const llm = getProviderFactory(provider)(decryptedKey)
  const toolSchemas = getToolSchemas()
  const toolContext = {
    userId,
    getApiKey: (p: string) => getDecryptedKey(userId, p),
  }

  let fullText = ''
  const totalUsage = { inputTokens: 0, outputTokens: 0 }
  const allToolCalls: PersistedToolCall[] = []
  let clientConnected = true

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
        for (let round = 0; round < MAX_TOOL_ROUNDS; ++round) {
          let roundText = ''
          const toolCalls: ToolCallInfo[] = []
          let stopReason: 'end' | 'tool_use' = 'end'

          for await (const event of llm.chat({
            model,
            messages: chatMessages,
            systemPrompt: resolvedSystemPrompt,
            thinkingEffort: thinkingEffort ?? 'none',
            tools: toolSchemas.length > 0 ? toolSchemas : undefined,
          })) {
            if (event.type === 'text_delta') {
              roundText += event.text ?? ''
              send(event)
            } else if (event.type === 'thinking_delta') {
              send(event)
            } else if (event.type === 'tool_call' && event.toolCall) {
              toolCalls.push(event.toolCall)
              send(event)
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

          chatMessages.push({ role: 'assistant', content: roundText, toolCalls })

          const toolResults = await Promise.all(
            toolCalls.map(async tc => ({
              tc,
              result: await executeTool(tc.name, tc.arguments, toolContext),
            })),
          )

          for (const { tc, result } of toolResults) {
            chatMessages.push({ role: 'tool', content: result, toolCallId: tc.id })
            allToolCalls.push({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
              textOffset: textOffsetForRound,
              result,
            })
            send({
              type: 'tool_result',
              toolResult: { toolCallId: tc.id, toolName: tc.name, result },
            })
          }
        }

        send({ type: 'usage', inputTokens: totalUsage.inputTokens, outputTokens: totalUsage.outputTokens })
        send({ type: 'done' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream error'
        send({ type: 'error', error: msg })
      }

      if (fullText) {
        await db.insert(messages).values({
          conversationId,
          role: 'assistant',
          content: fullText,
          provider,
          model: modelRef,
          inputTokens: totalUsage.inputTokens || undefined,
          outputTokens: totalUsage.outputTokens || undefined,
          toolCalls: allToolCalls.length ? JSON.stringify(allToolCalls) : null,
        })
        await db.update(conversations).set({ defaultProvider: provider, defaultModel: modelRef, updatedAt: new Date() }).where(eq(conversations.id, conversationId))
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

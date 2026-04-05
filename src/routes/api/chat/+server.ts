import { parseModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { decrypt } from '$lib/server/crypto'
import { db } from '$lib/server/db'
import { apiKeys, conversations, messages, userSettings } from '$lib/server/db/schema'
import { getProviderFactory } from '$lib/server/providers'
import type { ChatMessage } from '$lib/server/providers/types'
import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'
import { and, asc, eq } from 'drizzle-orm'

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()
  const {
    conversationId,
    model: modelRef,
    message,
    systemPrompt,
    thinkingEffort,
  } = body as {
    conversationId: string
    model: string
    message: string
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

  const chatMessages: ChatMessage[] = history.map(m => ({
    role: m.role as ChatMessage['role'],
    content: m.content,
  }))

  const llm = getProviderFactory(provider)(decryptedKey)

  let fullText = ''
  let tokenUsage: { inputTokens?: number; outputTokens?: number } = {}

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const event of llm.chat({
          model,
          messages: chatMessages,
          systemPrompt: resolvedSystemPrompt,
          thinkingEffort: thinkingEffort ?? 'none',
          signal: request.signal,
        })) {
          if (event.type === 'text_delta') {
            fullText += event.text ?? ''
          }
          if (event.type === 'usage') {
            tokenUsage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens }
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }

        await db.insert(messages).values({
          conversationId,
          role: 'assistant',
          content: fullText,
          provider,
          model: modelRef,
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
        })

        await db.update(conversations).set({ defaultProvider: provider, defaultModel: modelRef, updatedAt: new Date() }).where(eq(conversations.id, conversationId))
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream error'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`))
      } finally {
        controller.close()
      }
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

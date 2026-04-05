import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations, messages } from '$lib/server/db/schema'
import type { CodeExecutionBlock, ToolCallInfo } from '$lib/types'
import type { PageServerLoad } from './$types'
import { error } from '@sveltejs/kit'
import { and, asc, eq } from 'drizzle-orm'

interface RawEntry {
  type?: string
  [key: string]: unknown
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, params.conversationId), eq(conversations.userId, userId)))

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  const msgs = await db.select().from(messages).where(eq(messages.conversationId, params.conversationId)).orderBy(asc(messages.createdAt))

  return {
    conversation: {
      ...conversation,
      systemPromptId: conversation.systemPromptId,
      defaultModel: normalizeModelRef(conversation.defaultProvider, conversation.defaultModel),
    },
    messages: msgs.map(m => {
      const raw: RawEntry[] = m.toolCalls ? JSON.parse(m.toolCalls) : []
      const toolCalls = raw.filter(e => e.type !== 'code_execution') as unknown as ToolCallInfo[]
      const codeExecutions = raw.filter(e => e.type === 'code_execution') as unknown as CodeExecutionBlock[]
      return {
        ...m,
        model: normalizeModelRef(m.provider, m.model),
        images: m.images ? JSON.parse(m.images) : undefined,
        files: m.files ? JSON.parse(m.files) : undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        codeExecutions: codeExecutions.length ? codeExecutions : undefined,
      }
    }),
  }
}

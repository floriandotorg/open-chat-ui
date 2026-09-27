import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { createConversation } from '$lib/server/conversations'
import { type Conversation, mapConversation, toConversationSummary } from '$lib/server/db/records'
import { pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'

const toConversation = (row: Conversation) => ({
  id: row.id,
  userId: row.userId,
  title: row.title,
  systemPrompt: row.systemPrompt,
  systemPromptId: row.systemPromptId,
  defaultModel: normalizeModelRef(row.defaultProvider, row.defaultModel),
  favorite: row.favorite,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  const rows = await pb.collection('conversations').getFullList({ filter: pb.filter('user = {:u}', { u: userId }), sort: '-updatedAt' })

  return json(rows.map(row => toConversation(mapConversation(row))))
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()
  const created = await createConversation(userId, { title: body.title, systemPromptId: body.systemPromptId ?? null, fallbackSystemPrompt: body.systemPrompt })
  return json(toConversationSummary(created), { status: 201 })
}

import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { type Conversation, mapConversation, now } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

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

export const GET: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id
  const conversation = await getFirstOrNull(
    pb
      .collection('conversations')
      .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: params.id, u: userId }))
      .then(mapConversation),
  )

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  return json(toConversation(conversation))
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()

  const conversation = await getFirstOrNull(
    pb
      .collection('conversations')
      .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: params.id, u: userId }))
      .then(mapConversation),
  )
  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  if (body.systemPromptId) {
    const prompt = await getFirstOrNull(pb.collection('system_prompts').getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: body.systemPromptId, u: userId }), { fields: 'id' }))
    if (!prompt) {
      throw error(404, 'System prompt not found')
    }
  }

  const shouldUpdateTimestamp = body.title !== undefined || body.systemPrompt !== undefined || body.systemPromptId !== undefined || body.defaultModel !== undefined

  const updated = await pb.collection('conversations').update(params.id, {
    ...(body.title !== undefined && { title: body.title }),
    ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
    ...(body.systemPromptId !== undefined && { systemPromptRef: body.systemPromptId }),
    ...(body.defaultModel !== undefined && { defaultModel: body.defaultModel }),
    ...(body.favorite !== undefined && { favorite: body.favorite }),
    ...(shouldUpdateTimestamp && { updatedAt: now() }),
  })

  return json(toConversation(mapConversation(updated)))
}

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const conversation = await getFirstOrNull(pb.collection('conversations').getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: params.id, u: userId }), { fields: 'id' }))

  if (!conversation) {
    throw error(404, 'Conversation not found')
  }

  await pb.collection('conversations').delete(params.id)

  return new Response(null, { status: 204 })
}

import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { type Conversation, mapConversation, mapSystemPrompt, now } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
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

  let systemPromptId: string | null = body.systemPromptId ?? null
  let systemPromptContent: string | null = null

  if (systemPromptId) {
    const sp = await getFirstOrNull(
      pb
        .collection('system_prompts')
        .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: systemPromptId, u: userId }))
        .then(mapSystemPrompt),
    )
    if (sp) {
      systemPromptContent = sp.content
    } else {
      systemPromptId = null
    }
  }

  if (!systemPromptId) {
    const defaultPrompt = await getFirstOrNull(
      pb
        .collection('system_prompts')
        .getFirstListItem(pb.filter('user = {:u} && isDefault = true', { u: userId }))
        .then(mapSystemPrompt),
    )
    systemPromptId = defaultPrompt?.id ?? null
    systemPromptContent = defaultPrompt?.content ?? body.systemPrompt ?? null
  }

  const created = await pb.collection('conversations').create({
    user: userId,
    title: body.title ?? 'New Chat',
    systemPrompt: systemPromptContent,
    systemPromptRef: systemPromptId,
    createdAt: now(),
    updatedAt: now(),
  })

  return json(toConversation(mapConversation(created)), { status: 201 })
}

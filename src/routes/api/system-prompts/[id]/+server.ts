import { requireUser } from '$lib/server/auth-guard'
import { mapSystemPrompt, now } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()

  const prompt = await getFirstOrNull(
    pb
      .collection('system_prompts')
      .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: params.id, u: userId }))
      .then(mapSystemPrompt),
  )

  if (!prompt) {
    throw error(404, 'System prompt not found')
  }

  if (body.isDefault) {
    const defaults = await pb.collection('system_prompts').getFullList({ filter: pb.filter('user = {:u} && isDefault = true', { u: userId }), fields: 'id' })
    await Promise.all(defaults.map(row => pb.collection('system_prompts').update(row.id, { isDefault: false, updatedAt: now() })))
  }

  const updated = await pb.collection('system_prompts').update(params.id, {
    ...(body.title !== undefined && { title: body.title }),
    ...(body.content !== undefined && { content: body.content }),
    ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
    updatedAt: now(),
  })

  return json(mapSystemPrompt(updated))
}

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const userId = requireUser(locals.user).id

  const prompt = await getFirstOrNull(
    pb
      .collection('system_prompts')
      .getFirstListItem(pb.filter('id = {:id} && user = {:u}', { id: params.id, u: userId }))
      .then(mapSystemPrompt),
  )

  if (!prompt) {
    throw error(404, 'System prompt not found')
  }

  if (prompt.isDefault) {
    throw error(400, 'Cannot delete the default system prompt')
  }

  const refs = await pb.collection('conversations').getFullList({ filter: pb.filter('systemPromptRef = {:id}', { id: params.id }), fields: 'id' })
  await Promise.all(refs.map(row => pb.collection('conversations').update(row.id, { systemPromptRef: null })))
  await pb.collection('system_prompts').delete(params.id)

  return new Response(null, { status: 204 })
}

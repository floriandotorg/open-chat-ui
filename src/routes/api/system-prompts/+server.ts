import { requireUser } from '$lib/server/auth-guard'
import { mapSystemPrompt, now } from '$lib/server/db/records'
import { pb } from '$lib/server/pb'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  const rows = await pb.collection('system_prompts').getFullList({ filter: pb.filter('user = {:u}', { u: userId }), sort: 'createdAt' })
  return json(rows.map(mapSystemPrompt))
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()

  const existing = await pb.collection('system_prompts').getFullList({ filter: pb.filter('user = {:u}', { u: userId }), fields: 'id' })

  const isFirst = existing.length === 0

  const created = await pb.collection('system_prompts').create({
    user: userId,
    title: body.title ?? 'Default',
    content: body.content ?? '',
    isDefault: isFirst,
    createdAt: now(),
    updatedAt: now(),
  })

  return json(mapSystemPrompt(created), { status: 201 })
}

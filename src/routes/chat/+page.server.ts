import { requireUser } from '$lib/server/auth-guard'
import { mapSystemPrompt, now } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ url, locals }) => {
  const q = url.searchParams.get('q')?.trim()
  if (!q) return {}

  const userId = requireUser(locals.user).id

  const defaultPrompt = await getFirstOrNull(
    pb
      .collection('system_prompts')
      .getFirstListItem(pb.filter('user = {:u} && isDefault = true', { u: userId }))
      .then(mapSystemPrompt),
  )

  const created = await pb.collection('conversations').create({
    user: userId,
    title: 'New Chat',
    systemPrompt: defaultPrompt?.content ?? null,
    systemPromptRef: defaultPrompt?.id ?? null,
    createdAt: now(),
    updatedAt: now(),
  })

  throw redirect(303, `/chat/${created.id}?q=${encodeURIComponent(q)}`)
}

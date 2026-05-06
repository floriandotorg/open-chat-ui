import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { conversations, systemPrompts } from '$lib/server/db/schema'
import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { and, eq } from 'drizzle-orm'

export const load: PageServerLoad = async ({ url, locals }) => {
  const q = url.searchParams.get('q')?.trim()
  if (!q) return {}

  const userId = requireUser(locals.user).id

  const [defaultPrompt] = await db
    .select()
    .from(systemPrompts)
    .where(and(eq(systemPrompts.userId, userId), eq(systemPrompts.isDefault, true)))

  const [conversation] = await db
    .insert(conversations)
    .values({
      userId,
      title: 'New Chat',
      systemPrompt: defaultPrompt?.content ?? null,
      systemPromptId: defaultPrompt?.id ?? null,
    })
    .returning({ id: conversations.id })

  throw redirect(303, `/chat/${conversation.id}?q=${encodeURIComponent(q)}`)
}

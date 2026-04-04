import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { userSettings } from '$lib/server/db/schema'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))

  return json(
    settings ?? {
      defaultSystemPrompt: null,
      defaultProvider: null,
      defaultModel: null,
    },
  )
}

export const PUT: RequestHandler = async ({ request, locals }) => {
  const userId = requireUser(locals.user).id
  const body = await request.json()

  const [existing] = await db.select({ id: userSettings.id }).from(userSettings).where(eq(userSettings.userId, userId))

  if (existing) {
    const [updated] = await db
      .update(userSettings)
      .set({
        ...(body.defaultSystemPrompt !== undefined && { defaultSystemPrompt: body.defaultSystemPrompt }),
        ...(body.defaultProvider !== undefined && { defaultProvider: body.defaultProvider }),
        ...(body.defaultModel !== undefined && { defaultModel: body.defaultModel }),
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId))
      .returning()
    return json(updated)
  }

  const [created] = await db
    .insert(userSettings)
    .values({
      userId,
      defaultSystemPrompt: body.defaultSystemPrompt ?? null,
      defaultProvider: body.defaultProvider ?? null,
      defaultModel: body.defaultModel ?? null,
    })
    .returning()

  return json(created)
}

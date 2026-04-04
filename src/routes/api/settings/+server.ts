import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { userSettings } from '$lib/server/db/schema'
import { normalizeModelRef } from '$lib/model-ref'
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'

const toSettings = (row: typeof userSettings.$inferSelect) => ({
  defaultSystemPrompt: row.defaultSystemPrompt,
  defaultModel: normalizeModelRef(row.defaultProvider, row.defaultModel),
})

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))

  return json(
    settings
      ? toSettings(settings)
      : {
          defaultSystemPrompt: null,
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
        ...(body.defaultModel !== undefined && { defaultModel: body.defaultModel }),
        updatedAt: new Date(),
      })
      .where(eq(userSettings.userId, userId))
      .returning()
    return json(toSettings(updated))
  }

  const [created] = await db
    .insert(userSettings)
    .values({
      userId,
      defaultSystemPrompt: body.defaultSystemPrompt ?? null,
      defaultModel: body.defaultModel ?? null,
    })
    .returning()

  return json(toSettings(created))
}

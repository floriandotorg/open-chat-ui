import { db } from '$lib/server/db'
import { conversations } from '$lib/server/db/schema'
import { and, eq } from 'drizzle-orm'

export const reapStaleGenerations = async () => {
  const stale = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.generating, true))
  if (stale.length === 0) return
  await db.update(conversations).set({ generating: false }).where(eq(conversations.generating, true))
  console.info(`[reaper] cleared ${stale.length} stale generating flag${stale.length === 1 ? '' : 's'} on startup`)
}

export const clearGeneratingFlag = async (conversationId: string) => {
  await db
    .update(conversations)
    .set({ generating: false })
    .where(and(eq(conversations.id, conversationId), eq(conversations.generating, true)))
}

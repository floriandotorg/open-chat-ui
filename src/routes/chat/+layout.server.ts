import { normalizeModelRef } from '$lib/model-ref'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { apiKeys, conversations, systemPrompts } from '$lib/server/db/schema'
import { listProviders } from '$lib/server/providers'
import type { LayoutServerLoad } from './$types'
import { asc, desc, eq } from 'drizzle-orm'

const VALID_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'max'])

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  const userId = requireUser(locals.user).id

  const rawWidth = Number(cookies.get('sidebar-width'))
  const sidebarWidth = rawWidth >= 200 && rawWidth <= 500 ? rawWidth : undefined
  const rawEffort = cookies.get('thinking-effort')
  const thinkingEffort = rawEffort && VALID_EFFORTS.has(rawEffort) ? rawEffort : undefined
  const selectedModel = cookies.get('selected-model') ?? undefined
  const selectedModelName = cookies.get('selected-model-name') ?? undefined
  const rawTtsSpeed = Number(cookies.get('tts-speed'))
  const ttsSpeed = [1, 1.25, 1.5, 1.75, 2].includes(rawTtsSpeed) ? rawTtsSpeed : undefined

  const [convos, userKeys, prompts] = await Promise.all([
    db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt)),
    db.select({ provider: apiKeys.provider }).from(apiKeys).where(eq(apiKeys.userId, userId)),
    db.select().from(systemPrompts).where(eq(systemPrompts.userId, userId)).orderBy(asc(systemPrompts.createdAt)),
  ])

  const configuredProviders = new Set(userKeys.map(k => k.provider))
  const providers = listProviders().map(p => ({
    ...p,
    hasKey: configuredProviders.has(p.id),
  }))

  return {
    conversations: convos.map(c => ({
      ...c,
      defaultModel: normalizeModelRef(c.defaultProvider, c.defaultModel),
    })),
    providers,
    systemPrompts: prompts,
    sidebarWidth,
    thinkingEffort,
    selectedModel,
    selectedModelName,
    ttsSpeed,
  }
}

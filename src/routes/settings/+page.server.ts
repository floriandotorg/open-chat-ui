import { auth } from '$lib/server/auth'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { apiKeys, systemPrompts, userSettings } from '$lib/server/db/schema'
import { listProviders } from '$lib/server/providers'
import type { Actions, PageServerLoad } from './$types'
import { fail } from '@sveltejs/kit'
import { asc, eq } from 'drizzle-orm'

type ToolService = { id: string; name: string; capabilities: string[] }

const TOOL_SERVICES: ToolService[] = [
  { id: 'kagi', name: 'Kagi Search', capabilities: [] },
  { id: 'jina', name: 'Jina Reader', capabilities: [] },
  { id: 'decodo', name: 'Decodo (Web Scraping API — username:password)', capabilities: [] },
  { id: 'openalex', name: 'OpenAlex (email for polite pool, optional)', capabilities: [] },
  { id: 'elevenlabs', name: 'ElevenLabs TTS (API Key)', capabilities: [] },
  { id: 'elevenlabs-voice-id', name: 'ElevenLabs TTS (Voice ID)', capabilities: [] },
]

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals.user)

  const [settings, userKeys, prompts] = await Promise.all([
    db.select().from(userSettings).where(eq(userSettings.userId, user.id)),
    db.select({ id: apiKeys.id, provider: apiKeys.provider, createdAt: apiKeys.createdAt }).from(apiKeys).where(eq(apiKeys.userId, user.id)).orderBy(asc(apiKeys.createdAt)),
    db.select().from(systemPrompts).where(eq(systemPrompts.userId, user.id)).orderBy(asc(systemPrompts.createdAt)),
  ])

  const keyCounts = new Map<string, number>()
  for (const key of userKeys) {
    keyCounts.set(key.provider, (keyCounts.get(key.provider) ?? 0) + 1)
  }

  const providers = listProviders().map(p => ({
    ...p,
    hasKey: (keyCounts.get(p.id) ?? 0) > 0,
    keyCount: keyCounts.get(p.id) ?? 0,
  }))

  const toolServices = TOOL_SERVICES.map(s => ({
    ...s,
    hasKey: (keyCounts.get(s.id) ?? 0) > 0,
    keyCount: keyCounts.get(s.id) ?? 0,
  }))

  return {
    settings: settings[0] ?? null,
    providers,
    toolServices,
    systemPrompts: prompts,
    user,
  }
}

export const actions: Actions = {
  signOut: async event => {
    await auth.api.signOut({ headers: event.request.headers })
    return { success: true }
  },
  updatePassword: async event => {
    const formData = await event.request.formData()
    const currentPassword = formData.get('currentPassword')?.toString() ?? ''
    const newPassword = formData.get('newPassword')?.toString() ?? ''

    if (newPassword.length < 8) {
      return fail(400, { passwordError: 'Password must be at least 8 characters' })
    }

    try {
      await auth.api.changePassword({
        body: { currentPassword, newPassword },
        headers: event.request.headers,
      })
      return { passwordSuccess: true }
    } catch {
      return fail(400, { passwordError: 'Failed to update password. Check your current password.' })
    }
  },
}

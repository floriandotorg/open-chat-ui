import { auth } from '$lib/server/auth'
import { requireUser } from '$lib/server/auth-guard'
import { db } from '$lib/server/db'
import { apiKeys, systemPrompts, userSettings } from '$lib/server/db/schema'
import { listProviders } from '$lib/server/providers'
import type { Actions, PageServerLoad } from './$types'
import { fail } from '@sveltejs/kit'
import { asc, eq } from 'drizzle-orm'

const TOOL_SERVICES = [
  { id: 'kagi', name: 'Kagi Search', capabilities: [] as string[] },
  { id: 'jina', name: 'Jina Reader', capabilities: [] as string[] },
  { id: 'scraperapi', name: 'ScraperAPI', capabilities: [] as string[] },
  { id: 'elevenlabs', name: 'ElevenLabs TTS (API Key)', capabilities: [] as string[] },
  { id: 'elevenlabs-voice-id', name: 'ElevenLabs TTS (Voice ID)', capabilities: [] as string[] },
]

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals.user)

  const [settings, userKeys, prompts] = await Promise.all([
    db.select().from(userSettings).where(eq(userSettings.userId, user.id)),
    db.select({ provider: apiKeys.provider }).from(apiKeys).where(eq(apiKeys.userId, user.id)),
    db.select().from(systemPrompts).where(eq(systemPrompts.userId, user.id)).orderBy(asc(systemPrompts.createdAt)),
  ])

  const configuredProviders = new Set(userKeys.map(k => k.provider))
  const providers = listProviders().map(p => ({
    ...p,
    hasKey: configuredProviders.has(p.id),
  }))

  const toolServices = TOOL_SERVICES.map(s => ({
    ...s,
    hasKey: configuredProviders.has(s.id),
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

import { requireUser } from '$lib/server/auth-guard'
import { mapSystemPrompt, mapUserSettings } from '$lib/server/db/records'
import { getFirstOrNull, pb } from '$lib/server/pb'
import { listProviders } from '$lib/server/providers'
import type { Actions, PageServerLoad } from './$types'
import { fail } from '@sveltejs/kit'

type ToolService = { id: string; name: string; capabilities: string[] }

const TOOL_SERVICES: ToolService[] = [
  { id: 'brave', name: 'Brave Search', capabilities: [] },
  { id: 'exa', name: 'Exa (Semantic Search)', capabilities: [] },
  { id: 'decodo', name: 'Decodo (Web Scraping API — username:password)', capabilities: [] },
  { id: 'jina', name: 'Jina Reader (API Key, optional)', capabilities: [] },
  { id: 'openalex', name: 'OpenAlex (API key or email, optional)', capabilities: [] },
  { id: 'elevenlabs', name: 'ElevenLabs TTS (API Key)', capabilities: [] },
  { id: 'elevenlabs-voice-id', name: 'ElevenLabs TTS (Voice ID)', capabilities: [] },
]

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals.user)

  const [settingsRow, userKeys, prompts] = await Promise.all([
    getFirstOrNull(
      pb
        .collection('user_settings')
        .getFirstListItem(pb.filter('user = {:u}', { u: user.id }))
        .then(mapUserSettings),
    ),
    pb.collection('api_keys').getFullList({ filter: pb.filter('user = {:u}', { u: user.id }), sort: 'createdAt', fields: 'id,provider,createdAt' }),
    pb
      .collection('system_prompts')
      .getFullList({ filter: pb.filter('user = {:u}', { u: user.id }), sort: 'createdAt' })
      .then(rows => rows.map(mapSystemPrompt)),
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
    settings: settingsRow,
    providers,
    toolServices,
    systemPrompts: prompts,
    user,
  }
}

export const actions: Actions = {
  signOut: async event => {
    event.locals.pb.authStore.clear()
    return { success: true }
  },
  updatePassword: async event => {
    const user = requireUser(event.locals.user)
    const formData = await event.request.formData()
    const currentPassword = formData.get('currentPassword')?.toString() ?? ''
    const newPassword = formData.get('newPassword')?.toString() ?? ''

    if (newPassword.length < 8) {
      return fail(400, { passwordError: 'Password must be at least 8 characters' })
    }

    try {
      await event.locals.pb.collection('users').update(user.id, {
        oldPassword: currentPassword,
        password: newPassword,
        passwordConfirm: newPassword,
      })
      await event.locals.pb.collection('users').authWithPassword(user.email, newPassword)
      return { passwordSuccess: true }
    } catch {
      return fail(400, { passwordError: 'Failed to update password. Check your current password.' })
    }
  },
}

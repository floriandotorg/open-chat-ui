import { byProviderThenName } from '$lib/model-ref'
import { storedModelInfo } from '$lib/provider-models'
import { requireUser } from '$lib/server/auth-guard'
import { mapProviderModel, mapSystemPrompt, toChatBootstrap } from '$lib/server/db/records'
import { pb } from '$lib/server/pb'
import { listProviders } from '$lib/server/providers'
import type { LayoutServerLoad } from './$types'

const VALID_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'max'])

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  const userId = requireUser(locals.user).id

  const rawWidth = Number(cookies.get('sidebar-width'))
  const sidebarWidth = rawWidth >= 200 && rawWidth <= 500 ? rawWidth : undefined
  const rawEffort = cookies.get('thinking-effort')
  const thinkingEffort = rawEffort && VALID_EFFORTS.has(rawEffort) ? rawEffort : undefined
  const selectedModel = cookies.get('selected-model') ?? undefined
  const rawTtsSpeed = Number(cookies.get('tts-speed'))
  const ttsSpeed = [1, 1.25, 1.5, 1.75, 2].includes(rawTtsSpeed) ? rawTtsSpeed : undefined

  const [convoRows, userKeys, prompts, modelRows] = await Promise.all([
    pb.collection('conversations').getFullList({ filter: pb.filter('user = {:u}', { u: userId }), sort: '-updatedAt' }),
    pb.collection('api_keys').getFullList({ filter: pb.filter('user = {:u}', { u: userId }), fields: 'provider' }),
    pb
      .collection('system_prompts')
      .getFullList({ filter: pb.filter('user = {:u}', { u: userId }), sort: 'createdAt' })
      .then(rows => rows.map(mapSystemPrompt)),
    pb.collection('provider_models').getFullList({ filter: 'enabled = true', fields: 'id,provider,modelId,enabled,metadata' }),
  ])

  const configuredProviders = new Set(userKeys.map(k => k.provider))
  const providers = listProviders().map(p => ({
    ...p,
    hasKey: configuredProviders.has(p.id),
  }))

  const models = modelRows
    .map(mapProviderModel)
    .filter(s => configuredProviders.has(s.provider))
    .map(storedModelInfo)
    .sort(byProviderThenName)

  return {
    ...toChatBootstrap(convoRows),
    providers,
    systemPrompts: prompts,
    models,
    sidebarWidth,
    thinkingEffort,
    selectedModel,
    ttsSpeed,
  }
}

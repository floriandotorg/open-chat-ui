import type { ProviderModel } from '$lib/db-mappers'
import { mapProviderModel } from '$lib/db-mappers'
import { byProviderThenName, formatModelRef, parseModelRef } from '$lib/model-ref'
import { pbClient } from '$lib/pb-client'
import { storedModelInfo } from '$lib/provider-models'
import type { ModelInfo, ProviderInfo } from '$lib/types'
import { browser } from '$app/environment'

const toModelInfo = (s: ProviderModel): ModelInfo => ({ ...storedModelInfo(s), id: formatModelRef(s.provider, s.modelId) })

export const createModelsStore = (initial: ModelInfo[], providers: ProviderInfo[]) => {
  let byId = $state<Map<string, ModelInfo>>(new Map(initial.map(m => [m.id, m])))
  let configured = $state(new Set(providers.filter(p => p.hasKey).map(p => p.id)))

  const models = $derived([...byId.values()].filter(m => configured.has(parseModelRef(m.id).provider)).sort(byProviderThenName))

  const upsert = (m: ModelInfo) => {
    const next = new Map(byId)
    next.set(m.id, m)
    byId = next
  }

  const remove = (id: string) => {
    const next = new Map(byId)
    next.delete(id)
    byId = next
  }

  const apply = (s: ProviderModel) => {
    const info = toModelInfo(s)
    if (s.enabled) upsert(info)
    else remove(info.id)
  }

  const seed = (list: ModelInfo[]) => {
    byId = new Map(list.map(m => [m.id, m]))
  }

  const setProviders = (list: ProviderInfo[]) => {
    configured = new Set(list.filter(p => p.hasKey).map(p => p.id))
  }

  let unsub: (() => void) | null = null
  let cancelled = false
  let generation = 0

  const subscribe = async () => {
    if (!browser || unsub) return
    cancelled = false
    const gen = ++generation
    try {
      const u = await pbClient.collection('provider_models').subscribe(
        '*',
        e => {
          if (e.action === 'delete') {
            remove(formatModelRef(e.record.provider, e.record.modelId))
          } else {
            apply(mapProviderModel(e.record))
          }
        },
        { fields: 'id,provider,modelId,enabled,metadata' },
      )
      if (cancelled || gen !== generation) {
        u()
        return
      }
      unsub = u
    } catch (err) {
      console.warn('[realtime] models subscribe failed', err)
    }
  }

  const unsubscribe = () => {
    cancelled = true
    ++generation
    unsub?.()
    unsub = null
  }

  const resync = async () => {
    if (!browser || cancelled) return
    const rows = await pbClient.collection('provider_models').getFullList({ filter: 'enabled = true', fields: 'id,provider,modelId,enabled,metadata' })
    if (!cancelled) {
      byId = new Map(rows.map(r => toModelInfo(mapProviderModel(r))).map(m => [m.id, m]))
    }
  }

  return {
    get models() {
      return models
    },
    apply,
    seed,
    setProviders,
    subscribe,
    unsubscribe,
    resync,
    isSubscribed: () => cancelled || !!unsub,
  }
}

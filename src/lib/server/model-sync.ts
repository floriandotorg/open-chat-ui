import { parseModelRef } from '$lib/model-ref'
import { decrypt } from '$lib/server/crypto'
import { mapApiKey, mapProviderModel, now } from '$lib/server/db/records'
import { createOrRecover, getFirstOrNull, pb } from '$lib/server/pb'
import { getProviderFactory, listProviders } from '$lib/server/providers'

export const STALE_AFTER_MS = 6 * 60 * 60 * 1000

const inflight = new Map<string, Promise<void>>()
const lastSyncAt = new Map<string, number>()

const anyDecryptedKey = async (provider: string): Promise<string | null> => {
  const row = await getFirstOrNull(
    pb
      .collection('api_keys')
      .getFirstListItem(pb.filter('provider = {:p}', { p: provider }), { fields: 'user,encryptedKey,iv' })
      .then(mapApiKey),
  )
  if (!row) return null
  return (await decrypt(row.encryptedKey, row.iv)).trim() || null
}

const runProviderSync = async (provider: string): Promise<void> => {
  const apiKey = await anyDecryptedKey(provider)
  if (!apiKey) return

  const llm = getProviderFactory(provider)(apiKey)
  if (llm.supportsCustomModels) return

  const listed = await llm.listModels()

  const existing = new Map((await pb.collection('provider_models').getFullList({ filter: pb.filter('provider = {:p}', { p: provider }) })).map(r => [r.modelId as string, mapProviderModel(r)]))

  for (const metadata of listed) {
    const modelId = parseModelRef(metadata.id).model
    const row = existing.get(modelId)
    if (!row) {
      await createOrRecover('provider_models', { provider, modelId, enabled: true, metadata, createdAt: now(), updatedAt: now() }, pb.filter('provider = {:p} && modelId = {:m}', { p: provider, m: modelId }), { metadata, updatedAt: now() })
    } else if (JSON.stringify(row.metadata) !== JSON.stringify(metadata)) {
      await pb.collection('provider_models').update(row.id, { metadata, updatedAt: now() })
    }
  }

  lastSyncAt.set(provider, Date.now())
}

export const syncProviderModels = (provider: string): Promise<void> => {
  const running = inflight.get(provider)
  if (running) return running
  const promise = runProviderSync(provider).finally(() => {
    inflight.delete(provider)
  })
  inflight.set(provider, promise)
  return promise
}

export const ensureProviderSynced = async (provider: string): Promise<void> => {
  const last = lastSyncAt.get(provider)
  if (last !== undefined && Date.now() - last < STALE_AFTER_MS) return
  try {
    await syncProviderModels(provider)
  } catch (err) {
    console.error(`[model-sync] ${provider} failed:`, err)
  }
}

export const syncAllProviders = async (): Promise<void> => {
  const keyed = new Set((await pb.collection('api_keys').getFullList({ fields: 'provider' })).map(r => r.provider as string))
  if (keyed.size === 0) return

  const results = await Promise.allSettled(
    listProviders()
      .filter(p => keyed.has(p.id) && !p.supportsCustomModels)
      .map(p => syncProviderModels(p.id)),
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[model-sync] provider sync failed:', result.reason)
    }
  }
}

import type { ModelInfo } from '$lib/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiKeyRow: null as Record<string, unknown> | null,
  providerRows: [] as Record<string, unknown>[],
  creates: [] as { collection: string; data: Record<string, unknown> }[],
  updates: [] as { id: string; data: Record<string, unknown> }[],
  deletes: [] as string[],
  listModels: vi.fn(),
  supportsCustomModels: false,
}))

vi.mock('$lib/server/pb', () => ({
  pb: {
    filter: (expr: string, params?: Record<string, unknown>) => JSON.stringify({ expr, params: params ?? {} }),
    collection: (name: string) => ({
      getFirstListItem: async () => {
        if (name !== 'api_keys') throw new Error(`unexpected getFirstListItem on ${name}`)
        if (!mocks.apiKeyRow) throw new Error('not found')
        return mocks.apiKeyRow
      },
      getFullList: async () => [...mocks.providerRows],
      update: async (id: string, data: Record<string, unknown>) => {
        mocks.updates.push({ id, data })
        return {}
      },
      delete: async (id: string) => {
        mocks.deletes.push(id)
      },
    }),
  },
  getFirstOrNull: async (p: Promise<unknown>) => {
    try {
      return await p
    } catch {
      return null
    }
  },
  createOrRecover: async (collection: string, data: Record<string, unknown>) => {
    mocks.creates.push({ collection, data })
    return {}
  },
}))

vi.mock('$lib/server/crypto', () => ({ decrypt: async () => 'sk-test' }))

vi.mock('$lib/server/providers', () => ({
  getProviderFactory: () => () => ({
    id: 'test',
    name: 'Test',
    capabilities: [],
    supportsCustomModels: mocks.supportsCustomModels,
    listModels: mocks.listModels,
  }),
  listProviders: () => [],
}))

const info = (id: string, name: string): ModelInfo => ({
  id,
  name,
  contextWindow: 128000,
  maxOutputTokens: 16384,
  capabilities: ['streaming'],
})

const row = (provider: string, modelId: string, metadata: ModelInfo | null, enabled = true): Record<string, unknown> => ({
  id: `row-${provider}-${modelId}`,
  provider,
  modelId,
  enabled,
  metadata,
  createdAt: '2024-01-01 00:00:00.000',
  updatedAt: '2024-01-01 00:00:00.000',
})

beforeEach(() => {
  mocks.apiKeyRow = { id: 'k1', user: 'u1', provider: 'openai', encryptedKey: 'enc', iv: 'iv', createdAt: '2024-01-01 00:00:00.000', updatedAt: '2024-01-01 00:00:00.000' }
  mocks.providerRows = []
  mocks.creates = []
  mocks.updates = []
  mocks.deletes = []
  mocks.listModels = vi.fn()
  mocks.supportsCustomModels = false
})

describe('syncProviderModels', () => {
  it('creates rows with metadata for new models', async () => {
    const { syncProviderModels } = await import('./model-sync')
    mocks.listModels.mockResolvedValue([info('openai/gpt-4o', 'GPT-4o')])

    await syncProviderModels('openai')

    expect(mocks.creates).toHaveLength(1)
    expect(mocks.creates[0].collection).toBe('provider_models')
    expect(mocks.creates[0].data.provider).toBe('openai')
    expect(mocks.creates[0].data.modelId).toBe('gpt-4o')
    expect(mocks.creates[0].data.enabled).toBe(true)
    expect(mocks.creates[0].data.metadata).toEqual(info('openai/gpt-4o', 'GPT-4o'))
    expect(mocks.updates).toEqual([])
  })

  it('does not update unchanged models', async () => {
    const { syncProviderModels } = await import('./model-sync')
    mocks.providerRows = [row('openai', 'gpt-4o', info('openai/gpt-4o', 'GPT-4o'))]
    mocks.listModels.mockResolvedValue([info('openai/gpt-4o', 'GPT-4o')])

    await syncProviderModels('openai')

    expect(mocks.creates).toEqual([])
    expect(mocks.updates).toEqual([])
  })

  it('updates only metadata and updatedAt for changed models', async () => {
    const { syncProviderModels } = await import('./model-sync')
    mocks.providerRows = [row('openai', 'gpt-4o', info('openai/gpt-4o', 'GPT-4o'))]
    mocks.listModels.mockResolvedValue([info('openai/gpt-4o', 'GPT-4o mini')])

    await syncProviderModels('openai')

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].id).toBe('row-openai-gpt-4o')
    expect(Object.keys(mocks.updates[0].data).sort()).toEqual(['metadata', 'updatedAt'])
    expect(mocks.updates[0].data.metadata).toEqual(info('openai/gpt-4o', 'GPT-4o mini'))
    expect(mocks.creates).toEqual([])
  })

  it('never deletes models that disappeared from the provider', async () => {
    const { syncProviderModels } = await import('./model-sync')
    mocks.providerRows = [row('openai', 'gpt-4o', info('openai/gpt-4o', 'GPT-4o')), row('openai', 'legacy', info('openai/legacy', 'Legacy'))]
    mocks.listModels.mockResolvedValue([info('openai/gpt-4o', 'GPT-4o')])

    await syncProviderModels('openai')

    expect(mocks.deletes).toEqual([])
    expect(mocks.updates).toEqual([])
    expect(mocks.creates).toEqual([])
  })

  it('shares one provider request between concurrent callers', async () => {
    const { syncProviderModels } = await import('./model-sync')
    mocks.listModels.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([info('openai/gpt-4o', 'GPT-4o')]), 20)))

    const first = syncProviderModels('openai')
    const second = syncProviderModels('openai')
    await Promise.all([first, second])
    expect(second).toBe(first)
    expect(mocks.listModels).toHaveBeenCalledTimes(1)
  })

  it('skips providers with user managed models', async () => {
    const { syncProviderModels } = await import('./model-sync')
    mocks.supportsCustomModels = true

    await syncProviderModels('openai')

    expect(mocks.listModels).not.toHaveBeenCalled()
    expect(mocks.creates).toEqual([])
  })

  it('returns silently without a key', async () => {
    const { syncProviderModels } = await import('./model-sync')
    mocks.apiKeyRow = null

    await syncProviderModels('openai')

    expect(mocks.listModels).not.toHaveBeenCalled()
    expect(mocks.creates).toEqual([])
  })
})

describe('ensureProviderSynced', () => {
  it('reuses a fresh sync and retries a stale one', async () => {
    const { ensureProviderSynced, syncProviderModels } = await import('./model-sync')
    mocks.listModels.mockResolvedValue([info('mistral/large', 'Mistral Large')])

    await syncProviderModels('mistral')
    expect(mocks.listModels).toHaveBeenCalledTimes(1)

    await ensureProviderSynced('mistral')
    expect(mocks.listModels).toHaveBeenCalledTimes(1)

    const { STALE_AFTER_MS } = await import('./model-sync')
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + STALE_AFTER_MS + 1)
    await ensureProviderSynced('mistral')
    vi.useRealTimers()
    expect(mocks.listModels).toHaveBeenCalledTimes(2)
  })
})

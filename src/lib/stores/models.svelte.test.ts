import type { ProviderModel } from '$lib/db-mappers'
import type { ModelInfo, ProviderInfo } from '$lib/types'
import { createModelsStore } from './models.svelte'
import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/pb-client', () => ({ pbClient: {} }))

const info = (id: string, name: string): ModelInfo => ({ id, name, contextWindow: 0, maxOutputTokens: 0, capabilities: ['streaming'] })

const provider = (id: string, hasKey: boolean): ProviderInfo => ({ id, name: id, hasKey })

const row = (modelId: string, enabled: boolean, metadata: ModelInfo | null): ProviderModel => ({
  id: `row-${modelId}`,
  provider: 'openai',
  modelId,
  enabled,
  metadata,
  createdAt: new Date(),
  updatedAt: new Date(),
})

describe('createModelsStore', () => {
  it('filters models to providers with keys, sorted by provider then name', () => {
    const store = createModelsStore([info('openai/zeta', 'Zeta'), info('anthropic/alpha', 'Alpha'), info('mistral/beta', 'Beta')], [provider('openai', true), provider('anthropic', true), provider('mistral', false)])
    expect(store.models.map(m => m.id)).toEqual(['anthropic/alpha', 'openai/zeta'])
  })

  it('upserts enabled rows and removes disabled ones', () => {
    const store = createModelsStore([info('openai/one', 'One')], [provider('openai', true)])

    store.apply(row('two', true, info('openai/two', 'Two')))
    expect(store.models.map(m => m.id)).toEqual(['openai/one', 'openai/two'])

    store.apply(row('one', false, null))
    expect(store.models.map(m => m.id)).toEqual(['openai/two'])
  })

  it('falls back to a generated ModelInfo when metadata is missing', () => {
    const store = createModelsStore([], [provider('openai', true)])

    store.apply(row('gpt-x', true, null))

    expect(store.models[0].id).toBe('openai/gpt-x')
    expect(store.models[0].name).toBe('gpt-x')
  })

  it('seed replaces models and setProviders refilters', () => {
    const store = createModelsStore([], [provider('openai', false)])

    store.seed([info('openai/one', 'One')])
    expect(store.models).toEqual([])

    store.setProviders([provider('openai', true)])
    expect(store.models.map(m => m.id)).toEqual(['openai/one'])
  })
})

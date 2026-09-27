import { mapConversationSummary } from '$lib/db-mappers'
import { describe, expect, it } from 'vitest'

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'conv1',
  collectionId: 'conversations',
  collectionName: 'conversations',
  title: 'Chat',
  favorite: false,
  generating: false,
  systemPromptRef: '',
  defaultProvider: null,
  defaultModel: null,
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
})

describe('mapConversationSummary', () => {
  it('keeps a stored model reference', () => {
    const summary = mapConversationSummary(row({ defaultModel: 'anthropic/claude-test' }))
    expect(summary.defaultModel).toBe('anthropic/claude-test')
  })

  it('normalizes a bare model id with its provider', () => {
    const summary = mapConversationSummary(row({ defaultProvider: 'anthropic', defaultModel: 'claude-test' }))
    expect(summary.defaultModel).toBe('anthropic/claude-test')
  })

  it('defaults to null when no model is stored', () => {
    expect(mapConversationSummary(row()).defaultModel).toBeNull()
  })
})

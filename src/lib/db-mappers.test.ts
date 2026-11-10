import { mapClientMessage, mapConversationSummary } from '#lib/db-mappers.ts'
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

describe('mapClientMessage', () => {
  const message = (toolCalls: unknown[]) => ({ id: 'm1', collectionId: 'messages', collectionName: 'messages', conversation: 'c1', role: 'assistant', content: '', toolCalls, generating: true, createdAt: '2024-01-01T00:00:00.000Z' })
  const waiting = { sessionId: 's1', step: 3, status: 'waiting_for_user', summary: 'Log in', request: { kind: 'login', message: 'Log in to eBay', url: 'https://www.ebay.de/' } }

  it('keeps tool progress from the folded snapshot', () => {
    const [toolCall] = mapClientMessage(message([{ id: 't1', name: 'browser_task', textOffset: 0, done: false, progress: waiting }])).toolCalls ?? []
    expect(toolCall.progress).toEqual(waiting)
  })

  it('drops malformed tool progress', () => {
    const [toolCall] = mapClientMessage(message([{ id: 't1', name: 'browser_task', textOffset: 0, done: false, progress: { ...waiting, request: { kind: 'hack', message: 'x', url: '' } } }])).toolCalls ?? []
    expect(toolCall.progress).toBeUndefined()
  })
})

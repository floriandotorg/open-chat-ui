import { getUserOpenAIConnection, resolveUserModelRef } from './model-connection'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ getFirstListItem: vi.fn(), filter: vi.fn((_filter: string, params: unknown) => JSON.stringify(params)) }))

vi.mock('#lib/server/pb.ts', () => ({
  pb: { collection: vi.fn(() => ({ getFirstListItem: db.getFirstListItem })), filter: db.filter },
  getFirstOrNull: async (promise: Promise<unknown>) =>
    promise.catch((error: unknown) => {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        return null
      }
      throw error
    }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  db.getFirstListItem.mockResolvedValue({ updatedAt: '' })
})

describe('user model connection', () => {
  it('defaults existing accounts to API and scopes settings to the user', async () => {
    expect(await getUserOpenAIConnection('user-1')).toBe('api')
    expect(db.filter).toHaveBeenCalledWith('user = {:u}', { u: 'user-1' })
    expect(await resolveUserModelRef('user-1', 'chatgpt/gpt-5')).toBe('openai/gpt-5')
  })

  it('uses the subscription for canonical and legacy references', async () => {
    db.getFirstListItem.mockResolvedValue({ openaiConnection: 'subscription', updatedAt: '' })
    expect(await resolveUserModelRef('user-1', 'openai/gpt-5')).toBe('chatgpt/gpt-5')
    expect(await resolveUserModelRef('user-1', 'chatgpt/gpt-5')).toBe('chatgpt/gpt-5')
  })

  it('does not query settings for another provider', async () => {
    expect(await resolveUserModelRef('user-1', 'anthropic/claude')).toBe('anthropic/claude')
    expect(db.getFirstListItem).not.toHaveBeenCalled()
  })

  it('defaults to API when settings do not exist', async () => {
    db.getFirstListItem.mockRejectedValue({ status: 404 })
    expect(await resolveUserModelRef('user-1', 'openai/gpt-5')).toBe('openai/gpt-5')
  })

  it('does not fall back to API when reading settings fails', async () => {
    db.getFirstListItem.mockRejectedValue(new Error('Network failed'))
    await expect(resolveUserModelRef('user-1', 'openai/gpt-5')).rejects.toThrow('Network failed')
  })
})

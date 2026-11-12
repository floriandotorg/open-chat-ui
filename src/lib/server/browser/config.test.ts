import { loadBrowserAgentConfig } from './config'
import { expect, it, vi } from 'vitest'

const getDecryptedKey = vi.hoisted(() => vi.fn())
vi.mock('#lib/server/api-key.ts', () => ({ getDecryptedKey }))
vi.mock('#lib/server/pb.ts', () => ({
  getFirstOrNull: (promise: Promise<unknown>) => promise,
  pb: {
    filter: () => 'user-filter',
    collection: () => ({ getFirstListItem: async () => ({ browserAgentModel: 'openai/gpt-5.4', openaiConnection: 'subscription', updatedAt: '' }) }),
  },
}))

it('does not use a paid OpenAI browser agent when subscription mode is selected', async () => {
  expect(await loadBrowserAgentConfig('user-1')).toEqual({ error: expect.stringContaining('does not support ChatGPT subscriptions') })
  expect(getDecryptedKey).not.toHaveBeenCalled()
})

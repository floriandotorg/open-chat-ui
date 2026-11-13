import { isBrowserAgentModel, loadBrowserAgentConfig } from './config'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getDecryptedKey: vi.fn(), getSettings: vi.fn(), getChatGPTAccessToken: vi.fn() }))
vi.mock('#lib/server/api-key.ts', () => ({ getDecryptedKey: mocks.getDecryptedKey }))
vi.mock('#lib/server/chatgpt/session.ts', () => ({ getChatGPTAccessToken: mocks.getChatGPTAccessToken }))
vi.mock('#lib/server/pb.ts', () => ({
  getFirstOrNull: (promise: Promise<unknown>) => promise,
  pb: {
    filter: () => 'user-filter',
    collection: () => ({ getFirstListItem: mocks.getSettings }),
  },
}))

beforeEach(() => {
  mocks.getChatGPTAccessToken.mockReset().mockResolvedValue('chatgpt-token')
  mocks.getDecryptedKey.mockReset().mockImplementation(async (_userId: string, provider: string) => `${provider}-token`)
  mocks.getSettings.mockReset().mockResolvedValue({ browserAgentModel: 'openai/gpt-5.4', browserHostUrl: 'http://127.0.0.1:9330', openaiConnection: 'subscription', updatedAt: '' })
})

it('uses the ChatGPT connection and pricing reference in subscription mode', async () => {
  expect(await loadBrowserAgentConfig('user-1')).toMatchObject({ provider: 'chatgpt', model: 'gpt-5.4', modelRef: 'chatgpt/gpt-5.4', apiKey: 'chatgpt-token' })
  expect(mocks.getChatGPTAccessToken).toHaveBeenCalledWith('user-1', undefined)
  expect(mocks.getDecryptedKey).not.toHaveBeenCalledWith('user-1', 'openai')
})

it('never falls back to an API key when the subscription is missing', async () => {
  mocks.getChatGPTAccessToken.mockResolvedValue(null)
  expect(await loadBrowserAgentConfig('user-1')).toEqual({ error: expect.stringContaining('Connect your ChatGPT subscription') })
  expect(mocks.getDecryptedKey).not.toHaveBeenCalledWith('user-1', 'openai')
})

it('binds token renewal to the task owner and passes the rejected token', async () => {
  const config = await loadBrowserAgentConfig('user-1')
  if ('error' in config || !config.getAccessToken) {
    throw new Error('Expected renewable browser credentials')
  }
  mocks.getChatGPTAccessToken.mockResolvedValue('new-token')
  expect(await config.getAccessToken('chatgpt-token')).toBe('new-token')
  expect(mocks.getChatGPTAccessToken).toHaveBeenLastCalledWith('user-1', 'chatgpt-token')
})

it('explains temporary authentication outages without changing connection types', async () => {
  mocks.getChatGPTAccessToken.mockRejectedValue(new Error('503 unavailable'))
  expect(await loadBrowserAgentConfig('user-1')).toEqual({ error: expect.stringContaining('Try again') })
  expect(mocks.getDecryptedKey).not.toHaveBeenCalledWith('user-1', 'openai')
})

it('keeps OpenAI API connections working', async () => {
  mocks.getSettings.mockResolvedValue({ browserAgentModel: 'openai/gpt-5.4', browserHostUrl: 'http://127.0.0.1:9330', openaiConnection: 'api', updatedAt: '' })
  expect(await loadBrowserAgentConfig('user-1')).toMatchObject({ provider: 'openai', modelRef: 'openai/gpt-5.4', apiKey: 'openai-token' })
  expect(mocks.getDecryptedKey).not.toHaveBeenCalledWith('user-1', 'chatgpt')
})

it('keeps Anthropic independent of the OpenAI connection', async () => {
  mocks.getSettings.mockResolvedValue({ browserAgentModel: 'anthropic/claude-sonnet-5-5', browserHostUrl: 'http://127.0.0.1:9330', openaiConnection: 'subscription', updatedAt: '' })
  expect(await loadBrowserAgentConfig('user-1')).toMatchObject({ provider: 'anthropic', modelRef: 'anthropic/claude-sonnet-5-5', apiKey: 'anthropic-token' })
})

it('validates only supported browser model providers', () => {
  expect(isBrowserAgentModel('openai/gpt-5.4')).toBe(true)
  expect(isBrowserAgentModel('anthropic/claude-sonnet-5-5')).toBe(true)
  expect(isBrowserAgentModel('other/model')).toBe(false)
  expect(isBrowserAgentModel('openai/')).toBe(false)
})

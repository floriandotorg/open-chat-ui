import { createChatGPTProvider } from './chatgpt'
import type { ChatRequest, ChatStreamEvent } from './types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createArgs: [] as Record<string, unknown>[],
  clientOptions: [] as Record<string, unknown>[],
  events: [] as unknown[],
  createFailure: null as unknown,
}))

vi.mock('openai', () => ({
  default: class {
    constructor(options: Record<string, unknown>) {
      mocks.clientOptions.push(options)
    }
    responses = {
      create: async (args: Record<string, unknown>) => {
        mocks.createArgs.push(args)
        if (mocks.createFailure) throw mocks.createFailure
        return {
          async *[Symbol.asyncIterator]() {
            for (const event of mocks.events) yield event
          },
        }
      },
    }
  },
}))

const collect = async (request: ChatRequest, getAccessToken?: (rejectedToken?: string) => Promise<string | null>) => {
  const events: ChatStreamEvent[] = []
  for await (const event of createChatGPTProvider('access-token', getAccessToken).chat(request)) {
    events.push(event)
  }
  return events
}

const completed = { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 2 } } } }

const failed = (code: string, message = 'failed') => ({ type: 'response.failed', response: { status: 'failed', error: { code, message }, incomplete_details: null } })

beforeEach(() => {
  mocks.createArgs = []
  mocks.clientOptions = []
  mocks.events = [{ type: 'response.output_text.delta', delta: 'Hi' }, completed]
  mocks.createFailure = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chatgpt provider chat', () => {
  it('authenticates with the access token against the public Responses API without retries', async () => {
    await collect({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Hello' }] })
    expect(mocks.clientOptions[0]).toMatchObject({ apiKey: 'access-token', baseURL: 'https://api.openai.com/v1', maxRetries: 0 })
  })

  it('sends store false and stream true and omits parameters plan usage rejects', async () => {
    await collect({ model: 'gpt-4.1', messages: [{ role: 'user', content: 'Hello' }], systemPrompt: 'Be brief', maxTokens: 100, temperature: 0.3 })
    const args = mocks.createArgs[0]
    expect(args).toMatchObject({ model: 'gpt-4.1', store: false, stream: true, instructions: 'Be brief' })
    expect(args).not.toHaveProperty('max_output_tokens')
    expect(args).not.toHaveProperty('temperature')
  })

  it('groups function tools in a namespace and tags replayed calls with it', async () => {
    await collect({
      model: 'gpt-6.1-sol',
      messages: [
        { role: 'user', content: 'Search' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { q: 'x' } }] },
        { role: 'tool', content: 'result', toolCallId: 'call_1' },
      ],
      tools: [{ name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: {} } }],
    })
    const args = mocks.createArgs[0]
    expect(args.tools).toEqual([
      {
        type: 'namespace',
        name: 'app',
        description: 'Tools provided by Open Chat UI',
        tools: [{ type: 'function', name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: {} }, strict: false }],
      },
    ])
    expect(args.input).toContainEqual({ type: 'function_call', call_id: 'call_1', name: 'web_search', namespace: 'app', arguments: '{"q":"x"}' })
  })

  it('maps system messages to developer messages', async () => {
    await collect({
      model: 'gpt-6.1-sol',
      messages: [
        { role: 'system', content: 'Context' },
        { role: 'user', content: 'Hi' },
      ],
    })
    expect(mocks.createArgs[0].input).toContainEqual({ role: 'developer', content: 'Context' })
  })

  it('requests reasoning for gpt-6 models', async () => {
    await collect({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Hi' }], thinkingEffort: 'high' })
    expect(mocks.createArgs[0].reasoning).toEqual({ effort: 'high', summary: 'auto' })
  })

  it('streams text and reports usage before done', async () => {
    const events = await collect({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Hi' }] })
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hi' },
      { type: 'usage', inputTokens: 8, outputTokens: 5, cacheReadInputTokens: 2 },
      { type: 'done', stopReason: 'end' },
    ])
  })

  it('treats a stream that ends without response.completed as an error', async () => {
    mocks.events = [{ type: 'response.output_text.delta', delta: 'Hi' }]
    const events = await collect({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Hi' }] })
    expect(events.at(-1)).toMatchObject({ type: 'error' })
  })

  it('explains a usage limit with a link to ChatGPT usage settings', async () => {
    mocks.events = [failed('subscription_sharing_usage_limit_exceeded')]
    const events = await collect({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Hi' }] })
    expect(events).toEqual([{ type: 'error', error: "Usage limit reached. Review your plan or this app's limit in ChatGPT settings: https://chatgpt.com/settings/usage" }])
  })

  it('maps plan errors raised before the stream opens', async () => {
    mocks.createFailure = Object.assign(new Error('403 not eligible'), { status: 403, code: 'subscription_sharing_user_not_eligible' })
    const events = await collect({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Hi' }] })
    expect(events).toEqual([{ type: 'error', error: 'Your ChatGPT plan is not eligible for use in other apps.' }])
  })

  it('passes other errors through', async () => {
    mocks.events = [failed('subscription_sharing_unsupported_capability', 'Unsupported tool: image_generation')]
    const events = await collect({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Hi' }] })
    expect(events).toEqual([{ type: 'error', error: 'Unsupported tool: image_generation' }])
  })
})

describe('automatic ChatGPT authentication recovery', () => {
  const request: ChatRequest = { model: 'gpt-5.4', messages: [{ role: 'user', content: 'Hello' }] }
  const expired = Object.assign(new Error('401 Provided authentication token is expired'), { status: 401, code: 'invalid_api_key' })

  it('loads a fresh token immediately before every request', async () => {
    const getAccessToken = vi.fn().mockResolvedValueOnce('fresh-1').mockResolvedValueOnce('fresh-2')
    const provider = createChatGPTProvider('stale-token', getAccessToken)
    await Array.fromAsync(provider.chat(request))
    await Array.fromAsync(provider.chat(request))
    expect(mocks.clientOptions.map(options => options.apiKey)).toEqual(['fresh-1', 'fresh-2'])
    expect(getAccessToken.mock.calls).toEqual([[], []])
  })

  it('refreshes once on a 401 and retries only the failed model request', async () => {
    mocks.createFailure = expired
    const getAccessToken = vi
      .fn()
      .mockResolvedValueOnce('fresh-token')
      .mockImplementationOnce(async () => {
        mocks.createFailure = null
        return 'renewed-token'
      })
    const events = await collect(request, getAccessToken)
    expect(getAccessToken.mock.calls).toEqual([[], ['fresh-token']])
    expect(mocks.clientOptions.map(options => options.apiKey)).toEqual(['fresh-token', 'renewed-token'])
    expect(mocks.createArgs[1]).toEqual(mocks.createArgs[0])
    expect(events.map(event => event.type)).toEqual(['text_delta', 'usage', 'done'])
  })

  it('recovers from token expiry reported in an SSE error', async () => {
    mocks.events = [failed('token_expired', 'Provided authentication token is expired')]
    const getAccessToken = vi
      .fn()
      .mockResolvedValueOnce('fresh-token')
      .mockImplementationOnce(async () => {
        mocks.events = [completed]
        return 'renewed-token'
      })
    expect((await collect(request, getAccessToken)).map(event => event.type)).toEqual(['usage', 'done'])
    expect(getAccessToken).toHaveBeenLastCalledWith('fresh-token')
  })

  it('stops after one retry and gives an actionable sign-in message', async () => {
    mocks.createFailure = expired
    const getAccessToken = vi.fn().mockResolvedValueOnce('fresh-token').mockResolvedValue('renewed-token')
    const events = await collect(request, getAccessToken)
    expect(mocks.createArgs).toHaveLength(2)
    expect(getAccessToken).toHaveBeenCalledTimes(2)
    expect(events).toEqual([{ type: 'error', error: expect.stringContaining('Settings > Connections') }])
    expect(events[0].error).not.toContain('401')
  })

  it('does not refresh for quota or other non-authentication errors', async () => {
    mocks.createFailure = Object.assign(new Error('429 too many requests'), { status: 429 })
    const getAccessToken = vi.fn().mockResolvedValue('fresh-token')
    expect(await collect(request, getAccessToken)).toEqual([{ type: 'error', error: '429 too many requests' }])
    expect(getAccessToken.mock.calls).toEqual([[]])
    expect(mocks.createArgs).toHaveLength(1)
  })

  it('never retries a partially delivered response', async () => {
    mocks.events = [{ type: 'response.output_text.delta', delta: 'Partial' }, failed('token_expired')]
    const getAccessToken = vi.fn().mockResolvedValue('fresh-token')
    const events = await collect(request, getAccessToken)
    expect(events.map(event => event.type)).toEqual(['text_delta', 'error'])
    expect(getAccessToken).toHaveBeenCalledTimes(1)
    expect(mocks.createArgs).toHaveLength(1)
  })

  it('does not execute partial tool calls from an authentication failure', async () => {
    mocks.events = [{ type: 'response.output_item.added', item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'browser_action' } }, failed('token_expired')]
    const getAccessToken = vi
      .fn()
      .mockResolvedValueOnce('fresh-token')
      .mockImplementationOnce(async () => {
        mocks.events = [completed]
        return 'renewed-token'
      })
    const events = await collect(request, getAccessToken)
    expect(events.map(event => event.type)).toEqual(['usage', 'done'])
    expect(getAccessToken).toHaveBeenLastCalledWith('fresh-token')
  })

  it('does not contact the model when the connection was revoked', async () => {
    const events = await collect(request, vi.fn().mockResolvedValue(null))
    expect(events).toEqual([{ type: 'error', error: expect.stringContaining('Settings > Connections') }])
    expect(mocks.createArgs).toHaveLength(0)
  })

  it('keeps temporary renewal failures distinct from a revoked connection', async () => {
    const events = await collect(request, vi.fn().mockRejectedValue(new Error('503 unavailable')))
    expect(events).toEqual([{ type: 'error', error: expect.stringContaining('Try again') }])
    expect(events[0].error).not.toContain('Settings > Connections')
    expect(mocks.createArgs).toHaveLength(0)
  })

  it('does not retry after cancellation while refreshing', async () => {
    const controller = new AbortController()
    mocks.createFailure = expired
    const getAccessToken = vi
      .fn()
      .mockResolvedValueOnce('fresh-token')
      .mockImplementationOnce(async () => {
        controller.abort()
        return 'renewed-token'
      })
    await collect({ ...request, signal: controller.signal }, getAccessToken)
    expect(mocks.createArgs).toHaveLength(1)
  })
})

describe('chatgpt provider listModels', () => {
  it('lists models the account can pick, in server order', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        models: [
          { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
          { slug: 'gpt-internal', display_name: 'Internal', visibility: 'hide' },
          { slug: 'gpt-5.5', visibility: 'list' },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const models = await createChatGPTProvider('access-token').listModels()

    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', { headers: { authorization: 'Bearer access-token' } })
    expect(models.map(m => [m.id, m.name])).toEqual([
      ['chatgpt/gpt-6.1-sol', 'GPT-6.1 Sol (ChatGPT plan)'],
      ['chatgpt/gpt-5.5', 'GPT 5.5 (ChatGPT plan)'],
    ])
    expect(models[0].capabilities).toEqual(expect.arrayContaining(['streaming', 'tool_use', 'vision', 'system_prompt']))
  })

  it('throws when the models request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"detail":"nope"}', { status: 401 })),
    )
    await expect(createChatGPTProvider('access-token').listModels()).rejects.toThrow(/401/)
  })
})

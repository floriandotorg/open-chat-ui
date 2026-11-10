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

const collect = async (request: ChatRequest) => {
  const events: ChatStreamEvent[] = []
  for await (const event of createChatGPTProvider('access-token').chat(request)) {
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

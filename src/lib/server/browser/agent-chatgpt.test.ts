import type { ChatRequest, ChatStreamEvent } from '#lib/server/providers/types.ts'
import { emptyUsage, MAX_AGENT_TURNS } from './agent'
import { readBrowserAction, runChatGPTBrowserAgent } from './agent-chatgpt'
import { createFakeHost, fakeState, okResult } from './fake-host'
import { createTaskSession } from './task-session'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createProvider: vi.fn(), chat: vi.fn() }))
vi.mock('#lib/server/providers/chatgpt.ts', () => ({ createChatGPTProvider: mocks.createProvider }))

const toolCall = (name: string, args: Record<string, unknown>, id = 'call-1'): ChatStreamEvent => ({ type: 'tool_call', toolCall: { id, name, arguments: args } })
const turnUsage: ChatStreamEvent = { type: 'usage', inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2 }

const setup = () => {
  const fake = createFakeHost(action => okResult(fakeState(), action.type === 'screenshot' ? { image: { base64: 'aGk=', mediaType: 'image/jpeg' } } : { text: 'Page result' }))
  const session = createTaskSession({ host: fake.host, sessionId: 's1', initialState: fakeState(), files: [] })
  const usage = emptyUsage()
  return { ...fake, session, usage, run: { task: 'Read my listings', model: 'gpt-5.4', apiKey: 'plan-token', session, usage } }
}

const stream = (events: ChatStreamEvent[]) =>
  async function* (request: ChatRequest) {
    void request
    yield* events
  }

beforeEach(() => {
  mocks.createProvider.mockReset().mockReturnValue({ chat: mocks.chat })
  mocks.chat.mockReset().mockImplementation(stream([{ type: 'text_delta', text: 'Finished.' }, turnUsage, { type: 'done', stopReason: 'end' }]))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('sends subscription-compatible requests through the real provider adapter', async () => {
  const { createChatGPTProvider } = await vi.importActual<typeof import('#lib/server/providers/chatgpt.ts')>('#lib/server/providers/chatgpt.ts')
  mocks.createProvider.mockImplementation(createChatGPTProvider)
  const responses = [
    [
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'item-1', call_id: 'call-1', namespace: 'app', name: 'browser_action' } },
      { type: 'response.function_call_arguments.done', item_id: 'item-1', arguments: '{"type":"click","x":40,"y":50}' },
    ],
    [{ type: 'response.output_text.delta', delta: 'Read your listings.' }],
  ]
  const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => {
    const events = [...(responses.shift() ?? []), { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 2 } } } }]
    return new Response(`${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  const { run, calls, usage } = setup()
  expect(await runChatGPTBrowserAgent(run)).toBe('Read your listings.')
  expect(calls).toContainEqual({ actions: [{ type: 'click', target: { x: 40, y: 50 }, button: 'left', count: 1 }, { type: 'screenshot' }] })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  const requests = fetchMock.mock.calls.map(([url, init]) => {
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer plan-token')
    if (typeof init?.body !== 'string') {
      throw new Error('Expected a JSON request body')
    }
    const body: unknown = JSON.parse(init.body)
    return body
  })
  for (const request of requests) {
    expect(request).toMatchObject({ store: false, stream: true, model: 'gpt-5.4', tools: [{ type: 'namespace', name: 'app', tools: expect.arrayContaining([expect.objectContaining({ type: 'function', name: 'browser_action' })]) }] })
    expect(request).not.toHaveProperty('previous_response_id')
    expect(request).not.toHaveProperty('truncation')
  }
  expect(requests[1]).toMatchObject({
    input: expect.arrayContaining([
      { type: 'function_call', call_id: 'call-1', namespace: 'app', name: 'browser_action', arguments: '{"type":"click","x":40,"y":50}' },
      { type: 'function_call_output', call_id: 'call-1', output: 'Page result' },
    ]),
  })
  expect(usage).toEqual({ inputTokens: 16, outputTokens: 10, cacheReadInputTokens: 4, cacheCreationInputTokens: 0 })
})

it('uses only the ChatGPT provider and ordinary browser function tools', async () => {
  const { run, usage } = setup()
  expect(await runChatGPTBrowserAgent(run)).toBe('Finished.')
  expect(mocks.createProvider).toHaveBeenCalledWith('plan-token')
  expect(mocks.chat.mock.calls[0][0]).toMatchObject({ model: 'gpt-5.4', thinkingEffort: 'medium', messages: [{ role: 'user', images: [{ data: 'aGk=', mimeType: 'image/jpeg' }] }] })
  expect(mocks.chat.mock.calls[0][0].tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining(['browser_action', 'navigate', 'read_page_text', 'request_user']))
  expect(usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, cacheCreationInputTokens: 0 })
})

it('executes actions and replays call ids, results and screenshots across turns', async () => {
  mocks.chat.mockImplementationOnce(stream([toolCall('browser_action', { type: 'click', x: 40, y: 50 }), turnUsage, { type: 'done', stopReason: 'tool_use' }]))
  const { run, calls, usage } = setup()
  expect(await runChatGPTBrowserAgent(run)).toBe('Finished.')
  expect(calls).toContainEqual({ actions: [{ type: 'click', target: { x: 40, y: 50 }, button: 'left', count: 1 }, { type: 'screenshot' }] })
  const request: ChatRequest = mocks.chat.mock.calls[1][0]
  expect(request.messages).toContainEqual({ role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'browser_action', arguments: { type: 'click', x: 40, y: 50 } }] })
  expect(request.messages).toContainEqual({ role: 'tool', toolCallId: 'call-1', content: 'Page result' })
  expect(request.messages.at(-1)).toMatchObject({ role: 'user', images: [{ data: 'aGk=', mimeType: 'image/jpeg' }] })
  expect(usage.inputTokens).toBe(20)
})

it('returns validation errors without executing malformed actions', async () => {
  mocks.chat.mockImplementationOnce(stream([toolCall('browser_action', { type: 'click', x: '40', y: 50 }), { type: 'done', stopReason: 'tool_use' }]))
  const { run, calls } = setup()
  expect(await runChatGPTBrowserAgent(run)).toBe('Finished.')
  expect(calls.flatMap(call => call.actions).every(action => action.type === 'screenshot')).toBe(true)
  expect(mocks.chat.mock.calls[1][0].messages).toContainEqual({ role: 'tool', toolCallId: 'call-1', content: expect.stringContaining('Error:') })
})

it('delegates login and confirmation requests and respects a declined request', async () => {
  mocks.chat.mockImplementationOnce(stream([toolCall('request_user', { kind: 'confirm', message: 'Publish this listing?' }), toolCall('browser_action', { type: 'click', x: 40, y: 50 }, 'call-2'), { type: 'done', stopReason: 'tool_use' }]))
  const { run, session, calls } = setup()
  const askUser = vi.spyOn(session, 'askUser').mockResolvedValue({ outcome: 'declined', message: 'The user declined. Do not do this.' })
  expect(await runChatGPTBrowserAgent(run)).toBe('Finished.')
  expect(askUser).toHaveBeenCalledWith('confirm', 'Publish this listing?')
  expect(mocks.chat.mock.calls[1][0].messages).toContainEqual({ role: 'tool', toolCallId: 'call-1', content: 'The user declined. Do not do this.' })
  expect(calls.flatMap(call => call.actions).every(action => action.type === 'screenshot')).toBe(true)
})

it('uploads staged attachments with the existing browser runner', async () => {
  mocks.chat.mockImplementationOnce(stream([toolCall('upload_files', { x: 40, y: 50, file_ids: ['file_1'] }), { type: 'done', stopReason: 'tool_use' }]))
  const { run, session, calls } = setup()
  session.files.push({ id: 'file_1', name: 'photo.jpg', size: 3 })
  expect(await runChatGPTBrowserAgent(run)).toBe('Finished.')
  expect(calls).toContainEqual({ actions: [{ type: 'file_upload', target: { x: 40, y: 50 }, fileIds: ['file_1'] }, { type: 'screenshot' }] })
})

it('surfaces subscription errors instead of reporting partial success', async () => {
  mocks.chat.mockImplementationOnce(
    stream([
      { type: 'text_delta', text: 'Working' },
      { type: 'error', error: 'Usage limit reached' },
    ]),
  )
  const { run } = setup()
  await expect(runChatGPTBrowserAgent(run)).rejects.toThrow('Usage limit reached')
  expect(mocks.createProvider).toHaveBeenCalledTimes(1)
})

it('does not act on tool calls from a stream that did not complete', async () => {
  mocks.chat.mockImplementationOnce(stream([toolCall('browser_action', { type: 'click', x: 40, y: 50 })]))
  const { run, calls } = setup()
  await expect(runChatGPTBrowserAgent(run)).rejects.toThrow('ended before it completed')
  expect(calls.flatMap(call => call.actions).every(action => action.type === 'screenshot')).toBe(true)
})

it('stops when aborted before contacting the model', async () => {
  const { run, calls } = setup()
  await expect(runChatGPTBrowserAgent({ ...run, signal: AbortSignal.abort() })).rejects.toThrow()
  expect(mocks.chat).not.toHaveBeenCalled()
  expect(calls).toEqual([])
})

it('bounds turns and retains only recent screenshots in replayed history', async () => {
  mocks.chat.mockImplementation(stream([toolCall('browser_action', { type: 'screenshot' }), { type: 'done', stopReason: 'tool_use' }]))
  const { run } = setup()
  expect(await runChatGPTBrowserAgent(run)).toBe(`Stopped after ${MAX_AGENT_TURNS} turns without finishing.`)
  expect(mocks.chat).toHaveBeenCalledTimes(MAX_AGENT_TURNS)
  const request: ChatRequest = mocks.chat.mock.calls.at(-1)?.[0]
  expect(request.messages.filter(message => message.images?.length).length).toBeLessThanOrEqual(3)
})

it('validates browser action arguments before passing them to the host', () => {
  expect(readBrowserAction({ type: 'click', x: 1, y: 2, button: 'right', count: 2 })).toEqual({ type: 'click', target: { x: 1, y: 2 }, button: 'right', count: 2 })
  expect(readBrowserAction({ type: 'scroll', x: 1, y: 2, deltaX: 0, deltaY: 300 })).toEqual({ type: 'scroll', x: 1, y: 2, deltaX: 0, deltaY: 300 })
  expect(readBrowserAction({ type: 'key', keys: ['ctrl+a'] })).toEqual({ type: 'key', keys: ['ctrl+a'] })
  expect(readBrowserAction({ type: 'type', text: 'Hello' })).toEqual({ type: 'type', text: 'Hello' })
  expect(readBrowserAction({ type: 'wait', ms: 2000 })).toEqual({ type: 'wait', ms: 2000 })
  expect(readBrowserAction({ type: 'wait', ms: -1 })).toBeNull()
  expect(readBrowserAction({ type: 'click', x: Number.NaN, y: 2 })).toBeNull()
  expect(readBrowserAction({ type: 'key', keys: [1] })).toBeNull()
  expect(readBrowserAction({ type: 'navigate', url: 'https://example.com' })).toBeNull()
})

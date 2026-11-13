import { createFakeHost, fakeState, okResult } from '#lib/server/browser/fake-host.ts'
import { registerBrowserSession, resolveUserRequest, unregisterBrowserSession } from '#lib/server/browser/sessions.ts'
import { createTaskSession, describeAction } from '#lib/server/browser/task-session.ts'
import type { ToolProgress } from '#lib/types.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  unregisterBrowserSession('s1')
})

const setup = (respond?: Parameters<typeof createFakeHost>[0], signal?: AbortSignal) => {
  const fake = createFakeHost(respond)
  const progress: ToolProgress[] = []
  let clock = 1_000
  registerBrowserSession({ sessionId: 's1', userId: 'u1', conversationId: 'c1', host: fake.host })
  const session = createTaskSession({ host: fake.host, sessionId: 's1', initialState: fakeState(), files: [], emitProgress: p => progress.push(p), now: () => clock, userWaitMs: 1_000, signal })
  return { ...fake, progress, session, advance: (ms: number) => (clock += ms) }
}

describe('describeAction', () => {
  it('names the destination host for navigation', () => {
    expect(describeAction({ type: 'navigate', url: 'https://www.ebay.de/sl/sell' })).toBe('Opening ebay.de')
  })

  it('never includes typed text', () => {
    expect(describeAction({ type: 'type', text: 'hunter2' })).toBe('Typing')
  })

  it('describes uploads with the file count', () => {
    expect(describeAction({ type: 'file_upload', target: { ref: 'ref_1' }, fileIds: ['file_1', 'file_2'] })).toBe('Uploading 2 files')
  })
})

describe('createTaskSession', () => {
  it('runs actions, tracks state and reports progress', async () => {
    const next = fakeState('https://www.ebay.de/')
    const { session, progress } = setup(() => okResult(next))
    const results = await session.act([{ type: 'navigate', url: 'https://www.ebay.de/' }, { type: 'screenshot' }])
    expect(results).toHaveLength(2)
    expect(session.state().url).toBe('https://www.ebay.de/')
    expect(session.steps()).toBe(2)
    expect(session.log).toEqual(['Opening ebay.de', 'Looking at the page'])
    expect(progress.at(-1)).toEqual({ sessionId: 's1', step: 2, status: 'running', summary: 'Opening ebay.de' })
  })

  it('logs the failing action and stops there', async () => {
    const { session } = setup(action => (action.type === 'click' ? { ok: false, error: 'Unknown ref', state: fakeState() } : okResult()))
    const results = await session.act([{ type: 'click', target: { ref: 'ref_9' }, button: 'left', count: 1 }, { type: 'screenshot' }])
    expect(results).toHaveLength(1)
    expect(session.log).toEqual(['Clicking (failed: Unknown ref)'])
  })

  it('waits for the user, hides the window and excludes waiting from active time', async () => {
    const { session, progress, hidden, advance } = setup()
    advance(500)
    const answer = session.askUser('login', 'Log in to eBay')
    await Promise.resolve()
    expect(progress.at(-1)).toEqual({ sessionId: 's1', step: 0, status: 'waiting_for_user', summary: 'Log in to eBay', request: { kind: 'login', message: 'Log in to eBay', url: 'https://example.com/' } })
    advance(60_000)
    expect(resolveUserRequest('s1', 'u1', 'done')).toBe(true)
    expect(await answer).toEqual({ outcome: 'done', message: expect.stringMatching(/finished/) })
    expect(hidden).toEqual(['s1'])
    expect(progress.at(-1)?.status).toBe('running')
    expect(session.activeMs()).toBe(500)
  })

  it('tells the agent when the user declines a confirmation', async () => {
    const { session } = setup()
    const answer = session.askUser('confirm', 'Publish the listing?')
    await Promise.resolve()
    resolveUserRequest('s1', 'u1', 'declined')
    expect(await answer).toEqual({ outcome: 'declined', message: expect.stringMatching(/declined/) })
  })

  it('requires user approval before granting a local origin and never replays actions', async () => {
    const origin = 'https://192.168.50.1:8443'
    const { session, host, progress, calls } = setup(() => ({ ok: false, error: 'blockedbyclient', state: { ...fakeState(), localNetworkRequests: [origin] } }))
    const decide = vi.fn().mockResolvedValue(undefined)
    host.decideNetworkAccess = decide
    const answer = session.act([{ type: 'navigate', url: `${origin}/Main_Login.asp` }])
    await vi.waitFor(() => expect(progress.at(-1)?.request?.kind).toBe('local_network'))
    const request = progress.at(-1)?.request
    expect(request?.url).toBe(origin)
    expect(request?.message).toContain('this task')
    expect(decide).not.toHaveBeenCalled()
    expect(resolveUserRequest('s1', 'u1', 'done', request?.id)).toBe(true)
    const results = await answer
    expect(decide).toHaveBeenCalledWith('s1', origin, true, undefined)
    expect(results[0]).toMatchObject({ ok: false, error: expect.stringContaining('approved') })
    expect(calls.filter(call => call.actions.some(action => action.type === 'navigate'))).toHaveLength(1)
  })

  it.each(['declined', 'timeout'] as const)('does not grant local access on %s', async outcome => {
    const origin = 'http://127.0.0.1:8090'
    const { session, host, progress } = setup(() => okResult({ ...fakeState(), localNetworkRequests: [origin] }))
    const decide = vi.fn().mockResolvedValue(undefined)
    host.decideNetworkAccess = decide
    const answer = session.act([{ type: 'screenshot' }])
    await vi.waitFor(() => expect(progress.at(-1)?.request?.kind).toBe('local_network'))
    if (outcome === 'declined') {
      resolveUserRequest('s1', 'u1', outcome, progress.at(-1)?.request?.id)
    }
    await answer
    expect(decide).toHaveBeenCalledWith('s1', origin, false, undefined)
  })

  it('never grants access when the task is stopped while waiting', async () => {
    const controller = new AbortController()
    const { session, host, progress } = setup(() => okResult({ ...fakeState(), localNetworkRequests: ['http://127.0.0.1'] }), controller.signal)
    const decide = vi.fn().mockResolvedValue(undefined)
    host.decideNetworkAccess = decide
    const answer = session.act([{ type: 'screenshot' }])
    const stopped = expect(answer).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(progress.at(-1)?.request?.kind).toBe('local_network'))
    controller.abort()
    await stopped
    expect(decide).not.toHaveBeenCalled()
    expect(resolveUserRequest('s1', 'u1', 'done', progress.at(-1)?.request?.id)).toBe(false)
  })

  it('tells the agent when the user does not answer', async () => {
    const { session } = setup()
    expect(await session.askUser('captcha', 'Solve the captcha')).toEqual({ outcome: 'timeout', message: expect.stringMatching(/did not respond/) })
  })
})

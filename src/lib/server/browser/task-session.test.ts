import { createFakeHost, fakeState, okResult } from '#lib/server/browser/fake-host.ts'
import { registerBrowserSession, resolveUserRequest, unregisterBrowserSession } from '#lib/server/browser/sessions.ts'
import { createTaskSession, describeAction } from '#lib/server/browser/task-session.ts'
import type { ToolProgress } from '#lib/types.ts'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => {
  unregisterBrowserSession('s1')
})

const setup = (respond?: Parameters<typeof createFakeHost>[0]) => {
  const fake = createFakeHost(respond)
  const progress: ToolProgress[] = []
  let clock = 1_000
  registerBrowserSession({ sessionId: 's1', userId: 'u1', conversationId: 'c1', host: fake.host })
  const session = createTaskSession({ host: fake.host, sessionId: 's1', initialState: fakeState(), files: [], emitProgress: p => progress.push(p), now: () => clock, userWaitMs: 1_000 })
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

  it('tells the agent when the user does not answer', async () => {
    const { session } = setup()
    expect(await session.askUser('captcha', 'Solve the captcha')).toEqual({ outcome: 'timeout', message: expect.stringMatching(/did not respond/) })
  })
})

import { createFakeHost } from '#lib/server/browser/fake-host.ts'
import { getBrowserSession, registerBrowserSession, resolveUserRequest, unregisterBrowserSession, waitForUser } from '#lib/server/browser/sessions.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const request = { kind: 'login' as const, message: 'Log in', url: 'https://example.com' }

const register = (sessionId: string, userId = 'u1') => registerBrowserSession({ sessionId, userId, conversationId: 'c1', host: createFakeHost().host })

afterEach(() => {
  unregisterBrowserSession('s1')
})

describe('browser sessions', () => {
  it('only returns sessions to their owner', () => {
    register('s1')
    expect(getBrowserSession('s1', 'u1')?.sessionId).toBe('s1')
    expect(getBrowserSession('s1', 'u2')).toBeNull()
    expect(getBrowserSession('missing', 'u1')).toBeNull()
  })

  it('resolves a pending request with the owner outcome', async () => {
    register('s1')
    const waiting = waitForUser('s1', request, { timeoutMs: 1_000 })
    expect(getBrowserSession('s1', 'u1')?.pending?.request).toEqual(request)
    expect(resolveUserRequest('s1', 'u2', 'done')).toBe(false)
    expect(resolveUserRequest('s1', 'u1', 'done')).toBe(true)
    expect(await waiting).toBe('done')
    expect(getBrowserSession('s1', 'u1')?.pending).toBeNull()
  })

  it('times out', async () => {
    register('s1')
    expect(await waitForUser('s1', request, { timeoutMs: 10 })).toBe('timeout')
    expect(getBrowserSession('s1', 'u1')?.pending).toBeNull()
  })

  it('stops waiting when the generation is aborted', async () => {
    register('s1')
    const controller = new AbortController()
    const waiting = waitForUser('s1', request, { timeoutMs: 1_000, signal: controller.signal })
    controller.abort()
    expect(await waiting).toBe('aborted')
  })

  it('stops waiting when the session is unregistered', async () => {
    register('s1')
    const waiting = waitForUser('s1', request, { timeoutMs: 1_000 })
    unregisterBrowserSession('s1')
    expect(await waiting).toBe('aborted')
  })

  it('returns aborted for unknown sessions', async () => {
    expect(await waitForUser('missing', request, { timeoutMs: 1_000 })).toBe('aborted')
  })

  it('rejects resolving when nothing is pending', () => {
    register('s1')
    expect(resolveUserRequest('s1', 'u1', 'done')).toBe(false)
  })
})

describe('browser sessions across module reloads', () => {
  it('keeps sessions registered by an earlier module instance', async () => {
    vi.resetModules()
    const before = await import('#lib/server/browser/sessions.ts')
    before.registerBrowserSession({ sessionId: 'reload', userId: 'u1', conversationId: 'c1', host: createFakeHost().host })
    const waiting = before.waitForUser('reload', request, { timeoutMs: 1_000 })
    vi.resetModules()
    const after = await import('#lib/server/browser/sessions.ts')
    expect(after.getBrowserSession('reload', 'u1')?.sessionId).toBe('reload')
    expect(after.resolveUserRequest('reload', 'u1', 'done')).toBe(true)
    expect(await waiting).toBe('done')
    after.unregisterBrowserSession('reload')
  })
})

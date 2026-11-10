import type { BrowserUserOutcome, BrowserUserRequest } from '#lib/browser-protocol.ts'
import type { BrowserHost } from '#lib/server/browser/host-client.ts'

export type UserWaitOutcome = BrowserUserOutcome | 'timeout' | 'aborted'

interface PendingUserRequest {
  request: BrowserUserRequest
  resolve: (outcome: UserWaitOutcome) => void
}

export interface ActiveBrowserSession {
  sessionId: string
  userId: string
  conversationId: string
  host: BrowserHost
  pending: PendingUserRequest | null
}

const sessions = new Map<string, ActiveBrowserSession>()

export const registerBrowserSession = (session: Omit<ActiveBrowserSession, 'pending'>) => {
  sessions.set(session.sessionId, { ...session, pending: null })
}

export const unregisterBrowserSession = (sessionId: string) => {
  sessions.get(sessionId)?.pending?.resolve('aborted')
  sessions.delete(sessionId)
}

export const getBrowserSession = (sessionId: string, userId: string): ActiveBrowserSession | null => {
  const session = sessions.get(sessionId)
  return session?.userId === userId ? session : null
}

export const waitForUser = (sessionId: string, request: BrowserUserRequest, { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal }): Promise<UserWaitOutcome> => {
  const session = sessions.get(sessionId)
  if (!session || signal?.aborted) {
    return Promise.resolve('aborted')
  }
  return new Promise(resolve => {
    const finish = (outcome: UserWaitOutcome) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (session.pending === pending) {
        session.pending = null
      }
      resolve(outcome)
    }
    const onAbort = () => finish('aborted')
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
    const pending: PendingUserRequest = { request, resolve: finish }
    signal?.addEventListener('abort', onAbort, { once: true })
    session.pending?.resolve('aborted')
    session.pending = pending
  })
}

export const resolveUserRequest = (sessionId: string, userId: string, outcome: BrowserUserOutcome): boolean => {
  const pending = getBrowserSession(sessionId, userId)?.pending
  if (!pending) {
    return false
  }
  pending.resolve(outcome)
  return true
}

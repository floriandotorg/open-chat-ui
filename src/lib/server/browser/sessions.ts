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

// A running browser task can wait minutes for the user. Dev hot reloads
// re-evaluate this module for the API routes while the task keeps its old
// instance, so the registry lives on globalThis to be shared by both.
declare global {
  var openChatUiBrowserSessions: Map<string, ActiveBrowserSession> | undefined
}
globalThis.openChatUiBrowserSessions ??= new Map()
const sessions = globalThis.openChatUiBrowserSessions

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

export const resolveUserRequest = (sessionId: string, userId: string, outcome: BrowserUserOutcome, requestId?: string): boolean => {
  const pending = getBrowserSession(sessionId, userId)?.pending
  if (!pending || (pending.request.kind === 'local_network' && (!requestId || pending.request.id !== requestId))) {
    return false
  }
  pending.resolve(outcome)
  return true
}

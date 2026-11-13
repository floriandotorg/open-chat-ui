import type { BrowserAction, BrowserActionResult, BrowserStagedFile, BrowserState, BrowserUserRequest, BrowserUserRequestKind } from '#lib/browser-protocol.ts'
import type { BrowserHost } from '#lib/server/browser/host-client.ts'
import { type UserWaitOutcome, waitForUser } from '#lib/server/browser/sessions.ts'
import type { ToolProgress } from '#lib/types.ts'

export const USER_WAIT_MS = 15 * 60_000

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export const describeAction = (action: BrowserAction): string => {
  switch (action.type) {
    case 'navigate':
      return `Opening ${hostnameOf(action.url) || 'a page'}`
    case 'history':
      return action.direction === 'back' ? 'Going back' : action.direction === 'forward' ? 'Going forward' : 'Reloading'
    case 'screenshot':
      return 'Looking at the page'
    case 'zoom':
      return 'Zooming in'
    case 'click':
      if (action.button === 'right') {
        return 'Right-clicking'
      }
      return action.count === 1 ? 'Clicking' : action.count === 2 ? 'Double-clicking' : 'Triple-clicking'
    case 'hover':
      return 'Hovering'
    case 'drag':
      return 'Dragging'
    case 'mouse':
      return 'Moving the mouse'
    case 'scroll':
    case 'scroll_to':
      return 'Scrolling'
    case 'type':
      return 'Typing'
    case 'key':
      return `Pressing ${action.keys.join(', ')}`
    case 'wait':
      return 'Waiting'
    case 'read_page':
    case 'find':
    case 'page_text':
      return 'Reading the page'
    case 'credential_list':
      return 'Looking up Proton Pass logins'
    case 'credential_fill':
      return 'Filling a credential privately'
    case 'form_input':
      return 'Filling in a field'
    case 'file_upload':
      return `Uploading ${action.fileIds.length} ${action.fileIds.length === 1 ? 'file' : 'files'}`
    case 'tab_new':
      return 'Opening a new tab'
    case 'tab_switch':
      return 'Switching tabs'
    case 'tab_close':
      return 'Closing a tab'
    case 'tab_list':
      return 'Checking tabs'
  }
}

const userAnswer = (kind: BrowserUserRequestKind, outcome: string): string => {
  if (outcome === 'done') {
    return kind === 'confirm' ? 'The user approved. Go ahead.' : 'The user finished. Take a screenshot to check the page before you continue.'
  }
  if (outcome === 'declined') {
    return kind === 'confirm' ? 'The user declined. Do not do this. Finish and explain what you would have done.' : 'The user declined. Finish and explain what is still needed.'
  }
  return 'The user did not respond in time. Finish and explain what is still needed.'
}

export interface TaskSessionOptions {
  host: BrowserHost
  sessionId: string
  initialState: BrowserState
  files: BrowserStagedFile[]
  signal?: AbortSignal
  emitProgress?: (progress: ToolProgress) => void
  userWaitMs?: number
  now?: () => number
}

export type TaskSession = ReturnType<typeof createTaskSession>

export const createTaskSession = ({ host, sessionId, initialState, files, signal, emitProgress, userWaitMs = USER_WAIT_MS, now = Date.now }: TaskSessionOptions) => {
  let state = initialState
  let steps = 0
  let waitedMs = 0
  const startedAt = now()
  const log: string[] = []

  const report = (progress: Omit<ToolProgress, 'sessionId' | 'step'>) => emitProgress?.({ sessionId, step: steps, ...progress })

  const waitForAnswer = async (request: BrowserUserRequest): Promise<Exclude<UserWaitOutcome, 'aborted'>> => {
    log.push(`Asked you: ${request.message}`)
    const waitStartedAt = now()
    const waiting = waitForUser(sessionId, request, { timeoutMs: userWaitMs, signal })
    report({ status: 'waiting_for_user', summary: request.message, request })
    const outcome = await waiting
    waitedMs += now() - waitStartedAt
    if (outcome === 'aborted') {
      throw new DOMException('Browser task stopped', 'AbortError')
    }
    log.push(outcome === 'done' ? 'You finished' : outcome === 'declined' ? 'You declined' : 'No answer')
    return outcome
  }

  const act = async (actions: BrowserAction[], tabId?: string): Promise<BrowserActionResult[]> => {
    if (actions.length === 0) {
      return []
    }
    const { results } = await host.actions(sessionId, { actions, ...(tabId ? { tabId } : {}) }, signal)
    for (let n = 0; n < results.length; ++n) {
      const result = results[n]
      ++steps
      log.push(result.ok ? describeAction(actions[n]) : `${describeAction(actions[n])} (failed: ${result.error})`)
      state = result.state
    }
    if (!results.length) {
      return results
    }
    for (const origin of state.localNetworkRequests ?? []) {
      const outcome = await waitForAnswer({
        id: crypto.randomUUID(),
        kind: 'local_network',
        url: origin,
        message: `Allow access to ${origin} for this task only? The browser agent and pages in this task will be able to contact this local service. Other local origins remain blocked.`,
      })
      signal?.throwIfAborted()
      const allowed = outcome === 'done'
      await host.decideNetworkAccess(sessionId, origin, allowed, signal)
      const note = allowed
        ? `Local network access approved for ${origin} for this task only. Blocked requests were not replayed. Inspect the page and navigate or reload if needed; do not blindly repeat submissions or clicks.`
        : `Local network access to ${origin} was not approved and remains blocked for this task. Do not try to bypass this decision.`
      log.push(note)
      state = { ...state, localNetworkRequests: state.localNetworkRequests?.filter(pending => pending !== origin) }
      const result = results[results.length - 1]
      results[results.length - 1] = result.ok ? { ...result, state, text: [result.text, note].filter(Boolean).join('\n') } : { ...result, state, error: `${result.error}\n${note}` }
    }
    const attempted = actions.slice(0, results.length)
    const last = attempted.findLast(action => action.type !== 'screenshot') ?? attempted[0]
    const site = hostnameOf(state.url)
    const summary = describeAction(last)
    report({ status: 'running', summary: site && !summary.includes(site) ? `${summary} · ${site}` : summary })
    return results
  }

  const askUser = async (kind: BrowserUserRequestKind, message: string): Promise<{ outcome: Exclude<UserWaitOutcome, 'aborted'>; message: string }> => {
    const outcome = await waitForAnswer({ kind, message, url: state.url })
    await host.hide(sessionId).catch(() => {})
    const refreshed = await host.actions(sessionId, { actions: [{ type: 'tab_list' }] }, signal).catch(() => null)
    const latest = refreshed?.results.at(-1)
    if (latest) {
      state = latest.state
    }
    report({ status: 'running', summary: 'Continuing' })
    return { outcome, message: userAnswer(kind, outcome) }
  }

  return {
    sessionId,
    files,
    log,
    act,
    askUser,
    state: () => state,
    steps: () => steps,
    activeMs: () => now() - startedAt - waitedMs,
  }
}

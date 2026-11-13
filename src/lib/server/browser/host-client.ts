import type { BrowserActionsRequest, BrowserActionsResponse, BrowserHostHealth, BrowserLiveInput, BrowserSessionResponse, BrowserStagedFile } from '#lib/browser-protocol.ts'

export class BrowserHostError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export interface BrowserHost {
  health: (signal?: AbortSignal) => Promise<BrowserHostHealth>
  openSession: (signal?: AbortSignal) => Promise<BrowserSessionResponse>
  actions: (sessionId: string, request: BrowserActionsRequest, signal?: AbortSignal) => Promise<BrowserActionsResponse>
  stageFile: (sessionId: string, fileId: string, name: string, data: Uint8Array<ArrayBuffer>, signal?: AbortSignal) => Promise<BrowserStagedFile>
  show: (sessionId: string) => Promise<void>
  hide: (sessionId: string) => Promise<void>
  frame: (sessionId: string) => Promise<Response>
  input: (sessionId: string, input: BrowserLiveInput) => Promise<void>
  decideNetworkAccess: (sessionId: string, origin: string, allow: boolean, signal?: AbortSignal) => Promise<void>
  closeSession: (sessionId: string) => Promise<void>
}

interface RequestOptions {
  method?: string
  json?: unknown
  body?: Uint8Array<ArrayBuffer>
  signal?: AbortSignal
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const ACTIONS_TIMEOUT_MS = 180_000
const UPLOAD_TIMEOUT_MS = 120_000

const describeStatus = (status: number, body: string): string => {
  if (status === 401) {
    return 'The browser host rejected the token. Check the token in Settings > Tools.'
  }
  if (status === 409) {
    return 'The browser is busy with another task.'
  }
  if (status === 404) {
    return 'The browser session is gone. It may have expired.'
  }
  return `Browser host error ${status}${body ? `: ${body.slice(0, 300)}` : ''}`
}

export const normalizeHostUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export const createBrowserHost = ({ url, token }: { url: string; token: string }): BrowserHost => {
  const origin = normalizeHostUrl(url) ?? url

  const request = async (path: string, options: RequestOptions = {}): Promise<Response> => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    let body: BodyInit | undefined = options.body
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.json)
    }
    let response: Response
    try {
      response = await fetch(`${origin}${path}`, { method: options.method ?? 'GET', headers, body, signal })
    } catch (err) {
      if (options.signal?.aborted) {
        throw err
      }
      if (timeout.aborted) {
        throw new BrowserHostError('The browser host did not answer in time.')
      }
      throw new BrowserHostError(`The browser host at ${origin} is unreachable. Is the MacBook awake and the browser host running?`)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new BrowserHostError(describeStatus(response.status, text), response.status)
    }
    return response
  }

  const session = (sessionId: string) => `/sessions/${encodeURIComponent(sessionId)}`

  return {
    health: async signal => (await request('/health', { signal, timeoutMs: 5_000 })).json(),
    openSession: async signal => (await request('/sessions', { method: 'POST', signal })).json(),
    actions: async (sessionId, body, signal) => (await request(`${session(sessionId)}/actions`, { method: 'POST', json: body, signal, timeoutMs: ACTIONS_TIMEOUT_MS })).json(),
    stageFile: async (sessionId, fileId, name, data, signal) => (await request(`${session(sessionId)}/files/${encodeURIComponent(fileId)}?name=${encodeURIComponent(name)}`, { method: 'PUT', body: data, signal, timeoutMs: UPLOAD_TIMEOUT_MS })).json(),
    show: async sessionId => {
      await request(`${session(sessionId)}/show`, { method: 'POST' })
    },
    hide: async sessionId => {
      await request(`${session(sessionId)}/hide`, { method: 'POST' })
    },
    frame: sessionId => request(`${session(sessionId)}/frame`, { timeoutMs: 10_000 }),
    input: async (sessionId, input) => {
      await request(`${session(sessionId)}/input`, { method: 'POST', json: input, timeoutMs: 10_000 })
    },
    decideNetworkAccess: async (sessionId, origin, allow, signal) => {
      await request(`${session(sessionId)}/network-access`, { method: 'POST', json: { origin, allow }, signal })
    },
    closeSession: async sessionId => {
      await request(session(sessionId), { method: 'DELETE', timeoutMs: 15_000 })
    },
  }
}

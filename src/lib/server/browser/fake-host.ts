import type { BrowserAction, BrowserActionResult, BrowserState } from '#lib/browser-protocol.ts'
import type { BrowserHost } from '#lib/server/browser/host-client.ts'

export const fakeState = (url = 'https://example.com/'): BrowserState => ({ tabs: [{ id: 'tab_1', title: 'Example', url }], activeTabId: 'tab_1', url, viewport: { width: 1280, height: 800 } })

export const okResult = (state = fakeState(), extra: Partial<Extract<BrowserActionResult, { ok: true }>> = {}): BrowserActionResult => ({ ok: true, state, ...extra })

const unused = () => Promise.reject(new Error('not used in this test'))

export const createFakeHost = (respond: (action: BrowserAction, tabId?: string) => BrowserActionResult = () => okResult()) => {
  const calls: { actions: BrowserAction[]; tabId?: string }[] = []
  const hidden: string[] = []
  const host: BrowserHost = {
    health: unused,
    openSession: async () => ({ sessionId: 's1', state: fakeState() }),
    actions: async (_sessionId, request) => {
      calls.push(request)
      const results: BrowserActionResult[] = []
      for (const action of request.actions) {
        const result = respond(action, request.tabId)
        results.push(result)
        if (!result.ok) {
          break
        }
      }
      return { results }
    },
    stageFile: async (_sessionId, fileId, name, data) => ({ id: fileId, name, size: data.byteLength }),
    show: unused,
    hide: async sessionId => {
      hidden.push(sessionId)
    },
    frame: unused,
    input: unused,
    decideNetworkAccess: unused,
    closeSession: async () => {},
  }
  return { host, calls, hidden }
}

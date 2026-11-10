import { BROWSER_VIEWPORT, type BrowserState } from '#lib/browser-protocol.ts'
import { createRefRegistry, type RefRegistry } from './accessibility'
import type { Chrome } from './chrome'
import type { UploadStore } from './uploads'
import type { Subprocess } from 'bun'
import type { BrowserContext, CDPSession, Page } from 'playwright-core'

export const SESSION_IDLE_MS = 10 * 60_000
const STATE_TIMEOUT_MS = 2_000

export interface Tab {
  id: string
  page: Page
  refs: RefRegistry
  cdp: CDPSession | null
}

export interface Session {
  id: string
  tabs: Map<string, Tab>
  activeTabId: string
  lastUsedAt: number
  shown: boolean
  notes: string[]
  expectingFileChooser: boolean
  nextTabNumber: number
  caffeinate: Subprocess | null
}

export class SessionBusyError extends Error {}

const withFallback = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([
    promise.catch(() => fallback),
    new Promise<T>(resolve => {
      setTimeout(() => resolve(fallback), ms)
    }),
  ])

export const activeTab = (session: Session): Tab => {
  const tab = session.tabs.get(session.activeTabId)
  if (!tab) {
    throw new Error('Session has no active tab')
  }
  return tab
}

export const cdpFor = async (tab: Tab): Promise<CDPSession> => {
  if (!tab.cdp) {
    tab.cdp = await tab.page.context().newCDPSession(tab.page)
  }
  return tab.cdp
}

export const buildState = async (session: Session): Promise<BrowserState> => {
  const tabs = await Promise.all(
    [...session.tabs.values()].map(async tab => ({
      id: tab.id,
      title: await withFallback(tab.page.title(), STATE_TIMEOUT_MS, ''),
      url: tab.page.url(),
    })),
  )
  const active = session.tabs.get(session.activeTabId)
  const viewport = active
    ? await withFallback(
        active.page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
        STATE_TIMEOUT_MS,
        { ...BROWSER_VIEWPORT },
      )
    : { ...BROWSER_VIEWPORT }
  return { tabs, activeTabId: session.activeTabId, url: active?.page.url() ?? '', viewport }
}

export const takeNotes = (session: Session): string[] => session.notes.splice(0)

export const createSessionManager = (chrome: Chrome, uploads: UploadStore) => {
  let current: Session | null = null
  let creating: Promise<Session> | null = null
  const watchedContexts = new WeakSet<BrowserContext>()

  const keepHidden = async (session: Session, page: Page) => {
    if (session.shown) {
      return
    }
    if (!(await chrome.isMinimized(page).catch(() => true))) {
      await chrome.minimize(page).catch(() => {})
    }
  }

  const removeTab = (session: Session, tabId: string) => {
    const tab = session.tabs.get(tabId)
    if (!tab) {
      return
    }
    session.tabs.delete(tabId)
    void tab.cdp?.detach().catch(() => {})
    if (session.activeTabId === tabId) {
      session.activeTabId = [...session.tabs.keys()].at(-1) ?? ''
    }
  }

  const adoptPage = (session: Session, page: Page): Tab => {
    const tab: Tab = { id: `tab_${session.nextTabNumber++}`, page, refs: createRefRegistry(), cdp: null }
    session.tabs.set(tab.id, tab)
    session.activeTabId = tab.id
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        tab.refs.reset()
      }
    })
    page.on('filechooser', () => {
      if (!session.expectingFileChooser) {
        session.notes.push('A file chooser opened. Use file_upload on this element to pick files.')
      }
    })
    page.on('dialog', dialog => {
      const accept = dialog.type() === 'alert' || dialog.type() === 'beforeunload'
      session.notes.push(`A ${dialog.type()} dialog was ${accept ? 'accepted' : 'dismissed'}: "${dialog.message()}"`)
      void (accept ? dialog.accept() : dialog.dismiss()).catch(() => {})
    })
    page.on('close', () => {
      if (current === session) {
        removeTab(session, tab.id)
      }
    })
    return tab
  }

  const watchContext = (context: BrowserContext) => {
    if (watchedContexts.has(context)) {
      return
    }
    watchedContexts.add(context)
    context.on('page', async page => {
      const opener = await page.opener().catch(() => null)
      const session = current
      if (!session || !opener || ![...session.tabs.values()].some(tab => tab.page === opener)) {
        return
      }
      adoptPage(session, page)
      session.notes.push('A new tab opened and is now active.')
      await keepHidden(session, page)
    })
  }

  chrome.onContext(watchContext)

  const ensureAnchorPage = async (context: BrowserContext) => {
    if (context.pages().length === 0) {
      await context.newPage()
    }
  }

  const openTab = async (session: Session, url?: string): Promise<Tab> => {
    const context = await chrome.ensure()
    const page = await context.newPage()
    const tab = adoptPage(session, page)
    await keepHidden(session, page)
    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    }
    return tab
  }

  const create = async (): Promise<Session> => {
    if (current || creating) {
      throw new SessionBusyError('busy')
    }
    creating = (async () => {
      const context = await chrome.ensure()
      await ensureAnchorPage(context)
      const session: Session = {
        id: crypto.randomUUID(),
        tabs: new Map(),
        activeTabId: '',
        lastUsedAt: Date.now(),
        shown: false,
        notes: [],
        expectingFileChooser: false,
        nextTabNumber: 1,
        caffeinate: Bun.spawn(['caffeinate', '-i', '-w', String(process.pid)], { stdout: 'ignore', stderr: 'ignore' }),
      }
      current = session
      try {
        const tab = await openTab(session)
        await chrome.fitViewport(tab.page)
        await chrome.minimize(tab.page)
      } catch (err) {
        await release(session.id)
        throw err
      }
      return session
    })().finally(() => {
      creating = null
    })
    return creating
  }

  const get = (id: string): Session | null => {
    if (current?.id !== id) {
      return null
    }
    current.lastUsedAt = Date.now()
    return current
  }

  const release = async (id: string) => {
    const session = current
    if (!session || session.id !== id) {
      return
    }
    current = null
    session.caffeinate?.kill()
    const pages = [...session.tabs.values()].map(tab => tab.page)
    session.tabs.clear()
    const anchor = pages[0]
      ?.context()
      .pages()
      .find(page => !pages.includes(page))
    await Promise.all(pages.map(page => page.close({ runBeforeUnload: false }).catch(() => {})))
    if (anchor) {
      await chrome.minimize(anchor).catch(() => {})
    }
    await uploads.release(session.id).catch(() => {})
  }

  const expireIdle = async () => {
    if (current && Date.now() - current.lastUsedAt > SESSION_IDLE_MS) {
      await release(current.id)
    }
  }

  const busySessionId = (): string | null => current?.id ?? null

  return { create, get, release, expireIdle, busySessionId, openTab, removeTab, keepHidden }
}

export type SessionManager = ReturnType<typeof createSessionManager>

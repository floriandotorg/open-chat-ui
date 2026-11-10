import { existsSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BROWSER_VIEWPORT } from '#lib/browser-protocol.ts'
import { installNetworkGuard } from './network-guard'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core'

const LAUNCH_TIMEOUT_MS = 20_000
const ATTACH_TIMEOUT_MS = 3_000
const RESIZE_ATTEMPTS = 4
const RESIZE_SETTLE_MS = 300

const CHROMIUM_FLAGS = [
  '--remote-debugging-port=0',
  '--remote-debugging-address=127.0.0.1',
  // Without the mock keychain, cookie loading waits on a macOS Keychain prompt and no page ever loads.
  '--use-mock-keychain',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--no-first-run',
  '--no-default-browser-check',
  '--mute-audio',
]

export interface ChromiumInstall {
  version: string
  appPath: string
  binaryPath: string
}

const compareVersions = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })

export const findChromiumInstall = (dataDir: string): ChromiumInstall | null => {
  const root = join(dataDir, 'chromium')
  if (!existsSync(root)) {
    return null
  }
  const versions = readdirSync(root)
    .filter(version => existsSync(join(root, version, 'Chromium.app', 'Contents', 'MacOS', 'Chromium')))
    .sort(compareVersions)
  const version = versions.at(-1)
  if (!version) {
    return null
  }
  const appPath = join(root, version, 'Chromium.app')
  return { version, appPath, binaryPath: join(appPath, 'Contents', 'MacOS', 'Chromium') }
}

const readDevToolsPort = async (profileDir: string): Promise<number | null> => {
  const file = Bun.file(join(profileDir, 'DevToolsActivePort'))
  if (!(await file.exists())) {
    return null
  }
  const port = Number.parseInt((await file.text()).split('\n')[0] ?? '', 10)
  return Number.isFinite(port) && port > 0 ? port : null
}

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms)
    }),
  ])

export const createChrome = (install: ChromiumInstall, profileDir: string) => {
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let connecting: Promise<BrowserContext> | null = null
  const contextListeners: ((context: BrowserContext) => void)[] = []

  const attach = async (port: number): Promise<BrowserContext> => {
    const connected = await withTimeout(chromium.connectOverCDP(`http://127.0.0.1:${port}`), ATTACH_TIMEOUT_MS * 3, 'Timed out connecting to Chromium')
    const defaultContext = connected.contexts()[0]
    if (!defaultContext) {
      await connected.close().catch(() => {})
      throw new Error('Chromium has no default context')
    }
    const browserSession = await connected.newBrowserCDPSession()
    await browserSession.send('Browser.setDownloadBehavior', { behavior: 'deny' })
    await installNetworkGuard(defaultContext)
    connected.on('disconnected', () => {
      if (browser === connected) {
        browser = null
        context = null
      }
    })
    browser = connected
    context = defaultContext
    for (const listener of contextListeners) {
      listener(defaultContext)
    }
    return defaultContext
  }

  const tryExisting = async (): Promise<BrowserContext | null> => {
    const port = await readDevToolsPort(profileDir)
    if (!port) {
      return null
    }
    try {
      const response = await withTimeout(fetch(`http://127.0.0.1:${port}/json/version`), ATTACH_TIMEOUT_MS, 'timeout')
      if (!response.ok) {
        return null
      }
      return await attach(port)
    } catch {
      return null
    }
  }

  const launch = async (): Promise<BrowserContext> => {
    await rm(join(profileDir, 'DevToolsActivePort'), { force: true })
    const proc = Bun.spawn([install.binaryPath, `--user-data-dir=${profileDir}`, ...CHROMIUM_FLAGS, 'about:blank'], { stdout: 'ignore', stderr: 'ignore' })
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS
    while (Date.now() < deadline) {
      const port = await readDevToolsPort(profileDir)
      if (port) {
        return attach(port)
      }
      if (proc.exitCode !== null) {
        throw new Error('Chromium exited during startup. Is another Chromium using the agent profile?')
      }
      await Bun.sleep(200)
    }
    proc.kill()
    throw new Error('Chromium did not start in time')
  }

  const ensure = async (): Promise<BrowserContext> => {
    if (context && browser?.isConnected()) {
      return context
    }
    if (!connecting) {
      connecting = (async () => (await tryExisting()) ?? (await launch()))().finally(() => {
        connecting = null
      })
    }
    return connecting
  }

  const windowOf = async (page: Page) => {
    const session = await page.context().newCDPSession(page)
    try {
      const { windowId, bounds } = await session.send('Browser.getWindowForTarget')
      return { windowId, state: bounds.windowState ?? 'normal', session }
    } catch (err) {
      await session.detach().catch(() => {})
      throw err
    }
  }

  const setWindowState = async (page: Page, windowState: 'normal' | 'minimized') => {
    const { windowId, state, session } = await windowOf(page)
    try {
      if (state !== windowState) {
        await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState } })
      }
    } finally {
      await session.detach().catch(() => {})
    }
  }

  const minimize = (page: Page) => setWindowState(page, 'minimized')

  const show = async (page: Page) => {
    await setWindowState(page, 'normal')
    await page.bringToFront()
    Bun.spawn(['open', '-a', install.appPath], { stdout: 'ignore', stderr: 'ignore' })
  }

  const isMinimized = async (page: Page): Promise<boolean> => {
    const { state, session } = await windowOf(page)
    await session.detach().catch(() => {})
    return state === 'minimized'
  }

  const viewportMatches = async (page: Page): Promise<boolean> => {
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    return size.width === BROWSER_VIEWPORT.width && size.height === BROWSER_VIEWPORT.height
  }

  const fitViewport = async (page: Page) => {
    if (await viewportMatches(page)) {
      return
    }
    const { windowId, session } = await windowOf(page)
    try {
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
      for (let n = 0; n < RESIZE_ATTEMPTS; ++n) {
        await Bun.sleep(RESIZE_SETTLE_MS)
        const frame = await page.evaluate(() => ({ width: outerWidth - innerWidth, height: outerHeight - innerHeight }))
        await session.send('Browser.setWindowBounds', { windowId, bounds: { width: BROWSER_VIEWPORT.width + frame.width, height: BROWSER_VIEWPORT.height + frame.height } })
        await Bun.sleep(RESIZE_SETTLE_MS)
        if (await viewportMatches(page)) {
          return
        }
      }
    } finally {
      await session.detach().catch(() => {})
    }
  }

  const onContext = (listener: (context: BrowserContext) => void) => {
    contextListeners.push(listener)
  }

  const isConnected = (): boolean => !!browser?.isConnected()

  return { install, ensure, minimize, show, isMinimized, fitViewport, onContext, isConnected }
}

export type Chrome = ReturnType<typeof createChrome>

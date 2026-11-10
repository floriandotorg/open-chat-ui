import { createHash, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import type { BrowserActionOutcome, BrowserActionResult, BrowserActionsResponse, BrowserHostHealth, BrowserSessionResponse } from '#lib/browser-protocol.ts'
import { captureJpeg, dispatchLiveInput, runAction, selectTab } from './actions'
import { createChrome, findChromiumInstall } from './chrome'
import { dataDir, findBindAddress, loadConfig } from './config'
import { activeTab, buildState, createSessionManager, type Session, SessionBusyError, takeNotes } from './session'
import { createUploadStore, isValidFileId, MAX_UPLOAD_BYTES } from './uploads'
import { parseActionsRequest, parseLiveInput, RequestError } from './validate'

const BIND_RETRY_MS = 10_000
const EXPIRY_CHECK_MS = 30_000

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
const fail = (status: number, error: string) => json({ error }, status)

const digest = (value: string) => createHash('sha256').update(value).digest()

const isAuthorized = (request: Request, token: string): boolean => {
  const header = request.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  return presented.length > 0 && timingSafeEqual(digest(presented), digest(token))
}

const withNotes = (outcome: BrowserActionOutcome, notes: string[]): BrowserActionOutcome => {
  if (!notes.length) {
    return outcome
  }
  if (outcome.ok) {
    return { ...outcome, text: [outcome.text, ...notes].filter(Boolean).join('\n') }
  }
  return { ...outcome, error: [outcome.error, ...notes].join('\n') }
}

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    throw new RequestError('Body must be JSON')
  }
}

const start = async () => {
  const config = await loadConfig()
  const install = findChromiumInstall(dataDir)
  if (!install) {
    throw new Error(`No Chromium found in ${join(dataDir, 'chromium')}. Run bun run browser-host:install first.`)
  }
  const chrome = createChrome(install, join(dataDir, 'profile'))
  const uploads = createUploadStore(join(dataDir, 'uploads'))
  await uploads.clearAll()
  const sessions = createSessionManager(chrome, uploads)
  setInterval(() => {
    void sessions.expireIdle()
  }, EXPIRY_CHECK_MS)

  const handleSession = async (request: Request, session: Session, rest: string[]): Promise<Response> => {
    const [action, fileId] = rest
    const context = { session, sessions, chrome, uploads }
    if (request.method === 'DELETE' && rest.length === 0) {
      await sessions.release(session.id)
      return json({ ok: true })
    }
    if (request.method === 'POST' && action === 'actions') {
      const body = parseActionsRequest(await readJson(request))
      const results: BrowserActionResult[] = []
      if (body.tabId && body.tabId !== session.activeTabId) {
        const selected = await selectTab(context, body.tabId).then(
          () => null,
          (err: unknown) => (err instanceof Error ? err.message : String(err)),
        )
        if (selected) {
          return json({ results: [{ ok: false, error: selected, state: await buildState(session) }] } satisfies BrowserActionsResponse)
        }
      }
      for (const entry of body.actions) {
        const outcome = withNotes(await runAction(context, entry), takeNotes(session))
        session.lastUsedAt = Date.now()
        results.push({ ...outcome, state: await buildState(session) })
        if (!outcome.ok) {
          break
        }
      }
      return json({ results } satisfies BrowserActionsResponse)
    }
    if (request.method === 'POST' && action === 'show') {
      session.shown = true
      await chrome.show(activeTab(session).page)
      return json({ ok: true })
    }
    if (request.method === 'POST' && action === 'hide') {
      session.shown = false
      await chrome.minimize(activeTab(session).page)
      return json({ ok: true })
    }
    if (request.method === 'GET' && action === 'frame') {
      const frame = await captureJpeg(activeTab(session).page, 60)
      return new Response(new Uint8Array(frame), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } })
    }
    if (request.method === 'POST' && action === 'input') {
      await dispatchLiveInput(activeTab(session).page, parseLiveInput(await readJson(request)))
      return json({ ok: true })
    }
    if (request.method === 'PUT' && action === 'files' && fileId && rest.length === 2) {
      if (!isValidFileId(fileId)) {
        return fail(400, 'Invalid file id')
      }
      const data = await request.arrayBuffer()
      if (data.byteLength > MAX_UPLOAD_BYTES) {
        return fail(413, 'File too large')
      }
      return json(await uploads.stage(session.id, fileId, new URL(request.url).searchParams.get('name'), data))
    }
    return fail(404, 'Not found')
  }

  const handle = async (request: Request): Promise<Response> => {
    if (!isAuthorized(request, config.token)) {
      return fail(401, 'Unauthorized')
    }
    const segments = new URL(request.url).pathname.split('/').filter(Boolean)
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'health') {
      return json({ version: install.version, browserRunning: chrome.isConnected(), busySessionId: sessions.busySessionId() } satisfies BrowserHostHealth)
    }
    if (segments[0] !== 'sessions') {
      return fail(404, 'Not found')
    }
    if (request.method === 'POST' && segments.length === 1) {
      try {
        const session = await sessions.create()
        return json({ sessionId: session.id, state: await buildState(session) } satisfies BrowserSessionResponse)
      } catch (err) {
        if (err instanceof SessionBusyError) {
          return fail(409, 'busy')
        }
        throw err
      }
    }
    const session = segments[1] ? sessions.get(segments[1]) : null
    if (!session) {
      return fail(404, 'Unknown session')
    }
    return handleSession(request, session, segments.slice(2))
  }

  let hostname = findBindAddress()
  while (!hostname) {
    console.log('Waiting for a Tailscale address...')
    await Bun.sleep(BIND_RETRY_MS)
    hostname = findBindAddress()
  }

  Bun.serve({
    hostname,
    port: config.port,
    maxRequestBodySize: MAX_UPLOAD_BYTES + 1024 * 1024,
    idleTimeout: 120,
    fetch: async request => {
      try {
        return await handle(request)
      } catch (err) {
        if (err instanceof RequestError) {
          return fail(400, err.message)
        }
        console.error(err)
        return fail(500, err instanceof Error ? err.message : 'Internal error')
      }
    },
  })
  console.log(`Browser host listening on http://${hostname}:${config.port} (Chromium ${install.version})`)
}

if (import.meta.main) {
  await start()
}

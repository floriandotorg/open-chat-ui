import type { BrowserAction, BrowserActionOutcome, BrowserImage, BrowserLiveInput, BrowserPoint, BrowserTarget } from '#lib/browser-protocol.ts'
import { type AxNode, findNodes, MAX_READ_CHARS, renderAxTree } from './accessibility'
import type { Chrome } from './chrome'
import { credentialsFor } from './credentials'
import { parseKeyChord, splitKeySequence, toPlaywrightModifier } from './keys'
import { isAllowedNavigationUrl } from './network-guard'
import type { ProtonPass } from './proton-pass'
import { activeTab, cdpFor, type Session, type SessionManager, type Tab } from './session'
import type { UploadStore } from './uploads'
import type { Frame, Page, Request } from 'playwright-core'

const NAVIGATION_TIMEOUT_MS = 30_000
const LOAD_GRACE_MS = 5_000
const SETTLE_MS = 250
const COMMIT_TIMEOUT_MS = 15_000
const MAX_WAIT_MS = 30_000
const MAX_HOLD_MS = 30_000
const MAX_KEY_REPEAT = 100
const SHORT_TEXT_LENGTH = 200
const FILE_CHOOSER_TIMEOUT_MS = 5_000

export interface ActionContext {
  session: Session
  sessions: SessionManager
  chrome: Chrome
  uploads: UploadStore
  protonPass?: ProtonPass
}

class ActionError extends Error {}

const staleRef = (ref: string) => new ActionError(`Unknown or stale ref ${ref}. Call read_page again.`)

const errorMessage = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err)
  return message.split('\n')[0] ?? message
}

const toImage = (buffer: Buffer, mediaType: BrowserImage['mediaType']): BrowserImage => ({ base64: buffer.toString('base64'), mediaType })

const secretMasks = (page: Page) => page.frames().map(frame => frame.locator('[data-open-chat-secret], input[type="password"]'))

export const captureJpeg = async (page: Page, quality: number): Promise<Buffer> => page.screenshot({ type: 'jpeg', quality, scale: 'css', mask: secretMasks(page), timeout: 10_000 })

const SETTLING_ACTIONS = new Set<BrowserAction['type']>(['click', 'drag', 'mouse', 'key', 'file_upload', 'form_input', 'credential_fill'])

const watchNavigation = (page: Page) => {
  let requested = false
  let committed = false
  const onRequest = (request: Request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      requested = true
    }
  }
  const onNavigated = (frame: Frame) => {
    if (frame === page.mainFrame()) {
      committed = true
    }
  }
  page.on('request', onRequest)
  page.on('framenavigated', onNavigated)
  return async () => {
    await Bun.sleep(SETTLE_MS)
    try {
      if (requested && !committed) {
        await page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame(), timeout: COMMIT_TIMEOUT_MS }).catch(() => {})
      }
      if (requested || committed) {
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {})
      }
    } finally {
      page.off('request', onRequest)
      page.off('framenavigated', onNavigated)
    }
  }
}

const refPoint = async (tab: Tab, ref: string): Promise<BrowserPoint> => {
  const backendNodeId = tab.refs.resolve(ref)
  if (backendNodeId === undefined) {
    throw staleRef(ref)
  }
  const cdp = await cdpFor(tab)
  try {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId })
    const { quads } = await cdp.send('DOM.getContentQuads', { backendNodeId })
    const quad = quads[0]
    if (!quad || quad.length < 8) {
      throw new ActionError(`Element ${ref} is not visible on the page.`)
    }
    return { x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4 }
  } catch (err) {
    if (err instanceof ActionError) {
      throw err
    }
    throw staleRef(ref)
  }
}

const resolvePoint = async (tab: Tab, target: BrowserTarget): Promise<BrowserPoint> => ('ref' in target ? refPoint(tab, target.ref) : target)

const resolveObjectId = async (tab: Tab, ref: string): Promise<string> => {
  const backendNodeId = tab.refs.resolve(ref)
  if (backendNodeId === undefined) {
    throw staleRef(ref)
  }
  const cdp = await cdpFor(tab)
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId }).catch(() => {
    throw staleRef(ref)
  })
  if (!object.objectId) {
    throw staleRef(ref)
  }
  return object.objectId
}

const readTree = async (tab: Tab): Promise<AxNode[]> => {
  const cdp = await cdpFor(tab)
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  return nodes
}

const FORM_INPUT_FUNCTION = `function (value) {
  const el = this
  const fire = () => {
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  if (el instanceof HTMLSelectElement) {
    const wanted = String(value).trim().toLowerCase()
    const options = Array.from(el.options)
    const option = options.find(o => o.value === String(value)) || options.find(o => o.text.trim().toLowerCase() === wanted)
    if (!option) {
      return { ok: false, text: 'No option matches "' + value + '". Options: ' + options.map(o => o.text.trim()).join(', ') }
    }
    el.value = option.value
    fire()
    return { ok: true, text: 'Selected "' + option.text.trim() + '".' }
  }
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    const wanted = value === true || value === 'true' || value === 1
    if (el.checked !== wanted) {
      el.click()
    }
    return { ok: true, text: (el.checked ? 'Checked' : 'Unchecked') + '.' }
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
    if (setter) {
      setter.call(el, String(value))
    } else {
      el.value = String(value)
    }
    fire()
    return { ok: true, text: 'Set value.' }
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus()
    el.textContent = String(value)
    fire()
    return { ok: true, text: 'Set text.' }
  }
  return { ok: false, text: 'Element is not a form field. Use click and type instead.' }
}`

const PAGE_TEXT_EXPRESSION = `(() => {
  const root = document.querySelector('main') || document.querySelector('article') || document.body || document.documentElement
  return root ? root.innerText : ''
})()`

const FILE_INPUT_FUNCTION = `function () {
  const isFile = el => el instanceof HTMLInputElement && el.type === 'file'
  if (isFile(this)) return this
  if (this instanceof HTMLLabelElement && isFile(this.control)) return this.control
  if (this.querySelector) {
    const inner = this.querySelector('input[type=file]')
    if (inner) return inner
  }
  return null
}`

const formInput = async (tab: Tab, ref: string, value: string | number | boolean): Promise<string> => {
  const objectId = await resolveObjectId(tab, ref)
  const cdp = await cdpFor(tab)
  const { result, exceptionDetails } = await cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: FORM_INPUT_FUNCTION, arguments: [{ value }], returnByValue: true })
  if (exceptionDetails) {
    throw new ActionError(`form_input failed: ${exceptionDetails.text}`)
  }
  const outcome: unknown = result.value
  if (typeof outcome !== 'object' || outcome === null || !('ok' in outcome) || !('text' in outcome) || typeof outcome.text !== 'string') {
    throw new ActionError('form_input returned no result')
  }
  if (outcome.ok !== true) {
    throw new ActionError(outcome.text)
  }
  return outcome.text
}

const fillSecret = async (tab: Tab, target: BrowserTarget, value: string) => {
  if ('ref' in target) {
    const objectId = await resolveObjectId(tab, target.ref)
    const cdp = await cdpFor(tab)
    const { result, exceptionDetails } = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function (value) {
        if (!(this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) || this.disabled || this.readOnly) {
          return false
        }
        if (this instanceof HTMLInputElement && !['text', 'email', 'password', 'tel', 'url', 'search', 'number'].includes(this.type)) {
          return false
        }
        this.setAttribute('data-open-chat-secret', '')
        this.focus()
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value')?.set
        if (!setter) {
          return false
        }
        setter.call(this, value)
        this.dispatchEvent(new Event('input', { bubbles: true }))
        this.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }`,
      arguments: [{ value }],
      returnByValue: true,
    })
    if (exceptionDetails || result.value !== true) {
      throw new ActionError('Select an editable input for credential filling.')
    }
    return
  }
  await tab.page.mouse.click(target.x, target.y)
  for (const frame of tab.page.frames()) {
    const field = frame.locator('input:focus, textarea:focus')
    if ((await field.count()) === 1) {
      await field.evaluate(element => element.setAttribute('data-open-chat-secret', ''))
      await field.fill(value, { timeout: 5_000 })
      return
    }
  }
  throw new ActionError('Select an editable input for credential filling.')
}

const fileInputObjectId = async (tab: Tab, ref: string): Promise<string | null> => {
  const objectId = await resolveObjectId(tab, ref)
  const cdp = await cdpFor(tab)
  const { result } = await cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: FILE_INPUT_FUNCTION })
  return result.subtype === 'node' && result.objectId ? result.objectId : null
}

const uploadFiles = async (context: ActionContext, tab: Tab, target: BrowserTarget, fileIds: string[]): Promise<string> => {
  if (!fileIds.length) {
    throw new ActionError('file_upload needs at least one file id.')
  }
  const resolved = context.uploads.resolve(context.session.id, fileIds)
  if ('missing' in resolved) {
    throw new ActionError(`Unknown file ids: ${resolved.missing.join(', ')}. Only staged attachments can be uploaded.`)
  }
  const summary = `Uploaded ${resolved.names.length} file${resolved.names.length === 1 ? '' : 's'}: ${resolved.names.join(', ')}`
  if ('ref' in target) {
    const objectId = await fileInputObjectId(tab, target.ref)
    if (objectId) {
      const cdp = await cdpFor(tab)
      await cdp.send('DOM.setFileInputFiles', { files: resolved.paths, objectId })
      return summary
    }
  }
  const point = await resolvePoint(tab, target)
  context.session.expectingFileChooser = true
  try {
    const chooser = tab.page.waitForEvent('filechooser', { timeout: FILE_CHOOSER_TIMEOUT_MS })
    await tab.page.mouse.click(point.x, point.y)
    const fileChooser = await chooser.catch(() => {
      throw new ActionError('No file chooser opened. Use read_page to find the file input and pass its ref.')
    })
    if (!fileChooser.isMultiple() && resolved.paths.length > 1) {
      throw new ActionError('This file input accepts a single file. Upload one file at a time.')
    }
    await fileChooser.setFiles(resolved.paths)
  } finally {
    context.session.expectingFileChooser = false
  }
  return summary
}

const withModifiers = async (page: Page, modifiers: string[], run: () => Promise<void>) => {
  for (const modifier of modifiers) {
    await page.keyboard.down(modifier)
  }
  try {
    await run()
  } finally {
    for (const modifier of [...modifiers].reverse()) {
      await page.keyboard.up(modifier)
    }
  }
}

const pressKeys = async (page: Page, keys: string[], repeat: number, holdMs: number | undefined) => {
  const chords = splitKeySequence(keys).map(chord => {
    try {
      return parseKeyChord(chord)
    } catch (err) {
      throw new ActionError(errorMessage(err))
    }
  })
  if (!chords.length) {
    throw new ActionError('No keys given.')
  }
  for (let n = 0; n < repeat; ++n) {
    for (const chord of chords) {
      if (holdMs !== undefined) {
        const parts = chord === '+' ? ['+'] : chord.split('+')
        for (const part of parts) {
          await page.keyboard.down(part)
        }
        await Bun.sleep(Math.min(Math.max(holdMs, 0), MAX_HOLD_MS))
        for (const part of [...parts].reverse()) {
          await page.keyboard.up(part)
        }
      } else {
        await page.keyboard.press(chord)
      }
    }
  }
}

const switchTab = async (context: ActionContext, tabId: string): Promise<Tab> => {
  const tab = context.session.tabs.get(tabId)
  if (!tab) {
    throw new ActionError(`Unknown tab ${tabId}. Use tab_list to see open tabs.`)
  }
  context.session.activeTabId = tab.id
  await tab.page.bringToFront()
  await context.sessions.keepHidden(context.session, tab.page)
  return tab
}

export const selectTab = async (context: ActionContext, tabId: string) => {
  await switchTab(context, tabId)
}

const tabListText = (session: Session): string => [...session.tabs.values()].map(tab => `${tab.id}${tab.id === session.activeTabId ? ' (active)' : ''}: ${tab.page.url()}`).join('\n')

const execute = async (context: ActionContext, action: BrowserAction): Promise<BrowserActionOutcome> => {
  const tab = activeTab(context.session)
  const page = tab.page
  switch (action.type) {
    case 'navigate': {
      if (!isAllowedNavigationUrl(action.url)) {
        throw new ActionError('Only http and https URLs can be opened.')
      }
      const response = await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }).catch(err => {
        throw new ActionError(`Navigation failed: ${errorMessage(err)}`)
      })
      await page.waitForLoadState('load', { timeout: LOAD_GRACE_MS }).catch(() => {})
      return { ok: true, text: await page.title().catch(() => ''), ...(response ? { status: response.status() } : {}) }
    }
    case 'history': {
      const options = { waitUntil: 'commit' as const, timeout: NAVIGATION_TIMEOUT_MS }
      const before = page.url()
      const response = action.direction === 'back' ? await page.goBack(options) : action.direction === 'forward' ? await page.goForward(options) : await page.reload(options)
      if (!response && action.direction !== 'reload' && page.url() === before) {
        return { ok: true, text: `No ${action.direction} history entry.` }
      }
      await page.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {})
      await page.waitForLoadState('load', { timeout: LOAD_GRACE_MS }).catch(() => {})
      return { ok: true, ...(response ? { status: response.status() } : {}) }
    }
    case 'screenshot':
      return { ok: true, image: toImage(await captureJpeg(page, 80), 'image/jpeg') }
    case 'zoom': {
      const [x0, y0, x1, y1] = action.region
      if (x1 <= x0 || y1 <= y0) {
        throw new ActionError('zoom region must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0.')
      }
      const buffer = await page.screenshot({ type: 'jpeg', quality: 90, scale: 'device', mask: secretMasks(page), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, timeout: 10_000 })
      return { ok: true, image: toImage(buffer, 'image/jpeg') }
    }
    case 'click': {
      const point = await resolvePoint(tab, action.target)
      await withModifiers(page, (action.modifiers ?? []).map(toPlaywrightModifier), () => page.mouse.click(point.x, point.y, { button: action.button, clickCount: action.count }))
      return { ok: true }
    }
    case 'hover': {
      const point = await resolvePoint(tab, action.target)
      await page.mouse.move(point.x, point.y)
      return { ok: true }
    }
    case 'drag': {
      const [first, ...rest] = action.path
      await page.mouse.move(first.x, first.y)
      await page.mouse.down()
      for (const point of rest) {
        await page.mouse.move(point.x, point.y, { steps: 8 })
      }
      await page.mouse.up()
      return { ok: true }
    }
    case 'mouse': {
      await page.mouse.move(action.x, action.y)
      if (action.event === 'down') {
        await page.mouse.down()
      } else if (action.event === 'up') {
        await page.mouse.up()
      }
      return { ok: true }
    }
    case 'scroll':
      await page.mouse.move(action.x, action.y)
      await page.mouse.wheel(action.deltaX, action.deltaY)
      await Bun.sleep(300)
      return { ok: true }
    case 'scroll_to':
      await refPoint(tab, action.ref)
      return { ok: true }
    case 'type':
      if (action.text.length > SHORT_TEXT_LENGTH) {
        await page.keyboard.insertText(action.text)
      } else {
        await page.keyboard.type(action.text, { delay: 12 })
      }
      return { ok: true }
    case 'key':
      await pressKeys(page, action.keys, Math.min(Math.max(Math.floor(action.repeat ?? 1), 1), MAX_KEY_REPEAT), action.holdMs)
      return { ok: true }
    case 'wait':
      await Bun.sleep(Math.min(Math.max(action.ms, 0), MAX_WAIT_MS))
      return { ok: true }
    case 'read_page': {
      const nodes = await readTree(tab)
      try {
        return { ok: true, text: renderAxTree(nodes, { filter: action.filter, refs: tab.refs, ...(action.depth !== undefined ? { depth: action.depth } : {}), ...(action.ref ? { rootRef: action.ref } : {}) }) }
      } catch (err) {
        throw new ActionError(errorMessage(err))
      }
    }
    case 'find':
      return { ok: true, text: findNodes(await readTree(tab), action.query, tab.refs) }
    case 'page_text': {
      const evaluated: unknown = await page.evaluate(PAGE_TEXT_EXPRESSION)
      const content = typeof evaluated === 'string' ? evaluated : ''
      const header = `Title: ${await page.title().catch(() => '')}\nURL: ${page.url()}\n\n`
      const body = content.length > MAX_READ_CHARS ? `${content.slice(0, MAX_READ_CHARS)}\n[Truncated at ${MAX_READ_CHARS} characters.]` : content
      return { ok: true, text: header + body }
    }
    case 'credential_list': {
      if (!context.protonPass) {
        throw new ActionError('Proton Pass is not configured on the browser host.')
      }
      return { ok: true, text: JSON.stringify(await credentialsFor(context.session).list(context.protonPass, action.query)) }
    }
    case 'credential_fill': {
      if (!context.protonPass) {
        throw new ActionError('Proton Pass is not configured on the browser host.')
      }
      await credentialsFor(context.session).fill(context.protonPass, action.credentialId, action.field, value => fillSecret(tab, action.target, value))
      return { ok: true, text: 'Credential field filled. Its value is not returned. Continue the login normally.' }
    }
    case 'form_input':
      return { ok: true, text: await formInput(tab, action.ref, action.value) }
    case 'file_upload':
      return { ok: true, text: await uploadFiles(context, tab, action.target, action.fileIds) }
    case 'tab_new': {
      if (action.url && !isAllowedNavigationUrl(action.url)) {
        throw new ActionError('Only http and https URLs can be opened.')
      }
      const created = await context.sessions.openTab(context.session, action.url)
      return { ok: true, text: `Opened ${created.id}.` }
    }
    case 'tab_switch': {
      const switched = await switchTab(context, action.tabId)
      return { ok: true, text: `Switched to ${switched.id}.` }
    }
    case 'tab_close': {
      const closing = context.session.tabs.get(action.tabId)
      if (!closing) {
        throw new ActionError(`Unknown tab ${action.tabId}. Use tab_list to see open tabs.`)
      }
      if (context.session.tabs.size === 1) {
        await context.sessions.openTab(context.session)
      }
      context.sessions.removeTab(context.session, closing.id)
      await closing.page.close({ runBeforeUnload: false })
      await switchTab(context, context.session.activeTabId)
      return { ok: true, text: `Closed ${closing.id}.` }
    }
    case 'tab_list':
      return { ok: true, text: tabListText(context.session) }
  }
}

export const runAction = async (context: ActionContext, action: BrowserAction): Promise<BrowserActionOutcome> => {
  const settle = SETTLING_ACTIONS.has(action.type) && context.session.tabs.has(context.session.activeTabId) ? watchNavigation(activeTab(context.session).page) : null
  try {
    return credentialsFor(context.session).redactOutcome(await execute(context, action))
  } catch (err) {
    return credentialsFor(context.session).redactOutcome({ ok: false, error: errorMessage(err) })
  } finally {
    await settle?.()
  }
}

export const dispatchLiveInput = async (page: Page, input: BrowserLiveInput) => {
  switch (input.type) {
    case 'tap':
      await page.mouse.click(input.x, input.y)
      return
    case 'pointer':
      await page.mouse.move(input.x, input.y)
      if (input.event === 'down') {
        await page.mouse.down({ button: input.button ?? 'left' })
      } else if (input.event === 'up') {
        await page.mouse.up({ button: input.button ?? 'left' })
      }
      return
    case 'wheel':
      await page.mouse.move(input.x, input.y)
      await page.mouse.wheel(input.deltaX, input.deltaY)
      return
    case 'key':
      await page.keyboard.press(parseKeyChord(input.key))
      return
    case 'text':
      await page.keyboard.insertText(input.text)
      return
  }
}

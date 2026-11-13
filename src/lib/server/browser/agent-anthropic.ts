import type { BrowserAction, BrowserActionResult, BrowserTarget } from '#lib/browser-protocol.ts'
import { type BrowserAgent, budgetExhausted, buildAgentSystemPrompt, buildTaskMessage, parseModifiers, REQUEST_USER_DESCRIPTION, REQUEST_USER_PARAMETERS, readUserRequest } from '#lib/server/browser/agent.ts'
import type { TaskSession } from '#lib/server/browser/task-session.ts'
import { CREDENTIAL_TOOLS, runCredentialTool } from './agent-credentials'
import Anthropic from '@anthropic-ai/sdk'
import { BetaAbstractBrowserToolset20260801, type BetaBrowserNavigateResult, type BetaBrowserState, type BetaScreenshotResult, type BetaToolsetCallContext, ToolError } from '@anthropic-ai/sdk/helpers/beta/toolsets'
import type {
  BetaAssistantMessageParam,
  BetaBrowserClickTarget,
  BetaBrowserCloseTabInput,
  BetaBrowserDoubleClickInput,
  BetaBrowserFileUploadInput,
  BetaBrowserFindInput,
  BetaBrowserFormInputInput,
  BetaBrowserGetPageTextInput,
  BetaBrowserHoldKeyInput,
  BetaBrowserHoverInput,
  BetaBrowserKeyInput,
  BetaBrowserLeftClickDragInput,
  BetaBrowserLeftClickInput,
  BetaBrowserLeftMouseDownInput,
  BetaBrowserLeftMouseUpInput,
  BetaBrowserListTabsInput,
  BetaBrowserMiddleClickInput,
  BetaBrowserMouseMoveInput,
  BetaBrowserNavigateInput,
  BetaBrowserNewTabInput,
  BetaBrowserReadPageInput,
  BetaBrowserRightClickInput,
  BetaBrowserScreenshotInput,
  BetaBrowserScrollInput,
  BetaBrowserScrollToInput,
  BetaBrowserStateTabEntry,
  BetaBrowserSwitchTabInput,
  BetaBrowserTripleClickInput,
  BetaBrowserTypeInput,
  BetaBrowserWaitInput,
  BetaBrowserZoomInput,
  BetaContentBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
  BetaUserMessageParam,
} from '@anthropic-ai/sdk/resources/beta'

type Ctx = BetaToolsetCallContext
type Turn = BetaUserMessageParam | BetaAssistantMessageParam
type OkResult = Extract<BrowserActionResult, { ok: true }>

const SCROLL_PIXELS_PER_NOTCH = 100
const KEEP_SCREENSHOTS = 3
const MAX_SCREENSHOTS = 8

const toTarget = (target: BetaBrowserClickTarget): BrowserTarget => (target.type === 'ref' ? { ref: target.ref } : { x: target.x, y: target.y })

const isRegion = (region: number[]): region is [number, number, number, number] => region.length === 4

const createStateReporter = (session: TaskSession) => {
  let reported = new Set<string>()
  return (): BetaBrowserState => {
    const state = session.state()
    const tabs: BetaBrowserStateTabEntry[] = state.tabs.map(tab => ({ tab_id: tab.id, title: tab.title, url: tab.url, active: tab.id === state.activeTabId }))
    const opened = reported.size ? state.tabs.filter(tab => !reported.has(tab.id)).map(tab => ({ type: 'tab_opened' as const, tab_id: tab.id })) : []
    reported = new Set(state.tabs.map(tab => tab.id))
    return { tabs, ...(opened.length ? { state_changes: opened } : {}) }
  }
}

export class HostBrowserToolset extends BetaAbstractBrowserToolset20260801 {
  readonly #session: TaskSession

  constructor(session: TaskSession) {
    const fileIds = new Set(session.files.map(file => file.id))
    super({
      browserState: createStateReporter(session),
      configs: { file_upload: { enabled: fileIds.size > 0 } },
      confirm: () => true,
      filePolicy: {
        resolveUploadPaths: () => {
          throw new ToolError('Upload by path is not available. Use document_ids with the ids of the attached files.')
        },
        resolveUploadDocuments: (_context, documentIds) => {
          const unknown = documentIds.filter(id => !fileIds.has(id))
          if (unknown.length) {
            throw new ToolError(`Unknown file ids: ${unknown.join(', ')}. Available: ${[...fileIds].join(', ') || 'none'}.`)
          }
          return documentIds
        },
        isPathVisible: () => false,
      },
    })
    this.#session = session
  }

  async #run(action: BrowserAction, tabId?: string | null): Promise<OkResult> {
    const [result] = await this.#session.act([action], tabId ?? undefined)
    if (!result) {
      throw new ToolError('The browser returned no result.')
    }
    if (!result.ok) {
      throw new ToolError(result.error)
    }
    return result
  }

  async #text(action: BrowserAction, tabId?: string | null): Promise<string> {
    return (await this.#run(action, tabId)).text ?? ''
  }

  async #image(action: BrowserAction, tabId?: string | null): Promise<BetaScreenshotResult> {
    const result = await this.#run(action, tabId)
    if (!result.image) {
      throw new ToolError('The browser returned no image.')
    }
    return { data: result.image.base64, mediaType: result.image.mediaType }
  }

  #click(input: { target: BetaBrowserClickTarget; modifiers?: string | null; tab_id?: string | null }, button: 'left' | 'right' | 'middle', count: 1 | 2 | 3) {
    const modifiers = parseModifiers(input.modifiers)
    return this.#text({ type: 'click', target: toTarget(input.target), button, count, ...(modifiers ? { modifiers } : {}) }, input.tab_id)
  }

  #tabEntry(tabId: string): BetaBrowserStateTabEntry {
    const state = this.#session.state()
    const tab = state.tabs.find(entry => entry.id === tabId)
    if (!tab) {
      throw new ToolError(`Unknown tab ${tabId}.`)
    }
    return { tab_id: tab.id, title: tab.title, url: tab.url, active: tab.id === state.activeTabId }
  }

  protected async navigate(_ctx: Ctx, input: BetaBrowserNavigateInput): Promise<BetaBrowserNavigateResult> {
    const action: BrowserAction = input.url === 'back' || input.url === 'forward' || input.url === 'reload' ? { type: 'history', direction: input.url } : { type: 'navigate', url: input.url }
    const result = await this.#run(action, input.tab_id)
    const title = result.state.tabs.find(tab => tab.id === result.state.activeTabId)?.title
    return { url: result.state.url, ...(result.status !== undefined ? { status: result.status } : {}), ...(title ? { title } : {}) }
  }

  protected screenshot(_ctx: Ctx, input: BetaBrowserScreenshotInput) {
    return this.#image({ type: 'screenshot' }, input.tab_id)
  }

  protected zoom(_ctx: Ctx, input: BetaBrowserZoomInput) {
    if (!isRegion(input.region)) {
      throw new ToolError('region must be [x0, y0, x1, y1].')
    }
    return this.#image({ type: 'zoom', region: input.region }, input.tab_id)
  }

  protected left_click(_ctx: Ctx, input: BetaBrowserLeftClickInput) {
    return this.#click(input, 'left', 1)
  }

  protected right_click(_ctx: Ctx, input: BetaBrowserRightClickInput) {
    return this.#click(input, 'right', 1)
  }

  protected middle_click(_ctx: Ctx, input: BetaBrowserMiddleClickInput) {
    return this.#click(input, 'middle', 1)
  }

  protected double_click(_ctx: Ctx, input: BetaBrowserDoubleClickInput) {
    return this.#click(input, 'left', 2)
  }

  protected triple_click(_ctx: Ctx, input: BetaBrowserTripleClickInput) {
    return this.#click(input, 'left', 3)
  }

  protected hover(_ctx: Ctx, input: BetaBrowserHoverInput) {
    return this.#text({ type: 'hover', target: toTarget(input.target) }, input.tab_id)
  }

  protected left_click_drag(_ctx: Ctx, input: BetaBrowserLeftClickDragInput) {
    return this.#text({ type: 'drag', path: [input.from, input.target] }, input.tab_id)
  }

  protected left_mouse_down(_ctx: Ctx, input: BetaBrowserLeftMouseDownInput) {
    const { x, y } = this.#pointer(input)
    return this.#text({ type: 'mouse', event: 'down', x, y }, input.tab_id)
  }

  protected left_mouse_up(_ctx: Ctx, input: BetaBrowserLeftMouseUpInput) {
    const { x, y } = this.#pointer(input)
    return this.#text({ type: 'mouse', event: 'up', x, y }, input.tab_id)
  }

  #lastPointer = { x: 0, y: 0 }

  #pointer(input: object): { x: number; y: number } {
    if ('target' in input && typeof input.target === 'object' && input.target !== null && 'x' in input.target && 'y' in input.target && typeof input.target.x === 'number' && typeof input.target.y === 'number') {
      this.#lastPointer = { x: input.target.x, y: input.target.y }
    }
    return this.#lastPointer
  }

  protected mouse_move(_ctx: Ctx, input: BetaBrowserMouseMoveInput) {
    const { x, y } = this.#pointer(input)
    return this.#text({ type: 'mouse', event: 'move', x, y }, input.tab_id)
  }

  protected scroll(_ctx: Ctx, input: BetaBrowserScrollInput) {
    const distance = Math.min(10, Math.max(1, input.scroll_amount ?? 3)) * SCROLL_PIXELS_PER_NOTCH
    const deltaX = input.scroll_direction === 'left' ? -distance : input.scroll_direction === 'right' ? distance : 0
    const deltaY = input.scroll_direction === 'up' ? -distance : input.scroll_direction === 'down' ? distance : 0
    this.#lastPointer = { x: input.target.x, y: input.target.y }
    return this.#text({ type: 'scroll', x: input.target.x, y: input.target.y, deltaX, deltaY }, input.tab_id)
  }

  protected scroll_to(_ctx: Ctx, input: BetaBrowserScrollToInput) {
    return this.#text({ type: 'scroll_to', ref: input.target.ref }, input.tab_id)
  }

  protected type_(_ctx: Ctx, input: BetaBrowserTypeInput) {
    return this.#text({ type: 'type', text: input.text }, input.tab_id)
  }

  protected key(_ctx: Ctx, input: BetaBrowserKeyInput) {
    return this.#text({ type: 'key', keys: input.text.split(/\s+/).filter(Boolean), ...(input.repeat ? { repeat: input.repeat } : {}) }, input.tab_id)
  }

  protected hold_key(_ctx: Ctx, input: BetaBrowserHoldKeyInput) {
    return this.#text({ type: 'key', keys: [input.text], holdMs: Math.min(30, Math.max(0, input.duration)) * 1000 }, input.tab_id)
  }

  protected form_input(_ctx: Ctx, input: BetaBrowserFormInputInput) {
    return this.#text({ type: 'form_input', ref: input.target.ref, value: input.value }, input.tab_id)
  }

  protected read_page(_ctx: Ctx, input: BetaBrowserReadPageInput) {
    return this.#text({ type: 'read_page', filter: input.filter ?? 'interactive', ...(input.depth ? { depth: input.depth } : {}), ...(input.ref ? { ref: input.ref } : {}) }, input.tab_id)
  }

  protected find(_ctx: Ctx, input: BetaBrowserFindInput) {
    return this.#text({ type: 'find', query: input.query }, input.tab_id)
  }

  protected get_page_text(_ctx: Ctx, input: BetaBrowserGetPageTextInput) {
    return this.#text({ type: 'page_text' }, input.tab_id)
  }

  protected wait(_ctx: Ctx, input: BetaBrowserWaitInput) {
    return this.#text({ type: 'wait', ms: Math.min(30, Math.max(0, input.duration)) * 1000 }, input.tab_id)
  }

  protected file_upload(_ctx: Ctx, input: BetaBrowserFileUploadInput) {
    return this.#text({ type: 'file_upload', target: { ref: input.target.ref }, fileIds: input.document_ids ?? [] }, input.tab_id)
  }

  protected async new_tab(_ctx: Ctx, _input: BetaBrowserNewTabInput) {
    const result = await this.#run({ type: 'tab_new' })
    return this.#tabEntry(result.state.activeTabId)
  }

  protected async list_tabs(_ctx: Ctx, _input: BetaBrowserListTabsInput) {
    const result = await this.#run({ type: 'tab_list' })
    return result.state.tabs.map(tab => this.#tabEntry(tab.id))
  }

  protected async switch_tab(_ctx: Ctx, input: BetaBrowserSwitchTabInput) {
    await this.#run({ type: 'tab_switch', tabId: input.tab_id })
    return this.#tabEntry(input.tab_id)
  }

  protected async close_tab(_ctx: Ctx, input: BetaBrowserCloseTabInput) {
    await this.#run({ type: 'tab_close', tabId: input.tab_id })
  }
}

const REQUEST_USER_TOOL: BetaTool = { name: 'request_user', description: REQUEST_USER_DESCRIPTION, input_schema: REQUEST_USER_PARAMETERS }

const NOT_EXECUTED = 'Not executed: an earlier action in this turn failed.'

const isImageBlock = (block: unknown): boolean => typeof block === 'object' && block !== null && 'type' in block && block.type === 'image'

export const pruneScreenshots = (messages: Turn[], { max = MAX_SCREENSHOTS, keep = KEEP_SCREENSHOTS } = {}): Turn[] => {
  let count = 0
  for (const message of messages) {
    if (typeof message.content === 'string') {
      continue
    }
    for (const block of message.content) {
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        count += block.content.filter(isImageBlock).length
      }
    }
  }
  if (count <= max) {
    return messages
  }
  let toRemove = count - keep
  return messages.map(message => {
    if (typeof message.content === 'string' || toRemove === 0) {
      return message
    }
    const content = message.content.map(block => {
      if (block.type !== 'tool_result' || !Array.isArray(block.content) || toRemove === 0) {
        return block
      }
      return {
        ...block,
        content: block.content.map(part => {
          if (toRemove > 0 && isImageBlock(part)) {
            --toRemove
            return { type: 'text' as const, text: '[older screenshot removed]' }
          }
          return part
        }),
      }
    })
    return { ...message, content }
  })
}

const withCacheBreakpoint = (messages: Turn[]): Turn[] => {
  const last = messages.at(-1)
  if (!last || typeof last.content === 'string' || last.content.length === 0) {
    return messages
  }
  const blocks = [...last.content]
  const tail = blocks[blocks.length - 1]
  if (tail.type === 'tool_result' || tail.type === 'text') {
    blocks[blocks.length - 1] = { ...tail, cache_control: { type: 'ephemeral' } }
  }
  return [...messages.slice(0, -1), { ...last, content: blocks }]
}

const answerTurn = async (toolset: HostBrowserToolset, session: TaskSession, toolUses: BetaToolUseBlock[]): Promise<BetaToolResultBlockParam[]> => {
  const results: BetaToolResultBlockParam[] = []
  let failed = false
  for (const toolUse of toolUses) {
    if (failed) {
      results.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: NOT_EXECUTED, ...(toolUse.toolset_name ? { toolset_name: toolUse.toolset_name } : {}) })
      continue
    }
    const credentialResult = !toolUse.toolset_name ? await runCredentialTool(session, toolUse.name, toolUse.input) : null
    if (credentialResult !== null) {
      results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: credentialResult })
      continue
    }
    if (toolUse.name === 'request_user' && !toolUse.toolset_name) {
      const request = readUserRequest(toolUse.input)
      const content = request ? (await session.askUser(request.kind, request.message)).message : 'Invalid input: kind must be login, captcha or confirm, and message must be non-empty.'
      results.push({ type: 'tool_result', tool_use_id: toolUse.id, content, ...(request ? {} : { is_error: true }) })
      continue
    }
    const result = await toolset.toolResult(toolUse)
    failed = result.is_error === true
    results.push(result)
  }
  return results
}

export const runAnthropicBrowserAgent: BrowserAgent = async ({ task, startUrl, model, apiKey, session, usage, signal }) => {
  const client = new Anthropic({ apiKey })
  const toolset = new HostBrowserToolset(session)
  const system = buildAgentSystemPrompt({
    files: session.files,
    readingHint: 'To read text, prefer get_page_text, find and read_page (refs from them can be clicked) over screenshots. Use screenshots to check layout and results.',
    uploadHint: 'use file_upload with document_ids on the file input or upload button',
  })
  let messages: Turn[] = [{ role: 'user', content: buildTaskMessage({ task, startUrl, currentUrl: session.state().url }) }]
  try {
    for (let turn = 0; ; ++turn) {
      const exhausted = budgetExhausted(session, turn)
      if (exhausted) {
        return exhausted
      }
      messages = pruneScreenshots(messages)
      const response = await client.beta.messages.create(
        {
          model,
          max_tokens: 16_000,
          system,
          tools: [toolset.toJSON(), REQUEST_USER_TOOL, ...CREDENTIAL_TOOLS.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }))],
          messages: withCacheBreakpoint(messages),
          thinking: { type: 'adaptive', display: 'omitted' },
          output_config: { effort: 'medium' },
        },
        { signal },
      )
      usage.inputTokens += response.usage.input_tokens
      usage.outputTokens += response.usage.output_tokens
      usage.cacheReadInputTokens += response.usage.cache_read_input_tokens ?? 0
      usage.cacheCreationInputTokens += response.usage.cache_creation_input_tokens ?? 0
      const content: BetaContentBlockParam[] = response.content
      messages.push({ role: 'assistant', content })
      const toolUses = response.content.filter((block): block is BetaToolUseBlock => block.type === 'tool_use')
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        const answer = response.content
          .flatMap(block => (block.type === 'text' ? [block.text] : []))
          .join('\n')
          .trim()
        return answer || 'The browser agent finished without an answer.'
      }
      messages.push({ role: 'user', content: await answerTurn(toolset, session, toolUses) })
    }
  } finally {
    await toolset.close()
  }
}

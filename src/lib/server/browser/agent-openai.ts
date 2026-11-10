import type { BrowserAction, BrowserActionResult } from '#lib/browser-protocol.ts'
import { type BrowserAgent, budgetExhausted, buildAgentSystemPrompt, buildTaskMessage, parseModifiers, REQUEST_USER_DESCRIPTION, REQUEST_USER_PARAMETERS, readUserRequest } from '#lib/server/browser/agent.ts'
import type { TaskSession } from '#lib/server/browser/task-session.ts'
import OpenAI from 'openai'
import type { ComputerAction, FunctionTool, ResponseComputerToolCall, ResponseFunctionCallOutputItemList, ResponseFunctionToolCall, ResponseInputItem, Tool } from 'openai/resources/responses/responses'

const WAIT_MS = 2000

export const keypressToChord = (keys: string[]): string => keys.map(key => (key === '+' ? 'plus' : key.toLowerCase())).join('+')

const withModifiers = (keys: string[] | null | undefined) => {
  const modifiers = parseModifiers(keys ?? [])
  return modifiers ? { modifiers } : {}
}

export const computerActionToBrowser = (action: ComputerAction): BrowserAction | null => {
  switch (action.type) {
    case 'click':
      if (action.button === 'back' || action.button === 'forward') {
        return { type: 'history', direction: action.button }
      }
      return { type: 'click', target: { x: action.x, y: action.y }, button: action.button === 'wheel' ? 'middle' : action.button, count: 1, ...withModifiers(action.keys) }
    case 'double_click':
      return { type: 'click', target: { x: action.x, y: action.y }, button: 'left', count: 2, ...withModifiers(action.keys) }
    case 'drag':
      return { type: 'drag', path: action.path.map(({ x, y }) => ({ x, y })) }
    case 'move':
      return { type: 'hover', target: { x: action.x, y: action.y } }
    case 'scroll':
      return { type: 'scroll', x: action.x, y: action.y, deltaX: action.scroll_x, deltaY: action.scroll_y }
    case 'type':
      return { type: 'type', text: action.text }
    case 'keypress':
      return { type: 'key', keys: [keypressToChord(action.keys)] }
    case 'wait':
      return { type: 'wait', ms: WAIT_MS }
    case 'screenshot':
      return null
  }
}

const functionTool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): FunctionTool => ({
  type: 'function',
  name,
  description,
  parameters: { type: 'object', properties, required, additionalProperties: false },
  strict: true,
})

const FUNCTION_TOOLS: FunctionTool[] = [
  functionTool('navigate', 'Open a URL in the current tab. Faster than typing into the address bar, which is not visible.', { url: { type: 'string', description: 'Absolute http or https URL' } }, ['url']),
  functionTool('go_back', 'Go back to the previous page in the current tab.', {}, []),
  functionTool('read_page_text', 'Return the visible text of the current page. Use it to read long content instead of scrolling through screenshots.', {}, []),
  functionTool('request_user', REQUEST_USER_DESCRIPTION, REQUEST_USER_PARAMETERS.properties, REQUEST_USER_PARAMETERS.required),
]

const UPLOAD_TOOL = functionTool(
  'upload_files',
  'Choose attached files for an upload: clicks the file input or upload button at x, y and selects the files in its file picker.',
  { x: { type: 'number' }, y: { type: 'number' }, file_ids: { type: 'array', items: { type: 'string' }, description: 'Ids of the attached files' } },
  ['x', 'y', 'file_ids'],
)

const parseArguments = (raw: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {}
  } catch {
    return {}
  }
}

const imageUrl = (result: BrowserActionResult | undefined): string | null => (result?.ok && result.image ? `data:${result.image.mediaType};base64,${result.image.base64}` : null)

const resultNotes = (results: BrowserActionResult[]): string[] => results.flatMap(result => (result.ok ? (result.text ? [result.text] : []) : [`Action failed: ${result.error}`]))

const createRunner = (session: TaskSession) => {
  const screenshot = async (): Promise<string> => {
    const [result] = await session.act([{ type: 'screenshot' }])
    const url = imageUrl(result)
    if (!url) {
      throw new Error(result && !result.ok ? result.error : 'The browser returned no screenshot.')
    }
    return url
  }

  const actAndCapture = async (actions: BrowserAction[]): Promise<{ notes: string[]; image: string }> => {
    const results = await session.act([...actions, { type: 'screenshot' }])
    const image = results.length === actions.length + 1 ? imageUrl(results.at(-1)) : null
    return { notes: resultNotes(results.slice(0, actions.length)), image: image ?? (await screenshot()) }
  }

  const textWithImage = (text: string, image: string): ResponseFunctionCallOutputItemList => [
    { type: 'input_text', text },
    { type: 'input_image', image_url: image, detail: 'original' },
  ]

  const runComputerCall = async (call: ResponseComputerToolCall): Promise<ResponseInputItem[]> => {
    const notes: string[] = []
    let approved = true
    if (call.pending_safety_checks.length) {
      const question = call.pending_safety_checks.map(check => check.message ?? check.code ?? 'Safety check').join(' ')
      const answer = await session.askUser('confirm', question)
      approved = answer.outcome === 'done'
      if (!approved) {
        notes.push(answer.message)
      }
    }
    const actions = approved ? (call.actions ?? (call.action ? [call.action] : [])).map(computerActionToBrowser).filter(action => action !== null) : []
    const captured = await actAndCapture(actions)
    notes.push(...captured.notes)
    const output: ResponseInputItem = {
      type: 'computer_call_output',
      call_id: call.call_id,
      output: { type: 'computer_screenshot', image_url: captured.image },
      ...(approved && call.pending_safety_checks.length ? { acknowledged_safety_checks: call.pending_safety_checks.map(({ id, code, message }) => ({ id, code, message })) } : {}),
    }
    return notes.length ? [output, { role: 'user', content: [{ type: 'input_text', text: notes.join('\n') }] }] : [output]
  }

  const runFunction = async (call: ResponseFunctionToolCall): Promise<string | ResponseFunctionCallOutputItemList> => {
    const args = parseArguments(call.arguments)
    if (call.name === 'navigate') {
      if (typeof args.url !== 'string') {
        return 'Error: url is required.'
      }
      const { notes, image } = await actAndCapture([{ type: 'navigate', url: args.url }])
      return textWithImage(notes.join('\n') || `Opened ${session.state().url}`, image)
    }
    if (call.name === 'go_back') {
      const { notes, image } = await actAndCapture([{ type: 'history', direction: 'back' }])
      return textWithImage(notes.join('\n') || `Now at ${session.state().url}`, image)
    }
    if (call.name === 'read_page_text') {
      const [result] = await session.act([{ type: 'page_text' }])
      return result?.ok ? (result.text ?? '') : `Error: ${result?.error ?? 'no result'}`
    }
    if (call.name === 'upload_files') {
      const fileIds = Array.isArray(args.file_ids) ? args.file_ids.filter(id => typeof id === 'string') : []
      if (typeof args.x !== 'number' || typeof args.y !== 'number' || fileIds.length === 0) {
        return 'Error: x, y and file_ids are required.'
      }
      const { notes, image } = await actAndCapture([{ type: 'file_upload', target: { x: args.x, y: args.y }, fileIds }])
      return textWithImage(notes.join('\n') || 'Files chosen.', image)
    }
    if (call.name === 'request_user') {
      const request = readUserRequest(args)
      return request ? (await session.askUser(request.kind, request.message)).message : 'Error: kind must be login, captcha or confirm, and message must be non-empty.'
    }
    return `Error: unknown function ${call.name}.`
  }

  return { screenshot, runComputerCall, runFunction }
}

export const runOpenAiBrowserAgent: BrowserAgent = async ({ task, startUrl, model, apiKey, session, usage, signal }) => {
  const client = new OpenAI({ apiKey })
  const runner = createRunner(session)
  const instructions = buildAgentSystemPrompt({
    files: session.files,
    readingHint: 'Use navigate to open URLs and read_page_text to read long text instead of scrolling through screenshots.',
    uploadHint: 'use upload_files with the position of the file input or upload button',
  })
  const tools: Tool[] = [{ type: 'computer' }, ...FUNCTION_TOOLS, ...(session.files.length ? [UPLOAD_TOOL] : [])]
  let previousResponseId: string | undefined
  let input: ResponseInputItem[] = [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: buildTaskMessage({ task, startUrl, currentUrl: session.state().url }) },
        { type: 'input_image', image_url: await runner.screenshot(), detail: 'original' },
      ],
    },
  ]
  for (let turn = 0; ; ++turn) {
    const exhausted = budgetExhausted(session, turn)
    if (exhausted) {
      return exhausted
    }
    const response = await client.responses.create({ model, instructions, tools, input, truncation: 'auto', reasoning: { effort: 'medium' }, ...(previousResponseId ? { previous_response_id: previousResponseId } : {}) }, { signal })
    const cached = response.usage?.input_tokens_details.cached_tokens ?? 0
    usage.inputTokens += (response.usage?.input_tokens ?? 0) - cached
    usage.outputTokens += response.usage?.output_tokens ?? 0
    usage.cacheReadInputTokens += cached
    previousResponseId = response.id
    const next: ResponseInputItem[] = []
    for (const item of response.output) {
      if (item.type === 'computer_call') {
        next.push(...(await runner.runComputerCall(item)))
      } else if (item.type === 'function_call') {
        next.push({ type: 'function_call_output', call_id: item.call_id, output: await runner.runFunction(item) })
      }
    }
    if (next.length === 0) {
      return response.output_text.trim() || 'The browser agent finished without an answer.'
    }
    input = next
  }
}

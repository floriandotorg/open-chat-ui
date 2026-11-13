import type { BrowserAction, BrowserPoint } from '#lib/browser-protocol.ts'
import { type BrowserAgent, budgetExhausted, buildAgentSystemPrompt, buildTaskMessage } from '#lib/server/browser/agent.ts'
import { createRunner, getBrowserFunctionTools } from '#lib/server/browser/agent-openai.ts'
import { createChatGPTProvider } from '#lib/server/providers/chatgpt.ts'
import type { ChatMessage, ChatMessageImage, ToolCallInfo, ToolSchema } from '#lib/server/providers/types.ts'

const KEEP_SCREENSHOTS = 3
const MAX_WAIT_MS = 10_000
const number = { type: 'number', minimum: 0 }
const string = { type: 'string' }
const point = { type: 'object', properties: { x: number, y: number }, required: ['x', 'y'], additionalProperties: false }

const actionSchema = (type: string, properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties: { type: { type: 'string', enum: [type] }, ...properties }, required: ['type', ...required], additionalProperties: false })

const BROWSER_ACTION_TOOL: ToolSchema = {
  name: 'browser_action',
  description: 'Control the browser using screenshot coordinates. Click, type, press keys, scroll, hover or drag, wait for loading, or take a screenshot. Every action returns a fresh screenshot. Coordinates are pixels in the browser viewport.',
  parameters: {
    type: 'object',
    anyOf: [
      actionSchema('click', { x: number, y: number, button: { type: 'string', enum: ['left', 'right', 'middle'] }, count: { type: 'integer', enum: [1, 2, 3] } }, ['x', 'y']),
      actionSchema('hover', { x: number, y: number }),
      actionSchema('drag', { path: { type: 'array', items: point, minItems: 2, maxItems: 100 } }),
      actionSchema('scroll', { x: number, y: number, deltaX: { type: 'number' }, deltaY: { type: 'number' } }),
      actionSchema('type', { text: string }),
      actionSchema('key', { keys: { type: 'array', items: string, minItems: 1, maxItems: 20, description: 'Key chords such as ctrl+a, enter, tab, or shift+tab, performed in order.' } }),
      actionSchema('wait', { ms: { type: 'integer', minimum: 0, maximum: MAX_WAIT_MS } }),
      actionSchema('screenshot', {}),
    ],
  },
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isPoint = (value: unknown): value is BrowserPoint & Record<string, unknown> => isRecord(value) && isNumber(value.x) && isNumber(value.y) && value.x >= 0 && value.y >= 0

export const readBrowserAction = (input: unknown): BrowserAction | null => {
  if (!isRecord(input)) {
    return null
  }
  switch (input.type) {
    case 'click': {
      const button = input.button ?? 'left'
      const count = input.count ?? 1
      return isPoint(input) && (button === 'left' || button === 'right' || button === 'middle') && (count === 1 || count === 2 || count === 3) ? { type: 'click', target: { x: input.x, y: input.y }, button, count } : null
    }
    case 'hover':
      return isPoint(input) ? { type: 'hover', target: { x: input.x, y: input.y } } : null
    case 'drag':
      return Array.isArray(input.path) && input.path.length >= 2 && input.path.length <= 100 && input.path.every(isPoint) ? { type: 'drag', path: input.path.map(({ x, y }) => ({ x, y })) } : null
    case 'scroll':
      return isPoint(input) && isNumber(input.deltaX) && isNumber(input.deltaY) ? { type: 'scroll', x: input.x, y: input.y, deltaX: input.deltaX, deltaY: input.deltaY } : null
    case 'type':
      return typeof input.text === 'string' ? { type: 'type', text: input.text } : null
    case 'key':
      return Array.isArray(input.keys) && input.keys.length > 0 && input.keys.length <= 20 && input.keys.every((key: unknown): key is string => typeof key === 'string' && key.length > 0) ? { type: 'key', keys: input.keys } : null
    case 'wait':
      return isNumber(input.ms) && Number.isInteger(input.ms) && input.ms >= 0 && input.ms <= MAX_WAIT_MS ? { type: 'wait', ms: input.ms } : null
    case 'screenshot':
      return { type: 'screenshot' }
    default:
      return null
  }
}

const toImage = (url: string): ChatMessageImage => {
  const match = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(url)
  if (!match) {
    throw new Error('The browser returned an invalid screenshot.')
  }
  return { data: match[2], mimeType: match[1] }
}

const pruneScreenshots = (messages: ChatMessage[]) => {
  let n = 0
  for (const message of [...messages].reverse()) {
    if (message.images?.length && ++n > KEEP_SCREENSHOTS) {
      delete message.images
    }
  }
}

export const runChatGPTBrowserAgent: BrowserAgent = async ({ task, startUrl, model, apiKey, session, usage, signal }) => {
  signal?.throwIfAborted()
  const provider = createChatGPTProvider(apiKey)
  const runner = createRunner(session)
  const systemPrompt = buildAgentSystemPrompt({
    files: session.files,
    readingHint: 'Use navigate to open URLs, read_page_text to read long content, and browser_action to interact with the page. Use screenshot coordinates from the latest image.',
    uploadHint: 'use upload_files with the position of the file input or upload button',
  })
  const tools: ToolSchema[] = [BROWSER_ACTION_TOOL, ...getBrowserFunctionTools(session.files.length > 0).map(tool => ({ name: tool.name, description: tool.description ?? '', parameters: tool.parameters ?? {} }))]
  const messages: ChatMessage[] = [{ role: 'user', content: buildTaskMessage({ task, startUrl, currentUrl: session.state().url }), images: [toImage(await runner.screenshot())] }]
  for (let n = 0; ; ++n) {
    signal?.throwIfAborted()
    const exhausted = budgetExhausted(session, n)
    if (exhausted) {
      return exhausted
    }
    let answer = ''
    let completed = false
    const toolCalls: ToolCallInfo[] = []
    for await (const event of provider.chat({ model, messages, systemPrompt, tools, thinkingEffort: 'medium', signal })) {
      signal?.throwIfAborted()
      if (event.type === 'error') {
        throw new Error(event.error ?? 'The ChatGPT browser request failed.')
      }
      if (event.type === 'text_delta') {
        answer += event.text ?? ''
      } else if (event.type === 'tool_call' && event.toolCall) {
        toolCalls.push(event.toolCall)
      } else if (event.type === 'usage') {
        usage.inputTokens += event.inputTokens ?? 0
        usage.outputTokens += event.outputTokens ?? 0
        usage.cacheReadInputTokens += event.cacheReadInputTokens ?? 0
        usage.cacheCreationInputTokens += event.cacheCreationInputTokens ?? 0
      } else if (event.type === 'done') {
        completed = true
      }
    }
    if (!completed) {
      throw new Error('The ChatGPT browser response ended before it completed.')
    }
    if (!toolCalls.length) {
      return answer.trim() || 'The browser agent finished without an answer.'
    }
    messages.push({ role: 'assistant', content: answer, toolCalls })
    let image: ChatMessageImage | undefined
    let userInteraction = false
    for (const call of toolCalls) {
      signal?.throwIfAborted()
      image = undefined
      let content: string
      if (userInteraction) {
        content = 'Not executed: review the user response and latest screenshot before continuing. Do not proceed if the user declined or did not respond.'
      } else if (call.name === BROWSER_ACTION_TOOL.name) {
        const action = readBrowserAction(call.arguments)
        if (action) {
          const captured = await runner.actAndCapture(action.type === 'screenshot' ? [] : [action])
          content = captured.notes.join('\n') || `Now at ${session.state().url}`
          image = toImage(captured.image)
        } else {
          content = 'Error: invalid browser_action arguments. Use the tool schema and try again.'
        }
      } else {
        const output = await runner.runFunction({ name: call.name, arguments: JSON.stringify(call.arguments) })
        userInteraction = call.name === 'request_user'
        if (typeof output === 'string') {
          content = output
        } else {
          content = output.flatMap(item => (item.type === 'input_text' ? [item.text] : [])).join('\n')
          for (const item of output) {
            if (item.type === 'input_image' && item.image_url) {
              image = toImage(item.image_url)
            }
          }
        }
      }
      messages.push({ role: 'tool', toolCallId: call.id, content })
    }
    messages.push({ role: 'user', content: `The browser currently shows: ${session.state().url}`, images: [image ?? toImage(await runner.screenshot())] })
    pruneScreenshots(messages)
  }
}

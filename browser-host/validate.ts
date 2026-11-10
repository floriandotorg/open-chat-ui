import type { BrowserAction, BrowserActionsRequest, BrowserLiveInput, BrowserModifier, BrowserMouseButton, BrowserPoint, BrowserTarget } from '#lib/browser-protocol.ts'

export class RequestError extends Error {}

type JsonObject = Record<string, unknown>

const isRecord = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

const record = (value: unknown, label: string): JsonObject => {
  if (!isRecord(value)) {
    throw new RequestError(`${label} must be an object`)
  }
  return value
}

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new RequestError(`${label} must be a string`)
  }
  return value
}

const optionalString = (value: unknown, label: string): string | undefined => (value === undefined || value === null ? undefined : string(value, label))

const number = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RequestError(`${label} must be a finite number`)
  }
  return value
}

const optionalNumber = (value: unknown, label: string): number | undefined => (value === undefined || value === null ? undefined : number(value, label))

const oneOf = <T extends string | number>(value: unknown, options: readonly T[], label: string): T => {
  const match = options.find(option => option === value)
  if (match === undefined) {
    throw new RequestError(`${label} must be one of ${options.join(', ')}`)
  }
  return match
}

const stringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) {
    throw new RequestError(`${label} must be an array`)
  }
  return value.map((entry, n) => string(entry, `${label}[${n}]`))
}

const point = (value: unknown, label: string): BrowserPoint => {
  const object = record(value, label)
  return { x: number(object.x, `${label}.x`), y: number(object.y, `${label}.y`) }
}

const target = (value: unknown, label: string): BrowserTarget => {
  const object = record(value, label)
  return typeof object.ref === 'string' ? { ref: object.ref } : point(object, label)
}

const BUTTONS = ['left', 'right', 'middle'] as const satisfies readonly BrowserMouseButton[]
const MODIFIERS = ['shift', 'ctrl', 'alt', 'meta'] as const satisfies readonly BrowserModifier[]
const CLICK_COUNTS = [1, 2, 3] as const

const region = (value: unknown): [number, number, number, number] => {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new RequestError('region must be [x0, y0, x1, y1]')
  }
  return [number(value[0], 'region[0]'), number(value[1], 'region[1]'), number(value[2], 'region[2]'), number(value[3], 'region[3]')]
}

export const parseAction = (value: unknown): BrowserAction => {
  const action = record(value, 'action')
  const type = string(action.type, 'action.type')
  switch (type) {
    case 'navigate':
      return { type, url: string(action.url, 'url') }
    case 'history':
      return { type, direction: oneOf(action.direction, ['back', 'forward', 'reload'] as const, 'direction') }
    case 'screenshot':
    case 'page_text':
    case 'tab_list':
      return { type }
    case 'zoom':
      return { type, region: region(action.region) }
    case 'click': {
      const modifiers = action.modifiers === undefined ? undefined : stringArray(action.modifiers, 'modifiers').map(modifier => oneOf(modifier, MODIFIERS, 'modifier'))
      return { type, target: target(action.target, 'target'), button: oneOf(action.button ?? 'left', BUTTONS, 'button'), count: oneOf(action.count ?? 1, CLICK_COUNTS, 'count'), ...(modifiers ? { modifiers } : {}) }
    }
    case 'hover':
      return { type, target: target(action.target, 'target') }
    case 'drag': {
      if (!Array.isArray(action.path) || action.path.length < 2) {
        throw new RequestError('path needs at least two points')
      }
      return { type, path: action.path.map((entry, n) => point(entry, `path[${n}]`)) }
    }
    case 'mouse':
      return { type, event: oneOf(action.event, ['down', 'up', 'move'] as const, 'event'), x: number(action.x, 'x'), y: number(action.y, 'y') }
    case 'scroll':
      return { type, x: number(action.x, 'x'), y: number(action.y, 'y'), deltaX: number(action.deltaX ?? 0, 'deltaX'), deltaY: number(action.deltaY ?? 0, 'deltaY') }
    case 'scroll_to':
      return { type, ref: string(action.ref, 'ref') }
    case 'type':
      return { type, text: string(action.text, 'text') }
    case 'key': {
      const repeat = optionalNumber(action.repeat, 'repeat')
      const holdMs = optionalNumber(action.holdMs, 'holdMs')
      return { type, keys: stringArray(action.keys, 'keys'), ...(repeat !== undefined ? { repeat } : {}), ...(holdMs !== undefined ? { holdMs } : {}) }
    }
    case 'wait':
      return { type, ms: number(action.ms, 'ms') }
    case 'read_page': {
      const depth = optionalNumber(action.depth, 'depth')
      const ref = optionalString(action.ref, 'ref')
      return { type, filter: oneOf(action.filter ?? 'interactive', ['interactive', 'all'] as const, 'filter'), ...(depth !== undefined ? { depth } : {}), ...(ref !== undefined ? { ref } : {}) }
    }
    case 'find':
      return { type, query: string(action.query, 'query') }
    case 'form_input': {
      const formValue = action.value
      if (typeof formValue !== 'string' && typeof formValue !== 'number' && typeof formValue !== 'boolean') {
        throw new RequestError('value must be a string, number or boolean')
      }
      return { type, ref: string(action.ref, 'ref'), value: formValue }
    }
    case 'file_upload':
      return { type, target: target(action.target, 'target'), fileIds: stringArray(action.fileIds, 'fileIds') }
    case 'tab_new': {
      const url = optionalString(action.url, 'url')
      return { type, ...(url !== undefined ? { url } : {}) }
    }
    case 'tab_switch':
    case 'tab_close':
      return { type, tabId: string(action.tabId, 'tabId') }
    default:
      throw new RequestError(`Unknown action type "${type}"`)
  }
}

export const parseActionsRequest = (value: unknown): BrowserActionsRequest => {
  const body = record(value, 'body')
  if (!Array.isArray(body.actions)) {
    throw new RequestError('actions must be an array')
  }
  const tabId = optionalString(body.tabId, 'tabId')
  return { actions: body.actions.map(parseAction), ...(tabId !== undefined ? { tabId } : {}) }
}

export const parseLiveInput = (value: unknown): BrowserLiveInput => {
  const input = record(value, 'input')
  const type = string(input.type, 'input.type')
  switch (type) {
    case 'pointer': {
      const button = input.button === undefined ? undefined : oneOf(input.button, BUTTONS, 'button')
      return { type, event: oneOf(input.event, ['down', 'up', 'move'] as const, 'event'), x: number(input.x, 'x'), y: number(input.y, 'y'), ...(button ? { button } : {}) }
    }
    case 'tap':
      return { type, x: number(input.x, 'x'), y: number(input.y, 'y') }
    case 'wheel':
      return { type, x: number(input.x, 'x'), y: number(input.y, 'y'), deltaX: number(input.deltaX ?? 0, 'deltaX'), deltaY: number(input.deltaY ?? 0, 'deltaY') }
    case 'key':
      return { type, key: string(input.key, 'key') }
    case 'text':
      return { type, text: string(input.text, 'text') }
    default:
      throw new RequestError(`Unknown input type "${type}"`)
  }
}

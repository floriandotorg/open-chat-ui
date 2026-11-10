import type { BrowserLiveInput, BrowserMouseButton } from '#lib/browser-protocol.ts'

const MAX_TEXT = 4000
const MAX_KEY = 32

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isButton = (value: unknown): value is BrowserMouseButton => value === 'left' || value === 'right' || value === 'middle'

export const parseLiveInput = (raw: unknown): BrowserLiveInput | null => {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
    return null
  }
  const input: Record<string, unknown> = { ...raw }
  const { type, x, y } = input
  if (type === 'tap') {
    return isNumber(x) && isNumber(y) ? { type, x, y } : null
  }
  if (type === 'pointer') {
    const { event, button } = input
    if (!isNumber(x) || !isNumber(y) || (event !== 'down' && event !== 'up' && event !== 'move')) {
      return null
    }
    return { type, event, x, y, ...(isButton(button) ? { button } : {}) }
  }
  if (type === 'wheel') {
    const { deltaX, deltaY } = input
    return isNumber(x) && isNumber(y) && isNumber(deltaX) && isNumber(deltaY) ? { type, x, y, deltaX, deltaY } : null
  }
  if (type === 'key') {
    const { key } = input
    return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY ? { type, key } : null
  }
  if (type === 'text') {
    const { text } = input
    return typeof text === 'string' && text.length > 0 && text.length <= MAX_TEXT ? { type, text } : null
  }
  return null
}

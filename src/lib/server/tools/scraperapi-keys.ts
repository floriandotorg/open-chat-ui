const EXHAUSTED_MESSAGE = 'You have exhausted the API Credits available'
const EXHAUSTED_RETRY_MS = 60 * 60 * 1000

interface RotationState {
  cursor: number
  exhaustedUntil: Map<string, number>
}

const states = new Map<string, RotationState>()

const getState = (scope: string) => {
  const existing = states.get(scope)
  if (existing) return existing
  const state = { cursor: 0, exhaustedUntil: new Map<string, number>() }
  states.set(scope, state)
  return state
}

const normalizeKeys = (keys: string[]) => [...new Set(keys.map(key => key.trim()).filter(Boolean))]

const pruneState = (state: RotationState, keys: string[]) => {
  const validKeys = new Set(keys)
  const now = Date.now()
  for (const [key, retryAt] of state.exhaustedUntil) {
    if (!validKeys.has(key) || retryAt <= now) {
      state.exhaustedUntil.delete(key)
    }
  }
  if (keys.length > 0) {
    state.cursor %= keys.length
  } else {
    state.cursor = 0
  }
}

const nextScraperApiKey = (scope: string, keys: string[]) => {
  const state = getState(scope)
  pruneState(state, keys)

  for (let n = 0; n < keys.length; ++n) {
    const index = state.cursor % keys.length
    state.cursor = (index + 1) % keys.length
    const key = keys[index]
    if (!state.exhaustedUntil.has(key)) {
      return key
    }
  }

  return null
}

const markScraperApiKeyExhausted = (scope: string, key: string) => {
  getState(scope).exhaustedUntil.set(key, Date.now() + EXHAUSTED_RETRY_MS)
}

export const resetScraperApiKeyState = () => {
  states.clear()
}

export const isScraperApiCreditExhaustedError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('ScraperAPI HTTP 403') && message.includes(EXHAUSTED_MESSAGE)
}

export const fetchWithScraperApiKeys = async <T>(scope: string, keys: string[], direct: () => Promise<T>, viaKey: (key: string) => Promise<T>): Promise<T> => {
  const scraperKeys = normalizeKeys(keys)
  if (scraperKeys.length === 0) {
    return direct()
  }

  let lastError: Error | null = null
  for (let n = 0; n < scraperKeys.length; ++n) {
    const key = nextScraperApiKey(scope, scraperKeys)
    if (!key) break

    try {
      return await viaKey(key)
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      if (!isScraperApiCreditExhaustedError(nextError)) {
        throw nextError
      }
      markScraperApiKeyExhausted(scope, key)
      lastError = nextError
    }
  }

  throw lastError ?? new Error('All configured ScraperAPI keys are exhausted')
}

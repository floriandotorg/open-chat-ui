import { fetchWithScraperApiKeys, isScraperApiCreditExhaustedError, resetScraperApiKeyState } from './scraperapi-keys'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('fetchWithScraperApiKeys', () => {
  afterEach(() => {
    resetScraperApiKeyState()
  })

  it('uses direct fetching when no keys are configured', async () => {
    const direct = vi.fn(async () => 'direct')
    const viaKey = vi.fn(async (key: string) => `key:${key}`)

    await expect(fetchWithScraperApiKeys('user', [], direct, viaKey)).resolves.toBe('direct')
    expect(direct).toHaveBeenCalledOnce()
    expect(viaKey).not.toHaveBeenCalled()
  })

  it('rotates configured keys equally', async () => {
    const usedKeys: string[] = []
    const viaKey = vi.fn(async (key: string) => {
      usedKeys.push(key)
      return `ok:${key}`
    })

    for (let n = 0; n < 5; ++n) {
      await fetchWithScraperApiKeys('user', ['a', 'b', 'c'], async () => 'direct', viaKey)
    }

    expect(usedKeys).toEqual(['a', 'b', 'c', 'a', 'b'])
  })

  it('skips exhausted keys and tries the next key', async () => {
    const usedKeys: string[] = []
    const viaKey = vi.fn(async (key: string) => {
      usedKeys.push(key)
      if (key === 'a') {
        throw new Error('ScraperAPI HTTP 403: You have exhausted the API Credits available')
      }
      return `ok:${key}`
    })

    await expect(fetchWithScraperApiKeys('user', ['a', 'b'], async () => 'direct', viaKey)).resolves.toBe('ok:b')
    expect(usedKeys).toEqual(['a', 'b'])

    usedKeys.length = 0
    await expect(fetchWithScraperApiKeys('user', ['a', 'b'], async () => 'direct', viaKey)).resolves.toBe('ok:b')
    expect(usedKeys).toEqual(['b'])
  })
})

describe('isScraperApiCreditExhaustedError', () => {
  it('recognises exhausted-credit errors', () => {
    expect(isScraperApiCreditExhaustedError(new Error('ScraperAPI HTTP 403: You have exhausted the API Credits available'))).toBe(true)
    expect(isScraperApiCreditExhaustedError('Error: ScraperAPI HTTP 403: You have exhausted the API Credits available')).toBe(true)
    expect(isScraperApiCreditExhaustedError(new Error('ScraperAPI HTTP 500: server error'))).toBe(false)
  })
})

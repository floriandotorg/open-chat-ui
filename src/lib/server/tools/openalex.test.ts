import { openAlexAuthParams } from './openalex'
import { describe, expect, it } from 'vitest'

describe('openAlexAuthParams', () => {
  it('returns empty object for null or blank', () => {
    expect(openAlexAuthParams(null)).toEqual({})
    expect(openAlexAuthParams('')).toEqual({})
    expect(openAlexAuthParams('   ')).toEqual({})
  })

  it('treats an email-like value as mailto (polite pool)', () => {
    expect(openAlexAuthParams('user@example.com')).toEqual({ mailto: 'user@example.com' })
  })

  it('treats a non-email value as an api_key', () => {
    expect(openAlexAuthParams('abc123secretkey')).toEqual({ api_key: 'abc123secretkey' })
  })

  it('trims whitespace before deciding', () => {
    expect(openAlexAuthParams('  user@example.com  ')).toEqual({ mailto: 'user@example.com' })
    expect(openAlexAuthParams('  key123  ')).toEqual({ api_key: 'key123' })
  })
})

import { createHash } from 'node:crypto'
import { hashToken, isAuthorized } from './auth'
import { describe, expect, it } from 'vitest'

const token = 'test-browser-token-with-high-entropy'
const request = (authorization?: string) => new Request('http://localhost/health', { headers: authorization ? { authorization } : {} })

describe('browser host authentication', () => {
  it('hashes tokens with SHA-256', () => {
    expect(hashToken(token)).toBe(createHash('sha256').update(token).digest('hex'))
  })

  it('accepts only the original bearer token, not its stored hash', () => {
    const tokenHash = hashToken(token)
    expect(isAuthorized(request(`Bearer ${token}`), tokenHash)).toBe(true)
    expect(isAuthorized(request(`Bearer ${tokenHash}`), tokenHash)).toBe(false)
    expect(isAuthorized(request('Bearer wrong-token'), tokenHash)).toBe(false)
    expect(isAuthorized(request(), tokenHash)).toBe(false)
    expect(isAuthorized(request('Bearer '), tokenHash)).toBe(false)
    expect(isAuthorized(request(`Basic ${token}`), tokenHash)).toBe(false)
  })

  it('rejects malformed stored hashes without throwing', () => {
    for (const tokenHash of ['', 'abc', 'z'.repeat(64), 'a'.repeat(63)]) {
      expect(isAuthorized(request(`Bearer ${token}`), tokenHash)).toBe(false)
    }
  })
})

import { createNetworkAccess, networkAccessFor } from './network-access'
import { describe, expect, it } from 'vitest'

const ROUTER = 'https://192.168.50.1:8443'

describe('task network access', () => {
  it('blocks and deduplicates requests until the exact origin is approved', () => {
    const access = createNetworkAccess()
    expect(access.request(ROUTER)).toBe(false)
    expect(access.request(ROUTER)).toBe(false)
    expect(access.pending()).toEqual([ROUTER])
    expect(access.decide(ROUTER, true)).toBe(true)
    expect(access.request(ROUTER)).toBe(true)
    expect(access.pending()).toEqual([])
    expect(access.request('https://192.168.50.1')).toBe(false)
    expect(access.request('http://192.168.50.1:8443')).toBe(false)
    expect(access.request('https://192.168.50.2:8443')).toBe(false)
  })

  it('never grants an origin that was not requested', () => {
    const access = createNetworkAccess()
    expect(access.decide(ROUTER, true)).toBe(false)
    expect(access.request(ROUTER)).toBe(false)
  })

  it('keeps declined origins blocked without asking again in the same task', () => {
    const access = createNetworkAccess()
    access.request(ROUTER)
    expect(access.decide(ROUTER, false)).toBe(true)
    expect(access.request(ROUTER)).toBe(false)
    expect(access.pending()).toEqual([])
    expect(access.decide(ROUTER, true)).toBe(false)
  })

  it('revokes access on release and isolates subsequent tasks', () => {
    const session = {}
    const access = networkAccessFor(session)
    expect(networkAccessFor(session)).toBe(access)
    access.request(ROUTER)
    access.decide(ROUTER, true)
    expect(networkAccessFor({}).request(ROUTER)).toBe(false)
    access.dispose()
    expect(access.request(ROUTER)).toBe(false)
    expect(access.pending()).toEqual([])
    expect(access.decide(ROUTER, true)).toBe(false)
  })
})

import { createNetworkAccess } from './network-access'
import { bindNetworkAccess, createHostChecker, installNetworkGuard, isAllowedNavigationUrl, isAllowedRequestUrl, isBlockedAddress, isBlockedHostname } from './network-guard'
import type { BrowserContext, Page } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'

describe('network approval enforcement', () => {
  const setup = async () => {
    const checker = createHostChecker(async () => ['192.168.50.1'])
    const context = { route: vi.fn<BrowserContext['route']>().mockResolvedValue({ dispose: async () => {}, [Symbol.asyncDispose]: async () => {} }), routeWebSocket: vi.fn<BrowserContext['routeWebSocket']>().mockResolvedValue(undefined) }
    const page = { routeWebSocket: vi.fn<Page['routeWebSocket']>().mockResolvedValue(undefined) }
    const access = createNetworkAccess()
    await installNetworkGuard(context, checker)
    await bindNetworkAccess(page, access, checker)
    const request = async (url: string, owner: object = page) => {
      const route = { request: () => ({ url: () => url, frame: () => ({ page: () => owner }) }), abort: vi.fn(), continue: vi.fn() }
      await Reflect.apply(context.route.mock.calls[0][1], undefined, [route])
      return route
    }
    const websocket = async (url: string, owned = true) => {
      const ws = { url: () => url, close: vi.fn(), connectToServer: vi.fn() }
      const target = owned ? page : context
      await Reflect.apply(target.routeWebSocket.mock.calls[0][1], undefined, [ws])
      return ws
    }
    return { access, request, websocket }
  }

  it.each(['https://192.168.50.1:8443', 'http://router.local', 'https://public-name.example'])('gates requests to %s including DNS-resolved private addresses', async origin => {
    const { access, request } = await setup()
    expect((await request(`${origin}/login`)).abort).toHaveBeenCalledWith('blockedbyclient')
    expect(access.pending()).toEqual([origin])
    access.decide(origin, true)
    expect((await request(`${origin}/login`)).continue).toHaveBeenCalledOnce()
    expect((await request(`${origin}/login`, {})).abort).toHaveBeenCalledOnce()
    access.dispose()
    expect((await request(`${origin}/login`)).abort).toHaveBeenCalledOnce()
  })

  it('requires matching WebSocket origin approval and preserves default-deny for other pages', async () => {
    const { access, websocket } = await setup()
    const origin = 'wss://192.168.50.1:8443'
    expect((await websocket(`${origin}/events`)).close).toHaveBeenCalledOnce()
    expect(access.pending()).toEqual([origin])
    access.decide(origin, true)
    expect((await websocket(`${origin}/events`)).connectToServer).toHaveBeenCalledOnce()
    expect((await websocket(`${origin}/events`, false)).close).toHaveBeenCalledOnce()
  })

  it('preserves protocol restrictions and allows public literal addresses without approval', async () => {
    const { access, request } = await setup()
    expect((await request('file:///etc/passwd')).abort).toHaveBeenCalledOnce()
    expect((await request('https://8.8.8.8')).continue).toHaveBeenCalledOnce()
    expect(access.pending()).toEqual([])
  })
})

describe('isBlockedAddress', () => {
  it('blocks loopback, private, CGNAT and link-local IPv4', () => {
    for (const ip of ['127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.255.255', '169.254.169.254', '0.0.0.0', '0.1.2.3']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('allows public IPv4 at the range edges', () => {
    for (const ip of ['172.15.255.255', '172.32.0.0', '100.63.255.255', '100.128.0.0', '11.0.0.1', '192.169.0.1', '169.255.0.1', '8.8.8.8', '93.184.215.14']) {
      expect(isBlockedAddress(ip), ip).toBe(false)
    }
  })

  it('blocks loopback, unspecified, link-local and unique local IPv6', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', '[::1]', 'FE80::abcd']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('blocks IPv4-mapped IPv6 of private addresses', () => {
    for (const ip of ['::ffff:127.0.0.1', '::ffff:192.168.0.10', '::ffff:7f00:1', '::ffff:a00:1', '0:0:0:0:0:ffff:10.1.2.3']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('allows public IPv6 and mapped public IPv4', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:db8::1', '::ffff:8.8.8.8', 'fec0::1']) {
      expect(isBlockedAddress(ip), ip).toBe(false)
    }
  })

  it('treats garbage as not an address', () => {
    expect(isBlockedAddress('example.com')).toBe(false)
    expect(isBlockedAddress('999.1.1.1')).toBe(false)
  })
})

describe('isBlockedHostname', () => {
  it('blocks local names', () => {
    for (const host of ['localhost', 'LOCALHOST', 'foo.localhost', 'printer.local', 'mac.tail1234.ts.net', 'db.internal', 'localhost.']) {
      expect(isBlockedHostname(host), host).toBe(true)
    }
  })

  it('blocks literal private addresses', () => {
    expect(isBlockedHostname('192.168.0.1')).toBe(true)
    expect(isBlockedHostname('[::1]')).toBe(true)
  })

  it('allows public names', () => {
    for (const host of ['example.com', 'local.example.com', 'internal.example.org', 'ts.net.example.com', '8.8.8.8']) {
      expect(isBlockedHostname(host), host).toBe(false)
    }
  })
})

describe('isAllowedNavigationUrl', () => {
  it('accepts only http and https', () => {
    expect(isAllowedNavigationUrl('https://example.com/a?b')).toBe(true)
    expect(isAllowedNavigationUrl('http://example.com')).toBe(true)
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'chrome://settings', 'about:blank', 'ftp://example.com', 'not a url', '']) {
      expect(isAllowedNavigationUrl(url), url).toBe(false)
    }
  })
})

describe('isAllowedRequestUrl', () => {
  it('passes web and inert schemes', () => {
    for (const url of ['https://example.com', 'http://example.com', 'data:image/png;base64,AA', 'blob:https://example.com/123', 'about:blank']) {
      expect(isAllowedRequestUrl(url), url).toBe(true)
    }
  })

  it('rejects other schemes', () => {
    for (const url of ['file:///etc/passwd', 'chrome://settings', 'ws://example.com', 'nonsense']) {
      expect(isAllowedRequestUrl(url), url).toBe(false)
    }
  })
})

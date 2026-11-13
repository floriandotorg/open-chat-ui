import { lookup } from 'node:dns/promises'
import type { NetworkAccess } from './network-access'
import type { BrowserContext, Page, WebSocketRoute } from 'playwright-core'

const BLOCKED_NAME_SUFFIXES = ['.localhost', '.local', '.ts.net', '.internal', '.lan', '.home.arpa']
const NAVIGATION_PROTOCOLS = new Set(['http:', 'https:'])
const REQUEST_PROTOCOLS = new Set(['http:', 'https:', 'data:', 'blob:', 'about:'])
const LOOKUP_TTL_MS = 60_000

const parseIpv4 = (value: string): number[] | null => {
  const parts = value.split('.')
  if (parts.length !== 4) {
    return null
  }
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null
    }
    const octet = Number(part)
    if (octet > 255) {
      return null
    }
    octets.push(octet)
  }
  return octets
}

const parseHextets = (value: string): number[] | null => {
  if (!/^[0-9a-f]{1,4}$/i.test(value)) {
    return null
  }
  return [Number.parseInt(value, 16)]
}

const parseIpv6 = (raw: string): number[] | null => {
  const value = raw.replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  if (!value.includes(':')) {
    return null
  }
  const halves = value.split('::')
  if (halves.length > 2) {
    return null
  }
  const parseGroups = (part: string): number[] | null => {
    if (part === '') {
      return []
    }
    const groups = part.split(':')
    const hextets: number[] = []
    for (let n = 0; n < groups.length; ++n) {
      const group = groups[n]
      if (n === groups.length - 1 && group.includes('.')) {
        const ipv4 = parseIpv4(group)
        if (!ipv4) {
          return null
        }
        hextets.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3])
        continue
      }
      const parsed = parseHextets(group)
      if (!parsed) {
        return null
      }
      hextets.push(...parsed)
    }
    return hextets
  }
  const head = parseGroups(halves[0])
  const tail = halves.length === 2 ? parseGroups(halves[1]) : []
  if (!head || !tail) {
    return null
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : null
  }
  const missing = 8 - head.length - tail.length
  if (missing < 1) {
    return null
  }
  return [...head, ...Array<number>(missing).fill(0), ...tail]
}

const isBlockedIpv4 = ([a, b]: number[]): boolean => a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))

const embeddedIpv4 = (hextets: number[]): number[] => [hextets[6] >> 8, hextets[6] & 0xff, hextets[7] >> 8, hextets[7] & 0xff]

const isBlockedIpv6 = (hextets: number[]): boolean => {
  const prefixIsZero = (count: number) => hextets.slice(0, count).every(hextet => hextet === 0)
  if (prefixIsZero(7) && hextets[7] <= 1) {
    return true
  }
  if ((hextets[0] & 0xffc0) === 0xfe80 || (hextets[0] & 0xfe00) === 0xfc00 || (hextets[0] & 0xff00) === 0xff00) {
    return true
  }
  const mapped = prefixIsZero(5) && hextets[5] === 0xffff
  const compatible = prefixIsZero(6)
  const nat64 = hextets[0] === 0x64 && hextets[1] === 0xff9b && hextets.slice(2, 6).every(hextet => hextet === 0)
  return (mapped || compatible || nat64) && isBlockedIpv4(embeddedIpv4(hextets))
}

const isIpLiteral = (value: string): boolean => parseIpv4(value) !== null || parseIpv6(value) !== null

export const isBlockedAddress = (ip: string): boolean => {
  const ipv4 = parseIpv4(ip)
  if (ipv4) {
    return isBlockedIpv4(ipv4)
  }
  const ipv6 = parseIpv6(ip)
  return ipv6 ? isBlockedIpv6(ipv6) : false
}

const normalizeHostname = (host: string): string =>
  host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')

export const isBlockedHostname = (host: string): boolean => {
  const name = normalizeHostname(host)
  if (isIpLiteral(name)) {
    return isBlockedAddress(name)
  }
  if (!name.includes('.')) {
    return true
  }
  return BLOCKED_NAME_SUFFIXES.some(suffix => name.endsWith(suffix) || name === suffix.slice(1))
}

const parseUrl = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

export const isAllowedNavigationUrl = (url: string): boolean => {
  const parsed = parseUrl(url)
  return !!parsed && NAVIGATION_PROTOCOLS.has(parsed.protocol)
}

export const isAllowedRequestUrl = (url: string): boolean => {
  const parsed = parseUrl(url)
  return !!parsed && REQUEST_PROTOCOLS.has(parsed.protocol)
}

type LookupAll = (host: string) => Promise<string[]>

const lookupAll: LookupAll = async host => (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address)

export const createHostChecker = (resolve: LookupAll = lookupAll, ttlMs = LOOKUP_TTL_MS) => {
  const cache = new Map<string, { blocked: boolean; expiresAt: number }>()

  const cachedVerdict = (host: string): boolean | undefined => {
    const entry = cache.get(normalizeHostname(host))
    return entry && entry.expiresAt > Date.now() ? entry.blocked : undefined
  }

  const isBlocked = async (host: string): Promise<boolean> => {
    if (isBlockedHostname(host)) {
      return true
    }
    const name = normalizeHostname(host)
    if (isIpLiteral(name)) {
      return false
    }
    const cached = cachedVerdict(name)
    if (cached !== undefined) {
      return cached
    }
    const addresses = await resolve(name).catch(() => [])
    const blocked = addresses.some(isBlockedAddress)
    cache.set(name, { blocked, expiresAt: Date.now() + ttlMs })
    return blocked
  }

  return { isBlocked, cachedVerdict }
}

const pageAccess = new WeakMap<object, NetworkAccess>()

const guardWebSocket = async (ws: WebSocketRoute, checker: ReturnType<typeof createHostChecker>, access?: NetworkAccess) => {
  const parsed = parseUrl(ws.url())
  if (!parsed || ((await checker.isBlocked(parsed.hostname)) && !access?.request(parsed.origin))) {
    await ws.close({ code: 1008, reason: 'Local network access requires approval for this task' })
    return
  }
  ws.connectToServer()
}

export const bindNetworkAccess = async (page: Pick<Page, 'routeWebSocket'>, access: NetworkAccess, checker = createHostChecker()) => {
  pageAccess.set(page, access)
  await page.routeWebSocket('**/*', ws => guardWebSocket(ws, checker, access))
}

export const installNetworkGuard = async (context: Pick<BrowserContext, 'route' | 'routeWebSocket'>, checker = createHostChecker()) => {
  await context.route('**/*', async route => {
    const url = route.request().url()
    const parsed = parseUrl(url)
    if (!parsed || !isAllowedRequestUrl(url)) {
      await route.abort('blockedbyclient')
      return
    }
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && (await checker.isBlocked(parsed.hostname))) {
      let access: NetworkAccess | undefined
      try {
        access = pageAccess.get(route.request().frame().page())
      } catch {}
      if (!access?.request(parsed.origin)) {
        await route.abort('blockedbyclient')
        return
      }
    }
    await route.continue()
  })
  await context.routeWebSocket('**/*', ws => guardWebSocket(ws, checker))
}

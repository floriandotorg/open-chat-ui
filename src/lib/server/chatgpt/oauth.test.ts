import { buildAuthorizeUrl, callbackRedirectUri, needsRefresh, parseCallbackParams, parseTokenResponse, pkceChallenge, verifyIdToken } from './oauth'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const ISSUER = 'https://auth.openai.com'
const JWKS_URI = 'https://auth.openai.com/.well-known/jwks.json'

describe('callbackRedirectUri', () => {
  it('reuses the app port when the app is served over http on loopback', () => {
    expect(callbackRedirectUri(new URL('http://localhost:5179/settings'))).toBe('http://127.0.0.1:5179/auth/callback')
    expect(callbackRedirectUri(new URL('http://127.0.0.1:3000/'))).toBe('http://127.0.0.1:3000/auth/callback')
  })

  it('uses the default http port when the loopback url has none', () => {
    expect(callbackRedirectUri(new URL('http://localhost/'))).toBe('http://127.0.0.1:80/auth/callback')
  })

  it('falls back to a fixed port for remote hosts', () => {
    expect(callbackRedirectUri(new URL('https://chat.example.com/settings'))).toBe('http://127.0.0.1:1455/auth/callback')
    expect(callbackRedirectUri(new URL('https://localhost:8443/'))).toBe('http://127.0.0.1:1455/auth/callback')
  })
})

describe('pkceChallenge', () => {
  it('matches the RFC 7636 example', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('buildAuthorizeUrl', () => {
  const base = {
    authorizationEndpoint: 'https://auth.openai.com/api/accounts/authorize',
    hostId: 'urn:uuid:5f1c2c4e-0000-4000-8000-000000000000',
    redirectUri: 'http://127.0.0.1:5179/auth/callback',
    state: 'state-1',
    nonce: 'nonce-1',
    codeChallenge: 'challenge-1',
  }

  it('registers a new client with the dynamic client id and an agent name hint', () => {
    const url = new URL(buildAuthorizeUrl({ ...base, clientId: null }))
    expect(url.origin + url.pathname).toBe(base.authorizationEndpoint)
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(url.searchParams.get('agent_name_hint')).toBe('Open Chat UI')
    expect(url.searchParams.get('ext_agent_host_id')).toBe(base.hostId)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(base.redirectUri)
    expect(url.searchParams.get('scope')).toBe('openid profile email offline_access resource.invoke chatgpt.tokens.use.direct')
    expect(url.searchParams.get('resource')).toBe('https://api.openai.com/v1')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('nonce')).toBe('nonce-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.has('id_token_hint')).toBe(false)
  })

  it('percent-encodes spaces instead of using plus signs', () => {
    expect(buildAuthorizeUrl({ ...base, clientId: null })).toContain('scope=openid%20profile')
  })

  it('reauthorizes an issued client without the agent name hint', () => {
    const url = new URL(buildAuthorizeUrl({ ...base, clientId: 'oaiapp_123', idTokenHint: 'old.id.token', loginHint: 'me@example.com' }))
    expect(url.searchParams.get('client_id')).toBe('oaiapp_123')
    expect(url.searchParams.has('agent_name_hint')).toBe(false)
    expect(url.searchParams.get('id_token_hint')).toBe('old.id.token')
    expect(url.searchParams.get('login_hint')).toBe('me@example.com')
  })
})

describe('parseCallbackParams', () => {
  it('reads a pasted callback url', () => {
    const params = parseCallbackParams('  http://127.0.0.1:1455/auth/callback?code=abc&state=xyz&client_id=oaiapp_1  ')
    expect(params.get('code')).toBe('abc')
    expect(params.get('state')).toBe('xyz')
    expect(params.get('client_id')).toBe('oaiapp_1')
  })

  it('reads a bare query string', () => {
    expect(parseCallbackParams('code=abc&state=xyz').get('state')).toBe('xyz')
  })

  it('reads the whole text of the browser error page shown for the unreachable callback', () => {
    const pageText = `Chat UI Can’t Connect to the Server
Chat UI can’t open the page “127.0.0.1:1455/auth/callback?code=ac.2.AAD6hc_RW-gu&scope=openid%20profile&state=xyz-1_2&client_id=oaiapp_1” because Chat UI can’t connect to the server “127.0.0.1”.`
    const params = parseCallbackParams(pageText)
    expect(params.get('code')).toBe('ac.2.AAD6hc_RW-gu')
    expect(params.get('state')).toBe('xyz-1_2')
    expect(params.get('client_id')).toBe('oaiapp_1')
  })

  it('reads a callback url that was wrapped across lines when copied', () => {
    const params = parseCallbackParams('“127.0.0.1:1455/auth/callback?code=abc\ndef&state=xyz\n&client_id=oaiapp_1”')
    expect(params.get('code')).toBe('abcdef')
    expect(params.get('state')).toBe('xyz')
  })

  it('keeps reading parameters after a decoded scope with spaces', () => {
    const params = parseCallbackParams('"127.0.0.1:1455/auth/callback?code=abc&scope=openid profile email&state=xyz"')
    expect(params.get('code')).toBe('abc')
    expect(params.get('state')).toBe('xyz')
  })

  it('reads an error callback', () => {
    const params = parseCallbackParams('http://127.0.0.1:1455/auth/callback?error=access_denied&error_description=User%20cancelled&state=xyz')
    expect(params.get('error')).toBe('access_denied')
    expect(params.get('error_description')).toBe('User cancelled')
  })
})

describe('parseTokenResponse', () => {
  it('converts lifetimes to absolute timestamps', () => {
    const tokens = parseTokenResponse({ access_token: 'at', refresh_token: 'rt', id_token: 'it', token_type: 'Bearer', expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct', earliest_refresh_at: 1_000_100 }, 1_000_000_000)
    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt', idToken: 'it', expiresAt: 1_000_000_000 + 3_600_000, earliestRefreshAt: 1_000_100_000, scope: 'openid chatgpt.tokens.use.direct' })
  })

  it('keeps the previous refresh token and id token when a refresh omits them', () => {
    const tokens = parseTokenResponse({ access_token: 'at2', expires_in: 3600 }, 0, { refreshToken: 'rt1', idToken: 'it1', scope: 'openid' })
    expect(tokens.refreshToken).toBe('rt1')
    expect(tokens.idToken).toBe('it1')
    expect(tokens.scope).toBe('openid')
  })

  it('rejects a response without an access token', () => {
    expect(() => parseTokenResponse({ refresh_token: 'rt' }, 0)).toThrow()
  })
})

describe('needsRefresh', () => {
  const hour = 3_600_000

  it('refreshes within five minutes of expiry', () => {
    expect(needsRefresh({ expiresAt: hour }, hour - 6 * 60_000)).toBe(false)
    expect(needsRefresh({ expiresAt: hour }, hour - 4 * 60_000)).toBe(true)
  })

  it('waits for earliest_refresh_at', () => {
    expect(needsRefresh({ expiresAt: hour, earliestRefreshAt: hour - 60_000 }, hour - 2 * 60_000)).toBe(false)
    expect(needsRefresh({ expiresAt: hour, earliestRefreshAt: hour - 60_000 }, hour - 30_000)).toBe(true)
  })
})

describe('verifyIdToken', () => {
  let keyPair: CryptoKeyPair
  let jwk: Record<string, unknown>

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

  const sign = async (claims: Record<string, unknown>, kid = 'key-1', privateKey = keyPair.privateKey) => {
    const unsigned = `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode(claims)}`
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsigned))
    return `${unsigned}.${Buffer.from(signature).toString('base64url')}`
  }

  const nowSeconds = 1_800_000_000
  const validClaims = { iss: ISSUER, aud: ['oaiapp_1'], sub: 'user-sub', email: 'me@example.com', name: 'Me', nonce: 'nonce-1', iat: nowSeconds - 10, exp: nowSeconds + 3600 }
  const options = { issuer: ISSUER, jwksUri: JWKS_URI, clientId: 'oaiapp_1', nonce: 'nonce-1', now: nowSeconds * 1000 }

  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'key-1', alg: 'RS256', use: 'sig' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (String(input) !== JWKS_URI) throw new Error(`unexpected fetch ${String(input)}`)
        return Response.json({ keys: [jwk] })
      }),
    )
  })

  it('returns the identity for a valid token', async () => {
    expect(await verifyIdToken(await sign(validClaims), options)).toEqual({ sub: 'user-sub', email: 'me@example.com', name: 'Me' })
  })

  it('accepts a string audience', async () => {
    expect((await verifyIdToken(await sign({ ...validClaims, aud: 'oaiapp_1' }), options)).sub).toBe('user-sub')
  })

  it.each([
    ['issuer', { iss: 'https://evil.example.com' }],
    ['audience', { aud: ['other_client'] }],
    ['nonce', { nonce: 'other-nonce' }],
    ['expiry', { exp: nowSeconds - 600 }],
    ['subject', { sub: undefined }],
  ])('rejects a token with the wrong %s', async (_, override) => {
    await expect(verifyIdToken(await sign({ ...validClaims, ...override }), options)).rejects.toThrow()
  })

  it('rejects a token signed by another key', async () => {
    const otherPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
    await expect(verifyIdToken(await sign(validClaims, 'key-1', otherPair.privateKey), options)).rejects.toThrow()
  })

  it('rejects an unknown key id', async () => {
    await expect(verifyIdToken(await sign(validClaims, 'missing-kid'), options)).rejects.toThrow()
  })

  it('rejects a tampered payload', async () => {
    const [header, , signature] = (await sign(validClaims)).split('.')
    await expect(verifyIdToken(`${header}.${encode({ ...validClaims, sub: 'attacker' })}.${signature}`, options)).rejects.toThrow()
  })
})

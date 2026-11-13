import { OAuthError, type TokenSet } from './oauth'
import { CHATGPT_PROVIDER, CHATGPT_REGISTRATION, completeChatGPTSignIn, disconnectChatGPT, getChatGPTAccessToken, getChatGPTAccount, pendingSignInOrigin, startChatGPTSignIn } from './session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; user: string; provider: string; encryptedKey: string; iv: string }

const mocks = vi.hoisted(() => ({
  rows: [] as Row[],
  nextId: 0,
}))

vi.mock('#lib/server/pb.ts', () => {
  const find = (filter: string) => {
    const { params } = JSON.parse(filter)
    return mocks.rows.find(row => row.user === params.u && row.provider === params.p)
  }
  return {
    pb: {
      filter: (expr: string, params?: Record<string, unknown>) => JSON.stringify({ expr, params: params ?? {} }),
      collection: () => ({
        getFirstListItem: async (filter: string) => {
          const row = find(filter)
          if (!row) throw Object.assign(new Error('not found'), { status: 404 })
          return { ...row, createdAt: '', updatedAt: '' }
        },
        update: async (id: string, data: Partial<Row>) => {
          const row = mocks.rows.find(r => r.id === id)
          if (!row) throw new Error('missing row')
          Object.assign(row, data)
          return row
        },
        delete: async (id: string) => {
          mocks.rows = mocks.rows.filter(r => r.id !== id)
        },
      }),
    },
    getFirstOrNull: async (p: Promise<unknown>) => {
      try {
        return await p
      } catch {
        return null
      }
    },
    createOrRecover: async (_collection: string, data: Row) => {
      const row = { ...data, id: `row-${++mocks.nextId}` }
      mocks.rows.push(row)
      return row
    },
  }
})

vi.mock('#lib/server/crypto.ts', () => ({
  encrypt: async (plaintext: string) => ({ encrypted: plaintext, iv: 'iv' }),
  decrypt: async (encrypted: string) => encrypted,
}))

const oauth = vi.hoisted(() => ({
  getDiscovery: vi.fn(),
  exchangeCode: vi.fn(),
  refreshTokens: vi.fn(),
  revokeRefreshToken: vi.fn(),
  verifyIdToken: vi.fn(),
}))

vi.mock('./oauth', async importOriginal => ({ ...(await importOriginal<typeof import('./oauth')>()), ...oauth }))

const DISCOVERY = {
  issuer: 'https://auth.openai.com',
  authorizationEndpoint: 'https://auth.openai.com/api/accounts/authorize',
  tokenEndpoint: 'https://auth.openai.com/api/accounts/oauth/token',
  revocationEndpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
  jwksUri: 'https://auth.openai.com/.well-known/jwks.json',
}

const APP_URL = new URL('http://localhost:5179/settings')

const tokens = (overrides: Partial<TokenSet> = {}): TokenSet => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  idToken: 'id-token-1',
  expiresAt: Date.now() + 3_600_000,
  scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
  ...overrides,
})

const record = (user: string, provider: string) => {
  const row = mocks.rows.find(r => r.user === user && r.provider === provider)
  return row ? JSON.parse(row.encryptedKey) : null
}

const seed = (user: string, provider: string, value: unknown) => {
  mocks.rows.push({ id: `row-${++mocks.nextId}`, user, provider, encryptedKey: JSON.stringify(value), iv: 'iv' })
}

const stateOf = (url: string) => new URL(url).searchParams.get('state') ?? ''

const callback = (state: string, extra: Record<string, string> = {}) => new URLSearchParams({ code: 'code-1', state, ...extra })

const connect = async (user = 'u1') => {
  const { url } = await startChatGPTSignIn(user, APP_URL)
  return completeChatGPTSignIn(user, callback(stateOf(url), { client_id: 'oaiapp_1' }))
}

beforeEach(() => {
  mocks.rows = []
  for (const fn of Object.values(oauth)) {
    fn.mockReset()
  }
  oauth.getDiscovery.mockResolvedValue(DISCOVERY)
  oauth.exchangeCode.mockResolvedValue(tokens())
  oauth.verifyIdToken.mockResolvedValue({ sub: 'sub-1', email: 'me@example.com', name: 'Me' })
  oauth.revokeRefreshToken.mockResolvedValue(undefined)
})

describe('startChatGPTSignIn', () => {
  it('persists a host id before the first sign-in and registers a new client', async () => {
    const { url, callbackReachesApp } = await startChatGPTSignIn('u1', APP_URL)
    const params = new URL(url).searchParams
    const hostId = record('u1', CHATGPT_REGISTRATION).hostId
    expect(hostId).toMatch(/^urn:uuid:[0-9a-f-]{36}$/)
    expect(params.get('ext_agent_host_id')).toBe(hostId)
    expect(params.get('client_id')).toBe('dynamic_agent_client')
    expect(params.get('redirect_uri')).toBe('http://127.0.0.1:5179/auth/callback')
    expect(callbackReachesApp).toBe(true)
  })

  it('reuses the host id and issued client on later sign-ins', async () => {
    seed('u1', CHATGPT_REGISTRATION, { hostId: 'urn:uuid:host', clientId: 'oaiapp_1', email: 'me@example.com', idToken: 'old-id' })
    const params = new URL((await startChatGPTSignIn('u1', APP_URL)).url).searchParams
    expect(params.get('ext_agent_host_id')).toBe('urn:uuid:host')
    expect(params.get('client_id')).toBe('oaiapp_1')
    expect(params.get('id_token_hint')).toBe('old-id')
    expect(params.get('login_hint')).toBe('me@example.com')
  })

  it('remembers where to send the browser back to', async () => {
    const { url } = await startChatGPTSignIn('u1', APP_URL)
    expect(pendingSignInOrigin(stateOf(url))).toBe('http://localhost:5179')
    expect(pendingSignInOrigin('unknown')).toBeNull()
  })

  it('reports that a remote app cannot receive the callback', async () => {
    expect((await startChatGPTSignIn('u1', new URL('https://chat.example.com/settings'))).callbackReachesApp).toBe(false)
  })
})

describe('completeChatGPTSignIn', () => {
  it('exchanges the code with the issued client and stores the session', async () => {
    const { url } = await startChatGPTSignIn('u1', APP_URL)
    const state = stateOf(url)
    const account = await completeChatGPTSignIn('u1', callback(state, { client_id: 'oaiapp_1' }))

    expect(account).toEqual({ email: 'me@example.com', name: 'Me' })
    expect(oauth.exchangeCode).toHaveBeenCalledWith(DISCOVERY, expect.objectContaining({ clientId: 'oaiapp_1', code: 'code-1', redirectUri: 'http://127.0.0.1:5179/auth/callback' }))
    expect(oauth.verifyIdToken).toHaveBeenCalledWith('id-token-1', expect.objectContaining({ clientId: 'oaiapp_1', issuer: DISCOVERY.issuer }))
    expect(record('u1', CHATGPT_PROVIDER)).toMatchObject({ clientId: 'oaiapp_1', sub: 'sub-1', tokens: { accessToken: 'access-1' } })
    expect(record('u1', CHATGPT_REGISTRATION)).toMatchObject({ clientId: 'oaiapp_1', sub: 'sub-1', email: 'me@example.com', idToken: 'id-token-1' })
    expect(pendingSignInOrigin(state)).toBeNull()
  })

  it('rejects an unknown or reused state', async () => {
    await expect(completeChatGPTSignIn('u1', callback('forged'))).rejects.toThrow(/expired/)
    const { url } = await startChatGPTSignIn('u1', APP_URL)
    await completeChatGPTSignIn('u1', callback(stateOf(url), { client_id: 'oaiapp_1' }))
    await expect(completeChatGPTSignIn('u1', callback(stateOf(url), { client_id: 'oaiapp_1' }))).rejects.toThrow(/expired/)
    expect(oauth.exchangeCode).toHaveBeenCalledTimes(1)
  })

  it('rejects a callback for a sign-in started by another user', async () => {
    const { url } = await startChatGPTSignIn('u1', APP_URL)
    await expect(completeChatGPTSignIn('u2', callback(stateOf(url), { client_id: 'oaiapp_1' }))).rejects.toThrow(/expired/)
    expect(oauth.exchangeCode).not.toHaveBeenCalled()
  })

  it('stops when the user cancels without exchanging a code', async () => {
    const { url } = await startChatGPTSignIn('u1', APP_URL)
    await expect(completeChatGPTSignIn('u1', new URLSearchParams({ error: 'access_denied', state: stateOf(url) }))).rejects.toThrow(/cancelled/)
    expect(oauth.exchangeCode).not.toHaveBeenCalled()
  })

  it('rejects a callback that switches to a different client', async () => {
    seed('u1', CHATGPT_REGISTRATION, { hostId: 'urn:uuid:host', clientId: 'oaiapp_1' })
    const { url } = await startChatGPTSignIn('u1', APP_URL)
    await expect(completeChatGPTSignIn('u1', callback(stateOf(url), { client_id: 'oaiapp_other' }))).rejects.toThrow()
    expect(oauth.exchangeCode).not.toHaveBeenCalled()
  })

  it('keeps the saved client when reauthorization omits client_id', async () => {
    seed('u1', CHATGPT_REGISTRATION, { hostId: 'urn:uuid:host', clientId: 'oaiapp_1' })
    const { url } = await startChatGPTSignIn('u1', APP_URL)
    await completeChatGPTSignIn('u1', callback(stateOf(url)))
    expect(oauth.exchangeCode).toHaveBeenCalledWith(DISCOVERY, expect.objectContaining({ clientId: 'oaiapp_1' }))
  })

  it('never stores the dynamic client id as the issued client', async () => {
    const { url } = await startChatGPTSignIn('u1', APP_URL)
    await expect(completeChatGPTSignIn('u1', callback(stateOf(url), { client_id: 'dynamic_agent_client' }))).rejects.toThrow()
    expect(record('u1', CHATGPT_REGISTRATION).clientId).toBeUndefined()
  })

  it('does not store a session when plan usage was not granted', async () => {
    oauth.exchangeCode.mockResolvedValue(tokens({ scope: 'openid profile email offline_access' }))
    const { url } = await startChatGPTSignIn('u1', APP_URL)
    await expect(completeChatGPTSignIn('u1', callback(stateOf(url), { client_id: 'oaiapp_1' }))).rejects.toThrow(/plan/)
    expect(record('u1', CHATGPT_PROVIDER)).toBeNull()
    expect(record('u1', CHATGPT_REGISTRATION).clientId).toBe('oaiapp_1')
  })

  it('rejects a different ChatGPT account and starts a fresh registration next time', async () => {
    seed('u1', CHATGPT_REGISTRATION, { hostId: 'urn:uuid:host', clientId: 'oaiapp_1', sub: 'sub-1' })
    oauth.verifyIdToken.mockResolvedValue({ sub: 'sub-2', email: 'other@example.com' })
    const { url } = await startChatGPTSignIn('u1', APP_URL)
    await expect(completeChatGPTSignIn('u1', callback(stateOf(url)))).rejects.toThrow(/different ChatGPT account/)
    expect(record('u1', CHATGPT_PROVIDER)).toBeNull()
    expect(record('u1', CHATGPT_REGISTRATION)).toEqual({ hostId: 'urn:uuid:host' })
  })
})

describe('getChatGPTAccessToken', () => {
  it('returns null when not connected', async () => {
    expect(await getChatGPTAccessToken('u1')).toBeNull()
  })

  it('returns the stored token while it is fresh', async () => {
    await connect()
    expect(await getChatGPTAccessToken('u1')).toBe('access-1')
    expect(oauth.refreshTokens).not.toHaveBeenCalled()
  })

  it('refreshes once for concurrent callers and stores the rotated tokens', async () => {
    oauth.exchangeCode.mockResolvedValue(tokens({ expiresAt: Date.now() + 60_000 }))
    await connect()
    oauth.refreshTokens.mockResolvedValue(tokens({ accessToken: 'access-2', refreshToken: 'refresh-2' }))

    const results = await Promise.all([getChatGPTAccessToken('u1'), getChatGPTAccessToken('u1')])

    expect(results).toEqual(['access-2', 'access-2'])
    expect(oauth.refreshTokens).toHaveBeenCalledTimes(1)
    expect(oauth.refreshTokens).toHaveBeenCalledWith(DISCOVERY, 'oaiapp_1', expect.objectContaining({ refreshToken: 'refresh-1' }))
    expect(record('u1', CHATGPT_PROVIDER).tokens).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' })
  })

  it('refreshes a rejected token even when the stored expiry is still in the future', async () => {
    await connect()
    oauth.refreshTokens.mockResolvedValue(tokens({ accessToken: 'access-2', refreshToken: 'refresh-2' }))
    expect(await getChatGPTAccessToken('u1', 'access-1')).toBe('access-2')
    expect(oauth.refreshTokens).toHaveBeenCalledTimes(1)
  })

  it('reuses a newer token when another request already refreshed the rejected one', async () => {
    await connect()
    oauth.refreshTokens.mockResolvedValue(tokens({ accessToken: 'access-2', refreshToken: 'refresh-2' }))
    const results = await Promise.all([getChatGPTAccessToken('u1', 'access-1'), getChatGPTAccessToken('u1', 'access-1')])
    expect(results).toEqual(['access-2', 'access-2'])
    expect(await getChatGPTAccessToken('u1', 'access-1')).toBe('access-2')
    expect(oauth.refreshTokens).toHaveBeenCalledTimes(1)
  })

  it('does not lose forced refresh behind an in-flight normal token lookup', async () => {
    await connect()
    oauth.refreshTokens.mockResolvedValue(tokens({ accessToken: 'access-2' }))
    const results = await Promise.all([getChatGPTAccessToken('u1'), getChatGPTAccessToken('u1', 'access-1'), getChatGPTAccessToken('u1', 'access-1')])
    expect(results).toEqual(['access-1', 'access-2', 'access-2'])
    expect(oauth.refreshTokens).toHaveBeenCalledTimes(1)
  })

  it('never returns a rejected token as the temporary-refresh fallback', async () => {
    await connect()
    oauth.refreshTokens.mockRejectedValue(new OAuthError('http_503', 'unavailable'))
    await expect(getChatGPTAccessToken('u1', 'access-1')).rejects.toThrow('unavailable')
    expect(record('u1', CHATGPT_PROVIDER)).not.toBeNull()
  })

  it('clears the session after a terminal refresh error', async () => {
    oauth.exchangeCode.mockResolvedValue(tokens({ expiresAt: Date.now() + 60_000 }))
    await connect()
    oauth.refreshTokens.mockRejectedValue(new OAuthError('refresh_token_reused', 'reused'))

    expect(await getChatGPTAccessToken('u1')).toBeNull()
    expect(record('u1', CHATGPT_PROVIDER)).toBeNull()
    expect(record('u1', CHATGPT_REGISTRATION).clientId).toBe('oaiapp_1')
  })

  it('keeps using a still valid token when refresh fails temporarily', async () => {
    oauth.exchangeCode.mockResolvedValue(tokens({ expiresAt: Date.now() + 60_000 }))
    await connect()
    oauth.refreshTokens.mockRejectedValue(new OAuthError('http_503', 'unavailable'))

    expect(await getChatGPTAccessToken('u1')).toBe('access-1')
    expect(record('u1', CHATGPT_PROVIDER)).not.toBeNull()
  })

  it('throws when refresh fails temporarily and the token has expired', async () => {
    oauth.exchangeCode.mockResolvedValue(tokens({ expiresAt: Date.now() - 1000 }))
    await connect()
    oauth.refreshTokens.mockRejectedValue(new OAuthError('http_503', 'unavailable'))

    await expect(getChatGPTAccessToken('u1')).rejects.toThrow()
    expect(record('u1', CHATGPT_PROVIDER)).not.toBeNull()
  })
})

describe('getChatGPTAccount', () => {
  it('returns the connected identity', async () => {
    expect(await getChatGPTAccount('u1')).toBeNull()
    await connect()
    expect(await getChatGPTAccount('u1')).toEqual({ email: 'me@example.com', name: 'Me' })
  })
})

describe('disconnectChatGPT', () => {
  it('revokes the refresh token, clears the session and keeps the registration', async () => {
    await connect()
    expect(await disconnectChatGPT('u1')).toEqual({ revoked: true })
    expect(oauth.revokeRefreshToken).toHaveBeenCalledWith(DISCOVERY, 'oaiapp_1', 'refresh-1')
    expect(record('u1', CHATGPT_PROVIDER)).toBeNull()
    expect(record('u1', CHATGPT_REGISTRATION).clientId).toBe('oaiapp_1')
  })

  it('clears the session even when revocation cannot be confirmed', async () => {
    await connect()
    oauth.revokeRefreshToken.mockRejectedValue(new Error('network down'))
    expect(await disconnectChatGPT('u1')).toEqual({ revoked: false })
    expect(record('u1', CHATGPT_PROVIDER)).toBeNull()
  })
})

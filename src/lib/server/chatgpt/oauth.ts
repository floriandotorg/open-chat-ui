export const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
export const PLAN_RESOURCE = 'https://api.openai.com/v1'
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
export const CALLBACK_PATH = '/auth/callback'

const DISCOVERY_URL = 'https://auth.openai.com/.well-known/openid-configuration'
const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', PLAN_SCOPE].join(' ')
const AGENT_NAME = 'Open Chat UI'
const REMOTE_CALLBACK_PORT = '1455'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const REFRESH_MARGIN_MS = 5 * 60_000
const CLOCK_SKEW_SECONDS = 120
const DISCOVERY_TTL_MS = 60 * 60_000

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type TokenSet = {
  accessToken: string
  refreshToken: string
  idToken?: string
  expiresAt: number
  earliestRefreshAt?: number
  scope: string
}

export type Discovery = {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  revocationEndpoint: string
  jwksUri: string
}

export type IdTokenIdentity = { sub: string; email?: string; name?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

const stringField = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  return typeof value === 'string' && value ? value : undefined
}

const requireString = (record: Record<string, unknown>, key: string, context: string): string => {
  const value = stringField(record, key)
  if (!value) {
    throw new OAuthError('invalid_response', `${context} is missing ${key}`)
  }
  return value
}

const base64Url = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url')

export const randomToken = () => base64Url(crypto.getRandomValues(new Uint8Array(32)))

export const pkceChallenge = async (verifier: string) => base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))

export const isServedOnLoopback = (appUrl: URL) => appUrl.protocol === 'http:' && LOOPBACK_HOSTS.has(appUrl.hostname)

export const callbackRedirectUri = (appUrl: URL) => `http://127.0.0.1:${isServedOnLoopback(appUrl) ? appUrl.port || '80' : REMOTE_CALLBACK_PORT}${CALLBACK_PATH}`

type AuthorizeUrlParams = {
  authorizationEndpoint: string
  clientId: string | null
  hostId: string
  redirectUri: string
  state: string
  nonce: string
  codeChallenge: string
  idTokenHint?: string
  loginHint?: string
}

export const buildAuthorizeUrl = (params: AuthorizeUrlParams) => {
  const query: [string, string | undefined][] = [
    ['client_id', params.clientId ?? DYNAMIC_CLIENT_ID],
    ['agent_name_hint', params.clientId ? undefined : AGENT_NAME],
    ['ext_agent_host_id', params.hostId],
    ['id_token_hint', params.idTokenHint],
    ['login_hint', params.loginHint],
    ['response_type', 'code'],
    ['redirect_uri', params.redirectUri],
    ['scope', SCOPES],
    ['resource', PLAN_RESOURCE],
    ['state', params.state],
    ['nonce', params.nonce],
    ['code_challenge_method', 'S256'],
    ['code_challenge', params.codeChallenge],
  ]
  const encoded = query.flatMap(([key, value]) => (value ? [`${key}=${encodeURIComponent(value)}`] : []))
  return `${params.authorizationEndpoint}?${encoded.join('&')}`
}

export const parseCallbackParams = (input: string) => {
  const trimmed = input.trim()
  return new URLSearchParams(trimmed.slice(trimmed.indexOf('?') + 1).split('#')[0])
}

const timestampMs = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * 1000
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

export const parseTokenResponse = (data: unknown, now: number, previous?: { refreshToken: string; idToken?: string; scope: string }): TokenSet => {
  if (!isRecord(data)) {
    throw new OAuthError('invalid_response', 'Token response is not an object')
  }
  const refreshToken = stringField(data, 'refresh_token') ?? previous?.refreshToken
  if (!refreshToken) {
    throw new OAuthError('invalid_response', 'Token response is missing refresh_token')
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  return {
    accessToken: requireString(data, 'access_token', 'Token response'),
    refreshToken,
    idToken: stringField(data, 'id_token') ?? previous?.idToken,
    expiresAt: now + expiresIn * 1000,
    earliestRefreshAt: timestampMs(data.earliest_refresh_at),
    scope: stringField(data, 'scope') ?? previous?.scope ?? '',
  }
}

export const needsRefresh = (tokens: Pick<TokenSet, 'expiresAt' | 'earliestRefreshAt'>, now: number) => now >= tokens.expiresAt - REFRESH_MARGIN_MS && now >= (tokens.earliestRefreshAt ?? 0)

export const hasPlanScope = (scope: string) => scope.split(' ').includes(PLAN_SCOPE)

let discoveryCache: { value: Discovery; at: number } | null = null

export const getDiscovery = async (): Promise<Discovery> => {
  if (discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) {
    return discoveryCache.value
  }
  const res = await fetch(DISCOVERY_URL)
  if (!res.ok) {
    throw new OAuthError('discovery_failed', `OpenAI sign-in is unavailable (${res.status})`)
  }
  const data: unknown = await res.json()
  if (!isRecord(data)) {
    throw new OAuthError('invalid_response', 'Discovery document is not an object')
  }
  const value: Discovery = {
    issuer: requireString(data, 'issuer', 'Discovery document'),
    authorizationEndpoint: requireString(data, 'authorization_endpoint', 'Discovery document'),
    tokenEndpoint: requireString(data, 'token_endpoint', 'Discovery document'),
    revocationEndpoint: requireString(data, 'revocation_endpoint', 'Discovery document'),
    jwksUri: requireString(data, 'jwks_uri', 'Discovery document'),
  }
  discoveryCache = { value, at: Date.now() }
  return value
}

const postForm = async (endpoint: string, body: Record<string, string>): Promise<unknown> => {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body),
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code = isRecord(data) ? (stringField(data, 'error') ?? (isRecord(data.error) ? stringField(data.error, 'code') : undefined)) : undefined
    const description = isRecord(data) ? (stringField(data, 'error_description') ?? (isRecord(data.error) ? stringField(data.error, 'message') : undefined)) : undefined
    throw new OAuthError(code ?? `http_${res.status}`, description ?? code ?? `OpenAI sign-in failed (${res.status})`)
  }
  return data
}

export const exchangeCode = async (discovery: Discovery, params: { clientId: string; code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet> =>
  parseTokenResponse(
    await postForm(discovery.tokenEndpoint, {
      grant_type: 'authorization_code',
      client_id: params.clientId,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
      resource: PLAN_RESOURCE,
    }),
    Date.now(),
  )

export const refreshTokens = async (discovery: Discovery, clientId: string, previous: TokenSet): Promise<TokenSet> =>
  parseTokenResponse(
    await postForm(discovery.tokenEndpoint, {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: previous.refreshToken,
      resource: PLAN_RESOURCE,
    }),
    Date.now(),
    previous,
  )

export const revokeRefreshToken = async (discovery: Discovery, clientId: string, refreshToken: string) => {
  await postForm(discovery.revocationEndpoint, { token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId })
}

const decodeJson = (segment: string): unknown => {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

let jwksCache: { uri: string; keys: Record<string, unknown>[] } | null = null

const fetchJwks = async (uri: string): Promise<Record<string, unknown>[]> => {
  const res = await fetch(uri)
  if (!res.ok) {
    throw new OAuthError('jwks_failed', `Could not load OpenAI signing keys (${res.status})`)
  }
  const data: unknown = await res.json()
  const keys = isRecord(data) && Array.isArray(data.keys) ? data.keys.filter(isRecord) : []
  jwksCache = { uri, keys }
  return keys
}

const findSigningKey = async (uri: string, kid: string): Promise<JsonWebKey> => {
  const byKid = (keys: Record<string, unknown>[]) => keys.find(key => key.kid === kid && key.kty === 'RSA')
  const cached = jwksCache?.uri === uri ? byKid(jwksCache.keys) : undefined
  const key = cached ?? byKid(await fetchJwks(uri))
  const n = key && stringField(key, 'n')
  const e = key && stringField(key, 'e')
  if (!n || !e) {
    throw new OAuthError('invalid_id_token', 'ID token was signed with an unknown key')
  }
  return { kty: 'RSA', n, e, alg: 'RS256', ext: true }
}

export const verifyIdToken = async (idToken: string, options: { issuer: string; jwksUri: string; clientId: string; nonce: string; now: number }): Promise<IdTokenIdentity> => {
  const [headerSegment, payloadSegment, signatureSegment] = idToken.split('.')
  const header = decodeJson(headerSegment ?? '')
  const claims = decodeJson(payloadSegment ?? '')
  if (!signatureSegment || !isRecord(header) || !isRecord(claims)) {
    throw new OAuthError('invalid_id_token', 'ID token is malformed')
  }
  const kid = stringField(header, 'kid')
  if (header.alg !== 'RS256' || !kid) {
    throw new OAuthError('invalid_id_token', 'ID token uses an unsupported signature')
  }
  const publicKey = await crypto.subtle.importKey('jwk', await findSigningKey(options.jwksUri, kid), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const signedBytes = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`)
  const validSignature = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, Buffer.from(signatureSegment, 'base64url'), signedBytes)
  if (!validSignature) {
    throw new OAuthError('invalid_id_token', 'ID token signature is invalid')
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  const nowSeconds = options.now / 1000
  if (claims.iss !== options.issuer) {
    throw new OAuthError('invalid_id_token', 'ID token issuer does not match')
  }
  if (!audiences.includes(options.clientId)) {
    throw new OAuthError('invalid_id_token', 'ID token audience does not match')
  }
  if (claims.nonce !== options.nonce) {
    throw new OAuthError('invalid_id_token', 'ID token nonce does not match')
  }
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new OAuthError('invalid_id_token', 'ID token has expired')
  }

  return { sub: requireString(claims, 'sub', 'ID token'), email: stringField(claims, 'email'), name: stringField(claims, 'name') }
}

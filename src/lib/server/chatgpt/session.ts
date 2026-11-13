import { decrypt, encrypt } from '#lib/server/crypto.ts'
import { mapApiKey, now } from '#lib/server/db/records.ts'
import { createOrRecover, getFirstOrNull, pb } from '#lib/server/pb.ts'
import { buildAuthorizeUrl, callbackRedirectUri, DYNAMIC_CLIENT_ID, exchangeCode, getDiscovery, hasPlanScope, isServedOnLoopback, needsRefresh, OAuthError, pkceChallenge, randomToken, refreshTokens, revokeRefreshToken, type TokenSet, verifyIdToken } from './oauth'

export const CHATGPT_PROVIDER = 'chatgpt'
export const CHATGPT_REGISTRATION = 'chatgpt-registration'

const PENDING_TTL_MS = 10 * 60_000
const TERMINAL_REFRESH_ERRORS = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'])

export class ChatGPTSignInError extends Error {}

type Registration = { hostId: string; clientId?: string; sub?: string; email?: string; idToken?: string }

type Session = { clientId: string; sub: string; email?: string; name?: string; tokens: TokenSet }

type PendingSignIn = { userId: string; origin: string; clientId?: string; codeVerifier: string; nonce: string; redirectUri: string; expiresAt: number }

export type ChatGPTAccount = { email?: string; name?: string }

const pendingSignIns = new Map<string, PendingSignIn>()
const inflightRefreshes = new Map<string, { promise: Promise<string | null>; rejectedToken?: string }>()

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

const optionalString = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

const parseRegistration = (value: unknown): Registration | null => {
  if (!isRecord(value) || typeof value.hostId !== 'string') {
    return null
  }
  return { hostId: value.hostId, clientId: optionalString(value.clientId), sub: optionalString(value.sub), email: optionalString(value.email), idToken: optionalString(value.idToken) }
}

const parseTokens = (value: unknown): TokenSet | null => {
  if (!isRecord(value) || typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string' || typeof value.expiresAt !== 'number') {
    return null
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    idToken: optionalString(value.idToken),
    expiresAt: value.expiresAt,
    earliestRefreshAt: typeof value.earliestRefreshAt === 'number' ? value.earliestRefreshAt : undefined,
    scope: typeof value.scope === 'string' ? value.scope : '',
  }
}

const parseSession = (value: unknown): Session | null => {
  const tokens = isRecord(value) ? parseTokens(value.tokens) : null
  if (!isRecord(value) || !tokens || typeof value.clientId !== 'string' || typeof value.sub !== 'string') {
    return null
  }
  return { clientId: value.clientId, sub: value.sub, email: optionalString(value.email), name: optionalString(value.name), tokens }
}

const rowFilter = (userId: string, provider: string) => pb.filter('user = {:u} && provider = {:p}', { u: userId, p: provider })

const findRow = (userId: string, provider: string) => getFirstOrNull(pb.collection('api_keys').getFirstListItem(rowFilter(userId, provider)).then(mapApiKey))

const readRecord = async <T>(userId: string, provider: string, parse: (value: unknown) => T | null): Promise<T | null> => {
  const row = await findRow(userId, provider)
  if (!row) {
    return null
  }
  try {
    return parse(JSON.parse(await decrypt(row.encryptedKey, row.iv)))
  } catch {
    return null
  }
}

const writeRecord = async (userId: string, provider: string, value: Registration | Session) => {
  const { encrypted, iv } = await encrypt(JSON.stringify(value))
  const existing = await findRow(userId, provider)
  if (existing) {
    await pb.collection('api_keys').update(existing.id, { encryptedKey: encrypted, iv, updatedAt: now() })
    return
  }
  await createOrRecover('api_keys', { user: userId, provider, encryptedKey: encrypted, iv, createdAt: now(), updatedAt: now() }, rowFilter(userId, provider), { encryptedKey: encrypted, iv, updatedAt: now() })
}

const deleteRecord = async (userId: string, provider: string) => {
  const row = await findRow(userId, provider)
  if (row) {
    await pb.collection('api_keys').delete(row.id)
  }
}

const readRegistration = (userId: string) => readRecord(userId, CHATGPT_REGISTRATION, parseRegistration)

const readSession = (userId: string) => readRecord(userId, CHATGPT_PROVIDER, parseSession)

const ensureRegistration = async (userId: string): Promise<Registration> => {
  const existing = await readRegistration(userId)
  if (existing) {
    return existing
  }
  const registration = { hostId: `urn:uuid:${crypto.randomUUID()}` }
  await writeRecord(userId, CHATGPT_REGISTRATION, registration)
  return registration
}

const prunePendingSignIns = () => {
  for (const [state, pending] of pendingSignIns) {
    if (pending.expiresAt < Date.now()) {
      pendingSignIns.delete(state)
    }
  }
}

export const startChatGPTSignIn = async (userId: string, appUrl: URL) => {
  const [discovery, registration] = await Promise.all([getDiscovery(), ensureRegistration(userId)])
  const state = randomToken()
  const nonce = randomToken()
  const codeVerifier = randomToken()
  const redirectUri = callbackRedirectUri(appUrl)

  prunePendingSignIns()
  pendingSignIns.set(state, { userId, origin: appUrl.origin, clientId: registration.clientId, codeVerifier, nonce, redirectUri, expiresAt: Date.now() + PENDING_TTL_MS })

  const url = buildAuthorizeUrl({
    authorizationEndpoint: discovery.authorizationEndpoint,
    clientId: registration.clientId ?? null,
    hostId: registration.hostId,
    redirectUri,
    state,
    nonce,
    codeChallenge: await pkceChallenge(codeVerifier),
    idTokenHint: registration.clientId ? registration.idToken : undefined,
    loginHint: registration.clientId ? registration.email : undefined,
  })
  return { url, callbackReachesApp: isServedOnLoopback(appUrl) }
}

export const pendingSignInOrigin = (state: string) => {
  const pending = pendingSignIns.get(state)
  return pending && pending.expiresAt >= Date.now() ? pending.origin : null
}

const takePendingSignIn = (userId: string, state: string | null) => {
  const pending = state ? pendingSignIns.get(state) : undefined
  if (!state || !pending || pending.userId !== userId || pending.expiresAt < Date.now()) {
    throw new ChatGPTSignInError('This sign-in link expired. Start again with Continue with ChatGPT.')
  }
  pendingSignIns.delete(state)
  return pending
}

const resolveClientId = (pending: PendingSignIn, callbackClientId: string | null) => {
  if (pending.clientId && callbackClientId && callbackClientId !== pending.clientId) {
    throw new ChatGPTSignInError('ChatGPT returned a different app registration. Start again with Continue with ChatGPT.')
  }
  const clientId = pending.clientId ?? callbackClientId
  if (!clientId || clientId === DYNAMIC_CLIENT_ID) {
    throw new ChatGPTSignInError('ChatGPT did not return an app registration. Start again with Continue with ChatGPT.')
  }
  return clientId
}

export const completeChatGPTSignIn = async (userId: string, params: URLSearchParams): Promise<ChatGPTAccount> => {
  const pending = takePendingSignIn(userId, params.get('state'))
  const error = params.get('error')
  if (error) {
    throw new ChatGPTSignInError(error === 'access_denied' ? 'ChatGPT sign-in was cancelled.' : (params.get('error_description') ?? `ChatGPT sign-in failed: ${error}`))
  }
  const code = params.get('code')
  if (!code) {
    throw new ChatGPTSignInError('The callback URL has no authorization code. Paste the full address from your browser.')
  }

  const clientId = resolveClientId(pending, params.get('client_id'))
  const [discovery, registration] = await Promise.all([getDiscovery(), ensureRegistration(userId)])
  await writeRecord(userId, CHATGPT_REGISTRATION, { ...registration, clientId })

  let tokens: TokenSet
  try {
    tokens = await exchangeCode(discovery, { clientId, code, codeVerifier: pending.codeVerifier, redirectUri: pending.redirectUri })
  } catch (err) {
    if (err instanceof OAuthError && err.code === 'invalid_grant') {
      throw new ChatGPTSignInError('This sign-in code was already used or expired. Start again with Continue with ChatGPT.')
    }
    throw err
  }
  if (!tokens.idToken) {
    throw new ChatGPTSignInError('ChatGPT did not return an ID token.')
  }

  const identity = await verifyIdToken(tokens.idToken, { issuer: discovery.issuer, jwksUri: discovery.jwksUri, clientId, nonce: pending.nonce, now: Date.now() })
  if (registration.sub && registration.sub !== identity.sub) {
    await writeRecord(userId, CHATGPT_REGISTRATION, { hostId: registration.hostId })
    throw new ChatGPTSignInError('You signed in with a different ChatGPT account than before. Click Continue with ChatGPT again to connect it.')
  }

  await writeRecord(userId, CHATGPT_REGISTRATION, { hostId: registration.hostId, clientId, sub: identity.sub, email: identity.email, idToken: tokens.idToken })
  if (!hasPlanScope(tokens.scope)) {
    throw new ChatGPTSignInError('ChatGPT plan usage was not granted. Continue with ChatGPT again and allow this app to use your plan.')
  }

  await writeRecord(userId, CHATGPT_PROVIDER, { clientId, sub: identity.sub, email: identity.email, name: identity.name, tokens })
  return { email: identity.email, name: identity.name }
}

const refreshSessionToken = async (userId: string, rejectedToken?: string): Promise<string | null> => {
  const session = await readSession(userId)
  if (!session) {
    return null
  }
  if (session.tokens.accessToken !== rejectedToken && !needsRefresh(session.tokens, Date.now())) {
    return session.tokens.accessToken
  }
  try {
    const tokens = await refreshTokens(await getDiscovery(), session.clientId, session.tokens)
    await writeRecord(userId, CHATGPT_PROVIDER, { ...session, tokens })
    return tokens.accessToken
  } catch (err) {
    if (err instanceof OAuthError && TERMINAL_REFRESH_ERRORS.has(err.code)) {
      await deleteRecord(userId, CHATGPT_PROVIDER)
      return null
    }
    if (session.tokens.accessToken !== rejectedToken && session.tokens.expiresAt > Date.now()) {
      return session.tokens.accessToken
    }
    throw err
  }
}

export const getChatGPTAccessToken = async (userId: string, rejectedToken?: string): Promise<string | null> => {
  const running = inflightRefreshes.get(userId)
  if (running) {
    const token = await running.promise
    if (!rejectedToken || token !== rejectedToken || running.rejectedToken === rejectedToken) {
      return token
    }
    return getChatGPTAccessToken(userId, rejectedToken)
  }
  const promise = refreshSessionToken(userId, rejectedToken).finally(() => inflightRefreshes.delete(userId))
  inflightRefreshes.set(userId, { promise, rejectedToken })
  return promise
}

export const getChatGPTAccount = async (userId: string): Promise<ChatGPTAccount | null> => {
  const session = await readSession(userId)
  return session ? { email: session.email, name: session.name } : null
}

export const disconnectChatGPT = async (userId: string) => {
  const session = await readSession(userId)
  let revoked = false
  if (session) {
    try {
      await revokeRefreshToken(await getDiscovery(), session.clientId, session.tokens.refreshToken)
      revoked = true
    } catch (err) {
      console.error('[chatgpt] token revocation failed:', err)
    }
  }
  await deleteRecord(userId, CHATGPT_PROVIDER)
  return { revoked }
}

import { formatModelRef } from '#lib/model-ref.ts'
import { CHATGPT_RECONNECT_MESSAGE, type ChatGPTTokenSource, resolveChatGPTToken } from '#lib/server/chatgpt/access.ts'
import { PLAN_RESOURCE } from '#lib/server/chatgpt/oauth.ts'
import { formatModelName, metaFor, type ResponsesErrorFormatter, streamResponses } from './openai'
import type { ChatStreamEvent, LLMProvider, ModelInfo } from './types'
import OpenAI from 'openai'

export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage'

const PLAN_ERROR_MESSAGES: Record<string, string> = {
  subscription_sharing_usage_limit_exceeded: `Usage limit reached. Review your plan or this app's limit in ChatGPT settings: ${CHATGPT_USAGE_URL}`,
  subscription_sharing_user_not_eligible: 'Your ChatGPT plan is not eligible for use in other apps.',
  subscription_sharing_usage_unavailable: 'ChatGPT plan usage is temporarily unavailable. Try again in a moment.',
  subscription_sharing_user_unavailable: 'ChatGPT plan usage is temporarily unavailable. Try again in a moment.',
  subscription_sharing_invalid_user: 'ChatGPT did not accept this sign-in. If it keeps happening, reconnect ChatGPT in Settings.',
}

const AUTH_ERROR_CODES = new Set(['invalid_api_key', 'invalid_token', 'token_expired', 'access_token_expired', 'authentication_error'])

const isAuthenticationError = ({ code, status }: Parameters<ResponsesErrorFormatter>[0]) => status === 401 || (code !== undefined && AUTH_ERROR_CODES.has(code))
const formatPlanError: ResponsesErrorFormatter = error => (isAuthenticationError(error) ? CHATGPT_RECONNECT_MESSAGE : (error.code && PLAN_ERROR_MESSAGES[error.code]) || error.message)

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

const toModelInfo = (raw: Record<string, unknown>): ModelInfo | null => {
  if (raw.visibility !== 'list' || typeof raw.slug !== 'string' || !raw.slug) {
    return null
  }
  const meta = metaFor(raw.slug)
  return {
    id: formatModelRef('chatgpt', raw.slug),
    name: `${typeof raw.display_name === 'string' && raw.display_name ? raw.display_name : formatModelName(raw.slug)} (ChatGPT plan)`,
    contextWindow: meta.contextWindow,
    maxOutputTokens: meta.maxOutputTokens,
    capabilities: ['streaming', 'system_prompt', 'tool_use', 'vision'],
  }
}

export const createChatGPTProvider = (accessToken: string, getAccessToken?: ChatGPTTokenSource): LLMProvider => ({
  id: 'chatgpt',
  name: 'ChatGPT plan',
  capabilities: ['streaming', 'vision', 'tool_use', 'system_prompt'],

  listModels: async () => {
    const res = await fetch(`${PLAN_RESOURCE}/models`, { headers: { authorization: `Bearer ${accessToken}` } })
    if (!res.ok) {
      throw new Error(`ChatGPT models request failed (${res.status})`)
    }
    const body: unknown = await res.json()
    const models = isRecord(body) && Array.isArray(body.models) ? body.models : []
    return models.filter(isRecord).flatMap(raw => toModelInfo(raw) ?? [])
  },

  chat: async function* (request): AsyncGenerator<ChatStreamEvent> {
    try {
      request.signal?.throwIfAborted()
      let token = getAccessToken ? await resolveChatGPTToken(getAccessToken) : accessToken
      for (let n = 0; n < 2; ++n) {
        request.signal?.throwIfAborted()
        let authenticationFailed = false
        let delivered = false
        let retry = false
        const formatError: ResponsesErrorFormatter = error => {
          authenticationFailed = isAuthenticationError(error)
          return formatPlanError(error)
        }
        const client = new OpenAI({ apiKey: token, baseURL: PLAN_RESOURCE, maxRetries: 0 })
        for await (const event of streamResponses(client, request, 'plan', formatError)) {
          request.signal?.throwIfAborted()
          if (event.type === 'error' && authenticationFailed && !delivered && n === 0 && getAccessToken) {
            retry = true
            break
          }
          delivered = true
          yield event
        }
        if (!retry || !getAccessToken) {
          return
        }
        token = await resolveChatGPTToken(getAccessToken, token)
      }
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : 'The ChatGPT request failed.' }
    }
  },
})

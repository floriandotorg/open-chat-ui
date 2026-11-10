import { requireUser } from '#lib/server/auth-guard.ts'
import { parseCallbackParams } from '#lib/server/chatgpt/oauth.ts'
import { CHATGPT_PROVIDER, ChatGPTSignInError, completeChatGPTSignIn } from '#lib/server/chatgpt/session.ts'
import { syncProviderModels } from '#lib/server/model-sync.ts'
import type { RequestHandler } from './$types'
import { error, json, redirect } from '@sveltejs/kit'

const signInErrorMessage = (err: unknown) => {
  if (err instanceof ChatGPTSignInError) {
    return err.message
  }
  console.error('[chatgpt] sign-in failed:', err)
  return err instanceof Error ? `ChatGPT sign-in failed: ${err.message}` : 'ChatGPT sign-in failed'
}

const completeSignIn = async (userId: string, params: URLSearchParams) => {
  const account = await completeChatGPTSignIn(userId, params)
  await syncProviderModels(CHATGPT_PROVIDER).catch(err => console.error('[chatgpt] model sync failed:', err))
  return account
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const userId = requireUser(locals.user).id
  let outcome: string
  try {
    await completeSignIn(userId, url.searchParams)
    outcome = 'chatgpt=connected'
  } catch (err) {
    outcome = `chatgpt_error=${encodeURIComponent(signInErrorMessage(err))}`
  }
  throw redirect(303, `/settings?tab=keys&${outcome}`)
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const userId = requireUser(locals.user).id
  const payload: unknown = await request.json().catch(() => null)
  const callbackUrl = payload && typeof payload === 'object' && 'callbackUrl' in payload && typeof payload.callbackUrl === 'string' ? payload.callbackUrl : ''
  if (!callbackUrl.trim()) {
    throw error(400, 'Paste the address your browser showed after signing in')
  }
  try {
    return json(await completeSignIn(userId, parseCallbackParams(callbackUrl)))
  } catch (err) {
    throw error(400, signInErrorMessage(err))
  }
}

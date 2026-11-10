import { requireUser } from '#lib/server/auth-guard.ts'
import { disconnectChatGPT, getChatGPTAccount, startChatGPTSignIn } from '#lib/server/chatgpt/session.ts'
import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'

export const GET: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  return json({ account: await getChatGPTAccount(userId) })
}

export const POST: RequestHandler = async ({ locals, url }) => {
  const userId = requireUser(locals.user).id
  try {
    return json(await startChatGPTSignIn(userId, url))
  } catch (err) {
    console.error('[chatgpt] sign-in start failed:', err)
    throw error(502, err instanceof Error ? err.message : 'ChatGPT sign-in is unavailable')
  }
}

export const DELETE: RequestHandler = async ({ locals }) => {
  const userId = requireUser(locals.user).id
  return json(await disconnectChatGPT(userId))
}

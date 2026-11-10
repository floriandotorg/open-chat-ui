import { pendingSignInOrigin } from '#lib/server/chatgpt/session.ts'
import type { RequestHandler } from './$types'
import { redirect } from '@sveltejs/kit'

// OpenAI only redirects to http://127.0.0.1, where the app's session cookie may
// be missing (it lives on the origin the user started from). Bounce back to that
// origin; the guarded /api/chatgpt/callback finishes the sign-in.
export const GET: RequestHandler = ({ url }) => {
  const origin = pendingSignInOrigin(url.searchParams.get('state') ?? '')
  if (!origin) {
    return new Response('This ChatGPT sign-in link expired. Start again from Settings.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  throw redirect(303, `${origin}/api/chatgpt/callback?${url.searchParams}`, { external: [origin] })
}

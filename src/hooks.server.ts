import { auth } from '$lib/server/auth'
import { building } from '$app/environment'
import type { Handle } from '@sveltejs/kit'
import { redirect } from '@sveltejs/kit'
import { svelteKitHandler } from 'better-auth/svelte-kit'

const protectedPrefixes = ['/chat', '/settings', '/api/']

const handleBetterAuth: Handle = async ({ event, resolve }) => {
  const session = await auth.api.getSession({ headers: event.request.headers })

  if (session) {
    event.locals.session = session.session
    event.locals.user = session.user
  }

  const isProtected = protectedPrefixes.some(p => event.url.pathname.startsWith(p))
  if (isProtected && !event.locals.user) {
    throw redirect(303, '/login')
  }

  return svelteKitHandler({ event, resolve, auth, building })
}

export const handle: Handle = handleBetterAuth

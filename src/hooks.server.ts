import { auth } from '$lib/server/auth'
import { reapStaleGenerations } from '$lib/server/reaper'
import { building, dev } from '$app/environment'
import type { Handle, HandleServerError } from '@sveltejs/kit'
import { redirect } from '@sveltejs/kit'
import { svelteKitHandler } from 'better-auth/svelte-kit'

if (!building) {
  reapStaleGenerations().catch(err => {
    console.error('[reaper] startup reap failed:', err)
  })
}

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  if (status >= 500) {
    const stack = error instanceof Error ? error.stack : undefined
    const detail = stack ?? (error instanceof Error ? error.message : JSON.stringify(error))
    console.error(`[${status}] ${event.request.method} ${event.url.pathname}`)
    console.error(detail)
  }
  return { message }
}

const protectedPrefixes = ['/chat', '/settings', '/api/']

const handleBetterAuth: Handle = async ({ event, resolve }) => {
  if (dev && event.url.pathname === '/.well-known/appspecific/com.chrome.devtools.json') {
    return new Response(undefined, { status: 404 })
  }

  const session = await auth.api.getSession({ headers: event.request.headers })

  if (session) {
    event.locals.session = session.session
    event.locals.user = session.user
  }

  const isProtected = protectedPrefixes.some(p => event.url.pathname.startsWith(p))
  if (isProtected && !event.locals.user) {
    throw redirect(303, '/login')
  }

  const response = await svelteKitHandler({ event, resolve, auth, building })

  if (response.headers.get('content-type')?.includes('text/html')) {
    response.headers.set('cache-control', 'no-cache, no-store, must-revalidate')
  }

  return response
}

export const handle: Handle = handleBetterAuth

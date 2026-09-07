import { startServerHeartbeat } from '$lib/server/heartbeat'
import { reapStaleGenerations } from '$lib/server/reaper'
import { building, dev } from '$app/environment'
import type { Handle, HandleServerError } from '@sveltejs/kit'
import { redirect } from '@sveltejs/kit'
import PocketBase, { isTokenExpired } from 'pocketbase'
import { env } from '$env/dynamic/private'

if (!building) {
  reapStaleGenerations().catch(err => {
    console.error('[reaper] startup reap failed:', err)
  })
  startServerHeartbeat()
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
const secure = env.ORIGIN.startsWith('https://')

const handleAuth: Handle = async ({ event, resolve }) => {
  if (dev && event.url.pathname === '/.well-known/appspecific/com.chrome.devtools.json') {
    return new Response(undefined, { status: 404 })
  }

  event.locals.pb = new PocketBase(env.POCKETBASE_URL)
  event.locals.pb.authStore.loadFromCookie(event.request.headers.get('cookie') ?? '')

  // authRefresh is a full PocketBase round trip on every request; only do it
  // when the token expires within the hour, otherwise trust the cookie token.
  try {
    if (event.locals.pb.authStore.isValid) {
      if (isTokenExpired(event.locals.pb.authStore.token, 60 * 60)) {
        await event.locals.pb.collection('users').authRefresh()
      }
    } else {
      event.locals.pb.authStore.clear()
    }
  } catch {
    event.locals.pb.authStore.clear()
  }

  const record = event.locals.pb.authStore.record
  if (record?.id) {
    const email = typeof record.email === 'string' ? record.email : ''
    const name = typeof record.name === 'string' && record.name ? record.name : email
    event.locals.user = { id: record.id, email, name }
  }

  const isProtected = protectedPrefixes.some(p => event.url.pathname.startsWith(p))
  if (isProtected && !event.locals.user) {
    throw redirect(303, '/login')
  }

  const response = await resolve(event)

  if (response.headers.get('content-type')?.includes('text/html')) {
    response.headers.set('cache-control', 'no-cache, no-store, must-revalidate')
  }

  response.headers.append('set-cookie', event.locals.pb.authStore.exportToCookie({ secure, sameSite: 'Lax', httpOnly: false, path: '/' }))

  return response
}

export const handle: Handle = handleAuth

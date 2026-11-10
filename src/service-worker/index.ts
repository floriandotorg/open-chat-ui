import { version } from '$app/env'
import { immutable } from '$app/manifest'
import { self } from '$app/service-worker'
import { PAGE_CACHE_PREFIX } from '#lib/page-cache.ts'

const cacheName = `cache-${version}`
// Version scoped: a cached page references the hashed assets of its build.
const pageCacheName = `${PAGE_CACHE_PREFIX}${version}`
const immutablePaths = new Set(immutable.map(file => new URL(file.path, self.registration.scope).pathname))
const cachedPagePattern = /^\/(chat(\/[^/]+)?|translator)\/?$/

const reloadClients = async () => {
  for (const client of await self.clients.matchAll({ type: 'window' })) {
    client.postMessage({ type: 'RELOAD' })
  }
}

const isCacheablePage = (response: Response) => response.ok && response.type === 'basic' && !response.redirected && (response.headers.get('content-type') ?? '').startsWith('text/html')

// The app redirects signed out navigations to /login; a cached page would
// keep showing the previous session.
const isSignedOut = (response: Response) => response.type === 'opaqueredirect' || response.status === 401

const refreshPage = async (request: Request, servedFromCache: boolean): Promise<Response> => {
  const response = await fetch(request)
  const cache = await caches.open(pageCacheName)
  if (isCacheablePage(response)) {
    await cache.put(request, response.clone())
  } else if (isSignedOut(response)) {
    await caches.delete(pageCacheName)
    if (servedFromCache) {
      await reloadClients()
    }
  } else {
    await cache.delete(request)
  }
  return response
}

// Stale while revalidate: a relaunched PWA paints its last state instantly
// and the app resyncs after hydration (see renderedAt in the root layout).
const respondWithPage = async (event: FetchEvent): Promise<Response> => {
  const cached = await caches.open(pageCacheName).then(cache => cache.match(event.request))
  const refreshed = refreshPage(event.request, !!cached)
  if (!cached) {
    return refreshed
  }
  event.waitUntil(refreshed.catch(() => undefined))
  return cached
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then(cache => cache.addAll([...immutablePaths]))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(async keys => {
      for (const key of keys) {
        if (key !== cacheName && key !== pageCacheName) {
          await caches.delete(key)
        }
      }
      await self.clients.claim()
    }),
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return
  }

  const url = new URL(event.request.url)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return
  }
  if (event.request.mode === 'navigate') {
    if (url.origin === self.location.origin && !url.search && cachedPagePattern.test(url.pathname)) {
      event.respondWith(respondWithPage(event))
    }
    return
  }
  if (url.pathname.startsWith('/api/')) {
    return
  }

  if (immutablePaths.has(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          return cached
        }
        return fetch(event.request).catch(() => {
          void reloadClients()
          return new Response('Asset not found', { status: 404 })
        })
      }),
    )
  }
})

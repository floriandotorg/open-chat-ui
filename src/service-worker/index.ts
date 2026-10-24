import { version } from '$app/env'
import { immutable } from '$app/manifest'
import { self } from '$app/service-worker'

const cacheName = `cache-${version}`
const immutablePaths = new Set(immutable.map(file => new URL(file.path, self.registration.scope).pathname))

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
        if (key !== cacheName) {
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
  if (url.pathname.startsWith('/api/') || event.request.mode === 'navigate') {
    return
  }

  if (immutablePaths.has(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) {
          return cached
        }
        return fetch(event.request).catch(() => {
          self.clients.matchAll().then(clients => {
            for (const client of clients) {
              client.postMessage({ type: 'RELOAD' })
            }
          })
          return new Response('Asset not found', { status: 404 })
        })
      }),
    )
  }
})

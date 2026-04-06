/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, version } from '$service-worker'

const sw = self as unknown as ServiceWorkerGlobalScope

const CACHE = `cache-${version}`
const IMMUTABLE = new Set(build)

sw.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(build))
      .then(() => sw.skipWaiting()),
  )
})

sw.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(async keys => {
      for (const key of keys) {
        if (key !== CACHE) {
          await caches.delete(key)
        }
      }
      await sw.clients.claim()
    }),
  )
})

sw.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  if (url.pathname.startsWith('/api/')) return

  if (event.request.mode === 'navigate') return

  if (IMMUTABLE.has(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached
        return fetch(event.request).catch(() => {
          sw.clients.matchAll().then(clients => {
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

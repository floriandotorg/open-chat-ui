/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker'

const sw = self as unknown as ServiceWorkerGlobalScope

const CACHE = `cache-${version}`
const ASSETS = [...build, ...files]

sw.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(ASSETS))
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

  const isAsset = ASSETS.includes(url.pathname)

  if (isAsset) {
    event.respondWith(caches.match(event.request).then(cached => cached ?? fetch(event.request)))
  } else {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.status === 200) {
            const clone = response.clone()
            caches.open(CACHE).then(cache => cache.put(event.request, clone))
          }
          return response
        })
        .catch(() => caches.match(event.request).then(cached => cached ?? new Response('Offline', { status: 503 }))),
    )
  }
})

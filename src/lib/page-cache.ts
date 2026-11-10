export const PAGE_CACHE_PREFIX = 'pages-'

// Cached pages embed the signed in user's data, so they go with the session.
export const clearPageCache = async () => {
  if (typeof caches === 'undefined') {
    return
  }
  const keys = await caches.keys()
  await Promise.all(keys.filter(key => key.startsWith(PAGE_CACHE_PREFIX)).map(key => caches.delete(key)))
}

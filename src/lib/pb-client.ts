import { browser } from '$app/environment'
import PocketBase from 'pocketbase'
import { env } from '$env/dynamic/public'

export const pbClient = new PocketBase(env.PUBLIC_POCKETBASE_URL)

if (browser) {
  pbClient.authStore.loadFromCookie(document.cookie)
  pbClient.authStore.onChange(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: js-sdk hydration persists auth cookie client-side
    document.cookie = pbClient.authStore.exportToCookie({ httpOnly: false, secure: location.protocol === 'https:' })
  })
  // hooks.server.ts refreshes the auth cookie on every response, but the SDK
  // keeps its token in memory only: re-sync from the cookie once the in-memory
  // token expires, or long-lived sessions (installed PWA) lose realtime for good.
  pbClient.beforeSend = (url, options) => {
    if (!pbClient.authStore.isValid) {
      pbClient.authStore.loadFromCookie(document.cookie)
    }
    return { url, options }
  }
}

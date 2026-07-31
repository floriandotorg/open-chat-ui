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
}

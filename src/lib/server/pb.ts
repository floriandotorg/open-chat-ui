import PocketBase, { ClientResponseError } from 'pocketbase'
import { env } from '$env/dynamic/private'

if (!env.POCKETBASE_URL) throw new Error('POCKETBASE_URL is not set')

const ADMIN_EMAIL = env.POCKETBASE_ADMIN_EMAIL
const ADMIN_PASSWORD = env.POCKETBASE_ADMIN_PASSWORD

export const pb = new PocketBase(env.POCKETBASE_URL)

// Shared across all requests/users: identical concurrent queries must not cancel each other
pb.autoCancellation(false)

let authPromise: Promise<void> | null = null

const authWithPassword = async () => {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('POCKETBASE_ADMIN_EMAIL/PASSWORD is not set')
  await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD)
}

export const ensurePbAuth = async () => {
  if (pb.authStore.isValid && pb.authStore.isSuperuser) return
  if (authPromise) return authPromise
  authPromise = authWithPassword()
    .then(() => {
      authPromise = null
    })
    .catch(err => {
      authPromise = null
      throw err
    })
  return authPromise
}

pb.beforeSend = async (url, options) => {
  if (!url.includes('/auth-with-password')) await ensurePbAuth()
  if (pb.authStore.token) {
    const headers = options.headers ?? {}
    let replaced = false
    for (const key in headers) {
      if (key.toLowerCase() === 'authorization') {
        headers[key] = pb.authStore.token
        replaced = true
        break
      }
    }
    if (!replaced) headers.Authorization = pb.authStore.token
    options.headers = headers
  }
  return { url, options }
}

export const isNotFound = (err: unknown): boolean => err instanceof ClientResponseError && err.status === 404

export const getFirstOrNull = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export const createOrRecover = async (collection: string, data: Record<string, unknown>, filter: string, update: Record<string, unknown>) => {
  try {
    return await pb.collection(collection).create(data)
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 400) {
      const existing = await getFirstOrNull(pb.collection(collection).getFirstListItem(filter, { fields: 'id' }))
      if (existing) {
        return pb.collection(collection).update(existing.id, update)
      }
    }
    throw err
  }
}

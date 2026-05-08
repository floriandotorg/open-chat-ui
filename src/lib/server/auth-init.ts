import { getCurrentAuthContextAsyncLocalStorage, getCurrentDBAdapterAsyncLocalStorage, getRequestStateAsyncLocalStorage } from '@better-auth/core/context'

// better-auth@1.6.9 lazily creates AsyncLocalStorage singletons on first
// access. Each `ensureAsyncStorage` does:
//   if (!global.storage) {
//     const ALS = await getAsyncLocalStorage()  // dynamic import
//     global.storage = new ALS()                 // unconditional write
//   }
//   return global.storage
//
// On a cold server, two concurrent requests can both pass the `if` guard,
// then each construct and assign their own ALS instance. Whichever assigns
// last wins, and the earlier request's `als.run(store, fn)` ends up running
// on a now-orphaned instance — so any nested `getCurrentRequestState()` reads
// the new global instance, finds no active store, and throws
// "No request state found...". We've seen this surface as intermittent
// 500s on /api/chat right after process start.
//
// Serially warming the singletons before the first request closes the race.
export const authInit = Promise.all([getRequestStateAsyncLocalStorage(), getCurrentAuthContextAsyncLocalStorage(), getCurrentDBAdapterAsyncLocalStorage()]).then(() => undefined)

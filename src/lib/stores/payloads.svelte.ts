import { mapMessagePayload } from '$lib/db-mappers'
import { pbClient } from '$lib/pb-client'
import type { MessagePayload } from '$lib/types'

const cache = new Map<string, Promise<MessagePayload>>()

const emptyPayload = (messageId: string): MessagePayload => ({ messageId, toolResults: {}, rawContentBlocks: null, thinking: null })

export const loadPayload = (messageId: string): Promise<MessagePayload> => {
  const cached = cache.get(messageId)
  if (cached) return cached
  const promise = pbClient
    .collection('message_payloads')
    .getFirstListItem(pbClient.filter('message = {:m}', { m: messageId }))
    .then(mapMessagePayload)
    .catch((err: unknown) => {
      if (err instanceof Error && 'status' in err && err.status === 404) return emptyPayload(messageId)
      cache.delete(messageId)
      return emptyPayload(messageId)
    })
  cache.set(messageId, promise)
  return promise
}

export const invalidatePayload = (messageId: string) => {
  cache.delete(messageId)
}

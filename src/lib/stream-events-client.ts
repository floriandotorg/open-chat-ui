import { mapChatMessage } from '$lib/db-mappers'
import { pbClient } from '$lib/pb-client'
import type { StreamEvent, StreamOp } from '$lib/types'
import type { ChatMessage } from '$lib/types/chat'
import { ClientResponseError } from 'pocketbase'

export const fetchStreamEvents = async (messageId: string, from: number, to: number | null): Promise<StreamEvent[]> => {
  const filter = to === null ? pbClient.filter('message = {:m} && seq >= {:from}', { m: messageId, from }) : pbClient.filter('message = {:m} && seq >= {:from} && seq <= {:to}', { m: messageId, from, to })
  const rows = await pbClient.collection('stream_events').getFullList({ filter, sort: 'seq' })
  return rows.map(r => ({ messageId, seq: r.seq, ops: Array.isArray(r.ops) ? (r.ops as StreamOp[]) : [] }))
}

export const fetchMessage = async (messageId: string): Promise<ChatMessage | null> => {
  try {
    return mapChatMessage(await pbClient.collection('messages').getOne(messageId))
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      return null
    }
    throw err
  }
}

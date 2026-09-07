import { pbClient } from '$lib/pb-client'
import type { StreamEvent, StreamOp } from '$lib/types'

export const fetchStreamEvents = async (messageId: string, from: number, to: number | null): Promise<StreamEvent[]> => {
  const filter = to === null ? pbClient.filter('message = {:m} && seq >= {:from}', { m: messageId, from }) : pbClient.filter('message = {:m} && seq >= {:from} && seq <= {:to}', { m: messageId, from, to })
  const rows = await pbClient.collection('stream_events').getFullList({ filter, sort: 'seq' })
  return rows.map(r => ({ messageId, seq: r.seq, ops: Array.isArray(r.ops) ? (r.ops as StreamOp[]) : [] }))
}

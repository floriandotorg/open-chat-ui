import { isNotFound, pb } from '$lib/server/pb'
import { deleteStreamEventIds, listStreamEventIds, purgeStreamEventsOlderThan } from '$lib/server/stream-events'
import type { RecordModel } from 'pocketbase'

const STREAM_EVENT_MAX_AGE_MS = 60 * 60 * 1000

const finalizeOrphanMessage = async (row: RecordModel) => {
  const content = row.content ?? ''
  const toolCalls = row.toolCalls
  if (!content && !toolCalls) {
    try {
      await pb.collection('messages').delete(row.id)
    } catch {}
  } else {
    try {
      await pb.collection('messages').update(row.id, { generating: false })
    } catch {}
  }
}

export const reapStaleGenerations = async () => {
  const stale = await pb.collection('conversations').getFullList({ filter: 'generating = true', fields: 'id' })
  const orphans = await pb.collection('messages').getFullList({ filter: 'generating = true', fields: 'id,content,toolCalls' })
  if (stale.length > 0 || orphans.length > 0) {
    await Promise.all([...stale.map(row => pb.collection('conversations').update(row.id, { generating: false })), ...orphans.map(finalizeOrphanMessage)])
    const c = stale.length === 1 ? '' : 's'
    const m = orphans.length === 1 ? '' : 's'
    console.info(`[reaper] cleared ${stale.length} stale generating flag${c} and ${orphans.length} orphan message${m} on startup`)
  }
  const purged = await purgeStreamEventsOlderThan(new Date(Date.now() - STREAM_EVENT_MAX_AGE_MS))
  if (purged > 0) {
    console.info(`[reaper] purged ${purged} stale stream event${purged === 1 ? '' : 's'} on startup`)
  }
}

export const clearGeneratingFlag = async (conversationId: string) => {
  try {
    await pb.collection('conversations').update(conversationId, { generating: false })
  } catch (err) {
    if (isNotFound(err)) return
    throw err
  }
  const orphans = await pb.collection('messages').getFullList({ filter: pb.filter('conversation = {:c} && generating = true', { c: conversationId }), fields: 'id,content,toolCalls' })
  await Promise.all(orphans.map(finalizeOrphanMessage))
  const eventIds = await listStreamEventIds(pb.filter('conversation = {:c}', { c: conversationId }))
  await deleteStreamEventIds(eventIds)
}

import { pb } from './pb'

export interface StreamEventClient {
  collection(name: string): {
    getFullList(options: { filter: string; fields: string }): Promise<{ id: string }[]>
    delete(id: string): Promise<unknown>
  }
  createBatch(): {
    collection(name: string): { delete(id: string): void }
    send(): Promise<unknown>
  }
  filter(expression: string, params?: Record<string, unknown>): string
}

const BATCH_CHUNK = 200

// Batch delete falls back to individual deletes when the batch API is
// disabled; the startup purge catches anything left behind either way.
export const deleteStreamEventIds = async (ids: string[], client: StreamEventClient = pb): Promise<void> => {
  for (let n = 0; n < ids.length; n += BATCH_CHUNK) {
    const chunk = ids.slice(n, n + BATCH_CHUNK)
    try {
      const batch = client.createBatch()
      for (const id of chunk) {
        batch.collection('stream_events').delete(id)
      }
      await batch.send()
    } catch {
      await Promise.all(
        chunk.map(id =>
          client
            .collection('stream_events')
            .delete(id)
            .catch(() => {}),
        ),
      )
    }
  }
}

export const listStreamEventIds = async (filter: string, client: StreamEventClient = pb): Promise<string[]> => {
  const rows = await client.collection('stream_events').getFullList({ filter, fields: 'id' })
  return rows.map(r => r.id)
}

export const purgeStreamEventsOlderThan = async (cutoff: Date, client: StreamEventClient = pb): Promise<number> => {
  const ids = await listStreamEventIds(client.filter('createdAt < {:cutoff}', { cutoff }), client)
  await deleteStreamEventIds(ids, client)
  return ids.length
}

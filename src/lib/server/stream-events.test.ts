import { purgeStreamEventsOlderThan, type StreamEventClient } from './stream-events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/server/pb', () => ({
  pb: {},
  isNotFound: () => false,
  getFirstOrNull: async () => null,
  createOrRecover: async () => ({}),
}))

const createFakeClient = (rows: { id: string; createdAt: string }[]) => {
  const deleted: string[] = []
  const client: StreamEventClient = {
    collection: () => ({
      getFullList: async (options: { filter: string; fields: string }) => {
        const cutoff = JSON.parse(options.filter) as string
        return rows.filter(r => r.createdAt < cutoff).map(r => ({ id: r.id }))
      },
      delete: async (id: string) => {
        deleted.push(id)
      },
    }),
    createBatch: () => {
      const ids: string[] = []
      return {
        collection: () => ({
          delete: (id: string) => {
            ids.push(id)
          },
        }),
        send: async () => {
          deleted.push(...ids)
        },
      }
    },
    filter: (_expression: string, params?: Record<string, unknown>) => JSON.stringify(params?.cutoff),
  }
  return { client, deleted }
}

describe('purgeStreamEventsOlderThan', () => {
  it('deletes stale events and keeps fresh ones', async () => {
    const { client, deleted } = createFakeClient([
      { id: 'old-1', createdAt: '2024-01-01 00:00:00.000' },
      { id: 'old-2', createdAt: '2024-01-01 01:00:00.000' },
      { id: 'fresh-1', createdAt: '2999-01-01 00:00:00.000' },
    ])
    const purged = await purgeStreamEventsOlderThan(new Date('2024-06-01T00:00:00Z'), client)
    expect(purged).toBe(2)
    expect(deleted).toEqual(['old-1', 'old-2'])
  })

  it('does nothing when nothing is stale', async () => {
    const { client, deleted } = createFakeClient([{ id: 'fresh-1', createdAt: '2999-01-01 00:00:00.000' }])
    const purged = await purgeStreamEventsOlderThan(new Date('2024-06-01T00:00:00Z'), client)
    expect(purged).toBe(0)
    expect(deleted).toEqual([])
  })
})

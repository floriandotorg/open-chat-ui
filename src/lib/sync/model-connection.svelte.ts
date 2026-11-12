import type { OpenAIConnection } from '#lib/model-connection.ts'
import { api } from './api'
import { Mutation, SyncCollection } from './collection.svelte'

export const createModelConnectionStore = (initial: OpenAIConnection) => {
  const collection = new SyncCollection<{ id: string; connection: OpenAIConnection }>()
  collection.receive({ id: 'openai', connection: initial })

  return {
    get connection() {
      return collection.get('openai')?.connection ?? 'api'
    },
    get pending() {
      return collection.isPending('openai')
    },
    seed: (connection: OpenAIConnection) => collection.receive({ id: 'openai', connection }),
    save: async (connection: OpenAIConnection) => {
      const mutation = new Mutation([collection.patch('openai', { connection })], { silent: true })
      await mutation.run(async () => {
        const body = await api.put('/api/settings', { openaiConnection: connection })
        if (!body || typeof body !== 'object' || !('openaiConnection' in body) || body.openaiConnection !== connection) {
          throw new Error('Could not save the connection setting')
        }
      })
      return mutation.error
    },
  }
}

import { createModelConnectionStore } from './model-connection.svelte'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('folds a successful connection change and sends only that setting', async () => {
  const fetchMock = vi.fn(async () => Response.json({ openaiConnection: 'subscription' }))
  vi.stubGlobal('fetch', fetchMock)
  const store = createModelConnectionStore('api')
  expect(await store.save('subscription')).toBeNull()
  expect(store.connection).toBe('subscription')
  expect(store.pending).toBe(false)
  expect(fetchMock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ openaiConnection: 'subscription' }) }))
})

it('rolls back a failed save without changing the active connection', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ message: 'Save failed' }, { status: 500 }))
  const store = createModelConnectionStore('api')
  expect(await store.save('subscription')).toBe('Save failed')
  expect(store.connection).toBe('api')
  expect(store.pending).toBe(false)
})

it('rejects an unacknowledged setting instead of reporting success', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ openaiConnection: 'unexpected' }))
  const store = createModelConnectionStore('subscription')
  expect(await store.save('api')).toBe('Could not save the connection setting')
  expect(store.connection).toBe('subscription')
})

it('keeps an optimistic choice visible while a stale snapshot arrives', async () => {
  let acknowledge = () => {}
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>(resolve => {
        acknowledge = () => resolve(Response.json({ openaiConnection: 'subscription' }))
      }),
  )
  const store = createModelConnectionStore('api')
  const saving = store.save('subscription')
  expect(store.pending).toBe(true)
  expect(store.connection).toBe('subscription')
  store.seed('api')
  expect(store.connection).toBe('subscription')
  acknowledge()
  await saving
  expect(store.connection).toBe('subscription')
})

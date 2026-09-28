import { Mutation, mutate, SyncCollection } from './collection.svelte'
import { onSyncError } from './errors'
import { describe, expect, it, vi } from 'vitest'

interface Doc {
  id: string
  title: string
  tags?: string[]
  version?: number
}

const doc = (id: string, overrides: Partial<Doc> = {}): Doc => ({ id, title: `Doc ${id}`, ...overrides })

const deferred = () => {
  let resolve: () => void = () => {}
  let reject: (err: Error) => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('SyncCollection', () => {
  it('shows optimistic writes before the commit resolves', () => {
    const docs = new SyncCollection<Doc>()
    docs.reset([doc('a')])

    void mutate([docs.patch('a', { title: 'Local' }), docs.put(doc('b'))], () => new Promise(() => {}))

    expect(docs.get('a')?.title).toBe('Local')
    expect(docs.list.map(d => d.id)).toEqual(['a', 'b'])
    expect(docs.confirmed('a')?.title).toBe('Doc a')
    expect(docs.isPending('a')).toBe(true)
  })

  it('keeps optimistic writes on top of stale server updates while pending', () => {
    const docs = new SyncCollection<Doc>()
    docs.reset([doc('a')])

    void mutate([docs.patch('a', { title: 'Local' })], () => new Promise(() => {}))
    docs.receive(doc('a', { title: 'Stale', version: 2 }))

    expect(docs.get('a')).toEqual(doc('a', { title: 'Local', version: 2 }))
  })

  it('folds acknowledged writes into the server state so a silent realtime channel cannot revert them', async () => {
    const docs = new SyncCollection<Doc>()
    docs.reset([doc('a')])

    await mutate([docs.patch('a', { title: 'Saved' }), docs.delete('missing'), docs.put(doc('b'))], async () => {})

    expect(docs.confirmed('a')?.title).toBe('Saved')
    expect(docs.confirmed('b')).toEqual(doc('b'))
    expect(docs.isPending('a')).toBe(false)
  })

  it('rolls back by default when the commit fails and reports the error', async () => {
    const errors: string[] = []
    const stop = onSyncError(message => errors.push(message))
    const docs = new SyncCollection<Doc>()
    docs.reset([doc('a')])

    await mutate([docs.patch('a', { title: 'Local' }), docs.delete('a')], async () => {
      throw new Error('Offline')
    })
    stop()

    expect(docs.get('a')?.title).toBe('Doc a')
    expect(errors).toEqual(['Offline'])
  })

  it('keeps failed writes visible when asked to, and retries them in place', async () => {
    const docs = new SyncCollection<Doc>()
    const mutation = new Mutation([docs.put(doc('a'))], { keepOnError: true })

    await mutation.run(async () => {
      throw new Error('Overloaded')
    })

    expect(docs.get('a')).toEqual(doc('a'))
    expect(docs.failure('a')?.error).toBe('Overloaded')

    await mutation.run(async () => {})

    expect(docs.failure('a')).toBeUndefined()
    expect(docs.confirmed('a')).toEqual(doc('a'))
  })

  it('discards failed writes on request', async () => {
    const docs = new SyncCollection<Doc>()
    const mutation = new Mutation([docs.put(doc('a'))], { keepOnError: true })
    await mutation.run(async () => {
      throw new Error('Overloaded')
    })

    mutation.discard()

    expect(docs.get('a')).toBeUndefined()
  })

  it('applies functional updates against the latest server state', () => {
    const docs = new SyncCollection<Doc>()
    docs.reset([doc('a', { tags: ['server'] })])

    void mutate([docs.update('a', d => ({ ...d, tags: [...(d.tags ?? []), 'local'] }))], () => new Promise(() => {}))
    docs.receive(doc('a', { tags: ['server', 'other'] }))

    expect(docs.get('a')?.tags).toEqual(['server', 'other', 'local'])
  })

  it('settles mutations spanning several collections atomically', async () => {
    const docs = new SyncCollection<Doc>()
    const notes = new SyncCollection<Doc>()
    const commit = deferred()

    const done = mutate([docs.put(doc('a')), notes.put(doc('n'))], () => commit.promise)
    expect([docs.get('a'), notes.get('n')].every(Boolean)).toBe(true)

    commit.resolve()
    await done

    expect(docs.confirmed('a')).toBeDefined()
    expect(notes.confirmed('n')).toBeDefined()
  })

  it('rejects server records the accept guard considers stale', () => {
    const docs = new SyncCollection<Doc>({ accept: (incoming, current) => (incoming.version ?? 0) >= (current.version ?? 0) })
    docs.receive(doc('a', { version: 3 }))

    expect(docs.receive(doc('a', { title: 'Old', version: 2 }))).toBe(false)
    expect(docs.get('a')?.version).toBe(3)
  })

  it('merges partial server updates into known records only', () => {
    const docs = new SyncCollection<Doc>()
    docs.reset([doc('a', { tags: ['x'] })])

    docs.merge('a', { title: 'Renamed' })
    docs.merge('ghost', { title: 'Nope' })

    expect(docs.get('a')).toEqual(doc('a', { title: 'Renamed', tags: ['x'] }))
    expect(docs.get('ghost')).toBeUndefined()
  })

  it('reset with merge keeps fields the list query does not carry', () => {
    const docs = new SyncCollection<Doc>()
    docs.reset([doc('a', { tags: ['detail'] })])

    docs.reset([doc('a', { title: 'Fresh' }), doc('b')], { merge: true })

    expect(docs.get('a')).toEqual(doc('a', { title: 'Fresh', tags: ['detail'] }))
    expect(docs.list.map(d => d.id)).toEqual(['a', 'b'])
  })

  it('forget removes server records but pending puts stay visible', () => {
    const docs = new SyncCollection<Doc>()
    docs.reset([doc('a')])
    void mutate([docs.put(doc('a', { title: 'Mine' }))], () => new Promise(() => {}))

    docs.forget('a')

    expect(docs.confirmed('a')).toBeUndefined()
    expect(docs.get('a')?.title).toBe('Mine')
  })

  it('does not report errors for writes kept on failure', async () => {
    const report = vi.fn()
    const stop = onSyncError(report)
    const docs = new SyncCollection<Doc>()

    await new Mutation([docs.put(doc('a'))], { keepOnError: true }).run(async () => {
      throw new Error('Nope')
    })
    stop()

    expect(report).not.toHaveBeenCalled()
  })
})

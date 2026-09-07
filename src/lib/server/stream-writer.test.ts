import { type StreamSnapshotState, StreamWriter, type StreamWriterClient } from './stream-writer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createFakeClient = () => {
  const events: { id: string; data: Record<string, unknown> }[] = []
  const snapshots: { id: string; fields: Record<string, unknown> }[] = []
  let nextId = 0
  let gate: Promise<void> | null = null
  let release: (() => void) | null = null
  let inFlightCreates = 0
  let maxConcurrentCreates = 0
  const client: StreamWriterClient = {
    collection: () => ({
      create: async (data: Record<string, unknown>) => {
        ++inFlightCreates
        maxConcurrentCreates = Math.max(maxConcurrentCreates, inFlightCreates)
        if (gate) await gate
        --inFlightCreates
        const id = `e${++nextId}`
        events.push({ id, data })
        return { id }
      },
      update: async (id: string, fields: Record<string, unknown>) => {
        snapshots.push({ id, fields })
        return {}
      },
    }),
  }
  return {
    client,
    events,
    snapshots,
    get maxConcurrentCreates() {
      return maxConcurrentCreates
    },
    blockNextCreate: () => {
      gate = new Promise(resolve => {
        release = resolve
      })
    },
    unblockCreate: () => {
      release?.()
      gate = null
    },
  }
}

const createWriter = (fake: ReturnType<typeof createFakeClient>, state: StreamSnapshotState, options: { flushMs?: number; snapshotMs?: number } = {}) =>
  new StreamWriter({
    conversationId: 'c1',
    messageId: 'm1',
    client: fake.client,
    getState: () => ({ content: state.content, thinking: state.thinking, toolCalls: state.toolCalls }),
    flushMs: options.flushMs ?? 100,
    snapshotMs: options.snapshotMs ?? 2_000,
  })

const textState = (): StreamSnapshotState => ({ content: '', thinking: '', toolCalls: null })

describe('StreamWriter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces ops emitted within one flush window into a single event', async () => {
    const fake = createFakeClient()
    const writer = createWriter(fake, textState())
    writer.emit({ t: 'text', v: 'a' })
    writer.emit({ t: 'text', v: 'b' })
    writer.emit({ t: 'thinking', v: 't' })
    await vi.advanceTimersByTimeAsync(100)
    expect(fake.events).toHaveLength(1)
    expect(fake.events[0].data.ops).toEqual([
      { t: 'text', v: 'ab' },
      { t: 'thinking', v: 't' },
    ])
    expect(fake.events[0].data.seq).toBe(1)
  })

  it('assigns strictly increasing seq across flushes', async () => {
    const fake = createFakeClient()
    const writer = createWriter(fake, textState())
    writer.emit({ t: 'text', v: 'a' })
    await vi.advanceTimersByTimeAsync(100)
    writer.emit({ t: 'text', v: 'b' })
    await vi.advanceTimersByTimeAsync(100)
    expect(fake.events.map(e => e.data.seq)).toEqual([1, 2])
  })

  it('writes a snapshot with eventSeq of the last created event once the snapshot interval passed', async () => {
    const fake = createFakeClient()
    const state = textState()
    const writer = createWriter(fake, state)
    state.content = 'a'
    writer.emit({ t: 'text', v: 'a' })
    await vi.advanceTimersByTimeAsync(100)
    expect(fake.snapshots).toHaveLength(1)
    expect(fake.snapshots[0].fields).toMatchObject({ content: 'a', eventSeq: 1, generating: true })

    state.content = 'ab'
    writer.emit({ t: 'text', v: 'b' })
    await vi.advanceTimersByTimeAsync(100)
    expect(fake.snapshots).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2_000)
    state.content = 'abc'
    writer.emit({ t: 'text', v: 'c' })
    await vi.advanceTimersByTimeAsync(100)
    expect(fake.snapshots).toHaveLength(2)
    expect(fake.snapshots[1].fields).toMatchObject({ content: 'abc', eventSeq: 3 })
  })

  it('serializes event creation so seq order matches creation order', async () => {
    const fake = createFakeClient()
    const writer = createWriter(fake, textState())
    fake.blockNextCreate()
    writer.emit({ t: 'text', v: 'a' })
    await vi.advanceTimersByTimeAsync(100)
    writer.emit({ t: 'text', v: 'b' })
    await vi.advanceTimersByTimeAsync(100)
    expect(fake.events).toHaveLength(0)
    fake.unblockCreate()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(fake.events.map(e => e.data.seq)).toEqual([1, 2])
    expect(fake.events[1].data.ops).toEqual([{ t: 'text', v: 'b' }])
    expect(fake.maxConcurrentCreates).toBe(1)
  })

  it('captures state at cut time, not at write completion', async () => {
    const fake = createFakeClient()
    const state = textState()
    const writer = createWriter(fake, state, { snapshotMs: 0 })
    fake.blockNextCreate()
    state.content = 'a'
    writer.emit({ t: 'text', v: 'a' })
    await vi.advanceTimersByTimeAsync(100)
    state.content = 'ab'
    writer.emit({ t: 'text', v: 'b' })
    fake.unblockCreate()
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.snapshots[0].fields.content).toBe('a')
  })

  it('drain flushes pending ops and waits for in-flight writes', async () => {
    const fake = createFakeClient()
    const writer = createWriter(fake, textState())
    fake.blockNextCreate()
    writer.emit({ t: 'text', v: 'a' })
    await vi.advanceTimersByTimeAsync(100)
    writer.emit({ t: 'text', v: 'b' })
    const drained = writer.drain()
    let done = false
    void drained.then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(done).toBe(false)
    fake.unblockCreate()
    await vi.advanceTimersByTimeAsync(10_000)
    await drained
    expect(fake.events.map(e => e.data.seq)).toEqual([1, 2])
    expect(writer.seq).toBe(2)
  })

  it('tracks created event ids for later deletion', async () => {
    const fake = createFakeClient()
    const writer = createWriter(fake, textState())
    writer.emit({ t: 'text', v: 'a' })
    await vi.advanceTimersByTimeAsync(100)
    writer.emit({ t: 'text', v: 'b' })
    await vi.advanceTimersByTimeAsync(100)
    expect(writer.eventIds).toEqual(['e1', 'e2'])
  })
})

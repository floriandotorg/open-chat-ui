import { now } from '$lib/db-mappers'
import { mergeOps } from '$lib/stream-ops'
import type { StreamOp } from '$lib/types'

export interface StreamSnapshotState {
  content: string
  thinking: string
  toolCalls: unknown[] | null
}

export interface StreamWriterClient {
  collection(name: string): {
    create(data: Record<string, unknown>, options?: { fields?: string }): Promise<{ id: string }>
    update(id: string, data: Record<string, unknown>): Promise<unknown>
  }
}

interface StreamWriterOptions {
  conversationId: string
  messageId: string
  client: StreamWriterClient
  getState: () => StreamSnapshotState
  flushMs?: number
  snapshotMs?: number
}

const DEFAULT_FLUSH_MS = 100
const DEFAULT_SNAPSHOT_MS = 2_000

// Writes LLM deltas as tiny stream_events rows (~100 ms) and folds the
// accumulated state into the messages record every ~2 s. Event creation is
// serialized so seq order equals creation order; snapshot state is captured
// at the same tick the ops are cut, so eventSeq always matches the snapshot
// content exactly.
export class StreamWriter {
  private pendingOps: StreamOp[] = []
  private inFlight: Promise<void> | null = null
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastSnapshotAt = 0
  readonly eventIds: string[] = []
  seq = 0

  constructor(private options: StreamWriterOptions) {}

  emit = (op: StreamOp) => {
    this.pendingOps.push(op)
    this.timer ??= setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.options.flushMs ?? DEFAULT_FLUSH_MS)
  }

  flush = async (): Promise<void> => {
    if (this.inFlight) {
      this.dirty = true
      return
    }
    const ops = mergeOps(this.pendingOps)
    if (ops.length === 0) return
    this.pendingOps = []
    const seq = ++this.seq
    const state = this.options.getState()
    const flight = this.write(seq, ops, state)
    this.inFlight = flight
    await flight
    this.inFlight = null
    if (this.dirty) {
      this.dirty = false
      await this.flush()
    }
  }

  private write = async (seq: number, ops: StreamOp[], state: StreamSnapshotState) => {
    try {
      const record = await this.options.client.collection('stream_events').create({ conversation: this.options.conversationId, message: this.options.messageId, seq, ops, createdAt: now() }, { fields: 'id' })
      this.eventIds.push(record.id)
    } catch {
      return
    }
    if (Date.now() - this.lastSnapshotAt >= (this.options.snapshotMs ?? DEFAULT_SNAPSHOT_MS)) {
      await this.snapshot(seq, state)
    }
  }

  private snapshot = async (seq: number, state: StreamSnapshotState) => {
    this.lastSnapshotAt = Date.now()
    try {
      await this.options.client.collection('messages').update(this.options.messageId, {
        content: state.content,
        thinking: state.thinking || null,
        toolCalls: state.toolCalls,
        eventSeq: seq,
        generating: true,
      })
    } catch {}
  }

  drain = async () => {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (;;) {
      if (this.inFlight) {
        this.dirty = true
        await this.inFlight
        continue
      }
      if (this.pendingOps.length === 0) return
      await this.flush()
    }
  }
}

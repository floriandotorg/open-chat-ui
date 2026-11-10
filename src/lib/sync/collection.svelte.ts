import { errorMessage, reportSyncError } from './errors'

// Client side mirror of a PocketBase collection with Firebase style latency
// compensation: the view is the last known server state with every pending
// local write layered on top. Failed writes vanish from the view on their
// own (no hand written revert), acknowledged writes are folded into the
// server state so the UI never depends on the realtime echo arriving.
//
// Snapshots (list and detail fetches) race acknowledged writes and realtime
// events on slow links. Every fresher change stamps its id with the shared
// write clock; a snapshot applied with `since` (the clock when it was
// requested) leaves the ids touched after that alone.

let writeClock = 0

export const syncClock = (): number => writeClock

export interface SnapshotOptions {
  since?: number
}

export type Op<T> = { kind: 'put'; record: T } | { kind: 'patch'; id: string; patch: Partial<T> } | { kind: 'update'; id: string; update: (current: T) => T } | { kind: 'delete'; id: string }

interface MutationTarget {
  settle: (mutation: Mutation) => void
  revert: (mutation: Mutation) => void
}

export interface Write {
  stage: (mutation: Mutation) => MutationTarget
}

export type MutationStatus = 'pending' | 'failed' | 'settled'

export class Mutation {
  status = $state<MutationStatus>('pending')
  error = $state<string | null>(null)
  private targets: Set<MutationTarget>

  constructor(
    writes: Write[],
    private options: { keepOnError?: boolean; silent?: boolean } = {},
  ) {
    this.targets = new Set(writes.map(write => write.stage(this)))
  }

  run = async (commit: () => Promise<unknown>): Promise<void> => {
    this.status = 'pending'
    this.error = null
    try {
      await commit()
    } catch (err) {
      this.error = errorMessage(err)
      if (this.options.keepOnError) {
        this.status = 'failed'
        return
      }
      this.discard()
      if (!this.options.silent) {
        reportSyncError(this.error)
      }
      return
    }
    this.status = 'settled'
    for (const target of this.targets) {
      target.settle(this)
    }
  }

  discard = () => {
    for (const target of this.targets) {
      target.revert(this)
    }
  }
}

export const mutate = (writes: Write[], commit: () => Promise<unknown>): Promise<void> => new Mutation(writes).run(commit)

const opId = <T extends { id: string }>(op: Op<T>): string => (op.kind === 'put' ? op.record.id : op.id)

const applyOp = <T extends { id: string }>(records: Map<string, T>, op: Op<T>) => {
  if (op.kind === 'put') {
    records.set(op.record.id, op.record)
    return
  }
  if (op.kind === 'delete') {
    records.delete(op.id)
    return
  }
  const current = records.get(op.id)
  if (current) {
    records.set(op.id, op.kind === 'patch' ? { ...current, ...op.patch } : op.update(current))
  }
}

interface Staged<T> {
  mutation: Mutation
  op: Op<T>
}

export interface SyncCollectionOptions<T> {
  accept?: (incoming: T, current: T) => boolean
}

export class SyncCollection<T extends { id: string }> implements MutationTarget {
  private server = $state.raw(new Map<string, T>())
  private staged = $state.raw<Staged<T>[]>([])
  private touchedAt = new Map<string, number>()

  readonly records = $derived.by(() => {
    if (this.staged.length === 0) {
      return this.server
    }
    const view = new Map(this.server)
    for (const { op } of this.staged) {
      applyOp(view, op)
    }
    return view
  })

  readonly list = $derived([...this.records.values()])

  constructor(private options: SyncCollectionOptions<T> = {}) {}

  get = (id: string): T | undefined => this.records.get(id)

  has = (id: string): boolean => this.records.has(id)

  confirmed = (id: string): T | undefined => this.server.get(id)

  isPending = (id: string): boolean => this.staged.some(s => s.mutation.status === 'pending' && opId(s.op) === id)

  failure = (id: string): Mutation | undefined => this.staged.find(s => s.mutation.status === 'failed' && opId(s.op) === id)?.mutation

  receive = (record: T, { since }: SnapshotOptions = {}): boolean => {
    const current = this.server.get(record.id)
    if (this.isNewerThan(record.id, since) || (current && this.options.accept && !this.options.accept(record, current))) {
      return false
    }
    this.server = new Map(this.server).set(record.id, record)
    this.touch(record.id)
    return true
  }

  merge = (id: string, partial: Partial<T>, { since }: SnapshotOptions = {}) => {
    const current = this.server.get(id)
    if (current && !this.isNewerThan(id, since)) {
      this.server = new Map(this.server).set(id, { ...current, ...partial })
      this.touch(id)
    }
  }

  forget = (id: string) => {
    if (this.server.has(id)) {
      const next = new Map(this.server)
      next.delete(id)
      this.server = next
    }
    this.touch(id)
  }

  reset = (records: T[], { merge = false, since }: { merge?: boolean } & SnapshotOptions = {}) => {
    const next = new Map<string, T>()
    for (const record of records) {
      if (!this.isNewerThan(record.id, since)) {
        next.set(record.id, merge ? { ...this.server.get(record.id), ...record } : record)
      }
    }
    if (since !== undefined) {
      for (const [id, record] of this.server) {
        if (this.isNewerThan(id, since)) {
          next.set(id, record)
        }
      }
    }
    this.server = next
  }

  put = (record: T): Write => this.writer({ kind: 'put', record })

  patch = (id: string, patch: Partial<T>): Write => this.writer({ kind: 'patch', id, patch })

  update = (id: string, update: (current: T) => T): Write => this.writer({ kind: 'update', id, update })

  delete = (id: string): Write => this.writer({ kind: 'delete', id })

  settle = (mutation: Mutation) => {
    const next = new Map(this.server)
    for (const staged of this.staged) {
      if (staged.mutation === mutation) {
        applyOp(next, staged.op)
        this.touch(opId(staged.op))
      }
    }
    this.server = next
    this.revert(mutation)
  }

  revert = (mutation: Mutation) => {
    this.staged = this.staged.filter(s => s.mutation !== mutation)
  }

  private touch = (id: string) => {
    this.touchedAt.set(id, ++writeClock)
  }

  private isNewerThan = (id: string, since: number | undefined): boolean => since !== undefined && (this.touchedAt.get(id) ?? 0) > since

  private writer = (op: Op<T>): Write => ({
    stage: mutation => {
      this.staged = [...this.staged, { mutation, op }]
      return this
    },
  })
}

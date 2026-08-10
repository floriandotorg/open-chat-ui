export interface OptimisticMap<T extends { id: string }> {
  readonly size: number
  has: (id: string) => boolean
  get: (id: string) => T | undefined
  values: () => T[]
  add: (item: T) => void
  patch: (id: string, patch: Partial<T>) => void
  confirm: (id: string) => void
  remove: (id: string) => void
}

export const createOptimisticMap = <T extends { id: string }>(): OptimisticMap<T> => {
  let pending = $state<Map<string, T>>(new Map())

  const mutate = (fn: (next: Map<string, T>) => void) => {
    const next = new Map(pending)
    fn(next)
    pending = next
  }

  return {
    get size() {
      return pending.size
    },
    has: id => pending.has(id),
    get: id => pending.get(id),
    values: () => [...pending.values()],
    add: item => mutate(next => next.set(item.id, item)),
    patch: (id, patch) => {
      const current = pending.get(id)
      if (!current) return
      mutate(next => next.set(id, { ...current, ...patch }))
    },
    confirm: id => {
      if (pending.has(id)) mutate(next => next.delete(id))
    },
    remove: id => {
      if (pending.has(id)) mutate(next => next.delete(id))
    },
  }
}

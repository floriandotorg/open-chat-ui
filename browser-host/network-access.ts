const MAX_PENDING_ORIGINS = 16

export const createNetworkAccess = () => {
  const approved = new Set<string>()
  const denied = new Set<string>()
  const pending = new Set<string>()
  let active = true

  return {
    request: (origin: string): boolean => {
      if (!active) {
        return false
      }
      if (approved.has(origin)) {
        return true
      }
      if (!denied.has(origin) && pending.size < MAX_PENDING_ORIGINS) {
        pending.add(origin)
      }
      return false
    },
    pending: (): string[] => [...pending],
    decide: (origin: string, allow: boolean): boolean => {
      if (!active || !pending.delete(origin)) {
        return false
      }
      const decisions = allow ? approved : denied
      decisions.add(origin)
      return true
    },
    dispose: () => {
      active = false
      approved.clear()
      denied.clear()
      pending.clear()
    },
  }
}

export type NetworkAccess = ReturnType<typeof createNetworkAccess>

const sessions = new WeakMap<object, NetworkAccess>()

export const networkAccessFor = (session: object): NetworkAccess => {
  let access = sessions.get(session)
  if (!access) {
    access = createNetworkAccess()
    sessions.set(session, access)
  }
  return access
}

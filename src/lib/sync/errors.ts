type SyncErrorListener = (message: string) => void

const listeners = new Set<SyncErrorListener>()

export const onSyncError = (listener: SyncErrorListener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const reportSyncError = (message: string) => {
  if (listeners.size === 0) {
    console.error('[sync]', message)
  }
  for (const listener of listeners) {
    listener(message)
  }
}

export const errorMessage = (err: unknown, fallback = 'Request failed'): string => (err instanceof Error && err.message ? err.message : fallback)

export interface ActiveGeneration {
  conversationId: string
  userId: string
  abort: AbortController
  startedAt: number
  finished: Promise<void>
}

const active = new Map<string, ActiveGeneration & { resolveFinished: () => void }>()

export const getGeneration = (conversationId: string): ActiveGeneration | undefined => active.get(conversationId)

export const registerGeneration = (conversationId: string, userId: string): ActiveGeneration => {
  const existing = active.get(conversationId)
  if (existing) return existing
  let resolveFinished = () => {}
  const finished = new Promise<void>(resolve => {
    resolveFinished = resolve
  })
  const generation = { conversationId, userId, abort: new AbortController(), startedAt: Date.now(), finished, resolveFinished }
  active.set(conversationId, generation)
  return generation
}

export const finishGeneration = (conversationId: string) => {
  active.get(conversationId)?.resolveFinished()
  active.delete(conversationId)
}

export const abortGeneration = (conversationId: string): boolean => {
  const generation = active.get(conversationId)
  if (!generation) return false
  generation.abort.abort()
  return true
}

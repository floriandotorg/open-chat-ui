export interface ActiveGeneration {
  conversationId: string
  userId: string
  abort: AbortController
  startedAt: number
}

const active = new Map<string, ActiveGeneration>()

export const getGeneration = (conversationId: string): ActiveGeneration | undefined => active.get(conversationId)

export const registerGeneration = (conversationId: string, userId: string): ActiveGeneration => {
  const existing = active.get(conversationId)
  if (existing) return existing
  const generation: ActiveGeneration = { conversationId, userId, abort: new AbortController(), startedAt: Date.now() }
  active.set(conversationId, generation)
  return generation
}

export const finishGeneration = (conversationId: string) => {
  active.delete(conversationId)
}

export const abortGeneration = (conversationId: string): boolean => {
  const generation = active.get(conversationId)
  if (!generation) return false
  generation.abort.abort()
  return true
}

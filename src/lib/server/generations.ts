export interface SteerInput {
  id: string
  content: string
}

export interface ActiveGeneration {
  conversationId: string
  userId: string
  abort: AbortController
  startedAt: number
  finished: Promise<void>
  steers: SteerInput[]
  steerable: boolean
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
  const generation = { conversationId, userId, abort: new AbortController(), startedAt: Date.now(), finished, resolveFinished, steers: [], steerable: true }
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

// Accepted steers are guaranteed to reach the model unless the generation
// fails or is stopped; a rejected steer is the caller's to send as a new turn.
export const steerGeneration = (conversationId: string, userId: string, steer: SteerInput): boolean => {
  const generation = active.get(conversationId)
  if (!generation || generation.userId !== userId || !generation.steerable || generation.abort.signal.aborted) {
    return false
  }
  generation.steers.push(steer)
  return true
}

export const takeSteers = (generation: ActiveGeneration): SteerInput[] => generation.steers.splice(0)

export const closeSteeringIfIdle = (generation: ActiveGeneration): boolean => {
  if (generation.steers.length > 0) {
    return false
  }
  generation.steerable = false
  return true
}

export const closeSteering = (generation: ActiveGeneration) => {
  generation.steerable = false
  generation.steers = []
}

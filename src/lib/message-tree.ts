export type BranchMap = Record<string, string>

interface Annotation {
  siblingIndex: number
  siblingCount: number
}

const resolvePath = <T extends { id: string; parentId?: string | null; createdAt: Date | string }>(allMessages: T[], activeBranches: BranchMap): { src: T; siblingIndex: number; siblingCount: number }[] => {
  const childrenByParent = new Map<string, T[]>()
  for (const msg of allMessages) {
    const key = msg.parentId ?? '__root__'
    const list = childrenByParent.get(key) ?? []
    list.push(msg)
    childrenByParent.set(key, list)
  }

  for (const [, children] of childrenByParent) {
    children.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }

  const path: { src: T; siblingIndex: number; siblingCount: number }[] = []
  let currentParent = '__root__'

  while (true) {
    const children = childrenByParent.get(currentParent)
    if (!children?.length) break

    const selectedId = activeBranches[currentParent]
    const selected = selectedId ? children.find(c => c.id === selectedId) : children[children.length - 1]
    if (!selected) break

    const siblingIndex = children.findIndex(c => c.id === selected.id)
    path.push({ src: selected, siblingIndex, siblingCount: children.length })
    currentParent = selected.id
  }

  return path
}

export const resolveAndAnnotate = <T extends { id: string; parentId?: string | null; createdAt: Date | string }>(allMessages: T[], activeBranches: BranchMap): (T & Annotation)[] => resolvePath(allMessages, activeBranches).map(({ src, siblingIndex, siblingCount }) => ({ ...src, siblingIndex, siblingCount }))

// Annotated messages keep their object identity across recomputations as long
// as the source object and sibling structure are unchanged, so a streaming
// delta only invalidates the one message that actually changed instead of
// re-rendering the whole conversation on every realtime event.
export const createStableAnnotator = <T extends { id: string; parentId?: string | null; createdAt: Date | string }>() => {
  let cache = new Map<string, { src: T; out: T & Annotation }>()
  return (allMessages: T[], activeBranches: BranchMap): (T & Annotation)[] => {
    const next = new Map<string, { src: T; out: T & Annotation }>()
    const result = resolvePath(allMessages, activeBranches).map(({ src, siblingIndex, siblingCount }) => {
      const hit = cache.get(src.id)
      const out = hit && hit.src === src && hit.out.siblingIndex === siblingIndex && hit.out.siblingCount === siblingCount ? hit.out : { ...src, siblingIndex, siblingCount }
      next.set(src.id, { src, out })
      return out
    })
    cache = next
    return result
  }
}

export const preserveLocalOrphans = <S extends { id: string }, L extends { id: string }>(serverMessages: S[], localMessages: L[]): (S | L)[] => {
  const serverIds = new Set(serverMessages.map(m => m.id))
  const orphans = localMessages.filter(m => !serverIds.has(m.id))
  return orphans.length ? [...serverMessages, ...orphans] : serverMessages
}

// A user message must attach to a real prior message. If the requested parent
// is missing from the conversation (e.g. a legacy phantom left by an empty
// completion that was never persisted), reattach to the most recent message so
// the server-side history walk keeps full context instead of collapsing.
export const resolveEffectiveParentId = <T extends { id: string; createdAt: Date | string }>(requestedParentId: string | null | undefined, priorMessages: T[]): string | null => {
  const requested = requestedParentId ?? null
  if (requested === null) return null
  if (priorMessages.some(m => m.id === requested)) return requested
  if (!priorMessages.length) return null
  return priorMessages.reduce((latest, m) => (new Date(m.createdAt).getTime() > new Date(latest.createdAt).getTime() ? m : latest)).id
}

export const getAncestorPath = <T extends { id: string; parentId?: string | null }>(messageId: string, allMessages: T[]): T[] => {
  const byId = new Map(allMessages.map(m => [m.id, m]))
  const path: T[] = []
  let current = byId.get(messageId)
  while (current) {
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

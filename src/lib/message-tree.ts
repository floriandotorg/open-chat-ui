export type BranchMap = Record<string, string>

export const resolveAndAnnotate = <T extends { id: string; parentId?: string | null; createdAt: Date | string }>(allMessages: T[], activeBranches: BranchMap): (T & { siblingIndex: number; siblingCount: number })[] => {
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

  const path: (T & { siblingIndex: number; siblingCount: number })[] = []
  let currentParent = '__root__'

  while (true) {
    const children = childrenByParent.get(currentParent)
    if (!children?.length) break

    const selectedId = activeBranches[currentParent]
    const selected = selectedId ? children.find(c => c.id === selectedId) : children[children.length - 1]
    if (!selected) break

    const siblingIndex = children.findIndex(c => c.id === selected.id)
    path.push({ ...selected, siblingIndex, siblingCount: children.length })
    currentParent = selected.id
  }

  return path
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

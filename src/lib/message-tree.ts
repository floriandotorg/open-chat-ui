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

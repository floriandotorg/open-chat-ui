import type { ConversationSummary } from '$lib/types/chat'

export class ConversationsStore {
  private byId = $state(new Map<string, ConversationSummary>())
  private pendingPatches = new Map<string, Partial<ConversationSummary>>()

  conversations = $derived([...this.byId.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()))

  hydrate = (items: ConversationSummary[]) => {
    this.byId = new Map(items.map(c => [c.id, this.withPendingPatch(c)]))
  }

  upsert = (conv: ConversationSummary) => {
    const next = new Map(this.byId)
    next.set(conv.id, this.withPendingPatch(conv))
    this.byId = next
  }

  applyPatch = (id: string, patch: Partial<ConversationSummary>) => {
    const current = this.byId.get(id)
    if (!current) {
      return
    }
    this.pendingPatches.set(id, { ...this.pendingPatches.get(id), ...patch })
    const next = new Map(this.byId)
    next.set(id, { ...current, ...patch })
    this.byId = next
  }

  // Authoritative set from a server response; unlike applyPatch this is not
  // tracked as an optimistic write, so later realtime events stay in charge.
  applyTitle = (id: string, title: string) => {
    const current = this.byId.get(id)
    if (!current) {
      return
    }
    const next = new Map(this.byId)
    next.set(id, { ...current, title })
    this.byId = next
  }

  remove = (id: string) => {
    this.pendingPatches.delete(id)
    const next = new Map(this.byId)
    next.delete(id)
    this.byId = next
  }

  private withPendingPatch = (conv: ConversationSummary): ConversationSummary => {
    const patch = this.pendingPatches.get(conv.id)
    if (!patch) {
      return conv
    }
    const merged = { ...conv }
    const leftover: Partial<ConversationSummary> = {}
    for (const [key, value] of Object.entries(patch) as [keyof ConversationSummary, unknown][]) {
      if (JSON.stringify(conv[key]) === JSON.stringify(value)) {
        continue
      }
      Object.assign(merged, { [key]: value })
      Object.assign(leftover, { [key]: value })
    }
    if (Object.keys(leftover).length) {
      this.pendingPatches.set(conv.id, leftover)
    } else {
      this.pendingPatches.delete(conv.id)
    }
    return merged
  }
}

export const conversationsStore = new ConversationsStore()

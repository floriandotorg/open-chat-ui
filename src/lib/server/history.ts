import type { ChatMessage } from '$lib/server/providers/types'

export interface PersistedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  textOffset: number
  result: string
  rawResult?: string
}

export interface PersistedCodeExecution {
  type: 'code_execution'
  id: string
  name: string
  input: Record<string, unknown>
  textOffset: number
  stdout?: string
  stderr?: string
  returnCode?: number
  error?: string
  files?: { fileId: string; filename: string; mimeType: string }[]
}

export type PersistedEntry = PersistedToolCall | PersistedCodeExecution

export interface RawContentBlockEntry {
  textOffset: number
  blocks: unknown[]
}

const isCodeExecution = (tc: PersistedEntry): tc is PersistedCodeExecution => 'type' in tc && tc.type === 'code_execution'

// Rebuilds the provider-facing turn sequence for one persisted message. The
// persisted content is the concatenated text of every tool round; each round's
// textOffset marks where its text ends. Rounds with code execution replay
// rawContentBlocks verbatim (server-side tool_use/result blocks can't be
// reconstructed otherwise). Every rawContentBlocks offset is also a tool-call
// offset, so the round loop below already emits those turns — the text tail
// after the final round is always plain text, never a block replay.
export const buildHistoryMessages = (role: string, content: string, toolCalls: PersistedEntry[], rawEntries: RawContentBlockEntry[] | null | undefined): ChatMessage[] => {
  const regularToolCalls = toolCalls.filter((tc): tc is PersistedToolCall => !isCodeExecution(tc))
  const hasCodeExec = toolCalls.some(isCodeExecution)

  if (role !== 'assistant' || (!regularToolCalls.length && !hasCodeExec)) {
    return [{ role: role as ChatMessage['role'], content }]
  }

  const rawBlocksByOffset = new Map<number, unknown[]>()
  for (const entry of rawEntries ?? []) {
    rawBlocksByOffset.set(entry.textOffset, entry.blocks)
  }

  const offsets = [...new Set(toolCalls.map(tc => tc.textOffset))].sort((a, b) => a - b)
  const result: ChatMessage[] = []
  let prev = 0
  for (const off of offsets) {
    const roundCalls = regularToolCalls.filter(tc => tc.textOffset === off)
    const roundBlocks = rawBlocksByOffset.get(off)
    if (roundBlocks?.length) {
      result.push({ role: 'assistant', content: content.slice(prev, off), rawContentBlocks: roundBlocks })
    } else {
      result.push({
        role: 'assistant',
        content: content.slice(prev, off),
        toolCalls: roundCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
      })
    }
    for (const tc of roundCalls) {
      result.push({ role: 'tool', content: tc.result, toolCallId: tc.id })
    }
    prev = off
  }

  const tail = content.slice(prev)
  if (tail) {
    result.push({ role: 'assistant', content: tail })
  }

  return result
}

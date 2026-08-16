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
// reconstructed otherwise). A rawContentBlocks offset without any tool-call
// entry is a round whose server_tool_use never received its result
// (pause_turn); it is still replayed so a later round's orphaned result keeps
// its partner. The text tail after the final round is always plain text,
// never a block replay.
//
// Rounds with empty text share a textOffset, so one offset can hold several
// rounds. Each raw-block entry is replayed as its own assistant turn, and
// regular calls are matched to the raw turn whose blocks contain their
// tool_use id; unmatched calls merge into one reconstructed assistant turn.
// Splitting rounds back apart keeps every tool_result paired with its
// tool_use — merging them under a single raw replay drops the other rounds'
// tool_use blocks and Anthropic rejects the orphan tool_result.
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const toolUseIdsIn = (blocks: unknown[]): Set<string> => {
  const ids = new Set<string>()
  for (const block of blocks) {
    if (isRecord(block) && block.type === 'tool_use' && typeof block.id === 'string') {
      ids.add(block.id)
    }
  }
  return ids
}
export const buildHistoryMessages = (role: string, content: string, toolCalls: PersistedEntry[], rawEntries: RawContentBlockEntry[] | null | undefined): ChatMessage[] => {
  const regularToolCalls = toolCalls.filter((tc): tc is PersistedToolCall => !isCodeExecution(tc))
  const hasCodeExec = toolCalls.some(isCodeExecution)
  const hasRawBlocks = (rawEntries ?? []).some(entry => entry.blocks.length > 0)

  if (role !== 'assistant' || (!regularToolCalls.length && !hasCodeExec && !hasRawBlocks)) {
    return [{ role: role as ChatMessage['role'], content }]
  }

  const rawBlocksByOffset = new Map<number, unknown[][]>()
  for (const entry of rawEntries ?? []) {
    const list = rawBlocksByOffset.get(entry.textOffset) ?? []
    list.push(entry.blocks)
    rawBlocksByOffset.set(entry.textOffset, list)
  }

  const offsets = [...new Set([...toolCalls.map(tc => tc.textOffset), ...(rawEntries ?? []).map(entry => entry.textOffset)])].sort((a, b) => a - b)
  const result: ChatMessage[] = []
  let prev = 0
  for (const off of offsets) {
    const roundCalls = regularToolCalls.filter(tc => tc.textOffset === off)
    const rawRounds = rawBlocksByOffset.get(off) ?? []
    let roundText = content.slice(prev, off)
    const matched = new Set<string>()
    for (const blocks of rawRounds) {
      const ids = toolUseIdsIn(blocks)
      result.push({ role: 'assistant', content: roundText, rawContentBlocks: blocks })
      roundText = ''
      for (const tc of roundCalls) {
        if (ids.has(tc.id)) {
          matched.add(tc.id)
          result.push({ role: 'tool', content: tc.result, toolCallId: tc.id })
        }
      }
    }
    const remaining = roundCalls.filter(tc => !matched.has(tc.id))
    if (remaining.length || !rawRounds.length) {
      result.push({
        role: 'assistant',
        content: roundText,
        toolCalls: remaining.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
      })
      for (const tc of remaining) {
        result.push({ role: 'tool', content: tc.result, toolCallId: tc.id })
      }
    }
    prev = off
  }

  const tail = content.slice(prev)
  if (tail) {
    result.push({ role: 'assistant', content: tail })
  }

  return result
}

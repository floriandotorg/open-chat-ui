import { extractCitations } from '#lib/citations.ts'
import type { ChatMessage } from '#lib/server/providers/types.ts'
import type { CodeExecutionSummary, MessagePayload, ToolCallSummary, ToolProgress } from '#lib/types.ts'

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

// A user message injected between rounds of a running generation. rawBefore
// counts the rawContentBlocks entries streamed before it.
export interface PersistedSteer {
  type: 'steer'
  id: string
  content: string
  textOffset: number
  rawBefore: number
}

export type PersistedEntry = PersistedToolCall | PersistedCodeExecution | PersistedSteer

// Live entries accumulate during generation; regular calls may not have their
// result yet.
export interface LiveToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  textOffset: number
  result?: string
  rawResult?: string
  progress?: ToolProgress
}

export type LiveEntry = LiveToolCall | PersistedCodeExecution | PersistedSteer

export const isCodeExecutionEntry = (entry: LiveEntry): entry is PersistedCodeExecution => 'type' in entry && entry.type === 'code_execution'

export const isSteerEntry = (entry: LiveEntry): entry is PersistedSteer => 'type' in entry && entry.type === 'steer'

export const slimEntry = (entry: LiveEntry, done: boolean): ToolCallSummary | CodeExecutionSummary | PersistedSteer => {
  if (isSteerEntry(entry)) {
    return entry
  }
  if (isCodeExecutionEntry(entry)) {
    return {
      type: 'code_execution',
      id: entry.id,
      name: entry.name,
      textOffset: entry.textOffset,
      done,
      ...(entry.returnCode !== undefined ? { returnCode: entry.returnCode } : {}),
      ...(entry.error !== undefined ? { error: entry.error } : {}),
      ...(entry.stdout !== undefined ? { stdoutChars: entry.stdout.length } : {}),
      ...(entry.stderr !== undefined ? { stderrChars: entry.stderr.length } : {}),
      ...(entry.files?.length ? { files: entry.files } : {}),
    }
  }
  const citations = entry.result !== undefined ? extractCitations([entry]) : []
  return {
    id: entry.id,
    name: entry.name,
    textOffset: entry.textOffset,
    done,
    ...(entry.result !== undefined ? { resultChars: entry.result.length } : {}),
    ...(citations.length ? { citations } : {}),
    ...(!done && entry.progress ? { progress: entry.progress } : {}),
  }
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {})

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

// Rebuilds full persisted entries from slim message rows plus their lazily
// stored payload. Legacy rows carry results inline and pass through.
export const hydrateEntries = (entries: unknown[], payload: MessagePayload | undefined): PersistedEntry[] => {
  const hydrated: PersistedEntry[] = []
  for (const raw of entries) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    if (entry.type === 'steer') {
      if (typeof entry.id === 'string' && typeof entry.content === 'string') {
        hydrated.push({ type: 'steer', id: entry.id, content: entry.content, textOffset: typeof entry.textOffset === 'number' ? entry.textOffset : 0, rawBefore: typeof entry.rawBefore === 'number' ? entry.rawBefore : 0 })
      }
      continue
    }
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue
    const results = payload?.toolResults[entry.id]
    const textOffset = typeof entry.textOffset === 'number' ? entry.textOffset : 0
    if (entry.type === 'code_execution') {
      hydrated.push({
        type: 'code_execution',
        id: entry.id,
        name: entry.name,
        input: asRecord(results?.input ?? entry.input),
        textOffset,
        ...(asString(results?.stdout) !== undefined || asString(entry.stdout) !== undefined ? { stdout: asString(results?.stdout) ?? asString(entry.stdout) } : {}),
        ...(asString(results?.stderr) !== undefined || asString(entry.stderr) !== undefined ? { stderr: asString(results?.stderr) ?? asString(entry.stderr) } : {}),
        ...(typeof entry.returnCode === 'number' ? { returnCode: entry.returnCode } : {}),
        ...(asString(entry.error) !== undefined ? { error: asString(entry.error) } : {}),
        ...(Array.isArray(entry.files) ? { files: entry.files as PersistedCodeExecution['files'] } : {}),
      })
    } else {
      const result = asString(results?.result) ?? asString(entry.result) ?? ''
      const rawResult = asString(results?.rawResult) ?? asString(entry.rawResult)
      hydrated.push({
        id: entry.id,
        name: entry.name,
        arguments: asRecord(results?.arguments ?? entry.arguments),
        textOffset,
        result,
        ...(rawResult !== undefined ? { rawResult } : {}),
      })
    }
  }
  return hydrated
}

export interface RawContentBlockEntry {
  textOffset: number
  blocks: unknown[]
}

const isCodeExecution = (tc: PersistedEntry): tc is PersistedCodeExecution => 'type' in tc && tc.type === 'code_execution'

type RoundEntry = PersistedToolCall | PersistedCodeExecution

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
// tool_use blocks and Anthropic rejects the orphan tool_result. Entries are
// persisted in round order, so walking them places each raw turn after the
// merged calls that preceded it.
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const blockIdsIn = (blocks: unknown[], types: string[]): Set<string> => {
  const ids = new Set<string>()
  for (const block of blocks) {
    if (isRecord(block) && typeof block.type === 'string' && types.includes(block.type) && typeof block.id === 'string') {
      ids.add(block.id)
    }
  }
  return ids
}
const buildRounds = (role: string, content: string, toolCalls: RoundEntry[], rawEntries: RawContentBlockEntry[] | null | undefined): ChatMessage[] => {
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
    const offsetEntries = toolCalls.filter(tc => tc.textOffset === off)
    const offsetCalls = regularToolCalls.filter(tc => tc.textOffset === off)
    const rawRounds = (rawBlocksByOffset.get(off) ?? []).map(blocks => ({
      blocks,
      toolUseIds: blockIdsIn(blocks, ['tool_use']),
      callIds: blockIdsIn(blocks, ['tool_use', 'server_tool_use']),
    }))
    let roundText = content.slice(prev, off)
    let emitted = false
    let pending: PersistedToolCall[] = []
    let nextRawRound = 0
    const takeRoundText = () => {
      const text = roundText
      roundText = ''
      emitted = true
      return text
    }
    const flushPending = () => {
      if (!pending.length) return
      result.push({ role: 'assistant', content: takeRoundText(), toolCalls: pending.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })) })
      for (const tc of pending) {
        result.push({ role: 'tool', content: tc.result, toolCallId: tc.id })
      }
      pending = []
    }
    const emitRawRoundsThrough = (index: number) => {
      for (; nextRawRound <= index; ++nextRawRound) {
        const { blocks, toolUseIds } = rawRounds[nextRawRound]
        result.push({ role: 'assistant', content: takeRoundText(), rawContentBlocks: blocks })
        for (const tc of offsetCalls) {
          if (toolUseIds.has(tc.id)) {
            result.push({ role: 'tool', content: tc.result, toolCallId: tc.id })
          }
        }
      }
    }
    for (const entry of offsetEntries) {
      const rawIndex = rawRounds.findIndex(round => round.callIds.has(entry.id))
      if (rawIndex < 0) {
        if (!isCodeExecution(entry)) {
          pending.push(entry)
        }
        continue
      }
      if (rawIndex < nextRawRound) continue
      flushPending()
      emitRawRoundsThrough(rawIndex)
    }
    flushPending()
    emitRawRoundsThrough(rawRounds.length - 1)
    if (!emitted) {
      result.push({ role: 'assistant', content: roundText, toolCalls: [] })
    }
    prev = off
  }

  const tail = content.slice(prev)
  if (tail) {
    result.push({ role: 'assistant', content: tail })
  }

  return result
}

const shiftOffsets = <T extends { textOffset: number }>(entries: T[], by: number): T[] => entries.map(entry => ({ ...entry, textOffset: entry.textOffset - by }))

const isEmptyTurn = (m: ChatMessage) => m.role === 'assistant' && !m.content && !m.toolCalls && !m.rawContentBlocks?.length

// Steers split the message into independently replayed chunks with a user
// turn between them.
export const buildHistoryMessages = (role: string, content: string, entries: PersistedEntry[], rawEntries: RawContentBlockEntry[] | null | undefined): ChatMessage[] => {
  const steers = entries.filter((entry): entry is PersistedSteer => 'type' in entry && entry.type === 'steer')
  if (role !== 'assistant' || steers.length === 0) {
    return buildRounds(
      role,
      content,
      entries.filter((entry): entry is RoundEntry => !('type' in entry) || entry.type !== 'steer'),
      rawEntries,
    )
  }
  const raw = rawEntries ?? []
  const result: ChatMessage[] = []
  let chunk: RoundEntry[] = []
  let textStart = 0
  let rawStart = 0
  const flushChunk = (textEnd: number, rawEnd: number) => {
    const turns = buildRounds('assistant', content.slice(textStart, textEnd), shiftOffsets(chunk, textStart), shiftOffsets(raw.slice(rawStart, rawEnd), textStart))
    result.push(...turns.filter(turn => !isEmptyTurn(turn)))
    chunk = []
    textStart = textEnd
    rawStart = rawEnd
  }
  for (const entry of entries) {
    if ('type' in entry && entry.type === 'steer') {
      flushChunk(entry.textOffset, entry.rawBefore)
      result.push({ role: 'user', content: entry.content })
    } else {
      chunk.push(entry)
    }
  }
  flushChunk(content.length, raw.length)
  return result
}

import { normalizeModelRef } from '$lib/model-ref'
import type { Message as ClientMessage, CodeExecutionSummary, FileAttachment, ImageAttachment, MessagePayload, ModelInfo, ToolCallSummary } from '$lib/types'
import type { RecordModel } from 'pocketbase'

export interface ApiKey {
  id: string
  userId: string
  provider: string
  encryptedKey: string
  iv: string
  createdAt: Date
  updatedAt: Date
}

export interface Conversation {
  id: string
  userId: string
  title: string
  systemPrompt: string | null
  systemPromptId: string | null
  resolvedSystemPrompt: string | null
  defaultProvider: string | null
  defaultModel: string | null
  container: string | null
  activeBranches: Record<string, string> | null
  generating: boolean
  favorite: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Message {
  id: string
  conversationId: string
  parentId: string | null
  role: string
  content: string
  images: ImageAttachment[] | null
  files: FileAttachment[] | null
  provider: string | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadInputTokens: number | null
  cacheCreationInputTokens: number | null
  cost: number | null
  toolCalls: unknown[] | null
  error: string | null
  thinking: string | null
  thinkingDuration: number | null
  eventSeq: number
  generating?: boolean
  createdAt: Date
}

export interface SystemPrompt {
  id: string
  userId: string
  title: string
  content: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

export interface UserSettings {
  id: string
  userId: string
  defaultSystemPrompt: string | null
  defaultProvider: string | null
  defaultModel: string | null
  titleModel: string | null
  toolSummarizerModel: string | null
  dictationProvider: string | null
  updatedAt: Date
}

export interface ProviderModel {
  id: string
  provider: string
  modelId: string
  enabled: boolean
  metadata: ModelInfo | null
  createdAt: Date
  updatedAt: Date
}

const toDate = (value: string): Date => new Date(value)

const orNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

const numOrNull = (value: unknown): number | null => (typeof value === 'number' && value !== 0 ? value : null)

const asRole = (value: string): ClientMessage['role'] => {
  if (value === 'user' || value === 'assistant' || value === 'system') return value
  return 'assistant'
}

export const mapApiKey = (r: RecordModel): ApiKey => ({
  id: r.id,
  userId: r.user,
  provider: r.provider,
  encryptedKey: r.encryptedKey,
  iv: r.iv,
  createdAt: toDate(r.createdAt),
  updatedAt: toDate(r.updatedAt),
})

export const mapConversation = (r: RecordModel): Conversation => ({
  id: r.id,
  userId: r.user,
  title: r.title,
  systemPrompt: orNull(r.systemPrompt),
  systemPromptId: orNull(r.systemPromptRef),
  resolvedSystemPrompt: orNull(r.resolvedSystemPrompt),
  defaultProvider: orNull(r.defaultProvider),
  defaultModel: normalizeModelRef(orNull(r.defaultProvider), orNull(r.defaultModel)),
  container: orNull(r.container),
  activeBranches: r.activeBranches ?? null,
  generating: r.generating ?? false,
  favorite: r.favorite ?? false,
  createdAt: toDate(r.createdAt),
  updatedAt: toDate(r.updatedAt),
})

export const mapMessage = (r: RecordModel): Message => ({
  id: r.id,
  conversationId: r.conversation,
  parentId: orNull(r.parentId),
  role: r.role,
  content: r.content,
  images: r.images ?? null,
  files: r.files ?? null,
  provider: orNull(r.provider),
  model: orNull(r.model),
  inputTokens: numOrNull(r.inputTokens),
  outputTokens: numOrNull(r.outputTokens),
  cacheReadInputTokens: numOrNull(r.cacheReadInputTokens),
  cacheCreationInputTokens: numOrNull(r.cacheCreationInputTokens),
  cost: numOrNull(r.cost),
  toolCalls: r.toolCalls ?? null,
  error: orNull(r.error),
  thinking: orNull(r.thinking),
  thinkingDuration: numOrNull(r.thinkingDuration),
  eventSeq: typeof r.eventSeq === 'number' ? r.eventSeq : 0,
  generating: r.generating ?? false,
  createdAt: toDate(r.createdAt),
})

export const mapMessagePayload = (r: RecordModel): MessagePayload => ({
  messageId: r.message,
  toolResults: r.toolResults ?? {},
  rawContentBlocks: r.rawContentBlocks ?? null,
  thinking: orNull(r.thinking),
})

interface RawEntry {
  type?: string
  [key: string]: unknown
}

const strOrUndefined = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

// New rows store the slim summary shape; legacy rows carry results inline and
// no done flag, which is derived from the presence of a result instead.
const toToolCallSummary = (e: RawEntry): ToolCallSummary => ({
  id: typeof e.id === 'string' ? e.id : '',
  name: typeof e.name === 'string' ? e.name : '',
  arguments: typeof e.arguments === 'object' && e.arguments !== null ? (e.arguments as Record<string, unknown>) : {},
  textOffset: typeof e.textOffset === 'number' ? e.textOffset : 0,
  done: typeof e.done === 'boolean' ? e.done : typeof e.result === 'string',
  ...(typeof e.resultChars === 'number' ? { resultChars: e.resultChars } : {}),
  ...(Array.isArray(e.citations) ? { citations: e.citations as ToolCallSummary['citations'] } : {}),
  ...(strOrUndefined(e.result) !== undefined ? { result: strOrUndefined(e.result) } : {}),
  ...(strOrUndefined(e.rawResult) !== undefined ? { rawResult: strOrUndefined(e.rawResult) } : {}),
})

const toCodeExecutionSummary = (e: RawEntry): CodeExecutionSummary => ({
  type: 'code_execution',
  id: typeof e.id === 'string' ? e.id : '',
  name: typeof e.name === 'string' ? e.name : '',
  input: typeof e.input === 'object' && e.input !== null ? (e.input as Record<string, unknown>) : {},
  textOffset: typeof e.textOffset === 'number' ? e.textOffset : 0,
  done: typeof e.done === 'boolean' ? e.done : typeof e.stdout === 'string' || typeof e.stderr === 'string' || typeof e.error === 'string' || typeof e.returnCode === 'number',
  ...(typeof e.returnCode === 'number' ? { returnCode: e.returnCode } : {}),
  ...(strOrUndefined(e.error) !== undefined ? { error: strOrUndefined(e.error) } : {}),
  ...(typeof e.stdoutChars === 'number' ? { stdoutChars: e.stdoutChars } : {}),
  ...(typeof e.stderrChars === 'number' ? { stderrChars: e.stderrChars } : {}),
  ...(Array.isArray(e.files) ? { files: e.files as CodeExecutionSummary['files'] } : {}),
  ...(strOrUndefined(e.stdout) !== undefined ? { stdout: strOrUndefined(e.stdout) } : {}),
  ...(strOrUndefined(e.stderr) !== undefined ? { stderr: strOrUndefined(e.stderr) } : {}),
})

export const mapClientMessage = (r: RecordModel): ClientMessage => {
  const m = mapMessage(r)
  const raw = (m.toolCalls ?? []) as RawEntry[]
  const toolCalls = raw.filter(e => e.type !== 'code_execution').map(toToolCallSummary)
  const codeExecutions = raw.filter(e => e.type === 'code_execution').map(toCodeExecutionSummary)
  return {
    id: m.id,
    conversationId: m.conversationId,
    parentId: m.parentId,
    role: asRole(m.role),
    content: m.content,
    images: m.images ?? undefined,
    files: m.files ?? undefined,
    model: normalizeModelRef(m.provider, m.model),
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheReadInputTokens: m.cacheReadInputTokens,
    cacheCreationInputTokens: m.cacheCreationInputTokens,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    codeExecutions: codeExecutions.length ? codeExecutions : undefined,
    sendError: m.error ?? undefined,
    thinking: m.thinking ?? undefined,
    thinkingDuration: m.thinkingDuration ?? undefined,
    eventSeq: m.eventSeq,
    generating: m.generating,
    createdAt: m.createdAt,
  }
}

export const mapSystemPrompt = (r: RecordModel): SystemPrompt => ({
  id: r.id,
  userId: r.user,
  title: r.title,
  content: r.content,
  isDefault: r.isDefault ?? false,
  createdAt: toDate(r.createdAt),
  updatedAt: toDate(r.updatedAt),
})

export const mapUserSettings = (r: RecordModel): UserSettings => ({
  id: r.id,
  userId: r.user,
  defaultSystemPrompt: orNull(r.defaultSystemPrompt),
  defaultProvider: orNull(r.defaultProvider),
  defaultModel: orNull(r.defaultModel),
  titleModel: orNull(r.titleModel),
  toolSummarizerModel: orNull(r.toolSummarizerModel),
  dictationProvider: orNull(r.dictationProvider),
  updatedAt: toDate(r.updatedAt),
})

export const mapProviderModel = (r: RecordModel): ProviderModel => ({
  id: r.id,
  provider: r.provider,
  modelId: r.modelId,
  enabled: r.enabled ?? false,
  metadata: (r.metadata as ModelInfo | null) ?? null,
  createdAt: toDate(r.createdAt),
  updatedAt: toDate(r.updatedAt),
})

export const now = () => new Date().toISOString()

import { normalizeModelRef } from '$lib/model-ref'
import type { Message as ClientMessage, CodeExecutionBlock, FileAttachment, ImageAttachment, ToolCallInfo } from '$lib/types'
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
  toolCalls: unknown[] | null
  rawContentBlocks: unknown[] | null
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
  dictationProvider: string | null
  updatedAt: Date
}

export interface ProviderModel {
  id: string
  provider: string
  modelId: string
  enabled: boolean
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
  toolCalls: r.toolCalls ?? null,
  rawContentBlocks: r.rawContentBlocks ?? null,
  generating: r.generating ?? false,
  createdAt: toDate(r.createdAt),
})

interface RawEntry {
  type?: string
  [key: string]: unknown
}

export const mapClientMessage = (r: RecordModel): ClientMessage => {
  const m = mapMessage(r)
  const raw = (m.toolCalls ?? []) as RawEntry[]
  const toolCalls = raw.filter(e => e.type !== 'code_execution') as unknown as ToolCallInfo[]
  const codeExecutions = raw.filter(e => e.type === 'code_execution') as unknown as CodeExecutionBlock[]
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
    toolCalls: toolCalls.length ? toolCalls : undefined,
    codeExecutions: codeExecutions.length ? codeExecutions : undefined,
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
  dictationProvider: orNull(r.dictationProvider),
  updatedAt: toDate(r.updatedAt),
})

export const mapProviderModel = (r: RecordModel): ProviderModel => ({
  id: r.id,
  provider: r.provider,
  modelId: r.modelId,
  enabled: r.enabled ?? false,
  createdAt: toDate(r.createdAt),
  updatedAt: toDate(r.updatedAt),
})

export const now = () => new Date().toISOString()

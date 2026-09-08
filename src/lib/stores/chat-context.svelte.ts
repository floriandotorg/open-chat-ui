import type { createModelsStore } from '$lib/stores/models.svelte'
import type { ThinkingEffort } from '$lib/types'

let selectedModel = $state('')
let thinkingEffort = $state<ThinkingEffort>('none')
let generatingConversationId = $state<string | null>(null)
let currentSystemPromptId = $state<string | null>(null)
let newChatFocusToken = $state(0)
let modelsStore = $state<ReturnType<typeof createModelsStore> | null>(null)

export const chatContext = {
  get selectedModel() {
    return selectedModel
  },
  set selectedModel(v: string) {
    selectedModel = v
  },
  get thinkingEffort() {
    return thinkingEffort
  },
  set thinkingEffort(v: ThinkingEffort) {
    thinkingEffort = v
  },
  get generatingConversationId() {
    return generatingConversationId
  },
  set generatingConversationId(v: string | null) {
    generatingConversationId = v
  },
  get currentSystemPromptId() {
    return currentSystemPromptId
  },
  set currentSystemPromptId(v: string | null) {
    currentSystemPromptId = v
  },
  get newChatFocusToken() {
    return newChatFocusToken
  },
  set newChatFocusToken(v: number) {
    newChatFocusToken = v
  },
  get modelsStore() {
    return modelsStore
  },
  set modelsStore(v: ReturnType<typeof createModelsStore> | null) {
    modelsStore = v
  },
}
